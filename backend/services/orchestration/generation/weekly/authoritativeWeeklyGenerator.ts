/**
 * authoritativeWeeklyGenerator — Phase-2 Step-11 (FIRST real generator rewrite).
 *
 * Produces the weekly structure from GenerationExecutionContext ONLY.
 * Controlled activation:
 *   LEGACY        → legacy rows unchanged (no compute).
 *   SHADOW (def.) → authoritative plan computed + diffed; legacy persists.
 *   AUTHORITATIVE → authoritative rows BECOME the persisted output when the
 *                   fallback guard passes; otherwise rollback to legacy.
 * Never throws — any failure rolls back to legacy (execution continuity).
 *
 * Honest scope: this produces the structural weekly plan (slots / platform
 * allocation / routing assignment / readiness + owned-content workflows /
 * deterministic brief). It is NOT the full BOLT-AI enrichment engine; that
 * fidelity gap is the documented trade-off of the authoritative path here.
 */

import { resolveGenerationExecutionContext } from '../generationExecutionContextResolver';
import { resolveCutoverMode } from '../generationCutoverManager';
import { mapContextToWeeklyPlan, type AuthoritativeWeeklyPlan } from './weeklyGenerationMapper';
import { evaluateWeeklyFallback } from './weeklyGenerationFallback';
import { weeklyDiagnostics } from './weeklyGenerationDiagnostics';
import { enrichWeeklyRows } from './enrichment';
import { enrichmentDiagnostics } from './enrichment/weeklyEnrichmentDiagnostics';

export async function produceAuthoritativeWeekly(
  campaignId: string,
): Promise<{ plan: AuthoritativeWeeklyPlan | null; generation_mode: string }> {
  const ctx = await resolveGenerationExecutionContext(campaignId, 'authoritativeWeeklyGenerator').catch(() => null);
  if (!ctx) return { plan: null, generation_mode: 'EMPTY' };
  return { plan: mapContextToWeeklyPlan(ctx), generation_mode: ctx.generation_mode };
}

/**
 * Mode-gated source selector spliced into generate-weekly-structure's
 * persist step. Default SHADOW ⇒ returns `legacyRows` unchanged (zero
 * behaviour change) while still computing + diffing the authoritative plan.
 */
export async function resolveWeeklyRowsForPersistence<T>(
  campaignId: string,
  legacyRows: T[],
): Promise<T[]> {
  const mode = resolveCutoverMode();
  if (mode === 'LEGACY') {
    weeklyDiagnostics.fallback({ campaign_id: campaignId, mode, fallback_reason: 'legacy_mode' });
    return legacyRows;
  }
  try {
    const ctx = await resolveGenerationExecutionContext(campaignId, 'authoritativeWeeklyGenerator').catch(() => null);
    const plan = ctx ? mapContextToWeeklyPlan(ctx) : null;
    const fb = evaluateWeeklyFallback(ctx, plan, legacyRows.length);

    // Phase-2 Step-12: enrichment parity layer (platform / creator /
    // scheduling / creative-guidance / quality metadata).
    const enriched = ctx && plan ? enrichWeeklyRows(plan.rows, ctx) : null;
    const enrichedRows = enriched?.rows ?? plan?.rows ?? [];
    const scores = enriched?.scores ?? null;
    const ENRICHMENT_MIN = 55;
    const enrichmentRegression = Boolean(
      mode === 'AUTHORITATIVE' && scores && (
        scores.enrichment_score < ENRICHMENT_MIN ||
        scores.platform_enrichment_score <= 0 ||
        scores.scheduling_projection_score <= 0
      ),
    );

    weeklyDiagnostics.diff({
      campaign_id: campaignId, mode,
      generation_mode: ctx?.generation_mode ?? 'EMPTY',
      legacy_execution_count: legacyRows.length,
      authoritative_execution_count: plan?.rows.length ?? 0,
      execution_count_diff: legacyRows.length - (plan?.rows.length ?? 0),
      platform_distribution: plan?.platform_distribution ?? {},
      routing_distribution: plan?.routing_distribution ?? {},
      readiness_distribution: plan?.readiness_distribution ?? {},
      owned_content_usage: plan?.owned_content_usage ?? [],
      should_fallback: fb.should_fallback,
      fallback_reason: fb.reason,
    });
    if (scores) {
      enrichmentDiagnostics.diff({
        campaign_id: campaignId, mode,
        enrichment_score: scores.enrichment_score,
        platform_enrichment_score: scores.platform_enrichment_score,
        creator_projection_score: scores.creator_projection_score,
        scheduling_projection_score: scores.scheduling_projection_score,
        owned_content_score: scores.owned_content_score,
        enrichment_min: ENRICHMENT_MIN,
        enrichment_regression: enrichmentRegression,
      });
      enrichmentDiagnostics.enrichment({ campaign_id: campaignId, enrichment_score: scores.enrichment_score });
      enrichmentDiagnostics.platform({ campaign_id: campaignId, platform_enrichment_score: scores.platform_enrichment_score });
      enrichmentDiagnostics.creator({ campaign_id: campaignId, creator_projection_score: scores.creator_projection_score });
      enrichmentDiagnostics.scheduling({ campaign_id: campaignId, scheduling_projection_score: scores.scheduling_projection_score });
    }
    if (ctx) {
      weeklyDiagnostics.route({ campaign_id: campaignId, routing_distribution: plan?.routing_distribution ?? {} });
      weeklyDiagnostics.readiness({ campaign_id: campaignId, readiness_score: ctx.readiness.readiness_score, readiness_distribution: plan?.readiness_distribution ?? {} });
      if ((plan?.owned_content_usage.length ?? 0) > 0) {
        weeklyDiagnostics.ownedContent({ campaign_id: campaignId, owned_content_usage: plan!.owned_content_usage });
      }
    }

    if (mode === 'AUTHORITATIVE' && !fb.should_fallback && !enrichmentRegression && enrichedRows.length > 0) {
      weeklyDiagnostics.generated({
        campaign_id: campaignId,
        generation_mode: ctx?.generation_mode ?? 'EMPTY',
        platform_distribution: plan!.platform_distribution,
        execution_count: enrichedRows.length,
        routing_distribution: plan!.routing_distribution,
        readiness_distribution: plan!.readiness_distribution,
        owned_content_usage: plan!.owned_content_usage,
        enrichment_score: scores?.enrichment_score ?? null,
        note: 'authoritative ENRICHED weekly rows are the persisted output',
      });
      return enrichedRows as unknown as T[];
    }

    // SHADOW (default) or AUTHORITATIVE-with-rollback → legacy persists.
    if (mode === 'AUTHORITATIVE') {
      const reason = enrichmentRegression
        ? `enrichment_regression(score=${scores?.enrichment_score})`
        : (fb.reason ?? 'unknown');
      if (enrichmentRegression) {
        enrichmentDiagnostics.rollback({ campaign_id: campaignId, mode, rollback_reason: reason, scores });
      }
      weeklyDiagnostics.rollback({ campaign_id: campaignId, mode, rollback_trigger: reason });
    }
    weeklyDiagnostics.fallback({
      campaign_id: campaignId, mode,
      fallback_reason: mode === 'SHADOW' ? 'shadow_mode_non_binding' : 'rollback',
    });
    return legacyRows;
  } catch (e) {
    weeklyDiagnostics.fallback({ campaign_id: campaignId, mode, fallback_reason: `exception:${(e as Error)?.message ?? 'unknown'}` });
    return legacyRows;
  }
}

export const authoritativeWeeklyGenerator = {
  produceAuthoritativeWeekly,
  resolveWeeklyRowsForPersistence,
};
