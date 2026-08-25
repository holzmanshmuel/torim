'use server';

/**
 * Creating the first business.
 *
 * This runs in the one window where no tenant exists yet: signed in, no membership,
 * nothing to scope to. So it does NOT go through `adminAction` — there is no tenant to
 * enter and no permission to check beyond "is this a signed-in user". The actual
 * cross-tenant write is confined to `create_business_with_owner`, a SECURITY DEFINER
 * function that is the app role's only cross-tenant capability; doing the two INSERTs
 * here instead would mean granting an ambient RLS bypass to the whole application.
 */
import { getSession } from '@/lib/auth';
import { createBusinessWithOwner } from '@/lib/users';
import { getLang, getT } from '@/lib/i18n';
import { adminDictionary } from '@/app/admin/dictionary';
import { applyOnboardingExtras } from '@/app/admin/data';
import { messageFor } from '@/app/admin/action-helpers';
import type { ActionResult, OnboardingFormInput } from '@/app/admin/types';
import {
  CALLING_CODE_SHAPE,
  CURRENCY_SHAPE,
  SLUG_SHAPE,
  dbErrorCode,
  isTimezone,
  requiredText,
} from '@/app/admin/validation';

const PREFIX = 'onb.error.';

/** Which field a database refusal belongs to, so the message lands on the right input. */
const FIELD_FOR_CODE: Record<string, string> = {
  slug_taken: 'slug',
  slug_shape: 'slug',
  currency_shape: 'currency',
  calling_code_shape: 'defaultCallingCode',
  name_required: 'name',
};

export async function createBusinessAction(
  input: OnboardingFormInput,
): Promise<ActionResult<{ businessId: string }>> {
  const lang = await getLang();
  const t = getT(lang, adminDictionary);

  const fail = (code: string, field?: string): ActionResult<never> => ({
    ok: false,
    code,
    message: messageFor(t, PREFIX, code),
    ...(field ?? FIELD_FOR_CODE[code] ? { field: field ?? FIELD_FOR_CODE[code] } : {}),
  });

  const session = await getSession();
  if (!session.userId) {
    // Not signed in at all. The page itself redirects, so this is the direct-POST path.
    return { ok: false, code: 'not_signed_in', message: t('a.somethingWentWrong') };
  }
  if (session.businessId) {
    // Already onboarded — creating a second business from this form would orphan the
    // first in the session and is not what the button says it does.
    return { ok: true, value: { businessId: session.businessId } };
  }

  const name = requiredText(input.name, 'name', 'name_required', 120);
  if (!name.ok) return fail(name.code, name.field);

  const slug = input.slug.trim().toLowerCase();
  if (slug.length === 0) return fail('slug_required', 'slug');
  if (!SLUG_SHAPE.test(slug)) return fail('slug_shape', 'slug');

  if (!isTimezone(input.timezone)) return fail('timezone_invalid', 'timezone');

  const currency = input.currency.trim().toUpperCase();
  if (!CURRENCY_SHAPE.test(currency)) return fail('currency_shape', 'currency');

  const callingCodeRaw = input.defaultCallingCode.trim().replace(/^\+/, '');
  if (callingCodeRaw.length > 0 && !CALLING_CODE_SHAPE.test(callingCodeRaw)) {
    return fail('calling_code_shape', 'defaultCallingCode');
  }

  let businessId: string;
  try {
    businessId = await createBusinessWithOwner({
      userId: session.userId,
      slug,
      name: name.value,
      timezone: input.timezone,
      currency,
    });
  } catch (err) {
    // A taken slug is the common one, and it is a field message, not a 500.
    const code = dbErrorCode(err);
    if (code) return fail(code);
    console.error('[onboarding] failed to create business', err);
    return { ok: false, code: 'unexpected', message: t('a.somethingWentWrong') };
  }

  // The two columns `create_business_with_owner` does not take. The id is the one the
  // function just returned — never anything the caller supplied — which is what makes a
  // write to the policy-free businesses table safe here.
  await applyOnboardingExtras(businessId, {
    defaultCallingCode: callingCodeRaw.length > 0 ? callingCodeRaw : null,
    defaultLocale: input.defaultLocale === 'he' ? 'he' : 'en',
  });

  // Only now does the session gain a tenant. The client navigates on the result rather
  // than this redirecting, so a failed navigation still leaves a usable page behind.
  session.businessId = businessId;
  session.role = 'owner';
  await session.save();

  return { ok: true, value: { businessId } };
}
