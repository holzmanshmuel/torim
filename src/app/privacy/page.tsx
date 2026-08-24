import type { Metadata } from 'next';
import { getLang, getT, type Lang } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const lang = await getLang();
  const t = getT(lang);
  return { title: t('privacy.title') };
}

const SECTION_KEYS = [
  ['privacy.collect.title', 'privacy.collect.body'],
  ['privacy.why.title', 'privacy.why.body'],
  ['privacy.storage.title', 'privacy.storage.body'],
  ['privacy.access.title', 'privacy.access.body'],
  ['privacy.rights.title', 'privacy.rights.body'],
  ['privacy.cookies.title', 'privacy.cookies.body'],
] as const;

export default async function PrivacyPage() {
  const lang: Lang = await getLang();
  const t = getT(lang);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-16 sm:px-6 sm:py-24">
      <div className="flex flex-col gap-3">
        <h1 className="font-display text-3xl font-semibold text-ink">{t('privacy.title')}</h1>
        <p className="text-body">{t('privacy.intro')}</p>
      </div>

      {SECTION_KEYS.map(([titleKey, bodyKey]) => (
        <section key={titleKey} className="flex flex-col gap-2 border-t border-line pt-6">
          <h2 className="font-display text-lg font-semibold text-ink">{t(titleKey)}</h2>
          <p className="text-body">{t(bodyKey)}</p>
        </section>
      ))}
    </div>
  );
}
