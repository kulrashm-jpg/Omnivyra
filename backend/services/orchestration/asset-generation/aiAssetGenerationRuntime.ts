/**
 * aiAssetGenerationRuntime — Phase-2 Step-19.
 *
 * Orchestration-aware BRIDGE into the REAL, already-existing creator asset
 * generation runtime (backend/services/creatorAssetGenerationRuntime.ts).
 * That runtime does the actual rendering (execution engine →
 * renderAsset → creator_assets persistence → daily_content_plans.content
 * write). This module does NOT re-implement rendering — it triggers it
 * with orchestration safety, scope discipline, and observability.
 *
 * SCOPE / SAFETY:
 *  - Only Group-A autonomous (image/carousel/banner/infographic/pdf/slider)
 *    is rendered. We invoke the runtime in RENDER_ONLY mode; the runtime
 *    itself already skips video / attachment-required formats internally,
 *    so the VIDEO/manual workflow is preserved EXACTLY (no new branching).
 *  - Auto-trigger is gated by ORCHESTRATION_AI_ASSET_AUTOGEN (default OFF)
 *    so SHADOW safety + rollback continuity are preserved: with the flag
 *    off, behavior is byte-identical to pre-Step-19. Explicit/manual
 *    callers (creator workflow init) pass force:true.
 *  - Never throws. Queue guard isolates failure → campaign keeps prior
 *    state (rollback continuity).
 */

import { withGenerationGuard, type QueueGuardResult } from './aiAssetGenerationQueue';
import {
  mapRuntimeResultToSummary,
  type GenerationRuntimeSummary,
} from './aiAssetGenerationMapper';
import { mapOutcomeToSignals } from './aiAssetGenerationFallback';
import { aiAssetGenerationDiagnostics } from './aiAssetGenerationDiagnostics';
import { orchestrationEvents } from '../events';
import type { AiAssetDegradationSignals } from '../assets/aiAssetFallback';

/**
 * Phase-2 Step-20: CONTROLLED ACTIVATION. Auto-generation is now ON by
 * default for authoritative Group-A autonomous activities (the runtime +
 * isAiCreatableRouting already scope this to image/carousel/banner/
 * infographic/pdf/slider — video/manual are never reached).
 *
 * ROLLBACK PRESERVED: setting ORCHESTRATION_AI_ASSET_AUTOGEN=0 is an
 * explicit kill-switch that fully restores pre-Step-19 behavior (no
 * auto-trigger). Any other value (incl. unset) → enabled.
 */
export function isAiAssetAutogenEnabled(): boolean {
  return String(process.env.ORCHESTRATION_AI_ASSET_AUTOGEN ?? '1') !== '0';
}

export interface TriggerAiAssetGenerationInput {
  campaignId: string;
  companyId?: string | null;
  userId?: string | null;
  /** Why generation was requested (auto-daily / creator-init / manual). */
  reason: string;
  /** Bypass the env gate for explicit user/creator-initiated generation. */
  force?: boolean;
}

export interface TriggerAiAssetGenerationResult {
  triggered: boolean;
  reason: string;
  summary: GenerationRuntimeSummary | null;
  signals: AiAssetDegradationSignals;
  queue: Pick<QueueGuardResult<unknown>, 'deduped' | 'retries' | 'ran'>;
}

/**
 * Trigger REAL AI-asset generation for a campaign's AI-creatable activities.
 * Idempotent within the queue dedupe window. Fail-soft.
 */
export async function triggerAiAssetGeneration(
  input: TriggerAiAssetGenerationInput,
): Promise<TriggerAiAssetGenerationResult> {
  const { campaignId, reason } = input;

  if (!input.force && !isAiAssetAutogenEnabled()) {
    aiAssetGenerationDiagnostics.queue({
      campaign_id: campaignId, queue_state: 'gated_off', reason,
    });
    return {
      triggered: false,
      reason: 'autogen_disabled',
      summary: null,
      signals: {},
      queue: { deduped: false, retries: 0, ran: false },
    };
  }

  aiAssetGenerationDiagnostics.runtimeStart({
    campaign_id: campaignId,
    asset_type: 'group_a_autonomous',
    generation_runtime: 'creatorAssetGenerationRuntime',
    reason,
  });

  const guard = await withGenerationGuard<GenerationRuntimeSummary>(
    campaignId,
    async () => {
      // Dynamic import: keeps the heavy backend runtime out of the
      // orchestration module graph at load time (no cycle, fail-soft).
      const { runCreatorAssetGenerationRuntime } = await import(
        '../../creatorAssetGenerationRuntime'
      );
      try {
        const result = await runCreatorAssetGenerationRuntime({
          campaignId,
          companyId: input.companyId ?? null,
          userId: input.userId ?? null,
          // RENDER_ONLY: render Group-A autonomous; the runtime preserves
          // the video / attachment-required path internally untouched.
          mode: 'RENDER_ONLY',
        });
        const summary = mapRuntimeResultToSummary(result);
        aiAssetGenerationDiagnostics.persist({
          campaign_id: campaignId,
          rendered_count: summary.rendered_count,
          failed_count: summary.failed_count,
          final_status: summary.final_status,
        });
        if (summary.rendered_count > 0) {
          aiAssetGenerationDiagnostics.previewReady({
            campaign_id: campaignId,
            rendered_count: summary.rendered_count,
            preview_available: true,
          });
        }
        return summary;
      } catch (e) {
        return mapRuntimeResultToSummary(null, e);
      }
    },
  );

  const summary =
    guard.result ?? mapRuntimeResultToSummary(null, guard.error ?? 'guard_no_result');
  const signals = mapOutcomeToSignals({
    ok: summary.ok,
    final_status: summary.final_status as never,
    rendered_count: summary.rendered_count,
    failed_count: summary.failed_count,
    error: summary.error,
  });

  if (summary.ok && guard.ran) {
    aiAssetGenerationDiagnostics.runtimeSuccess({
      campaign_id: campaignId,
      rendered_count: summary.rendered_count,
      failed_count: summary.failed_count,
      final_status: summary.final_status,
      preview_available: summary.rendered_count > 0,
      retry_count: guard.retries,
      queue_state: guard.deduped ? 'deduped' : 'ran',
    });
  } else if (!guard.deduped) {
    aiAssetGenerationDiagnostics.runtimeFail({
      campaign_id: campaignId,
      failure_reason: summary.error ?? 'unknown',
      retry_count: guard.retries,
      queue_state: 'failed',
    });
  }

  // Step-23: server-push so cards hydrate the moment generation finishes —
  // no tab focus / reload required. Only on a real (non-deduped) run.
  if (guard.ran && !guard.deduped) {
    if (summary.ok && summary.rendered_count > 0) {
      orchestrationEvents.aiAssetGenerated(campaignId, { assetState: 'AI_GENERATED', fallbackMode: false });
    } else if (!summary.ok || signals.generation_failed) {
      orchestrationEvents.aiAssetFailed(campaignId, { assetState: 'GENERATION_FAILED' });
    }
    orchestrationEvents.orchestrationRefresh(campaignId, { assetState: summary.final_status });
  }

  return {
    triggered: guard.ran && !guard.deduped,
    reason,
    summary,
    signals,
    queue: { deduped: guard.deduped, retries: guard.retries, ran: guard.ran },
  };
}

/**
 * Fire-and-forget convenience for orchestration call sites (authoritative
 * daily generation). Never blocks, never throws, fully gated.
 */
export function triggerAiAssetGenerationAsync(input: TriggerAiAssetGenerationInput): void {
  if (!input.force && !isAiAssetAutogenEnabled()) return;
  void triggerAiAssetGeneration(input).catch(() => {
    /* fail-soft: queue guard already isolated + logged */
  });
}
