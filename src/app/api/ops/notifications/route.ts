/**
 * GET /api/ops/notifications — what is due, across every tenant.
 *
 * For the pull model: an external system lists what is due, sends it with its own
 * provider and its own credentials, then reports back to /result. Nothing about that
 * provider lives in this repo.
 *
 * Guarded by OPS_TOKEN, a deployment secret that reads across tenants. It is never given
 * to a user and never goes in a URL — a query-string token ends up in access logs,
 * proxies and browser history.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { authorizeOps, listDueAcrossTenants } from '@/lib/notify/ops';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = authorizeOps(request.headers.get('authorization'));
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const limitParam = request.nextUrl.searchParams.get('limit');
  const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;
  if (limitParam && (!Number.isFinite(limit) || limit! < 1)) {
    return NextResponse.json({ error: 'limit must be a positive integer.' }, { status: 400 });
  }

  const due = await listDueAcrossTenants({ limit });

  return NextResponse.json(
    {
      // The tenant is named on every item, and must be sent back to report an outcome.
      notifications: due.map((n) => ({
        id: n.id,
        businessId: n.businessId,
        businessSlug: n.businessSlug,
        bookingId: n.bookingId,
        kind: n.kind,
        channel: n.channel,
        locale: n.locale,
        sendAfter: n.sendAfter.toISOString(),
        attempts: n.attempts,
      })),
    },
    { headers: { 'cache-control': 'no-store, private' } },
  );
}
