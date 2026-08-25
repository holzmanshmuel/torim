'use client';

import { cx } from './cx';
import { Button } from './Button';

export type ErrorStateProps = {
  /** Already localized by the caller - this component doesn't own any copy. */
  message: string;
  onRetry?: () => void;
  /** Overrides the default retry label. If omitted, falls back to `t('common.tryAgain')`
   *  when `t` is given, else the English string "Try again". */
  retryLabel?: string;
  /** `getT(lang)` from `@/lib/i18n`, used only for the default retry label. */
  t?: (key: string) => string;
  className?: string;
};

/** A localized error message plus a retry affordance - never just a dead "Error." */
export function ErrorState({ message, onRetry, retryLabel, t, className }: ErrorStateProps) {
  const label = retryLabel ?? (t ? t('common.tryAgain') : 'Try again');

  return (
    <div
      role="alert"
      className={cx(
        'flex flex-col items-center gap-3 rounded-md border border-line bg-surface px-6 py-10 text-center',
        className,
      )}
    >
      <p className="max-w-sm text-body">{message}</p>
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {label}
        </Button>
      ) : null}
    </div>
  );
}
