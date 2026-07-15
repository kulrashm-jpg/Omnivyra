import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET /api/creator-intelligence/strategy-analytics
 *
 * Lightweight dashboard surface for Purpose Strategy Analytics. Joins
 * leaderboards + trends + comparisons + insights + recommendation
 * signals + explainability payloads into a single response so the
 * existing dashboard framework can render the strategy panel without
 * needing five separate endpoints.
 *
 * Phases addressed by this route:
 *   - PHASE 5  — leaderboards per content type, per window
 *   - PHASE 6  — preset cross-family comparisons
 *   - PHASE 7  — evidence-based insights
 *   - PHASE 8  — recommendation signals
 *   - PHASE 9  — dashboard surface (reuses existing framework — same
 *               auth contract + same response shape pattern as the
 *               sibling `/brief` route)
 *   - PHASE 10 — trend analysis
 *   - PHASE 11 — explainability join for the
 *               `media_bundle.metadata.applied_render_strategy` strip
 *
 * Query params:
 *   company_id (required)
 *   window     (optional)  — '7d' | '30d' | '90d' | 'all_time'  (default '30d')
 *   campaign_id (optional) — restricts every aggregation to a single campaign
 *   platform    (optional) — restricts every aggregation to a single platform
 *   creator_id  (optional) — restricts every aggregation to a single creator
 *
 * Response shape is documented inline so the dashboard team can wire
 * the panel without reading source.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess, resolveUserContext } from '../../../backend/services/userContextService';
import {
  type StrategyTimeWindow,
  buildStrategyLeaderboard,
  buildVariantLeaderboard,
  compareStrategies,
} from '../../../backend/services/creator/strategyPerformanceAggregator';
import {
  analyzeStrategyTrends,
  buildStrategyExplainabilityPayloads,
  computeRecommendationSignals,
  generateStrategyInsights,
} from '../../../backend/services/creator/strategyInsightsEngine';
import { listAllStrategyAnalyticsDimensions } from '../../../backend/services/creator/strategyAnalyticsRegistry';
import { detectVariantWinnersForAllStrategies } from '../../../backend/services/creator/variantWinnerEngine';
import {
  analyzeVariantTrends,
  computeVariantRecommendationSignals,
  generateVariantInsights,
} from '../../../backend/services/creator/variantInsightsEngine';
import { listAllVariants } from '../../../backend/services/creator/variantRegistry';
import { listExperiments } from '../../../backend/services/creator/variantExperimentTracker';
import { getVariantOperatorControls } from '../../../backend/services/creator/variantOperatorControls';
import {
  computeLearningPriors,
  listLearningThresholds,
} from '../../../backend/services/creator/strategyLearningEngine';

const VALID_WINDOWS: ReadonlyArray<StrategyTimeWindow> = ['7d', '30d', '90d', 'all_time'];

/** Standard pairwise comparisons surfaced on the dashboard. Mirrors
 *  PHASE 6 of the implementation plan. */
const PRESET_COMPARISONS: ReadonlyArray<{ a: string; b: string; label: string }> = [
  { a: 'image:educational-image',         b: 'image:promotional-image',          label: 'Educational vs Promotional (Image)' },
  { a: 'image:quote-image',               b: 'image:brand-focus-image',          label: 'Quote vs Brand Focus (Image)' },
  { a: 'carousel:story-carousel',         b: 'carousel:framework-carousel',      label: 'Story vs Framework (Carousel)' },
  { a: 'infographic:comparison',          b: 'infographic:timeline',             label: 'Comparison vs Timeline (Infographic)' },
  { a: 'infographic:stats',               b: 'infographic:process',              label: 'Statistics vs Process (Infographic)' },
];

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
  }

  const user = await resolveUserContext(req);
  const companyId = String(req.query.company_id || user?.defaultCompanyId || '').trim();
  if (!companyId) {
    return res.status(400).json({ success: false, error: 'company_id required', code: 'COMPANY_ID_REQUIRED' });
  }

  const requestedWindow = String(req.query.window || '30d').trim();
  const window: StrategyTimeWindow = (VALID_WINDOWS as ReadonlyArray<string>).includes(requestedWindow)
    ? (requestedWindow as StrategyTimeWindow)
    : '30d';
  const campaignId = req.query.campaign_id ? String(req.query.campaign_id).trim() : null;
  const platform = req.query.platform ? String(req.query.platform).trim() : null;
  const creatorId = req.query.creator_id ? String(req.query.creator_id).trim() : null;

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  const baseScope = {
    companyId,
    campaignId,
    platform,
    creatorId,
    window,
  };

  // PHASE 5 — leaderboards. Three per-content-type leaderboards, each
  // ranked by engagement rate (default), tiebroken by sample size.
  const leaderboards = {
    image:       buildStrategyLeaderboard({ ...baseScope, contentType: 'image' }),
    carousel:    buildStrategyLeaderboard({ ...baseScope, contentType: 'carousel' }),
    infographic: buildStrategyLeaderboard({ ...baseScope, contentType: 'infographic' }),
  };

  // PHASE 6 — comparisons. Each returns delta + confidence + sample
  // size; falls back to insufficientData when below the floor.
  const comparisons = PRESET_COMPARISONS.map(({ a, b, label }) => ({
    label,
    ...compareStrategies({ ...baseScope, strategyAId: a, strategyBId: b }),
  }));

  // PHASE 7 + PHASE 8 + PHASE 10 — derived signal surfaces.
  const insights      = generateStrategyInsights(baseScope);
  const signals       = computeRecommendationSignals(baseScope);
  const trends        = analyzeStrategyTrends({ companyId, campaignId, platform, creatorId, window });
  const explainability = buildStrategyExplainabilityPayloads(baseScope);

  // PHASE 11 — surface known dimensions so the dashboard can pre-paint
  // the strategy roster even when no events exist yet.
  const dimensions = listAllStrategyAnalyticsDimensions();

  // ── PHASE 13 — variant view ──────────────────────────────────────
  // Per-strategy variant leaderboards + winners + variant-level
  // insights / signals / trends. Empty arrays for strategies with no
  // variant-attributed events (PHASE 16 regression safety).
  const variantLeaderboards = dimensions.map((dim) => ({
    strategy_id: dim.strategy_id,
    leaderboard: buildVariantLeaderboard({ ...baseScope, strategyId: dim.strategy_id }),
  }));
  const variantWinners = detectVariantWinnersForAllStrategies(baseScope);
  const variantInsights = generateVariantInsights(baseScope);
  const variantSignals = computeVariantRecommendationSignals(baseScope);
  const variantTrends = analyzeVariantTrends({ companyId, campaignId, platform, creatorId, window });
  const variantCatalog = listAllVariants();

  // Creator Performance Learning Engine — Phase 8. Lightweight
  // learning summary per lane + thresholds. Pure read; no recomputation
  // of analytics. The dashboard renders these alongside the existing
  // leaderboards so operators see the additive performance signal that
  // the picker / recommendation engine consumes.
  const learning = {
    thresholds: listLearningThresholds(),
    image: computeLearningPriors({ companyId, contentType: 'image', window }),
    carousel: computeLearningPriors({ companyId, contentType: 'carousel', window }),
    infographic: computeLearningPriors({ companyId, contentType: 'infographic', window }),
  };

  return res.status(200).json({
    success: true,
    scope: { companyId, campaignId, platform, creatorId, window },
    leaderboards,
    comparisons,
    insights,
    signals,
    trends,
    explainability,
    dimensions,
    learning,
    // PHASE 13 — Variant View
    variants: {
      catalog: variantCatalog,
      leaderboards: variantLeaderboards,
      winners: variantWinners,
      insights: variantInsights,
      signals: variantSignals,
      trends: variantTrends,
    },
    // ── PHASE 14 — Variant Execution + Experiment Surfaces ─────────
    // Joins live experiment tracker state, operator controls, and
    // winner-recommendation signals into the dashboard so the
    // Campaign UI can render an "Active Experiments" + "Recommended
    // Winners" panel without a second round-trip.
    execution: {
      active_experiments: listExperiments({ companyId, campaignId, state: 'active' }),
      completed_experiments: listExperiments({ companyId, campaignId, state: 'completed' }),
      winner_recommendations: variantWinners.filter((w) => !w.insufficientData),
      operator_controls: getVariantOperatorControls(companyId),
      summary: {
        total_experiments_in_scope: listExperiments({ companyId, campaignId, state: 'all' }).length,
        strategies_with_declared_winner: variantWinners.filter((w) => !w.insufficientData).length,
        strategies_without_winner: variantWinners.filter((w) => w.insufficientData).length,
      },
    },
  });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/creator-intelligence/strategy-analytics' });
