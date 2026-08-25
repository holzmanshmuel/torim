'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cx } from '@/app/components';
import { Icon, type IconName } from './Icon';

type NavItem = { href: string; label: string; icon: IconName; ownerOnly?: boolean };

/**
 * The bottom tab bar — the app's primary navigation, because the owner runs her day
 * one-handed on a phone.
 *
 * `.pb-safe` is not optional here: without it the last row of taps lands under the iOS
 * home indicator on a notched iPhone, which is exactly the device this is for.
 *
 * Owner-only tabs are removed rather than disabled. A staff member seeing a Services tab
 * that bounces them back with "you don't have permission" teaches nothing; the real
 * check is `requirePermission` on the page itself, and this only decides what to draw.
 */
export function AdminNav({
  items,
  isOwner,
  label,
}: {
  items: NavItem[];
  isOwner: boolean;
  label: string;
}) {
  const pathname = usePathname();
  const visible = items.filter((item) => !item.ownerOnly || isOwner);

  return (
    <nav
      aria-label={label}
      className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur"
    >
      <ul className="mx-auto flex max-w-4xl items-stretch justify-around px-1 pt-1">
        {visible.map((item) => {
          // `/admin` matches only itself; everything else owns its subtree, so a
          // customer's profile page keeps the Customers tab lit.
          const active =
            item.href === '/admin'
              ? pathname === '/admin'
              : pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'flex min-h-[3.25rem] flex-col items-center justify-center gap-1 rounded-md px-1 py-1.5 text-center no-underline',
                  active ? 'text-blue' : 'text-muted hover:text-ink',
                )}
              >
                <Icon name={item.icon} size={22} />
                <span className="text-[0.7rem] font-medium leading-none">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
