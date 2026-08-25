'use client';

import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { cx } from './cx';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export type SheetProps = {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  /** Accessible label for the close button, e.g. `t('common.close')`. Required -
   *  there's no generic key in this repo's dictionary to guess a default from. */
  closeLabel: string;
  children: ReactNode;
  /** Rendered in a footer strip that gets safe-area bottom padding, so a primary
   *  action placed here always clears the iOS home-indicator. */
  footer?: ReactNode;
  className?: string;
};

/**
 * Bottom sheet on mobile, centered dialog from `sm:` up. Traps focus, closes on
 * Escape, restores focus to whatever triggered it on close, and is `aria-modal`.
 */
export function Sheet({ open, onClose, title, closeLabel, children, footer, className }: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const generatedTitleId = useId();
  const titleId = title ? generatedTitleId : undefined;

  // Remember what had focus before opening, so it can be restored on close - a
  // keyboard or screen-reader user otherwise loses their place in the page.
  useEffect(() => {
    if (open) {
      previouslyFocused.current = document.activeElement as HTMLElement | null;
    } else {
      previouslyFocused.current?.focus?.();
    }
  }, [open]);

  // Lock background scroll while the sheet is open.
  useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, [open]);

  // Move focus in on open, trap Tab/Shift+Tab inside the panel, close on Escape.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;

    const getFocusable = () => Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));

    const initial = getFocusable();
    (initial[0] ?? panel).focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const items = getFocusable();
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div aria-hidden="true" onClick={onClose} className="absolute inset-0 bg-ink/40" />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cx(
          'relative flex max-h-[90vh] w-full flex-col overflow-hidden rounded-t-md border border-line bg-surface shadow-soft',
          'sm:max-w-lg sm:rounded-md',
          className,
        )}
      >
        <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
          {title ? (
            <h2 id={titleId} className="font-display text-lg font-semibold text-ink">
              {title}
            </h2>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-sm text-muted hover:bg-panel hover:text-ink"
          >
            <span aria-hidden="true">&times;</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer ? <div className="pb-safe border-t border-line px-5 pt-4">{footer}</div> : null}
      </div>
    </div>
  );
}
