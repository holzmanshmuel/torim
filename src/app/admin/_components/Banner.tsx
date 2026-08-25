import type { ReactNode } from 'react';
import { cx } from '@/app/components';
import { Icon, type IconName } from './Icon';

export type BannerTone = 'info' | 'success' | 'warn' | 'danger';

const TONES: Record<BannerTone, { box: string; icon: IconName }> = {
  info: { box: 'border-blue-100 bg-blue-50 text-ink', icon: 'alert' },
  success: { box: 'border-line bg-ok-soft text-ink', icon: 'check' },
  warn: { box: 'border-line bg-warn-soft text-ink', icon: 'alert' },
  danger: { box: 'border-line bg-danger-soft text-ink', icon: 'alert' },
};

/**
 * A short, non-blocking message: "Saved", "This clashes with…", "Outside opening hours".
 *
 * `role="status"` rather than `alert` for anything that is not a failure, so a screen
 * reader announces a confirmation politely instead of interrupting.
 */
export function Banner({
  tone = 'info',
  title,
  children,
  actions,
  className,
}: {
  tone?: BannerTone;
  title?: string;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  const style = TONES[tone];

  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cx('flex gap-3 rounded-md border px-4 py-3 text-sm', style.box, className)}
    >
      <Icon name={style.icon} size={18} className="mt-0.5 text-body" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {title ? <p className="font-medium text-ink">{title}</p> : null}
        {children ? <div className="text-body">{children}</div> : null}
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
