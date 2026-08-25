'use client';

/**
 * The last screen: what was booked, how to add it to a calendar, and how to get back in.
 *
 * Two things it must be honest about.
 *
 * 1. **Pending is not booked.** When the owner screens first-time customers,
 *    `bookPublicly` returns a `pending` booking. Saying "you're booked" would be a lie
 *    the customer only discovers when nobody is expecting them, so the heading, the
 *    status pill and the body copy all change.
 *
 * 2. **The manage link is the only way back.** There is no account to sign into and no
 *    way to re-derive the token, so the link is shown in full, is copyable, and is
 *    described as something to keep.
 */
import Link from 'next/link';
import { useCallback, useState, useSyncExternalStore } from 'react';
import { Button, Card, OpenWhatsApp, StatusPill, useAsyncAction } from '@/app/components';
import type { Lang } from '@/lib/i18n';
import { instantToDateKey } from '@/lib/time';
import { CalendarIcon, CheckIcon, LinkIcon } from './icons';
import {
  fill,
  formatDateFull,
  formatDuration,
  formatPhone,
  formatPrice,
  formatTimeRange,
} from './lib/format';
import type { BusinessDto, ConfirmationDto } from './lib/types';

export type ConfirmationViewProps = {
  lang: Lang;
  t: (key: string) => string;
  business: BusinessDto;
  businessName: string;
  confirmation: ConfirmationDto;
  onBookAnother: () => void;
};

/** The origin never changes within a page, so there is nothing to subscribe to. */
const subscribeNever = () => () => {};
const readOrigin = () => window.location.origin;
const readNoOrigin = () => '';

export function ConfirmationView({
  lang,
  t,
  business,
  businessName,
  confirmation,
  onBookAnother,
}: ConfirmationViewProps) {
  const isPending = confirmation.status === 'pending';

  const start = new Date(confirmation.startsAt);
  const end = new Date(confirmation.endsAt);

  // The business's calendar day, not the browser's: a 23:30 appointment in Jerusalem is
  // still "today" for a customer reading this in London, where it is already tomorrow.
  const dateKey = instantToDateKey(start, business.timezone);
  const dateLong = formatDateFull(dateKey, business.timezone, lang);
  const timeRange = formatTimeRange(start, end, business.timezone);
  const when = `${dateLong}, ${timeRange}`;

  // Rendered on the server as a bare path, completed on hydration. The origin is the one
  // thing the server cannot know reliably behind a proxy, and a wrong absolute URL in a
  // link the customer is told to keep is worse than a brief relative one.
  //
  // `useSyncExternalStore` rather than an effect: it has a server snapshot built in, so
  // the markup React renders on the server and the markup it hydrates against agree,
  // with no state update and no cascading render.
  const origin = useSyncExternalStore(subscribeNever, readOrigin, readNoOrigin);
  const manageUrl = `${origin}${confirmation.managePath}`;

  const [copied, setCopied] = useState(false);
  const copyLink = useCallback(async () => {
    await navigator.clipboard.writeText(manageUrl);
    setCopied(true);
  }, [manageUrl]);
  const { run: copy, pending: copying, error: copyError } = useAsyncAction(copyLink, { lang });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col items-start gap-3">
        <span
          aria-hidden="true"
          className={
            isPending
              ? 'inline-flex h-12 w-12 items-center justify-center rounded-full bg-warn-soft text-warn'
              : 'inline-flex h-12 w-12 items-center justify-center rounded-full bg-ok-soft text-ok'
          }
        >
          <CheckIcon className="h-6 w-6" />
        </span>

        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-display text-2xl font-semibold text-ink">
            {isPending ? t('booking.done.pendingTitle') : t('booking.done.confirmedTitle')}
          </h2>
          <StatusPill variant={isPending ? 'pending' : 'confirmed'}>
            {isPending ? t('booking.status.pending') : t('booking.status.confirmed')}
          </StatusPill>
        </div>

        <p className="text-body">
          {isPending
            ? fill(t('booking.done.pendingBody'), { business: businessName })
            : t('booking.done.confirmedBody')}
        </p>
      </div>

      <Card>
        <dl className="flex flex-col divide-y divide-line-2">
          <Row label={t('booking.summary.service')} value={confirmation.serviceName} />
          <Row label={t('booking.summary.when')} value={when} />
          <Row
            label={t('booking.summary.duration')}
            value={formatDuration(confirmation.durationMin, lang)}
          />
          <Row
            label={t('booking.summary.price')}
            value={formatPrice(confirmation.priceMinor, business.currency, lang)}
          />
          <Row label={t('booking.summary.name')} value={confirmation.customerName} />
          <Row label={t('booking.summary.phone')} value={formatPhone(confirmation.customerPhone)} />
        </dl>
      </Card>

      <div className="flex flex-wrap gap-3">
        {/* A plain link, downloaded by the browser. Nothing here opens a window after an
            await, so there is no user-gesture to lose. */}
        <a
          href={confirmation.icsPath}
          download
          className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-line bg-surface px-5 text-sm font-medium text-ink no-underline hover:border-blue hover:text-blue"
        >
          <CalendarIcon className="h-4 w-4" />
          {t('booking.done.addToCalendar')}
        </a>

        {business.whatsappPhone ? (
          <OpenWhatsApp
            phone={business.whatsappPhone}
            lang={lang}
            label={fill(t('booking.done.whatsapp'), { business: businessName })}
            message={fill(t('booking.done.whatsappMessage'), {
              service: confirmation.serviceName,
              when,
            })}
          />
        ) : null}
      </div>

      <Card
        header={
          <div className="flex items-center gap-2">
            <LinkIcon className="h-4 w-4 text-blue" />
            <h3 className="font-display text-base font-semibold text-ink">
              {t('booking.done.manageTitle')}
            </h3>
          </div>
        }
      >
        <p className="text-sm text-body">{t('booking.done.manageBody')}</p>

        <p className="mt-3 overflow-x-auto rounded-sm bg-panel px-3 py-2 font-mono text-xs text-body">
          <span dir="ltr">{manageUrl || confirmation.managePath}</span>
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Link
            href={confirmation.managePath}
            className="inline-flex h-11 items-center justify-center rounded-md bg-blue px-5 text-sm font-medium text-surface no-underline hover:bg-blue-700"
          >
            {t('booking.done.manageOpen')}
          </Link>

          <Button
            variant="secondary"
            loading={copying}
            onClick={() => {
              setCopied(false);
              void copy();
            }}
          >
            {copied ? t('booking.done.copied') : t('booking.done.copyLink')}
          </Button>
        </div>

        {copyError ? (
          <p role="alert" className="mt-2 text-sm text-danger">
            {t('booking.done.copyFailed')}
          </p>
        ) : null}
      </Card>

      <div>
        <Button variant="ghost" onClick={onBookAnother}>
          {t('booking.done.bookAnother')}
        </Button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 first:pt-0 last:pb-0">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-end text-sm font-medium text-ink">{value}</dd>
    </div>
  );
}
