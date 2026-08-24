'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { Lang } from '@/lib/i18n';

type LangContextValue = { lang: Lang; dir: 'rtl' | 'ltr' };

const LangContext = createContext<LangContextValue | null>(null);

/**
 * Makes the language resolved server-side by the root layout available to Client
 * Components further down the tree (e.g. `error.tsx`, which must be a Client
 * Component and therefore cannot call the server-only `getLang()`). This avoids
 * re-deriving the language client-side, so there is no flash of the wrong language.
 *
 * Not available to `global-error.tsx`: that file replaces the root layout entirely
 * when it activates, so this provider never wraps it. It reads the cookie itself.
 */
export function LangProvider({
  lang,
  dir,
  children,
}: LangContextValue & { children: ReactNode }) {
  return <LangContext.Provider value={{ lang, dir }}>{children}</LangContext.Provider>;
}

export function useLang(): LangContextValue {
  const ctx = useContext(LangContext);
  if (!ctx) {
    // Should not happen: the root layout always wraps the tree in LangProvider.
    // Fail soft to English rather than throwing in a UI that is often itself
    // rendering error/fallback state.
    return { lang: 'en', dir: 'ltr' };
  }
  return ctx;
}
