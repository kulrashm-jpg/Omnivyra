/**
 * Wave 2 — Content Intelligence: deterministic content fingerprinting.
 *
 * PURE + DETERMINISTIC. No DB, no network, no `Math.random`, no `Date.now`.
 * The same input text always yields a byte-identical {@link ContentFingerprint}.
 *
 * Signals produced:
 *  - exactHash       : sha256 of the raw input (byte-exact duplicate detector).
 *  - normalizedHash  : sha256 of normalized text (case/whitespace/punct-invariant).
 *  - simhash         : 64-bit SimHash over 3-word shingles → 16-char hex.
 *  - minhash         : k=64 MinHash signature over word shingles (fixed seeds).
 *  - structuralShape : bucketed sentence/line/length signature.
 *  - tokenSummary    : unique tokens + 3-word shingles for Jaccard comparators.
 */

import { createHash } from 'crypto';

import type { ContentFingerprint } from './types';

/** MinHash signature length. */
const MINHASH_K = 64;
/** Shingle width (words per shingle). */
const SHINGLE_SIZE = 3;
/** Largest prime below 2^31 — the MinHash permutation modulus. */
const MERSENNE_PRIME = 2147483647; // 2^31 - 1
/** 2^32, the domain size for the 32-bit base hash of a shingle. */
const UINT32_DOMAIN = 4294967296; // 2^32

// ---------------------------------------------------------------------------
// Text normalization
// ---------------------------------------------------------------------------

/**
 * Normalize text for near-duplicate comparison:
 *  - lowercase
 *  - iterate by Unicode code point (grapheme-safe for emoji / surrogate pairs)
 *  - keep letters & numbers (Unicode-aware), drop punctuation, symbols, emoji
 *  - collapse all whitespace runs to a single space
 *  - trim
 *
 * Emoji and other non-alphanumeric code points are stripped rather than causing
 * a crash; splitting on code points (not UTF-16 units) keeps surrogate pairs
 * intact so a stray half-surrogate can never be emitted.
 */
export function normalizeText(text: string): string {
  if (!text) return '';

  const lowered = text.toLowerCase();
  const out: string[] = [];

  // Array.from splits on code points, so a 2-unit emoji is one element.
  for (const cp of Array.from(lowered)) {
    if (/\s/.test(cp)) {
      out.push(' ');
      continue;
    }
    // Unicode-aware alphanumeric test (letters + numbers of any script).
    if (/[\p{L}\p{N}]/u.test(cp)) {
      out.push(cp);
    }
    // Everything else (punctuation, symbols, emoji) is dropped.
  }

  return out.join('').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Hash helpers (all pure, seeded only by their inputs)
// ---------------------------------------------------------------------------

/** sha256 hex digest of a string. */
function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Deterministic 64-bit hash of a feature, as a BigInt. Derived from the first
 * 8 bytes of its sha256 digest.
 */
function hash64(feature: string): bigint {
  const digest = createHash('sha256').update(feature, 'utf8').digest();
  let value = 0n;
  for (let i = 0; i < 8; i++) {
    value = (value << 8n) | BigInt(digest[i]);
  }
  return value;
}

/**
 * Deterministic 32-bit hash of a feature, as a Number in [0, 2^32). Derived
 * from the first 4 bytes of its sha256 digest. Used as the MinHash base hash.
 */
function hash32(feature: string): number {
  const digest = createHash('sha256').update(feature, 'utf8').digest();
  return (
    digest[0] * 0x1000000 +
    digest[1] * 0x10000 +
    digest[2] * 0x100 +
    digest[3]
  ) >>> 0;
}

/**
 * Deterministically derive the (a, b) coefficients for the i-th universal hash
 * `h_i(x) = (a*x + b) mod MERSENNE_PRIME`. Seeds come purely from `i` via a
 * SplitMix64-style avalanche — no randomness, stable across processes.
 */
function permutationCoeffs(i: number): { a: number; b: number } {
  const salt = (label: string): number => {
    // 64-bit avalanche of (i, label) → reduce into [1, PRIME).
    let z = (BigInt(i) + 1n) * 0x9e3779b97f4a7c15n + hash64(label);
    z = (z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n;
    z = (z ^ (z >> 27n)) * 0x94d049bb133111ebn;
    z = z ^ (z >> 31n);
    const mod = z % BigInt(MERSENNE_PRIME - 1);
    return Number(mod) + 1; // in [1, PRIME - 1]
  };
  return { a: salt('a'), b: salt('b') };
}

// Precompute permutation coefficients once (module-level, pure — depends only
// on constants). Keeps MinHash cheap without sacrificing determinism.
const PERMUTATIONS: ReadonlyArray<{ a: number; b: number }> = Array.from(
  { length: MINHASH_K },
  (_, i) => permutationCoeffs(i),
);

// ---------------------------------------------------------------------------
// Tokenization
// ---------------------------------------------------------------------------

/** Split normalized text into words. Empty input → empty array. */
function words(normalized: string): string[] {
  if (!normalized) return [];
  return normalized.split(' ').filter((w) => w.length > 0);
}

/** First-seen-unique tokens. */
function uniqueTokens(tokenList: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokenList) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

/**
 * N-word shingles of a token stream. For streams shorter than the window, the
 * whole stream is emitted as a single shingle (so short texts still fingerprint).
 */
function shingle(tokenList: string[], size: number): string[] {
  if (tokenList.length === 0) return [];
  if (tokenList.length < size) return [tokenList.join(' ')];
  const out: string[] = [];
  for (let i = 0; i + size <= tokenList.length; i++) {
    out.push(tokenList.slice(i, i + size).join(' '));
  }
  return out;
}

// ---------------------------------------------------------------------------
// SimHash
// ---------------------------------------------------------------------------

/**
 * 64-bit SimHash of a feature set, returned as a zero-padded 16-char hex string.
 * Empty feature set → 64 zero bits.
 */
function simhash64(features: string[]): string {
  if (features.length === 0) return '0'.repeat(16);

  // Weight each distinct feature by its occurrence count.
  const counts = new Map<string, number>();
  for (const f of features) counts.set(f, (counts.get(f) ?? 0) + 1);

  const bitScores = new Array<number>(64).fill(0);
  for (const [feature, weight] of counts) {
    const h = hash64(feature);
    for (let bit = 0; bit < 64; bit++) {
      const isSet = (h >> BigInt(bit)) & 1n;
      bitScores[bit] += isSet === 1n ? weight : -weight;
    }
  }

  let result = 0n;
  for (let bit = 0; bit < 64; bit++) {
    if (bitScores[bit] > 0) {
      result |= 1n << BigInt(bit);
    }
  }

  return result.toString(16).padStart(16, '0');
}

// ---------------------------------------------------------------------------
// MinHash
// ---------------------------------------------------------------------------

/**
 * k-permutation MinHash signature over a feature set. For each of K universal
 * hash permutations, records the minimum hashed value across all features.
 * Empty feature set → all slots = MERSENNE_PRIME (a stable sentinel).
 */
function minhashSignature(features: string[]): number[] {
  const sig = new Array<number>(MINHASH_K).fill(MERSENNE_PRIME);
  if (features.length === 0) return sig;

  // Distinct features only — MinHash is a set signature.
  const distinct = Array.from(new Set(features));
  const baseHashes = distinct.map((f) => hash32(f));

  for (let k = 0; k < MINHASH_K; k++) {
    const { a, b } = PERMUTATIONS[k];
    let min = MERSENNE_PRIME;
    for (const base of baseHashes) {
      // (a * base + b) mod PRIME — computed in the number domain carefully.
      // a,b < PRIME (~2.1e9), base < 2^32 (~4.3e9) → product ~9e18 exceeds
      // Number's safe integer range, so use BigInt for the multiply.
      const permuted = Number(
        (BigInt(a) * BigInt(base) + BigInt(b)) % BigInt(MERSENNE_PRIME),
      );
      if (permuted < min) min = permuted;
    }
    sig[k] = min;
  }
  return sig;
}

// ---------------------------------------------------------------------------
// Structural shape
// ---------------------------------------------------------------------------

/**
 * Bucket a count onto a coarse log-ish ladder so structurally-similar texts
 * map to the same bucket. Returns a small integer bucket id.
 */
function bucket(n: number): number {
  if (n <= 0) return 0;
  if (n <= 2) return 1;
  if (n <= 5) return 2;
  if (n <= 10) return 3;
  if (n <= 20) return 4;
  if (n <= 40) return 5;
  return 6;
}

/**
 * Compact structural signature over the RAW text: number of sentences, number
 * of non-empty lines, and average sentence length in words — each bucketed.
 * Whitespace-only / empty input yields an all-zero shape.
 */
function structuralShape(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return 'sent=0|lines=0|avglen=0';

  const sentences = trimmed
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const lines = trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const totalWords = trimmed.split(/\s+/).filter((w) => w.length > 0).length;
  const sentenceCount = sentences.length > 0 ? sentences.length : 1;
  const avgSentenceLen = Math.round(totalWords / sentenceCount);

  return `sent=${bucket(sentenceCount)}|lines=${bucket(lines.length)}|avglen=${bucket(avgSentenceLen)}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute the full deterministic {@link ContentFingerprint} for a piece of text.
 * Pure: identical input always produces an identical fingerprint.
 */
export function computeFingerprint(text: string): ContentFingerprint {
  const raw = typeof text === 'string' ? text : '';
  const normalized = normalizeText(raw);

  const tokenStream = words(normalized);
  const tokens = uniqueTokens(tokenStream);
  const shingles = shingle(tokenStream, SHINGLE_SIZE);

  return {
    exactHash: sha256Hex(raw),
    normalizedHash: sha256Hex(normalized),
    simhash: simhash64(shingles),
    minhash: minhashSignature(shingles),
    structuralShape: structuralShape(raw),
    tokenSummary: { tokens, shingles },
  };
}
