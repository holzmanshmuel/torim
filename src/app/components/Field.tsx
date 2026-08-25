'use client';

import { forwardRef, useId } from 'react';
import type { InputHTMLAttributes } from 'react';
import { cx } from './cx';

export type FieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> & {
  label: string;
  hint?: string;
  error?: string;
  /** Override the generated id, e.g. to match a `name` used elsewhere. Usually
   *  unnecessary - `useId()` already keeps label/input/hint/error correctly
   *  associated with zero setup. */
  id?: string;
  containerClassName?: string;
};

/**
 * Label + input + hint + error, correctly wired via `htmlFor`/`aria-describedby`/
 * `aria-invalid`. The input inherits the global 16px minimum font size from
 * globals.css - below that, iOS Safari force-zooms on focus and stays zoomed, so
 * don't override `text-*` down past `text-base` on the input itself.
 */
export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, hint, error, id, containerClassName, className, required, ...rest },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cx('flex flex-col gap-1.5', containerClassName)}>
      <label htmlFor={inputId} className="text-sm font-medium text-ink">
        {label}
        {required ? (
          <span aria-hidden="true" className="text-danger">
            {' '}
            *
          </span>
        ) : null}
      </label>
      <input
        ref={ref}
        id={inputId}
        required={required}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        className={cx(
          'h-11 rounded-md border border-line bg-surface px-3 text-ink placeholder:text-muted',
          error ? 'border-danger' : undefined,
          className,
        )}
        {...rest}
      />
      {hint ? (
        <p id={hintId} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
});
