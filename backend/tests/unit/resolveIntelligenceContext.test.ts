/**
 * Phase 6D-A / 6E-2 — Intelligent Mix intelligence resolver tests.
 *
 * Exercises the REAL resolver + formatter with its LIVE company-scoped sources
 * mocked (marketing_memory + companyPerformanceAggregator). Proves: empty signals
 * degrade, outputs clip to 5, HIGH-confidence floor, platform rankings come from
 * company-scoped signals, the resolver never throws, and the formatter caps at 10.
 */

jest.mock('@/backend/services/marketingMemoryService', () => ({
  getMarketingMemoriesByType: jest.fn(),
}));
jest.mock('@/backend/services/companyPerformanceAggregator', () => ({
  rankPlatformsByCompanyPerformance: jest.fn(),
  rankContentTypesByCompanyPerformance: jest.fn(),
}));

import {
  resolveIntelligenceContext,
  formatIntelligenceContextBlock,
  formatIntelligenceForPlanning,
  normalizePlanningIntelligenceMode,
  shouldResolvePlanningIntelligence,
  shouldEnrichPlanning,
} from '@/lib/shared/intelligence/resolveIntelligenceContext';
import { getMarketingMemoriesByType } from '@/backend/services/marketingMemoryService';
import { rankPlatformsByCompanyPerformance } from '@/backend/services/companyPerformanceAggregator';

const mockMemByType = getMarketingMemoriesByType as jest.Mock;
const mockPlatformRanker = rankPlatformsByCompanyPerformance as jest.Mock;

function memory(memoryType: string, memory_value: Record<string, unknown>, confidence = 0.85) {
  return { company_id: 'c1', memory_type: memoryType, memory_key: 'k', memory_value, confidence };
}

/** Route getMarketingMemoriesByType(companyId, type) → rows by type. */
function setMemory(rows: { content_performance?: unknown[]; narrative_performance?: unknown[]; campaign_outcome?: unknown[] }) {
  mockMemByType.mockImplementation((_companyId: string, type: string) =>
    Promise.resolve((rows as Record<string, unknown[]>)[type] ?? []),
  );
}

beforeEach(() => {
  mockMemByType.mockReset();
  mockPlatformRanker.mockReset();
  mockMemByType.mockResolvedValue([]);
  mockPlatformRanker.mockResolvedValue([]);
});

describe('6D-A/6E-2 resolver — resolveIntelligenceContext', () => {
  test('1. empty signals → all empty arrays (graceful degradation)', async () => {
    const out = await resolveIntelligenceContext({ companyId: 'c1' });
    expect(out).toEqual({ topLearnings: [], platformRankings: [], contentBiases: [] });
  });

  test('2. clips topLearnings to max 5', async () => {
    setMemory({
      content_performance: Array.from({ length: 10 }, (_, i) => memory('content_performance', { format: `fmt${i}`, avg_engagement: 8 })),
    });
    const out = await resolveIntelligenceContext({ companyId: 'c1' });
    expect(out.topLearnings.length).toBe(5);
  });

  test('3. never throws when a source rejects → returns empty', async () => {
    mockMemByType.mockRejectedValue(new Error('db down'));
    mockPlatformRanker.mockRejectedValue(new Error('db down'));
    await expect(resolveIntelligenceContext({ companyId: 'c1' })).resolves.toEqual({
      topLearnings: [],
      platformRankings: [],
      contentBiases: [],
    });
  });

  test('4. HIGH-confidence floor — low-confidence memory excluded', async () => {
    setMemory({
      content_performance: [
        memory('content_performance', { format: 'lowconf' }, 0.4),
        memory('content_performance', { format: 'highconf' }, 0.8),
      ],
    });
    const out = await resolveIntelligenceContext({ companyId: 'c1' });
    expect(out.contentBiases).toHaveLength(1);
    expect(out.contentBiases[0]).toContain('highconf');
  });

  test('2(platform). platformRankings come from company-scoped signals', async () => {
    mockPlatformRanker.mockResolvedValue([
      { platform: 'linkedin', avg_engagement_rate: 0.07, post_count: 10 },
      { platform: 'x', avg_engagement_rate: 0.02, post_count: 8 },
    ]);
    const out = await resolveIntelligenceContext({ companyId: 'c1' });
    expect(mockPlatformRanker).toHaveBeenCalledWith('c1');
    expect(out.platformRankings[0]).toContain('linkedin');
    expect(out.platformRankings[0]).toContain('high engagement');
  });

  test('1(format). contentBiases come from marketing_memory content_performance', async () => {
    setMemory({ content_performance: [memory('content_performance', { format: 'carousel', avg_engagement: 9 })] });
    const out = await resolveIntelligenceContext({ companyId: 'c1' });
    expect(out.contentBiases[0]).toContain('carousel');
    expect(out.topLearnings[0]).toContain('carousel'); // also surfaces as a learning line
  });

  test('narrative_performance contributes a learning line', async () => {
    setMemory({ narrative_performance: [memory('narrative_performance', { narrative: 'underdog story', engagement_score: 8 }, 0.8)] });
    const out = await resolveIntelligenceContext({ companyId: 'c1' });
    expect(out.topLearnings.join(' ')).toContain('underdog story');
  });

  test('blank companyId → empty (never queries)', async () => {
    const out = await resolveIntelligenceContext({ companyId: '   ' });
    expect(out).toEqual({ topLearnings: [], platformRankings: [], contentBiases: [] });
    expect(mockMemByType).not.toHaveBeenCalled();
    expect(mockPlatformRanker).not.toHaveBeenCalled();
  });
});

describe('6D-A resolver — formatIntelligenceContextBlock', () => {
  test('empty context → empty string (nothing to inject)', () => {
    expect(formatIntelligenceContextBlock({ topLearnings: [], platformRankings: [], contentBiases: [] })).toBe('');
  });

  test('non-empty → header present, capped at 10 lines', () => {
    const block = formatIntelligenceContextBlock({
      topLearnings: ['a', 'b', 'c', 'd', 'e'],
      platformRankings: ['linkedin (high engagement)', 'x (medium engagement)', 'p3', 'p4', 'p5'],
      contentBiases: ['c1', 'c2', 'c3', 'c4', 'c5'],
    });
    const lines = block.split('\n');
    expect(lines[0]).toBe('INTELLIGENCE INSIGHTS');
    expect(lines.length).toBeLessThanOrEqual(10);
    // never emits a section header with no items
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].endsWith(':')) {
        expect(lines[i + 1]?.startsWith('- ')).toBe(true);
      }
    }
  });
});

// ─── Phase 6D-B — plan-generation reuse + gating ────────────────────────────
describe('6D-B — formatIntelligenceForPlanning (PerformanceInsight reuse)', () => {
  test('2/10. empty intelligence → null (caller omits the field; never breaks planning)', () => {
    expect(formatIntelligenceForPlanning({ topLearnings: [], platformRankings: [], contentBiases: [] })).toBeNull();
  });

  test('maps learnings/platforms → opportunities, content → recommendations', () => {
    const out = formatIntelligenceForPlanning({
      topLearnings: ['Educational beats promo'],
      platformRankings: ['linkedin (strong engagement)'],
      contentBiases: ['carousel: outperforms static'],
    });
    expect(out).not.toBeNull();
    expect(out!.opportunities).toEqual(['Educational beats promo', 'linkedin (strong engagement)']);
    expect(out!.recommendations).toEqual(['carousel: outperforms static']);
    expect(out!.issues).toEqual([]);
    expect(typeof out!.plannerFeedback).toBe('string');
  });

  test('9. total advisory lines hard-capped at 10', () => {
    const out = formatIntelligenceForPlanning({
      topLearnings: ['a', 'b', 'c', 'd', 'e'],
      platformRankings: ['p1', 'p2', 'p3', 'p4', 'p5'],
      contentBiases: ['c1', 'c2', 'c3', 'c4', 'c5'],
    });
    expect(out).not.toBeNull();
    expect(out!.opportunities.length + out!.recommendations.length).toBeLessThanOrEqual(10);
    expect(out!.linesAdded).toBeLessThanOrEqual(10);
  });
});

describe('6D-B — planning intelligence gating (combined-only + mode)', () => {
  test('mode normalization defaults to shadow', () => {
    expect(normalizePlanningIntelligenceMode(undefined)).toBe('shadow');
    expect(normalizePlanningIntelligenceMode('nonsense')).toBe('shadow');
    expect(normalizePlanningIntelligenceMode('OFF')).toBe('off');
    expect(normalizePlanningIntelligenceMode('Advisory')).toBe('advisory');
    expect(normalizePlanningIntelligenceMode('active')).toBe('active');
  });

  test('5. combined campaigns resolve when mode !== off', () => {
    expect(shouldResolvePlanningIntelligence('shadow', true)).toBe(true);
    expect(shouldResolvePlanningIntelligence('advisory', true)).toBe(true);
    expect(shouldResolvePlanningIntelligence('active', true)).toBe(true);
  });

  test('8. off mode never resolves (planning prompt unchanged)', () => {
    expect(shouldResolvePlanningIntelligence('off', true)).toBe(false);
  });

  test('6/7. text & creator (non-combined) NEVER resolve in any mode', () => {
    for (const mode of ['shadow', 'advisory', 'active', 'off'] as const) {
      expect(shouldResolvePlanningIntelligence(mode, false)).toBe(false);
    }
  });

  test('3. shadow computes but does NOT enrich; 4. advisory/active enrich', () => {
    expect(shouldEnrichPlanning('shadow')).toBe(false);
    expect(shouldEnrichPlanning('off')).toBe(false);
    expect(shouldEnrichPlanning('advisory')).toBe(true);
    expect(shouldEnrichPlanning('active')).toBe(true);
  });
});
