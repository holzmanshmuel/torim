import { describe, expect, it } from 'vitest';
import { isDisposableDatabaseName } from './seed-safety';

describe('isDisposableDatabaseName', () => {
  it('accepts the three recognised disposable suffixes', () => {
    expect(isDisposableDatabaseName('torim_dev')).toBe(true);
    expect(isDisposableDatabaseName('torim_test')).toBe(true);
    expect(isDisposableDatabaseName('torim_demo')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isDisposableDatabaseName('TORIM_DEMO')).toBe(true);
  });

  it('rejects names with none of the recognised suffixes', () => {
    expect(isDisposableDatabaseName('torim')).toBe(false);
    expect(isDisposableDatabaseName('railway')).toBe(false);
    expect(isDisposableDatabaseName('production')).toBe(false);
  });

  /**
   * The rule is a *suffix* on a chosen name, not a keyword search — a bare "demo"
   * with no underscore prefix gives no signal that anyone deliberately marked the
   * database disposable, so it does not count. Keeping this strict also keeps the
   * bar for "_demo" exactly as high as it already was for "_dev" and "_test",
   * rather than quietly loosening it for the newest of the three.
   */
  it('rejects a bare "demo" with no underscore prefix', () => {
    expect(isDisposableDatabaseName('demo')).toBe(false);
  });

  it('rejects a name that merely contains a recognised suffix in the middle', () => {
    expect(isDisposableDatabaseName('my_dev_prod')).toBe(false);
  });
});
