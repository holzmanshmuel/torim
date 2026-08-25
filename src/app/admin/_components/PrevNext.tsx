import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * The ONE previous/next control in the admin app.
 *
 * The day nav, the week nav and anything added later all render this component, which
 * is the fix for a real bug: the predecessor's month grid stepped in the opposite
 * direction to its day nav, its week nav and its lightbox, because each screen chose
 * its own arrow. Direction is decided in exactly one place now, so they cannot disagree.
 *
 * In RTL, "earlier" is to the RIGHT. DOM order handles the position for free — the row
 * is a flex container inheriting `dir` from `<html>` — but the glyph itself has to be
 * chosen explicitly, which is what `dir` is for here.
 */
export function PrevNext({
  prevHref,
  nextHref,
  prevLabel,
  nextLabel,
  dir,
  children,
}: {
  prevHref: string;
  nextHref: string;
  prevLabel: string;
  nextLabel: string;
  dir: 'ltr' | 'rtl';
  children: ReactNode;
}) {
  const prevGlyph = dir === 'rtl' ? '›' : '‹';
  const nextGlyph = dir === 'rtl' ? '‹' : '›';

  return (
    <div className="flex items-center justify-between gap-2">
      <Link
        href={prevHref}
        aria-label={prevLabel}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-lg text-body no-underline hover:border-blue hover:text-blue"
      >
        <span aria-hidden="true">{prevGlyph}</span>
      </Link>

      <div className="min-w-0 flex-1 text-center">{children}</div>

      <Link
        href={nextHref}
        aria-label={nextLabel}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-lg text-body no-underline hover:border-blue hover:text-blue"
      >
        <span aria-hidden="true">{nextGlyph}</span>
      </Link>
    </div>
  );
}
