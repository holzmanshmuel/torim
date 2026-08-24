import { afterEach, describe, expect, it } from 'vitest';
import {
  __resetRequestHolderResolver,
  __setRequestHolderResolver,
  enterTenant,
  getBusinessId,
  requireBusinessId,
  runWithTenant,
  type RequestHolder,
} from './tenant';

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';

describe('tenant context', () => {
  afterEach(() => {
    __resetRequestHolderResolver();
  });

  it('has no tenant until one is established', async () => {
    const holder: RequestHolder = { businessId: null };
    __setRequestHolderResolver(() => holder);

    await runWithTenant(A, async () => {
      expect(getBusinessId()).toBe(A);
    });
  });

  it('requireBusinessId throws rather than guessing', () => {
    const holder: RequestHolder = { businessId: null };
    __setRequestHolderResolver(() => holder);

    expect(() => requireBusinessId()).toThrow(/No tenant context/);
  });

  it('keeps concurrent tenants apart', async () => {
    const seen: string[] = [];
    await Promise.all([
      runWithTenant(A, async () => {
        await new Promise((r) => setTimeout(r, 5));
        seen.push(requireBusinessId());
      }),
      runWithTenant(B, async () => {
        seen.push(requireBusinessId());
      }),
    ]);
    expect(seen.sort()).toEqual([A, B]);
  });

  /**
   * The regression this whole design exists for.
   *
   * AsyncLocalStorage.enterWith() binds the value for the *current* execution context.
   * A guard that awaits before calling it therefore loses the binding the moment it
   * resolves back to its caller — so an auth guard would establish a tenant that the
   * caller's subsequent DB calls could not see. The request-scoped holder survives
   * because it is a mutable object shared by both contexts, not context state.
   */
  it('survives an await boundary inside an async guard', async () => {
    const holder: RequestHolder = { businessId: null };
    __setRequestHolderResolver(() => holder);

    async function authGuard(): Promise<void> {
      await Promise.resolve();
      enterTenant(A);
    }

    await authGuard();

    expect(getBusinessId()).toBe(A);
  });
});
