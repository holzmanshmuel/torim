'use client';

import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and disables the button. Does not change its label - pass
   *  different `children` yourself if you want the text to change too. */
  loading?: boolean;
  children: ReactNode;
};

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-blue text-surface hover:bg-blue-700',
  secondary: 'border border-line text-ink hover:border-blue hover:text-blue',
  ghost: 'text-body hover:bg-panel hover:text-ink',
  danger: 'bg-danger text-surface hover:brightness-90',
};

// h-11 (44px) is the accessible minimum touch target - do not shrink `md`.
const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-9 gap-1.5 px-3 text-sm',
  md: 'h-11 gap-2 px-5 text-sm',
  lg: 'h-14 gap-2.5 px-6 text-base',
};

/**
 * The one button primitive every lane should use. A real `<button>` (never a styled
 * `<div>`), so keyboard activation, disabled semantics, and form submission all work
 * for free. Visible focus is handled globally by `:focus-visible` in globals.css.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, disabled, className, children, type = 'button', ...rest },
  ref,
) {
  const isDisabled = disabled || loading;

  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex items-center justify-center rounded-md font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size="sm" /> : null}
      {children}
    </button>
  );
});
