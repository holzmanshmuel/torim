'use client';

/**
 * Step three: name and phone. Nothing else, and no account.
 *
 * Unless the business turned `ask_customer_email` on, in which case there is one more
 * box, and it is optional. It is not rendered at all otherwise — not hidden, not
 * disabled — and the collection notice beside the submit button changes with it, because
 * a notice that names fields the form does not have is as wrong as one that omits fields
 * it does. No checkbox anywhere: nothing here is optional consent to be pre-ticked, and
 * a pre-ticked box is not consent.
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
import { MAX_EMAIL_LENGTH, MAX_NOTE_LENGTH } from './lib/validate';

export type DetailsStepProps = {
  t: (key: string) => string;
  hasDefaultCallingCode: boolean;
  /** When false the email field does not exist. Comes from the business's own setting. */
  asksEmail: boolean;
  name: string;
  phone: string;
  email: string;
  note: string;
  nameError: string | null;
  phoneError: string | null;
  emailError: string | null;
  noteError: string | null;
  onNameChange: (value: string) => void;
  onPhoneChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  onSubmit: () => void;
  disabled: boolean;
};

export function DetailsStep({
  t,
  hasDefaultCallingCode,
  asksEmail,
  name,
  phone,
  email,
  note,
  nameError,
  phoneError,
  emailError,
  noteError,
  onNameChange,
  onPhoneChange,
  onEmailChange,
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

      {/*
        Optional, and it says so in the label rather than only in a hint. Note what is
        NOT here: any promise that an email will be sent. Whether this deployment can
        send one at all depends on a transport configured outside this app, which the UI
        cannot see — and telling a customer they will get a confirmation that never
        arrives is worse than telling them nothing.
      */}
      {asksEmail ? (
        <Field
          label={`${t('booking.details.email')} (${t('booking.details.optional')})`}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          enterKeyHint="next"
          dir="ltr"
          maxLength={MAX_EMAIL_LENGTH}
          placeholder={t('booking.details.emailPlaceholder')}
          value={email}
          error={emailError ?? undefined}
          onChange={(event) => onEmailChange(event.target.value)}
        />
      ) : null}

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
 *
 * The wording tracks the form: it names an email address when, and only when, the form
 * has a box for one. A notice listing fields the form does not have is inaccurate in
 * exactly the way a collection notice must not be, and so is one that quietly omits a
 * field it does. It also stops at what is collected and why — it does not say anything
 * will be sent to the address, because nothing in this layer knows whether this
 * deployment has a transport at all.
 */
export function CollectionNotice({
  t,
  asksEmail,
}: {
  t: (key: string) => string;
  asksEmail: boolean;
}) {
  return (
    <p className="text-xs leading-relaxed text-muted">
      {t(asksEmail ? 'booking.details.privacyWithEmail' : 'booking.details.privacy')}{' '}
      <Link href="/privacy" className="underline">
        {t('booking.details.privacyLink')}
      </Link>
    </p>
  );
}
