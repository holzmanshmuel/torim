import Link from 'next/link';
import { listBookingsForRange } from '@/lib/admin-bookings';
import { findBusinessById } from '@/lib/businesses';
import { dirFor, getLang, getT } from '@/lib/i18n';
import { addDays, dateKeysBetween } from '@/lib/time';
import { DaySchedule } from '../_components/DaySchedule';
import { PrevNext } from '../_components/PrevNext';
import { loadScheduleRules } from '../data';
import { adminDictionary } from '../dictionary';
import { countLabel, dateRange, dayHeadingShort, todayKey, weekStart } from '../format';
import { withGuard } from '../guard';
import type { BookingView } from '../types';
import { isDateKey } from '../validation';
import { buildBookingView, makeOpeningHoursCheck, makeViewContext } from '../view';

/**
 * Seven days at a glance.
 *
 * The week starts on Sunday because `torim.working_hours.weekday` numbers it that way —
 * one definition of "the week", shared by the schema, the slot engine and this grid.
 *
 * Navigation renders the same `PrevNext` as the day view, so the two cannot end up
 * stepping in opposite directions the way the predecessor's month grid and day nav did.
 * Month view is deliberately absent: it was built and then deleted at the real owner's
 * request — day plus week was enough.
 */
export default async function AdminWeekPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const params = await searchParams;
  const lang = await getLang();
  const dir = dirFor(lang);
  const t = getT(lang, adminDictionary);

  const data = await withGuard('view_schedule', async (context) => {
    const business = await findBusinessById(context.businessId);
    if (!business) return null;

    const anchor =
      params.from && isDateKey(params.from) ? params.from : todayKey(business.timezone);
    const from = weekStart(anchor, business.timezone);
    const to = addDays(from, 6);

    const [bookings, rules] = await Promise.all([
      listBookingsForRange({ businessId: context.businessId, from, to }),
      loadScheduleRules(from, to),
    ]);

    const view = makeViewContext(business, lang);
    const isOutside = makeOpeningHoursCheck(rules, business.timezone);

    return {
      from,
      to,
      timezone: business.timezone,
      bookings: bookings.map((item): BookingView => buildBookingView(item, view, isOutside)),
    };
  });

  if (!data) return null;

  const today = todayKey(data.timezone);
  const days = dateKeysBetween(data.from, data.to);
  const byDay = new Map<string, BookingView[]>();
  for (const booking of data.bookings) {
    const bucket = byDay.get(booking.dateKey);
    if (bucket) bucket.push(booking);
    else byDay.set(booking.dateKey, [booking]);
  }

  return (
    <>
      <PrevNext
        dir={dir}
        prevHref={`/admin/week?from=${addDays(data.from, -7)}`}
        nextHref={`/admin/week?from=${addDays(data.from, 7)}`}
        prevLabel={t('week.prevWeek')}
        nextLabel={t('week.nextWeek')}
      >
        <h1 className="font-display text-lg font-semibold text-ink">
          {dateRange(data.from, data.to, lang)}
        </h1>
        <p className="text-sm text-muted">
          {countLabel(data.bookings.length, t, {
            one: 'week.total.one',
            many: 'week.total.many',
          })}
        </p>
      </PrevNext>

      <div className="text-center">
        <Link href="/admin/week" className="text-sm text-blue no-underline hover:underline">
          {t('week.thisWeek')}
        </Link>
      </div>

      <div className="flex flex-col gap-6">
        {days.map((dateKey) => {
          const dayBookings = byDay.get(dateKey) ?? [];
          const isToday = dateKey === today;

          return (
            <section key={dateKey} className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between gap-3 border-b border-line pb-2">
                <Link
                  href={`/admin?date=${dateKey}`}
                  aria-label={t('week.openDay')}
                  className={
                    isToday
                      ? 'font-display text-base font-semibold text-blue no-underline'
                      : 'font-display text-base font-semibold text-ink no-underline hover:text-blue'
                  }
                >
                  {dayHeadingShort(dateKey, lang, data.timezone, t)}
                </Link>
                <span className="text-sm text-muted">
                  {dayBookings.length === 0
                    ? t('week.empty')
                    : countLabel(dayBookings.length, t, {
                        one: 'day.count.one',
                        many: 'day.count.many',
                      })}
                </span>
              </div>

              {dayBookings.length > 0 ? <DaySchedule bookings={dayBookings} compact /> : null}
            </section>
          );
        })}
      </div>
    </>
  );
}
