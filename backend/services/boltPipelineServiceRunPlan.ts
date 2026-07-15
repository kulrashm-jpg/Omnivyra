/** BOLT pipeline — ai/plan stage runners — split from boltPipelineServiceRun.ts (barrel preserved; importers unchanged). */
/** TEMP — split from boltPipelineService.ts (barrel preserved; importers unchanged). */
import { WORKER_PROVENANCE } from '../../observability/runtime/workerProvenance';
import { ownedDbTable } from '../db/writeOwner';
import { trackEvent } from './telemetry/telemetryDispatcher';
/**
 * BOLT Pipeline Service
 *
 * Orchestrates the BOLT async execution pipeline stages.
 * Each stage updates bolt_execution_runs and logs to bolt_execution_events.
 * Supports idempotent stage execution, campaign state guards, retry, and timeouts.
 */

import { supabase } from '../db/supabaseClient';

import { getProfile } from './companyProfileService';
import { runCampaignAiPlan } from './campaignAiOrchestrator';
import { saveStructuredCampaignPlan, commitDraftBlueprint } from '../db/campaignPlanStore';
import { fromStructuredPlan } from './campaignBlueprintAdapter';
import { scheduleStructuredPlan } from './structuredPlanScheduler';
import { retryWithBackoff } from '../utils/retryWithBackoff';
// W3-3 (F-09): single retry authority for the plan draft, flag-gated.
import { retryWithBudget, createOperationBudget, classifyForRetry } from '../../lib/platform/retryBudget';
import { defineRolloutFlag, resolveRolloutSync } from '../../lib/platform/rollout';

const RETRY_BUDGET_PLANNER_FLAG = defineRolloutFlag({
  key: 'retry-budget-planner',
  description: 'W3-3: budgeted single-authority retry for the planner draft (audit B-09)',
});

// ── W3-8 (audit B-37): short-TTL planner intelligence-context cache ──────────
// Tenant-scoped via the F-05 SDK (requireTenant — no company id, no cache);
// caches ONLY the deterministic resolver output, never generated AI content.
// In-process store (the planner runs on the long-lived worker); TTL 120 s via
// env PLANNER_CONTEXT_CACHE_TTL_MS. Kill: CACHE_KILL_OMNIVYRA_PLANNER_CTX or
// the rollout flag. Flag off (default) = resolve on every run.
import { registerCacheNamespace, buildCacheKey, isCacheNamespaceEnabled, noteCacheHit, noteCacheMiss } from '../../lib/platform/cacheCore';

const PLANNER_CONTEXT_CACHE_FLAG = defineRolloutFlag({
  key: 'planner-context-cache',
  description: 'W3-8: short-TTL reuse of the deterministic planning intelligence context',
});
const PLANNER_CTX_NS = registerCacheNamespace({
  prefix: 'omnivyra:planner_ctx',
  description: 'W3-8 planner intelligence context (deterministic, tenant-scoped)',
  version: 1,
  defaultTtlSeconds: 120,
  requireTenant: true,
});
const _plannerCtxStore = new Map<string, { value: unknown; expiresAt: number }>();

async function resolvePlanningIntelligenceCached(companyId: string): Promise<Awaited<ReturnType<typeof resolveIntelligenceContext>>> {
  const ttlMs = Math.max(10_000, Number(process.env.PLANNER_CONTEXT_CACHE_TTL_MS) || PLANNER_CTX_NS.defaultTtlSeconds * 1_000);
  const enabled = resolveRolloutSync(PLANNER_CONTEXT_CACHE_FLAG).mode !== 'off' && isCacheNamespaceEnabled(PLANNER_CTX_NS);
  const key = enabled ? buildCacheKey(PLANNER_CTX_NS, { tenantId: companyId, parts: ['intel'] }) : null;
  if (key) {
    const hit = _plannerCtxStore.get(key);
    if (hit && hit.expiresAt > Date.now()) {
      noteCacheHit(PLANNER_CTX_NS);
      return hit.value as Awaited<ReturnType<typeof resolveIntelligenceContext>>;
    }
    noteCacheMiss(PLANNER_CTX_NS);
  }
  const value = await resolveIntelligenceContext({ companyId });
  if (key) {
    _plannerCtxStore.set(key, { value, expiresAt: Date.now() + ttlMs });
    if (_plannerCtxStore.size > 500) {
      const oldest = _plannerCtxStore.keys().next().value as string;
      _plannerCtxStore.delete(oldest);
    }
  }
  return value;
}
import { getUserFriendlyMessage } from '../utils/userFriendlyErrors';
import { getConnectedPlatformsForCompany, CONTENT_PLATFORM_AFFINITY } from '../utils/platformEligibility';
import { sanitizeBoltPlanForTextOnly } from '../utils/boltTextContentConfig';
import { sanitizeBoltPlanForCombined } from '../../lib/shared/bolt/sanitizeBoltPlanForCombined';
import { filterConnectedPlatformsForContent } from '../../lib/shared/social/platformContentFilter';
import { aggregateBoltAiMetrics } from './boltMetricsAggregator';
import { getBlueprintCacheMetrics } from './contentBlueprintCache';
import { getAdaptiveDistributionAdjustments } from './campaignAdaptiveOptimizer';
import {
  determinePostsPerWeek,
  momentumScoreToLevel,
  pressureConfigToLevel,
} from './postDensityEngine';
import { generateWeeklyStructure } from './generateWeeklyStructureService';
import {
  getStoredStrategicThemeTitle,
  normalizeStoredStrategicTheme,
} from '../../lib/recommendationStrategicCard';
import {
  getExecutionProfile,
  isLegacyMediaProfile,
  withBoltMetadata,
} from '../../variants/bolt/boltCampaignMetadata';
import {
  getCreatorFormatsFromExecutionConfig,
  getUnsupportedCreatorFormats,
  getCreatorCampaignAggregate,
  isAutonomousRenderableFormat,
  isAttachmentRequiredFormat,
  validateCreatorScheduleRequest,
  type CreatorCampaignAggregate,
} from '../../lib/shared/creatorGovernanceRegistry';
import {
  runCreatorAssetGenerationRuntime,
  type CreatorAssetGenerationMode,
  type CreatorAssetGenerationResult,
} from './creatorAssetGenerationRuntime';
import {
  persistPipelineFailure,
  deriveBoltCampaignType,
  type BoltPipelineMode,
  type BoltCampaignType,
} from './boltPipelineFailurePersistence';
import { captureStrategySnapshot } from '../../lib/shared/bolt/captureStrategySnapshot';
import { assertValidBoltBlueprint } from '../../lib/shared/bolt/validateBoltBlueprint';
import { BoltError, BOLT_ERROR_CODES } from '../../lib/shared/bolt/boltErrorCodes';
import { FORMAT_EXCLUSIVE_PLATFORMS } from '../../lib/shared/bolt/formatPlatformBinding';
// Phase 6G-1 — canonical content↔platform assignment authority (derive, don't duplicate).
import { filterPlatformsForFormat, getSupportedPlatformsForFormat } from '../../lib/shared/bolt/contentPlatformAssignment';
// CAMPAIGN-IMPL-003A: plan-request trims contribute to the same planner
// diagnostics model (invalid pairs / no-eligible-platform dropped before planning).
import { emitPlannerDrop } from './campaign/plannerMetrics';
import {
  MAX_CAMPAIGN_DURATION_WEEKS,
  MAX_SHORT_CAMPAIGN_DURATION_WEEKS,
} from '../../lib/shared/campaignDuration';
// Phase 6D-B — Intelligent Mix plan-generation reuses the 6D-A intelligence resolver.
import {
  resolveIntelligenceContext,
  formatIntelligenceForPlanning,
  normalizePlanningIntelligenceMode,
  shouldResolvePlanningIntelligence,
  shouldEnrichPlanning,
} from '../../lib/shared/intelligence/resolveIntelligenceContext';
// Phase 6D-C / 6E-2 — adaptive platform prioritization (ordering only; eligibility untouched).
// Re-pointed to the company-scoped aggregator so new campaigns have data.
import {
  rankPlatformsByCompanyPerformance,
  rankContentTypesByCompanyPerformance,
} from './companyPerformanceAggregator';
import {
  orderPlatformsForIntelligentMix,
  normalizePlatformPriorityMode,
  shouldPrioritizePlatforms,
} from '../../lib/shared/intelligence/platformOrdering';
// Phase 6D-D1 — format preference intelligence (ordering only; counts untouched).
import { getMarketingMemoriesByType } from './marketingMemoryService';
import {
  orderFormatsForIntelligentMix,
  extractFormatSignalsFromMemory,
  normalizeFormatPriorityMode,
  shouldPrioritizeFormats,
} from '../../lib/shared/intelligence/formatOrdering';
import { withBlueprintSaveGuard } from './boltPersistenceGuards';
import {
  acquireRunLock,
  extendRunLock,
  releaseRunLock,
  DEFAULT_LOCK_TTL_MS,
} from './boltExecutionLock';

import { AI_PLAN_TIMEOUT_MS, GENERATE_WEEKLY_TIMEOUT_MS, GENERATE_WEEKLY_HEARTBEAT_MS, withTimeout, type BoltStage, type BoltPayload, updateRun, logEvent, checkStageCompleted, getCompletedStagePlan, assertCampaignValid, runSourceRecommendation } from './boltPipelineServiceModel';


type RunAiPlanResult = { plan: { weeks: unknown[] }; result: Awaited<ReturnType<typeof runCampaignAiPlan>> };

/**
 * PMF-006 — the Strategic (Intelligent) Mix seam. Default 'legacy' runs the existing
 * mix engine core byte-identically. On the platform path (flag-gated, combined mode
 * only) the SAME core runs inside the Strategic Mix AIA agent, which orchestrates the
 * Decision Graph (dependency-ordered waves, checkpoints, resume, approval, recovery);
 * the mix node executes through AIC (CKC knowledge, validation, telemetry) with this
 * core as the backend, and the EXACT core result is served (parity) with a safety net.
 * Strategic Mix is the `isCombined` branch, so only that path migrates.
 */
export async function runAiPlan(runId: string, campaignId: string, companyId: string, payload: BoltPayload, eligiblePlatforms?: string[], requiresMediaFlow?: boolean, isCombined?: boolean): Promise<RunAiPlanResult> {
  const { shouldRunPlatform } = await import('./strategicMixCapability/strategicMixMigrationFlag');
  if (isCombined && shouldRunPlatform()) {
    const { runStrategicMixViaPlatform } = await import('./strategicMixCapability/strategicMixPlatformRuntime');
    return runStrategicMixViaPlatform<RunAiPlanResult>({
      companyId,
      generate: () => runAiPlanCore(runId, campaignId, companyId, payload, eligiblePlatforms, requiresMediaFlow, isCombined),
      correlationId: runId,
    });
  }
  return runAiPlanCore(runId, campaignId, companyId, payload, eligiblePlatforms, requiresMediaFlow, isCombined);
}

async function runAiPlanCore(runId: string, campaignId: string, companyId: string, payload: BoltPayload, eligiblePlatforms?: string[], requiresMediaFlow?: boolean, isCombined?: boolean): Promise<RunAiPlanResult> {
  const snapshot = payload.sourceStrategicTheme as Record<string, unknown>;
  const normalizedTheme = normalizeStoredStrategicTheme(snapshot);
  const basePayload = (snapshot?.context_payload && typeof snapshot.context_payload === 'object')
    ? { ...snapshot.context_payload }
    : {};
  const mergedPayload: Record<string, unknown> =
    payload.sourceStrategicTheme && typeof payload.sourceStrategicTheme === 'object'
      ? { ...basePayload, ...payload.sourceStrategicTheme }
      : basePayload;
  if (normalizedTheme) {
    mergedPayload.primary_recommendations = normalizedTheme.blueprint.primary_recommendations;
    mergedPayload.supporting_recommendations = normalizedTheme.blueprint.supporting_recommendations;
    mergedPayload.progression_summary = normalizedTheme.blueprint.progression_summary;
    mergedPayload.duration_weeks = normalizedTheme.blueprint.duration_weeks;
  }

  const topicFromCard = getStoredStrategicThemeTitle(snapshot);

  const recommendationContext = {
    target_regions: payload.regionsFromCard ?? null,
    context_payload: Object.keys(mergedPayload).length > 0 ? mergedPayload : null,
    source_opportunity_id: payload.sourceOpportunityId ?? null,
    ...(topicFromCard ? { topic_from_card: topicFromCard } : {}),
  };

  const execConfig = (payload.executionConfig ?? {}) as Record<string, unknown>;
  const themeTitle = topicFromCard;

  // Build collectedPlanningContext: executionConfig from Trend page first, then theme, then defaults for QA keys only
  const parsedFreq =
    typeof execConfig.frequency_per_week === 'string'
      ? parseInt(String(execConfig.frequency_per_week).replace(/\D/g, '') || '5', 10) || 5
      : typeof execConfig.frequency_per_week === 'number'
        ? execConfig.frequency_per_week
        : 5;

  // Build default platform requests from the company's configured platforms (eligiblePlatforms).
  // eligiblePlatforms is already narrowed by execConfig.selected_platforms upstream
  // (see executeBoltPipeline), so we just fall back to LinkedIn if nothing is configured.
  const baseConfiguredPlatforms = eligiblePlatforms && eligiblePlatforms.length > 0
    ? eligiblePlatforms
    : ['linkedin'];

  // Phase 6D-C — adaptive platform prioritization. ORDERING ONLY: reorders the
  // already-eligible set by historical engagement; never adds/removes platforms.
  // Combined-only + mode-gated; ranker is campaign-scoped (empty → order preserved).
  let configuredPlatforms = baseConfiguredPlatforms;
  const platformPriorityMode = normalizePlatformPriorityMode(process.env.INTELLIGENT_MIX_PLATFORM_PRIORITY_MODE);
  if (shouldPrioritizePlatforms(platformPriorityMode, isCombined === true)) {
    let perfRanks: Array<{ platform: string; score: number }> = [];
    try {
      const ranks = await rankPlatformsByCompanyPerformance(companyId);
      perfRanks = ranks.map((r) => ({ platform: r.platform, score: r.avg_engagement_rate }));
    } catch {
      perfRanks = [];
    }
    const ordering = orderPlatformsForIntelligentMix(baseConfiguredPlatforms, perfRanks, platformPriorityMode);
    configuredPlatforms = ordering.order;
    console.log('[bolt/platform-prioritization]', JSON.stringify({
      campaign_id: campaignId,
      intelligence_mode: platformPriorityMode,
      source_used: 'campaign_performance_signals',
      eligible_platform_count: baseConfiguredPlatforms.length,
      ranking_platform_count: ordering.rankingCount,
      records_considered: perfRanks.length,
      records_kept: ordering.rankingCount,
      records_discarded: Math.max(0, perfRanks.length - ordering.rankingCount),
      platform_order_changed: ordering.changed,
      old_order: baseConfiguredPlatforms,
      new_order: ordering.proposedOrder,
    }));
  }

  let platformContentPrefs: Record<string, string[]> = {};
  try {
    const { data } = await ownedDbTable('company_profiles')
      .select('platform_content_type_prefs')
      .eq('company_id', companyId)
      .maybeSingle();
    if (data?.platform_content_type_prefs && typeof data.platform_content_type_prefs === 'object') {
      platformContentPrefs = data.platform_content_type_prefs as Record<string, string[]>;
    }
  } catch { /* non-fatal — fall back to 'post' */ }

  const getPrimaryContentType = (platform: string): string => {
    const canonical = platform.toLowerCase().replace(/^twitter$/i, 'x');
    const prefs = platformContentPrefs[canonical] ?? platformContentPrefs[platform.toLowerCase()];
    if (Array.isArray(prefs) && prefs.length > 0) {
      // Pick the first text-compatible content type (skip video/reel for BOLT text campaigns)
      if (requiresMediaFlow) return prefs[0];
      const textSafe = prefs.find((t) => !['video', 'reel', 'short'].includes(t.toLowerCase()));
      return textSafe ?? prefs[0];
    }
    return 'post';
  };

  // Frequency semantics: `frequency_per_week` and `format_frequency[type]` are
  // TOTALS across all selected platforms, not per-platform. How the skeleton turns
  // these into unique pieces depends on `cross_platform_sharing`:
  //   • sharing OFF → per-platform counts sum to `total`; each count is a solo piece.
  //     Total scheduled = sum(counts) = total.
  //   • sharing ON  → the skeleton uses `max(counts)` unique pieces. The first piece
  //     cross-posts to all platforms; any remaining per-platform capacity becomes
  //     SOLO extras on the platforms that still have leftover count. So distributing
  //     `total` with remainder (e.g. 9 across 4 platforms → [3,2,2,2] if the first
  //     platform is the affinity winner for the content type) yields 2 shared pieces
  //     × 4 platforms + 1 solo piece on platform 0 = 9 scheduled exactly.
  // In both modes, distribute with remainder — the skeleton picks the right unique-
  // piece reduction.
  const distributeAcrossPlatforms = (total: number, platformCount: number): number[] => {
    if (platformCount <= 0 || total <= 0) return [];
    const base = Math.floor(total / platformCount);
    const remainder = total % platformCount;
    return Array.from({ length: platformCount }, (_, i) => base + (i < remainder ? 1 : 0));
  };

  const defaultDistribution = distributeAcrossPlatforms(Math.max(1, parsedFreq), configuredPlatforms.length);
  // Honor "BOLT Frequency is Total" — N total posts/week across platforms,
  // not N×platform_count. The previous Math.max(1, ...) floor forced every
  // platform to ≥1 even when distribute() correctly returned 0 for tail
  // platforms (e.g. freq=1 + 3 platforms → distribute=[1,0,0]). That floor
  // inflated the per-week demand and pushed the capacity validator into
  // deficit, producing "AI plan did not return a valid plan with weeks"
  // for any user picking frequency lower than connected-platform count.
  // Filter zero rows so they don't reach the planner as no-op requests.
  const defaultPlatformRequests = configuredPlatforms
    .map((p, idx) => ({
      platform: p,
      content_type: getPrimaryContentType(p),
      count_per_week: defaultDistribution[idx] ?? 0,
    }))
    .filter((r) => r.count_per_week > 0);
  // When format_frequency is provided (multi-format BOLT: e.g. 3 posts + 3 articles),
  // expand into one entry per (platform × content_type) so all selected formats appear
  // as separate execution items instead of collapsing to the primary type only.
  let formatFreqMap =
    execConfig.format_frequency &&
    typeof execConfig.format_frequency === 'object' &&
    !Array.isArray(execConfig.format_frequency)
      ? (execConfig.format_frequency as Record<string, number>)
      : null;

  // Phase 6D-D1 — format preference intelligence. RANKING ONLY: reorders the
  // KEYS of formatFreqMap (the format-ordering authority consumed by
  // formatDerivedRequests below) by historical performance from marketing_memory.
  // Counts/frequencies (the values) and membership are preserved exactly.
  // Combined-only + mode-gated; reader failures degrade to the original order.
  const formatPriorityMode = normalizeFormatPriorityMode(process.env.INTELLIGENT_MIX_FORMAT_PRIORITY_MODE);
  if (
    formatFreqMap &&
    Object.keys(formatFreqMap).length > 1 &&
    shouldPrioritizeFormats(formatPriorityMode, isCombined === true)
  ) {
    const baseFormatMap = formatFreqMap;
    const selectedFormats = Object.keys(baseFormatMap);
    let signals: Array<{ format: string; score: number }> = [];
    let recordsConsidered = 0;
    try {
      const [contentPerf, narrativePerf, ctRanks] = await Promise.all([
        getMarketingMemoriesByType(companyId, 'content_performance', 50),
        getMarketingMemoriesByType(companyId, 'narrative_performance', 50),
        rankContentTypesByCompanyPerformance(companyId),
      ]);
      // marketing_memory (distilled, higher confidence) first; the helper keeps
      // the first score per format, so campaign_performance_signals only fills gaps.
      const memorySignals = extractFormatSignalsFromMemory([...contentPerf, ...narrativePerf]);
      const aggSignals = ctRanks.map((c) => ({ format: c.content_type, score: c.avg_engagement_rate }));
      signals = [...memorySignals, ...aggSignals];
      recordsConsidered = contentPerf.length + narrativePerf.length + ctRanks.length;
    } catch {
      signals = [];
    }
    const ordering = orderFormatsForIntelligentMix(selectedFormats, signals, formatPriorityMode);
    // Rebuild only when the APPLIED order actually differs (advisory/active with a
    // real reorder). Shadow keeps the original order → no rebuild → counts/keys intact.
    const orderChanged = ordering.order.some((f, i) => f !== selectedFormats[i]);
    if (orderChanged) {
      formatFreqMap = Object.fromEntries(ordering.order.map((f) => [f, baseFormatMap[f]]));
    }
    console.log('[bolt/format-prioritization]', JSON.stringify({
      campaign_id: campaignId,
      mode: formatPriorityMode,
      source_used: 'marketing_memory+campaign_performance_signals',
      format_count: selectedFormats.length,
      ranked_format_count: ordering.rankingCount,
      records_considered: recordsConsidered,
      records_kept: ordering.rankingCount,
      records_discarded: Math.max(0, recordsConsidered - ordering.rankingCount),
      format_order_changed: ordering.changed,
      old_order: selectedFormats,
      new_order: ordering.proposedOrder,
    }));
  }
  // Under sharing OFF the remainder (`total % P`) becomes an EXTRA post on the
  // first platforms in the list. To land the remainder on the platform most
  // natural for each content type (e.g. an `article` remainder should prefer
  // LinkedIn, not X), we reorder configuredPlatforms by CONTENT_PLATFORM_AFFINITY
  // for that type before distributing.
  const sortPlatformsByAffinity = (platforms: string[], contentType: string): string[] => {
    const affinity = CONTENT_PLATFORM_AFFINITY[String(contentType).toLowerCase()] ?? [];
    if (affinity.length === 0) return platforms;
    const rank = (p: string): number => {
      const idx = affinity.indexOf(p.toLowerCase());
      return idx >= 0 ? idx : Number.MAX_SAFE_INTEGER;
    };
    return [...platforms].sort((a, b) => rank(a) - rank(b));
  };

  // Format-platform exclusivity. Some content formats are intrinsically tied
  // to a single platform — e.g. "tweet" only makes sense on X/Twitter, not on
  // Facebook or LinkedIn (even though those platforms support generic 'text'
  // content). Without this gate, CONTENT_PLATFORM_AFFINITY['tweet'] resolves
  // to every text-capable platform and distributeAcrossPlatforms fans the
  // tweet count across them, producing nonsense like "tweet → LinkedIn".
  // Mirrors the UI binding in components/BoltStrategyView.tsx
  // (FORMAT_REQUIRED_PLATFORMS) so the planner enforces the same rule.
  //
  // FORMAT_EXCLUSIVE_PLATFORMS is imported from the shared authority
  // (lib/shared/bolt/formatPlatformBinding) so the planner enforces the exact
  // same binding the UI uses — the rationale above still applies.
  const restrictPlatformsForFormat = (platforms: string[], contentType: string): string[] => {
    // Phase 6G-1: Intelligent Mix enforces the FULL canonical assignment
    // authority at planning time — a format is kept only on platforms that can
    // actually run it (e.g. carousel→youtube dropped here, not at publish). This
    // SUBSUMES FORMAT_EXCLUSIVE_PLATFORMS (which is derived into the authority).
    // Order is preserved so 6D-C/6D-D prioritization upstream still holds.
    if (isCombined === true) {
      const capabilityFiltered = filterPlatformsForFormat(platforms, contentType);
      // Formats with no resolvable capability (e.g. podcast/audio → fail-closed
      // empty) fall through to the legacy FORMAT_EXCLUSIVE-only behavior so
      // attachment-required media keeps its existing routing (not newly dropped).
      if (capabilityFiltered.length > 0) return capabilityFiltered;
    }
    // BOLT Text / Creator: unchanged (byte-identical legacy behavior).
    const exclusive = FORMAT_EXCLUSIVE_PLATFORMS[String(contentType).toLowerCase()];
    if (!exclusive) return platforms;
    return platforms.filter((p) => exclusive.includes(String(p).toLowerCase()));
  };

  const formatDerivedRequests: Array<{ platform?: string; content_type?: string; count_per_week?: number }> | null =
    !execConfig.platform_content_requests && formatFreqMap && Object.keys(formatFreqMap).length > 0
      ? Object.entries(formatFreqMap)
          .filter(([, cnt]) => Number(cnt) > 0)
          .flatMap(([ct, cnt]) => {
            const allowedPlatforms = restrictPlatformsForFormat(configuredPlatforms, ct);
            // If the format's only valid platform isn't connected, drop the
            // format from this campaign rather than misrouting it. The UI
            // should have prevented this state, but defense in depth.
            if (allowedPlatforms.length === 0) return [];
            const orderedPlatforms = sortPlatformsByAffinity(allowedPlatforms, ct);
            const perPlatform = distributeAcrossPlatforms(Number(cnt), orderedPlatforms.length);
            return orderedPlatforms
              .map((p, i) => ({ platform: p, content_type: ct, count_per_week: perPlatform[i] ?? 0 }))
              .filter((r) => r.count_per_week > 0);
          })
      : null;
  const rawPlatformRequests = (execConfig.platform_content_requests ?? formatDerivedRequests ?? defaultPlatformRequests) as Array<{ platform?: string; content_type?: string; count_per_week?: number }>;
  let assignmentPairsRemoved = 0;
  const boltPlatformRequests = rawPlatformRequests
    // Text BOLT excludes video-first platforms; creator and combined campaigns keep them all
    .filter((r) => r && r.platform && (requiresMediaFlow || isCombined || !['youtube', 'tiktok'].includes(String(r.platform).toLowerCase())))
    // Defensive assignment gate. Even when platform_content_requests is supplied
    // directly by the caller (bypassing formatDerivedRequests), an invalid
    // {platform, content_type} pairing is dropped here so it never reaches the
    // planner. Phase 6G-1: Intelligent Mix uses the full capability authority
    // (subsumes FORMAT_EXCLUSIVE); Text/Creator keep the legacy exclusive gate.
    .filter((r) => {
      if (isCombined === true) {
        const supported = getSupportedPlatformsForFormat(r.content_type);
        if (supported.length > 0) {
          const ok = supported.some((p) => p.toLowerCase() === String(r.platform).toLowerCase());
          if (!ok) assignmentPairsRemoved += 1;
          return ok;
        }
        // no resolvable capability (podcast/audio) → fall through to legacy gate
      }
      const exclusive = FORMAT_EXCLUSIVE_PLATFORMS[String(r.content_type ?? '').toLowerCase()];
      if (!exclusive) return true;
      return exclusive.includes(String(r.platform).toLowerCase());
    })
    .map((r) => ({
      platform: r.platform,
      content_type: !requiresMediaFlow && !isCombined && ['video', 'reel', 'carousel', 'slider', 'image', 'banner'].includes(String(r.content_type ?? '').toLowerCase())
        ? 'post'
        : (r.content_type ?? 'post'),
      count_per_week: r.count_per_week ?? Math.max(1, Math.floor(parsedFreq / 2)),
    }));

  if (isCombined === true) {
    // Phase 6G-1 observability — counts only, no business content.
    const formatsRequested = [...new Set(rawPlatformRequests.map((r) => String(r.content_type ?? '').toLowerCase()).filter(Boolean))];
    console.log('[bolt/assignment-enforcement]', JSON.stringify({
      campaign_id: campaignId,
      surface: 'planner',
      assignment_rules_checked: rawPlatformRequests.length,
      invalid_platform_format_pairs_removed: assignmentPairsRemoved,
      supported_platform_count: configuredPlatforms.length,
      supported_format_count: formatsRequested.length,
    }));
  }
  // CAMPAIGN-IMPL-003A: attribute plan-request trims into the shared planner
  // metrics so drops before the weekly stage are not invisible. Invalid
  // {platform,content_type} pairs → platform_blocked; the remaining shortfall
  // (video-only platforms excluded for text BOLT, exclusive-gate) →
  // no_eligible_platform. Fail-safe, counts only.
  {
    const droppedTotal = Math.max(0, rawPlatformRequests.length - boltPlatformRequests.length);
    const mode = isCombined ? 'mix' : requiresMediaFlow ? 'creator' : 'writer';
    if (assignmentPairsRemoved > 0) emitPlannerDrop('platform_blocked', assignmentPairsRemoved, mode);
    const noPlatform = Math.max(0, droppedTotal - assignmentPairsRemoved);
    if (noPlatform > 0) emitPlannerDrop('no_eligible_platform', noPlatform, mode);
  }

  // Phase 6C-4A: Intelligent Mix (combined) is the extended-planning surface and
  // accepts the full 1–12 range; BOLT Text/Creator stay short-form (1–4). The max
  // is derived from the shared duration authority — no hardcoded 4/12 here.
  const maxDurationWeeks = isCombined ? MAX_CAMPAIGN_DURATION_WEEKS : MAX_SHORT_CAMPAIGN_DURATION_WEEKS;
  const durationWeeks = Math.min(
    maxDurationWeeks,
    Math.max(1, typeof execConfig.campaign_duration === 'number' ? execConfig.campaign_duration : 4)
  );
  const collectedPlanningContext: Record<string, unknown> = {
    ...execConfig,
    execution_config: execConfig,
    ...payload.sourceStrategicTheme,
    ...execConfig,
    // QA-required keys: use execConfig value if present, else default.
    // available_content / weekly_capacity / content_capacity are passed
    // through here in their RAW form (record or empty); the canonical
    // normalization happens once at the orchestrator chokepoint
    // (preparePrefilledPlanningState → normalizePlannerCapacityInputs).
    // We no longer default available_content to the string 'No' — that
    // was a contract violation (string in a numeric inventory field)
    // that worked only because the downstream normalizer learned to
    // interpret it. Pass undefined and let the normalizer derive
    // has_existing_content=false + empty inventory canonically.
    //
    // BOLT users genuinely have no pre-existing content inventory when
    // generating a fresh campaign — the canonical answer is {} (empty
    // inventory record), NOT the legacy 'No' string. Setting it
    // explicitly here so the orchestrator doesn't have to infer.
    available_content: execConfig.available_content ?? {},
    has_existing_content:
      typeof execConfig.has_existing_content === 'boolean'
        ? execConfig.has_existing_content
        : false,
    weekly_capacity: execConfig.weekly_capacity ?? execConfig.content_capacity ?? (formatFreqMap && Object.keys(formatFreqMap).length > 0 ? { ...formatFreqMap } : { post: Math.max(1, parsedFreq) }),
    content_capacity: execConfig.content_capacity ?? execConfig.weekly_capacity ?? (formatFreqMap && Object.keys(formatFreqMap).length > 0 ? { ...formatFreqMap } : { post: Math.max(1, parsedFreq) }),
    action_expectation: execConfig.action_expectation ?? (themeTitle ? `Learn about ${String(themeTitle).slice(0, 80)}` : 'Learn and engage'),
    topic_continuity: execConfig.topic_continuity ?? 'One ongoing story',
    platforms: execConfig.platforms ?? configuredPlatforms.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(', '),
    platform_content_requests: boltPlatformRequests.length > 0 ? boltPlatformRequests : defaultPlatformRequests,
    exclusive_campaigns: execConfig.exclusive_campaigns ?? 'No',
    key_messages: execConfig.key_messages ?? themeTitle ?? (typeof snapshot?.theme_or_description === 'string' ? snapshot.theme_or_description : 'Core value and expertise'),
    campaign_duration: durationWeeks,
    preplanning_form_completed: true,
    ...withBoltMetadata({}, { textOnly: !requiresMediaFlow && !isCombined }),
    // User-selected content formats and per-format frequency — tell AI exactly what to plan
    ...(Array.isArray(execConfig.content_formats) && (execConfig.content_formats as string[]).length > 0
      ? { preferred_content_types: execConfig.content_formats, content_formats: execConfig.content_formats }
      : {}),
    ...(execConfig.format_frequency && typeof execConfig.format_frequency === 'object'
      ? { format_frequency: execConfig.format_frequency }
      : {}),
    // Multiple campaign goals — ensure AI aligns strategy to all of them
    ...(Array.isArray(execConfig.campaign_goals) && (execConfig.campaign_goals as string[]).length > 0
      ? { campaign_goals: execConfig.campaign_goals }
      : {}),
    // ── Campaign Brief surface for the planner ──────────────────────────────
    // These three keys come from the BOLT Text "Campaign Brief" section in
    // the UI (hooks/useBoltStrategy.tsx). The planner prompt uses them to
    // answer WHY (goals), WHO (target_audience), and HOW (tone) — without
    // them the AI plan falls back to topic-only inference, which is what
    // happened pre-Brief.
    ...(typeof execConfig.campaign_description === 'string' && (execConfig.campaign_description as string).trim()
      ? { campaign_description: execConfig.campaign_description }
      : {}),
    ...(Array.isArray(execConfig.tone) && (execConfig.tone as string[]).length > 0
      ? { tone: execConfig.tone, communication_style: execConfig.communication_style ?? execConfig.tone }
      : {}),
    // brief_fields_filled stays opaque to the planner (it's diagnostic only)
    // but we surface it so it appears in [bolt/plan-input] logs alongside
    // the rest of the planning context.
    ...(execConfig.brief_fields_filled && typeof execConfig.brief_fields_filled === 'object'
      ? { brief_fields_filled: execConfig.brief_fields_filled }
      : {}),
  };

  const planMessage = `Yes, generate my ${durationWeeks}-week plan now.`;

  // Diagnostic: log what we're sending so failures are traceable. Brief
  // fields are included so we can correlate AI plan quality against which
  // optional inputs the user supplied. Correlation fields (run_id,
  // deployment_id, worker_pid, stage) are stamped so the planner lifecycle
  // can be reconstructed from logs alone across worker instances.
  console.log('[bolt/plan-input]', JSON.stringify({
    run_id: runId,
    campaign_id: campaignId,
    stage: 'ai/plan',
    deployment_id: WORKER_PROVENANCE.deploymentId,
    worker_pid: WORKER_PROVENANCE.workerPid,
    platform_content_requests: collectedPlanningContext.platform_content_requests,
    weekly_capacity: collectedPlanningContext.weekly_capacity,
    content_capacity: collectedPlanningContext.content_capacity,
    campaign_duration: collectedPlanningContext.campaign_duration,
    brief: {
      has_description: Boolean(collectedPlanningContext.campaign_description),
      goals_count: Array.isArray(collectedPlanningContext.campaign_goals) ? (collectedPlanningContext.campaign_goals as unknown[]).length : 0,
      tone_count: Array.isArray(collectedPlanningContext.tone) ? (collectedPlanningContext.tone as unknown[]).length : 0,
      audience_present: typeof collectedPlanningContext.target_audience === 'string' && (collectedPlanningContext.target_audience as string).trim().length > 0,
      brief_fields_filled: collectedPlanningContext.brief_fields_filled ?? null,
    },
    format_frequency: collectedPlanningContext.format_frequency,
  }));

  // Sub-stage observer — pushes intra-stage progress into the BOLT run row so
  // the UI's progress panel can show "Drafting weekly themes…" / "Scoring
  // alignment…" instead of sitting on the bare "Creating week plan" label
  // for the full 60–120s window. Fire-and-forget; failures are swallowed so
  // logging never breaks the plan run. We also nudge progress_percentage
  // forward (interpolating between getProgress(ai/plan)=16 and the next
  // stage at 33) so the bar moves visibly during this stage.
  const SUBSTAGE_PROGRESS: Record<string, number> = {
    context:  17,
    drafting: 22,
    // Heartbeat ticks — keep the bar at the parent phase's percentage so it
    // doesn't oscillate; only the substage label changes.
    'still-drafting':              22,
    'still-evaluating-alignment':  25,
    'still-refining':              31,
    // Parse / skeleton repair substages emitted by parseStructuredPlanWithRecovery
    // when the first LLM output couldn't be parsed or violated the skeleton.
    'repairing-malformed-structure': 23,
    'repairing-campaign-skeleton':   23,
    'validating-repaired-campaign':  24,
    // Legacy scoring parent — kept so runs that emit the old key keep working.
    scoring:  25,
    // Granular alignment substages. Each one advances the bar a single tick
    // so the UI keeps moving while the orchestrator works through the
    // budget-bounded alignment sequence.
    'evaluating-alignment':                  25,
    'checking-psychological-progression':    26,
    'validating-content-diversity':          27,
    'recovering-low-alignment-sections':     28,
    'rechecking-strategic-alignment':        29,
    'continuing-to-refinement':              30,
    refining: 31,
  };
  const onAiPlanSubStage = (sub: string): void => {
    const pct = SUBSTAGE_PROGRESS[sub];
    void updateRun(runId, {
      current_stage: `ai/plan:${sub}`,
      ...(typeof pct === 'number' ? { progress_percentage: pct } : {}),
    }).catch(() => { /* advisory only */ });
  };

  // Phase 6D-B — Intelligent Mix intelligence-driven planning. Reuses the SAME
  // 6D-A resolver and populates the EXISTING `previous_performance_insights`
  // field (PerformanceInsight: issues/opportunities/recommendations) — no schema
  // expansion. Combined-only + mode-gated; resolver never throws, so planning is
  // never broken by intelligence. Observability logs counts only (no content).
  let planningIntelligence:
    | { issues: string[]; opportunities: string[]; recommendations: string[]; plannerFeedback: string }
    | null = null;
  const planningIntelMode = normalizePlanningIntelligenceMode(process.env.INTELLIGENT_MIX_PLANNING_INTELLIGENCE_MODE);
  if (shouldResolvePlanningIntelligence(planningIntelMode, isCombined === true)) {
    const intelStartedAt = Date.now();
    // W3-8 (audit B-37): the intelligence context is DETERMINISTIC company
    // signal state (issues/opportunities/recommendations derived from DB —
    // never generated AI output), re-resolved on every plan run. Under the
    // 'planner-context-cache' flag it is reused for a short TTL per company;
    // regenerating within the window sees identical signals (they change on
    // cron cadence, not per-plan). Flag off (default) = resolve every run.
    const intel = await resolvePlanningIntelligenceCached(companyId);
    const formatted = formatIntelligenceForPlanning(intel);
    const enrich = shouldEnrichPlanning(planningIntelMode) && !!formatted;
    if (enrich && formatted) {
      planningIntelligence = {
        issues: formatted.issues,
        opportunities: formatted.opportunities,
        recommendations: formatted.recommendations,
        plannerFeedback: formatted.plannerFeedback,
      };
    }
    console.log('[bolt/plan-intelligence]', JSON.stringify({
      run_id: runId,
      campaign_id: campaignId,
      intelligence_mode: planningIntelMode,
      resolver_duration_ms: Date.now() - intelStartedAt,
      // Count the resolver produced (logged in shadow too); enrichment flag says if injected.
      intelligence_lines_added: formatted?.linesAdded ?? 0,
      planning_prompt_enriched: enrich,
    }));
  }

  // Single retry on ai/plan. Each attempt is bounded by AI_PLAN_TIMEOUT_MS (120s); 3 retries
  // turned a slow OpenAI call into ~8 min of wall time, blowing past the UI polling deadline
  // without measurably improving success rate.
  //
  // W3-3 (audit B-09): under the 'retry-budget-planner' flag this seam becomes
  // the SINGLE retry authority for the plan draft, using the F-09 budget:
  //   - cumulative ceiling of 2 attempts / 2×timeout+backoff wall-clock,
  //   - a TIMED-OUT attempt is NOT retried (the underlying call may still be
  //     running — retrying multiplied cost without improving success; only
  //     transient provider errors requeue),
  //   - denials + attempts land on retry_budget.* metrics.
  // Flag off (default) = legacy retryWithBackoff exactly as before.
  const runPlanAttempt = () =>
    withTimeout(
      runCampaignAiPlan({
        campaignId,
        mode: 'generate_plan',
        message: planMessage,
        // No conversationHistory — BOLT is not conversational. Passing history triggers
        // the gather-phase Q&A loop which ignores collectedPlanningContext and returns
        // a conversational prompt instead of a plan.
        recommendationContext,
        collectedPlanningContext,
        variantMetadata: withBoltMetadata({}, { runId }).variantMetadata,
        onSubStage: onAiPlanSubStage,
        // 6D-B: combined-only, advisory/active-only; omitted entirely otherwise.
        ...(planningIntelligence ? { previous_performance_insights: planningIntelligence } : {}),
      }),
      AI_PLAN_TIMEOUT_MS,
      'ai/plan'
    );
  const result = resolveRolloutSync(RETRY_BUDGET_PLANNER_FLAG).mode !== 'off'
    ? await retryWithBudget(runPlanAttempt, {
        budget: createOperationBudget({
          name: 'planner-draft',
          maxAttempts: 2,
          maxTotalMs: AI_PLAN_TIMEOUT_MS * 2 + 5_000,
        }),
        layer: 'bolt-run-plan',
        maxRetries: 1,
        initialDelayMs: 2_000,
        retryOn: (err) => classifyForRetry(err) === 'retryable_transient',
      })
    : await retryWithBackoff(runPlanAttempt, { maxRetries: 1, initialDelayMs: 2000 });

  // Diagnostic: log what came back so we can tell if it's a capacity block,
  // QA block, or AI failure. Correlation fields stamped for cross-instance
  // reconstruction (pair with [bolt/plan-input] above on run_id).
  console.log('[bolt/plan-result]', JSON.stringify({
    run_id: runId,
    campaign_id: campaignId,
    stage: 'ai/plan',
    deployment_id: WORKER_PROVENANCE.deploymentId,
    worker_pid: WORKER_PROVENANCE.workerPid,
    has_plan: !!result?.plan,
    has_weeks: Array.isArray(result?.plan?.weeks),
    week_count: Array.isArray(result?.plan?.weeks) ? result.plan.weeks.length : null,
    has_conversational: !!result?.conversationalResponse,
    conversational_preview: result?.conversationalResponse
      ? String(result.conversationalResponse).slice(0, 200)
      : null,
    validation_status: (result as any)?.validation_result?.status ?? null,
    validation_deficit: (result as any)?.validation_result?.deficit ?? null,
  }));

  const plan = result?.plan;
  if (!plan || !Array.isArray(plan.weeks)) {
    throw new BoltError(
      BOLT_ERROR_CODES.AI_PLAN_INVALID,
      'AI plan did not return a valid plan with weeks',
    );
  }

  // Trim to requested duration: reduce downstream work (generate-weekly-structure, scheduling)
  const trimmedWeeks = plan.weeks.slice(0, durationWeeks);
  if (trimmedWeeks.length < plan.weeks.length) {
    (plan as { weeks: unknown[] }).weeks = trimmedWeeks;
  }

  return { plan, result };
}

export async function runCommitPlan(
  campaignId: string,
  plan: { weeks: unknown[] },
  executionConfig?: Record<string, unknown>,
  preserveCreatorFormats?: boolean
): Promise<void> {
  // When the campaign carries creator/media formats (creator, legacy media,
  // or combined/Intelligent-Mix), the blueprint is committed verbatim.
  // Text-only campaigns are sanitised down to BOLT text formats.
  const sanitizedWeeks = preserveCreatorFormats ? plan.weeks : sanitizeBoltPlanForTextOnly(plan.weeks);
  const blueprint = fromStructuredPlan({ weeks: sanitizedWeeks, campaign_id: campaignId });
  // Align with strategic theme card → create campaign flow: saveStructuredCampaignPlan + commitDraftBlueprint
  const snapshotHash = `bolt-${campaignId}-${Date.now()}`;
  // Part 6 — classify any save failure as BLUEPRINT_SAVE_FAILED rather
  // than leaking a generic Supabase / orchestrator error. The wrapper
  // preserves the raw cause in `details.db_error` for forensics.
  await withBlueprintSaveGuard({ campaign_id: campaignId, snapshot_hash: snapshotHash, op: 'saveStructuredCampaignPlan' }, () =>
    saveStructuredCampaignPlan({
      campaignId,
      snapshot_hash: snapshotHash,
      weeks: sanitizedWeeks as any,
      omnivyre_decision: { status: 'ok', recommendation: 'proceed' } as any,
      raw_plan_text: '',
    })
  );
  await withBlueprintSaveGuard({ campaign_id: campaignId, op: 'commitDraftBlueprint' }, () =>
    commitDraftBlueprint({
      campaignId,
      blueprint,
      source: 'bolt-ai-commit-plan',
    })
  );
  const durationWeeks = Math.max(1, blueprint.duration_weeks ?? plan.weeks.length ?? 1);
  const tentativeStart = executionConfig?.tentative_start as string | undefined;
  const startDateValue =
    tentativeStart && String(tentativeStart).trim()
      ? String(tentativeStart).includes('T')
        ? String(tentativeStart)
        : `${String(tentativeStart).trim()}T00:00:00.000Z`
      : undefined;

  const { data: existing } = await ownedDbTable('campaigns')
    .select('start_date')
    .eq('id', campaignId)
    .maybeSingle();
  const hasStartDate = !!(
    (existing as { start_date?: string } | null)?.start_date &&
    String((existing as { start_date: string }).start_date).trim()
  );

  // Keep campaign in 'draft' during BOLT execution. The pipeline sets it to 'active' on success.
  // Previously used 'active' here which caused the dashboard to show "scheduled" even when the
  // pipeline had not yet completed (or failed shortly after).
  const updates: Record<string, unknown> = {
    status: 'draft',
    current_stage: 'blueprint_committed',
    blueprint_status: 'ACTIVE',
    duration_weeks: durationWeeks,
    updated_at: new Date().toISOString(),
  };
  if (!hasStartDate && startDateValue) {
    updates.start_date = startDateValue;
  }

  await ownedDbTable('campaigns').update(updates).eq('id', campaignId);
}

