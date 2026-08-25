import { findBusinessById } from '@/lib/businesses';
import { getLang, getT } from '@/lib/i18n';
import { ServicesManager } from '../_components/ServicesManager';
import { listAdminServices } from '../data';
import { adminDictionary } from '../dictionary';
import { withGuard } from '../guard';
import { buildServiceViews, makeViewContext } from '../view';

/**
 * The service catalogue. Owner-only — `manage_services` is not in `STAFF_ACTIONS`, and
 * the guard is what enforces that, not the hidden nav tab.
 */
export default async function AdminServicesPage() {
  const lang = await getLang();
  const t = getT(lang, adminDictionary);

  const data = await withGuard('manage_services', async (context) => {
    const business = await findBusinessById(context.businessId);
    if (!business) return null;

    const services = await listAdminServices();
    const view = makeViewContext(business, lang);
    return { services: buildServiceViews(services, view), currency: business.currency };
  });

  if (!data) return null;

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-xl font-semibold text-ink">{t('svc.title')}</h1>
        <p className="text-body">{t('svc.intro')}</p>
      </div>

      {data.services.length === 0 ? (
        <div className="rounded-md border border-dashed border-line px-6 py-10 text-center">
          <p className="font-display text-lg font-semibold text-ink">{t('svc.empty.title')}</p>
          <p className="mt-2 text-body">{t('svc.empty.message')}</p>
        </div>
      ) : null}

      <ServicesManager services={data.services} currency={data.currency} />
    </>
  );
}
