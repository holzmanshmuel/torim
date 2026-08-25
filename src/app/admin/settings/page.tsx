import { findBusinessById } from '@/lib/businesses';
import { getLang, getT } from '@/lib/i18n';
import { SettingsForm } from '../_components/SettingsForm';
import { getSignedInUser } from '../data';
import { adminDictionary } from '../dictionary';
import { interpolate } from '../format';
import { guard } from '../guard';
import { runWithTenant } from '@/lib/tenant';
import type { SettingsFormInput } from '../types';

/**
 * Settings, plus the account section.
 *
 * The page itself only requires being signed in, and the business form is rendered for
 * the owner alone. A staff member still needs somewhere to sign out from, and bouncing
 * them off a page the nav offered would be a dead end — the *write* is what
 * `manage_settings` guards, and it does so inside the Server Action regardless of what
 * this renders.
 */
export default async function AdminSettingsPage() {
  const lang = await getLang();
  const t = getT(lang, adminDictionary);

  const context = await guard();

  const data = await runWithTenant(context.businessId, async () => {
    const [business, user] = await Promise.all([
      findBusinessById(context.businessId),
      getSignedInUser(context.userId),
    ]);
    return { business, user };
  });

  const business = data.business;
  if (!business) return null;

  const initial: SettingsFormInput = {
    name: business.name,
    nameHe: business.nameHe ?? '',
    slug: business.slug,
    timezone: business.timezone,
    currency: business.currency,
    defaultLocale: business.defaultLocale,
    defaultCallingCode: business.defaultCallingCode ?? '',
    ownerWhatsappPhone: business.ownerWhatsappPhone ?? '',
    slotGranularityMin: String(business.slotGranularityMin),
    minNoticeMin: String(business.minNoticeMin),
    maxAdvanceDays: String(business.maxAdvanceDays),
    cancellationWindowMin: String(business.cancellationWindowMin),
    confirmNewCustomers: business.confirmNewCustomers,
  };

  // APP_BASE_URL is optional in development; falling back to the path alone keeps the
  // link useful instead of rendering "undefined/b/slug".
  const base = process.env.APP_BASE_URL?.replace(/\/+$/, '') ?? '';
  const bookingUrl = `${base}/b/${business.slug}`;

  return (
    <>
      <h1 className="font-display text-xl font-semibold text-ink">{t('set.title')}</h1>

      <section className="flex flex-col gap-2 rounded-md border border-line bg-surface px-4 py-4 shadow-soft">
        <h2 className="font-display text-base font-semibold text-ink">{t('set.bookingLink')}</h2>
        <a
          href={bookingUrl}
          className="break-all text-sm text-blue no-underline hover:underline"
          dir="ltr"
        >
          {bookingUrl}
        </a>
        <p className="text-sm text-muted">{t('set.copyHint')}</p>
      </section>

      {context.role === 'owner' ? <SettingsForm initial={initial} /> : null}

      <section className="flex flex-col gap-3 border-t border-line pt-5">
        <h2 className="font-display text-lg font-semibold text-ink">{t('set.account')}</h2>

        {data.user ? (
          <p className="text-sm text-body">
            {interpolate(t('set.signedInAs'), { value: data.user.email })}
          </p>
        ) : null}

        <p className="text-sm text-muted">
          {t(context.role === 'owner' ? 'set.role.owner' : 'set.role.staff')}
        </p>

        {/* POST, never GET: a GET sign-out can be fired by any <img> on any site. */}
        <form action="/api/auth/signout" method="post">
          <button
            type="submit"
            className="inline-flex h-11 items-center justify-center rounded-md border border-line px-5 text-sm font-medium text-ink hover:border-danger hover:text-danger"
          >
            {t('a.signOut')}
          </button>
        </form>
      </section>
    </>
  );
}
