import type { Metadata, Viewport } from 'next';
import { Space_Grotesk, Inter, IBM_Plex_Mono, Heebo } from 'next/font/google';
import Link from 'next/link';
import { dirFor, getLang, getT } from '@/lib/i18n';
import { LangProvider } from './components/LangProvider';
import './globals.css';

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
  display: 'swap',
});

const heebo = Heebo({
  subsets: ['hebrew', 'latin'],
  variable: '--font-heebo',
  display: 'swap',
});

export async function generateMetadata(): Promise<Metadata> {
  const lang = await getLang();
  const t = getT(lang);

  return {
    title: {
      default: t('brand.name'),
      template: `%s — ${t('brand.name')}`,
    },
    description: t('home.tagline'),
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  const lang = await getLang();
  const dir = dirFor(lang);
  const t = getT(lang);

  return (
    <html
      lang={lang}
      dir={dir}
      className={`${spaceGrotesk.variable} ${inter.variable} ${plexMono.variable} ${heebo.variable} antialiased`}
    >
      <body className="flex min-h-screen flex-col bg-bg text-ink">
        <a href="#main" className="skip-link">
          {t('nav.home')}
        </a>

        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
            <Link
              href="/"
              className="flex items-center gap-2 font-display text-lg font-semibold text-ink no-underline"
            >
              <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full bg-blue" />
              {t('brand.name')}
            </Link>

            <nav aria-label={t('nav.main')} className="flex items-center gap-4 text-sm">
              <Link href="/" className="text-body no-underline hover:text-blue">
                {t('nav.home')}
              </Link>
              <Link href="/privacy" className="text-body no-underline hover:text-blue">
                {t('nav.privacy')}
              </Link>
              <Link href="/accessibility" className="text-body no-underline hover:text-blue">
                {t('nav.accessibility')}
              </Link>
            </nav>
          </div>
        </header>

        <LangProvider lang={lang} dir={dir}>
          <main id="main" className="flex-1">
            {children}
          </main>
        </LangProvider>

        <footer className="border-t border-line bg-surface">
          <div className="mx-auto flex max-w-4xl flex-col gap-3 px-4 py-6 text-sm text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <p>{t('footer.tagline')}</p>
            <div className="flex items-center gap-4">
              <Link href="/privacy" className="text-muted no-underline hover:text-blue">
                {t('nav.privacy')}
              </Link>
              <Link href="/accessibility" className="text-muted no-underline hover:text-blue">
                {t('nav.accessibility')}
              </Link>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
