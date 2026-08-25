/**
 * The wire shapes between the booking Server Actions and the client components.
 *
 * Everything here is JSON-serialisable: instants cross as ISO 8601 strings with an
 * explicit offset, never as `Date`. Two reasons. A Server Action's return value is
 * serialised anyway, and — more importantly — these shapes are what the *server* chooses
 * to expose. A booking row has a manage token, a customer id and a business id on it;
 * only what a customer's own screen renders belongs in a payload.
 */
import type { DayState } from '@/lib/slots';

export type { DayState };

/** One day of the calendar. `slots` are ISO instants, ascending. */
export type DayDto = {
  /** Business-local date key, YYYY-MM-DD. */
  date: string;
  state: DayState;
  slots: string[];
};

export type ServiceDto = {
  id: string;
  name: string;
  description: string | null;
  durationMin: number;
  priceMinor: number;
};

/**
 * The business, as the booking page needs it. Note what is absent: no id. The client
 * addresses the business by slug (or, on the manage page, by capability token), so a
 * tampered payload cannot redirect a write at another tenant.
 */
export type BusinessDto = {
  slug: string;
  name: string;
  timezone: string;
  currency: string;
  minNoticeMin: number;
  maxAdvanceDays: number;
  cancellationWindowMin: number;
  /** Drives which phone hint is shown; the code itself is never needed client-side. */
  hasDefaultCallingCode: boolean;
  /** E.164, or null when the owner has not set one. */
  whatsappPhone: string | null;
};

export type BookingStatus = 'pending' | 'confirmed' | 'cancelled' | 'no_show';

export type ConfirmationDto = {
  status: BookingStatus;
  startsAt: string;
  endsAt: string;
  serviceName: string;
  durationMin: number;
  priceMinor: number;
  customerName: string;
  /** E.164, echoed back so the customer can see we understood the number they typed. */
  customerPhone: string;
  /** Relative — the client turns it into an absolute URL with its own origin. */
  managePath: string;
  icsPath: string;
};

/**
 * Why every action returns this instead of throwing.
 *
 * Next redacts an error thrown out of a Server Action in production, replacing the
 * message with a generic string and a digest. A customer would see "an error occurred"
 * where they needed to read "that time was just taken" or "try again in 3 minutes". So
 * expected failures come back as data, already localised on the server, and only genuine
 * bugs are left to throw.
 */
export type ActionError = {
  ok: false;
  code: ActionErrorCode;
  /** Localised and ready to display. */
  message: string;
  /** Set when the failure belongs beside one input rather than above the form. */
  field?: 'name' | 'phone' | 'note' | 'email';
};

export type ActionErrorCode =
  | 'invalid_request'
  | 'not_found'
  | 'rate_limited'
  | 'slot_taken'
  | 'blocked'
  | 'too_late_to_cancel'
  | 'unexpected';

export type ActionResult<T> = ({ ok: true } & T) | ActionError;

export type AvailabilityPayload = {
  days: DayDto[];
  /** Business-local today, so the client never asks its own clock what day it is. */
  today: string;
  /** The last day this business is currently taking bookings for. */
  horizon: string;
};
