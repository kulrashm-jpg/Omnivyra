/**
 * Phase 6D-D1 — format preference intelligence tests.
 *
 * Ranking-only: membership preserved, counts untouched, combined-only under
 * advisory/active. Signals come solely from marketing_memory rows.
 */

import {
  orderFormatsForIntelligentMix,
  extractFormatSignalsFromMemory,
  normalizeFormatPriorityMode,
  shouldPrioritizeFormats,
  type FormatPerformanceSignal,
} from '@/lib/shared/intelligence/formatOrdering';

const SIGNALS: FormatPerformanceSignal[] = [
  { format: 'carousel', score: 9 },
  { format: 'video', score: 6 },
];

describe('6D-D1 — orderFormatsForIntelligentMix', () => {
  test('1/6. advisory reorders by performance (ranked first, unranked retain order)', () => {
    const r = orderFormatsForIntelligentMix(['article', 'carousel', 'video'], SIGNALS, 'advisory');
    expect(r.order).toEqual(['carousel', 'video', 'article']);
    expect(r.changed).toBe(true);
    expect(r.rankingCount).toBe(2);
  });

  test('2. stable: equal scores preserve original order', () => {
    const tie: FormatPerformanceSignal[] = [
      { format: 'post', score: 5 },
      { format: 'article', score: 5 },
    ];
    const r = orderFormatsForIntelligentMix(['post', 'article'], tie, 'advisory');
    expect(r.order).toEqual(['post', 'article']);
    expect(r.changed).toBe(false);
  });

  test('3. unknown format preserved (behind ranked, original relative order)', () => {
    const r = orderFormatsForIntelligentMix(['article', 'carousel'], [{ format: 'carousel', score: 7 }], 'advisory');
    expect(r.order).toEqual(['carousel', 'article']);
    expect([...r.order].sort()).toEqual(['article', 'carousel']);
  });

  test('4. empty intelligence preserves order', () => {
    const r = orderFormatsForIntelligentMix(['article', 'carousel'], [], 'advisory');
    expect(r.order).toEqual(['article', 'carousel']);
    expect(r.changed).toBe(false);
    expect(r.rankingCount).toBe(0);
  });

  test('5. shadow computes proposed order but APPLIES original order', () => {
    const r = orderFormatsForIntelligentMix(['article', 'carousel', 'video'], SIGNALS, 'shadow');
    expect(r.order).toEqual(['article', 'carousel', 'video']); // applied = unchanged
    expect(r.proposedOrder).toEqual(['carousel', 'video', 'article']); // would-be
    expect(r.changed).toBe(true);
  });

  test('off mode applies original order, no ranking', () => {
    const r = orderFormatsForIntelligentMix(['article', 'carousel'], SIGNALS, 'off');
    expect(r.order).toEqual(['article', 'carousel']);
    expect(r.rankingCount).toBe(0);
  });

  test('10/11/12. membership preserved — none added or removed (permutation)', () => {
    const input = ['article', 'carousel', 'video', 'post'];
    const r = orderFormatsForIntelligentMix(input, SIGNALS, 'advisory');
    expect(r.order.length).toBe(input.length);
    expect([...r.order].sort()).toEqual([...input].sort());
    for (const f of r.order) expect(input).toContain(f); // none added
    for (const f of input) expect(r.order).toContain(f); // none removed
  });

  test('duplicate formats handled stably (no collapse, no add)', () => {
    const r = orderFormatsForIntelligentMix(['post', 'carousel', 'post'], [{ format: 'carousel', score: 9 }], 'advisory');
    expect(r.order).toEqual(['carousel', 'post', 'post']); // carousel up; the two posts keep order, none lost
    expect(r.order.filter((f) => f === 'post').length).toBe(2);
  });
});

describe('6D-D1 — extractFormatSignalsFromMemory (marketing_memory only)', () => {
  test('reads content_performance format + avg_engagement; confidence-weighted', () => {
    const signals = extractFormatSignalsFromMemory([
      { memory_value: { format: 'carousel', avg_engagement: 8 }, confidence: 1 },
      { memory_value: { format: 'video', avg_engagement: 4 }, confidence: 0.5 },
    ]);
    const byFormat = Object.fromEntries(signals.map((s) => [s.format, s.score]));
    expect(byFormat.carousel).toBeCloseTo(8);
    expect(byFormat.video).toBeCloseTo(4);
  });

  test('narrative_performance rows (no format field) contribute nothing', () => {
    const signals = extractFormatSignalsFromMemory([
      { memory_value: { narrative: 'underdog story', engagement_score: 9 }, confidence: 0.8 },
    ]);
    expect(signals).toEqual([]);
  });

  test('aggregates multiple rows for the same format (weighted average)', () => {
    const signals = extractFormatSignalsFromMemory([
      { memory_value: { format: 'carousel', avg_engagement: 10 }, confidence: 1 },
      { memory_value: { format: 'carousel', avg_engagement: 6 }, confidence: 1 },
    ]);
    expect(signals).toHaveLength(1);
    expect(signals[0].score).toBeCloseTo(8); // (10+6)/2
  });

  test('ignores rows with non-numeric / missing scores; never throws', () => {
    expect(extractFormatSignalsFromMemory([{ memory_value: { format: 'post' } }])).toEqual([]);
    expect(extractFormatSignalsFromMemory([])).toEqual([]);
    expect(extractFormatSignalsFromMemory([{ memory_value: null } as never])).toEqual([]);
  });
});

describe('6D-D1 — gating (combined-only + mode)', () => {
  test('mode normalization defaults to shadow', () => {
    expect(normalizeFormatPriorityMode(undefined)).toBe('shadow');
    expect(normalizeFormatPriorityMode('bogus')).toBe('shadow');
    expect(normalizeFormatPriorityMode('Advisory')).toBe('advisory');
    expect(normalizeFormatPriorityMode('OFF')).toBe('off');
    expect(normalizeFormatPriorityMode('active')).toBe('active');
  });

  test('7. combined campaigns prioritize when mode !== off', () => {
    expect(shouldPrioritizeFormats('advisory', true)).toBe(true);
    expect(shouldPrioritizeFormats('shadow', true)).toBe(true);
    expect(shouldPrioritizeFormats('active', true)).toBe(true);
    expect(shouldPrioritizeFormats('off', true)).toBe(false);
  });

  test('8/9. text & creator (non-combined) NEVER prioritize in any mode', () => {
    for (const mode of ['shadow', 'advisory', 'active', 'off'] as const) {
      expect(shouldPrioritizeFormats(mode, false)).toBe(false);
    }
  });
});
