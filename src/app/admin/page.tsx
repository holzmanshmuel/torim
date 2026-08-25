import Link from 'next/link';
import { listBookingsForDay } from '@/lib/admin-bookings';
import { listActiveServices } from '@/lib/availability';
import { findBusinessById } from '@/lib/businesses';
import { dirFor, getLang, getT } from '@/lib/i18n';
import { addDays } from '@/lib/time';
import { EmptyState } from '@/app/components';
import { Banner } from './_components/Banner';
import { DaySchedule } from './_components/DaySchedule';
import { NewBookingButton } from './_components/NewBookingButton';
import { PrevNext } from './_components/PrevNext';
import { adminDictionary } from './dictionary';
import { loadScheduleRules } from './data';
import { countLabel, dayHeading, money, nextSlotValue, todayKey } from './format';
import { withGuard } from './guard';
import type { BookingView, ServiceOption } from './types';
import { isDateKey } from './validation';
import { buildBookingView, makeOpeningHoursCheck, makeViewContext, serviceDisplayName } from './view';

/**
 * The day view. The default screen, and the one the owner lives on.
 *
 * It shows every appointment on the day — outside opening hours, on a closed day,
 * cancelled, no-showed, all of it. `listBookingsForDay` bounds a day by the business's
 * LOCAL midnights and by nothing else; this page adds no second filter of its own. The
 * predecessor's day view was hardcoded to the public booking window, so an appointment
 * the owner had entered herself for 07:30 was invisible on the screen she ran her day
 * from. Outside-hours is a badge here, never an exclusion.
 */
export default async function AdminDayPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; error?: string }>;
}) {
  const params = await searchParams;
  const lang = await getLang();
  const dir = dirFor(lang);
  const t = getT(lang, adminDictionary);

  const data = await withGuard('view_schedule', async (context) => {
    const business = await findBusinessById(context.businessId);
    if (!business) return null;

    // An unparseable ?date= falls back to today rather than 404ing: this URL gets
    // shared, bookmarked and hand-edited, and a broken one should still show a day.
    const dateKey =
      params.date && isDateKey(params.date) ? params.date : todayKey(business.timezone);

    const [bookings, services, rules] = await Promise.all([
      listBookingsForDay({ businessId: context.businessId, date: dateKey }),
      listActiveServices(),
      loadScheduleRules(dateKey, dateKey),
    ]);

    const view = makeViewContext(business, lang);
    const isOutside = makeOpeningHoursCheck(rules, business.timezone);

    return {
      dateKey,
      timezone: business.timezone,
      slotGranularityMin: business.slotGranularityMin,
      bookings: bookings.map((item): BookingView => buildBookingView(item, view, isOutside)),
      services: services.map(
        (service): ServiceOption => ({
          id: service.id,
          name: serviceDisplayName(service, lang),
          colour: service.colour,
          summary: `${service.durationMin} ${t('a.min')} · ${money(service.priceMinor, business.currency, lang)}`,
        }),
      ),
    };
  });

  if (!data) return null;

  const today = todayKey(data.timezone);
  const isToday = data.dateKey === today;
  const defaultTime = isToday
    ? nextSlotValue(new Date(), data.timezone, data.slotGranularityMin)
    : '09:00';

  return (
    <>
      {params.error ? (
        <Banner tone="warn">
          {t(params.error === 'owner_only' ? 'admin.error.owner_only' : 'admin.error.forbidden')}
        </Banner>
      ) : null}

      <PrevNext
        dir={dir}
        prevHref={`/admin?date=${addDays(data.dateKey, -1)}`}
        nextHref={`/admin?date=${addDays(data.dateKey, 1)}`}
        prevLabel={t('day.prevDay')}
        nextLabel={t('day.nextDay')}
      >
        <h1 className="font-display text-lg font-semibold text-ink">
          {dayHeading(data.dateKey, lang, data.timezone, t)}
        </h1>
        <p className="text-sm text-muted">
          {countLabel(data.bookings.length, t, {
            zero: 'day.count.zero',
            one: 'day.count.one',
            many: 'day.count.many',
          })}
        </p>
      </PrevNext>

      {!isToday ? (
        <div className="text-center">
          <Link href="/admin" className="text-sm text-blue no-underline hover:underline">
            {t('a.today')}
          </Link>
        </div>
      ) : null}

      {data.bookings.length === 0 ? (
        // The empty state carries the action itself, so an empty day is never a dead end
        // and the primary button is not rendered twice on the same screen.
        <EmptyState
          title={t('day.empty.title')}
          message={t('day.empty.message')}
          action={
            <NewBookingButton
              services={data.services}
              defaultDate={data.dateKey}
              defaultTime={defaultTime}
            />
          }
        />
      ) : (
        <>
          <NewBookingButton
            services={data.services}
            defaultDate={data.dateKey}
            defaultTime={defaultTime}
            full
          />
          <DaySchedule bookings={data.bookings} />
        </>
      )}

      {/* Jumping to a distant date without tapping through it a day at a time. A plain
          GET form, so it works with no JavaScript and produces a shareable URL. */}
      <form method="get" className="flex items-end gap-2 border-t border-line pt-5">
        <label className="flex flex-1 flex-col gap-1.5">
          <span className="text-sm font-medium text-ink">{t('day.jumpToDate')}</span>
          <input
            type="date"
            name="date"
            defaultValue={data.dateKey}
            className="h-11 rounded-md border border-line bg-surface px-3 text-ink"
          />
        </label>
        <button
          type="submit"
          className="inline-flex h-11 shrink-0 items-center justify-center rounded-md border border-line px-5 text-sm font-medium text-ink hover:border-blue hover:text-blue"
        >
          {t('a.go')}
        </button>
      </form>
    </>
  );
}
