/**
 * authoritativeDailyGenerator — Phase-2 Step-13 (first authoritative daily
 * engine). Mirrors the weekly cutover: LEGACY / SHADOW(default) /
 * AUTHORITATIVE with rollback safety. Never throws.
 *
 * Honest scope: produces structurally + enrichment-aware daily execution
 * cards from the orchestration context — NOT the legacy AI-model daily
 * generation. Default SHADOW ⇒ zero behaviour change (diff only). There is
 * no separate daily persistence entrypoint to cut over independently in
 * this codebase (weekly rows ARE the daily_content_plans rows), so the
 * AUTHORITATIVE daily path is exposed via produce/select APIs + SHADOW
 * diffing rather than splicing a second persistence site.
 */

import { resolveGenerationExecutionContext } from '../generationExecutionContextResolver';
import { resolveCutoverMode } from '../generationCutoverManager';
import { mapContextToDailyPlan, type AuthoritativeDailyPlan } from './dailyGenerationMapper';
import { evaluateDailyFallback } from './dailyGenerationFallback';
import { enrichDailyCards } from './dailyGenerationEnrichment';
import { enrichDailyExecutionParity } from './enrichment';
import { dailyDiagnostics } from './dailyGenerationDiagnostics';
// Step-19: gated, fail-soft trigger into the REAL generation runtime.
import { triggerAiAssetGenerationAsync } from '../../asset-generation';

export async function produceAuthoritativeDaily(
  campaignId: string,
): Promise<{ plan: AuthoritativeDailyPlan | null; generation_mode: string }> {
  const ctx = await resolveGenerationExecutionContext(campaignId, 'authoritativeDailyGenerator').catch(() => null);
  if (!ctx) return { plan: null, generation_mode: 'EMPTY' };
  const plan = mapContextToDailyPlan(ctx);
  const { cards } = enrichDailyCards(plan.cards, ctx);
  // Phase-2 Step-17: AI-asset-ready + creator/visibility parity.
  const parity = enrichDailyExecutionParity(cards, ctx);
  // Phase-2 Step-19: auto-trigger REAL AI-asset generation for AI-creatable
  // activities. Gated by ORCHESTRATION_AI_ASSET_AUTOGEN (default OFF →
  // byte-identical SHADOW behavior). Fire-and-forget: never blocks/throws,
  // queue-guarded, video/manual untouched (runtime skips them internally).
  triggerAiAssetGenerationAsync({
    campaignId,
    reason: 'authoritative_daily_generation',
  });
  return { plan: { ...plan, cards: parity.cards }, generation_mode: ctx.generation_mode };
}

/**
 * SHADOW-default daily diff/validation against a legacy daily count.
 * Returns the authoritative cards only when mode=AUTHORITATIVE and the
 * rollback guard passes; otherwise returns null (caller keeps legacy).
 */
export async function evaluateAuthoritativeDaily(
  campaignId: string,
  legacyCount: number,
): Promise<AuthoritativeDailyPlan | null> {
  const mode = resolveCutoverMode();
  if (mode === 'LEGACY') {
    dailyDiagnostics.diff({ campaign_id: campaignId, mode, note: 'legacy_mode_no_daily_compute' });
    return null;
  }
  try {
    const ctx = await resolveGenerationExecutionContext(campaignId, 'authoritativeDailyGenerator').catch(() => null);
    const base = ctx ? mapContextToDailyPlan(ctx) : null;
    const enr = ctx && base ? enrichDailyCards(base.cards, ctx) : null;
    // Phase-2 Step-17: parity layer — AI-asset-ready, creator/workflow
    // visibility, corrected (non-inflated) blocked/pending counts.
    const parity = ctx && enr ? enrichDailyExecutionParity(enr.cards, ctx) : null;
    const plan = base && parity
      ? { ...base, cards: parity.cards }
      : base && enr ? { ...base, cards: enr.cards } : base;
    const fb = evaluateDailyFallback(ctx, plan, legacyCount);

    dailyDiagnostics.diff({
      campaign_id: campaignId, mode,
      generation_mode: ctx?.generation_mode ?? 'EMPTY',
      legacy_execution_count: legacyCount,
      authoritative_execution_count: plan?.execution_count ?? 0,
      execution_count_diff: legacyCount - (plan?.execution_count ?? 0),
      activity_distribution: plan?.activity_distribution ?? {},
      routing_distribution: plan?.routing_distribution ?? {},
      readiness_distribution: plan?.readiness_distribution ?? {},
      creator_distribution: plan?.creator_distribution ?? {},
      owned_content_usage: plan?.owned_content_usage ?? [],
      enrichment_score: enr?.scores.enrichment_score ?? null,
      // Step-17: corrected (AI-aware) aggregation — AI-creatable not inflated.
      corrected_counts: parity?.corrected_counts ?? null,
      workflow_distribution: parity?.workflow_distribution ?? {},
      should_fallback: fb.should_fallback,
      fallback_reason: fb.reason,
    });
    if (ctx && plan) {
      dailyDiagnostics.route({ campaign_id: campaignId, routing_distribution: plan.routing_distribution });
      dailyDiagnostics.readiness({ campaign_id: campaignId, readiness_distribution: plan.readiness_distribution, readiness_score: ctx.readiness.readiness_score });
      if (Object.keys(plan.creator_distribution).length > 0) {
        dailyDiagnostics.creator({ campaign_id: campaignId, creator_distribution: plan.creator_distribution });
      }
      if (plan.owned_content_usage.length > 0) {
        dailyDiagnostics.ownedContent({ campaign_id: campaignId, owned_content_usage: plan.owned_content_usage });
      }
    }

    if (mode === 'AUTHORITATIVE' && !fb.should_fallback && plan && plan.cards.length > 0) {
      dailyDiagnostics.generated({
        campaign_id: campaignId,
        execution_count: plan.execution_count,
        activity_distribution: plan.activity_distribution,
        routing_distribution: plan.routing_distribution,
        readiness_distribution: plan.readiness_distribution,
        creator_distribution: plan.creator_distribution,
        owned_content_usage: plan.owned_content_usage,
        note: 'authoritative daily cards available as persisted output',
      });
      return plan;
    }
    if (mode === 'AUTHORITATIVE') {
      dailyDiagnostics.rollback({ campaign_id: campaignId, mode, rollback_reason: fb.reason ?? 'unknown' });
    }
    return null;
  } catch (e) {
    dailyDiagnostics.rollback({ campaign_id: campaignId, mode, rollback_reason: `exception:${(e as Error)?.message ?? 'unknown'}` });
    return null;
  }
}

export const authoritativeDailyGenerator = {
  produceAuthoritativeDaily,
  evaluateAuthoritativeDaily,
};
