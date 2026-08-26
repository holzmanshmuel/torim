import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // .tsx too, so components can have real render tests. A component test opts into
    // a DOM with `// @vitest-environment jsdom` at the top of the file; everything else
    // stays in the faster node environment.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['src/test-setup.ts'],
    // Every DB-backed test file otherwise gets its own connection and pins its writes
    // inside one rolled-back transaction (src/lib/test-db.ts), which is why running many
    // of them at once against the same real Postgres is normally safe. reset-demo.test.ts
    // breaks that assumption on purpose: it runs a real, schema-wide TRUNCATE, which takes
    // an ACCESS EXCLUSIVE lock on every table in schema torim. Any other file's in-flight
    // transaction against those same tables — committed or not — would either be wiped out
    // from under it or block that TRUNCATE until it ends, so file-level parallelism has to
    // be off for the whole suite, not just that one file (Vitest has no "isolate this file
    // from the others" knob short of that).
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      // Lets server-only modules be imported under vitest without throwing.
      'server-only': path.resolve(import.meta.dirname, './src/test-stubs/empty.ts'),
    },
  },
});
