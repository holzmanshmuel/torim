'use client';

import { forwardRef, useId } from 'react';
import type { SelectHTMLAttributes } from 'react';
import { cx } from './cx';

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> & {
  label: string;
  hint?: string;
  error?: string;
  id?: string;
  options: SelectOption[];
  /** Shown as a disabled first option, e.g. "Choose a service". Only meaningful
   *  when the select has no real value selected yet. */
  placeholder?: string;
  containerClassName?: string;
};

/** Same label/hint/error wrapper contract as `Field`, for a native `<select>`. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, id, options, placeholder, containerClassName, className, required, ...rest },
  ref,
) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const hintId = hint ? `${selectId}-hint` : undefined;
  const errorId = error ? `${selectId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cx('flex flex-col gap-1.5', containerClassName)}>
      <label htmlFor={selectId} className="text-sm font-medium text-ink">
        {label}
        {required ? (
          <span aria-hidden="true" className="text-danger">
            {' '}
            *
          </span>
        ) : null}
      </label>
      <select
        ref={ref}
        id={selectId}
        required={required}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        className={cx(
          'h-11 rounded-md border border-line bg-surface px-3 text-ink',
          error ? 'border-danger' : undefined,
          className,
        )}
        {...rest}
      >
        {placeholder ? (
          <option value="" disabled hidden>
            {placeholder}
          </option>
        ) : null}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
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
