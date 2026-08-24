/**
 * RTL safety helpers.
 *
 * A Hebrew (RTL) sentence with an embedded LTR run - a date range, a time range, a
 * price, a phone number - renders with that run's internal order scrambled unless the
 * run is explicitly isolated. Without this, "19.7 - 13.7" can display as "13.7 - 19.7"
 * inside Hebrew text, and "12:00-10:00" can silently swap start/end. This is a class of
 * bug, not a one-off: every place user-facing text mixes scripts needs it, so it lives
 * here once rather than being solved per-screen.
 *
 * All control characters below are written as \u escapes deliberately, never as literal
 * characters: they are invisible, and pasting them verbatim into source would leave
 * undetectable formatting characters in the codebase (the same class of risk as a
 * "Trojan Source" attack).
 */

/** U+2068 FIRST STRONG ISOLATE */
const FSI = '\u2068';
/** U+2069 POP DIRECTIONAL ISOLATE */
const PDI = '\u2069';

/**
 * Wraps `text` in Unicode isolate marks so its internal (LTR) character order is
 * preserved when rendered inside an RTL context. Use this around any embedded date
 * range, time range, price, or phone number placed inside Hebrew text.
 */
export function isolate(text: string): string {
  return `${FSI}${text}${PDI}`;
}

/**
 * Bidi override/embedding control characters:
 *  - U+202A-U+202E: LRE, RLE, PDF, LRO, RLO
 *  - U+2066-U+2069: LRI, RLI, FSI, PDI
 *  - U+200E-U+200F: LRM, RLM
 */
const BIDI_CONTROL_RE = /[\u202A-\u202E\u2066-\u2069\u200E\u200F]/g;

/**
 * Strips bidi override/embedding characters from user-supplied strings. Run this on
 * write for any free-text field (customer name, note, etc.) - an unstripped override
 * character can silently reorder how the value renders elsewhere (the admin list, a
 * printed label, an exported calendar feed), independent of what isolate() does for
 * values this codebase itself composes.
 */
export function stripBidiControls(input: string): string {
  return input.replace(BIDI_CONTROL_RE, '');
}
