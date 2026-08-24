import { getLang, getT } from '@/lib/i18n';

export default async function Home() {
  const lang = await getLang();
  const t = getT(lang);

  return (
    <div className="mx-auto flex max-w-3xl flex-col items-start gap-6 px-4 py-16 sm:px-6 sm:py-24">
      <span className="mono-label rounded-sm bg-lime-soft px-2 py-1 text-lime-ink">
        {t('home.badge')}
      </span>

      <h1 className="font-display text-4xl font-semibold leading-tight text-ink sm:text-5xl">
        {t('home.heading')}
      </h1>

      <p className="max-w-xl text-lg text-body">{t('home.tagline')}</p>

      <p className="max-w-xl text-body">{t('home.description')}</p>
    </div>
  );
}
