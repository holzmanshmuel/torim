import { cx } from './cx';

export type SpinnerSize = 'sm' | 'md' | 'lg';

export type SpinnerProps = {
  size?: SpinnerSize;
  className?: string;
  /**
   * Accessible label, e.g. "Loading available times". Only pass this when the
   * spinner is the sole indicator that something is busy - omit it when the
   * spinner sits inside an element that already announces its own busy state
   * (e.g. `Button`'s `aria-busy`), otherwise screen readers announce it twice.
   */
  label?: string;
};

const SIZE_CLASSES: Record<SpinnerSize, string> = {
  sm: 'h-4 w-4',
  md: 'h-6 w-6',
  lg: 'h-9 w-9',
};

/** A spinning indicator. Color follows `currentColor`, so it matches whatever text
 *  color it's placed in (a colored Button, a muted panel, etc.) with no extra prop. */
export function Spinner({ size = 'md', className, label }: SpinnerProps) {
  return (
    <span
      role={label ? 'status' : undefined}
      aria-live={label ? 'polite' : undefined}
      aria-hidden={label ? undefined : true}
      className={cx('inline-flex items-center justify-center', className)}
    >
      <svg
        className={cx('animate-spin text-current', SIZE_CLASSES[size])}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path
          className="opacity-90"
          fill="currentColor"
          d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z"
        />
      </svg>
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}
