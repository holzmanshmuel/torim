import { Skeleton } from '@/app/components';
import { getLang, getT } from '@/lib/i18n';
import { adminDictionary } from './dictionary';

/**
 * The shape of a day while it loads.
 *
 * Placeholders rather than a spinner because the owner opens this screen on mobile data
 * dozens of times a day: matching the real layout stops the page jumping under her thumb
 * when it lands. One `label` on the whole group, not one per block — a screen reader
 * announcing "busy" eight times is worse than not announcing it at all.
 */
export default async function AdminLoading() {
  const lang = await getLang();
  const t = getT(lang, adminDictionary);

  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-11 w-full" label={t('admin.title')} />
      <Skeleton className="h-11 w-full" />
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex flex-col gap-2 rounded-md border border-line p-4">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-32" />
        </div>
      ))}
    </div>
  );
}
