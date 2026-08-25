/**
 * "Is this appointment inside opening hours?" — for the day view's badge only.
 *
 * The day view MUST render appointments outside opening hours: the predecessor hid them
 * because its list was hardcoded to the public booking window, so a 07:30 booking the
 * owner had entered herself simply did not appear. `listBookingsForDay` already returns
 * everything; this module exists purely so such a booking can be *labelled* rather than
 * filtered — the badge is a hint, never a filter.
 *
 * The window rule itself (a date override REPLACES the weekly template, then closures
 * are subtracted) lives in the booking engine and is re-exported here rather than
 * reimplemented. Two copies of schedule logic drift, and then the owner's day view
 * disagrees with what a customer can actually book. The tests in this file deliberately
 * stay pointed at the shared implementation — they pin the semantics the admin relies on.
 */
import { openWindowsForDate, type OpenWindow } from '@/lib/slots';
import type { Minutes } from '@/lib/time';

export type { OpenWindow, OpenWindowsInput } from '@/lib/slots';
export { openWindowsForDate };

/** Adjacent and overlapping windows joined, so a lunch-break split does not read as a gap. */
export function mergeWindows(windows: readonly OpenWindow[]): OpenWindow[] {
  const sorted = [...windows].sort((a, b) => a.startMin - b.startMin);
  const merged: OpenWindow[] = [];
  for (const window of sorted) {
    const last = merged[merged.length - 1];
    if (last && window.startMin <= last.endMin) {
      last.endMin = Math.max(last.endMin, window.endMin);
    } else {
      merged.push({ ...window });
    }
  }
  return merged;
}

/**
 * True when any part of [startMin, endMin) falls outside the open windows.
 *
 * Partly outside counts as outside: an appointment running past closing is exactly the
 * one the owner wants flagged, and calling it "inside" because it began on time is how
 * you end up not noticing.
 */
export function isOutsideOpeningHours(
  startMin: Minutes,
  endMin: Minutes,
  windows: readonly OpenWindow[],
): boolean {
  const merged = mergeWindows(windows);
  return !merged.some((w) => startMin >= w.startMin && endMin <= w.endMin);
}
