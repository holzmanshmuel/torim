/**
 * The one way into an admin page or Server Action.
 *
 * `requireAuth()` and friends throw `AuthError` rather than redirecting — deliberately,
 * so an API route can answer 401 instead of bouncing a fetch to an HTML login page. A
 * page wants the opposite, so the translation happens here, once, instead of in a
 * `try/catch` copy-pasted into every route.
 *
 * `withGuard` additionally re-establishes the tenant scope through `runWithTenant`.
 * Every guard already calls `enterTenant()`, whose primary store is a `cache()`-memoized
 * per-request holder; wrapping the body in an explicit AsyncLocalStorage scope as well
 * costs nothing and means a Server Action cannot end up authenticated with no business
 * id if the React request scope is ever not what we assume.
 */
import { redirect } from 'next/navigation';
import { AuthError, requireAuth, requirePermission, type Action, type AuthContext } from '@/lib/auth';
import { runWithTenant } from '@/lib/tenant';

/**
 * Authenticate (and optionally authorise) for a page render.
 *
 * `redirect()` is called from the `catch` and not wrapped in another `try`, which is
 * what Next requires: it signals by throwing, and swallowing that throw turns a
 * redirect into a blank page.
 */
export async function guard(action?: Action): Promise<AuthContext> {
  let context: AuthContext;
  try {
    context = action ? await requirePermission(action) : await requireAuth();
  } catch (err) {
    if (err instanceof AuthError) redirect(err.redirectTo);
    throw err;
  }
  return context;
}

/** Guard, then run `fn` with the tenant scope explicitly bound. */
export async function withGuard<T>(
  action: Action,
  fn: (context: AuthContext) => Promise<T>,
): Promise<T> {
  const context = await guard(action);
  return runWithTenant(context.businessId, () => fn(context));
}
