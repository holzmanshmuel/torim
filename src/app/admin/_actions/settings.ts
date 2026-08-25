'use server';

/**
 * Business settings.
 *
 * `torim.businesses` is the one table in the admin surface with no RLS policy under it —
 * it has to be readable before a tenant exists, so a customer opening a public link can
 * resolve a slug. That makes this the one write where a wrong id would genuinely reach
 * another business, so `updateBusinessSettings` accepts no id at all and reads the
 * tenant the guard established. There is nothing here to point at the wrong row.
 */
import { refresh } from 'next/cache';
import { isE164, normalisePhone } from '@/lib/phone';
import { adminAction, fail, failValidation, succeed } from '../action-helpers';
import { updateBusinessSettings } from '../data';
import type { ActionResult, SettingsFormInput } from '../types';
import {
  CALLING_CODE_SHAPE,
  CURRENCY_SHAPE,
  SLUG_SHAPE,
  boundedInt,
  isTimezone,
  optionalText,
  requiredText,
} from '../validation';

export async function saveSettingsAction(
  input: SettingsFormInput,
): Promise<ActionResult<null>> {
  const result = await adminAction<null>('manage_settings', 'set.error.', async (context) => {
    const name = requiredText(input.name, 'name', 'name_required', 120);
    if (!name.ok) return failValidation(context, name);

    const slug = input.slug.trim().toLowerCase();
    if (!SLUG_SHAPE.test(slug)) return fail(context, 'slug_shape', 'slug');

    if (!isTimezone(input.timezone)) return fail(context, 'timezone_invalid', 'timezone');

    const currency = input.currency.trim().toUpperCase();
    if (!CURRENCY_SHAPE.test(currency)) return fail(context, 'currency_shape', 'currency');

    const callingCodeRaw = input.defaultCallingCode.trim().replace(/^\+/, '');
    if (callingCodeRaw.length > 0 && !CALLING_CODE_SHAPE.test(callingCodeRaw)) {
      return fail(context, 'calling_code_shape', 'defaultCallingCode');
    }
    const defaultCallingCode = callingCodeRaw.length > 0 ? callingCodeRaw : null;

    // The owner's own number is stored E.164 like every other number in the system, so
    // the wa.me links built from it cannot be subtly different from the customers'.
    let ownerWhatsappPhone: string | null = null;
    const whatsappRaw = optionalText(input.ownerWhatsappPhone, 32);
    if (whatsappRaw) {
      // InvalidPhoneError is mapped centrally to 'phone_invalid'.
      const normalised = normalisePhone(whatsappRaw, defaultCallingCode ?? '');
      if (!isE164(normalised)) return fail(context, 'phone_invalid', 'ownerWhatsappPhone');
      ownerWhatsappPhone = normalised;
    }

    const slot = boundedInt(input.slotGranularityMin, 'slotGranularityMin', 'slot_range', 1, 240);
    if (!slot.ok) return failValidation(context, slot);

    const notice = boundedInt(input.minNoticeMin, 'minNoticeMin', 'notice_range', 0, 100_000);
    if (!notice.ok) return failValidation(context, notice);

    const advance = boundedInt(input.maxAdvanceDays, 'maxAdvanceDays', 'advance_range', 1, 730);
    if (!advance.ok) return failValidation(context, advance);

    const cancellation = boundedInt(
      input.cancellationWindowMin,
      'cancellationWindowMin',
      'cancel_range',
      0,
      100_000,
    );
    if (!cancellation.ok) return failValidation(context, cancellation);

    await updateBusinessSettings({
      name: name.value,
      nameHe: optionalText(input.nameHe, 120),
      slug,
      timezone: input.timezone,
      currency,
      defaultLocale: input.defaultLocale === 'he' ? 'he' : 'en',
      defaultCallingCode,
      ownerWhatsappPhone,
      slotGranularityMin: slot.value,
      minNoticeMin: notice.value,
      maxAdvanceDays: advance.value,
      cancellationWindowMin: cancellation.value,
      confirmNewCustomers: input.confirmNewCustomers === true,
    });

    return succeed(null);
  });

  if (result.ok) refresh();
  return result;
}
