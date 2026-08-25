/**
 * Phone numbers.
 *
 * Phone is the customer's identity in Torim — there is no account — so normalisation is
 * an identity concern, not a formatting one. "050-123-4567" and "+972 50 123 4567" must
 * resolve to the same person, or a returning customer silently becomes a second record
 * and her history disappears.
 *
 * Everything is stored E.164, matching the CHECK constraint on torim.customers.
 */
import { stripBidiControls } from './bidi';

/** Same shape the database enforces: + then 7–15 digits, first digit non-zero. */
const E164 = /^\+[1-9][0-9]{6,14}$/;

/** Shortest national subscriber number we will accept when we supply the country code. */
const MIN_NATIONAL_DIGITS = 6;

export class InvalidPhoneError extends Error {
  readonly input: string;

  constructor(input: string, reason: string) {
    super(`Not a usable phone number (${reason}).`);
    this.name = 'InvalidPhoneError';
    this.input = input;
  }
}

export function isE164(value: string): boolean {
  return E164.test(value);
}

/**
 * Normalise user input to E.164.
 *
 * `defaultCallingCode` is the business's country code without the plus (e.g. '972').
 * A local number is only resolvable against one; with no country code and no default,
 * this throws rather than guessing — a wrong guess produces a valid-looking number that
 * belongs to a stranger.
 */
export function normalisePhone(input: string, defaultCallingCode: string): string {
  const cleaned = stripBidiControls(input).replace(/[\s().-]/g, '').trim();

  if (cleaned.length === 0) {
    throw new InvalidPhoneError(input, 'empty');
  }
  if (/[^+\d]/.test(cleaned)) {
    throw new InvalidPhoneError(input, 'contains characters that are not digits');
  }

  let candidate: string;
  if (cleaned.startsWith('+')) {
    candidate = cleaned;
  } else if (cleaned.startsWith('00')) {
    // International dialling prefix in most of the world.
    candidate = `+${cleaned.slice(2)}`;
  } else {
    const code = defaultCallingCode.replace(/\D/g, '');
    if (!code) {
      throw new InvalidPhoneError(input, 'no country code, and the business has no default');
    }
    // A national trunk prefix (the leading 0) is dropped when the country code is added.
    const national = cleaned.replace(/^0+/, '');

    // We only get to check this when the caller typed a national number and we supplied
    // the country code — then we know where the country code ends. A number shorter than
    // this is a typo, and a typo'd phone means the business simply cannot reach the
    // customer. (Given a full international number we accept any structurally valid
    // E.164: without a country-code table we do not actually know where the national
    // part begins, and pretending otherwise would reject real numbers.)
    if (national.length < MIN_NATIONAL_DIGITS) {
      throw new InvalidPhoneError(input, 'too short to be a real number');
    }
    candidate = `+${code}${national}`;
  }

  if (!isE164(candidate)) {
    throw new InvalidPhoneError(input, 'not a valid international number');
  }
  return candidate;
}

/**
 * A wa.me deep link that opens the sender's own WhatsApp with the message prefilled.
 *
 * This is Torim's default notification channel: it costs nothing per message and needs
 * no sender-ID registration. See the notifications design note — the automated transport
 * is optional, this is not.
 */
export function waMeLink(e164: string, message: string): string {
  if (!isE164(e164)) {
    throw new InvalidPhoneError(e164, 'must be E.164 before building a wa.me link');
  }
  return `https://wa.me/${e164.slice(1)}?text=${encodeURIComponent(message)}`;
}
