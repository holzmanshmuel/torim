/**
 * POST /api/ops/notifications/result — an external transport reports what happened.
 *
 * The caller must name the business as well as the notification. Marking is done inside
 * that tenant's scope, so RLS refuses an id belonging to anyone else: a caller who
 * guesses an id cannot touch it without also knowing which tenant it is in, and even
 * then only within that tenant.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { authorizeOps } from '@/lib/notify/ops';
import { markFailed, markSent, markSkipped } from '@/lib/notify/queue';
import { runWithTenant } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

const Body = z
  .object({
    id: z.uuid(),
    businessId: z.uuid(),
    /** Which transport did it — recorded so a mixed deployment can be told apart later. */
    transport: z.string().min(1).max(64),
    status: z.enum(['sent', 'failed', 'skipped']),
    error: z.string().max(2000).optional(),
    reason: z.string().max(2000).optional(),
  })
  .refine((b) => b.status !== 'failed' || !!b.error, {
    message: 'A failed result must say what went wrong.',
    path: ['error'],
  });

export async function POST(request: NextRequest) {
  const auth = authorizeOps(request.headers.get('authorization'));
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await request.json());
  } catch (error) {
    const message =
      error instanceof z.ZodError ? error.issues.map((i) => i.message).join('; ') : 'Invalid body.';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const matched = await runWithTenant(parsed.businessId, async () => {
    if (parsed.status === 'sent') {
      return markSent(parsed.id, parsed.transport);
    }
    if (parsed.status === 'skipped') {
      return markSkipped(parsed.id, parsed.transport, parsed.reason ?? 'Reported skipped.');
    }
    return markFailed(parsed.id, parsed.transport, parsed.error ?? 'Reported failed.');
  });

  // Under RLS a wrong (id, businessId) pair updates nothing rather than erroring. Saying
  // "ok" to that is worse than an error: a drainer that already sent the message is told
  // it succeeded, the row stays queued, the next poll hands it out again, and the
  // customer gets a second copy carrying the same capability URL.
  if (!matched) {
    return NextResponse.json(
      { error: 'No queued notification matches that id for that business.' },
      { status: 404, headers: { 'cache-control': 'no-store, private' } },
    );
  }

  return NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store, private' } });
}
