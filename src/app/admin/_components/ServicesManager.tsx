'use client';

import { useState } from 'react';
import { Button, ConfirmDialog, StatusPill, cx, useLang } from '@/app/components';
import { getT } from '@/lib/i18n';
import {
  deleteServiceAction,
  moveServiceAction,
  setServiceActiveAction,
} from '../_actions/services';
import { colourHex } from '../colours';
import { adminDictionary } from '../dictionary';
import { interpolate } from '../format';
import type { ServiceView } from '../types';
import { Banner } from './Banner';
import { Icon } from './Icon';
import { ServiceForm } from './ServiceForm';
import { useAdminAction } from './useAdminAction';

/**
 * The service catalogue: order, duration, price, buffers, colour, and whether it is
 * still bookable.
 *
 * Reordering is two buttons, not drag-and-drop. This screen is used on a phone with a
 * thumb; a drag handle at that size is a coin toss between reordering and scrolling.
 *
 * Deleting is offered, but a service that has ever been booked cannot be deleted — the
 * schema's `ON DELETE RESTRICT` stops it — and that refusal comes back as "retire it
 * instead", which keeps every existing appointment exactly as it was.
 */
export function ServicesManager({
  services,
  currency,
}: {
  services: ServiceView[];
  currency: string;
}) {
  const { lang } = useLang();
  const t = getT(lang, adminDictionary);

  const [editing, setEditing] = useState<{ service: ServiceView | null } | null>(null);
  const [deleting, setDeleting] = useState<ServiceView | null>(null);

  // Reordering is deliberately ONE shared action: renumbering the whole list twice
  // concurrently is how an order ends up scrambled, so a second tap while one is in
  // flight should be ignored. Retiring is per-row (see `ServiceRow`) for the opposite
  // reason — those taps are independent and must not queue behind each other.
  const move = useAdminAction(moveServiceAction, { lang });
  const remove = useAdminAction(deleteServiceAction, {
    lang,
    onSuccess: () => setDeleting(null),
  });

  const error = move.error ?? (deleting ? null : remove.error);

  return (
    <div className="flex flex-col gap-4">
      {error ? <Banner tone="danger">{error}</Banner> : null}

      <Button onClick={() => setEditing({ service: null })} className="w-full">
        <Icon name="plus" size={18} />
        {t('svc.add')}
      </Button>

      <ul className="flex flex-col gap-3">
        {services.map((service) => (
          <ServiceRow
            key={service.id}
            service={service}
            movePending={move.pending}
            onMove={(direction) => void move.run(service.id, direction)}
            onEdit={() => setEditing({ service })}
            onDelete={() => setDeleting(service)}
          />
        ))}
      </ul>

      <p className="text-sm text-muted">{t('svc.retiredNote')}</p>

      {editing ? (
        <ServiceForm
          key={editing.service?.id ?? 'new'}
          service={editing.service}
          currency={currency}
          onClose={() => setEditing(null)}
        />
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        onCancel={() => {
          setDeleting(null);
          remove.reset();
        }}
        onConfirm={() => {
          if (deleting) void remove.run(deleting.id);
        }}
        title={t('svc.deleteTitle')}
        message={
          <>
            {interpolate(t('svc.deleteMessage'), { name: deleting?.name ?? '' })}
            {remove.error ? (
              <span role="alert" className="mt-3 block text-danger">
                {remove.error}
              </span>
            ) : null}
          </>
        }
        confirmLabel={t('a.delete')}
        cancelLabel={t('a.cancel')}
        closeLabel={t('a.close')}
        confirmPending={remove.pending}
      />
    </div>
  );
}

function ServiceRow({
  service,
  movePending,
  onMove,
  onEdit,
  onDelete,
}: {
  service: ServiceView;
  movePending: boolean;
  onMove: (direction: -1 | 1) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { lang } = useLang();
  const t = getT(lang, adminDictionary);

  const toggle = useAdminAction(setServiceActiveAction, { lang });

  return (
    <li
      className={cx(
        'rounded-md border border-line bg-surface px-4 py-3 shadow-soft',
        !service.active && 'opacity-70',
      )}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-1 inline-block h-3 w-3 shrink-0 rounded-full"
          style={{ backgroundColor: colourHex(service.colour) }}
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-ink">{service.name}</p>
            {!service.active ? (
              <StatusPill variant="neutral">{t('svc.retired')}</StatusPill>
            ) : null}
          </div>

          <p className="text-sm text-body">
            {interpolate(t('svc.summary'), {
              duration: service.durationMin,
              price: service.priceLabel,
            })}
          </p>

          {service.bufferBeforeMin > 0 || service.bufferAfterMin > 0 ? (
            <p className="text-sm text-muted">
              {interpolate(t('svc.bufferSummary'), {
                before: service.bufferBeforeMin,
                after: service.bufferAfterMin,
              })}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-col gap-1">
          <button
            type="button"
            aria-label={t('svc.moveUp')}
            disabled={service.first || movePending}
            onClick={() => onMove(-1)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-sm border border-line text-body disabled:opacity-40"
          >
            <span aria-hidden="true">↑</span>
          </button>
          <button
            type="button"
            aria-label={t('svc.moveDown')}
            disabled={service.last || movePending}
            onClick={() => onMove(1)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-sm border border-line text-body disabled:opacity-40"
          >
            <span aria-hidden="true">↓</span>
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={onEdit}>
          {t('a.edit')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          loading={toggle.pending}
          onClick={() => void toggle.run(service.id, !service.active)}
        >
          {service.active ? t('svc.retire') : t('svc.restore')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDelete}>
          {t('a.delete')}
        </Button>
      </div>

      {toggle.error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {toggle.error}
        </p>
      ) : null}
    </li>
  );
}
