/**
 * The server-to-server surface.
 *
 * Two ways to get messages out, and a deployment picks whichever suits it:
 *
 *  - **Pull.** An external system lists what is due, sends it with its own provider and
 *    its own credentials, and reports the outcome back. Nothing about that provider is
 *    in this repo.
 *  - **Drain.** Something on a timer asks Torim to send what is due through the
 *    transport this deployment configured. This is how the built-in SMTP adapter runs.
 *
 * `OPS_TOKEN` is a deployment secret that reads across every tenant on the instance. It
 * is never handed to a user, never appears in a URL, and the endpoints are closed
 * entirely until it is set.
 */
import { timingSafeEqual } from 'node:crypto';
import { systemQuery } from '../db';
import { runWithTenant } from '../tenant';
import { renderMessage } from './messages';
import { listDue, markFailed, markSent, markSkipped, type QueuedNotification } from './queue';
import { resolveTransport } from './registry';

export type OpsAuthResult = { ok: true } | { ok: false; status: 401 | 503; message: string };

/** Constant-time, and only after the lengths match — comparing unequal buffers throws. */
function tokensMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function authorizeOps(authorizationHeader: string | null): OpsAuthResult {
  const expected = process.env.OPS_TOKEN?.trim();

  // Closed unless switched on: a deployment that never sets a token has no
  // server-to-server surface at all, rather than one guarded by an empty string.
  if (!expected) {
    return {
      ok: false,
      status: 503,
      message: 'Ops endpoints are disabled. Set OPS_TOKEN to enable them.',
    };
  }

  const prefix = 'Bearer ';
  if (!authorizationHeader || !authorizationHeader.startsWith(prefix)) {
    return { ok: false, status: 401, message: 'Missing bearer token.' };
  }

  const provided = authorizationHeader.slice(prefix.length).trim();
  if (!tokensMatch(provided, expected)) {
    return { ok: false, status: 401, message: 'Invalid token.' };
  }
  return { ok: true };
}

export type DueNotification = QueuedNotification & { businessSlug: string };

/**
 * What is due across every tenant, each item tagged with the business it belongs to.
 *
 * One drainer serves the whole instance, so the listing spans tenants — but each row is
 * read inside its own tenant scope, and the caller must name the business again to
 * report an outcome. Nothing here is addressable without saying which tenant it is in.
 */
export async function listDueAcrossTenants(
  args: { now?: Date; limit?: number } = {},
): Promise<DueNotification[]> {
  const now = args.now ?? new Date();
  const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);

  const businesses = await systemQuery<{ id: string; slug: string }>(
    'SELECT id, slug FROM torim.businesses ORDER BY created_at',
  );

  const collected: DueNotification[] = [];
  for (const business of businesses) {
    if (collected.length >= limit) break;
    const remaining = limit - collected.length;

    const due = await runWithTenant(business.id, () => listDue({ now, limit: remaining }));
    collected.push(...due.map((n) => ({ ...n, businessSlug: business.slug })));
  }
  return collected;
}

export type DrainSummary = {
  transport: string;
  considered: number;
  sent: number;
  failed: number;
  skipped: number;
};

/**
 * Send what is due through the configured transport.
 *
 * With the default `none`, everything is marked skipped — correct, and different from
 * failed: nothing about it is going to start working on a retry.
 */
export async function drainDue(args: { now?: Date; limit?: number } = {}): Promise<DrainSummary> {
  const transport = resolveTransport();
  const due = await listDueAcrossTenants(args);

  const summary: DrainSummary = {
    transport: transport.id,
    considered: due.length,
    sent: 0,
    failed: 0,
    skipped: 0,
  };

  for (const notification of due) {
    await runWithTenant(notification.businessId, async () => {
      const message = await renderMessage(notification);

      // The booking has gone since this was queued. Not a delivery failure.
      if (!message) {
        await markSkipped(notification.id, transport.id, 'Booking no longer exists.');
        summary.skipped += 1;
        return;
      }

      const outcome = await transport.send(message);
      if (outcome.status === 'sent') {
        await markSent(notification.id, transport.id);
        summary.sent += 1;
      } else if (outcome.status === 'skipped') {
        await markSkipped(notification.id, transport.id, outcome.reason);
        summary.skipped += 1;
      } else {
        await markFailed(notification.id, transport.id, outcome.error);
        summary.failed += 1;
      }
    });
  }

  return summary;
}
