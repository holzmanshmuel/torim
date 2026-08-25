'use client';

/**
 * Step one: what are we booking.
 *
 * Each service is one large tap target that both selects and advances — on a phone,
 * "choose, then press Next" is two deliberate actions where one would do.
 */
import Link from 'next/link';
import { EmptyState, cx } from '@/app/components';
import type { Lang } from '@/lib/i18n';
import { ChevronEnd } from './icons';
import { formatDuration, formatPrice } from './lib/format';
import type { ServiceDto } from './lib/types';

export type ServiceStepProps = {
  lang: Lang;
  t: (key: string) => string;
  currency: string;
  services: ServiceDto[];
  selectedId: string | null;
  onSelect: (serviceId: string) => void;
};

export function ServiceStep({
  lang,
  t,
  currency,
  services,
  selectedId,
  onSelect,
}: ServiceStepProps) {
  if (services.length === 0) {
    return (
      <EmptyState
        title={t('booking.service.empty.title')}
        message={t('booking.service.empty.message')}
        action={
          <Link
            href="/"
            className="inline-flex h-11 items-center justify-center rounded-md border border-line px-5 text-sm font-medium text-ink no-underline hover:border-blue hover:text-blue"
          >
            {t('booking.service.empty.action')}
          </Link>
        }
      />
    );
  }

  return (
    <div>
      <h2 className="font-display text-lg font-semibold text-ink">
        {t('booking.service.heading')}
      </h2>

      <ul className="mt-4 flex flex-col gap-2">
        {services.map((service) => {
          const isSelected = selectedId === service.id;
          return (
            <li key={service.id}>
              <button
                type="button"
                onClick={() => onSelect(service.id)}
                aria-pressed={isSelected}
                className={cx(
                  'group flex w-full items-center gap-3 rounded-md border px-4 py-4 text-start transition-colors',
                  isSelected
                    ? 'border-blue bg-blue-50'
                    : 'border-line bg-surface hover:border-blue hover:bg-blue-50',
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-base font-semibold text-ink">
                    {service.name}
                  </span>

                  {service.description ? (
                    <span className="mt-0.5 block text-sm text-body">{service.description}</span>
                  ) : null}

                  <span className="mono-label mt-2 block text-muted">
                    {formatDuration(service.durationMin, lang)}
                  </span>
                </span>

                <span className="flex shrink-0 items-center gap-2">
                  <span className="font-display text-base font-semibold tabular-nums text-ink">
                    {formatPrice(service.priceMinor, currency, lang)}
                  </span>
                  <ChevronEnd className="h-4 w-4 text-muted rtl:rotate-180 group-hover:text-blue" />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
