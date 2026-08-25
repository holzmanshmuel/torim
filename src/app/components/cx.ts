/**
 * Joins conditional class names, dropping falsy values. Deliberately tiny (no
 * `clsx`/`tailwind-merge` dependency) - this repo doesn't have either installed, and
 * none of these primitives need conflict-resolution, just concatenation.
 */
export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}
