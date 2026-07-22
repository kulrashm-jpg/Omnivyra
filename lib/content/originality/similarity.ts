/**
 * Wave 2 — Content Intelligence: pure similarity comparators.
 *
 * Every comparator is a pure function of its arguments. Scores are in [0, 1]
 * where 1 = identical, unless a function's contract says otherwise (the two
 * `*Equal` predicates return booleans). No DB, no clocks, no randomness.
 */

// ---------------------------------------------------------------------------
// Exact / normalized hash equality
// ---------------------------------------------------------------------------

/** True iff two exact (raw) sha256 hashes are identical. */
export function exactEqual(aHash: string, bHash: string): boolean {
  return aHash === bHash;
}

/** True iff two normalized sha256 hashes are identical. */
export function normalizedEqual(aHash: string, bHash: string): boolean {
  return aHash === bHash;
}

// ---------------------------------------------------------------------------
// SimHash
// ---------------------------------------------------------------------------

/** Popcount of a non-negative BigInt. */
function popcount(value: bigint): number {
  let v = value;
  let count = 0;
  while (v > 0n) {
    count += Number(v & 1n);
    v >>= 1n;
  }
  return count;
}

/**
 * SimHash similarity from two 64-bit hex signatures: `1 - hammingDistance/64`.
 * Malformed / empty inputs are treated as all-zero signatures.
 */
export function simhashSimilarity(aHex: string, bHex: string): number {
  const a = safeHexToBig(aHex);
  const b = safeHexToBig(bHex);
  const distance = popcount(a ^ b);
  return 1 - distance / 64;
}

function safeHexToBig(hex: string): bigint {
  if (!hex) return 0n;
  try {
    return BigInt(`0x${hex}`);
  } catch {
    return 0n;
  }
}

// ---------------------------------------------------------------------------
// MinHash
// ---------------------------------------------------------------------------

/**
 * Estimated Jaccard similarity from two MinHash signatures: the fraction of
 * signature slots that agree. Signatures must be the same length; mismatched
 * or empty signatures yield 0.
 */
export function minhashJaccard(aSig: number[], bSig: number[]): number {
  if (!aSig.length || !bSig.length || aSig.length !== bSig.length) return 0;
  let matches = 0;
  for (let i = 0; i < aSig.length; i++) {
    if (aSig[i] === bSig[i]) matches++;
  }
  return matches / aSig.length;
}

// ---------------------------------------------------------------------------
// Token / shingle Jaccard
// ---------------------------------------------------------------------------

/** Jaccard similarity of two sets (by value). Two empty sets → 1. */
function jaccard(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const x of setA) {
    if (setB.has(x)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Jaccard similarity over token sets, 0..1. */
export function tokenSimilarity(aTokens: string[], bTokens: string[]): number {
  return jaccard(aTokens, bTokens);
}

/** Jaccard similarity over shingle sets, 0..1. */
export function shingleSimilarity(aShingles: string[], bShingles: string[]): number {
  return jaccard(aShingles, bShingles);
}

// ---------------------------------------------------------------------------
// Structural shape
// ---------------------------------------------------------------------------

/**
 * Structural similarity: the fraction of shape components (e.g. `sent=`,
 * `lines=`, `avglen=`) that match exactly between two structural signatures.
 * Identical shapes → 1; two empty shapes → 1.
 */
export function structuralSimilarity(aShape: string, bShape: string): number {
  const a = (aShape ?? '').split('|').filter(Boolean);
  const b = (bShape ?? '').split('|').filter(Boolean);
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  // Compare component-by-component keyed by the "key=" prefix so ordering and
  // missing components are handled gracefully.
  const mapA = new Map<string, string>();
  for (const part of a) {
    const eq = part.indexOf('=');
    if (eq > 0) mapA.set(part.slice(0, eq), part.slice(eq + 1));
  }
  const mapB = new Map<string, string>();
  for (const part of b) {
    const eq = part.indexOf('=');
    if (eq > 0) mapB.set(part.slice(0, eq), part.slice(eq + 1));
  }

  const keys = new Set<string>([...mapA.keys(), ...mapB.keys()]);
  if (keys.size === 0) return a.join('|') === b.join('|') ? 1 : 0;

  let matches = 0;
  for (const key of keys) {
    if (mapA.get(key) === mapB.get(key)) matches++;
  }
  return matches / keys.size;
}

// ---------------------------------------------------------------------------
// Cosine (embedding stage)
// ---------------------------------------------------------------------------

/**
 * Cosine similarity of two equal-length numeric vectors, in [-1, 1] (for
 * non-negative embeddings, effectively [0, 1]). Mismatched-length, empty, or
 * zero-magnitude vectors yield 0.
 */
export function cosine(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
