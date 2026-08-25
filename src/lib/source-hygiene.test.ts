/**
 * No invisible bidirectional control characters in source.
 *
 * Two reasons, and the second is the serious one.
 *
 * They are a maintenance hazard: a character nobody can see is a character nobody can
 * review, and one deleted by accident changes rendering with no visible diff.
 *
 * More importantly they are the Trojan Source attack (CVE-2021-42574). An override such
 * as U+202E reorders how a line *displays* without changing how it *executes*, so code
 * can be made to read in review as the opposite of what it does. This repo is going
 * public and will take contributions from strangers, so the guard is worth having even
 * though every instance found so far was benign — LRM inside a Hebrew string, and named
 * FSI/PDI constants in a test.
 *
 * Escape sequences are always available and always visible. Nothing is lost by using
 * them instead.
 *
 * This is a guard rather than a note in a review checklist deliberately: "remember not
 * to paste invisible characters" is exactly the instruction that fails on the day
 * someone copies a Hebrew string out of a design document.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** Embeddings, overrides, isolates, and the two directional marks. */
const BIDI_CONTROLS =
  /[\u202A-\u202E\u2066-\u2069\u200E\u200F]/u;

const CHECKED_EXTENSIONS = ['.ts', '.tsx', '.css', '.sql', '.mts'];

function repoSourceFiles(): string[] {
  // Tracked and untracked-but-not-ignored, so a new file is covered before it is added.
  const out = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], {
    encoding: 'utf8',
    cwd: process.cwd(),
  });
  return out
    .split('\n')
    .filter(Boolean)
    .filter((f) => CHECKED_EXTENSIONS.some((ext) => f.endsWith(ext)));
}

describe('source hygiene', () => {
  it('contains no literal bidi control characters — use \\u escapes', () => {
    const offenders: string[] = [];

    for (const file of repoSourceFiles()) {
      let contents: string;
      try {
        contents = readFileSync(file, 'utf8');
      } catch {
        continue; // deleted between listing and reading
      }
      if (!BIDI_CONTROLS.test(contents)) continue;

      contents.split('\n').forEach((line, index) => {
        const match = BIDI_CONTROLS.exec(line);
        if (match) {
          const codePoint = match[0].codePointAt(0)!.toString(16).toUpperCase();
          offenders.push(`${file}:${index + 1} contains U+${codePoint.padStart(4, '0')}`);
        }
      });
    }

    expect(offenders).toEqual([]);
  });

  it('actually detects one when present', () => {
    // Proves the matcher works, without committing an invisible character to do it.
    expect(BIDI_CONTROLS.test(`before${String.fromCharCode(0x202e)}after`)).toBe(true);
    expect(BIDI_CONTROLS.test('ordinary text')).toBe(false);
  });
});
