import type { ReactNode } from 'react';
import { cx } from './cx';

export type StatusPillVariant =
  | 'confirmed'
  | 'pending'
  | 'cancelled'
  | 'no_show'
  | 'neutral'
  | 'ok'
  | 'warn';

export type StatusPillProps = {
  variant: StatusPillVariant;
  /** The label text, already localized and typically already short (e.g.
   *  `t('status.confirmed')`) - this component only handles the visual treatment. */
  children: ReactNode;
  className?: string;
};

// Domain statuses alias onto the same palette families as the generic
// neutral/ok/warn variants, plus `danger` for the one genuinely negative outcome
// (a no-show). See the README for the full mapping and rationale.
const VARIANT_CLASSES: Record<StatusPillVariant, string> = {
  confirmed: 'bg-ok-soft text-ok',
  ok: 'bg-ok-soft text-ok',
  pending: 'bg-warn-soft text-warn',
  warn: 'bg-warn-soft text-warn',
  cancelled: 'bg-panel text-muted',
  neutral: 'bg-panel text-muted',
  no_show: 'bg-danger-soft text-danger',
};

/** Small uppercase mono status label. Pure presentation - safe from a Server
 *  Component. */
export function StatusPill({ variant, children, className }: StatusPillProps) {
  return (
    <span
      className={cx(
        'mono-label inline-flex items-center rounded-sm px-2 py-1',
        VARIANT_CLASSES[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
