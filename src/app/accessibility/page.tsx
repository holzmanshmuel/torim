import type { Metadata } from 'next';
import { getLang, getT, type Lang } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const lang = await getLang();
  const t = getT(lang);
  return { title: t('accessibility.title') };
}

export default async function AccessibilityPage() {
  const lang: Lang = await getLang();
  const t = getT(lang);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-16 sm:px-6 sm:py-24">
      <div className="flex flex-col gap-3">
        <h1 className="font-display text-3xl font-semibold text-ink">
          {t('accessibility.title')}
        </h1>
        <p className="text-body">{t('accessibility.intro')}</p>
      </div>

      <section className="flex flex-col gap-2 border-t border-line pt-6">
        <h2 className="font-display text-lg font-semibold text-ink">
          {t('accessibility.standard.title')}
        </h2>
        <p className="text-body">{t('accessibility.standard.body')}</p>
      </section>

      <section className="flex flex-col gap-2 border-t border-line pt-6">
        <h2 className="font-display text-lg font-semibold text-ink">
          {t('accessibility.contact.title')}
        </h2>
        <p className="text-body">{t('accessibility.contact.body')}</p>
        <p className="text-sm text-muted">{t('accessibility.response.body')}</p>
      </section>
    </div>
  );
}
