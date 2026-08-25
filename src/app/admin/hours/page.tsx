import { findBusinessById } from '@/lib/businesses';
import { getLang, getT } from '@/lib/i18n';
import { HoursManager } from '../_components/HoursManager';
import { listClosures, listDateOverrides, listWorkingHours } from '../data';
import { adminDictionary } from '../dictionary';
import { todayKey } from '../format';
import { withGuard } from '../guard';
import { buildClosureViews, buildHoursViews, buildOverrideViews, makeViewContext } from '../view';

/**
 * Weekly hours, closed dates and one-off hours. Owner-only.
 *
 * Closures and one-off hours are listed from today forward: a list that also carried
 * every past closure would bury the two entries that still matter.
 */
export default async function AdminHoursPage() {
  const lang = await getLang();
  const t = getT(lang, adminDictionary);

  const data = await withGuard('manage_working_hours', async (context) => {
    const business = await findBusinessById(context.businessId);
    if (!business) return null;

    const today = todayKey(business.timezone);
    const [hours, closures, overrides] = await Promise.all([
      listWorkingHours(),
      listClosures(today),
      listDateOverrides(today),
    ]);

    const view = makeViewContext(business, lang);
    return {
      today,
      hours: buildHoursViews(hours),
      closures: buildClosureViews(closures, view),
      overrides: buildOverrideViews(overrides, view),
    };
  });

  if (!data) return null;

  return (
    <>
      <h1 className="font-display text-xl font-semibold text-ink">{t('hrs.title')}</h1>

      <HoursManager
        hours={data.hours}
        closures={data.closures}
        overrides={data.overrides}
        today={data.today}
      />
    </>
  );
}
