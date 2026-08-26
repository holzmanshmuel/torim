import Link from 'next/link';
import { redirect } from 'next/navigation';
import { describeInstance, type InstanceShape } from '@/lib/businesses';
import { getLang, getT } from '@/lib/i18n';

/**
 * The instance front door.
 *
 * There is no single true `/` for Torim, because there is no single shape of
 * deployment. The same build serves one salon on a Raspberry Pi and a shared host with
 * fifty tenants, and those want different pages — so this asks the database which one
 * it is and answers accordingly:
 *
 *   empty  — nothing created yet. The visitor is the operator who just deployed this;
 *            send them to sign in and create the first business.
 *   single — the common self-hosted case. `/` *is* that shop's booking page, so go
 *            there. No configuration, no env var: one business is one business.
 *   multi  — a shared instance. Say what Torim is, point owners at sign-in, and tell
 *            customers to use the link their business gave them.
 *
 * What the multi case deliberately does NOT do is list the businesses. People trim
 * URLs, and the visitor who lands here after chopping `/b/some-shop` off the end is
 * owed a way forward — but not a directory of everyone else hosted alongside them.
 * `describeInstance()` stops counting at two precisely so that list is never built.
 *
 * Rendered per request: the answer changes the moment someone completes onboarding,
 * and a `/` cached at build time would tell the first owner their own instance is
 * still empty.
 */
export const dynamic = 'force-dynamic';

/**
 * `/` is the one route that must never 500. not-found.tsx sends every visitor who
 * followed a dead link here, so a database that does not answer has to degrade rather
 * than throw — otherwise the escape hatch from a 404 is a 500.
 *
 * The shared landing is the safe default because it is true of every instance: it
 * names no business and promises nothing about this deployment's contents. A
 * single-business install loses one redirect until the database is back; nobody reads
 * a false sentence.
 *
 * Kept out of the caller so the `redirect()` below is never inside a `try` — it
 * signals by throwing, and a catch would swallow it.
 */
async function resolveShape(): Promise<InstanceShape> {
  try {
    return await describeInstance();
  } catch (error) {
    console.error('[home] could not read the business list; showing the shared landing', error);
    return { kind: 'multi' };
  }
}

const CTA_CLASS =
  'inline-flex w-fit items-center justify-center rounded-md bg-blue px-5 py-2.5 text-sm font-medium text-surface no-underline hover:bg-blue-700';

const CARD_CLASS = 'flex flex-col gap-2 rounded-md border border-line bg-surface px-5 py-5 shadow-soft';

export default async function Home() {
  const lang = await getLang();
  const t = getT(lang);

  const shape = await resolveShape();

  if (shape.kind === 'single') {
    redirect(`/b/${shape.slug}`);
  }

  if (shape.kind === 'empty') {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col items-start gap-6 px-4 py-16 sm:px-6 sm:py-24">
        <span className="mono-label rounded-sm bg-lime-soft px-2 py-1 text-lime-ink">
          {t('home.setup.badge')}
        </span>

        <h1 className="font-display text-3xl font-semibold leading-tight text-ink sm:text-4xl">
          {t('home.setup.heading')}
        </h1>

        <p className="max-w-xl text-lg text-body">{t('home.setup.body')}</p>

        <Link href="/login" className={CTA_CLASS}>
          {t('home.setup.cta')}
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-start gap-6 px-4 py-16 sm:px-6 sm:py-24">
      <span className="mono-label rounded-sm bg-lime-soft px-2 py-1 text-lime-ink">
        {t('home.badge')}
      </span>

      <h1 className="font-display text-3xl font-semibold leading-tight text-ink sm:text-4xl">
        {t('home.heading')}
      </h1>

      <p className="max-w-xl text-lg text-body">{t('home.tagline')}</p>

      <div className="flex w-full flex-col gap-4">
        <section className={CARD_CLASS}>
          <h2 className="font-display text-lg font-semibold text-ink">{t('home.book.title')}</h2>
          <p className="text-body">{t('home.book.body')}</p>
        </section>

        <section className={CARD_CLASS}>
          <h2 className="font-display text-lg font-semibold text-ink">{t('home.owner.title')}</h2>
          <p className="text-body">{t('home.owner.body')}</p>
          <Link href="/login" className={`${CTA_CLASS} mt-2`}>
            {t('home.owner.cta')}
          </Link>
        </section>
      </div>
    </div>
  );
}
