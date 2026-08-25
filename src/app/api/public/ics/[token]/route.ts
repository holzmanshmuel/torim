/**
 * GET /api/public/ics/[token] — the customer's appointment as a calendar file.
 *
 * A Route Handler rather than a Server Action because the browser has to *navigate* to
 * it: an `<a href … download>` is a plain link click, so nothing here depends on a user
 * gesture surviving an `await`, which is the failure mode that silently breaks
 * popup-based downloads on iOS Safari.
 *
 * The manage token is the credential, exactly as on `/manage/[token]`. Nothing about a
 * booking is served without it, and an unresolvable token gets a bare 404 — the same
 * response as a token that never existed, so probing learns nothing.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { getLang } from '@/lib/i18n';
import { findBookingByManageToken } from '@/lib/manage';
import { bookingUid, buildIcs, icsFilename } from '@/app/b/lib/ics';
import { pickName } from '@/app/b/lib/format';
import { clientAddress, icsLimiter } from '@/app/b/lib/rate-limits';
import { parseManageToken } from '@/app/b/lib/validate';
import type { BookingStatus } from '@/app/b/lib/types';

export const dynamic = 'force-dynamic';

const ICS_STATUS: Record<BookingStatus, 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED'> = {
  confirmed: 'CONFIRMED',
  // The owner screens new customers: the appointment is held, not agreed. TENTATIVE is
  // exactly what that means to a calendar client.
  pending: 'TENTATIVE',
  cancelled: 'CANCELLED',
  // A missed appointment still happened as far as the calendar is concerned.
  no_show: 'CONFIRMED',
};

/** Prefer the configured public origin; fall back to what the request says it reached. */
function publicOrigin(request: NextRequest): string {
  const configured = process.env.APP_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');

  const host =
    request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() ??
    request.headers.get('host')?.trim();
  if (!host) return request.nextUrl.origin;

  const proto =
    request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ??
    request.nextUrl.protocol.replace(':', '');
  return `${proto}://${host}`;
}

export async function GET(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token: rawToken } = await context.params;
  const token = parseManageToken(rawToken);
  if (!token) return new NextResponse('Not found', { status: 404 });

  const gate = icsLimiter.check(`ics:${clientAddress(request.headers)}`);
  if (!gate.allowed) {
    return new NextResponse('Too many requests', {
      status: 429,
      headers: { 'retry-after': String(Math.ceil(gate.retryAfterMs / 1000)) },
    });
  }

  const found = await findBookingByManageToken(token);
  if (!found) return new NextResponse('Not found', { status: 404 });

  const { booking, business, service } = found;
  const lang = await getLang();

  const businessName = pickName(lang, business.name, business.nameHe);
  const serviceName = pickName(lang, service.name, service.nameHe);
  const manageUrl = `${publicOrigin(request)}/manage/${token}`;

  const body = buildIcs({
    uid: bookingUid(booking.id),
    start: booking.startsAt,
    end: booking.endsAt,
    summary: `${serviceName} · ${businessName}`,
    description: manageUrl,
    location: businessName,
    timezone: business.timezone,
    status: ICS_STATUS[booking.status],
    url: manageUrl,
    sequence: found.revision,
  });

  return new NextResponse(body, {
    status: 200,
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': `attachment; filename="${icsFilename(`${businessName}-${serviceName}`)}"`,
      // A capability-token response must never be cached by a shared proxy.
      'cache-control': 'no-store, private',
    },
  });
}
