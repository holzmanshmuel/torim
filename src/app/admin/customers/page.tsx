import Link from 'next/link';
import { searchCustomers } from '@/lib/customers';
import { getLang, getT } from '@/lib/i18n';
import { adminDictionary } from '../dictionary';
import { phone } from '../format';
import { withGuard } from '../guard';

/**
 * The customer list.
 *
 * Search is a plain GET form rather than a live typeahead: it works with no JavaScript,
 * the result is a shareable URL, and `searchCustomers` already matches a name OR any run
 * of digits from the phone number — so "050 111" finds "+972501112222", which is how an
 * owner actually remembers a number.
 */
export default async function AdminCustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const params = await searchParams;
  const term = (params.q ?? '').trim();
  const lang = await getLang();
  const t = getT(lang, adminDictionary);

  const customers = await withGuard('manage_customers', async () => searchCustomers(term, 100));

  return (
    <>
      <h1 className="font-display text-xl font-semibold text-ink">{t('cus.title')}</h1>

      <form method="get" className="flex flex-col gap-2">
        <label htmlFor="customer-search" className="text-sm font-medium text-ink">
          {t('cus.search')}
        </label>
        <div className="flex gap-2">
          <input
            id="customer-search"
            name="q"
            type="search"
            defaultValue={term}
            autoComplete="off"
            className="h-11 min-w-0 flex-1 rounded-md border border-line bg-surface px-3 text-ink placeholder:text-muted"
          />
          <button
            type="submit"
            className="inline-flex h-11 shrink-0 items-center justify-center rounded-md bg-blue px-5 text-sm font-medium text-surface"
          >
            {t('a.search')}
          </button>
        </div>
        <p className="text-sm text-muted">{t('cus.searchHint')}</p>
      </form>

      {term ? (
        <Link href="/admin/customers" className="text-sm text-blue no-underline hover:underline">
          {t('cus.clearSearch')}
        </Link>
      ) : null}

      {customers.length === 0 ? (
        <div className="rounded-md border border-dashed border-line px-6 py-10 text-center">
          <p className="font-display text-lg font-semibold text-ink">
            {t(term ? 'cus.noResults.title' : 'cus.empty.title')}
          </p>
          <p className="mt-2 text-body">
            {t(term ? 'cus.noResults.message' : 'cus.empty.message')}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {customers.map((customer) => (
            <li key={customer.id}>
              <Link
                href={`/admin/customers/${customer.id}`}
                className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface px-4 py-3 no-underline shadow-soft hover:border-blue"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-ink">{customer.name}</span>
                  <span className="block text-sm text-muted">{phone(customer.phone)}</span>
                </span>
                {customer.blocked ? (
                  <span className="mono-label shrink-0 rounded-sm bg-danger-soft px-2 py-1 text-danger">
                    {t('cus.blocked')}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
