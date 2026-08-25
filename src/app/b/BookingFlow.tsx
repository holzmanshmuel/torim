'use client';

/**
 * The booking flow: service → day → time → details → confirmation.
 *
 * Steps advance on the tap that makes the choice, rather than on a separate "Next"
 * button. On a phone that halves the number of deliberate actions between opening the
 * link and being booked, and there is always a visible way back.
 *
 * Every server call goes through `useAsyncAction`, so nothing can sit on "one moment…"
 * for ever: `pending` is cleared in a `finally`, a second submit while one is in flight
 * is ignored, and a thrown value always becomes a displayable string. Expected failures
 * come back from the action as localised data, because Next redacts thrown errors in
 * production — see `./lib/types`.
 */
import { useCallback, useMemo, useState } from 'react';
import { Button, Card, cx, useAsyncAction } from '@/app/components';
import { getT, type Lang } from '@/lib/i18n';
import { bookingDictionary } from './dictionary';
import { loadAvailability, submitBooking } from './actions';
import { ConfirmationView } from './ConfirmationView';
import { CollectionNotice, DetailsStep } from './DetailsStep';
import { ServiceStep } from './ServiceStep';
import { TimePicker } from './TimePicker';
import { CheckIcon } from './icons';
import { instantToDateKey } from '@/lib/time';
import {
  fill,
  formatDateMedium,
  formatDuration,
  formatPrice,
  formatTimeRange,
} from './lib/format';
import type { AvailabilityFetcher } from './useAvailability';
import type { BusinessDto, ConfirmationDto, ServiceDto } from './lib/types';

export type BookingFlowProps = {
  lang: Lang;
  business: BusinessDto;
  /**
   * Whether this business asks its customers for an email address — `ask_customer_email`,
   * off by default. When false the details step has no email field at all, and the
   * collection notice beside the submit button names name and phone only.
   */
  asksEmail: boolean;
  /** Already resolved to the active language by the server. */
  businessName: string;
  services: ServiceDto[];
  today: string;
  horizon: string;
};

type Step = 'service' | 'time' | 'details' | 'done';

const ORDER: Step[] = ['service', 'time', 'details'];

export function BookingFlow({
  lang,
  business,
  asksEmail,
  businessName,
  services,
  today,
  horizon,
}: BookingFlowProps) {
  const t = useMemo(() => getT(lang, bookingDictionary), [lang]);

  const [step, setStep] = useState<Step>('service');
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [slotIso, setSlotIso] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{
    name: string | null;
    phone: string | null;
    email: string | null;
    note: string | null;
  }>({ name: null, phone: null, email: null, note: null });
  const [timeNotice, setTimeNotice] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationDto | null>(null);

  /**
   * Bumped when cached availability is known to be stale — after a slot is taken from
   * under us. Feeding it into the picker's reset key is what forces a fresh fetch
   * rather than re-offering the time that just failed.
   */
  const [epoch, setEpoch] = useState(0);

  const service = services.find((candidate) => candidate.id === serviceId) ?? null;

  const fetcher = useCallback<AvailabilityFetcher>(
    async (from, to) => {
      if (!serviceId) throw new Error(t('booking.error.invalidRequest'));
      const result = await loadAvailability({ slug: business.slug, serviceId, from, to });
      if (!result.ok) throw new Error(result.message);
      return { days: result.days, today: result.today, horizon: result.horizon };
    },
    [business.slug, serviceId, t],
  );

  const {
    run: submit,
    pending: submitting,
    error: submitError,
    reset: resetSubmit,
  } = useAsyncAction(async () => {
    if (!serviceId || !slotIso) return;

    setFieldErrors({ name: null, phone: null, email: null, note: null });

    const result = await submitBooking({
      slug: business.slug,
      serviceId,
      startsAt: slotIso,
      name,
      phone,
      // Never sent when the business did not ask for it, so a stale tab whose business
      // has since turned the setting off cannot smuggle one in.
      email: asksEmail && email.trim() !== '' ? email : undefined,
      note: note.trim() === '' ? undefined : note,
    });

    if (result.ok) {
      setConfirmation(result.confirmation);
      setStep('done');
      return;
    }

    const field = result.field;
    if (field) {
      // Belongs beside the input, not above the form — and returning rather than
      // throwing keeps the general error slot empty so only one message shows.
      setFieldErrors((prev) => ({ ...prev, [field]: result.message }));
      return;
    }

    if (result.code === 'slot_taken') {
      // Send them back to a *fresh* calendar. Leaving them on the details step with an
      // error and a time that no longer exists is a dead end.
      setSlotIso(null);
      setEpoch((value) => value + 1);
      setTimeNotice(result.message);
      setStep('time');
      return;
    }

    throw new Error(result.message);
  }, { lang });

  const chooseService = useCallback((id: string) => {
    setServiceId(id);
    setSlotIso(null);
    setTimeNotice(null);
    setStep('time');
  }, []);

  const chooseSlot = useCallback((iso: string) => {
    setSlotIso(iso);
    setTimeNotice(null);
    setStep('details');
  }, []);

  const startOver = useCallback(() => {
    setStep('service');
    setServiceId(null);
    setSlotIso(null);
    setName('');
    setPhone('');
    setEmail('');
    setNote('');
    setFieldErrors({ name: null, phone: null, email: null, note: null });
    setTimeNotice(null);
    setConfirmation(null);
    resetSubmit();
    setEpoch((value) => value + 1);
  }, [resetSubmit]);

  const slotStart = slotIso ? new Date(slotIso) : null;
  const slotEnd =
    slotStart && service
      ? new Date(slotStart.getTime() + service.durationMin * 60_000)
      : null;

  const whenSummary =
    slotStart && slotEnd
      ? `${formatDateMedium(instantToDateKey(slotStart, business.timezone), business.timezone, lang)} · ${formatTimeRange(slotStart, slotEnd, business.timezone)}`
      : null;

  if (step === 'done' && confirmation) {
    return (
      <ConfirmationView
        lang={lang}
        t={t}
        business={business}
        businessName={businessName}
        confirmation={confirmation}
        onBookAnother={startOver}
      />
    );
  }

  const stepIndex = ORDER.indexOf(step);

  return (
    <div className="flex flex-col gap-5">
      <Stepper t={t} current={stepIndex} />

      {service ? (
        <Chosen
          label={t('booking.step.service')}
          value={`${service.name} · ${formatDuration(service.durationMin, lang)} · ${formatPrice(service.priceMinor, business.currency, lang)}`}
          changeLabel={t('booking.change')}
          onChange={() => {
            setStep('service');
            setTimeNotice(null);
          }}
        />
      ) : null}

      {step === 'details' && whenSummary ? (
        <Chosen
          label={t('booking.step.time')}
          value={whenSummary}
          changeLabel={t('booking.change')}
          onChange={() => {
            setStep('time');
            setTimeNotice(null);
          }}
        />
      ) : null}

      <Card>
        {step === 'service' ? (
          <ServiceStep
            lang={lang}
            t={t}
            currency={business.currency}
            services={services}
            selectedId={serviceId}
            onSelect={chooseService}
          />
        ) : null}

        {step === 'time' && serviceId ? (
          <div className="flex flex-col gap-4">
            {timeNotice ? (
              <p role="alert" className="rounded-sm bg-warn-soft px-3 py-2 text-sm text-warn">
                {timeNotice}
              </p>
            ) : null}

            <TimePicker
              lang={lang}
              t={t}
              timezone={business.timezone}
              businessName={businessName}
              minNoticeMin={business.minNoticeMin}
              maxAdvanceDays={business.maxAdvanceDays}
              today={today}
              horizon={horizon}
              fetcher={fetcher}
              resetKey={`${serviceId}:${epoch}`}
              enabled
              selectedSlot={slotIso}
              onPickSlot={chooseSlot}
            />
          </div>
        ) : null}

        {step === 'details' ? (
          <DetailsStep
            t={t}
            hasDefaultCallingCode={business.hasDefaultCallingCode}
            asksEmail={asksEmail}
            name={name}
            phone={phone}
            email={email}
            note={note}
            nameError={fieldErrors.name}
            phoneError={fieldErrors.phone}
            emailError={fieldErrors.email}
            noteError={fieldErrors.note}
            onNameChange={(value) => {
              setName(value);
              setFieldErrors((prev) => ({ ...prev, name: null }));
            }}
            onPhoneChange={(value) => {
              setPhone(value);
              setFieldErrors((prev) => ({ ...prev, phone: null }));
            }}
            onEmailChange={(value) => {
              setEmail(value);
              setFieldErrors((prev) => ({ ...prev, email: null }));
            }}
            onNoteChange={(value) => {
              setNote(value);
              setFieldErrors((prev) => ({ ...prev, note: null }));
            }}
            onSubmit={() => void submit()}
            disabled={submitting}
          />
        ) : null}
      </Card>

      {/* Only on the time step. On the details step the two "Change" chips above already
          go back to either previous step, and a third control competing with them next to
          a fixed action bar is one thing too many on a 390px screen. */}
      {step === 'time' ? (
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setTimeNotice(null);
              setStep('service');
            }}
          >
            {t('booking.back')}
          </Button>
        </div>
      ) : null}

      {/* Reserves room for the fixed action bar, so the last field is never hidden
          behind it on a short phone. */}
      {step === 'details' ? <div aria-hidden="true" className="h-44" /> : null}

      {step === 'details' ? (
        <div className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 px-4 pt-3 backdrop-blur sm:px-6">
          <div className="mx-auto flex max-w-2xl flex-col gap-2">
            {submitError ? (
              <p role="alert" className="text-sm text-danger">
                {submitError}
              </p>
            ) : null}

            <CollectionNotice t={t} asksEmail={asksEmail} />

            <Button
              size="lg"
              className="w-full"
              loading={submitting}
              onClick={() => void submit()}
            >
              {t('booking.details.submit')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Stepper({ t, current }: { t: (key: string) => string; current: number }) {
  const labels = [t('booking.step.service'), t('booking.step.time'), t('booking.step.details')];

  return (
    <ol
      aria-label={fill(t('booking.step.progress'), { n: current + 1, total: labels.length })}
      className="flex items-center gap-2"
    >
      {labels.map((label, index) => {
        const done = index < current;
        const active = index === current;

        return (
          <li key={label} className="flex flex-1 items-center gap-2">
            <span
              aria-hidden="true"
              className={cx(
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                done
                  ? 'bg-blue text-surface'
                  : active
                    ? 'bg-blue-100 text-blue'
                    : 'bg-panel text-muted',
              )}
            >
              {done ? <CheckIcon className="h-3.5 w-3.5" /> : index + 1}
            </span>
            <span
              className={cx(
                'truncate text-xs',
                active ? 'font-semibold text-ink' : 'text-muted',
              )}
            >
              {label}
            </span>
            {index < labels.length - 1 ? (
              <span aria-hidden="true" className="hidden h-px flex-1 bg-line sm:block" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function Chosen({
  label,
  value,
  changeLabel,
  onChange,
}: {
  label: string;
  value: string;
  changeLabel: string;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-panel px-4 py-3">
      <div className="min-w-0">
        <p className="mono-label text-muted">{label}</p>
        <p className="truncate text-sm font-medium text-ink">{value}</p>
      </div>
      <Button variant="ghost" size="sm" onClick={onChange}>
        {changeLabel}
      </Button>
    </div>
  );
}
