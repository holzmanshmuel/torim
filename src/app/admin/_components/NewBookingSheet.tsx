'use client';

import { useEffect, useState } from 'react';
import { Button, Field, Select, Sheet, cx, useLang } from '@/app/components';
import { getT } from '@/lib/i18n';
import { createBookingAction, searchCustomersAction } from '../_actions/bookings';
import { adminDictionary } from '../dictionary';
import { interpolate } from '../format';
import type { BookingSaved, CustomerOption, ServiceOption } from '../types';
import { Banner } from './Banner';
import { useAdminAction } from './useAdminAction';

type Mode = 'existing' | 'new';

/**
 * Manual booking entry — a first-class flow, because most real bookings still arrive by
 * phone, by WhatsApp, or at the door.
 *
 * What it deliberately does NOT do is apply the customer-facing rules. Any time is
 * allowed here: outside opening hours, on a closed day, in ten minutes. The slot engine
 * exists to stop *customers* booking a time the business does not offer; applying it to
 * the owner is how the predecessor left her unable to enter her own appointments.
 *
 * What it will never do is overlap in silence. A clash comes back named — whose
 * appointment, what service, what time — and only a second, explicit tap sends
 * `allowOverlap`. When the write lands on top of something, the confirmation says so.
 */
export function NewBookingSheet({
  open,
  onClose,
  services,
  defaultDate,
  defaultTime,
}: {
  open: boolean;
  onClose: () => void;
  services: ServiceOption[];
  defaultDate: string;
  defaultTime: string;
}) {
  const { lang } = useLang();
  const t = getT(lang, adminDictionary);

  const [mode, setMode] = useState<Mode>('existing');
  const [term, setTerm] = useState('');
  const [lastSearched, setLastSearched] = useState<string | null>(null);
  const [results, setResults] = useState<CustomerOption[]>([]);
  const [chosen, setChosen] = useState<CustomerOption | null>(null);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [serviceId, setServiceId] = useState(services[0]?.id ?? '');
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState(defaultTime);
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState<BookingSaved | null>(null);

  const search = useAdminAction(searchCustomersAction, {
    lang,
    onSuccess: (value) => setResults(value),
  });
  const searchRun = search.run;
  const searchPending = search.pending;

  const create = useAdminAction(createBookingAction, {
    lang,
    onSuccess: (value) => setSaved(value),
  });

  /**
   * Debounced typeahead.
   *
   * `useAsyncAction` ignores a second call while one is in flight — the double-submit
   * guard that makes a stuck button impossible — so this also re-fires once the previous
   * search settles if what she typed has moved on. Without that, a fast typist's last
   * keystroke would be silently dropped and the list would show stale matches.
   */
  useEffect(() => {
    if (!open || mode !== 'existing') return;
    if (searchPending) return;
    if (term === lastSearched) return;

    const handle = setTimeout(() => {
      setLastSearched(term);
      void searchRun(term);
    }, 250);
    return () => clearTimeout(handle);
  }, [open, mode, term, lastSearched, searchPending, searchRun]);

  function resetForNext() {
    setSaved(null);
    setChosen(null);
    setTerm('');
    setLastSearched(null);
    setResults([]);
    setName('');
    setPhone('');
    setNote('');
    create.reset();
  }

  function closeAll() {
    resetForNext();
    onClose();
  }

  function submit(allowOverlap: boolean) {
    void create.run({
      customerId: mode === 'existing' ? (chosen?.id ?? null) : null,
      newCustomer: mode === 'new' ? { name, phone } : null,
      serviceId,
      date,
      time,
      note,
      allowOverlap,
    });
  }

  const clash = create.failure?.code === 'conflict' ? create.failure.clash : undefined;

  if (services.length === 0) {
    return (
      <Sheet open={open} onClose={onClose} closeLabel={t('a.close')} title={t('new.title')}>
        <Banner tone="info" title={t('new.noServices.title')}>
          {t('new.noServices.message')}
        </Banner>
      </Sheet>
    );
  }

  return (
    <Sheet
      open={open}
      onClose={closeAll}
      closeLabel={t('a.close')}
      title={t('new.title')}
      footer={
        saved ? (
          <div className="flex justify-between gap-3">
            <Button variant="secondary" onClick={resetForNext}>
              {t('day.new')}
            </Button>
            <Button onClick={closeAll}>{t('a.done')}</Button>
          </div>
        ) : (
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={closeAll}>
              {t('a.cancel')}
            </Button>
            <Button loading={create.pending} onClick={() => submit(false)}>
              {create.pending ? t('new.submitting') : t('new.submit')}
            </Button>
          </div>
        )
      }
    >
      {saved ? (
        <Banner
          tone={saved.overlapped ? 'warn' : 'success'}
          title={
            saved.overlapped && saved.overlappedWith
              ? t('clash.title')
              : t('new.title')
          }
        >
          {saved.overlapped && saved.overlappedWith
            ? interpolate(t('clash.overlapped'), {
                when: saved.overlappedWith.when,
                name: saved.overlappedWith.customerName,
              })
            : interpolate(t('new.created'), {
                when: saved.when,
                name: saved.customerName,
              })}
        </Banner>
      ) : (
        <div className="flex flex-col gap-5">
          <p className="text-sm text-body">{t('new.intro')}</p>

          {/* ── Who ───────────────────────────────────────────────────────── */}
          <section className="flex flex-col gap-3">
            <div className="flex gap-2" role="group" aria-label={t('new.customer')}>
              <ModeButton active={mode === 'existing'} onClick={() => setMode('existing')}>
                {t('new.useExisting')}
              </ModeButton>
              <ModeButton active={mode === 'new'} onClick={() => setMode('new')}>
                {t('new.useNew')}
              </ModeButton>
            </div>

            {mode === 'existing' ? (
              chosen ? (
                <div className="flex flex-col gap-2 rounded-md border border-line bg-panel px-3 py-3">
                  <p className="text-sm text-ink">
                    {interpolate(t('new.selected'), { name: chosen.name })}
                  </p>
                  <p className="text-sm text-muted">{chosen.phoneLabel}</p>
                  {chosen.blocked ? (
                    <Banner tone="warn">{t('new.blockedWarning')}</Banner>
                  ) : null}
                  <div>
                    <Button size="sm" variant="secondary" onClick={() => setChosen(null)}>
                      {t('new.change')}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <Field
                    label={t('new.searchCustomer')}
                    hint={t('new.searchHint')}
                    value={term}
                    onChange={(event) => setTerm(event.target.value)}
                    error={create.fieldError('customerId')}
                    autoComplete="off"
                  />

                  {results.length > 0 ? (
                    <ul className="max-h-56 overflow-y-auto rounded-md border border-line">
                      {results.map((customer) => (
                        <li key={customer.id} className="border-b border-line last:border-b-0">
                          <button
                            type="button"
                            onClick={() => setChosen(customer)}
                            className="flex w-full flex-col gap-0.5 px-3 py-2.5 text-start hover:bg-panel"
                          >
                            <span className="text-ink">{customer.name}</span>
                            <span className="text-sm text-muted">{customer.phoneLabel}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {lastSearched !== null && !search.pending && results.length === 0 ? (
                    <p className="text-sm text-muted">{t('new.noMatches')}</p>
                  ) : null}

                  {search.error ? (
                    <p role="alert" className="text-sm text-danger">
                      {search.error}
                    </p>
                  ) : null}
                </div>
              )
            ) : (
              <div className="flex flex-col gap-3">
                <Field
                  label={t('new.name')}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  error={create.fieldError('name')}
                  required
                />
                <Field
                  label={t('new.phone')}
                  hint={t('new.phoneHint')}
                  type="tel"
                  inputMode="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  error={create.fieldError('phone')}
                  required
                />
              </div>
            )}
          </section>

          {/* ── What and when ─────────────────────────────────────────────── */}
          <section className="flex flex-col gap-3 border-t border-line pt-4">
            <Select
              label={t('new.service')}
              value={serviceId}
              onChange={(event) => setServiceId(event.target.value)}
              options={services.map((service) => ({
                value: service.id,
                label: `${service.name} — ${service.summary}`,
              }))}
              error={create.fieldError('serviceId')}
              required
            />

            <div className="grid grid-cols-2 gap-3">
              <Field
                label={t('new.date')}
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                error={create.fieldError('date')}
                required
              />
              <Field
                label={t('new.time')}
                type="time"
                value={time}
                onChange={(event) => setTime(event.target.value)}
                error={create.fieldError('time')}
                required
              />
            </div>

            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink">
                {t('new.note')} <span className="text-muted">({t('a.optional')})</span>
              </span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={2}
                className="rounded-md border border-line bg-surface px-3 py-2 text-ink"
              />
            </label>
          </section>

          {clash ? (
            <Banner
              tone="warn"
              title={t('clash.title')}
              actions={
                <>
                  <Button
                    size="sm"
                    variant="danger"
                    loading={create.pending}
                    onClick={() => submit(true)}
                  >
                    {t('clash.override')}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={create.reset}>
                    {t('clash.pick')}
                  </Button>
                </>
              }
            >
              {interpolate(t('clash.body'), {
                when: clash.when,
                name: clash.customerName,
                service: clash.serviceName,
              })}
            </Banner>
          ) : null}

          {create.error && !clash && !create.failure?.field ? (
            <p role="alert" className="text-sm text-danger">
              {create.error}
            </p>
          ) : null}
        </div>
      )}
    </Sheet>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        'h-11 flex-1 rounded-md border px-3 text-sm font-medium',
        active
          ? 'border-blue bg-blue-50 text-blue'
          : 'border-line bg-surface text-body hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}
