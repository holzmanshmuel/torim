'use client';

/**
 * Step three: name and phone. Nothing else, and no account.
 *
 * Phone is the customer's identity in Torim, so the field is deliberately forgiving:
 * `normalisePhone` accepts `050-123-4567`, `+972 50 123 4567` and `00972…` alike. The
 * hint changes depending on whether the business has a default calling code, because
 * without one a bare national number genuinely cannot be resolved — and saying "include
 * your country code" is far more useful than "invalid number".
 *
 * The inputs inherit the global 16px minimum from globals.css. Do not shrink them: below
 * 16px iOS Safari zooms the page on focus and never zooms back out, and the customer
 * finishes the form looking at a third of it.
 */
import Link from 'next/link';
import { useId } from 'react';
import { Field } from '@/app/components';
import { MAX_NOTE_LENGTH } from './lib/validate';

export type DetailsStepProps = {
  t: (key: string) => string;
  hasDefaultCallingCode: boolean;
  name: string;
  phone: string;
  note: string;
  nameError: string | null;
  phoneError: string | null;
  noteError: string | null;
  onNameChange: (value: string) => void;
  onPhoneChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  onSubmit: () => void;
  disabled: boolean;
};

export function DetailsStep({
  t,
  hasDefaultCallingCode,
  name,
  phone,
  note,
  nameError,
  phoneError,
  noteError,
  onNameChange,
  onPhoneChange,
  onNoteChange,
  onSubmit,
  disabled,
}: DetailsStepProps) {
  const noteId = useId();

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled) onSubmit();
      }}
      className="flex flex-col gap-4"
    >
      <h2 className="font-display text-lg font-semibold text-ink">
        {t('booking.details.heading')}
      </h2>

      <Field
        label={t('booking.details.name')}
        required
        name="name"
        autoComplete="name"
        enterKeyHint="next"
        maxLength={80}
        placeholder={t('booking.details.namePlaceholder')}
        value={name}
        error={nameError ?? undefined}
        onChange={(event) => onNameChange(event.target.value)}
      />

      <Field
        label={t('booking.details.phone')}
        required
        name="tel"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        enterKeyHint="done"
        dir="ltr"
        maxLength={32}
        hint={
          hasDefaultCallingCode
            ? t('booking.details.phoneHintLocal')
            : t('booking.details.phoneHintInternational')
        }
        value={phone}
        error={phoneError ?? undefined}
        onChange={(event) => onPhoneChange(event.target.value)}
      />

      <div className="flex flex-col gap-1.5">
        <label htmlFor={noteId} className="text-sm font-medium text-ink">
          {t('booking.details.note')}{' '}
          <span className="font-normal text-muted">({t('booking.details.noteOptional')})</span>
        </label>
        <textarea
          id={noteId}
          name="note"
          rows={3}
          maxLength={MAX_NOTE_LENGTH}
          placeholder={t('booking.details.notePlaceholder')}
          value={note}
          aria-invalid={noteError ? true : undefined}
          aria-describedby={noteError ? `${noteId}-error` : undefined}
          onChange={(event) => onNoteChange(event.target.value)}
          className="min-h-24 rounded-md border border-line bg-surface px-3 py-2 text-ink placeholder:text-muted"
        />
        {noteError ? (
          <p id={`${noteId}-error`} role="alert" className="text-sm text-danger">
            {noteError}
          </p>
        ) : null}
      </div>

      {/* Submitting with Enter from a text field needs a submit control inside the form.
          The visible one lives in the sticky bar below, which posts the same handler. */}
      <button type="submit" className="sr-only" tabIndex={-1} aria-hidden="true">
        {t('booking.details.submit')}
      </button>
    </form>
  );
}

/**
 * The compliance notice. One line, beside the submit control, naming what is collected
 * and why, and linking the privacy page. No checkbox — nothing here is optional consent
 * to be pre-ticked, and a pre-ticked box is not consent anyway.
 */
export function CollectionNotice({ t }: { t: (key: string) => string }) {
  return (
    <p className="text-xs leading-relaxed text-muted">
      {t('booking.details.privacy')}{' '}
      <Link href="/privacy" className="underline">
        {t('booking.details.privacyLink')}
      </Link>
    </p>
  );
}
