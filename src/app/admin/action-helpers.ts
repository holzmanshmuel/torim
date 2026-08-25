/**
 * The single funnel every admin Server Action goes through.
 *
 * A Server Function is reachable by direct POST — not only through the UI that renders
 * its button — so authentication, authorisation and tenant scope are re-established
 * here on every call rather than assumed from the page that rendered the form. The
 * proxy's cookie gate is a bouncer, not the lock.
 *
 * It also gives every action the same three properties for free:
 *
 *  - **Nothing throws at the client.** Actions return a discriminated result, so the
 *    caller can attach a message to a field or branch on a conflict, instead of
 *    catching a stringified server error.
 *  - **Database refusals become field messages.** A CHECK or UNIQUE violation is mapped
 *    by `dbErrorCode` and looked up in this screen's own error namespace, so the last
 *    line of defence surfaces as "The end time has to be after the start time" rather
 *    than a 500.
 *  - **Domain errors keep their meaning.** "That appointment hasn't finished yet" is a
 *    thing the owner needs told, not an internal error.
 *
 * Note the guard runs OUTSIDE the try: `redirect()` signals by throwing, and swallowing
 * it would turn a bounce to /login into a blank screen.
 */
import type { Action, AuthContext } from '@/lib/auth';
import {
  BookingConflictError,
  BookingNotFinishedError,
  BookingNotFoundError,
  CancellationTooLateError,
} from '@/lib/booking';
import { findBusinessById, type PublicBusiness } from '@/lib/businesses';
import { getLang, getT, type Lang } from '@/lib/i18n';
import { InvalidPhoneError } from '@/lib/phone';
import { SlotNotAvailableError } from '@/lib/public-booking';
import { adminDictionary } from './dictionary';
import { guard } from './guard';
import { runWithTenant } from '@/lib/tenant';
import type { ActionErr, ActionResult, ClashInfo } from './types';
import { dbErrorCode, type Invalid } from './validation';

export type AdminActionContext = {
  auth: AuthContext;
  /** The language the owner is reading in. */
  lang: Lang;
  t: (key: string) => string;
  business: PublicBusiness;
  /** Dictionary namespace for this screen's field errors, e.g. 'hrs.error.'. */
  prefix: string;
};

/**
 * Look a code up in this screen's error namespace, falling back to the generic message.
 * `getT` returns the key itself when a translation is missing, which is the signal that
 * this code has no wording of its own yet — showing the raw key to a shop owner would
 * be worse than a plain sentence.
 */
export function messageFor(t: (key: string) => string, prefix: string, code: string): string {
  const key = `${prefix}${code}`;
  const text = t(key);
  return text === key ? t('a.somethingWentWrong') : text;
}

export function fail(
  context: Pick<AdminActionContext, 't' | 'prefix'>,
  code: string,
  field?: string,
): ActionErr {
  return {
    ok: false,
    code,
    message: messageFor(context.t, context.prefix, code),
    ...(field ? { field } : {}),
  };
}

/** Turn a `Validated` rejection from `./validation` straight into an action failure. */
export function failValidation(
  context: Pick<AdminActionContext, 't' | 'prefix'>,
  result: Invalid,
): ActionErr {
  return fail(context, result.code, result.field);
}

export function succeed<T>(value: T): ActionResult<T> {
  return { ok: true, value };
}

export function clashError(
  context: Pick<AdminActionContext, 't' | 'prefix'>,
  clash: ClashInfo,
): ActionErr {
  return {
    ok: false,
    code: 'conflict',
    message: context.t('clash.title'),
    clash,
  };
}

/** Domain errors that are the owner's business, mapped to this screen's wording. */
function domainErrorCode(err: unknown): string | null {
  if (err instanceof BookingNotFinishedError) return 'not_finished';
  if (err instanceof BookingNotFoundError) return 'not_found';
  if (err instanceof CancellationTooLateError) return 'too_late';
  if (err instanceof SlotNotAvailableError) return 'slot_unavailable';
  if (err instanceof InvalidPhoneError) return 'phone_invalid';
  // A conflict that reaches here was not handled where it could name what it clashed
  // with — still worth a real sentence rather than a generic failure.
  if (err instanceof BookingConflictError) return 'conflict';
  return null;
}

function fieldFor(code: string): string | undefined {
  return code === 'phone_invalid' ? 'phone' : undefined;
}

export async function adminAction<T>(
  permission: Action,
  prefix: string,
  fn: (context: AdminActionContext) => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  // Outside the try on purpose — see the file comment.
  const auth = await guard(permission);

  return runWithTenant(auth.businessId, async () => {
    const lang = await getLang();
    const t = getT(lang, adminDictionary);
    const business = await findBusinessById(auth.businessId);

    if (!business) {
      // The membership resolved but the business did not: the tenant was deleted under
      // this session. Fail loudly rather than writing into nothing.
      return { ok: false, code: 'no_business', message: t('a.somethingWentWrong') };
    }

    const context: AdminActionContext = { auth, lang, t, business, prefix };

    try {
      return await fn(context);
    } catch (err) {
      const domain = domainErrorCode(err);
      if (domain) {
        return fail(context, domain, fieldFor(domain));
      }

      const constraint = dbErrorCode(err);
      if (constraint) {
        return fail(context, constraint);
      }

      // Anything left is a bug or an outage. Log the detail server-side; show a sentence.
      console.error(`[admin] action failed (${prefix})`, err);
      return { ok: false, code: 'unexpected', message: t('a.somethingWentWrong') };
    }
  });
}
