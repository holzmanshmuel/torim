import Link from 'next/link';
import { notFound } from 'next/navigation';
import { findBusinessById } from '@/lib/businesses';
import { getCustomer } from '@/lib/customers';
import { getLang, getT } from '@/lib/i18n';
import { CustomerProfile } from '../../_components/CustomerProfile';
import { listCustomerVisits } from '../../data';
import { adminDictionary } from '../../dictionary';
import { phone } from '../../format';
import { withGuard } from '../../guard';
import type { VisitView } from '../../types';
import { buildVisitView, makeViewContext } from '../../view';

/**
 * One customer's profile.
 *
 * `getCustomer` is tenant-scoped, so another business's customer id resolves to null
 * here and this renders a 404 — the same answer as an id that never existed, which is
 * the only answer that does not confirm the row is real somewhere else.
 */
export default async function AdminCustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const lang = await getLang();
  const t = getT(lang, adminDictionary);

  const data = await withGuard('manage_customers', async (context) => {
    const business = await findBusinessById(context.businessId);
    if (!business) return null;

    const customer = await getCustomer(id);
    if (!customer) return null;

    const visits = await listCustomerVisits(customer.id);
    const view = makeViewContext(business, lang);

    return {
      customer: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        phoneLabel: phone(customer.phone),
        blocked: customer.blocked,
        notes: customer.notes,
      },
      visits: visits.map((visit): VisitView => buildVisitView(visit, view)),
    };
  });

  if (!data) notFound();

  return (
    <>
      <Link href="/admin/customers" className="text-sm text-blue no-underline hover:underline">
        {t('cus.backToList')}
      </Link>

      <h1 className="font-display text-xl font-semibold text-ink">{data.customer.name}</h1>

      <CustomerProfile customer={data.customer} visits={data.visits} />
    </>
  );
}
