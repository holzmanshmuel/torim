'use server';

/**
 * Opening hours, closed dates and one-off hours.
 *
 * Every range on this screen goes through the SAME `parseTimeRange`, which refuses an
 * end that is not strictly after its start. That is the whole point: the predecessor
 * shipped two independent time pickers with no cross-check and persisted a closure that
 * blocked zero minutes, so customers booked straight through hours the owner believed
 * were shut and nothing errored — not in the form, not in the database, not in a log.
 *
 * The schema's CHECK constraints are the same rule again, one layer down. When one of
 * them fires (a direct POST, a future code path) `dbErrorCode` maps it back to the very
 * same `end_not_after_start` message the form would have shown.
 */
import { refresh } from 'next/cache';
import { adminAction, fail, failValidation, succeed } from '../action-helpers';
import {
  addClosure,
  addDateOverride,
  addWorkingHours,
  deleteClosure,
  deleteDateOverride,
  deleteWorkingHours,
  listWorkingHours,
} from '../data';
import type {
  ActionResult,
  ClosureFormInput,
  HoursFormInput,
  OverrideFormInput,
} from '../types';
import {
  boundedInt,
  isDateKey,
  optionalText,
  overlapsExisting,
  parseTimeRange,
} from '../validation';

export async function addWorkingHoursAction(
  input: HoursFormInput,
): Promise<ActionResult<null>> {
  const result = await adminAction<null>('manage_working_hours', 'hrs.error.', async (context) => {
    const weekday = boundedInt(input.weekday, 'weekday', 'weekday_required', 0, 6);
    if (!weekday.ok) return failValidation(context, weekday);

    const range = parseTimeRange(input.start, input.end, { start: 'start', end: 'end' });
    if (!range.ok) return failValidation(context, range);

    // Two rows on one weekday are how a break is expressed, so they may touch but must
    // not overlap — overlapping rows would make the same minute open twice over.
    const existing = (await listWorkingHours()).filter((row) => row.weekday === weekday.value);
    if (overlapsExisting(range.value, existing)) return fail(context, 'overlaps', 'start');

    await addWorkingHours(weekday.value, range.value.startMin, range.value.endMin);
    return succeed(null);
  });

  if (result.ok) refresh();
  return result;
}

export async function deleteWorkingHoursAction(id: string): Promise<ActionResult<null>> {
  const result = await adminAction<null>('manage_working_hours', 'hrs.error.', async (context) => {
    const removed = await deleteWorkingHours(id);
    if (!removed) return fail(context, 'not_found');
    return succeed(null);
  });

  if (result.ok) refresh();
  return result;
}

export async function addClosureAction(input: ClosureFormInput): Promise<ActionResult<null>> {
  const result = await adminAction<null>('manage_working_hours', 'hrs.error.', async (context) => {
    if (!input.date) return fail(context, 'date_required', 'date');
    if (!isDateKey(input.date)) return fail(context, 'date_shape', 'date');

    if (input.wholeDay) {
      await addClosure({
        onDate: input.date,
        startMin: null,
        endMin: null,
        label: optionalText(input.label, 120),
      });
      return succeed(null);
    }

    const range = parseTimeRange(input.start, input.end, { start: 'start', end: 'end' });
    if (!range.ok) return failValidation(context, range);

    await addClosure({
      onDate: input.date,
      startMin: range.value.startMin,
      endMin: range.value.endMin,
      label: optionalText(input.label, 120),
    });
    return succeed(null);
  });

  if (result.ok) refresh();
  return result;
}

export async function deleteClosureAction(id: string): Promise<ActionResult<null>> {
  const result = await adminAction<null>('manage_working_hours', 'hrs.error.', async (context) => {
    const removed = await deleteClosure(id);
    if (!removed) return fail(context, 'not_found');
    return succeed(null);
  });

  if (result.ok) refresh();
  return result;
}

/**
 * One-off hours for a single date. These REPLACE the weekly template for that date
 * rather than adding to it — shortening one day is far more common than extending one,
 * and merging would make "open 14:00–17:00 today instead of the usual 09:00–17:00"
 * impossible to say at all.
 */
export async function addDateOverrideAction(
  input: OverrideFormInput,
): Promise<ActionResult<null>> {
  const result = await adminAction<null>('manage_working_hours', 'hrs.error.', async (context) => {
    if (!input.date) return fail(context, 'date_required', 'date');
    if (!isDateKey(input.date)) return fail(context, 'date_shape', 'date');

    const range = parseTimeRange(input.start, input.end, { start: 'start', end: 'end' });
    if (!range.ok) return failValidation(context, range);

    await addDateOverride({
      onDate: input.date,
      startMin: range.value.startMin,
      endMin: range.value.endMin,
      label: optionalText(input.label, 120),
    });
    return succeed(null);
  });

  if (result.ok) refresh();
  return result;
}

export async function deleteDateOverrideAction(id: string): Promise<ActionResult<null>> {
  const result = await adminAction<null>('manage_working_hours', 'hrs.error.', async (context) => {
    const removed = await deleteDateOverride(id);
    if (!removed) return fail(context, 'not_found');
    return succeed(null);
  });

  if (result.ok) refresh();
  return result;
}
