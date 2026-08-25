'use client';

import { useState } from 'react';
import { Button, ConfirmDialog, Field, StatusPill, cx, useLang } from '@/app/components';
import { getT } from '@/lib/i18n';
import {
  renameCustomerAction,
  saveCustomerNotesAction,
  setCustomerBlockedAction,
} from '../_actions/customers';
import { adminDictionary } from '../dictionary';
import { interpolate } from '../format';
import type { VisitView } from '../types';
import { Banner } from './Banner';
import { useAdminAction } from './useAdminAction';

export type CustomerProfileData = {
  id: string;
  name: string;
  phone: string;
  phoneLabel: string;
  blocked: boolean;
  notes: string | null;
};

/**
 * One customer: who they are, what the owner privately knows about them, and every
 * visit.
 *
 * Blocking stops online booking and nothing else — existing appointments are untouched
 * and the owner can still book this person herself from the day view. It is an abuse
 * control, not a delete, so the confirmation says exactly that rather than implying
 * something is being erased.
 */
export function CustomerProfile({
  customer,
  visits,
}: {
  customer: CustomerProfileData;
  visits: VisitView[];
}) {
  const { lang } = useLang();
  const t = getT(lang, adminDictionary);

  const [name, setName] = useState(customer.name);
  const [notes, setNotes] = useState(customer.notes ?? '');
  const [flash, setFlash] = useState<string | null>(null);
  const [confirmingBlock, setConfirmingBlock] = useState(false);

  const rename = useAdminAction(renameCustomerAction, {
    lang,
    onSuccess: () => setFlash(t('cus.saved')),
  });
  const saveNotes = useAdminAction(saveCustomerNotesAction, {
    lang,
    onSuccess: () => setFlash(t('cus.saved')),
  });
  const block = useAdminAction(setCustomerBlockedAction, {
    lang,
    onSuccess: () => {
      setConfirmingBlock(false);
      setFlash(t('cus.saved'));
    },
  });

  const upcoming = visits.filter((visit) => visit.upcoming);
  const past = visits.filter((visit) => !visit.upcoming);

  return (
    <div className="flex flex-col gap-6">
      {flash ? <Banner tone="success">{flash}</Banner> : null}

      {customer.blocked ? <Banner tone="warn">{t('cus.blockedHint')}</Banner> : null}

      <section className="flex flex-col gap-3">
        <Field
          label={t('cus.name')}
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={rename.fieldError('name')}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            variant="secondary"
            loading={rename.pending}
            onClick={() => void rename.run(customer.id, name)}
          >
            {t('cus.rename')}
          </Button>
          <span className="text-sm text-muted">{customer.phoneLabel}</span>
        </div>
        {rename.error && !rename.failure?.field ? (
          <p role="alert" className="text-sm text-danger">
            {rename.error}
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-2 border-t border-line pt-5">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink">{t('cus.notes')}</span>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder={t('cus.notesPlaceholder')}
            rows={3}
            className="rounded-md border border-line bg-surface px-3 py-2 text-ink placeholder:text-muted"
          />
        </label>
        <p className="text-sm text-muted">{t('cus.notesHint')}</p>
        <div>
          <Button
            size="sm"
            variant="secondary"
            loading={saveNotes.pending}
            onClick={() => void saveNotes.run(customer.id, notes)}
          >
            {t('cus.saveNotes')}
          </Button>
        </div>
        {saveNotes.error ? (
          <p role="alert" className="text-sm text-danger">
            {saveNotes.error}
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-3 border-t border-line pt-5">
        <h2 className="font-display text-lg font-semibold text-ink">
          {visits.length === 0
            ? t('cus.history')
            : visits.length === 1
              ? t('cus.visits.one')
              : interpolate(t('cus.visits.many'), { count: visits.length })}
        </h2>

        {visits.length === 0 ? <p className="text-sm text-muted">{t('cus.noVisits')}</p> : null}

        {upcoming.length > 0 ? (
          <VisitGroup title={t('cus.upcoming')} visits={upcoming} t={t} />
        ) : null}
        {past.length > 0 ? <VisitGroup title={t('cus.past')} visits={past} t={t} /> : null}
      </section>

      <section className="border-t border-line pt-5">
        <Button
          variant={customer.blocked ? 'secondary' : 'danger'}
          onClick={() => setConfirmingBlock(true)}
        >
          {t(customer.blocked ? 'cus.unblock' : 'cus.block')}
        </Button>
        {block.error && !confirmingBlock ? (
          <p role="alert" className="mt-2 text-sm text-danger">
            {block.error}
          </p>
        ) : null}
      </section>

      <ConfirmDialog
        open={confirmingBlock}
        onCancel={() => {
          setConfirmingBlock(false);
          block.reset();
        }}
        onConfirm={() => void block.run(customer.id, !customer.blocked)}
        title={t(customer.blocked ? 'cus.unblockTitle' : 'cus.blockTitle')}
        message={
          <>
            {interpolate(t(customer.blocked ? 'cus.unblockMessage' : 'cus.blockMessage'), {
              name: customer.name,
            })}
            {block.error ? (
              <span role="alert" className="mt-3 block text-danger">
                {block.error}
              </span>
            ) : null}
          </>
        }
        confirmLabel={t(customer.blocked ? 'cus.unblock' : 'cus.block')}
        cancelLabel={t('a.cancel')}
        closeLabel={t('a.close')}
        confirmPending={block.pending}
        confirmVariant={customer.blocked ? 'primary' : 'danger'}
      />
    </div>
  );
}

function VisitGroup({
  title,
  visits,
  t,
}: {
  title: string;
  visits: VisitView[];
  t: (key: string) => string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="mono-label text-muted">{title}</h3>
      <ul className="flex flex-col gap-2">
        {visits.map((visit) => {
          const dropped = visit.status === 'cancelled' || visit.status === 'no_show';
          return (
            <li
              key={visit.id}
              className={cx(
                'rounded-md border border-line bg-surface px-4 py-3',
                dropped && 'opacity-70',
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="mono-label text-ink">{visit.timeRange}</span>
                <StatusPill variant={visit.status}>{t(`status.${visit.status}`)}</StatusPill>
              </div>
              <p className="mt-1 text-ink">{visit.when}</p>
              <p className="text-sm text-body">
                {visit.serviceName} · {visit.priceLabel}
              </p>
              {visit.note ? <p className="text-sm text-muted">{visit.note}</p> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
