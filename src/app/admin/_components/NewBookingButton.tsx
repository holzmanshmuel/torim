'use client';

import { useState } from 'react';
import { Button, useLang } from '@/app/components';
import { getT } from '@/lib/i18n';
import { adminDictionary } from '../dictionary';
import type { ServiceOption } from '../types';
import { Icon } from './Icon';
import { NewBookingSheet } from './NewBookingSheet';

/**
 * The way into manual entry.
 *
 * Rendered inline (not as a floating pill over the list) because the bottom of the
 * screen already belongs to the tab bar and the safe-area inset — a floating button
 * there would sit on top of the nav on exactly the phone this is designed for.
 */
export function NewBookingButton({
  services,
  defaultDate,
  defaultTime,
  full = false,
}: {
  services: ServiceOption[];
  defaultDate: string;
  defaultTime: string;
  full?: boolean;
}) {
  const { lang } = useLang();
  const t = getT(lang, adminDictionary);
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)} className={full ? 'w-full' : undefined}>
        <Icon name="plus" size={18} />
        {t('day.new')}
      </Button>

      <NewBookingSheet
        open={open}
        onClose={() => setOpen(false)}
        services={services}
        defaultDate={defaultDate}
        defaultTime={defaultTime}
      />
    </>
  );
}
