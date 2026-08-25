'use server';

/**
 * The service catalogue.
 *
 * The one rule with teeth: **retiring a service must not disturb existing bookings.**
 * It cannot, structurally — `torim.bookings` snapshots its own `price_minor` and buffers
 * at creation — so retiring is a plain `active = false` and nothing cascades. A hard
 * delete is offered too, but the schema's `ON DELETE RESTRICT` stops it the moment the
 * service has ever been booked, and that refusal is turned into "retire it instead"
 * rather than a 500.
 */
import { refresh } from 'next/cache';
import {
  adminAction,
  fail,
  failValidation,
  succeed,
} from '../action-helpers';
import { DEFAULT_SERVICE_COLOUR, isServiceColour } from '../colours';
import {
  createService,
  deleteService,
  getAdminService,
  moveService,
  setServiceActive,
  updateService,
  type ServiceInput,
} from '../data';
import { parseMoneyToMinor } from '../format';
import type { ActionResult, ServiceFormInput } from '../types';
import { boundedInt, optionalText, requiredText } from '../validation';

export async function saveServiceAction(input: ServiceFormInput): Promise<ActionResult<null>> {
  const result = await adminAction<null>('manage_services', 'svc.error.', async (context) => {
    const name = requiredText(input.name, 'name', 'name_required', 120);
    if (!name.ok) return failValidation(context, name);

    const duration = boundedInt(input.durationMin, 'durationMin', 'duration_range', 1, 1440);
    if (!duration.ok) return failValidation(context, duration);

    const priceMinor = parseMoneyToMinor(input.price, context.business.currency);
    if (priceMinor === null) return fail(context, 'price_invalid', 'price');

    const bufferBefore = boundedInt(
      input.bufferBeforeMin,
      'bufferBeforeMin',
      'buffer_range',
      0,
      240,
    );
    if (!bufferBefore.ok) return failValidation(context, bufferBefore);

    const bufferAfter = boundedInt(input.bufferAfterMin, 'bufferAfterMin', 'buffer_range', 0, 240);
    if (!bufferAfter.ok) return failValidation(context, bufferAfter);

    const service: ServiceInput = {
      name: name.value,
      nameHe: optionalText(input.nameHe, 120),
      description: optionalText(input.description, 500),
      durationMin: duration.value,
      priceMinor,
      bufferBeforeMin: bufferBefore.value,
      bufferAfterMin: bufferAfter.value,
      colour: isServiceColour(input.colour) ? input.colour : DEFAULT_SERVICE_COLOUR,
      active: input.active,
    };

    if (input.id) {
      const changed = await updateService(input.id, service);
      if (!changed) return fail(context, 'not_found');
    } else {
      await createService(service);
    }

    return succeed(null);
  });

  if (result.ok) refresh();
  return result;
}

/** Retire or restore. Existing appointments keep their own price, buffers and timing. */
export async function setServiceActiveAction(
  id: string,
  active: boolean,
): Promise<ActionResult<null>> {
  const result = await adminAction<null>('manage_services', 'svc.error.', async (context) => {
    const changed = await setServiceActive(id, active);
    if (!changed) return fail(context, 'not_found');
    return succeed(null);
  });

  if (result.ok) refresh();
  return result;
}

export async function deleteServiceAction(id: string): Promise<ActionResult<null>> {
  const result = await adminAction<null>('manage_services', 'svc.error.', async (context) => {
    const existing = await getAdminService(id);
    if (!existing) return fail(context, 'not_found');
    // A foreign-key violation from a booking that still references this service is
    // mapped to 'in_use' centrally, which reads as "retire it instead".
    await deleteService(id);
    return succeed(null);
  });

  if (result.ok) refresh();
  return result;
}

export async function moveServiceAction(
  id: string,
  direction: -1 | 1,
): Promise<ActionResult<null>> {
  const result = await adminAction<null>('manage_services', 'svc.error.', async (context) => {
    const moved = await moveService(id, direction === -1 ? -1 : 1);
    if (!moved) return fail(context, 'not_found');
    return succeed(null);
  });

  if (result.ok) refresh();
  return result;
}
