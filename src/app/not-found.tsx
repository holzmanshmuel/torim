import type { Metadata } from 'next';
import Link from 'next/link';
import { getLang, getT } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const lang = await getLang();
  const t = getT(lang);
  return { title: t('notFound.title') };
}

/**
 * Also serves as the app-wide 404 for any unmatched URL (not just an explicit
 * notFound() call) - see Next's not-found.js file convention. This is deliberate:
 * a visitor opening a retired link from an installed PWA has no address bar and no
 * back button, so this page - not the framework default - is what they see, and it
 * is always in their own language.
 */
export default async function NotFound() {
  const lang = await getLang();
  const t = getT(lang);

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-start gap-4 px-4 py-16 sm:px-6 sm:py-24">
      <span className="mono-label text-muted">404</span>

      <h1 className="font-display text-3xl font-semibold text-ink">{t('notFound.title')}</h1>

      <p className="text-body">{t('notFound.description')}</p>

      <Link
        href="/"
        className="mt-2 inline-flex items-center justify-center rounded-md bg-blue px-5 py-2.5 text-sm font-medium text-surface no-underline hover:bg-blue-700"
      >
        {t('common.goHome')}
      </Link>
    </div>
  );
}
