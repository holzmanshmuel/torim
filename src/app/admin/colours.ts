/**
 * The service colour palette.
 *
 * `torim.services.colour` is free text with a `'blue'` default, and the demo seed
 * already uses `blue`, `purple`, `green` and `amber` — so the names here match those
 * rather than inventing a new set that would render every seeded service as a fallback.
 *
 * The swatch is drawn from a hex map applied as an inline style, not a Tailwind class.
 * Colour here is *user data*, and a class name assembled from a database value is
 * exactly the string Tailwind's scanner cannot see at build time — it would compile
 * away and the bars would all be invisible. Brand colours still come from the design
 * tokens; this map only covers the owner's own categorisation.
 */

export const SERVICE_COLOURS = [
  'blue',
  'purple',
  'teal',
  'green',
  'amber',
  'rose',
  'slate',
] as const;

export type ServiceColour = (typeof SERVICE_COLOURS)[number];

export const DEFAULT_SERVICE_COLOUR: ServiceColour = 'blue';

const HEX: Record<ServiceColour, string> = {
  // Signal's own blue, so the default service matches the rest of the product.
  blue: '#1D4ED8',
  purple: '#7C3AED',
  teal: '#0D9488',
  green: '#059669',
  amber: '#D97706',
  rose: '#E11D48',
  slate: '#64748B',
};

export function isServiceColour(value: string): value is ServiceColour {
  return (SERVICE_COLOURS as readonly string[]).includes(value);
}

/** Unknown values (older data, a hand-edited row) fall back rather than rendering blank. */
export function colourHex(value: string): string {
  return isServiceColour(value) ? HEX[value] : HEX.slate;
}

/** Dictionary key for a colour's human name. */
export function colourLabelKey(value: string): string {
  return `colour.${isServiceColour(value) ? value : 'slate'}`;
}
