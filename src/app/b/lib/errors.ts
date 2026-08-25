/**
 * The localised failures a Server Action is allowed to return.
 *
 * These are *returned*, never thrown. Next redacts an error thrown out of a Server
 * Action in production — the customer would get "an error occurred" in place of the one
 * sentence that tells them what to do next. Only genuine bugs are left to throw, where
 * `useAsyncAction` turns them into a generic message and the button un-sticks.
 */
import { getT, type Lang } from '@/lib/i18n';
import { bookingDictionary } from '../dictionary';
import { fill, humaniseMinutes } from './format';
import { retryAfterMinutes } from './validate';
import type { ActionError } from './types';

function translate(lang: Lang) {
  return getT(lang, bookingDictionary);
}

export function invalidRequestError(lang: Lang): ActionError {
  return { ok: false, code: 'invalid_request', message: translate(lang)('booking.error.invalidRequest') };
}

export function notFoundError(lang: Lang): ActionError {
  return { ok: false, code: 'not_found', message: translate(lang)('booking.error.unavailable') };
}

/**
 * "Too many attempts, try again in N minutes" — and it says so in those words.
 *
 * Never a generic failure and never silence: a rejection that reads as "nothing is
 * available" is the specific bug this string exists to prevent, because a shared office
 * IP hitting the limit then looks exactly like a business that is closed.
 */
export function rateLimitedError(lang: Lang, retryAfterMs: number): ActionError {
  const minutes = retryAfterMinutes(retryAfterMs);
  return {
    ok: false,
    code: 'rate_limited',
    message: fill(translate(lang)('booking.error.rateLimited'), {
      wait: humaniseMinutes(minutes, lang),
    }),
  };
}

export function slotTakenError(lang: Lang): ActionError {
  return { ok: false, code: 'slot_taken', message: translate(lang)('booking.error.slotTaken') };
}

export function unexpectedError(lang: Lang): ActionError {
  return { ok: false, code: 'unexpected', message: translate(lang)('booking.error.generic') };
}

/**
 * A blocked customer sees `CustomerBlockedError`'s own message, verbatim.
 *
 * It says to contact the business and nothing else, by design: someone told they are
 * blocked simply books again from a different number, while someone asked to call gets
 * handled by a human — which is what the owner actually wanted. Do not localise this
 * into something more specific, and do not add a reason.
 */
export function blockedError(message: string): ActionError {
  return { ok: false, code: 'blocked', message };
}

export function fieldError(
  lang: Lang,
  field: NonNullable<ActionError['field']>,
  key: string,
): ActionError {
  return { ok: false, code: 'invalid_request', message: translate(lang)(key), field };
}

export function tooLateToCancelError(
  lang: Lang,
  businessName: string,
  windowMinutes: number,
): ActionError {
  return {
    ok: false,
    code: 'too_late_to_cancel',
    message: fill(translate(lang)('manage.cancel.tooLate.body'), {
      business: businessName,
      window: humaniseMinutes(windowMinutes, lang),
    }),
  };
}
