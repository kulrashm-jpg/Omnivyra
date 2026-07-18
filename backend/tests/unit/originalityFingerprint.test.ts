/**
 * Wave 2 — Content Intelligence: fingerprint primitives.
 *
 * Covers normalization, the six fingerprint signals, determinism, and
 * grapheme-safety (emoji must not crash the code-point walk).
 */

import { createHash } from 'crypto';

import {
  normalizeText,
  computeFingerprint,
} from '@/lib/content/originality/fingerprint';
import type { ContentFingerprint } from '@/lib/content/originality/types';

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

const PARAGRAPH =
  'The quick brown fox jumps over the lazy dog. It was a bright cold day in April. ' +
  'Marketing teams need original content to stand out. Repetition kills engagement.';

describe('normalizeText', () => {
  test('lowercases, strips punctuation, collapses whitespace, trims', () => {
    expect(normalizeText('  Hello,   WORLD!!!  ')).toBe('hello world');
  });

  test('empty / whitespace-only input → empty string', () => {
    expect(normalizeText('')).toBe('');
    expect(normalizeText('   \n\t  ')).toBe('');
  });

  test('keeps unicode letters and numbers, drops symbols', () => {
    expect(normalizeText('Price: $42 — café ☕ résumé')).toBe('price 42 café résumé');
  });

  test('is idempotent', () => {
    const once = normalizeText(PARAGRAPH);
    expect(normalizeText(once)).toBe(once);
  });
});

describe('computeFingerprint — hashes', () => {
  test('exactHash / normalizedHash match direct sha256', () => {
    const fp = computeFingerprint(PARAGRAPH);
    expect(fp.exactHash).toBe(sha(PARAGRAPH));
    expect(fp.normalizedHash).toBe(sha(normalizeText(PARAGRAPH)));
  });

  test('exactHash differs when only whitespace/case changes, normalizedHash does not', () => {
    const a = computeFingerprint('Hello World.');
    const b = computeFingerprint('  hello   world.  ');
    expect(a.exactHash).not.toBe(b.exactHash);
    expect(a.normalizedHash).toBe(b.normalizedHash);
  });
});

describe('computeFingerprint — signal shapes', () => {
  let fp: ContentFingerprint;
  beforeAll(() => {
    fp = computeFingerprint(PARAGRAPH);
  });

  test('simhash is 16-char hex', () => {
    expect(fp.simhash).toMatch(/^[0-9a-f]{16}$/);
  });

  test('minhash is a length-64 numeric signature', () => {
    expect(Array.isArray(fp.minhash)).toBe(true);
    expect(fp.minhash).toHaveLength(64);
    for (const v of fp.minhash) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  test('structuralShape has bucketed sentence/line/length components', () => {
    expect(fp.structuralShape).toMatch(/^sent=\d+\|lines=\d+\|avglen=\d+$/);
  });

  test('tokenSummary exposes unique tokens and 3-word shingles', () => {
    expect(fp.tokenSummary.tokens.length).toBeGreaterThan(0);
    // Uniqueness invariant.
    expect(new Set(fp.tokenSummary.tokens).size).toBe(fp.tokenSummary.tokens.length);
    // "the" appears many times but only once in the token set.
    expect(fp.tokenSummary.tokens.filter((t) => t === 'the')).toHaveLength(1);
    // Each shingle is 3 words for a paragraph longer than the window.
    expect(fp.tokenSummary.shingles.length).toBeGreaterThan(0);
    expect(fp.tokenSummary.shingles[0].split(' ')).toHaveLength(3);
  });
});

describe('computeFingerprint — determinism', () => {
  test('same input → byte-identical fingerprint across calls', () => {
    const a = computeFingerprint(PARAGRAPH);
    const b = computeFingerprint(PARAGRAPH);
    expect(a).toEqual(b);
    // Signature arrays are deep-equal, not just same reference.
    expect(a.minhash).toEqual(b.minhash);
    expect(a.simhash).toBe(b.simhash);
  });

  test('different input → different simhash + minhash', () => {
    const a = computeFingerprint(PARAGRAPH);
    const b = computeFingerprint('Completely unrelated subject matter about ocean tides.');
    expect(a.simhash).not.toBe(b.simhash);
    expect(a.minhash).not.toEqual(b.minhash);
  });
});

describe('computeFingerprint — edge / grapheme safety', () => {
  test('emoji-heavy text does not crash and stays grapheme-safe', () => {
    const emoji = '🚀🔥 Launch day!! 🎉🎉 Ship it 👍🏽 café ☕';
    expect(() => computeFingerprint(emoji)).not.toThrow();
    const fp = computeFingerprint(emoji);
    // Normalized form drops emoji but keeps words/numbers, no stray surrogates.
    expect(fp.normalizedHash).toBe(sha(normalizeText(emoji)));
    expect(normalizeText(emoji)).toBe('launch day ship it café');
    expect(fp.simhash).toMatch(/^[0-9a-f]{16}$/);
    expect(fp.minhash).toHaveLength(64);
  });

  test('empty input produces stable zeroed signals', () => {
    const fp = computeFingerprint('');
    expect(fp.simhash).toBe('0000000000000000');
    expect(fp.minhash).toHaveLength(64);
    expect(fp.structuralShape).toBe('sent=0|lines=0|avglen=0');
    expect(fp.tokenSummary.tokens).toEqual([]);
    expect(fp.tokenSummary.shingles).toEqual([]);
    // Deterministic even for the empty case.
    expect(computeFingerprint('')).toEqual(fp);
  });

  test('short text (< shingle window) still fingerprints', () => {
    const fp = computeFingerprint('hi there');
    expect(fp.tokenSummary.shingles).toEqual(['hi there']);
    expect(fp.simhash).toMatch(/^[0-9a-f]{16}$/);
  });
});
