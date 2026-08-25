/**
 * POST /api/ops/notifications/drain — send what is due through the configured transport.
 *
 * For the push model, and how the built-in SMTP adapter actually runs: something on a
 * timer calls this. With the default `none` transport it marks everything skipped, which
 * is correct and costs nothing.
 *
 * There is no retry here by design. A transport that wants backoff implements it — see
 * docs/NOTIFICATIONS.md for why v1 deliberately has none.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { authorizeOps, drainDue } from '@/lib/notify/ops';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = authorizeOps(request.headers.get('authorization'));
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const summary = await drainDue();
  return NextResponse.json(summary, { headers: { 'cache-control': 'no-store, private' } });
}
