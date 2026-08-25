/**
 * Customers.
 *
 * Identified by phone within a business — there is no account. Everything that writes a
 * customer goes through here so normalisation happens in exactly one place; two code
 * paths normalising differently is how one person becomes two records.
 */
import { stripBidiControls } from './bidi';
import { query } from './db';
import { normalisePhone } from './phone';

export type Customer = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  blocked: boolean;
  notes: string | null;
};

type Row = {
  id: string;
  name: string;
  phone_e164: string;
  email: string | null;
  blocked: boolean;
  notes: string | null;
};

const COLUMNS = 'id, name, phone_e164, email, blocked, notes';

function toCustomer(row: Row): Customer {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone_e164,
    email: row.email,
    blocked: row.blocked,
    notes: row.notes,
  };
}

function cleanName(value: string): string {
  const name = stripBidiControls(value).replace(/\s+/g, ' ').trim();
  if (name.length === 0) throw new Error('A name is required.');
  return name;
}

export type FindOrCreateArgs = {
  name: string;
  phone: string;
  /** The business's default country code, for resolving a locally-typed number. */
  callingCode: string | null;
};

/**
 * Look a customer up by phone, creating one if there is none.
 *
 * An existing customer's stored name is never overwritten — not here either. The owner
 * curates her own list; a name typed at a booking form does not get to rewrite it.
 */
export async function findOrCreateCustomer(
  args: FindOrCreateArgs,
): Promise<Customer & { created: boolean }> {
  const phone = normalisePhone(args.phone, args.callingCode ?? '');
  const name = cleanName(args.name);

  const existing = await query<Row>(
    `SELECT ${COLUMNS} FROM torim.customers WHERE phone_e164 = $1`,
    [phone],
  );
  if (existing[0]) return { ...toCustomer(existing[0]), created: false };

  const created = await query<Row>(
    `INSERT INTO torim.customers (name, phone_e164) VALUES ($1, $2) RETURNING ${COLUMNS}`,
    [name, phone],
  );
  return { ...toCustomer(created[0]!), created: true };
}

export async function getCustomer(id: string): Promise<Customer | null> {
  const rows = await query<Row>(`SELECT ${COLUMNS} FROM torim.customers WHERE id = $1`, [id]);
  return rows[0] ? toCustomer(rows[0]) : null;
}

/**
 * Search by name or phone.
 *
 * The phone side matches on digits only, so "050 111" finds "+972501112222" — an owner
 * searching for a customer types the number the way she knows it, not in E.164.
 */
export async function searchCustomers(term: string, limit = 20): Promise<Customer[]> {
  const cleaned = stripBidiControls(term).trim();
  if (cleaned.length === 0) {
    const rows = await query<Row>(
      `SELECT ${COLUMNS} FROM torim.customers ORDER BY name LIMIT $1`,
      [limit],
    );
    return rows.map(toCustomer);
  }

  const digits = cleaned.replace(/\D/g, '');
  const rows = await query<Row>(
    `SELECT ${COLUMNS} FROM torim.customers
      WHERE name ILIKE '%' || $1 || '%'
         OR ($2 <> '' AND regexp_replace(phone_e164, '\\D', '', 'g') LIKE '%' || $2 || '%')
      ORDER BY name LIMIT $3`,
    [cleaned, digits, limit],
  );
  return rows.map(toCustomer);
}

export async function setCustomerBlocked(id: string, blocked: boolean): Promise<void> {
  await query('UPDATE torim.customers SET blocked = $2, updated_at = now() WHERE id = $1', [
    id,
    blocked,
  ]);
}

/** The owner's own note about a customer — hers to write, never shown to the customer. */
export async function setCustomerNotes(id: string, notes: string | null): Promise<void> {
  await query('UPDATE torim.customers SET notes = $2, updated_at = now() WHERE id = $1', [
    id,
    notes === null ? null : stripBidiControls(notes).trim() || null,
  ]);
}

export async function renameCustomer(id: string, name: string): Promise<void> {
  await query('UPDATE torim.customers SET name = $2, updated_at = now() WHERE id = $1', [
    id,
    cleanName(name),
  ]);
}
