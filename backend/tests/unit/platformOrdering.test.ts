/**
 * Phase 6D-C — adaptive platform prioritization tests.
 *
 * Proves ORDERING-ONLY behavior: membership is never changed, only order — and
 * only in combined mode under advisory/active. Eligibility is decided upstream
 * (boltPipelineService) and is out of this helper's reach by construction.
 */

import {
  orderPlatformsForIntelligentMix,
  normalizePlatformPriorityMode,
  shouldPrioritizePlatforms,
  type PlatformPerformanceRank,
} from '@/lib/shared/intelligence/platformOrdering';

const RANKS: PlatformPerformanceRank[] = [
  { platform: 'youtube', score: 9.1 },
  { platform: 'linkedin', score: 8.5 },
  { platform: 'x', score: 4.3 },
];

describe('6D-C — orderPlatformsForIntelligentMix', () => {
  test('1/6. advisory reorders by performance', () => {
    const r = orderPlatformsForIntelligentMix(['linkedin', 'youtube', 'x'], RANKS, 'advisory');
    expect(r.order).toEqual(['youtube', 'linkedin', 'x']);
    expect(r.changed).toBe(true);
    expect(r.rankingCount).toBe(3);
  });

  test('2. stable: equal scores preserve original order', () => {
    const tie: PlatformPerformanceRank[] = [
      { platform: 'linkedin', score: 5 },
      { platform: 'x', score: 5 },
      { platform: 'facebook', score: 5 },
    ];
    const r = orderPlatformsForIntelligentMix(['linkedin', 'x', 'facebook'], tie, 'advisory');
    expect(r.order).toEqual(['linkedin', 'x', 'facebook']);
    expect(r.changed).toBe(false);
  });

  test('3. unknown (unranked) platforms retain original order, behind ranked', () => {
    // only youtube ranked; linkedin + x unranked keep their relative order
    const r = orderPlatformsForIntelligentMix(['linkedin', 'youtube', 'x'], [{ platform: 'youtube', score: 7 }], 'advisory');
    expect(r.order).toEqual(['youtube', 'linkedin', 'x']);
    // membership identical
    expect([...r.order].sort()).toEqual(['linkedin', 'x', 'youtube']);
  });

  test('4. empty rankings preserve order', () => {
    const r = orderPlatformsForIntelligentMix(['linkedin', 'youtube', 'x'], [], 'advisory');
    expect(r.order).toEqual(['linkedin', 'youtube', 'x']);
    expect(r.changed).toBe(false);
    expect(r.rankingCount).toBe(0);
  });

  test('5. shadow computes proposed order but applies the ORIGINAL order', () => {
    const r = orderPlatformsForIntelligentMix(['linkedin', 'youtube', 'x'], RANKS, 'shadow');
    expect(r.order).toEqual(['linkedin', 'youtube', 'x']); // applied = unchanged
    expect(r.proposedOrder).toEqual(['youtube', 'linkedin', 'x']); // would-be (for logging)
    expect(r.changed).toBe(true);
  });

  test('off mode applies original order and does not rank', () => {
    const r = orderPlatformsForIntelligentMix(['linkedin', 'youtube', 'x'], RANKS, 'off');
    expect(r.order).toEqual(['linkedin', 'youtube', 'x']);
    expect(r.rankingCount).toBe(0);
    expect(r.changed).toBe(false);
  });

  test('10/11/12. membership preserved — nothing added or removed (permutation)', () => {
    const eligible = ['linkedin', 'youtube', 'x', 'instagram'];
    const r = orderPlatformsForIntelligentMix(eligible, RANKS, 'advisory');
    expect(r.order.length).toBe(eligible.length); // none added/removed
    expect([...r.order].sort()).toEqual([...eligible].sort()); // same set
    for (const p of r.order) expect(eligible).toContain(p); // no platform added
    for (const p of eligible) expect(r.order).toContain(p); // no platform removed
  });

  test('twitter alias normalizes to x for rank matching', () => {
    const r = orderPlatformsForIntelligentMix(['linkedin', 'x'], [{ platform: 'twitter', score: 99 }], 'advisory');
    expect(r.order).toEqual(['x', 'linkedin']); // x matched via twitter→x rank
  });
});

describe('6D-C — gating (combined-only + mode)', () => {
  test('mode normalization defaults to shadow', () => {
    expect(normalizePlatformPriorityMode(undefined)).toBe('shadow');
    expect(normalizePlatformPriorityMode('weird')).toBe('shadow');
    expect(normalizePlatformPriorityMode('Advisory')).toBe('advisory');
    expect(normalizePlatformPriorityMode('OFF')).toBe('off');
    expect(normalizePlatformPriorityMode('active')).toBe('active');
  });

  test('7. combined campaigns prioritize when mode !== off', () => {
    expect(shouldPrioritizePlatforms('advisory', true)).toBe(true);
    expect(shouldPrioritizePlatforms('shadow', true)).toBe(true);
    expect(shouldPrioritizePlatforms('active', true)).toBe(true);
    expect(shouldPrioritizePlatforms('off', true)).toBe(false);
  });

  test('8/9. text & creator (non-combined) NEVER prioritize in any mode', () => {
    for (const mode of ['shadow', 'advisory', 'active', 'off'] as const) {
      expect(shouldPrioritizePlatforms(mode, false)).toBe(false);
    }
  });
});
