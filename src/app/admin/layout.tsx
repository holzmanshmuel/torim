import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { countUnseenChanges } from '@/lib/admin-bookings';
import { findBusinessById } from '@/lib/businesses';
import { getLang, getT } from '@/lib/i18n';
import { AdminNav } from './_components/AdminNav';
import { Icon } from './_components/Icon';
import { adminDictionary } from './dictionary';
import { interpolate } from './format';
import { withGuard } from './guard';
import { businessDisplayName } from './view';

export async function generateMetadata(): Promise<Metadata> {
  const lang = await getLang();
  return { title: getT(lang, adminDictionary)('admin.title') };
}

const NAV_ITEMS = [
  { href: '/admin', labelKey: 'admin.nav.day', icon: 'day' as const },
  { href: '/admin/week', labelKey: 'admin.nav.week', icon: 'week' as const },
  { href: '/admin/customers', labelKey: 'admin.nav.customers', icon: 'customers' as const },
  { href: '/admin/services', labelKey: 'admin.nav.services', icon: 'services' as const, ownerOnly: true },
  { href: '/admin/hours', labelKey: 'admin.nav.hours', icon: 'hours' as const, ownerOnly: true },
];

/**
 * The admin shell: who you are, what needs your attention, and where to go.
 *
 * The unseen-changes badge lives up here rather than on one screen because it is the
 * only way the owner ever learns a customer cancelled — messaging is owner-initiated,
 * so nothing arrives to tell her. It replaced a nightly digest that lost every
 * cancellation landing between the evening run and midnight.
 *
 * The count is a live query, not a cached number: `refresh()` in every mutating action
 * re-renders this layout, so acknowledging a change updates the badge in the same
 * round trip that clears it.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const shell = await withGuard('view_schedule', async (context) => {
    const [business, unseen] = await Promise.all([
      findBusinessById(context.businessId),
      countUnseenChanges(),
    ]);
    return { business, unseen, role: context.role };
  });

  const lang = await getLang();
  const t = getT(lang, adminDictionary);
  const name = shell.business ? businessDisplayName(shell.business, lang) : t('admin.title');

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col">
      <div className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
        <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link
            href="/admin"
            className="min-w-0 truncate font-display text-base font-semibold text-ink no-underline"
          >
            {name}
          </Link>

          <div className="flex shrink-0 items-center gap-1">
            <Link
              href="/admin/changes"
              aria-label={
                shell.unseen > 0
                  ? interpolate(t('admin.changesBadge'), { count: shell.unseen })
                  : t('admin.changesLink')
              }
              className="relative inline-flex h-11 w-11 items-center justify-center rounded-md text-body no-underline hover:bg-panel hover:text-ink"
            >
              <Icon name="bell" size={20} />
              {shell.unseen > 0 ? (
                <span
                  aria-hidden="true"
                  className="absolute end-1.5 top-1.5 inline-flex min-w-[1.15rem] items-center justify-center rounded-full bg-danger px-1 text-[0.65rem] font-semibold leading-[1.15rem] text-surface"
                >
                  {shell.unseen > 99 ? '99+' : shell.unseen}
                </span>
              ) : null}
            </Link>

            <Link
              href="/admin/settings"
              aria-label={t('a.settings')}
              className="inline-flex h-11 w-11 items-center justify-center rounded-md text-body no-underline hover:bg-panel hover:text-ink"
            >
              <Icon name="settings" size={20} />
            </Link>
          </div>
        </div>
      </div>

      {/* Bottom padding clears the fixed tab bar plus its safe-area inset. */}
      <div className="flex flex-col gap-5 px-4 pb-32 pt-5 sm:px-6">{children}</div>

      <AdminNav
        label={t('admin.nav.label')}
        isOwner={shell.role === 'owner'}
        items={NAV_ITEMS.map((item) => ({
          href: item.href,
          icon: item.icon,
          label: t(item.labelKey),
          ownerOnly: item.ownerOnly,
        }))}
      />
    </div>
  );
}
