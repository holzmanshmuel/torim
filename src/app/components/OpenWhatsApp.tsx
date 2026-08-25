'use client';

import { useState } from 'react';
import type { Lang } from '@/lib/i18n';
import { getT } from '@/lib/i18n';
import { waMeLink } from '@/lib/phone';
import { Button, type ButtonProps } from './Button';
import { useAsyncAction } from './useAsyncAction';

export type OpenWhatsAppProps = {
  /** Customer's phone number, already normalized to E.164 (see `normalisePhone` in
   *  `@/lib/phone`) - this component builds the wa.me link, it doesn't normalize. */
  phone: string;
  /** Pre-filled WhatsApp message text. */
  message: string;
  /** Button label, e.g. `t('booking.notifyWhatsapp')`. */
  label: string;
  lang: Lang;
  /**
   * Optional server call - e.g. "mark as notified" - that runs AFTER the WhatsApp
   * tab has already opened. Never gates the open itself; its own pending/error
   * state is handled by `useAsyncAction` so it can't stick either.
   */
  onOpened?: () => Promise<void>;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  disabled?: boolean;
  className?: string;
};

/**
 * A button that opens a wa.me deep link.
 *
 * ⚠ `window.open` is called synchronously in the click handler, before anything
 * else - never after an `await`. iOS Safari treats a popup opened after an `await`
 * as outside the user gesture and silently blocks it: no error, no dialog. That
 * exact shape of bug silently broke the "notify the client" button in the
 * predecessor project - the customer was never messaged and the owner believed she
 * had, because nothing failed loudly. Do NOT make this handler `async` and move
 * `window.open` after `run()`; any follow-up server work belongs after the open,
 * as it already is below.
 */
export function OpenWhatsApp({
  phone,
  message,
  label,
  lang,
  onOpened,
  variant = 'secondary',
  size = 'md',
  disabled,
  className,
}: OpenWhatsAppProps) {
  const t = getT(lang);
  const [linkError, setLinkError] = useState<string | null>(null);
  const { run, pending, error: followUpError } = useAsyncAction(async () => {
    if (onOpened) await onOpened();
  }, { lang });

  function handleClick() {
    setLinkError(null);

    let url: string;
    try {
      url = waMeLink(phone, message);
    } catch {
      // Bad phone number - fail loudly and visibly, don't open a broken link.
      setLinkError(t('error.title'));
      return;
    }

    // MUST stay synchronous and first - see the file-level comment above.
    window.open(url, '_blank', 'noopener,noreferrer');

    if (onOpened) void run();
  }

  const displayError = linkError ?? followUpError;

  return (
    <div className="flex flex-col gap-1.5">
      <Button
        type="button"
        variant={variant}
        size={size}
        disabled={disabled}
        loading={pending}
        onClick={handleClick}
        className={className}
      >
        {label}
      </Button>
      {displayError ? (
        <p role="alert" className="text-sm text-danger">
          {displayError}
        </p>
      ) : null}
    </div>
  );
}
