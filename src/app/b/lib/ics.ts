/**
 * A minimal RFC 5545 (iCalendar) writer for a single appointment.
 *
 * Hand-written on purpose: there is no ics library in this project's dependencies and
 * one appointment needs perhaps forty lines of the specification. The parts that
 * actually bite are all here and all tested:
 *
 *  - **UID is deterministic** — `booking-<id>@torim`. An appointment that is rescheduled
 *    and re-downloaded must *update* the entry already in the customer's calendar, not
 *    add a second one next to it. A random UID per download guarantees duplicates, and
 *    the customer has no way to tell which of the two is real.
 *  - **DTSTART/DTEND are absolute UTC** (`…Z`). The business timezone is respected
 *    because the instants themselves were produced from the business's wall clock by
 *    `@/lib/time`; emitting them as UTC means no VTIMEZONE block has to be shipped and
 *    no calendar client has to agree with us about what `Asia/Jerusalem` meant last
 *    March.
 *  - **Text is escaped** — a service called `Cut, colour; blow-dry` contains two of the
 *    four characters that terminate a property value.
 *  - **Lines are folded at 75 octets**, counted in UTF-8 bytes and never mid-character.
 *    A Hebrew service name is two bytes per letter, so a name that looks short is not.
 *    Google Calendar rejects the file outright if a fold splits a code point.
 */

const CRLF = '\r\n';

/** Value-type-safe UID for a booking. Stable for the life of the booking. */
export function bookingUid(bookingId: string): string {
  return `booking-${bookingId}@torim`;
}

/** `20260827T070000Z`. Always UTC — the trailing Z is part of the contract. */
export function formatIcsUtc(instant: Date): string {
  const iso = instant.toISOString(); // 2026-08-27T07:00:00.000Z
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
}

/**
 * Escape a TEXT value: backslash, semicolon and comma are escaped; newlines become the
 * literal two-character sequence `\n`. Carriage returns are dropped rather than escaped,
 * because a lone CR inside a value is what breaks folding.
 */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n?/g, '\n')
    .replace(/\n/g, '\\n');
}

const encoder = new TextEncoder();

/**
 * Fold one content line to 75 octets per RFC 5545 §3.1, continuing with CRLF + a single
 * space. Byte-aware: a multi-byte character is never split across the fold.
 */
export function foldIcsLine(line: string): string {
  const bytes = encoder.encode(line);
  if (bytes.length <= 75) return line;

  const pieces: string[] = [];
  let current = '';
  let currentBytes = 0;
  // 75 for the first line; continuations spend one octet on the leading space.
  let budget = 75;

  for (const char of line) {
    const size = encoder.encode(char).length;
    if (currentBytes + size > budget) {
      pieces.push(current);
      current = '';
      currentBytes = 0;
      budget = 74;
    }
    current += char;
    currentBytes += size;
  }
  if (current.length > 0) pieces.push(current);

  return pieces.join(`${CRLF} `);
}

export type IcsEvent = {
  /** Already in `booking-<id>@torim` form — see `bookingUid`. */
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  description?: string;
  location?: string;
  /** IANA zone of the business. Emitted as a hint only; the times themselves are UTC. */
  timezone?: string;
  status?: 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED';
  url?: string;
  /**
   * When this file was produced. Injected so tests are deterministic; defaults to now.
   */
  stamp?: Date;
  /**
   * Bumped when the appointment is edited. A calendar client ignores an update whose
   * SEQUENCE has not advanced, so a rescheduled booking that keeps SEQUENCE 0 silently
   * leaves the old time in the customer's calendar.
   */
  sequence?: number;
};

/**
 * Serialise one VEVENT inside a VCALENDAR. Returns the complete file contents, CRLF
 * terminated.
 */
export function buildIcs(event: IcsEvent): string {
  const stamp = event.stamp ?? new Date();

  if (!(event.start instanceof Date) || Number.isNaN(event.start.getTime())) {
    throw new Error('ics: start must be a valid Date');
  }
  if (!(event.end instanceof Date) || Number.isNaN(event.end.getTime())) {
    throw new Error('ics: end must be a valid Date');
  }
  if (event.end.getTime() <= event.start.getTime()) {
    throw new Error('ics: end must be after start');
  }

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Torim//Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  if (event.timezone) {
    lines.push(`X-WR-TIMEZONE:${escapeIcsText(event.timezone)}`);
  }

  lines.push(
    'BEGIN:VEVENT',
    `UID:${escapeIcsText(event.uid)}`,
    `DTSTAMP:${formatIcsUtc(stamp)}`,
    `DTSTART:${formatIcsUtc(event.start)}`,
    `DTEND:${formatIcsUtc(event.end)}`,
    `SUMMARY:${escapeIcsText(event.summary)}`,
  );

  if (event.description) lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
  if (event.location) lines.push(`LOCATION:${escapeIcsText(event.location)}`);
  if (event.url) lines.push(`URL:${escapeIcsText(event.url)}`);

  lines.push(
    `STATUS:${event.status ?? 'CONFIRMED'}`,
    `SEQUENCE:${event.sequence ?? 0}`,
    'TRANSP:OPAQUE',
    'END:VEVENT',
    'END:VCALENDAR',
  );

  return `${lines.map(foldIcsLine).join(CRLF)}${CRLF}`;
}

/**
 * A safe `filename=` for the Content-Disposition header.
 *
 * ASCII only, and no quote, backslash, semicolon, slash or control character can survive
 * — those are what let a crafted service name break out of the header value.
 */
export function icsFilename(label: string): string {
  const ascii = label
    .normalize('NFKD')
    // Everything outside printable ASCII goes, which covers control characters, CR/LF
    // header injection and the whole of Hebrew.
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${ascii.length > 0 ? ascii : 'appointment'}.ics`;
}
