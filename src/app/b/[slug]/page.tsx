import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { listActiveServices } from '@/lib/availability';
import { findBusinessBySlug, type PublicBusiness } from '@/lib/businesses';
import { getLang, getT, type Lang } from '@/lib/i18n';
import { runWithTenant } from '@/lib/tenant';
import { addDays, instantToDateKey } from '@/lib/time';
import { BookingFlow } from '../BookingFlow';
import { bookingDictionary } from '../dictionary';
import { pickName } from '../lib/format';
import type { BusinessDto, ServiceDto } from '../lib/types';
import { parseSlug } from '../lib/validate';

/**
 * The public booking page: `/b/<slug>`.
 *
 * Path-based rather than subdomain-based, deliberately. A subdomain per tenant needs
 * wildcard DNS and a wildcard certificate, which rules out most self-hosting and every
 * "put it behind the reverse proxy I already have" deployment. A path costs nothing and
 * works everywhere, including on a Raspberry Pi in the back of a salon.
 *
 * Rendered per request: availability, "today" and the booking horizon are all functions
 * of the current instant in the *business's* timezone, and a page cached at build time
 * would hand a customer yesterday's calendar.
 */
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };

/** An unknown or malformed slug is a 404 page, not an error page. */
async function resolveBusiness(params: Params['params']): Promise<PublicBusiness | null> {
  const { slug: raw } = await params;
  const slug = parseSlug(raw);
  if (!slug) return null;
  return findBusinessBySlug(slug);
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const lang = await getLang();
  const t = getT(lang, bookingDictionary);
  const business = await resolveBusiness(params);

  if (!business) {
    return { title: t('notFound.title') };
  }

  return {
    // The root layout's template appends " — Torim".
    title: pickName(lang, business.name, business.nameHe),
    description: t('booking.meta.description'),
  };
}

function toBusinessDto(business: PublicBusiness): BusinessDto {
  // Note what does not cross: the business id. The client addresses this business by
  // slug, so nothing it sends back can be re-aimed at another tenant.
  return {
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
}

export default async function BookingPage({ params }: Params) {
  const lang: Lang = await getLang();
  const t = getT(lang, bookingDictionary);

  const business = await resolveBusiness(params);
  if (!business) notFound();

  const services: ServiceDto[] = await runWithTenant(business.id, async () => {
    const rows = await listActiveServices();
    return rows.map((service) => ({
      id: service.id,
      name: pickName(lang, service.name, service.nameHe),
      description: service.description,
      durationMin: service.durationMin,
      priceMinor: service.priceMinor,
    }));
  });

  // Resolved on the server, in the business's timezone. The browser's idea of "today"
  // belongs to whoever is holding the phone, which is not necessarily the same day.
  const now = new Date();
  const today = instantToDateKey(now, business.timezone);
  const horizon = addDays(today, business.maxAdvanceDays);

  const businessName = pickName(lang, business.name, business.nameHe);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="mb-6 overflow-hidden rounded-md border border-line bg-surface shadow-soft">
        <div aria-hidden="true" className="h-1.5 w-full bg-blue" />
        <div className="px-5 py-5 sm:px-6">
          <p className="mono-label text-muted">{t('booking.heading')}</p>
          <h1 className="mt-1 font-display text-2xl font-semibold text-ink sm:text-3xl">
            {businessName}
          </h1>
          <p className="mt-2 text-sm text-body">{t('booking.tagline')}</p>
        </div>
      </header>

      <BookingFlow
        lang={lang}
        business={toBusinessDto(business)}
        businessName={businessName}
        services={services}
        today={today}
        horizon={horizon}
      />
    </div>
  );
}
