import { cx } from './cx';

export type SkeletonProps = {
  /** Size the block with utility classes, e.g. `h-4 w-32`, `h-24 w-full`. */
  className?: string;
  /**
   * Accessible label, e.g. "Loading appointment details". Pass this on exactly one
   * `Skeleton` per loading group - wrapping several placeholder blocks in one
   * labelled region reads far better to a screen reader than announcing "busy"
   * once per block.
   */
  label?: string;
};

/** A pulsing placeholder block for content that hasn't loaded yet. */
export function Skeleton({ className, label }: SkeletonProps) {
  return (
    <div
      role={label ? 'status' : undefined}
      aria-live={label ? 'polite' : undefined}
      aria-busy={label ? true : undefined}
      className={cx('animate-pulse rounded-sm bg-panel', className)}
    >
      {label ? <span className="sr-only">{label}</span> : null}
    </div>
  );
}
