/**
 * Users, memberships and business creation — the pre-tenant reads and writes.
 *
 * Everything here runs *before* a tenant context exists: signing in, listing which
 * businesses a person may administer, and onboarding an owner whose business does not
 * exist yet. So every call uses the `systemQuery`/`withSystemTransaction` path from
 * db.ts, never `query()` — `query()` would throw "No tenant context", and the tables it
 * touches (torim.users / businesses / memberships) are deliberately outside RLS for
 * exactly this reason (see scripts/sql/001_tenancy.sql).
 *
 * This is the one part of the codebase where the RLS safety net is not underneath us,
 * so each function is narrow and every one of them filters by an id the caller has
 * already proven it owns.
 */
import { systemQuery, systemQueryOne } from './db';
import { isRole, type Role } from './auth';

export interface UserRecord {
  id: string;
  googleSub: string;
  email: string;
  name: string | null;
}

interface UserRow {
  id: string;
  google_sub: string;
  email: string;
  name: string | null;
}

/**
 * Find-or-create the signed-in person, keyed on Google's `sub`.
 *
 * Keyed on `sub` and not email on purpose: a Google account's email address can change
 * (a rename, a domain move), and matching on it would either lock the owner out of
 * their own business or, worse, hand their business to whoever later acquires the
 * address. `sub` is stable for the life of the account.
 *
 * The email and name are refreshed on every sign-in so the admin UI does not show a
 * stale address. A name Google has stopped returning does not blank the stored one.
 */
export async function upsertUserByGoogleSub(profile: {
  googleSub: string;
  email: string;
  name?: string | null;
}): Promise<UserRecord> {
  const row = await systemQueryOne<UserRow>(
    `INSERT INTO torim.users (google_sub, email, name)
     VALUES ($1, $2, $3)
     ON CONFLICT (google_sub) DO UPDATE
       SET email = EXCLUDED.email,
           name  = COALESCE(EXCLUDED.name, torim.users.name)
     RETURNING id, google_sub, email, name`,
    [profile.googleSub, profile.email, profile.name ?? null],
  );

  if (!row) {
    throw new Error('User upsert returned no row.');
  }

  return { id: row.id, googleSub: row.google_sub, email: row.email, name: row.name };
}

export interface MembershipRecord {
  businessId: string;
  role: Role;
  slug: string;
  businessName: string;
}

interface MembershipRow {
  business_id: string;
  role: string;
  slug: string;
  name: string;
}

/**
 * Every business this user may administer, owner-held ones first.
 *
 * Ordering is not cosmetic: the sign-in callback picks `[0]` as the active tenant when
 * the session has no remembered business, and landing an owner in a business where they
 * are only staff would look like their own shop had lost its settings.
 */
export async function getMembershipsForUser(userId: string): Promise<MembershipRecord[]> {
  const rows = await systemQuery<MembershipRow>(
    `SELECT m.business_id, m.role, b.slug, b.name
       FROM torim.memberships m
       JOIN torim.businesses b ON b.id = m.business_id
      WHERE m.user_id = $1
      ORDER BY (m.role = 'owner') DESC, b.name ASC`,
    [userId],
  );

  return rows.filter((row): row is MembershipRow & { role: Role } => isRole(row.role)).map((row) => ({
    businessId: row.business_id,
    role: row.role,
    slug: row.slug,
    businessName: row.name,
  }));
}

/** One membership, or null. Used to confirm a business is still the caller's to enter. */
export async function getMembership(
  userId: string,
  businessId: string,
): Promise<MembershipRecord | null> {
  const memberships = await getMembershipsForUser(userId);
  return memberships.find((membership) => membership.businessId === businessId) ?? null;
}

/**
 * Onboarding: create a business and make this user its owner, atomically.
 *
 * Calls the SECURITY DEFINER function from 001_tenancy.sql rather than issuing the two
 * INSERTs here. That function is the *only* cross-tenant write capability the app role
 * has; doing it in application code would mean granting an ambient RLS bypass instead,
 * and a bug anywhere else in the app could then reach every tenant's rows.
 *
 * Returns the new business id. The caller is responsible for putting it in the session.
 */
export async function createBusinessWithOwner(input: {
  userId: string;
  slug: string;
  name: string;
  timezone: string;
  currency: string;
}): Promise<string> {
  const row = await systemQueryOne<{ business_id: string }>(
    `SELECT torim.create_business_with_owner($1, $2, $3, $4, $5) AS business_id`,
    [input.userId, input.slug, input.name, input.timezone, input.currency],
  );

  if (!row?.business_id) {
    throw new Error('create_business_with_owner returned no business id.');
  }

  return row.business_id;
}
