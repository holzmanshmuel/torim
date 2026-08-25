/**
 * Database rows to screen-ready view models.
 *
 * Everything a client component renders is built here, on the server, in the
 * *business's* timezone and currency. Nothing crosses the boundary as a raw `Date` or a
 * minor-unit integer, so a phone set to another timezone cannot shift an appointment by
 * an hour, and a device locale cannot change a price.
 *
 * The WhatsApp prefills are composed in the business's own language rather than the
 * language the owner happens to be reading the admin in: the message is for the
 * customer. Composing it is all this does — nothing is ever sent from here.
 */
import type { BookingListItem } from '@/lib/admin-bookings';
import type { PublicBusiness } from '@/lib/businesses';
import type { Customer } from '@/lib/customers';
import { getT, type Lang } from '@/lib/i18n';
import { instantToDateKey, instantToMinutes, type DateKey } from '@/lib/time';
import { adminDictionary } from './dictionary';
import type { AdminService, ClosureRecord, CustomerVisit, HoursRow, OverrideRecord, ScheduleRules } from './data';
import {
  clock,
  clockRange,
  clockValue,
  dayHeading,
  dayMonthYear,
  interpolate,
  minutesRange,
  money,
  moneyInputValue,
  phone,
  whenLabel,
} from './format';
import { isOutsideOpeningHours, openWindowsForDate, type OpenWindow } from './opening-hours';
import type {
  BookingView,
  ClosureView,
  CustomerOption,
  HoursRowView,
  OverrideView,
  ServiceView,
  VisitView,
} from './types';

export type ViewContext = {
  /** The language the OWNER is reading the admin in. */
  lang: Lang;
  t: (key: string) => string;
  business: PublicBusiness;
  /** The language the CUSTOMER should be messaged in — the business's own. */
  businessLang: Lang;
  businessT: (key: string) => string;
  now: Date;
};

export function makeViewContext(business: PublicBusiness, lang: Lang, now = new Date()): ViewContext {
  const businessLang = business.defaultLocale;
  return {
    lang,
    t: getT(lang, adminDictionary),
    business,
    businessLang,
    businessT: getT(businessLang, adminDictionary),
    now,
  };
}

/** The business's display name, preferring the Hebrew one when messaging in Hebrew. */
export function businessDisplayName(business: PublicBusiness, lang: Lang): string {
  return lang === 'he' && business.nameHe ? business.nameHe : business.name;
}

/** A service's display name, same rule. */
export function serviceDisplayName(
  service: { name: string; nameHe: string | null },
  lang: Lang,
): string {
  return lang === 'he' && service.nameHe ? service.nameHe : service.name;
}

/**
 * A reusable "is this outside opening hours?" test for a set of dates.
 *
 * Windows are computed once per date rather than per booking: a busy Saturday is one
 * calculation, not thirty.
 */
export function makeOpeningHoursCheck(
  rules: ScheduleRules,
  timezone: string,
): (startsAt: Date, endsAt: Date) => boolean {
  const cache = new Map<DateKey, OpenWindow[]>();

  return (startsAt, endsAt) => {
    const dateKey = instantToDateKey(startsAt, timezone);
    let windows = cache.get(dateKey);
    if (!windows) {
      windows = openWindowsForDate({
        dateKey,
        timezone,
        workingHours: rules.workingHours,
        closures: rules.closures,
        dateOverrides: rules.dateOverrides,
      });
      cache.set(dateKey, windows);
    }

    const startMin = instantToMinutes(startsAt, timezone);
    // An appointment ending exactly at local midnight reads as minute 0 of the next day;
    // 1440 is what the hours table calls that, and comparing 0 would look like 00:00.
    const rawEnd = instantToMinutes(endsAt, timezone);
    const endsNextDay = instantToDateKey(endsAt, timezone) !== dateKey;
    const endMin = endsNextDay ? 1440 : rawEnd;

    return isOutsideOpeningHours(startMin, endMin, windows);
  };
}

function whatsappMessages(
  item: BookingListItem,
  context: ViewContext,
): BookingView['whatsappMessages'] {
  const { businessT, businessLang, business } = context;
  const when = whenLabel(item.startsAt, businessLang, business.timezone, businessT);
  const vars = {
    name: item.customer.name,
    business: businessDisplayName(business, businessLang),
    when,
  };

  return {
    about: interpolate(businessT('wa.about'), vars),
    confirmed: interpolate(businessT('wa.confirmed'), vars),
    moved: interpolate(businessT('wa.moved'), vars),
    cancelled: interpolate(businessT('wa.cancelled'), vars),
  };
}

export function buildBookingView(
  item: BookingListItem,
  context: ViewContext,
  isOutside: (startsAt: Date, endsAt: Date) => boolean,
): BookingView {
  const { lang, t, business } = context;
  const timezone = business.timezone;
  const dateKey = instantToDateKey(item.startsAt, timezone);

  return {
    id: item.id,
    status: item.status,
    needsAttention: item.needsAttention,
    dateKey,
    timeValue: clockValue(item.startsAt, timezone),
    timeRange: clockRange(item.startsAt, item.endsAt, timezone),
    startTime: clock(item.startsAt, timezone),
    whenLabel: whenLabel(item.startsAt, lang, timezone, t),
    dayHeading: dayHeading(dateKey, lang, timezone, t),
    // The snapshot on the booking, never today's catalogue price.
    priceLabel: money(item.finalPriceMinor ?? item.priceMinor, business.currency, lang),
    note: item.note,
    source: item.source,
    outsideHours: isOutside(item.startsAt, item.endsAt),
    finished: item.endsAt.getTime() <= context.now.getTime(),
    customer: {
      id: item.customer.id,
      name: item.customer.name,
      phoneLabel: phone(item.customer.phone),
      phone: item.customer.phone,
      blocked: item.customer.blocked,
    },
    service: {
      id: item.service.id,
      name: item.service.name,
      colour: item.service.colour,
      durationLabel: `${item.service.durationMin} ${t('a.min')}`,
    },
    whatsappMessages: whatsappMessages(item, context),
  };
}

export function buildCustomerOption(customer: Customer): CustomerOption {
  return {
    id: customer.id,
    name: customer.name,
    phoneLabel: phone(customer.phone),
    blocked: customer.blocked,
  };
}

export function buildVisitView(visit: CustomerVisit, context: ViewContext): VisitView {
  const { lang, t, business } = context;
  const dateKey = instantToDateKey(visit.startsAt, business.timezone);
  return {
    id: visit.id,
    when: dayHeading(dateKey, lang, business.timezone, t),
    timeRange: clockRange(visit.startsAt, visit.endsAt, business.timezone),
    status: visit.status,
    priceLabel: money(visit.priceMinor, business.currency, lang),
    serviceName: visit.serviceName,
    note: visit.note,
    upcoming: visit.startsAt.getTime() > context.now.getTime(),
  };
}

export function buildServiceViews(services: AdminService[], context: ViewContext): ServiceView[] {
  const { lang, business } = context;
  return services.map((service, index) => ({
    id: service.id,
    name: service.name,
    nameHe: service.nameHe,
    description: service.description,
    durationMin: service.durationMin,
    priceInput: moneyInputValue(service.priceMinor, business.currency),
    priceLabel: money(service.priceMinor, business.currency, lang),
    bufferBeforeMin: service.bufferBeforeMin,
    bufferAfterMin: service.bufferAfterMin,
    colour: service.colour,
    active: service.active,
    first: index === 0,
    last: index === services.length - 1,
  }));
}

export function buildHoursViews(rows: HoursRow[]): HoursRowView[] {
  return rows.map((row) => ({
    id: row.id,
    weekday: row.weekday,
    range: minutesRange(row.startMin, row.endMin),
    startValue: clockValueOf(row.startMin),
    endValue: clockValueOf(row.endMin),
  }));
}

/** Raw HH:MM for an `<input type="time">`, capped at 23:59 — 24:00 is not a valid value. */
function clockValueOf(minutes: number): string {
  const capped = Math.min(minutes, 1439);
  return `${String(Math.floor(capped / 60)).padStart(2, '0')}:${String(capped % 60).padStart(2, '0')}`;
}

export function buildClosureViews(rows: ClosureRecord[], context: ViewContext): ClosureView[] {
  return rows.map((row) => ({
    id: row.id,
    dateKey: row.onDate,
    dateLabel: dayMonthYear(row.onDate, context.lang),
    range:
      row.startMin === null || row.endMin === null ? null : minutesRange(row.startMin, row.endMin),
    label: row.label,
  }));
}

export function buildOverrideViews(rows: OverrideRecord[], context: ViewContext): OverrideView[] {
  return rows.map((row) => ({
    id: row.id,
    dateKey: row.onDate,
    dateLabel: dayMonthYear(row.onDate, context.lang),
    range: minutesRange(row.startMin, row.endMin),
    label: row.label,
  }));
}
