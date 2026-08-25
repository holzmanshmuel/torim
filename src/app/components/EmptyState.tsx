import type { ReactNode } from 'react';
import { cx } from './cx';

export type EmptyStateProps = {
  /** Decorative - always rendered `aria-hidden`. */
  icon?: ReactNode;
  title?: string;
  message: string;
  /**
   * The next action - required. An empty state is never a dead end, so this
   * component won't let you render one without something to do next. Pass a
   * `Button` (or a `Link` styled like one) already wired up by the caller.
   */
  action: ReactNode;
  className?: string;
};

/** Pure presentation - safe from a Server Component, even though `action` will
 *  usually be a Client Component (e.g. `Button`) rendered as its child. */
export function EmptyState({ icon, title, message, action, className }: EmptyStateProps) {
  return (
    <div
      className={cx(
        'flex flex-col items-center gap-3 rounded-md border border-dashed border-line px-6 py-12 text-center',
        className,
      )}
    >
      {icon ? (
        <div aria-hidden="true" className="text-muted">
          {icon}
        </div>
      ) : null}
      {title ? <p className="font-display text-lg font-semibold text-ink">{title}</p> : null}
      <p className="max-w-sm text-body">{message}</p>
      <div className="mt-1">{action}</div>
    </div>
  );
}
