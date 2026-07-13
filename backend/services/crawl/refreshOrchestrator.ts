/**
 * refreshOrchestrator.ts — the refresh gate that ties the policy engine, events,
 * history, versioning, and incremental metadata together (CKRE-002 §2/§3/§5/§6/§7/§9).
 *
 * It is the SINGLE place the refinement path consults to decide whether the AI
 * chain runs. It performs NO AI itself and does not modify any prompt/model —
 * it only orchestrates the EXISTING deterministic pieces. Fail-safe: any error
 * degrades to "let the AI run" (never blocks a legitimate refresh).
 */

import type { ChangeDecision, ChangeVerdict } from './changeDetectionService';
import type { DiscoveredWebsiteMetadata } from '../companyProfile/websiteMetadataExtractor';
import { getRefreshPolicyConfig, type CompanyTier, type PlatformState } from './refreshPolicyConfig';
import { decideRefresh, type RefreshAction } from './refreshPolicyEngine';
import { getKnowledgeState, recordRefresh } from './knowledgeVersionStore';
import { emitRefreshEvent, recordTokenSavings, resolveRefreshCorrelationId, TOKENS_PER_REFRESH_ESTIMATE } from './refreshEventService';
import { refreshDiscoveredMetadata, touchProfileRefreshedAt } from './incrementalMetadataStore';

export interface RefreshGateInput {
  companyId: string | null;
  changeDecision: ChangeDecision | null;
  metadata: DiscoveredWebsiteMetadata | null;
  manualRefresh: boolean;
  workflow: string;
  email?: string | null;
  companyTier?: CompanyTier;
  platformState?: PlatformState;
  adminOverride?: RefreshAction | null;
  now?: number;
}

export interface RefreshGateResult {
  /** True → the caller must SKIP the AI chain and return the existing profile. */
  skipAi: boolean;
  action: RefreshAction;
  verdict: ChangeVerdict | null;
  correlationId: string;
  /** For metadata-only: the profile columns the incremental refresh wrote. */
  metadataFields: string[];
}

/**
 * Evaluate the refresh gate and apply all non-AI side effects (skip / defer /
 * metadata-only). Returns whether the AI chain should run. Never throws.
 */
export async function evaluateRefreshGate(input: RefreshGateInput): Promise<RefreshGateResult> {
  const companyId = input.companyId;
  const verdict = input.changeDecision?.verdict ?? null;
  const workflow = input.workflow;

  // No company context → cannot gate; preserve prior behaviour (run AI), no events.
  if (!companyId) {
    return { skipAi: false, action: 'EXECUTE_REFRESH', verdict, correlationId: 'crawl:unknown', metadataFields: [] };
  }

  const nowMs = input.now ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();

  try {
    const config = getRefreshPolicyConfig();
    const state = await getKnowledgeState(companyId);
    const lastRefreshAt = state.history[0]?.at ?? null;

    const decision = decideRefresh({
      changeDecision: input.changeDecision,
      hasPriorKnowledgeVersion: state.version !== null,
      lastRefreshAt,
      refreshHistoryCount: state.history.length,
      manualRefresh: input.manualRefresh,
      adminOverride: input.adminOverride ?? null,
      companyTier: input.companyTier ?? 'free',
      platformState: input.platformState ?? 'normal',
      pendingRefresh: false,
      tokenBudgetRemaining: null,
      config,
      now: nowMs,
    });

    const correlationId = await resolveRefreshCorrelationId(input.email, companyId);
    const affectedSections = input.changeDecision?.changedSections ?? [];
    const emit = (event: Parameters<typeof emitRefreshEvent>[0]['event'], outcome: 'allowed' | 'denied', reason?: string, metadata?: Record<string, unknown>) =>
      emitRefreshEvent({ event, outcome, correlationId, companyId, workflow, reason: reason ?? decision.reason, metadata });

    await emit('RefreshRequested', 'allowed', decision.reason, { action: decision.action, verdict });

    switch (decision.action) {
      case 'SKIP_REFRESH': {
        await touchProfileRefreshedAt(companyId, nowIso);
        await recordRefresh({
          companyId, createVersion: false, refreshReason: decision.reason, action: decision.action,
          verdict, affectedSections, cacheHit: true, cacheMiss: false, historyLimit: config.historyLimit, now: nowIso,
        });
        recordTokenSavings(TOKENS_PER_REFRESH_ESTIMATE, workflow);
        await emit('RefreshSkipped', 'allowed', 'unchanged', { tokensSaved: TOKENS_PER_REFRESH_ESTIMATE });
        return { skipAi: true, action: decision.action, verdict, correlationId, metadataFields: [] };
      }
      case 'DEFER': {
        await recordRefresh({
          companyId, createVersion: false, refreshReason: decision.reason, action: decision.action,
          verdict, affectedSections, historyLimit: config.historyLimit, now: nowIso,
        });
        await emit('RefreshDeferred', 'denied', decision.reason);
        return { skipAi: true, action: decision.action, verdict, correlationId, metadataFields: [] };
      }
      case 'REFRESH_METADATA_ONLY': {
        const meta = await refreshDiscoveredMetadata(companyId, input.metadata, nowIso);
        await touchProfileRefreshedAt(companyId, nowIso);
        const rec = await recordRefresh({
          companyId, createVersion: true, refreshReason: decision.reason, action: decision.action,
          verdict, affectedSections, historyLimit: config.historyLimit, now: nowIso,
        });
        recordTokenSavings(TOKENS_PER_REFRESH_ESTIMATE, workflow);
        await emit('MetadataRefreshed', 'allowed', 'cosmetic', { fields: meta.fields, tokensSaved: TOKENS_PER_REFRESH_ESTIMATE });
        if (rec.created) await emit('KnowledgeVersionCreated', 'allowed', 'metadata', { version: rec.version });
        return { skipAi: true, action: decision.action, verdict, correlationId, metadataFields: meta.fields };
      }
      default: {
        // AI actions — signal the caller to run the LLM chain; completion is
        // finalized by finalizeAiRefresh once the AI succeeds.
        await emit('RefreshStarted', 'allowed', decision.reason, { action: decision.action });
        return { skipAi: false, action: decision.action, verdict, correlationId, metadataFields: [] };
      }
    }
  } catch {
    // Fail-open: never block a legitimate refresh on an orchestration error.
    return { skipAi: false, action: 'EXECUTE_REFRESH', verdict, correlationId: `company:${companyId}`, metadataFields: [] };
  }
}

export interface FinalizeAiRefreshInput {
  companyId: string | null;
  gate: RefreshGateResult;
  workflow: string;
  executionMs: number;
  affectedSections: string[];
  tokens?: number | null;
  now?: string;
}

/**
 * Finalize a completed AI refresh: create the knowledge version + emit the
 * completion events. Called by the refinement path AFTER the AI save succeeds.
 * Never throws.
 */
export async function finalizeAiRefresh(input: FinalizeAiRefreshInput): Promise<void> {
  const companyId = input.companyId;
  if (!companyId || input.gate.skipAi) return;
  const now = input.now ?? new Date().toISOString();
  try {
    const config = getRefreshPolicyConfig();
    const rec = await recordRefresh({
      companyId,
      createVersion: true,
      refreshReason: input.gate.action,
      action: input.gate.action,
      verdict: input.gate.verdict,
      affectedSections: input.affectedSections,
      executionMs: input.executionMs,
      tokens: input.tokens ?? null,
      cacheMiss: true,
      historyLimit: config.historyLimit,
      now,
    });
    const emit = (event: Parameters<typeof emitRefreshEvent>[0]['event'], reason?: string, metadata?: Record<string, unknown>) =>
      emitRefreshEvent({ event, outcome: 'allowed', correlationId: input.gate.correlationId, companyId, workflow: input.workflow, reason: reason ?? null, metadata });

    if (input.gate.action === 'REFRESH_BUSINESS_ONLY') await emit('BusinessRefreshed', 'business', { version: rec.version });
    await emit('RefreshCompleted', input.gate.action, { version: rec.version, executionMs: input.executionMs });
    if (rec.created) await emit('KnowledgeVersionCreated', 'ai_refresh', { version: rec.version });
  } catch {
    /* fail-safe */
  }
}
