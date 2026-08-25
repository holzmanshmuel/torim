import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { clientAddress, manageReadLimiter } from '@/app/b/lib/rate-limits';
import { notFound } from 'next/navigation';
import { getLang, getT, type Lang } from '@/lib/i18n';
import { findBookingByManageToken } from '@/lib/manage';
import { addDays, instantToDateKey } from '@/lib/time';
import { bookingDictionary } from '../../b/dictionary';
import { pickName } from '../../b/lib/format';
import type { BusinessDto } from '../../b/lib/types';
import { parseManageToken } from '../../b/lib/validate';
import { ManageBooking } from '../ManageBooking';

/**
 * The customer's own booking: `/manage/<token>`.
 *
 * The token is the whole credential — there is no account to sign into. A malformed or
 * unresolvable token gets the ordinary branded 404 rather than anything that
 * distinguishes "never existed" from "not yours", so probing tokens learns nothing.
 *
 * `noindex` matters here: this URL is a capability. A search engine that crawled one
 * from a shared screenshot or a leaked referrer would publish the ability to cancel
 * someone's appointment.
 */
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const lang = await getLang();
  const t = getT(lang, bookingDictionary);
  // Deliberately identical whether or not the token resolves.
  void params;
  return {
    title: t('manage.meta.title'),
    robots: { index: false, follow: false },
  };
}

export default async function ManagePage({ params }: Params) {
  const lang: Lang = await getLang();

  const { token: rawToken } = await params;
  const token = parseManageToken(rawToken);
  if (!token) notFound();

  // Every other consumer of the token oracle is limited — the .ics route and all three
  // manage actions. This page was the exception, and it is the highest-value probe
  // surface of the four because it discloses the customer's name and phone.
  //
  // Not a guessing defence: 244 bits is not brute-forced at any rate. It bounds the
  // unauthenticated work a flood of `GET /manage/<64 hex>` can make the server do, and
  // it stops this one path contradicting the reasoning the sibling actions rely on.
  const gate = manageReadLimiter.check(`manage-read:${clientAddress(await headers())}`);
  if (!gate.allowed) notFound();

  const found = await findBookingByManageToken(token);
  if (!found) notFound();

  const { booking, business, service, customer } = found;

  const now = new Date();
  const today = instantToDateKey(now, business.timezone);
  const horizon = addDays(today, business.maxAdvanceDays);

  const businessDto: BusinessDto = {
    slug: business.slug,
    name: business.name,
    timezone: business.timezone,
    currency: business.currency,
    minNoticeMin: business.minNoticeMin,
    maxAdvanceDays: business.maxAdvanceDays,
    cancellationWindowMin: business.cancellationWindowMin,
    hasDefaultCallingCode: business.defaultCallingCode !== null,
    whatsappPhone: business.ownerWhatsappPhone,
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6 sm:py-10">
      <ManageBooking
        lang={lang}
        token={token}
        business={businessDto}
        businessName={pickName(lang, business.name, business.nameHe)}
        serviceName={pickName(lang, service.name, service.nameHe)}
        booking={{
          status: booking.status,
          startsAt: booking.startsAt.toISOString(),
          endsAt: booking.endsAt.toISOString(),
          priceMinor: booking.priceMinor,
        }}
        customerName={customer.name}
        customerPhone={customer.phone}
        today={today}
        horizon={horizon}
        nowIso={now.toISOString()}
      />
    </div>
  );
}
