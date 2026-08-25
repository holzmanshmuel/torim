'use server';

/**
 * The owner's customer list.
 *
 * Blocking is deliberately narrow: it stops a customer booking *online* and does
 * nothing else. Existing appointments are untouched, and the owner can still book that
 * person herself from the day view — the block is an abuse control, not a deletion, and
 * a customer who is told they are blocked simply books from another number.
 */
import { refresh } from 'next/cache';
import { getCustomer, renameCustomer, setCustomerBlocked, setCustomerNotes } from '@/lib/customers';
import { adminAction, fail, failValidation, succeed } from '../action-helpers';
import type { ActionResult } from '../types';
import { optionalText, requiredText } from '../validation';

export async function renameCustomerAction(
  id: string,
  name: string,
): Promise<ActionResult<null>> {
  const result = await adminAction<null>('manage_customers', 'cus.error.', async (context) => {
    // RLS makes another business's id a miss here, so this is the tenant check too.
    const existing = await getCustomer(id);
    if (!existing) return fail(context, 'not_found');

    const cleaned = requiredText(name, 'name', 'name_required', 120);
    if (!cleaned.ok) return failValidation(context, cleaned);

    await renameCustomer(id, cleaned.value);
    return succeed(null);
  });

  if (result.ok) refresh();
  return result;
}

export async function setCustomerBlockedAction(
  id: string,
  blocked: boolean,
): Promise<ActionResult<null>> {
  const result = await adminAction<null>('manage_customers', 'cus.error.', async (context) => {
    const existing = await getCustomer(id);
    if (!existing) return fail(context, 'not_found');

    await setCustomerBlocked(id, blocked);
    return succeed(null);
  });

  if (result.ok) refresh();
  return result;
}

/** Private to the owner — this text is never shown to the customer anywhere. */
export async function saveCustomerNotesAction(
  id: string,
  notes: string,
): Promise<ActionResult<null>> {
  const result = await adminAction<null>('manage_customers', 'cus.error.', async (context) => {
    const existing = await getCustomer(id);
    if (!existing) return fail(context, 'not_found');

    await setCustomerNotes(id, optionalText(notes, 2000));
    return succeed(null);
  });

  if (result.ok) refresh();
  return result;
}
