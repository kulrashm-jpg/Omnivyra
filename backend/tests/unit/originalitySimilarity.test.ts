/**
 * Wave 2 — Content Intelligence: similarity comparators.
 *
 * Identical → all sims 1.0; paraphrase → high token/simhash but not exact;
 * unrelated → low; plus explicit edge cases (empty, mismatched length, emoji).
 */

import { computeFingerprint } from '@/lib/content/originality/fingerprint';
import {
  exactEqual,
  normalizedEqual,
  simhashSimilarity,
  minhashJaccard,
  tokenSimilarity,
  shingleSimilarity,
  structuralSimilarity,
  cosine,
} from '@/lib/content/originality/similarity';

const ORIGINAL =
  'Our new analytics dashboard helps marketing teams track campaign performance in real time ' +
  'and surface the channels that drive the most qualified leads for the business.';

// Same meaning, reworded — should be high on fuzzy dims but not exact.
const PARAPHRASE =
  'The brand new analytics dashboard lets marketing teams monitor campaign performance in real time ' +
  'and reveal the channels that drive the most qualified leads for the company.';

const UNRELATED =
  'Photosynthesis converts sunlight, water, and carbon dioxide into glucose and oxygen inside the ' +
  'chloroplasts of plant cells during the daytime.';

describe('exact / normalized equality', () => {
  test('identical text → both equal', () => {
    const a = computeFingerprint(ORIGINAL);
    const b = computeFingerprint(ORIGINAL);
    expect(exactEqual(a.exactHash, b.exactHash)).toBe(true);
    expect(normalizedEqual(a.normalizedHash, b.normalizedHash)).toBe(true);
  });

  test('case/whitespace variant → normalized equal, exact not', () => {
    const a = computeFingerprint('Ship It Today.');
    const b = computeFingerprint('  ship   it today.  ');
    expect(exactEqual(a.exactHash, b.exactHash)).toBe(false);
    expect(normalizedEqual(a.normalizedHash, b.normalizedHash)).toBe(true);
  });
});

describe('identical content → every similarity is 1.0', () => {
  const a = computeFingerprint(ORIGINAL);
  const b = computeFingerprint(ORIGINAL);

  test('simhash', () => expect(simhashSimilarity(a.simhash, b.simhash)).toBe(1));
  test('minhash', () => expect(minhashJaccard(a.minhash, b.minhash)).toBe(1));
  test('tokens', () =>
    expect(tokenSimilarity(a.tokenSummary.tokens, b.tokenSummary.tokens)).toBe(1));
  test('shingles', () =>
    expect(shingleSimilarity(a.tokenSummary.shingles, b.tokenSummary.shingles)).toBe(1));
  test('structural', () =>
    expect(structuralSimilarity(a.structuralShape, b.structuralShape)).toBe(1));
});

describe('paraphrase → high fuzzy similarity, not exact', () => {
  const a = computeFingerprint(ORIGINAL);
  const p = computeFingerprint(PARAPHRASE);

  test('not exactly / normalized equal', () => {
    expect(exactEqual(a.exactHash, p.exactHash)).toBe(false);
    expect(normalizedEqual(a.normalizedHash, p.normalizedHash)).toBe(false);
  });

  test('token similarity is high (shared vocabulary)', () => {
    expect(tokenSimilarity(a.tokenSummary.tokens, p.tokenSummary.tokens)).toBeGreaterThan(0.5);
  });

  test('simhash similarity is high, below 1, and beats an unrelated doc', () => {
    const s = simhashSimilarity(a.simhash, p.simhash);
    const unrelated = simhashSimilarity(a.simhash, computeFingerprint(UNRELATED).simhash);
    expect(s).toBeGreaterThan(0.6);
    expect(s).toBeLessThan(1);
    expect(s).toBeGreaterThan(unrelated);
  });

  test('structural similarity is high (same shape family)', () => {
    expect(structuralSimilarity(a.structuralShape, p.structuralShape)).toBeGreaterThanOrEqual(0.66);
  });
});

describe('unrelated → low similarity', () => {
  const a = computeFingerprint(ORIGINAL);
  const u = computeFingerprint(UNRELATED);

  test('token similarity is low', () => {
    expect(tokenSimilarity(a.tokenSummary.tokens, u.tokenSummary.tokens)).toBeLessThan(0.2);
  });

  test('shingle similarity is ~0', () => {
    expect(shingleSimilarity(a.tokenSummary.shingles, u.tokenSummary.shingles)).toBeLessThan(0.05);
  });

  test('minhash jaccard is low', () => {
    expect(minhashJaccard(a.minhash, u.minhash)).toBeLessThan(0.2);
  });

  test('ordering: identical > paraphrase > unrelated on tokens', () => {
    const p = computeFingerprint(PARAPHRASE);
    const idn = tokenSimilarity(a.tokenSummary.tokens, a.tokenSummary.tokens);
    const par = tokenSimilarity(a.tokenSummary.tokens, p.tokenSummary.tokens);
    const unr = tokenSimilarity(a.tokenSummary.tokens, u.tokenSummary.tokens);
    expect(idn).toBeGreaterThan(par);
    expect(par).toBeGreaterThan(unr);
  });
});

describe('simhashSimilarity — direct', () => {
  test('identical hex → 1', () => {
    expect(simhashSimilarity('ffffffffffffffff', 'ffffffffffffffff')).toBe(1);
  });
  test('all-bits-different → 0', () => {
    expect(simhashSimilarity('ffffffffffffffff', '0000000000000000')).toBe(0);
  });
  test('single-bit difference → 1 - 1/64', () => {
    expect(simhashSimilarity('0000000000000000', '0000000000000001')).toBeCloseTo(1 - 1 / 64, 10);
  });
  test('malformed hex is treated as zero, never throws', () => {
    expect(() => simhashSimilarity('zzz', '')).not.toThrow();
    expect(simhashSimilarity('0000000000000000', '')).toBe(1);
  });
});

describe('minhashJaccard — direct', () => {
  test('half the slots agree → 0.5', () => {
    expect(minhashJaccard([1, 2, 3, 4], [1, 2, 9, 9])).toBe(0.5);
  });
  test('mismatched length → 0', () => {
    expect(minhashJaccard([1, 2, 3], [1, 2])).toBe(0);
  });
  test('empty → 0', () => {
    expect(minhashJaccard([], [])).toBe(0);
  });
});

describe('token / shingle Jaccard — direct', () => {
  test('disjoint sets → 0', () => {
    expect(tokenSimilarity(['a', 'b'], ['c', 'd'])).toBe(0);
  });
  test('two empty sets → 1', () => {
    expect(tokenSimilarity([], [])).toBe(1);
  });
  test('one empty set → 0', () => {
    expect(tokenSimilarity(['a'], [])).toBe(0);
  });
  test('partial overlap Jaccard', () => {
    // {a,b,c} vs {b,c,d}: intersection 2, union 4 → 0.5
    expect(shingleSimilarity(['a', 'b', 'c'], ['b', 'c', 'd'])).toBe(0.5);
  });
});

describe('structuralSimilarity — direct', () => {
  test('identical shapes → 1', () => {
    expect(structuralSimilarity('sent=3|lines=2|avglen=4', 'sent=3|lines=2|avglen=4')).toBe(1);
  });
  test('one of three components differs → 2/3', () => {
    expect(
      structuralSimilarity('sent=3|lines=2|avglen=4', 'sent=3|lines=2|avglen=5'),
    ).toBeCloseTo(2 / 3, 10);
  });
  test('two empty shapes → 1', () => {
    expect(structuralSimilarity('', '')).toBe(1);
  });
});

describe('cosine — direct', () => {
  test('identical vectors → 1', () => {
    expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
  });
  test('orthogonal vectors → 0', () => {
    expect(cosine([1, 0], [0, 1])).toBe(0);
  });
  test('opposite vectors → -1', () => {
    expect(cosine([1, 2], [-1, -2])).toBeCloseTo(-1, 10);
  });
  test('mismatched length / empty / zero vector → 0', () => {
    expect(cosine([1, 2, 3], [1, 2])).toBe(0);
    expect(cosine([], [])).toBe(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
});

describe('emoji content is comparable without crashing', () => {
  test('emoji-decorated duplicate matches its plain twin on fuzzy dims', () => {
    const plain = computeFingerprint('Ship the new feature today');
    const emoji = computeFingerprint('🚀 Ship the new feature today 🎉');
    expect(() => simhashSimilarity(plain.simhash, emoji.simhash)).not.toThrow();
    // Emoji are stripped in normalization → identical normalized content.
    expect(normalizedEqual(plain.normalizedHash, emoji.normalizedHash)).toBe(true);
    expect(tokenSimilarity(plain.tokenSummary.tokens, emoji.tokenSummary.tokens)).toBe(1);
  });
});
