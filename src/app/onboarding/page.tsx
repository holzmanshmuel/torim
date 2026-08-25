import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getLang, getT } from '@/lib/i18n';
import { getMembershipsForUser } from '@/lib/users';
import { adminDictionary } from '@/app/admin/dictionary';
import { OnboardingForm } from './OnboardingForm';

export async function generateMetadata(): Promise<Metadata> {
  const lang = await getLang();
  return { title: getT(lang, adminDictionary)('onb.title') };
}

/**
 * Signed in, but no business yet — the normal first-run state, not an error.
 *
 * Someone who *does* already hold a membership should never see this form: they arrived
 * with a session that lost its active business (a cleared cookie, a new device), so they
 * are handed straight back into the business they own rather than being invited to
 * create a second one.
 */
export default async function OnboardingPage() {
  const lang = await getLang();
  const t = getT(lang, adminDictionary);

  const session = await getSession();
  if (!session.userId) redirect('/login?next=/onboarding');
  if (session.businessId) redirect('/admin');

  const memberships = await getMembershipsForUser(session.userId);
  if (memberships.length > 0) {
    // The session can be re-pointed at their existing business only from a route handler
    // or Server Action — a Server Component may not set cookies mid-render — so send
    // them through sign-in, which does exactly that and lands them on /admin.
    redirect('/api/auth/google');
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-12 sm:px-6 sm:py-16">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-2xl font-semibold text-ink">{t('onb.heading')}</h1>
        <p className="text-body">{t('onb.intro')}</p>
      </div>

      <OnboardingForm defaultTimezone="Asia/Jerusalem" />
    </div>
  );
}
