'use client';

import { useState } from 'react';
import { OpenWhatsApp, Select, useLang } from '@/app/components';
import { getT } from '@/lib/i18n';
import { adminDictionary } from '../dictionary';
import type { BookingView } from '../types';

type MessageKind = keyof BookingView['whatsappMessages'];

const KINDS: MessageKind[] = ['about', 'confirmed', 'moved', 'cancelled'];

/**
 * Owner-initiated messaging, and nothing else.
 *
 * Torim never sends a customer anything on its own. The text is composed on the server
 * in the *business's* language, shown here in full and editable, and only leaves the
 * device when the owner taps the button — which opens WhatsApp with it prefilled and
 * still requires her to press send there.
 *
 * The tap itself goes through `OpenWhatsApp`, whose `window.open` is synchronous and
 * first in the click handler. Do not add an `await` before it: iOS Safari silently
 * blocks a popup opened after one — no error, no dialog — which is precisely how the
 * predecessor's "notify the client" button stopped working while the owner believed
 * every customer had been told.
 */
export function WhatsAppComposer({
  booking,
  defaultKind = 'about',
}: {
  booking: BookingView;
  defaultKind?: MessageKind;
}) {
  const { lang } = useLang();
  const t = getT(lang, adminDictionary);

  const [kind, setKind] = useState<MessageKind>(defaultKind);
  const [text, setText] = useState(booking.whatsappMessages[defaultKind]);

  function chooseKind(next: MessageKind) {
    setKind(next);
    setText(booking.whatsappMessages[next]);
  }

  return (
    <div className="flex flex-col gap-3">
      <Select
        label={t('wa.pick')}
        value={kind}
        onChange={(event) => chooseKind(event.target.value as MessageKind)}
        options={KINDS.map((value) => ({ value, label: t(`wa.kind.${value}`) }))}
      />

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-ink">{t('wa.message')}</span>
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={3}
          className="rounded-md border border-line bg-surface px-3 py-2 text-ink"
        />
      </label>

      <p className="text-sm text-muted">{t('wa.neverAuto')}</p>

      <OpenWhatsApp
        phone={booking.customer.phone}
        message={text}
        label={t('day.whatsapp')}
        lang={lang}
      />
    </div>
  );
}
