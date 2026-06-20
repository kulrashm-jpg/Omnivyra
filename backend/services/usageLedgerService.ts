import { ownedDbTable } from '../db/writeOwner';
import { config } from '@/config';
/**
 * Usage Ledger Service — append-only financial telemetry.
 * Logs LLM usage, external API usage, automation execution.
 * Never throws. Never blocks. Never updates existing rows.
 *
 * Pricing is resolved via pricingService (DB-backed, cached). The legacy
 * hardcoded maps were removed in the Phase 4 pricing-engine refactor.
 */

import { supabase } from '../db/supabaseClient';
import {
  resolveLlmCost as _resolveLlmCostFromConfig,
  resolveEmbeddingCost as _resolveEmbeddingCostFromConfig,
  recordCostAnomaly,
  PricingMissingError,
  type ResolvedEmbeddingCost,
  type ResolvedLlmCost,
} from './pricingService';
import { recordUnifiedTransaction } from './unifiedTransactionService';
import { logger } from './logger';
import { ledgerLinkColumnEnabled } from './billing/ledgerLinkColumnFlag';
import {
  getProcessTypeToActionKeyMap,
  isKnownPricingKey,
  resolveActionKeyFromProcessType,
  resolveMonetizationFeature,
} from '../../shared/monetization/featureRegistry';

// Guardrail: any single request whose api_cost exceeds this threshold logs a
// cost_anomalies row. Threshold is conservative — a well-behaved LLM call is
// sub-cent; $1.00+ signals runaway context or bad retries.
const REQUEST_COST_ANOMALY_THRESHOLD_USD = config.COST_REQUEST_THRESHOLD_USD;

/**
 * Calculate estimated AI cost in USD from token counts and model.
 * Back-compat shim over the DB-backed pricing service.
 */
export async function calculateAiCost(
  tokensInput: number,
  tokensOutput: number,
  modelName: string,
  processType: string,
  orgId = '00000000-0000-0000-0000-000000000000',
): Promise<number> {
  const actionKey = resolveActionKey(processType);
  if (!actionKey) {
    throw new Error(
      `[usageLedger.calculateAiCost] processType="${processType}" has no action_key mapping — ` +
      'add it to shared/monetization/featureRegistry.ts.',
    );
  }
  const result = await _resolveLlmCostFromConfig({
    provider: 'openai',
    model: modelName,
    inputTokens: tokensInput,
    outputTokens: tokensOutput,
    actionKey,
    orgId,
  });
  return result.total_cost_usd ?? 0;
}

/**
 * Safe back-compat wrapper. pricingService.resolveLlmCost throws
 * PricingMissingError in strict mode; this shim catches that and returns the
 * null-cost CostResolution so the existing usage log path keeps working
 * (usageLedgerService emits its own critical 'pricing_missing' anomaly on
 * null-cost LLM rows). Pre-flight blocking via assertModelPricingExists is
 * the primary enforcement point.
 *
 * processType is REQUIRED — the shim resolves it to action_key internally so
 * callers can't silently skip the cost_multiplier margin knob.
 */
export async function resolveLlmCost(params: {
  providerName: string;
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  processType: string;
  organizationId: string;
  timestamp?: string | Date;
}): Promise<ResolvedLlmCost> {
  const actionKey = resolveActionKey(params.processType);
  if (!actionKey) {
    throw new Error(
      `[usageLedger.resolveLlmCost] processType="${params.processType}" has no action_key mapping — ` +
      'add it to shared/monetization/featureRegistry.ts.',
    );
  }
  try {
    return await _resolveLlmCostFromConfig({
      provider: params.providerName,
      model: params.modelName,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      actionKey,
      orgId: params.organizationId,
      timestamp: params.timestamp,
    });
  } catch (err) {
    if (err instanceof PricingMissingError) {
      void recordCostAnomaly({
        organizationId: params.organizationId,
        type: 'pricing_missing',
        severity: 'critical',
        processType: params.processType,
        actionKey,
        modelName: params.modelName,
        metadata: {
          provider: params.providerName,
          input_tokens: params.inputTokens,
          output_tokens: params.outputTokens,
        },
      });
    }
    throw err;
  }
}

/** Safe back-compat wrapper — same rationale as resolveLlmCost. */
export async function resolveEmbeddingCost(params: {
  providerName: string;
  modelName: string;
  totalTokens: number;
  processType: string;
  organizationId: string;
  timestamp?: string | Date;
}): Promise<ResolvedEmbeddingCost> {
  const actionKey = resolveActionKey(params.processType);
  if (!actionKey) {
    throw new Error(
      `[usageLedger.resolveEmbeddingCost] processType="${params.processType}" has no action_key mapping.`,
    );
  }
  try {
    return await _resolveEmbeddingCostFromConfig({
      provider: params.providerName,
      model: params.modelName,
      totalTokens: params.totalTokens,
      actionKey,
      orgId: params.organizationId,
      timestamp: params.timestamp,
    });
  } catch (err) {
    if (err instanceof PricingMissingError) {
      void recordCostAnomaly({
        organizationId: params.organizationId,
        type: 'pricing_missing',
        severity: 'critical',
        processType: params.processType,
        actionKey,
        modelName: params.modelName,
        metadata: {
          provider: params.providerName,
          total_tokens: params.totalTokens,
        },
      });
    }
    throw err;
  }
}

export async function logUsageEvent(params: {
  organization_id: string;
  campaign_id?: string | null;
  user_id?: string | null;

  // 'llm'                — generative completion charged per token (user or system)
  // 'embedding'          — embedding API charged per token (typically system-run)
  // 'cache'              — cached completion returned; cost avoided (input/output_tokens=0)
  // 'external_api'       — metered third-party API (e.g. GA4, platform adapters)
  // 'automation_execution' — platform-internal automation hook
  // 'system'             — any variable-cost background work with no user-bill
  // 'internal'           — internal CreditAction execution with no external call (api_cost=0)
  source_type:
    | 'llm'
    | 'embedding'
    | 'cache'
    | 'external_api'
    | 'automation_execution'
    | 'system'
    | 'internal';

  provider_name?: string | null;
  model_name?: string | null;
  provider?: string | null;
  model?: string | null;
  model_version?: string | null;

  source_name: string;
  process_type: string;
  /** User-facing product area (e.g. 'Daily Plan', 'Recommendations'). Derived in aiGateway. */
  feature_area?: string | null;

  input_tokens?: number | null;
  output_tokens?: number | null;
  total_tokens?: number | null;

  latency_ms?: number | null;
  error_flag?: boolean;
  error_type?: string | null;

  unit_cost?: number | null;
  total_cost?: number | null;
  total_cost_usd?: number | null;
  input_cost_usd?: number | null;
  output_cost_usd?: number | null;
  final_price_usd?: number | null;

  pricing_snapshot?: any;
  metadata?: any;

  /**
   * 1-based attempt number within a retry loop. 1 for single-shot calls;
   * 2/3 for same-provider retries and fallbacks. Stored in metadata.retry_attempt
   * since the table has no dedicated column. The final attempt (success or
   * terminal error) is the one that reflects in credit_usage_log; earlier
   * attempts are separate rows and never overwritten.
   */
  retry_attempt?: number;
  /** Marks the row as the last attempt in a retry sequence. Stored in metadata.final_attempt. */
  final_attempt?: boolean;

  // ── Unified-ledger fields (Phase 5) ─────────────────────────────────────
  // These are first-class on unified_transactions; on usage_events they land
  // in metadata so the legacy table shape doesn't break.
  credits_charged?: number | null;
  reference_type?:  string | null;
  reference_id?:    string | null;
  beta_cohort?: string | null;
  monetization_beta_enabled?: boolean;

  /**
   * Phase 2 Task 6 — deterministic ledger lineage anchor: the originating
   * HOLD transaction id. Set ONLY by the credit-execution path. From this id,
   * credit_transactions.parent_transaction_id yields CONFIRM/RELEASE/partial-
   * confirm settlement deterministically (no timestamp/fuzzy joins). Travels
   * in metadata under the reserved key today; the indexed first-class column
   * (migration 20260667) is the post-apply upgrade.
   */
  ledger_hold_transaction_id?: string | null;
}): Promise<void> {
  try {
    const attemptMeta =
      params.retry_attempt != null || params.final_attempt != null
        ? {
            ...(params.retry_attempt != null ? { retry_attempt: params.retry_attempt } : {}),
            ...(params.final_attempt != null ? { final_attempt: params.final_attempt } : {}),
          }
        : {};
    // Phase 2 Task 6: reserved, explicit, deterministic ledger-lineage key.
    // Always folded in when the credit path supplies it so reconciliation
    // never relies on timestamp/fuzzy joins. (Indexed column 20260667 is the
    // post-apply upgrade; this metadata key is the pre-apply-safe mechanism.)
    const linkMeta = params.ledger_hold_transaction_id
      ? { ledger_hold_transaction_id: params.ledger_hold_transaction_id }
      : {};
    const mergedMetadata =
      Object.keys(attemptMeta).length > 0 || Object.keys(linkMeta).length > 0
        ? { ...(params.metadata ?? {}), ...attemptMeta, ...linkMeta }
        : params.metadata ?? null;

    warnIfUnknownProcessType(params.process_type);

    // Resolve the canonical billing code once; persist as a first-class column
    // (Phase 4 migration added usage_events.action_key). Unknown process_types
    // surface as a critical cost_anomalies row.
    const actionKey = resolveActionKey(params.process_type);

    // Phase 7: hard-mode action_key enforcement. If action_key is unresolved
    // AND this isn't an 'internal' loopback row, refuse BOTH writes and
    // emit a critical anomaly. The thrown-unhandled-rejection risk on `void`
    // callers makes it unsafe to actually `throw` here — the refusal is
    // expressed as: no usage_events row, no unified_transactions row, one
    // anomaly row + error log.
    if (!actionKey && params.source_type !== 'internal') {
      logger.error('usage_ledger_rejected_unknown_action_key', {
        process_type:  params.process_type,
        source_type:   params.source_type,
        model_name:    params.model_name ?? null,
        organization_id: params.organization_id,
      });
      void recordCostAnomaly({
        organizationId: params.organization_id,
        type:           'unknown_action_key',
        severity:       'critical',
        processType:    params.process_type,
        modelName:      params.model_name ?? null,
        metadata: {
          source_type: params.source_type,
          reason:      'hard_mode_rejection',
        },
      });
      return;   // ← refusal
    }

    // Soft case: internal rows without action_key are allowed (loopback path).
    if (!actionKey && params.process_type) {
      void recordCostAnomaly({
        organizationId: params.organization_id,
        type:           'unknown_action_key',
        severity:       'warn',
        processType:    params.process_type,
        modelName:      params.model_name ?? null,
      });
    }

    const canonicalTotalCost = params.total_cost_usd ?? params.total_cost ?? null;

    // Phase 7 final: refuse any non-exempt write with null api_cost_usd.
    // Exempt: 'internal' and 'cache' (by design have cost=0 or null).
    // Also exempt: error rows (we couldn't get a cost because the call failed).
    // Everything else — 'llm', 'embedding', 'system', 'external_api',
    // 'automation_execution' — MUST carry a cost. Refuse + critical anomaly.
    const costExemptSources = new Set(['internal', 'cache']);
    const hasCost = canonicalTotalCost != null && Number.isFinite(canonicalTotalCost);
    if (
      !hasCost
      && !costExemptSources.has(params.source_type)
      && params.error_flag !== true
    ) {
      logger.error('usage_ledger_rejected_missing_cost', {
        process_type:  params.process_type,
        source_type:   params.source_type,
        model_name:    params.model_name ?? null,
        organization_id: params.organization_id,
      });
      void recordCostAnomaly({
        organizationId: params.organization_id,
        type:           'pricing_missing',
        severity:       'critical',
        processType:    params.process_type,
        actionKey,
        modelName:      params.model_name ?? null,
        metadata: {
          source_type: params.source_type,
          reason:      'hard_mode_missing_cost',
          input_tokens:  params.input_tokens,
          output_tokens: params.output_tokens,
        },
      });
      return;   // ← refusal
    }

    // Phase 4 guardrail: flag requests whose measured cost exceeds the
    // per-request anomaly threshold. Doesn't block — writes a cost_anomalies
    // row so ops can triage.
    if (
      canonicalTotalCost != null &&
      Number.isFinite(canonicalTotalCost) &&
      canonicalTotalCost > REQUEST_COST_ANOMALY_THRESHOLD_USD
    ) {
      void recordCostAnomaly({
        organizationId: params.organization_id,
        type:           'cost_exceeds_request_threshold',
        severity:       'warn',
        apiCostUsd:     canonicalTotalCost,
        processType:    params.process_type,
        actionKey,
        modelName:      params.model_name ?? null,
        metadata:       {
          threshold_usd: REQUEST_COST_ANOMALY_THRESHOLD_USD,
          input_tokens:  params.input_tokens,
          output_tokens: params.output_tokens,
        },
      });

      // Phase 7: reactive enforcement. We can't block the call that already
      // completed, but we can flag the org so its NEXT high-cost action is
      // pre-flight-rejected. Dynamic import avoids circular dependency.
      void import('./orgControlService').then(({ autoFlagHighRisk }) =>
        autoFlagHighRisk(
          params.organization_id,
          `Single request exceeded $${REQUEST_COST_ANOMALY_THRESHOLD_USD} (action=${params.process_type})`,
        ),
      );
    }

    // Phase 4 guardrail: pricing_missing surfaces when an LLM/embedding call
    // came in but pricing couldn't be resolved (new model, deactivated row).
    // The row is still written with null cost so we have token counts.
    if (
      (params.source_type === 'llm' || params.source_type === 'embedding') &&
      canonicalTotalCost == null &&
      (params.input_tokens || params.output_tokens || params.total_tokens) &&
      !params.error_flag
    ) {
      void recordCostAnomaly({
        organizationId: params.organization_id,
        type:           'pricing_missing',
        severity:       'critical',
        processType:    params.process_type,
        actionKey,
        modelName:      params.model_name ?? null,
        metadata:       {
          input_tokens:  params.input_tokens,
          output_tokens: params.output_tokens,
          total_tokens:  params.total_tokens,
        },
      });
    }

    const betaTag = params.beta_cohort != null || params.monetization_beta_enabled != null
      ? {
          beta_cohort: params.beta_cohort ?? null,
          monetization_beta_enabled: params.monetization_beta_enabled === true,
        }
      : await import('./monetizationBetaAccessService')
        .then(({ getOrganizationBetaTag }) => getOrganizationBetaTag(params.organization_id))
        .then((tag) => ({
          beta_cohort: tag.beta_cohort,
          monetization_beta_enabled: tag.monetization_beta_enabled,
        }))
        .catch(() => ({ beta_cohort: null, monetization_beta_enabled: false }));

    // ── Schema-drift repair (Phase 2 telemetry recovery) ─────────────────────
    // The production `usage_events` table does NOT have the legacy `provider` /
    // `model` columns (only `provider_name` / `model_name`) nor `feature_area`.
    // Writing them made EVERY insert throw `column ... does not exist`, caught
    // silently by the catch below — which is why usage_events stopped receiving
    // rows on 2026-03-14 (the deploy that added them) while unified_transactions
    // kept flowing via its own first-class columns. We now write ONLY columns
    // that exist; provider/model values fall back into provider_name/model_name,
    // and feature_area is preserved inside `metadata`. No billing/behavior change.
    await ownedDbTable('usage_events').insert({
      organization_id: params.organization_id,
      campaign_id: params.campaign_id ?? null,
      user_id: params.user_id ?? null,
      source_type: params.source_type,
      provider_name: params.provider_name ?? params.provider ?? null,
      model_name: params.model_name ?? params.model ?? null,
      model_version: params.model_version ?? null,
      source_name: params.source_name,
      process_type: params.process_type,
      action_key: actionKey,
      input_tokens: params.input_tokens ?? null,
      output_tokens: params.output_tokens ?? null,
      total_tokens: params.total_tokens ?? null,
      latency_ms: params.latency_ms ?? null,
      error_flag: params.error_flag === true,
      error_type: params.error_type ?? null,
      unit_cost: params.unit_cost ?? null,
      total_cost: canonicalTotalCost,
      total_cost_usd: canonicalTotalCost,
      input_cost_usd: params.input_cost_usd ?? null,
      output_cost_usd: params.output_cost_usd ?? null,
      final_price_usd: params.final_price_usd ?? null,
      pricing_snapshot: params.pricing_snapshot ?? null,
      beta_cohort: betaTag.beta_cohort,
      monetization_beta_enabled: betaTag.monetization_beta_enabled,
      // Phase 3 Task 2: first-class linkage column, controlled-activation
      // gated. OFF (default) → key absent → safe on unmigrated envs. The
      // reserved metadata.ledger_hold_transaction_id key (mergedMetadata)
      // always carries the same anchor regardless of this flag.
      ...(ledgerLinkColumnEnabled() && params.ledger_hold_transaction_id
        ? { ledger_hold_transaction_id: params.ledger_hold_transaction_id }
        : {}),
      // feature_area preserved here (its dedicated column doesn't exist in prod).
      metadata: { ...(mergedMetadata ?? {}), feature_area: params.feature_area ?? null },
    });

    // ── Phase 5: dual-write to unified_transactions ───────────────────────
    // Analytics and reporting read only from this table going forward.
    // recordUnifiedTransaction never throws; CHECK violations turn into
    // cost_anomalies rows so we don't break the caller's flow.
    void recordUnifiedTransaction({
      organization_id:  params.organization_id,
      user_id:          params.user_id ?? null,
      action_key:       actionKey,
      source_type:      params.source_type,
      provider_name:    params.provider_name ?? null,
      model_name:       params.model_name ?? null,
      input_tokens:     params.input_tokens ?? null,
      output_tokens:    params.output_tokens ?? null,
      total_tokens:     params.total_tokens ?? null,
      api_cost_usd:     canonicalTotalCost,
      input_cost_usd:   params.input_cost_usd  ?? null,
      output_cost_usd:  params.output_cost_usd ?? null,
      final_price_usd:  params.final_price_usd ?? null,
      credits_charged:  params.credits_charged ?? null,
      retry_attempt:    params.retry_attempt,
      final_attempt:    params.final_attempt,
      error_flag:       params.error_flag === true,
      error_type:       params.error_type ?? null,
      reference_type:   params.reference_type ?? null,
      reference_id:     params.reference_id ?? null,
      ledger_hold_transaction_id: params.ledger_hold_transaction_id ?? null,
      pricing_snapshot: params.pricing_snapshot ?? null,
      metadata: {
        ...(params.metadata ?? {}),
        process_type:    params.process_type,
        feature_area:    params.feature_area ?? null,
        latency_ms:      params.latency_ms ?? null,
        campaign_id:     params.campaign_id ?? null,
        unit_cost:       params.unit_cost ?? null,
        final_price_usd: params.final_price_usd ?? null,
        // Phase 2 Task 6 — same deterministic ledger-lineage anchor.
        ledger_hold_transaction_id: params.ledger_hold_transaction_id ?? null,
      },
    });
  } catch (error: any) {
    console.error('[usageLedger] insert failed', error?.message ?? error);
  }
}

// ── process_type → action_key mapping (compatibility layer) ───────────────
//
// process_type values are operation-level labels (e.g. 'generateCampaignPlan')
// set by the gateway caller. CreditAction values are billing codes. They
// diverged historically. This mapping reconciles known process_types to
// their CreditAction equivalents; unknown values log a one-time warning.
// Nothing is rejected — the goal is visibility, not enforcement (yet).

const LEGACY_PROCESS_TYPE_TO_ACTION_KEY: Record<string, string> = {
  // LLM completions (chat)
  generateCampaignPlan:            'campaign_generation',
  generateContentBlueprint:        'content_basic',
  generateContentForDay:           'content_basic',
  regenerateContent:               'content_basic',
  generateMasterContent:           'content_generation',
  generatePlatformVariants:        'content_rewrite',
  contentSuggestions:              'content_rewrite',
  generateContentIdeas:            'insight_generation',
  generateDailyPlan:               'content_basic',
  generateDailyDistributionPlan:   'content_basic',
  generateCampaignRecommendations: 'campaign_optimization',
  generateAdditionalStrategicThemes: 'strategy_evolution',
  generateRecommendation:          'insight_generation',
  optimizeWeek:                    'campaign_optimization',
  previewStrategy:                 'full_strategy',
  prePlanningExplanation:          'insight_generation',
  suggestDuration:                 'insight_generation',
  refineCampaignIdea:              'content_rewrite',
  parsePlanToWeeks:                'campaign_generation',
  parseRefinedDay:                 'content_basic',
  parsePlatformCustomization:      'content_rewrite',
  creator_execution_blueprint_image: 'content_basic',
  creator_execution_blueprint_carousel: 'content_basic',
  creator_execution_blueprint_video: 'content_basic',
  creator_marketing_packaging:     'content_rewrite',
  chatModeration:                  'ai_reply',
  extractPlannerCommands:          'ai_reply',
  plannerSuggestUpdate:            'ai_reply',
  engagement_reply_suggestions:    'ai_reply',
  conversationTriage:              'ai_reply',
  conversationMemorySummary:       'ai_reply',
  responseGeneration:              'ai_reply',
  runDiagnosticPrompt:             'ai_reply',
  blogRepurpose:                   'content_rewrite',
  blogAnalyticsInsight:            'blogAnalyticsInsight',
  blogGeneration:                  'content_basic',
  blogOptimization:                'content_rewrite',
  blockEnrich:                     'content_basic',
  profileEnrichment:               'profile_enrichment',
  profileExtraction:               'profile_extraction',
  refineProblemTransformation:     'content_rewrite',
  // Non-gateway LLM
  sentiment_classification:        'ai_reply',
  reply_generation:                'reply_generation',
  community_execution:             'auto_post',
  // External + embeddings
  external_api_request:            'external_api',
  embedding_generation:            'embedding',
};

const _warnedUnknownProcessTypes = new Set<string>();

function warnIfUnknownProcessType(processType: string): void {
  if (!processType) return;
  if (resolveActionKey(processType)) return;
  if (_warnedUnknownProcessTypes.has(processType)) return;
  _warnedUnknownProcessTypes.add(processType);
  console.warn(
    `[usageLedger] unknown process_type='${processType}' — not mapped to a CreditAction. ` +
    `Add it to shared/monetization/featureRegistry.ts.`,
  );
}

/**
 * Resolve a usage_events.process_type to its CreditAction billing code.
 * Returns null for unknown process_types. Callers should treat null as
 * "no billing mapping yet" rather than blocking the request.
 */
export function resolveActionKey(processType: string): string | null {
  const canonicalActionKey =
    resolveActionKeyFromProcessType(processType) ??
    (isKnownPricingKey(processType) ? processType : null);

  if (canonicalActionKey) return canonicalActionKey;

  const legacyActionKey = LEGACY_PROCESS_TYPE_TO_ACTION_KEY[processType] ?? null;
  if (legacyActionKey) {
    logger.warn('monetization_registry_legacy_process_mapping_used', {
      process_type: processType,
      legacy_action_key: legacyActionKey,
      canonical_feature_key: resolveMonetizationFeature({ action_key: legacyActionKey })?.feature_key ?? null,
    });
  }
  return legacyActionKey;
}

export const PROCESS_TYPE_TO_ACTION_KEY: Record<string, string> = getProcessTypeToActionKeyMap();
