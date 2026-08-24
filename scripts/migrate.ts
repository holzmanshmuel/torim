/**
 * Migration runner.
 *
 * Applies scripts/sql/NNN_name.sql in numeric order, each in its own transaction,
 * recording every applied file in torim.schema_migrations with a checksum.
 *
 * - Already-applied files are skipped.
 * - An applied file whose contents later changed is a hard error: migrations are
 *   append-only, you add NNN+1 rather than editing history.
 * - Files are still written idempotently (IF NOT EXISTS / DROP ... IF EXISTS) so a
 *   partially-applied database can be repaired by re-running.
 *
 * Run as the schema OWNER (migrations do DDL), not as the restricted app role:
 *   DATABASE_URL="postgres://owner@localhost:5432/torim_dev" npm run migrate
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ quiet: true });

const SQL_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sql');

type Migration = { version: number; name: string; file: string; sql: string; checksum: string };

function loadMigrations(): Migration[] {
  return readdirSync(SQL_DIR)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .map((file) => {
      const sql = readFileSync(path.join(SQL_DIR, file), 'utf8');
      return {
        version: Number.parseInt(file.slice(0, file.indexOf('_')), 10),
        name: file.slice(file.indexOf('_') + 1, -4),
        file,
        sql,
        checksum: createHash('sha256').update(sql).digest('hex').slice(0, 16),
      };
    })
    .sort((a, b) => a.version - b.version);
}

async function main(): Promise<void> {
  const connectionString = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is not set. Point it at the schema owner, not the app role.');
    process.exit(1);
  }

  const migrations = loadMigrations();
  if (migrations.length === 0) {
    console.error(`No migrations found in ${SQL_DIR}`);
    process.exit(1);
  }

  const seen = new Set<number>();
  for (const m of migrations) {
    if (seen.has(m.version)) {
      console.error(`Duplicate migration version ${m.version} (${m.file}).`);
      process.exit(1);
    }
    seen.add(m.version);
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query('CREATE SCHEMA IF NOT EXISTS torim');
    await client.query(`
      CREATE TABLE IF NOT EXISTS torim.schema_migrations (
        version    integer PRIMARY KEY,
        name       text NOT NULL,
        checksum   text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const { rows: applied } = await client.query<{ version: number; checksum: string; name: string }>(
      'SELECT version, checksum, name FROM torim.schema_migrations',
    );
    const appliedBy = new Map(applied.map((r) => [r.version, r]));

    let ran = 0;
    for (const m of migrations) {
      const previous = appliedBy.get(m.version);
      if (previous) {
        if (previous.checksum !== m.checksum) {
          console.error(
            `\nMigration ${m.file} changed after it was applied ` +
              `(recorded ${previous.checksum}, now ${m.checksum}).\n` +
              'Migrations are append-only — add a new numbered file instead of editing this one.',
          );
          process.exit(1);
        }
        continue;
      }

      process.stdout.write(`  applying ${m.file} ... `);
      await client.query('BEGIN');
      try {
        await client.query(m.sql);
        await client.query(
          'INSERT INTO torim.schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
          [m.version, m.name, m.checksum],
        );
        await client.query('COMMIT');
        console.log('ok');
        ran += 1;
      } catch (err) {
        await client.query('ROLLBACK');
        console.log('FAILED');
        throw err;
      }
    }

    console.log(
      ran === 0
        ? `\nUp to date — ${migrations.length} migration(s) already applied.`
        : `\nApplied ${ran} migration(s); ${migrations.length} total.`,
    );
    console.log(
      '\nReminder: the app must connect as a non-superuser role without BYPASSRLS.\n' +
        'Grant it with:  npm run db:grant\n' +
        'Verify it with: npm run db:check-role',
    );
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
