/**
 * Request-scoped tenant context.
 *
 * Every tenant-scoped DB call reads the active business id from here and sets it
 * as a Postgres GUC inside the transaction, where the RLS policies read it back.
 *
 * ⚠ Why this is not a plain AsyncLocalStorage:
 * `AsyncLocalStorage.enterWith()` does NOT survive an `await` boundary — a value
 * set inside an awaited guard is gone by the time the guard resolves back to its
 * caller. So the primary store is a request-scoped *mutable holder* memoized by
 * React's `cache()` (one object per RSC request), with AsyncLocalStorage kept as
 * a secondary path for route handlers, scripts and tests that run `runWithTenant`.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { cache } from 'react';

export type TenantStore = { businessId: string };
export type RequestHolder = { businessId: string | null };

const storage = new AsyncLocalStorage<TenantStore>();

const makeHolder = (): RequestHolder => ({ businessId: null });

/** Memoized per RSC request by React. Outside a request this yields a fresh holder. */
const cachedHolder = cache(makeHolder);

let holderResolver: () => RequestHolder = () => {
  try {
    return cachedHolder();
  } catch {
    // `cache()` is only meaningful inside a React request; fall back to the ALS path.
    return makeHolder();
  }
};

/** Test-only seam so the per-request memoization can be simulated without an RSC render. */
export function __setRequestHolderResolver(fn: () => RequestHolder): void {
  holderResolver = fn;
}
export function __resetRequestHolderResolver(): void {
  holderResolver = () => {
    try {
      return cachedHolder();
    } catch {
      return makeHolder();
    }
  };
}

/** Bind the active business for the remainder of this request. */
export function enterTenant(businessId: string): void {
  holderResolver().businessId = businessId;
  storage.enterWith({ businessId });
}

/** Run `fn` with an explicit tenant scope. Use in route handlers, scripts and tests. */
export function runWithTenant<T>(businessId: string, fn: () => Promise<T>): Promise<T> {
  return storage.run({ businessId }, fn);
}

/** The active business id, or null when no tenant has been established. */
export function getBusinessId(): string | null {
  return storage.getStore()?.businessId ?? holderResolver().businessId ?? null;
}

/** The active business id, or throw. Tenant-scoped DB access must never guess. */
export function requireBusinessId(): string {
  const id = getBusinessId();
  if (!id) {
    throw new Error(
      'No tenant context. Call enterTenant()/runWithTenant() before a tenant-scoped query.',
    );
  }
  return id;
}
