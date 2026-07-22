/**
 * Wave 4 — Deterministic section-block model.
 *
 * PURE, deterministic, grapheme-safe splitting of a piece of content into
 * addressable `ContentBlock`s (hook / opening / body / cta / hashtags / other),
 * and the exact inverse `joinBlocks`.
 *
 * INVARIANTS
 *  - `splitIntoBlocks` is a pure function of its text (no clocks, no randomness,
 *    no I/O). Same text → byte-identical blocks.
 *  - `joinBlocks(splitIntoBlocks(text)) === text` for every input (exact
 *    round-trip). This is guaranteed structurally: every block is a contiguous
 *    slice of `text.split('\n')`, blocks partition the whole line array in
 *    order with no gap/overlap, and both split and join use `'\n'` as the only
 *    join separator.
 *  - Idempotent: `splitIntoBlocks(joinBlocks(splitIntoBlocks(text)))` is deep
 *    equal to `splitIntoBlocks(text)` — because block roles are re-derived
 *    deterministically from the (unchanged) text, `join` never mutates content,
 *    and freshly-split blocks always carry `locked: false` / no `id`.
 *  - Grapheme-safe: no UTF-16 index arithmetic is performed on content. Line
 *    boundaries are `'\n'`, detection uses whole-token regexes, and any
 *    code-point iteration goes through `Array.from` (surrogate-pair safe),
 *    mirroring `lib/content/originality/fingerprint.ts`.
 */

import type { ContentBlock, ContentBlockType } from './types';

/** True when a line is empty or whitespace-only (CR from CRLF is treated as blank padding). */
function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

/**
 * True when EVERY whitespace-separated token on the line is a `#hashtag`
 * (at least one token). e.g. `'#ai #growth'` → true; `'Follow #ai'` → false.
 */
function isHashtagLine(line: string): boolean {
  const t = line.trim();
  if (t.length === 0) return false;
  const tokens = t.split(/\s+/);
  return tokens.length > 0 && tokens.every((tok) => /^#[^\s#]+$/.test(tok));
}

// Call-to-action verb / phrase cues. Matched case-insensitively as whole words.
const CTA_CUES =
  /\b(click|comment|share|subscribe|follow|sign\s?up|log\s?in|learn more|read more|find out|download|register|join|dm me|message me|link in bio|check (?:it |this )?out|get started|try (?:it|us|now|free)|book (?:a|your|now)|shop now|save this|visit|explore|discover|tap (?:the|to|in)|reach out|contact us|let'?s (?:talk|chat|connect)|start (?:your|free|today)|watch|see more|swipe|order now|grab)\b/i;

/**
 * True when the (short) line reads like a single call-to-action: it carries a
 * CTA cue, an arrow, or a link — and is not itself a hashtag line. Length-capped
 * so a long body paragraph merely containing "share" is never mistaken for a CTA.
 */
function isCtaLine(line: string): boolean {
  const t = line.trim();
  if (t.length === 0) return false;
  if (isHashtagLine(line)) return false;
  const wordCount = t.split(/\s+/).filter(Boolean).length;
  if (wordCount > 20) return false;
  if (/→|->|https?:\/\/|www\./i.test(t)) return true;
  return CTA_CUES.test(t);
}

/** Index of the last non-blank line in `lines[0, end)`, or -1. */
function lastNonBlankIndex(lines: string[], end: number): number {
  for (let i = end - 1; i >= 0; i--) {
    if (!isBlank(lines[i])) return i;
  }
  return -1;
}

/** Index of the first non-blank line in `lines[start, end)`, or -1. */
function firstNonBlankIndex(lines: string[], start: number, end: number): number {
  for (let i = start; i < end; i++) {
    if (!isBlank(lines[i])) return i;
  }
  return -1;
}

interface Range {
  blockType: ContentBlockType;
  start: number;
  end: number;
}

/**
 * Splits content into deterministic, addressable blocks.
 *
 * Rules (all boundaries fall on `'\n'` lines, so the result round-trips exactly):
 *  - hook: leading blank lines + the first non-blank line.
 *  - opening: the material immediately after the hook — the first paragraph
 *    (up to a blank-line break) or, when the remainder has no blank breaks, the
 *    single next line.
 *  - body: the remaining middle material (only emitted when something is left
 *    after the opening).
 *  - cta: a trailing single line that reads as a call-to-action (+ trailing blanks).
 *  - hashtags: a trailing run whose non-blank lines are all `#hashtag` lines.
 *  - other: emitted only for whitespace-only leading content (degenerate input).
 *
 * `contentType` is accepted for forward-compatibility and future per-type tuning;
 * the current splitter is content-type agnostic and deterministic regardless.
 */
export function splitIntoBlocks(text: string, _contentType?: string): ContentBlock[] {
  // Exact-empty → no blocks. `joinBlocks([]) === ''` keeps the round-trip whole.
  if (text === '') return [];

  const lines = text.split('\n');
  const n = lines.length;
  const ranges: Range[] = [];

  // ---- Peel trailing hashtags: maximal trailing run of blank/hashtag lines
  // that contains at least one hashtag line. ----
  let end = n;
  {
    let i = end - 1;
    let sawHashtag = false;
    while (i >= 0) {
      if (isBlank(lines[i])) {
        i--;
        continue;
      }
      if (isHashtagLine(lines[i])) {
        sawHashtag = true;
        i--;
        continue;
      }
      break;
    }
    const hashStart = i + 1;
    if (sawHashtag && hashStart < end) {
      ranges.push({ blockType: 'hashtags', start: hashStart, end });
      end = hashStart;
    }
  }

  // ---- Peel a trailing CTA: the last non-blank line in what remains, if it
  // reads as a call-to-action (plus any trailing blanks). CTA is single-line. ----
  {
    const lnb = lastNonBlankIndex(lines, end);
    if (lnb !== -1 && isCtaLine(lines[lnb])) {
      ranges.push({ blockType: 'cta', start: lnb, end });
      end = lnb;
    }
  }

  // ---- Leading region [0, end): hook / opening / body (or a single 'other'). ----
  if (end > 0) {
    const firstContent = firstNonBlankIndex(lines, 0, end);
    if (firstContent === -1) {
      // Whitespace-only leading content — degenerate; label it 'other'.
      ranges.push({ blockType: 'other', start: 0, end });
    } else {
      const hookEnd = firstContent + 1; // hook = leading blanks + first content line
      ranges.push({ blockType: 'hook', start: 0, end: hookEnd });

      if (hookEnd < end) {
        // Does the remainder contain an internal paragraph break (a blank line
        // with non-blank content on BOTH sides within [hookEnd, end))?
        let paragraphBreak = -1;
        for (let i = hookEnd; i < end; i++) {
          if (isBlank(lines[i])) {
            const before = firstNonBlankIndex(lines, hookEnd, i);
            const after = firstNonBlankIndex(lines, i + 1, end);
            if (before !== -1 && after !== -1) {
              paragraphBreak = i;
              break;
            }
          }
        }

        if (paragraphBreak !== -1) {
          // opening = first paragraph (blank separator falls into body).
          ranges.push({ blockType: 'opening', start: hookEnd, end: paragraphBreak });
          ranges.push({ blockType: 'body', start: paragraphBreak, end });
        } else {
          // No paragraph break: opening = next single content line; body = rest
          // if any non-blank remains, else the remainder folds into opening.
          const opFirst = firstNonBlankIndex(lines, hookEnd, end);
          if (opFirst === -1) {
            // remainder is all blank — fold it into the hook to keep coverage.
            ranges[ranges.length - 1] = { blockType: 'hook', start: 0, end };
          } else {
            const openingEnd = opFirst + 1;
            const bodyHasContent = firstNonBlankIndex(lines, openingEnd, end) !== -1;
            if (bodyHasContent) {
              ranges.push({ blockType: 'opening', start: hookEnd, end: openingEnd });
              ranges.push({ blockType: 'body', start: openingEnd, end });
            } else {
              ranges.push({ blockType: 'opening', start: hookEnd, end });
            }
          }
        }
      }
    }
  }

  // Order by start index (hook < opening < body < cta < hashtags by construction)
  // and materialize. Text of each block is its line slice rejoined with '\n'.
  ranges.sort((a, b) => a.start - b.start);
  return ranges.map((r, position) => ({
    blockType: r.blockType,
    position,
    text: lines.slice(r.start, r.end).join('\n'),
    locked: false,
  }));
}

/**
 * Exact inverse of `splitIntoBlocks`: concatenates block texts with the single
 * `'\n'` separator, reproducing the original input byte-for-byte.
 */
export function joinBlocks(blocks: ContentBlock[]): string {
  return blocks.map((b) => b.text).join('\n');
}
