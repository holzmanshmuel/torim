import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession, safeRedirectPath } from '@/lib/auth';
import { getLang, getT } from '@/lib/i18n';
import { adminDictionary } from '@/app/admin/dictionary';

export async function generateMetadata(): Promise<Metadata> {
  const lang = await getLang();
  return { title: getT(lang, adminDictionary)('login.title') };
}

/** Every reason the OAuth routes can bounce someone back here. */
const KNOWN_ERRORS = new Set([
  'access_denied',
  'no_membership',
  'state_missing',
  'state_mismatch',
  'code_missing',
  'token_exchange_failed',
  'userinfo_failed',
  'email_unverified',
  'misconfigured',
  'signin_failed',
]);

/** Google's brand mark. Inline so the button never renders as a blank square. */
function GoogleMark() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18" focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

/**
 * Sign in.
 *
 * A real front door rather than a debug link: this is the first screen a shop owner ever
 * sees, and it is also where every failed sign-in lands. Each `?error=` reason gets its
 * own sentence saying what happened and what to do — "no_membership" in particular is
 * not a failure at all, it is someone signing in with the wrong Google account, and
 * saying so saves a support call.
 *
 * `?next=` is laundered through `safeRedirectPath` before it is put back on the link. An
 * open redirect on a sign-in route is a phishing primitive precisely because the victim
 * genuinely did start on our domain.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const params = await searchParams;
  const lang = await getLang();
  const t = getT(lang, adminDictionary);

  // Already signed in? Send them where they were going instead of asking again.
  const session = await getSession();
  if (session.userId) {
    redirect(session.businessId ? '/admin' : '/onboarding');
  }

  const next = safeRedirectPath(params.next);
  const signInHref = next ? `/api/auth/google?next=${encodeURIComponent(next)}` : '/api/auth/google';

  const errorKey =
    params.error && KNOWN_ERRORS.has(params.error)
      ? `login.error.${params.error}`
      : params.error
        ? 'login.error.signin_failed'
        : null;

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-8 px-4 py-16 sm:px-6 sm:py-24">
      <div className="flex flex-col gap-3">
        <span className="mono-label inline-flex w-fit items-center gap-2 rounded-sm bg-blue-50 px-2 py-1 text-blue">
          <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-blue" />
          {t('brand.name')}
        </span>

        <h1 className="font-display text-3xl font-semibold leading-tight text-ink">
          {t('login.heading')}
        </h1>

        <p className="text-body">{t('login.tagline')}</p>
      </div>

      {errorKey ? (
        <div
          role="alert"
          className="flex flex-col gap-1 rounded-md border border-line bg-warn-soft px-4 py-3"
        >
          <p className="text-sm font-medium text-ink">{t('login.error.title')}</p>
          <p className="text-sm text-body">{t(errorKey)}</p>
        </div>
      ) : null}

      <div className="flex flex-col gap-4 rounded-md border border-line bg-surface px-5 py-6 shadow-soft">
        <a
          href={signInHref}
          className="inline-flex h-12 w-full items-center justify-center gap-3 rounded-md border border-line bg-surface px-5 text-sm font-medium text-ink no-underline hover:border-blue hover:text-blue"
        >
          <GoogleMark />
          {t('login.google')}
        </a>

        <p className="text-sm text-muted">{t('login.why')}</p>
      </div>

      <p className="text-sm text-muted">
        {t('login.legal')}{' '}
        <Link href="/privacy" className="text-blue no-underline hover:underline">
          {t('nav.privacy')}
        </Link>
        {' · '}
        <Link href="/accessibility" className="text-blue no-underline hover:underline">
          {t('nav.accessibility')}
        </Link>
      </p>
    </div>
  );
}
