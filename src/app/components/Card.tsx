import type { ReactNode } from 'react';
import { cx } from './cx';

export type CardProps = {
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  /** Set false to drop the body's default padding, e.g. when the child is a table
   *  or list that should run edge-to-edge inside the card. */
  padded?: boolean;
  className?: string;
};

/** Surface, soft border, 14px radius. Pure presentation - safe to render from a
 *  Server Component; it has no client-only behavior of its own. */
export function Card({ header, footer, children, padded = true, className }: CardProps) {
  return (
    <div className={cx('rounded-md border border-line bg-surface shadow-soft', className)}>
      {header ? <div className="border-b border-line px-6 py-4">{header}</div> : null}
      <div className={padded ? 'px-6 py-5' : undefined}>{children}</div>
      {footer ? <div className="border-t border-line px-6 py-4">{footer}</div> : null}
    </div>
  );
}
