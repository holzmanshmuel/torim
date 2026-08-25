'use client';

import type { ReactNode } from 'react';
import { Button, type ButtonProps } from './Button';
import { Sheet } from './Sheet';

export type ConfirmDialogProps = {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title?: ReactNode;
  /**
   * The specific thing being destroyed, e.g. "Cancel the 14:00 appointment for Dana
   * Cohen?" - never a generic "Are you sure?". If the message embeds a date, time,
   * or price, wrap that value with `isolate()` from `@/lib/bidi` before passing it
   * in (this component renders whatever it's given as-is).
   */
  message: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  /** Accessible label for `Sheet`'s close (X) button. */
  closeLabel: string;
  /** Wire this to a `useAsyncAction`'s `pending` so a slow destructive call can't
   *  be double-submitted and never leaves the dialog stuck on "one moment...". */
  confirmPending?: boolean;
  confirmVariant?: ButtonProps['variant'];
};

/** `Sheet`, pre-wired for a destructive confirmation: cancel/confirm footer, safe-area
 *  padding under the confirm button, and a `danger`-styled confirm by default. */
export function ConfirmDialog({
  open,
  onCancel,
  onConfirm,
  title,
  message,
  confirmLabel,
  cancelLabel,
  closeLabel,
  confirmPending = false,
  confirmVariant = 'danger',
}: ConfirmDialogProps) {
  return (
    <Sheet
      open={open}
      onClose={onCancel}
      title={title}
      closeLabel={closeLabel}
      footer={
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onCancel} disabled={confirmPending}>
            {cancelLabel}
          </Button>
          <Button variant={confirmVariant} onClick={onConfirm} loading={confirmPending}>
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <p className="text-body">{message}</p>
    </Sheet>
  );
}
