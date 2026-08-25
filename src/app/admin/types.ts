/**
 * The shapes that cross the server/client boundary.
 *
 * Kept in a plain module rather than beside the Server Actions, because a `'use server'`
 * file may only export async functions — a type exported from one is a build error.
 *
 * Everything here is already-formatted, already-localised and serialisable. The client
 * never receives a raw `Date`, a currency code or a minor-unit integer to render,
 * because formatting on the device means a phone set to another timezone or locale can
 * quietly show a different time than the business's own.
 */

import type { BookingStatus } from './optimistic-store';

export type { BookingStatus };

// ---------------------------------------------------------------------------
// Action results
// ---------------------------------------------------------------------------

/** The specific appointment a new or moved booking would sit on top of. */
export type ClashInfo = {
  bookingId: string;
  /** Isolated time range, e.g. "09:00–10:00". */
  when: string;
  customerName: string;
  serviceName: string;
};

export type ActionOk<T> = { ok: true; value: T };

export type ActionErr = {
  ok: false;
  /** A stable machine code, e.g. 'end_not_after_start' — for branching, not display. */
  code: string;
  /** Localised on the server. Safe to render as-is. */
  message: string;
  /** Which form field to attach the message to, when it belongs to one. */
  field?: string;
  /** Present only when `code === 'conflict'` — what the owner would be booking over. */
  clash?: ClashInfo;
};

export type ActionResult<T> = ActionOk<T> | ActionErr;

// ---------------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------------

export type BookingView = {
  id: string;
  status: BookingStatus;
  needsAttention: boolean;
  /** Business-local day, for links and for the move form's date field. */
  dateKey: string;
  /** Raw HH:MM in business-local time — the move form's initial value. */
  timeValue: string;
  /** Isolated "09:00–10:00". */
  timeRange: string;
  /** Isolated "09:00" — the leading column of the day list. */
  startTime: string;
  /** Isolated "Monday, 15 June, 09:00" — for naming this appointment in a confirmation. */
  whenLabel: string;
  /** Isolated day heading, for grouping in the week view. */
  dayHeading: string;
  priceLabel: string;
  note: string | null;
  source: 'customer' | 'admin';
  /** True when any part of it falls outside opening hours. Shown, never used to filter. */
  outsideHours: boolean;
  /** Whether this appointment has already finished — a no-show is only legal afterwards. */
  finished: boolean;
  customer: {
    id: string;
    name: string;
    /** Isolated E.164 for display. */
    phoneLabel: string;
    /** Raw E.164 — for `tel:` and for the wa.me link. */
    phone: string;
    blocked: boolean;
  };
  service: {
    id: string;
    name: string;
    colour: string;
    durationLabel: string;
  };
  /** Prefilled WhatsApp text, composed in the BUSINESS's language, never sent by itself. */
  whatsappMessages: {
    about: string;
    confirmed: string;
    moved: string;
    cancelled: string;
  };
};

export type NewBookingInput = {
  /** An existing customer, or null when adding a new one. */
  customerId: string | null;
  newCustomer: { name: string; phone: string } | null;
  serviceId: string;
  /** YYYY-MM-DD, business-local. */
  date: string;
  /** HH:MM, business-local. Any time is legal, including outside opening hours. */
  time: string;
  note: string;
  /** Only ever true after the owner has been shown the clash and chosen to override. */
  allowOverlap: boolean;
};

export type BookingSaved = {
  bookingId: string;
  /** Isolated "Monday, 15 June, 09:00". */
  when: string;
  customerName: string;
  /** True when this write knowingly sat on top of an existing appointment. */
  overlapped: boolean;
  /** What it overlapped, looked up after the fact so the confirmation is never a guess. */
  overlappedWith: ClashInfo | null;
};

export type MoveBookingInput = {
  bookingId: string;
  date: string;
  time: string;
  allowOverlap: boolean;
};

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export type CustomerOption = {
  id: string;
  name: string;
  phoneLabel: string;
  blocked: boolean;
};

export type VisitView = {
  id: string;
  when: string;
  timeRange: string;
  status: BookingStatus;
  priceLabel: string;
  serviceName: string;
  note: string | null;
  upcoming: boolean;
};

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

export type ServiceView = {
  id: string;
  name: string;
  nameHe: string | null;
  description: string | null;
  durationMin: number;
  /** Major units as a plain editable string, e.g. "120.50". */
  priceInput: string;
  priceLabel: string;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  colour: string;
  active: boolean;
  first: boolean;
  last: boolean;
};

/** The minimum a picker needs: already-formatted, already-localised. */
export type ServiceOption = {
  id: string;
  name: string;
  colour: string;
  /** "30 min · ₪120", already isolated where it matters. */
  summary: string;
};

export type ServiceFormInput = {
  id: string | null;
  name: string;
  nameHe: string;
  description: string;
  durationMin: string;
  price: string;
  bufferBeforeMin: string;
  bufferAfterMin: string;
  colour: string;
  active: boolean;
};

// ---------------------------------------------------------------------------
// Hours
// ---------------------------------------------------------------------------

export type HoursRowView = {
  id: string;
  weekday: number;
  /** Isolated "09:00–17:00". */
  range: string;
  startValue: string;
  endValue: string;
};

export type ClosureView = {
  id: string;
  dateKey: string;
  dateLabel: string;
  /** Isolated range, or null for a whole-day closure. */
  range: string | null;
  label: string | null;
};

export type OverrideView = {
  id: string;
  dateKey: string;
  dateLabel: string;
  range: string;
  label: string | null;
};

export type HoursFormInput = {
  weekday: number;
  start: string;
  end: string;
};

export type ClosureFormInput = {
  date: string;
  wholeDay: boolean;
  start: string;
  end: string;
  label: string;
};

export type OverrideFormInput = {
  date: string;
  start: string;
  end: string;
  label: string;
};

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export type SettingsFormInput = {
  name: string;
  nameHe: string;
  slug: string;
  timezone: string;
  currency: string;
  defaultLocale: 'en' | 'he';
  defaultCallingCode: string;
  ownerWhatsappPhone: string;
  slotGranularityMin: string;
  minNoticeMin: string;
  maxAdvanceDays: string;
  cancellationWindowMin: string;
  confirmNewCustomers: boolean;
  /**
   * Reminders are two fields for one nullable column, deliberately.
   *
   * `businesses.reminder_lead_min` is NULL for "no reminders at all" and 0 for "at the
   * appointment time" — genuinely different answers. A single number input cannot say
   * both: an empty box reads as a field somebody forgot to fill in, not as a choice. So
   * the switch carries the "none" answer and the number carries the lead time, and the
   * action collapses them back to `number | null`.
   */
  remindersEnabled: boolean;
  /** Minutes before the appointment. Ignored entirely when `remindersEnabled` is false. */
  reminderLeadMin: string;
  /** Off by default. When off, the booking form never shows an email field at all. */
  askCustomerEmail: boolean;
};

export type OnboardingFormInput = {
  name: string;
  slug: string;
  timezone: string;
  currency: string;
  defaultCallingCode: string;
  defaultLocale: 'en' | 'he';
};
