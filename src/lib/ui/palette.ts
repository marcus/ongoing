import type { IconName } from './icons';

export interface PaletteItem {
  id: string;
  label: string;
  /** The group heading it sits under: `Jump`, `Entry`, `Go`, `View`. */
  group: string;
  hint?: string;
  icon?: IconName;
  /** Extra text the fuzzy match should consider — a slug, a path. */
  terms?: string;
  run: () => void;
}

/**
 * Subsequence scoring: every character of the needle must appear in order, and a run of adjacent
 * characters or a match at a word boundary scores better. It is the least surprising fuzzy match
 * and it is pure, so the palette's ranking is testable without a browser.
 */
export function fuzzyScore(haystack: string, needle: string): number | null {
  if (!needle) return 0;
  const text = haystack.toLocaleLowerCase('en');
  const query = needle.toLocaleLowerCase('en');
  let score = 0;
  let index = 0;
  let previous = -2;
  for (const char of query) {
    const found = text.indexOf(char, index);
    if (found === -1) return null;
    if (found === previous + 1) score += 8;
    else if (found === 0 || /[\s./_-]/.test(text[found - 1] ?? '')) score += 5;
    else score += 1;
    previous = found;
    index = found + 1;
  }
  // A short haystack that matched is more likely the thing meant than a long one.
  return score - text.length * 0.02;
}

export function rankPalette(items: readonly PaletteItem[], query: string): PaletteItem[] {
  if (!query.trim()) return [...items];
  const scored: { item: PaletteItem; score: number }[] = [];
  for (const item of items) {
    const score = Math.max(
      fuzzyScore(item.label, query) ?? Number.NEGATIVE_INFINITY,
      item.terms ? (fuzzyScore(item.terms, query) ?? Number.NEGATIVE_INFINITY) - 1 : -Infinity
    );
    if (Number.isFinite(score)) scored.push({ item, score });
  }
  return scored.sort((left, right) => right.score - left.score).map((entry) => entry.item);
}
