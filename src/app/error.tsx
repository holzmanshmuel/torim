'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { getT } from '@/lib/i18n';
import { useLang } from './components/LangProvider';

export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const { lang } = useLang();
  const t = getT(lang);

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-start gap-4 px-4 py-16 sm:px-6 sm:py-24">
      <span className="mono-label rounded-sm bg-warn-soft px-2 py-1 text-warn">
        {t('error.badge')}
      </span>

      <h1 className="font-display text-3xl font-semibold text-ink">{t('error.title')}</h1>

      <p className="text-body">{t('error.description')}</p>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={retry}
          className="inline-flex items-center justify-center rounded-md bg-blue px-5 py-2.5 text-sm font-medium text-surface hover:bg-blue-700"
        >
          {t('common.tryAgain')}
        </button>

        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-md border border-line px-5 py-2.5 text-sm font-medium text-ink no-underline hover:border-blue hover:text-blue"
        >
          {t('common.goHome')}
        </Link>
      </div>
    </div>
  );
}
