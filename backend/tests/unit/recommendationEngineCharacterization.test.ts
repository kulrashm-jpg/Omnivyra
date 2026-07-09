/**
 * CHARACTERIZATION SUITE — recommendationEngine/engine.ts (generateRecommendations +
 * getRecommendedTopicsForCompany).
 *
 * These tests lock CURRENT observable behavior of the 1,000-line orchestrator so that
 * future refactoring of engine.ts can be verified against a golden master. They are NOT
 * a spec of desired behavior — if one fails after an intentional product change, update
 * the assertion deliberately.
 *
 * Seams mocked (every IO/AI/network boundary the engine crosses):
 *   DB reads      → recommendationEngineReadRepository (sole DB seam for engine+helpers)
 *   profile/DB    → companyProfileService, campaignMemoryService, campaignIntelligenceService,
 *                   campaignLearningService, companyContextIntelligenceService,
 *                   companyThemeStateService, themeOriginalityGuard
 *   external APIs → externalApiService, trendNormalizationService
 *   Omnivyra AI   → omnivyraClientV1, omnivyraHealthService, omnivyraFeedbackService
 *   LLM themes    → strategicThemeEngine, companyTrendRelevanceEngine (dynamic imports)
 *   plan builder  → campaignRecommendationService
 *
 * Kept REAL (part of the unit under characterization): engine.ts, engineHelpers.ts,
 * scoringHelpers.ts, trendProcessingService (pure merge/tag), durationNormalization,
 * themeKeyService-equivalent key mock (lowercased topic).
 */

// ── Sole DB seam ──
jest.mock('../../repositories/recommendationEngineReadRepository', () => ({
  loadRecommendedTopicSnapshotRows: jest.fn(async () => []),
  campaignCompanyLinkExists: jest.fn(async () => true),
  loadIntelligenceSignalLookupRows: jest.fn(async () => []),
  loadLatestCampaignLearning: jest.fn(async () => null),
  loadLatestEnhancementLog: jest.fn(async () => null),
  loadTrackingClickRows: jest.fn(async () => []),
}));

// ── Profile / campaign context ──
jest.mock('../../services/companyProfileService', () => ({
  getProfile: jest.fn(async () => null),
}));
jest.mock('../../services/campaignMemoryService', () => ({
  getCampaignMemory: jest.fn(async () => ({})),
  validateUniqueness: jest.fn(async () => ({ similarityScore: 0.2 })),
}));
jest.mock('../../services/campaignIntelligenceService', () => ({
  getCampaignIntelligence: jest.fn(async () => null),
  getRecentCampaignIntelligenceForCompany: jest.fn(async () => []),
  normalizeCampaignTopic: (t: unknown) => String(t ?? '').trim() || null,
}));
jest.mock('../../services/campaignLearningService', () => ({
  getCompanyPerformanceInsights: jest.fn(async () => ({
    company_high_performing_themes: [],
    company_high_performing_platforms: [],
    company_high_performing_content_types: [],
    company_low_performing_patterns: [],
  })),
}));
jest.mock('../../services/companyContextIntelligenceService', () => ({
  getCompanyContextIntelligence: jest.fn(async () => null),
}));
jest.mock('../../services/companyContextService', () => ({
  buildCompanyContext: jest.fn((p: any) => ({ company_name: p?.company_name ?? null })),
}));
jest.mock('../../services/companyMissionContext', () => ({
  deriveDisqualifiedSignals: jest.fn(() => []),
}));

// ── External API boundary ──
jest.mock('../../services/externalApiService', () => ({
  fetchExternalApis: jest.fn(async () => ({ results: [], missing_env_placeholders: [] })),
  getEnabledApis: jest.fn(async () => [{ id: 'api-1' }]),
  getExternalApiRuntimeSnapshot: jest.fn(async () => ({
    health_snapshot: [{ api_source_id: 'api-1', health_score: 0.9 }],
    cache_stats: { hits: 0, misses: 0 },
    rate_limited_sources: [],
    signal_confidence_summary: { average: 0.8, min: 0.7, max: 0.9 },
  })),
  getPlatformStrategies: jest.fn(async () => [
    { platform_type: 'linkedin', supported_content_types: ['post'] },
  ]),
  recordSignalConfidenceSummary: jest.fn(),
}));
jest.mock('../../services/trendNormalizationService', () => ({
  normalizeTrends: jest.fn(() => []),
}));

// ── Omnivyra AI boundary ──
jest.mock('../../services/omnivyraClientV1', () => ({
  isOmnivyraEnabled: jest.fn(() => false),
  getOmnivyraHealthReport: jest.fn(() => ({ status: 'disabled', last_error: null })),
  getTrendRelevance: jest.fn(async () => ({ status: 'error', error: { message: 'unused' } })),
  getTrendRanking: jest.fn(async () => ({ status: 'error', error: { message: 'unused' } })),
}));
jest.mock('../../services/omnivyraHealthService', () => {
  let reason: string | null = null;
  return {
    setLastFallbackReason: jest.fn((r: string | null) => { reason = r; }),
    getLastFallbackReason: jest.fn(() => reason),
    getLastMeta: jest.fn(() => null),
    __resetFallbackReason: () => { reason = null; },
  };
});
jest.mock('../../services/omnivyraFeedbackService', () => ({
  sendLearningSnapshot: jest.fn(async () => ({ status: 'sent' })),
}));

// ── Plan generation ──
jest.mock('../../services/campaignRecommendationService', () => ({
  generateCampaignStrategy: jest.fn(async () => ({
    weekly_plan: [{ week: 1, theme: 'Week one theme' }],
    daily_plan: [{ day: 1, action: 'Post' }],
  })),
}));

// ── Downstream shaping services (deterministic stubs) ──
jest.mock('../../services/recommendationPolishService', () => ({
  polishRecommendations: jest.fn(() => []),
}));
jest.mock('../../services/companyStrategyDNAService', () => ({
  buildCompanyStrategyDNA: jest.fn(() => ({ archetype: 'test-dna' })),
}));
jest.mock('../../services/recommendationStrategyFeedbackService', () => ({
  analyzeStrategySignals: jest.fn(() => ({ strengths: [], gaps: [] })),
}));
jest.mock('../../services/recommendationSequencingService', () => ({
  sequenceRecommendations: jest.fn((recs: any[]) => ({
    ladder: [{ stage: 'awareness', recommendations: recs.map((r) => ({ topic: r.topic })) }],
  })),
}));
jest.mock('../../services/recommendationBlueprintService', () => ({
  buildCampaignBlueprint: jest.fn(() => ({ weeks: [{ week: 1 }] })),
}));
jest.mock('../../services/recommendationBlueprintValidationService', () => ({
  validateCampaignBlueprint: jest.fn((bp: any) => ({ issues: [], corrected_blueprint: bp })),
}));
jest.mock('../../services/blueprintExecutionResolver', () => ({
  resolveExecutionBlueprint: jest.fn((r: any) => r.campaign_blueprint_validated ?? null),
  EXECUTION_SOURCE_VALIDATED: 'validated_blueprint',
}));
jest.mock('../../services/recommendationCardEnrichmentService', () => ({
  enrichRecommendationCards: jest.fn((r: any) => r),
}));
jest.mock('../../services/recommendationFallbackSignalService', () => ({
  buildFallbackRecommendationSignals: jest.fn(() => []),
}));
jest.mock('../../utils/themeOriginalityGuard', () => ({
  loadRecentCompanyThemes: jest.fn(async () => []),
  checkThemeOriginality: jest.fn(() => ({ hasOverlap: false, overlappingPairs: [], maxScore: 0 })),
  DEFAULT_ORIGINALITY_THRESHOLD: 0.85,
}));

// ── Dynamically-imported LLM/theme modules ──
jest.mock('../../services/strategicThemeEngine', () => ({
  generateAdditionalStrategicThemes: jest.fn(async () => []),
  getStrategicThemesAsOpportunities: jest.fn(async () => []),
}));
jest.mock('../../services/companyTrendRelevanceEngine', () => ({
  getThemesForCompany: jest.fn(async () => []),
}));
jest.mock('../../services/themeKeyService', () => ({
  generateThemeKey: (t: unknown) => String(t ?? '').trim().toLowerCase(),
}));
jest.mock('../../services/companyThemeStateService', () => ({
  getExcludedThemeTopicsForCompany: jest.fn(async () => []),
}));

import {
  generateRecommendations,
  getRecommendedTopicsForCompany,
} from '../../services/recommendationEngine/engine';
import {
  loadRecommendedTopicSnapshotRows,
} from '../../repositories/recommendationEngineReadRepository';
import { getProfile } from '../../services/companyProfileService';
import { normalizeTrends } from '../../services/trendNormalizationService';
import { validateUniqueness } from '../../services/campaignMemoryService';
import { generateCampaignStrategy } from '../../services/campaignRecommendationService';
import {
  getExternalApiRuntimeSnapshot,
} from '../../services/externalApiService';
import {
  isOmnivyraEnabled,
  getTrendRelevance,
  getTrendRanking,
} from '../../services/omnivyraClientV1';
import { sendLearningSnapshot } from '../../services/omnivyraFeedbackService';
import { buildFallbackRecommendationSignals } from '../../services/recommendationFallbackSignalService';
import { generateAdditionalStrategicThemes } from '../../services/strategicThemeEngine';
import { getExcludedThemeTopicsForCompany } from '../../services/companyThemeStateService';

const omnivyraHealthMock = jest.requireMock('../../services/omnivyraHealthService');

/** Sparse profile: no baseline-context keys → buildCoreProblemTokens is EMPTY → the
 *  keyword pre-filter passes ALL signals (documented sparse-profile behavior). */
const SPARSE_PROFILE = { id: 'co-1', company_name: 'Acme Co' };

/** Tokened profile: industry tokens make the keyword pre-filter selective. */
const TOKENED_PROFILE = { id: 'co-1', company_name: 'Acme Co', industry: 'retail analytics' };

const normalizedTrend = (title: string, volume: number, confidence = 0.8) => ({
  title,
  source: 'external_api',
  geo: 'US',
  volume,
  confidence,
});

/** Six distinct signals, distinct volumes → deterministic popularity ordering. */
const SIX_TRENDS = [
  normalizedTrend('retail analytics adoption', 90),
  normalizedTrend('customer loyalty programs', 80),
  normalizedTrend('inventory forecasting', 70),
  normalizedTrend('omnichannel retail growth', 60),
  normalizedTrend('checkout personalization', 50),
  normalizedTrend('supply chain visibility', 40),
];

const baseInput = { companyId: 'co-1', campaignId: null } as const;

beforeEach(() => {
  // Re-assert defaults that per-test overrides may have changed (config clearMocks only
  // clears call history, not implementations/return values).
  (getProfile as jest.Mock).mockResolvedValue(SPARSE_PROFILE);
  (normalizeTrends as jest.Mock).mockReturnValue([]);
  (validateUniqueness as jest.Mock).mockResolvedValue({ similarityScore: 0.2 });
  (isOmnivyraEnabled as jest.Mock).mockReturnValue(false);
  (buildFallbackRecommendationSignals as jest.Mock).mockReturnValue([]);
  (generateAdditionalStrategicThemes as jest.Mock).mockResolvedValue([]);
  (getExcludedThemeTopicsForCompany as jest.Mock).mockResolvedValue([]);
  (getExternalApiRuntimeSnapshot as jest.Mock).mockResolvedValue({
    health_snapshot: [{ api_source_id: 'api-1', health_score: 0.9 }],
    cache_stats: { hits: 0, misses: 0 },
    rate_limited_sources: [],
    signal_confidence_summary: { average: 0.8, min: 0.7, max: 0.9 },
  });
  (generateCampaignStrategy as jest.Mock).mockResolvedValue({
    weekly_plan: [{ week: 1, theme: 'Week one theme' }],
    daily_plan: [{ day: 1, action: 'Post' }],
  });
  omnivyraHealthMock.__resetFallbackReason();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('getRecommendedTopicsForCompany (characterization)', () => {
  it('aggregates max score per topic, sorts descending, applies limit, drops blank topics', async () => {
    (loadRecommendedTopicSnapshotRows as jest.Mock).mockResolvedValue([
      { trend_topic: 'alpha', final_score: 0.5 },
      { trend_topic: 'alpha', final_score: 0.9 },
      { trend_topic: 'beta', final_score: 0.7 },
      { trend_topic: 'gamma', final_score: 0.95 },
      { trend_topic: '   ', final_score: 1.0 },
      { trend_topic: 'delta', final_score: 'not-a-number' },
    ]);
    const topics = await getRecommendedTopicsForCompany('co-1', 3);
    expect(topics).toEqual(['gamma', 'alpha', 'beta']);
    expect(loadRecommendedTopicSnapshotRows).toHaveBeenCalledWith('co-1', expect.any(String));
  });

  it('returns [] when the snapshot window is empty', async () => {
    (loadRecommendedTopicSnapshotRows as jest.Mock).mockResolvedValue([]);
    await expect(getRecommendedTopicsForCompany('co-1')).resolves.toEqual([]);
  });
});

describe('generateRecommendations — hybrid single-geo path (Omnivyra disabled)', () => {
  it('golden master: external signals → EXTERNAL result with popularity-ordered topics', async () => {
    (normalizeTrends as jest.Mock).mockReturnValue(SIX_TRENDS);
    const result = await generateRecommendations({ ...baseInput });

    // Signal flow: sparse profile → empty token set → all 6 pass the keyword pre-filter;
    // Omnivyra disabled → alignment-then-popularity ordering (all alignment 0 → volume desc).
    expect(result.signals_source).toBe('EXTERNAL');
    expect(result.trends_used.map((t) => t.topic)).toEqual([
      'retail analytics adoption',
      'customer loyalty programs',
      'inventory forecasting',
      'omnichannel retail growth',
      'checkout personalization',
      'supply chain visibility',
    ]);
    expect(result.trends_ignored).toEqual([]);
    // applyTrendInfluence annotates each week with the top-3 used trend topics.
    expect(result.weekly_plan).toEqual([
      {
        week: 1,
        theme: 'Week one theme',
        trend_influence: [
          'retail analytics adoption',
          'customer loyalty programs',
          'inventory forecasting',
        ],
      },
    ]);
    expect(result.daily_plan).toEqual([{ day: 1, action: 'Post' }]);
    expect(result.novelty_score).toBe(0.2);
    expect(result.omnivyra_learning).toEqual({ status: 'skipped' });
    expect(result.omnivyra_status?.fallback_reason).toBe('omnivyra_disabled');
    expect(result.omnivyra_status?.status).toBe('disabled');
    // No novelty retry, no LLM top-up (6 ≥ MIN_THEME_COUNT of 5).
    expect(generateCampaignStrategy).toHaveBeenCalledTimes(1);
    expect(generateAdditionalStrategicThemes).not.toHaveBeenCalled();
    // Lineage backfill: external-path trends carry EXTERNAL_API lineage + source_topic.
    for (const t of result.trends_used) {
      expect(t.signal_type).toBe('EXTERNAL_API');
      expect(t.source_topic).toBe(t.topic);
    }
    // Blueprint chain ran end-to-end on the stubbed sequence.
    expect(result.strategy_sequence).toBeDefined();
    expect(result.campaign_blueprint).toEqual({ weeks: [{ week: 1 }] });
    expect(result.campaign_blueprint_validated).toEqual({ weeks: [{ week: 1 }] });
    expect(result.execution_blueprint_resolved).toEqual({ weeks: [{ week: 1 }] });
    expect(result.execution_source).toBe('validated_blueprint');
    // Full-shape golden master (result is fully deterministic under these mocks).
    expect(result).toMatchSnapshot();
  });

  it('keyword pre-filter: with a tokened profile, non-overlapping topics land in trends_ignored', async () => {
    (getProfile as jest.Mock).mockResolvedValue(TOKENED_PROFILE);
    (normalizeTrends as jest.Mock).mockReturnValue([
      normalizedTrend('retail analytics adoption', 90), // overlaps "retail"/"analytics"
      normalizedTrend('celebrity gossip roundup', 80), // no overlap → filtered out
      normalizedTrend('retail checkout trends', 70), // overlaps "retail"
      normalizedTrend('quantum computing news', 60), // no overlap → filtered out
      normalizedTrend('analytics dashboards', 50), // overlaps "analytics"
    ]);
    const result = await generateRecommendations({ ...baseInput });
    expect(result.trends_used.map((t) => t.topic)).toEqual([
      'retail analytics adoption',
      'retail checkout trends',
      'analytics dashboards',
    ]);
    expect(result.trends_ignored.map((t) => t.topic)).toEqual([
      'celebrity gossip roundup',
      'quantum computing news',
    ]);
  });

  it('novelty guard: similarity > 0.6 regenerates the plan exactly once (two strategy calls)', async () => {
    (normalizeTrends as jest.Mock).mockReturnValue(SIX_TRENDS);
    (validateUniqueness as jest.Mock).mockResolvedValue({ similarityScore: 0.7 });
    (generateCampaignStrategy as jest.Mock)
      .mockResolvedValueOnce({ weekly_plan: [{ week: 1, theme: 'first' }], daily_plan: [] })
      .mockResolvedValueOnce({ weekly_plan: [{ week: 1, theme: 'retry' }], daily_plan: [{ day: 2 }] });
    const result = await generateRecommendations({ ...baseInput });
    expect(generateCampaignStrategy).toHaveBeenCalledTimes(2);
    expect(result.weekly_plan[0]).toMatchObject({ theme: 'retry' });
    expect(result.daily_plan).toEqual([{ day: 2 }]);
    expect(result.novelty_score).toBe(0.7);
  });

  it('theme exclusion: excluded theme keys are removed from trends_used', async () => {
    (normalizeTrends as jest.Mock).mockReturnValue(SIX_TRENDS);
    (getExcludedThemeTopicsForCompany as jest.Mock).mockResolvedValue([
      'customer loyalty programs',
    ]);
    const result = await generateRecommendations({ ...baseInput });
    expect(result.trends_used.map((t) => t.topic)).not.toContain('customer loyalty programs');
    expect(result.trends_used).toHaveLength(5); // 6 − 1 excluded; still ≥ MIN_THEME_COUNT
    expect(generateAdditionalStrategicThemes).not.toHaveBeenCalled();
  });

  it('MIN_THEME_COUNT top-up: below 5 themes triggers AI generation with limit = needed × 2', async () => {
    (normalizeTrends as jest.Mock).mockReturnValue(SIX_TRENDS.slice(0, 3)); // 3 < 5
    (generateAdditionalStrategicThemes as jest.Mock).mockResolvedValue([
      { topic: 'ai theme one' },
      { topic: 'ai theme two' },
      { topic: 'ai theme three' },
    ]);
    const result = await generateRecommendations({ ...baseInput });
    expect(generateAdditionalStrategicThemes).toHaveBeenCalledTimes(1);
    expect((generateAdditionalStrategicThemes as jest.Mock).mock.calls[0][0]).toMatchObject({
      companyId: 'co-1',
      limit: 4, // needed(2) × 2
    });
    expect(result.trends_used).toHaveLength(5); // topped up then sliced to MIN_THEME_COUNT
    const topics = result.trends_used.map((t) => t.topic);
    expect(topics.slice(0, 3)).toEqual([
      'retail analytics adoption',
      'customer loyalty programs',
      'inventory forecasting',
    ]);
    expect(topics.slice(3)).toEqual(['ai theme one', 'ai theme two']);
    const aiTrend = result.trends_used[3] as any;
    expect(aiTrend.source).toBe('ai_generated_fallback');
    expect(aiTrend.signal_confidence).toBe(0.6);
  });
});

describe('generateRecommendations — degraded / fallback paths', () => {
  it('no external signals + no profile fallback + no AI themes → PROFILE_ONLY early return', async () => {
    // normalizeTrends → [] (default), fallback signals → [] (default), AI themes → [] (default)
    const result = await generateRecommendations({ ...baseInput });
    expect(result.signals_source).toBe('PROFILE_ONLY');
    expect(result.trends_used).toEqual([]);
    expect(result.trends_ignored).toEqual([]);
    expect(result.weekly_plan).toEqual([{ week: 1, theme: 'Week one theme' }]);
    expect(result.omnivyra_metadata?.placeholders).toEqual(['no_external_signals']);
    expect(result.omnivyra_learning).toEqual({ status: 'skipped' });
    expect(result.explanation).toContain('No external signals found');
    // Early return: none of the main-path assembly ran.
    expect(result.strategy_sequence).toBeUndefined();
    expect(result.campaign_blueprint).toBeUndefined();
    expect(result).toMatchSnapshot();
  });

  it('profile-context fallback signals keep the main path alive as PROFILE_ONLY', async () => {
    (buildFallbackRecommendationSignals as jest.Mock).mockReturnValue([
      { topic: 'brand storytelling', source: 'profile_context', volume: 55, signal_confidence: 0.5 },
      { topic: 'founder journey', source: 'profile_context', volume: 45, signal_confidence: 0.5 },
      { topic: 'customer wins', source: 'profile_context', volume: 40, signal_confidence: 0.5 },
      { topic: 'behind the scenes', source: 'profile_context', volume: 35, signal_confidence: 0.5 },
      { topic: 'industry myths', source: 'profile_context', volume: 30, signal_confidence: 0.5 },
    ]);
    const result = await generateRecommendations({ ...baseInput });
    expect(result.signals_source).toBe('PROFILE_ONLY');
    // Fallback signals bypass the keyword pre-filter (isAiSourced) and reach the full pipeline.
    expect(result.trends_used.map((t) => t.topic)).toEqual([
      'brand storytelling',
      'founder journey',
      'customer wins',
      'behind the scenes',
      'industry myths',
    ]);
    expect(result.trends_used.every((t) => t.platform_tag !== undefined)).toBe(true);
    expect(result.strategy_sequence).toBeDefined(); // main-path assembly ran
  });

  it('AI-theme rescue: fallback signals empty but AI themes present → main path, PROFILE_ONLY', async () => {
    (generateAdditionalStrategicThemes as jest.Mock).mockResolvedValue([
      { topic: 'thought leadership' },
      { topic: 'community building' },
      { topic: 'product education' },
      { topic: 'trust signals' },
      { topic: 'market trends' },
    ]);
    const result = await generateRecommendations({ ...baseInput });
    expect(result.signals_source).toBe('PROFILE_ONLY');
    expect(result.trends_used.map((t) => t.topic)).toEqual([
      'thought leadership',
      'community building',
      'product education',
      'trust signals',
      'market trends',
    ]);
    expect(result.trends_used.every((t: any) => t.source === 'ai_generated_fallback')).toBe(true);
  });

  it('all sources unhealthy (score < 0.3) discards trends and returns the unhealthy fallback', async () => {
    (normalizeTrends as jest.Mock).mockReturnValue(SIX_TRENDS);
    (getExternalApiRuntimeSnapshot as jest.Mock).mockResolvedValue({
      health_snapshot: [
        { api_source_id: 'api-1', health_score: 0.1 },
        { api_source_id: 'api-2', health_score: 0.2 },
      ],
      cache_stats: { hits: 0, misses: 0 },
      rate_limited_sources: [],
      signal_confidence_summary: null,
    });
    const result = await generateRecommendations({ ...baseInput });
    expect(result.trends_used).toEqual([]);
    expect(result.omnivyra_metadata?.placeholders).toEqual(['all_sources_unhealthy']);
    expect(result.explanation).toBe('External trend sources unavailable.');
    expect(result.signals_source).toBe('PROFILE_ONLY');
  });
});

describe('generateRecommendations — Omnivyra enabled (relevance + ranking + learning)', () => {
  it('applies relevance filtering, ranking order, and sends the learning snapshot', async () => {
    (normalizeTrends as jest.Mock).mockReturnValue(SIX_TRENDS);
    (isOmnivyraEnabled as jest.Mock).mockReturnValue(true);
    (getTrendRelevance as jest.Mock).mockResolvedValue({
      status: 'ok',
      data: {
        relevant_trends: [
          { topic: 'inventory forecasting' },
          { topic: 'retail analytics adoption' },
          { topic: 'checkout personalization' },
        ],
        ignored_trends: [{ topic: 'supply chain visibility' }],
      },
    });
    (getTrendRanking as jest.Mock).mockResolvedValue({
      status: 'ok',
      decision_id: 'dec-1',
      confidence: 0.9,
      explanation: 'ranked by momentum',
      placeholders: [],
      contract_version: 'v1',
      data: {
        ranked_trends: [
          { topic: 'checkout personalization' },
          { topic: 'inventory forecasting' },
          { topic: 'retail analytics adoption' },
        ],
      },
    });
    const result = await generateRecommendations({ ...baseInput });

    // Ranking dictates final order; relevance-dropped topics join trends_ignored.
    // (Only 3 relevant → MIN_THEME_COUNT top-up appends nothing: AI themes mock is [].)
    expect(result.trends_used.map((t) => t.topic)).toEqual([
      'checkout personalization',
      'inventory forecasting',
      'retail analytics adoption',
    ]);
    expect(result.trends_ignored.map((t) => t.topic)).toContain('supply chain visibility');
    expect(result.omnivyra_metadata).toMatchObject({
      decision_id: 'dec-1',
      confidence: 0.9,
      explanation: 'ranked by momentum',
      contract_version: 'v1',
    });
    expect(result.signals_source).toBe('EXTERNAL');
    // Learning snapshot is sent exactly once with used/ignored topic lineage.
    expect(sendLearningSnapshot).toHaveBeenCalledTimes(1);
    const snapshot = (sendLearningSnapshot as jest.Mock).mock.calls[0][0];
    expect(snapshot.companyId).toBe('co-1');
    expect(snapshot.trends_used.map((t: any) => t.topic)).toEqual([
      'checkout personalization',
      'inventory forecasting',
      'retail analytics adoption',
    ]);
    expect(result.omnivyra_learning).toEqual({ status: 'sent' });
  });

  it('relevance/ranking failures fall back gracefully and record the fallback reason', async () => {
    (normalizeTrends as jest.Mock).mockReturnValue(SIX_TRENDS);
    (isOmnivyraEnabled as jest.Mock).mockReturnValue(true);
    (getTrendRelevance as jest.Mock).mockResolvedValue({
      status: 'error',
      error: { message: 'down' },
      _omnivyra_meta: { error_type: 'timeout' },
    });
    (getTrendRanking as jest.Mock).mockResolvedValue({
      status: 'error',
      error: { message: 'down' },
      _omnivyra_meta: { error_type: 'timeout' },
    });
    const result = await generateRecommendations({ ...baseInput });
    // Failure keeps the locally-filtered trends (no discard) and flags the fallback.
    expect(result.trends_used.map((t) => t.topic)).toEqual(
      SIX_TRENDS.map((t) => t.title)
    );
    expect(result.omnivyra_status?.fallback_reason).toBe('timeout');
    expect(result.omnivyra_metadata).toBeUndefined();
  });
});

describe('generateRecommendations — context callback contract', () => {
  it('invokes onContext once with the accreted recommendation context, and callback errors never block', async () => {
    (normalizeTrends as jest.Mock).mockReturnValue(SIX_TRENDS);
    const onContext = jest.fn(() => { throw new Error('listener exploded'); });
    const result = await generateRecommendations({ ...baseInput, durationWeeks: 6 }, { onContext });
    expect(onContext).toHaveBeenCalledTimes(1);
    const ctx = onContext.mock.calls[0][0] as Record<string, unknown>;
    expect(ctx).toMatchObject({
      campaign_duration_weeks: 6,
      expected_number_of_weeks: 6,
      selected_api_ids: null,
    });
    // The throwing listener did not break generation.
    expect(result.trends_used.length).toBeGreaterThan(0);
  });
});
