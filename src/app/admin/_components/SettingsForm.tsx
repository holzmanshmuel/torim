'use client';

import { useState } from 'react';
import { Button, Field, Select, useLang } from '@/app/components';
import { getT } from '@/lib/i18n';
import { saveSettingsAction } from '../_actions/settings';
import { adminDictionary } from '../dictionary';
import type { SettingsFormInput } from '../types';
import { Banner } from './Banner';
import { useAdminAction } from './useAdminAction';

/** A short, editable list plus whatever the business is already set to. */
const COMMON_TIMEZONES = [
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

const COMMON_CURRENCIES = ['ILS', 'USD', 'EUR', 'GBP', 'AUD', 'CAD'];

function withCurrent(list: string[], current: string): string[] {
  return list.includes(current) ? list : [current, ...list];
}

/**
 * Business settings.
 *
 * Every numeric policy here is *configuration*, never a constant in the code — slot
 * spacing, minimum notice, booking horizon, cancellation cut-off. Two of them
 * (`minNotice`, `cancellationWindow`) restrain customers only; the owner is never
 * limited by them, which the hints say out loud so nobody has to guess.
 */
export function SettingsForm({ initial }: { initial: SettingsFormInput }) {
  const { lang } = useLang();
  const t = getT(lang, adminDictionary);

  const [form, setForm] = useState<SettingsFormInput>(initial);
  const [saved, setSaved] = useState(false);

  const save = useAdminAction(saveSettingsAction, {
    lang,
    onSuccess: () => setSaved(true),
  });

  function set<K extends keyof SettingsFormInput>(key: K, value: SettingsFormInput[K]) {
    setSaved(false);
    setForm((current) => ({ ...current, [key]: value }));
  }

  // Both are minutes. A customer allowed to book with less notice than the cancellation
  // cut-off can create a booking they immediately cannot cancel.
  const noticeShorterThanCancellation =
    Number(form.minNoticeMin) < Number(form.cancellationWindowMin);

  return (
    <div className="flex flex-col gap-6">
      {saved ? <Banner tone="success">{t('set.saved')}</Banner> : null}
      {save.error && !save.failure?.field ? <Banner tone="danger">{save.error}</Banner> : null}

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-lg font-semibold text-ink">{t('set.business')}</h2>

        <Field
          label={t('set.name')}
          value={form.name}
          onChange={(event) => set('name', event.target.value)}
          error={save.fieldError('name')}
          required
        />

        <Field
          label={`${t('set.nameHe')} (${t('a.optional')})`}
          value={form.nameHe}
          onChange={(event) => set('nameHe', event.target.value)}
          dir="rtl"
        />

        <Field
          label={t('set.slug')}
          value={form.slug}
          onChange={(event) => set('slug', event.target.value)}
          error={save.fieldError('slug')}
          required
        />

        <Select
          label={t('set.timezone')}
          value={form.timezone}
          onChange={(event) => set('timezone', event.target.value)}
          options={withCurrent(COMMON_TIMEZONES, form.timezone).map((value) => ({
            value,
            label: value,
          }))}
          error={save.fieldError('timezone')}
        />

        <Select
          label={t('set.currency')}
          value={form.currency}
          onChange={(event) => set('currency', event.target.value)}
          options={withCurrent(COMMON_CURRENCIES, form.currency).map((value) => ({
            value,
            label: value,
          }))}
          error={save.fieldError('currency')}
        />

        <Select
          label={t('set.locale')}
          value={form.defaultLocale}
          onChange={(event) => set('defaultLocale', event.target.value === 'he' ? 'he' : 'en')}
          options={[
            { value: 'en', label: 'English' },
            { value: 'he', label: 'עברית' },
          ]}
        />

        <Field
          label={t('set.callingCode')}
          inputMode="numeric"
          value={form.defaultCallingCode}
          onChange={(event) => set('defaultCallingCode', event.target.value)}
          error={save.fieldError('defaultCallingCode')}
        />

        <Field
          label={t('set.whatsapp')}
          hint={t('set.whatsappHint')}
          type="tel"
          inputMode="tel"
          value={form.ownerWhatsappPhone}
          onChange={(event) => set('ownerWhatsappPhone', event.target.value)}
          error={save.fieldError('ownerWhatsappPhone') ?? save.fieldError('phone')}
        />
      </section>

      <section className="flex flex-col gap-4 border-t border-line pt-5">
        <h2 className="font-display text-lg font-semibold text-ink">{t('set.policy')}</h2>

        <Field
          label={t('set.slotGranularity')}
          hint={t('set.slotGranularityHint')}
          type="number"
          inputMode="numeric"
          min={1}
          max={240}
          value={form.slotGranularityMin}
          onChange={(event) => set('slotGranularityMin', event.target.value)}
          error={save.fieldError('slotGranularityMin')}
        />

        <Field
          label={t('set.minNotice')}
          hint={t('set.minNoticeHint')}
          type="number"
          inputMode="numeric"
          min={0}
          value={form.minNoticeMin}
          onChange={(event) => set('minNoticeMin', event.target.value)}
          error={save.fieldError('minNoticeMin')}
        />

        <Field
          label={t('set.maxAdvance')}
          hint={t('set.maxAdvanceHint')}
          type="number"
          inputMode="numeric"
          min={1}
          max={730}
          value={form.maxAdvanceDays}
          onChange={(event) => set('maxAdvanceDays', event.target.value)}
          error={save.fieldError('maxAdvanceDays')}
        />

        <Field
          label={t('set.cancellationWindow')}
          hint={t('set.cancellationWindowHint')}
          type="number"
          inputMode="numeric"
          min={0}
          value={form.cancellationWindowMin}
          onChange={(event) => set('cancellationWindowMin', event.target.value)}
          error={save.fieldError('cancellationWindowMin')}
        />

        {/*
          Not an error — this combination is legitimate, and a business with a 24-hour
          cancellation policy that still takes same-day bookings has chosen it. But it
          has a consequence worth stating out loud: a customer who books inside the
          cancellation window creates an appointment they cannot cancel online, and will
          ring you instead. Found by booking on the demo and then failing to cancel it.
        */}
        {noticeShorterThanCancellation ? (
          <p
            className="rounded-sm bg-warn-soft px-3 py-2 text-sm text-warn"
            role="status"
          >
            {t('set.noticeWindowWarning')}
          </p>
        ) : null}

        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={form.confirmNewCustomers}
            onChange={(event) => set('confirmNewCustomers', event.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0"
          />
          <span>
            <span className="block text-sm text-ink">{t('set.confirmNew')}</span>
            <span className="block text-sm text-muted">{t('set.confirmNewHint')}</span>
          </span>
        </label>
      </section>

      <div>
        <Button loading={save.pending} onClick={() => void save.run(form)}>
          {save.pending ? t('a.saving') : t('a.save')}
        </Button>
      </div>
    </div>
  );
}
