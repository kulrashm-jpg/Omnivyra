/**
 * GET /api/companies/:id/intelligence
 *
 * Returns the full intelligence snapshot for a company:
 *   - Pattern detection results
 *   - Market positioning
 *   - Competitor intelligence
 *   - Strategy evolution (latest)
 *   - Portfolio decision (if ≥ 2 campaigns)
 *   - "Why AI did this" / "What changed" / "What is improving"
 *
 * Auth: Bearer token
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { detectWinningPatterns } from '@/backend/services/patternDetectionService';
import { evaluateMarketPosition } from '@/backend/services/marketPositioningEngine';
import { fetchCompetitorSignals } from '@/backend/services/competitorIntelligenceService';
import { evolveStrategy } from '@/backend/services/strategyEvolutionEngine';
import { evaluatePortfolioDecision } from '@/backend/services/portfolioDecisionEngine';
import { getDecisionLog } from '@/backend/services/autonomousDecisionLogger';
import { getEffectiveLearnings } from '@/backend/services/learningDecayService';
import { injectGlobalPatternsIntoPrompt } from '@/backend/services/globalPatternService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { user } = await getSupabaseUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Invalid token' });

  const companyId = req.query.id as string;

  // Determine what sections to include (query params for partial loads)
  const sections = ((req.query.sections as string) ?? 'patterns,market,competitors,evolution,portfolio,decisions,learnings').split(',');
  const include = new Set(sections);

  const [
    patterns,
    market,
    competitors,
    evolution,
    portfolio,
    recentDecisions,
    topLearnings,
    globalPatternContext,
  ] = await Promise.all([
    include.has('patterns')   ? detectWinningPatterns(companyId).catch(() => null) : Promise.resolve(null),
    include.has('market')     ? evaluateMarketPosition(companyId).catch(() => null) : Promise.resolve(null),
    include.has('competitors')? fetchCompetitorSignals(companyId).catch(() => null) : Promise.resolve(null),
    include.has('evolution')  ? evolveStrategy(companyId).catch(() => null) : Promise.resolve(null),
    include.has('portfolio')  ? evaluatePortfolioDecision(companyId).catch(() => null) : Promise.resolve(null),
    include.has('decisions')  ? getDecisionLog(companyId, { limit: 10 }).catch(() => []) : Promise.resolve([]),
    include.has('learnings')  ? getEffectiveLearnings(companyId, { limit: 10 }).catch(() => []) : Promise.resolve([]),
    include.has('global')     ? injectGlobalPatternsIntoPrompt(['linkedin', 'instagram']).catch(() => '') : Promise.resolve(''),
  ]);

  // ── "What changed this week" ──────────────────────────────────────────────
  const oneWeekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  const recentChanges = (recentDecisions as any[])
    .filter((d: any) => d.created_at >= oneWeekAgo)
    .map((d: any) => ({
      what: d.reason,
      type: d.decision_type,
      when: d.created_at,
    }));

  // ── "What is improving" ──────────────────────────────────────────────────
  const improving = (topLearnings as any[])
    .filter((l: any) => l.engagement_impact > 0 && l.times_reinforced > 0)
    .slice(0, 5)
    .map((l: any) => ({
      pattern:          l.pattern,
      platform:         l.platform,
      effective_score:  l.effective_score,
      times_reinforced: l.times_reinforced,
    }));

  // ── "Why AI did this" — last 3 major decisions ────────────────────────────
  const whyAiDidThis = (recentDecisions as any[])
    .filter((d: any) => ['generate', 'scale', 'pause', 'recover', 'optimize'].includes(d.decision_type))
    .slice(0, 3)
    .map((d: any) => ({
      decision: d.decision_type,
      reason:   d.reason,
      outcome:  d.outcome,
      when:     d.created_at,
    }));

  return res.status(200).json({
    success: true,
    data: {
      patterns,
      market_positioning: market,
      competitor_intelligence: competitors,
      strategy_evolution:     evolution,
      portfolio_decision:     portfolio,
      global_pattern_context: globalPatternContext,
      insight_surfaces: {
        why_ai_did_this: whyAiDidThis,
        what_changed_this_week: recentChanges,
        what_is_improving: improving,
      },
    },
  });
}
