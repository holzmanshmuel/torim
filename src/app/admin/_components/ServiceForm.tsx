'use client';

import { useState } from 'react';
import { Button, Field, Select, Sheet, useLang } from '@/app/components';
import { getT } from '@/lib/i18n';
import { saveServiceAction } from '../_actions/services';
import { DEFAULT_SERVICE_COLOUR, SERVICE_COLOURS, colourHex, colourLabelKey } from '../colours';
import { adminDictionary } from '../dictionary';
import type { ServiceView } from '../types';
import { useAdminAction } from './useAdminAction';

/**
 * Add or edit one service.
 *
 * Editing never reaches an appointment already in the diary: `torim.bookings` snapshots
 * its own price and buffers when it is created, so changing the catalogue changes only
 * what happens next. That is what makes "retire" safe as a plain `active = false`.
 *
 * Every field is seeded once from props; the parent keys this component on the service
 * id, so opening a different one is a different mount rather than an effect racing the
 * owner's typing.
 */
export function ServiceForm({
  service,
  currency,
  onClose,
}: {
  /** null means "add a new one". */
  service: ServiceView | null;
  currency: string;
  onClose: () => void;
}) {
  const { lang } = useLang();
  const t = getT(lang, adminDictionary);

  const [name, setName] = useState(service?.name ?? '');
  const [nameHe, setNameHe] = useState(service?.nameHe ?? '');
  const [description, setDescription] = useState(service?.description ?? '');
  const [durationMin, setDurationMin] = useState(String(service?.durationMin ?? 30));
  const [price, setPrice] = useState(service?.priceInput ?? '0');
  const [bufferBeforeMin, setBufferBeforeMin] = useState(String(service?.bufferBeforeMin ?? 0));
  const [bufferAfterMin, setBufferAfterMin] = useState(String(service?.bufferAfterMin ?? 0));
  const [colour, setColour] = useState(service?.colour ?? DEFAULT_SERVICE_COLOUR);
  const [active, setActive] = useState(service?.active ?? true);

  const save = useAdminAction(saveServiceAction, { lang, onSuccess: onClose });

  return (
    <Sheet
      open
      onClose={onClose}
      closeLabel={t('a.close')}
      title={service ? t('svc.edit') : t('svc.add')}
      footer={
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            {t('a.cancel')}
          </Button>
          <Button
            loading={save.pending}
            onClick={() =>
              void save.run({
                id: service?.id ?? null,
                name,
                nameHe,
                description,
                durationMin,
                price,
                bufferBeforeMin,
                bufferAfterMin,
                colour,
                active,
              })
            }
          >
            {save.pending ? t('a.saving') : t('a.save')}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <Field
          label={t('svc.name')}
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={save.fieldError('name')}
          required
        />

        <Field
          label={`${t('svc.nameHe')} (${t('a.optional')})`}
          value={nameHe}
          onChange={(event) => setNameHe(event.target.value)}
          dir="rtl"
        />

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink">
            {t('svc.description')} <span className="text-muted">({t('a.optional')})</span>
          </span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={2}
            className="rounded-md border border-line bg-surface px-3 py-2 text-ink"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <Field
            label={t('svc.duration')}
            type="number"
            inputMode="numeric"
            min={1}
            max={1440}
            value={durationMin}
            onChange={(event) => setDurationMin(event.target.value)}
            error={save.fieldError('durationMin')}
            required
          />
          <Field
            label={`${t('svc.price')} (${currency})`}
            type="text"
            inputMode="decimal"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            error={save.fieldError('price')}
            required
          />
        </div>

        <p className="text-sm text-muted">{t('svc.priceHint')}</p>

        <div className="grid grid-cols-2 gap-3">
          <Field
            label={t('svc.bufferBefore')}
            type="number"
            inputMode="numeric"
            min={0}
            max={240}
            value={bufferBeforeMin}
            onChange={(event) => setBufferBeforeMin(event.target.value)}
            error={save.fieldError('bufferBeforeMin')}
          />
          <Field
            label={t('svc.bufferAfter')}
            type="number"
            inputMode="numeric"
            min={0}
            max={240}
            value={bufferAfterMin}
            onChange={(event) => setBufferAfterMin(event.target.value)}
            error={save.fieldError('bufferAfterMin')}
          />
        </div>

        <p className="text-sm text-muted">{t('svc.bufferHint')}</p>

        <div className="flex items-end gap-3">
          <Select
            label={t('svc.colour')}
            value={colour}
            onChange={(event) => setColour(event.target.value)}
            options={SERVICE_COLOURS.map((value) => ({ value, label: t(colourLabelKey(value)) }))}
            containerClassName="flex-1"
          />
          <span
            aria-hidden="true"
            className="mb-1 inline-block h-8 w-8 shrink-0 rounded-md"
            style={{ backgroundColor: colourHex(colour) }}
          />
        </div>

        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={active}
            onChange={(event) => setActive(event.target.checked)}
            className="h-5 w-5 shrink-0"
          />
          <span className="text-sm text-ink">{t('svc.active')}</span>
        </label>

        <p className="text-sm text-muted">{t('svc.retiredNote')}</p>

        {save.error && !save.failure?.field ? (
          <p role="alert" className="text-sm text-danger">
            {save.error}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
