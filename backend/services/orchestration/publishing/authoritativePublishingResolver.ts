/**
 * authoritativePublishingResolver — Phase-2 Step-31.
 *
 * THE single entrypoint CMS publishing + the scheduler call to obtain
 * canonical publish authority. Composes ONLY canonical orchestration
 * surfaces (getExecutionItem → projectExecutionState +
 * resolveExecutionRouting + hydrateAiAsset + deriveProvenanceFromContent).
 * Fail-soft: any failure ⇒ null projection so the caller transparently
 * keeps its legacy path (SHADOW/rollback safe). Diff-only by default —
 * NEVER changes scheduler outcome unless cutover is AUTHORITATIVE.
 */

import { getExecutionItem, getExecutionItems } from '../canonicalExecutionAdapter';
import { projectExecutionState } from '../synchronization';
import { resolveExecutionRouting } from '../routing';
import { hydrateAiAsset } from '../assets';
import { deriveProvenanceFromContent, ORCHESTRATION_VERSION } from '../provenance';
import {
  buildPublishingExecutionProjection,
  type PublishingExecutionProjection,
} from './publishingEligibilityProjection';
import {
  resolvePublishingMode,
  deriveLegacyPublishingSnapshot,
  diffPublishing,
  type PublishingDiffResult,
} from './publishingFallbackManager';
import { publishingDiagnostics } from './publishingDiagnostics';

export interface AuthoritativePublishingResult {
  mode: 'AUTHORITATIVE' | 'SHADOW' | 'LEGACY';
  fallback_active: boolean;
  projection: PublishingExecutionProjection | null;
  diff: PublishingDiffResult | null;
}

export async function resolveAuthoritativePublishing(
  campaignId: string,
  executionId: string,
  platform?: string,
): Promise<AuthoritativePublishingResult> {
  const FAILED: AuthoritativePublishingResult = {
    mode: 'LEGACY', fallback_active: true, projection: null, diff: null,
  };
  if (!campaignId || !executionId) return FAILED;
  try {
    const item = await getExecutionItem(campaignId, executionId).catch(() => null);
    if (!item) {
      publishingDiagnostics.fallback({
        campaign_id: campaignId, execution_id: executionId,
        publishing_mode: 'LEGACY', fallback_active: true, reason: 'canonical_item_missing',
      });
      return FAILED;
    }

    const legacyRaw: Record<string, unknown> =
      item.metadata && typeof item.metadata.__legacy_raw === 'object' && item.metadata.__legacy_raw
        ? (item.metadata.__legacy_raw as Record<string, unknown>)
        : {};

    const state = projectExecutionState(item);
    const routing = resolveExecutionRouting({
      platform: platform || item.platform,
      content_type: item.content_type,
      asset_type: String(item.metadata?.asset_type ?? '') || undefined,
      campaign_context: { campaign_id: campaignId, execution_id: executionId },
    });
    const aiAsset = hydrateAiAsset({
      campaignId,
      executionId,
      contentType: item.content_type,
      routing: {
        execution_type: routing.execution_type,
        workflow_type: routing.workflow_type,
        asset_requirement: routing.asset_requirement,
      },
      blob: legacyRaw,
    });
    const { provenance } = deriveProvenanceFromContent(executionId, legacyRaw, {
      reconciledWithBlueprint: Boolean(item.metadata?.reconciled_with_blueprint),
    });

    const orchestrationComplete =
      state.orchestration_state !== 'BLOCKED' && Boolean(provenance);
    const decision = resolvePublishingMode({
      projectionAvailable: true,
      rollbackTriggered: Boolean(provenance?.rollback_triggered),
      orchestrationComplete,
    });

    const projection = buildPublishingExecutionProjection({
      campaignId,
      executionId,
      platform: platform || item.platform || 'linkedin',
      mode: decision.mode,
      orchestrationVersion: ORCHESTRATION_VERSION,
      item,
      routing,
      state,
      aiAsset,
      provenance,
      legacyRaw,
    });

    const legacySnapshot = deriveLegacyPublishingSnapshot(legacyRaw);
    const diff = diffPublishing(projection, legacySnapshot);

    publishingDiagnostics.projection({
      campaign_id: campaignId,
      execution_id: executionId,
      platform: projection.platform,
      publishing_mode: decision.mode,
      readiness_state: projection.readiness_state,
      schedulable: projection.schedulable,
      orchestration_version: ORCHESTRATION_VERSION,
      fallback_active: decision.fallback_active,
    });
    if (projection.blocked) {
      publishingDiagnostics.blocked({
        campaign_id: campaignId, execution_id: executionId, platform: projection.platform,
        blocked_reason: projection.blocking_reasons, publishing_mode: decision.mode,
      });
    }
    publishingDiagnostics.executionDiff({
      campaign_id: campaignId,
      execution_id: executionId,
      platform: projection.platform,
      publishing_mode: decision.mode,
      orchestration_fidelity: diff.orchestration_fidelity,
      mismatches: diff.mismatches,
    });
    if (decision.mode === 'AUTHORITATIVE') {
      publishingDiagnostics.authoritative({
        campaign_id: campaignId, execution_id: executionId, platform: projection.platform,
        publishing_mode: 'AUTHORITATIVE', orchestration_version: ORCHESTRATION_VERSION,
        fallback_active: false,
      });
    }

    return { mode: decision.mode, fallback_active: decision.fallback_active, projection, diff };
  } catch (e) {
    publishingDiagnostics.fallback({
      campaign_id: campaignId,
      execution_id: executionId,
      publishing_mode: 'LEGACY',
      fallback_active: true,
      reason: `exception:${(e as Error)?.message ?? 'unknown'}`,
    });
    return FAILED;
  }
}

/**
 * Campaign-level SHADOW validation. Resolves the authoritative projection
 * for each plan with an execution_id and emits the aggregate
 * [PUBLISHING_SCHEDULER] + [PUBLISHING_EXECUTION_DIFF]. STRICTLY
 * observability — returns a summary and NEVER alters scheduler outcome
 * (the legacy result is passed in only for the diff).
 */
export async function evaluateAuthoritativePublishing(
  campaignId: string,
  legacyEligible: boolean,
): Promise<{
  mode: string;
  schedulable_count: number;
  blocked_count: number;
  waiting_count: number;
  authoritative_eligible: boolean;
  fidelity: boolean;
}> {
  try {
    const items = await getExecutionItems(campaignId).catch(() => []);
    let schedulable = 0;
    let blocked = 0;
    let waiting = 0;
    let mode = 'SHADOW';
    let fidelity = true;
    for (const it of items) {
      const r = await resolveAuthoritativePublishing(campaignId, it.execution_id, it.platform);
      mode = r.mode;
      if (!r.projection) continue;
      if (r.projection.blocked) blocked += 1;
      else if (r.projection.schedulable) schedulable += 1;
      else waiting += 1;
      if (r.diff && !r.diff.orchestration_fidelity) fidelity = false;
    }
    const authoritative_eligible = blocked === 0 && schedulable > 0;
    publishingDiagnostics.scheduler({
      campaign_id: campaignId,
      publishing_mode: mode,
      schedulable_count: schedulable,
      blocked_count: blocked,
      waiting_count: waiting,
      legacy_eligible: legacyEligible,
      authoritative_eligible,
      fidelity_match: authoritative_eligible === legacyEligible && fidelity,
      fallback_active: mode !== 'AUTHORITATIVE',
    });
    return {
      mode,
      schedulable_count: schedulable,
      blocked_count: blocked,
      waiting_count: waiting,
      authoritative_eligible,
      fidelity,
    };
  } catch (e) {
    publishingDiagnostics.fallback({
      campaign_id: campaignId,
      publishing_mode: 'LEGACY',
      fallback_active: true,
      reason: `scheduler_exception:${(e as Error)?.message ?? 'unknown'}`,
    });
    return {
      mode: 'LEGACY',
      schedulable_count: 0,
      blocked_count: 0,
      waiting_count: 0,
      authoritative_eligible: legacyEligible,
      fidelity: true,
    };
  }
}
