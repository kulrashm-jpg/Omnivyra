/**
 * Strategy Evolution Engine — Step 6
 *
 * Analyses how a company's strategy should shift over time based on:
 *   - Platform performance trends (which are growing / declining)
 *   - Content-type performance shifts
 *   - Market positioning gaps
 *   - Campaign goal alignment with current outcomes
 *
 * Outputs a strategy evolution recommendation with platform mix,
 * content-type ratio, and campaign goal adjustments.
 *
 * Changes are logged to `strategy_evolution_log` for audit and rollback.
 */

import { supabase } from '../db/supabaseClient';
import { rankPlatformsByPerformance } from './platformPerformanceRanker';
import { evaluateMarketPosition } from './marketPositioningEngine';
import { getEffectiveLearnings } from './learningDecayService';
import { logDecision } from './autonomousDecisionLogger';
import { deductCreditsIfValueAwaited } from './creditExecutionService';

export type StrategySnapshot = {
  platforms: string[];
  posting_frequency: Record<string, number>;
  content_mix: Record<string, number>;
  campaign_goal: string;
  primary_platform: string | null;
};

export type StrategyChange = {
  field: string;
  previous: unknown;
  next: unknown;
  reason: string;
};

export type StrategyEvolution = {
  company_id: string;
  previous_snapshot: StrategySnapshot;
  evolved_snapshot: StrategySnapshot;
  changes: StrategyChange[];
  evolution_reason: string;
  confidence: number;
  log_id?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Load the most recent strategy snapshot from campaigns. */
async function loadCurrentStrategy(companyId: string): Promise<StrategySnapshot | null> {
  const { data } = await supabase
    .from('campaigns')
    .select('platforms, posting_frequency, content_mix, campaign_goal')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  const d = data as any;
  return {
    platforms:         d.platforms ?? [],
    posting_frequency: d.posting_frequency ?? {},
    content_mix:       d.content_mix ?? {},
    campaign_goal:     d.campaign_goal ?? '',
    primary_platform:  (d.platforms as string[])?.[0] ?? null,
  };
}

/** Load performance trends — compare last 2 campaigns. */
async function loadPlatformTrends(
  companyId: string
): Promise<Array<{ platform: string; trend: 'growing' | 'declining' | 'stable' }>> {
  const { data: campaigns } = await supabase
    .from('campaigns')
    .select('id')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(2);

  if (!campaigns || campaigns.length < 2) return [];

  const [latest, previous] = await Promise.all([
    rankPlatformsByPerformance((campaigns[0] as { id: string }).id),
    rankPlatformsByPerformance((campaigns[1] as { id: string }).id),
  ]);

  const prevMap: Record<string, number> = {};
  for (const p of previous) prevMap[p.platform] = p.avg_engagement_rate;

  return latest.map(p => {
    const prev = prevMap[p.platform] ?? p.avg_engagement_rate;
    const change = prev > 0 ? (p.avg_engagement_rate - prev) / prev : 0;
    return {
      platform: p.platform,
      trend:    change > 0.1 ? 'growing' : change < -0.1 ? 'declining' : 'stable',
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

export async function evolveStrategy(companyId: string): Promise<StrategyEvolution | null> {
  const current = await loadCurrentStrategy(companyId);
  if (!current) return null;

  const [platformTrends, marketPosition, effectiveLearnings] = await Promise.all([
    loadPlatformTrends(companyId),
    evaluateMarketPosition(companyId),
    getEffectiveLearnings(companyId, { limit: 15 }),
  ]);

  const evolved: StrategySnapshot = {
    platforms:         [...current.platforms],
    posting_frequency: { ...current.posting_frequency },
    content_mix:       { ...current.content_mix },
    campaign_goal:     current.campaign_goal,
    primary_platform:  current.primary_platform,
  };

  const changes: StrategyChange[] = [];

  // ── Platform mix adjustment ───────────────────────────────────────────────
  const decliningPlatforms = platformTrends.filter(t => t.trend === 'declining').map(t => t.platform);
  const growingPlatforms   = platformTrends.filter(t => t.trend === 'growing').map(t => t.platform);

  for (const declining of decliningPlatforms) {
    const currentFreq = evolved.posting_frequency[declining] ?? 0;
    if (currentFreq > 1) {
      const newFreq = Math.max(1, Math.round(currentFreq * 0.7));
      changes.push({
        field:    `posting_frequency.${declining}`,
        previous: currentFreq,
        next:     newFreq,
        reason:   `${declining} engagement declining — reducing frequency`,
      });
      evolved.posting_frequency[declining] = newFreq;
    }
  }

  for (const growing of growingPlatforms) {
    const currentFreq = evolved.posting_frequency[growing] ?? 2;
    const newFreq = Math.round(currentFreq * 1.2);
    if (newFreq !== currentFreq) {
      changes.push({
        field:    `posting_frequency.${growing}`,
        previous: currentFreq,
        next:     newFreq,
        reason:   `${growing} engagement growing — increasing frequency`,
      });
      evolved.posting_frequency[growing] = newFreq;
    }
  }

  // ── Content mix adjustment from whitespace opportunities ─────────────────
  if (marketPosition.whitespace_opportunities.length > 0) {
    const topOpportunity = marketPosition.whitespace_opportunities[0];
    // Map opportunity topic to a content_type if possible
    const topicToContentType: Record<string, string> = {
      'how-to guides':        'carousel',
      'thought leadership':   'post',
      'case studies':         'article',
      'educational content':  'carousel',
      'market trends':        'thread',
      'product demos':        'video',
    };
    const suggestedType = topicToContentType[topOpportunity.topic] ?? 'post';
    const currentPct    = evolved.content_mix[suggestedType] ?? 0;

    if (currentPct < 30) {
      const boost = Math.min(15, 30 - currentPct);
      // Find something to reduce
      const sorted = Object.entries(evolved.content_mix).sort(([, a], [, b]) => b - a);
      const [toReduce] = sorted[0] ?? [];
      if (toReduce && toReduce !== suggestedType) {
        evolved.content_mix[suggestedType] = currentPct + boost;
        evolved.content_mix[toReduce]      = Math.max(0, (evolved.content_mix[toReduce] ?? 0) - boost);
        changes.push({
          field:    'content_mix',
          previous: { [suggestedType]: currentPct, [toReduce]: evolved.content_mix[toReduce] + boost },
          next:     { [suggestedType]: evolved.content_mix[suggestedType], [toReduce]: evolved.content_mix[toReduce] },
          reason:   `Whitespace opportunity: "${topOpportunity.topic}" — increasing ${suggestedType} allocation`,
        });
      }
    }
  }

  // ── Campaign goal evolution ───────────────────────────────────────────────
  const hasStrongLearnings = effectiveLearnings.filter(l => l.effective_score > 0.5 && l.times_reinforced > 2).length;
  if (hasStrongLearnings >= 3 && !evolved.campaign_goal.includes('scale')) {
    const newGoal = 'Scale proven content patterns and expand reach through data-validated formats';
    if (newGoal !== evolved.campaign_goal) {
      changes.push({
        field:    'campaign_goal',
        previous: evolved.campaign_goal,
        next:     newGoal,
        reason:   `${hasStrongLearnings} proven patterns identified — shifting to scaling goal`,
      });
      evolved.campaign_goal = newGoal;
    }
  }

  if (changes.length === 0) {
    return null; // No evolution needed
  }

  const confidence = Math.min(1, (changes.length * 0.2) + (platformTrends.length * 0.1));
  const evolutionReason = changes.map(c => c.reason).join('; ');

  // ── Persist to strategy_evolution_log ─────────────────────────────────────
  let logId: string | undefined;
  try {
    const { data: log } = await supabase.from('strategy_evolution_log').insert({
      company_id:       companyId,
      previous_snapshot: current,
      new_snapshot:      evolved,
      changes:           changes,
      evolution_reason:  evolutionReason,
      confidence,
      created_at:        new Date().toISOString(),
    }).select('id').maybeSingle();
    logId = (log as { id: string } | null)?.id;
  } catch (_) { /* non-blocking */ }

  await logDecision({
    company_id:    companyId,
    decision_type: 'optimize',
    reason:        `Strategy evolved: ${changes.length} adjustments — ${evolutionReason.slice(0, 200)}`,
    metrics_used:  {
      changes_count:        changes.length,
      declining_platforms:  decliningPlatforms,
      growing_platforms:    growingPlatforms,
      whitespace_found:     marketPosition.whitespace_opportunities.length > 0,
    },
    outcome: `Log ID: ${logId}`,
  });

  await deductCreditsIfValueAwaited(companyId, 'strategy_evolution', changes.length > 0, { note: `Strategy evolved: ${changes.length} changes` });

  return {
    company_id:        companyId,
    previous_snapshot: current,
    evolved_snapshot:  evolved,
    changes,
    evolution_reason:  evolutionReason,
    confidence,
    log_id:            logId,
  };
}
