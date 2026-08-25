'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Field, Select, useLang } from '@/app/components';
import { getT } from '@/lib/i18n';
import { Banner } from '@/app/admin/_components/Banner';
import { useAdminAction } from '@/app/admin/_components/useAdminAction';
import { adminDictionary } from '@/app/admin/dictionary';
import { slugify } from '@/app/admin/validation';
import { createBusinessAction } from './actions';

const TIMEZONES = [
  'Asia/Jerusalem',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Rome',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Toronto',
  'Asia/Dubai',
  'Australia/Sydney',
  'UTC',
];

const CURRENCIES = ['ILS', 'USD', 'EUR', 'GBP', 'AUD', 'CAD'];

/**
 * First run: name the business, choose where it is, and go.
 *
 * The booking link is derived from the name as it is typed, but stops following it the
 * moment the owner edits it herself — a slug that silently rewrites itself after being
 * chosen is how someone ends up publishing a link they never meant to.
 *
 * There is no timezone default beyond the field: every slot calculation runs in
 * business-local time, and a silently-defaulted zone is a booking system that is quietly
 * an hour or three wrong and never errors.
 */
export function OnboardingForm({ defaultTimezone }: { defaultTimezone: string }) {
  const { lang } = useLang();
  const t = getT(lang, adminDictionary);
  const router = useRouter();

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [timezone, setTimezone] = useState(
    TIMEZONES.includes(defaultTimezone) ? defaultTimezone : 'Asia/Jerusalem',
  );
  const [currency, setCurrency] = useState('ILS');
  const [callingCode, setCallingCode] = useState('972');
  const [locale, setLocale] = useState<'en' | 'he'>(lang);

  const create = useAdminAction(createBusinessAction, {
    lang,
    onSuccess: () => {
      // Navigate on the result rather than redirecting from the action: the session now
      // carries the new tenant, and a client navigation makes the failure mode "still on
      // a working page" instead of a half-applied redirect.
      router.replace('/admin');
      router.refresh();
    },
  });

  function changeName(value: string) {
    setName(value);
    if (!slugTouched) setSlug(slugify(value));
  }

  return (
    <div className="flex flex-col gap-5">
      {create.error && !create.failure?.field ? (
        <Banner tone="danger">{create.error}</Banner>
      ) : null}

      <Field
        label={t('onb.name')}
        hint={t('onb.nameHint')}
        value={name}
        onChange={(event) => changeName(event.target.value)}
        error={create.fieldError('name')}
        required
      />

      <Field
        label={t('onb.slug')}
        hint={t('onb.slugHint')}
        value={slug}
        dir="ltr"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        onChange={(event) => {
          setSlugTouched(true);
          setSlug(event.target.value);
        }}
        error={create.fieldError('slug')}
        required
      />

      <Select
        label={t('onb.timezone')}
        hint={t('onb.timezoneHint')}
        value={timezone}
        onChange={(event) => setTimezone(event.target.value)}
        options={TIMEZONES.map((value) => ({ value, label: value }))}
        error={create.fieldError('timezone')}
      />

      <Select
        label={t('onb.currency')}
        value={currency}
        onChange={(event) => setCurrency(event.target.value)}
        options={CURRENCIES.map((value) => ({ value, label: value }))}
        error={create.fieldError('currency')}
      />

      <Field
        label={t('onb.callingCode')}
        hint={t('onb.callingCodeHint')}
        inputMode="numeric"
        dir="ltr"
        value={callingCode}
        onChange={(event) => setCallingCode(event.target.value)}
        error={create.fieldError('defaultCallingCode')}
      />

      <Select
        label={t('onb.locale')}
        value={locale}
        onChange={(event) => setLocale(event.target.value === 'he' ? 'he' : 'en')}
        options={[
          { value: 'en', label: 'English' },
          { value: 'he', label: 'עברית' },
        ]}
      />

      <Button
        size="lg"
        loading={create.pending}
        onClick={() =>
          void create.run({
            name,
            slug,
            timezone,
            currency,
            defaultCallingCode: callingCode,
            defaultLocale: locale,
          })
        }
      >
        {create.pending ? t('onb.creating') : t('onb.submit')}
      </Button>
    </div>
  );
}
