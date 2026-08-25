import Link from 'next/link';
import { listUnseenChanges } from '@/lib/admin-bookings';
import { findBusinessById } from '@/lib/businesses';
import { getLang, getT } from '@/lib/i18n';
import { instantToDateKey } from '@/lib/time';
import { ChangesList } from '../_components/ChangesList';
import { loadScheduleRules } from '../data';
import { adminDictionary } from '../dictionary';
import { todayKey } from '../format';
import { withGuard } from '../guard';
import type { BookingView } from '../types';
import { buildBookingView, makeOpeningHoursCheck, makeViewContext } from '../view';

/**
 * The unseen-changes list behind the badge.
 *
 * "Unseen" is derived from timestamps — `last_customer_change_at` against
 * `owner_seen_at` — not from a boolean flag. A flag is cleared by the first glance and
 * stays cleared through everything that happens afterwards; the comparison means a
 * later change by the same customer reopens the item by itself.
 */
export default async function AdminChangesPage() {
  const lang = await getLang();
  const t = getT(lang, adminDictionary);

  const data = await withGuard('view_schedule', async (context) => {
    const business = await findBusinessById(context.businessId);
    if (!business) return null;

    const changes = await listUnseenChanges();

    // Opening hours only matter for the badge on each row, so load rules for one narrow
    // window around what is actually in the list rather than the whole calendar. Day
    // keys come from `instantToDateKey` in the BUSINESS's timezone — deriving them from
    // an ISO string would be a UTC day and could be off by one either side.
    const dateKeys = changes.map((item) => instantToDateKey(item.startsAt, business.timezone));
    const today = todayKey(business.timezone);
    const from = dateKeys.length > 0 ? dateKeys.reduce((a, b) => (a < b ? a : b)) : today;
    const to = dateKeys.length > 0 ? dateKeys.reduce((a, b) => (a > b ? a : b)) : today;

    const rules = await loadScheduleRules(from, to);
    const view = makeViewContext(business, lang);
    const isOutside = makeOpeningHoursCheck(rules, business.timezone);

    return {
      bookings: changes.map((item): BookingView => buildBookingView(item, view, isOutside)),
    };
  });

  if (!data) return null;

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-xl font-semibold text-ink">{t('chg.title')}</h1>
        <p className="text-body">{t('chg.intro')}</p>
      </div>

      {data.bookings.length === 0 ? (
        <div className="rounded-md border border-dashed border-line px-6 py-12 text-center">
          <p className="font-display text-lg font-semibold text-ink">{t('chg.empty.title')}</p>
          <p className="mt-2 text-body">{t('chg.empty.message')}</p>
          <Link
            href="/admin"
            className="mt-4 inline-flex h-11 items-center justify-center rounded-md border border-line px-5 text-sm font-medium text-ink no-underline hover:border-blue hover:text-blue"
          >
            {t('chg.backToDay')}
          </Link>
        </div>
      ) : (
        <ChangesList bookings={data.bookings} />
      )}
    </>
  );
}
