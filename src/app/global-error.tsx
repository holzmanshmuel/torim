'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { dirFor, getT, parseLangCookie, type Lang } from '@/lib/i18n';
import './globals.css';

/**
 * This file replaces the root layout entirely when it activates (see Next's
 * global-error.js convention), so `LangProvider` never wraps it and it cannot use
 * the server-only `getLang()`. It reads the `lang` cookie itself, client-side, but
 * still routes the raw value through the shared `parseLangCookie` and looks up
 * copy through the shared `getT`, so the he/en decision and the dictionary both
 * still have exactly one source of truth: src/lib/i18n.ts.
 */

const LANG_COOKIE_RE = /(?:^|;\s*)lang=([^;]+)/;

function readLangCookie(): Lang {
  if (typeof document === 'undefined') return 'en';
  const match = document.cookie.match(LANG_COOKIE_RE);
  return parseLangCookie(match ? decodeURIComponent(match[1]) : undefined);
}

// The cookie is static for the life of this crashed page - there is nothing to
// subscribe to, so this is a no-op. useSyncExternalStore (rather than an effect
// that calls setState) is what lets the client read a browser-only value without
// a server/client hydration mismatch.
function subscribe(): () => void {
  return () => {};
}

function getServerSnapshot(): Lang {
  return 'en';
}

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  // English for the server-rendered snapshot, the real cookie value once mounted in
  // the browser - useSyncExternalStore keeps that consistent without a hydration
  // mismatch.
  const lang = useSyncExternalStore(subscribe, readLangCookie, getServerSnapshot);
  const t = getT(lang);

  useEffect(() => {
    console.error(error);
  }, [error]);

  const dir = dirFor(lang);

  return (
    <html lang={lang} dir={dir}>
      <body className="flex min-h-screen items-center justify-center bg-bg px-4 py-16 text-ink">
        <div className="mx-auto flex max-w-md flex-col items-start gap-4 rounded-md border border-line bg-surface p-8 shadow-soft">
          <span className="mono-label rounded-sm bg-warn-soft px-2 py-1 text-warn">
            {t('error.badge')}
          </span>

          <h1 className="font-display text-2xl font-semibold text-ink">
            {t('globalError.title')}
          </h1>

          <p className="text-body">{t('globalError.description')}</p>

          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={retry}
              className="inline-flex items-center justify-center rounded-md bg-blue px-5 py-2.5 text-sm font-medium text-surface hover:bg-blue-700"
            >
              {t('globalError.reload')}
            </button>

            {/* A real navigation, not next/link: the root layout itself failed to
                render, so client-side routing may not be trustworthy here either. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              className="inline-flex items-center justify-center rounded-md border border-line px-5 py-2.5 text-sm font-medium text-ink no-underline hover:border-blue hover:text-blue"
            >
              {t('common.goHome')}
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
