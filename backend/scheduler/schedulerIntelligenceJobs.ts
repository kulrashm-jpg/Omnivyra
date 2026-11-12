import { ownedDbTable } from '../db/writeOwner';
import { systemTenantContext } from '../db/tenantTable';
import { safeEnqueue } from '../middleware/queueBackpressure';
/**
 * Intelligence & engine scheduling jobs.
 *
 * Cron-invoked runners for the intelligence pipeline (polling, clustering,
 * theme/opportunity/narrative/community/thread engines, engagement capture,
 * feedback, trend relevance) plus scheduled lead detection. Split from
 * schedulerService.ts (Agent-B large-file modularization) — schedulerService
 * re-exports everything here, so importers keep using
 * '../scheduler/schedulerService'.
 */

import { recordScheduler } from '../observability/metrics';
import { addIntelligencePollingJob } from '../queue/intelligencePollingQueue';
import { INTELLIGENCE_POLLER_USER_ID, isApiSourceExecutable } from '../services/externalApiService';
import { clusterRecentSignals } from '../services/signalClusterEngine';
import { generateSignalIntelligence } from '../services/signalIntelligenceEngine';
import { generateStrategicThemes } from '../services/strategicThemeEngine';
import { generateCampaignOpportunities } from '../services/campaignOpportunityEngine';
import { generateContentOpportunities } from '../services/contentOpportunityEngine';
import { generateCampaignNarratives } from '../services/narrativeEngine';
import { generateCommunityPosts } from '../services/communityPostEngine';
import { generateCommunityThreads } from '../services/threadEngine';
import { captureEngagementSignals } from '../services/engagementCaptureService';
import { generateFeedbackInsights } from '../services/feedbackIntelligenceEngine';
import { computeThemeRelevanceForCompany } from '../services/companyTrendRelevanceEngine';
import { runInBackgroundJobContext } from '../services/intelligenceExecutionContext';
import {
  getGlobalConfig,
  getCompanyOverride,
  resolveConfig,
  getDailyJobCount,
  getCompanyPriorityAdjustment,
  logExecutionStart,
  logExecutionEnd,
  logSkipped,
} from '../services/intelligenceConfigService';
import { mapWithConcurrency, getSchedulerConcurrency } from './schedulerBatching';

type GlobalConfigRow = NonNullable<Awaited<ReturnType<typeof getGlobalConfig>>>;

/** Polling window in minutes (2 hours) for rate limit check */
const INTELLIGENCE_POLLING_WINDOW_MINUTES = 120;

/** Reliability thresholds for job priority: HIGH=1, MEDIUM=5, LOW=10 */
const RELIABILITY_HIGH = 0.8;
const RELIABILITY_MEDIUM = 0.3;

/** Map company polling_frequency to job priority (lower = run sooner). Used to respect company-configured polling. */
const POLLING_PRIORITY: Record<string, number> = {
  realtime: 1,
  '2h': 2,
  '6h': 5,
  daily: 10,
  weekly: 20,
};
function pollingPriorityFromConfig(frequency: string | null | undefined): number {
  if (!frequency || typeof frequency !== 'string') return 10;
  const key = frequency.trim().toLowerCase();
  return POLLING_PRIORITY[key] ?? 10;
}

export interface EnqueueIntelligencePollingResult {
  enqueued: number;
  skipped: number;
  reasons: { skipped_rate_limit: number; skipped_disabled: number };
}

/**
 * Enqueue intelligence polling jobs for external API sources.
 * Call every 2 hours (e.g. from cron).
 *
 * Mode 1 — Company polling: When company_api_configs has enabled = true, enqueue jobs for those sources.
 * Mode 2 — Global fallback: When no company configs exist, enqueue jobs for ALL active API sources (company_id = null).
 *
 * - Only is_active = true and reliability not "disabled" (reliability_score >= 0.1)
 * - Skips source if today's request_count >= rate_limit_per_min * polling_window
 * - Priority: HIGH reliability (>=0.8) → 1, MEDIUM (>=0.3) → 5, LOW → 10
 */
export async function enqueueIntelligencePolling(): Promise<EnqueueIntelligencePollingResult> {
  const today = new Date().toISOString().slice(0, 10);

  const { data: enabledConfigRows, error: configError } = await ownedDbTable('company_api_configs')
    .select('api_source_id, polling_frequency')
    .eq('enabled', true);

  let sources: { id: string; name?: string; rate_limit_per_min?: number }[];
  let useGlobalFallback: boolean;
  const pollingPriorityBySource = new Map<string, number>();

  if (configError || !enabledConfigRows?.length) {
    // Global fallback: no company configs — use all active API sources
    const { data: activeSources, error: sourcesError } = await ownedDbTable('external_api_sources')
      .select('id, name, rate_limit_per_min, is_enabled_global, is_whitelisted, category')
      .eq('is_active', true);

    if (sourcesError || !activeSources?.length) {
      return { enqueued: 0, skipped: 0, reasons: { skipped_rate_limit: 0, skipped_disabled: 0 } };
    }
    sources = activeSources.filter(isApiSourceExecutable);
    useGlobalFallback = true;
    console.log('[intelligence] global polling enabled — no company configs found');
  } else {
    // Company mode: sources from enabled company configs
    const enabledSourceIds = [...new Set((enabledConfigRows || []).map((r) => r.api_source_id))];
    for (const row of enabledConfigRows || []) {
      const id = row.api_source_id;
      const p = pollingPriorityFromConfig((row as { polling_frequency?: string | null }).polling_frequency);
      const existing = pollingPriorityBySource.get(id);
      if (existing === undefined || p < existing) pollingPriorityBySource.set(id, p);
    }
    const { data: companySources, error: sourcesError } = await ownedDbTable('external_api_sources')
      .select('id, name, rate_limit_per_min, is_enabled_global, is_whitelisted, category')
      .eq('is_active', true)
      .in('id', enabledSourceIds);

    if (sourcesError || !companySources?.length) {
      return { enqueued: 0, skipped: 0, reasons: { skipped_rate_limit: 0, skipped_disabled: 0 } };
    }
    sources = companySources.filter(isApiSourceExecutable);
    useGlobalFallback = false;
    console.log('[intelligence] company polling enabled');
  }

  const { data: healthRows } = await ownedDbTable('external_api_health')
    .select('api_source_id, reliability_score')
    .in('api_source_id', sources.map((s) => s.id));

  const healthBySource = new Map<string, number>();
  (healthRows ?? []).forEach((r: { api_source_id: string; reliability_score?: number }) => {
    healthBySource.set(r.api_source_id, r.reliability_score ?? 1);
  });

  const { data: usageRows } = await ownedDbTable('external_api_usage')
    .select('api_source_id, request_count')
    .eq('user_id', INTELLIGENCE_POLLER_USER_ID)
    .eq('usage_date', today)
    .in('api_source_id', sources.map((s) => s.id));

  const usageBySource = new Map<string, number>();
  (usageRows ?? []).forEach((r: { api_source_id: string; request_count?: number }) => {
    usageBySource.set(r.api_source_id, r.request_count ?? 0);
  });

  if (sources.length > 500) sources = sources.slice(0, 500);

  let enqueued = 0;
  let skippedRateLimit = 0;
  let skippedDisabled = 0;

  // ── HARDEN-004: decide in memory (unchanged rules), then enqueue in ONE
  // pipelined addBulk instead of ≤500 sequential Redis round-trips. Payloads,
  // priorities, jobIds and job options are identical; order is preserved.
  // Any bulk failure falls back to the original per-source loop.
  const purpose = useGlobalFallback ? 'global_intelligence_polling' : 'intelligence_polling';
  const toEnqueue: Array<{ sourceId: string; priority: number }> = [];
  for (const source of sources) {
    const reliability = healthBySource.get(source.id) ?? 1;
    if (reliability < 0.1) {
      skippedDisabled++;
      continue;
    }

    const rateLimitPerMin = source.rate_limit_per_min ?? 60;
    const cap = rateLimitPerMin * INTELLIGENCE_POLLING_WINDOW_MINUTES;
    const requestCount = usageBySource.get(source.id) ?? 0;
    if (requestCount >= cap) {
      skippedRateLimit++;
      continue;
    }

    const reliabilityPriority =
      reliability >= RELIABILITY_HIGH ? 1 : reliability >= RELIABILITY_MEDIUM ? 5 : 10;
    const companyPollingPriority = pollingPriorityBySource.get(source.id) ?? 10;
    const priority = Math.min(reliabilityPriority, companyPollingPriority);
    toEnqueue.push({ sourceId: source.id, priority });
  }

  if (toEnqueue.length > 0) {
    let bulkDone = false;
    try {
      const { addIntelligencePollingJobsBulk } = await import('../queue/intelligencePollingQueue');
      await addIntelligencePollingJobsBulk(
        toEnqueue.map(({ sourceId, priority }) => ({
          payload: { apiSourceId: sourceId, companyId: null, purpose },
          priority,
        }))
      );
      enqueued = toEnqueue.length;
      bulkDone = true;
    } catch (bulkErr: any) {
      console.warn('[enqueueIntelligencePolling] bulk enqueue failed — falling back to per-source', bulkErr?.message);
    }
    if (!bulkDone) {
      for (const { sourceId, priority } of toEnqueue) {
        try {
          await addIntelligencePollingJob(
            { apiSourceId: sourceId, companyId: null, purpose },
            { priority }
          );
          enqueued++;
        } catch (err: any) {
          console.warn('[enqueueIntelligencePolling] failed to enqueue', sourceId, err?.message);
        }
      }
    }
  }

  if (enqueued > 0) {
    console.log(
      `✅ Intelligence polling: enqueued ${enqueued}, skipped ${skippedRateLimit + skippedDisabled} (rate_limit=${skippedRateLimit}, disabled=${skippedDisabled})`
    );
  }

  return {
    enqueued,
    skipped: skippedRateLimit + skippedDisabled,
    reasons: { skipped_rate_limit: skippedRateLimit, skipped_disabled: skippedDisabled },
  };
}

/**
 * Run signal clustering on recent unclustered signals (last 6 hours).
 * Call every 30 minutes (e.g. from cron).
 */
export async function runSignalClustering() {
  return runWithConfig('signal_clustering', null, async () => {
    const result = await clusterRecentSignals();
    return {
      signals_processed: result.signals_processed,
      clusters_created: result.clusters_created,
      clusters_updated: result.clusters_updated,
    };
  });
}

/**
 * Run signal intelligence engine: convert clusters to actionable intelligence.
 * Call every hour (e.g. from cron).
 */
export async function runSignalIntelligenceEngine() {
  return runWithConfig('signal_intelligence', null, () => generateSignalIntelligence());
}

/**
 * Run strategic theme engine: convert eligible intelligence into theme cards.
 * Call every hour (e.g. from cron).
 */
export async function runStrategicThemeEngine() {
  return runWithConfig('strategic_themes', null, () => generateStrategicThemes());
}

/**
 * Run campaign opportunity engine: convert strategic themes into campaign opportunities.
 * Call every hour (e.g. from cron).
 */
export async function runCampaignOpportunityEngine() {
  return runWithConfig('campaign_opportunities', null, () => generateCampaignOpportunities());
}

/**
 * Run content opportunity engine: convert strategic themes into content opportunities.
 * Call every 2 hours (e.g. from cron).
 */
export async function runContentOpportunityEngine() {
  return runWithConfig('content_opportunities', null, () => generateContentOpportunities());
}

/** Companies with content opportunities created in this window are the narrative engine's work set. */
const NARRATIVE_DISCOVERY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Discovery pages through the window in created_at order; past this many pages it stops and REPORTS truncation. */
const NARRATIVE_DISCOVERY_PAGE = 1000;
const NARRATIVE_DISCOVERY_MAX_PAGES = 20;
/**
 * OPT-IN (e9 ruling, 2026-11-12): the narrative engine writes campaign_narratives (AI-style content) for every company
 * with recent opportunities, and stays OFF for launch. Absent or anything but 'true' and runNarrativeEngine reads and
 * writes nothing. This is the switch - NOT the intent/activity gate, which never opens today only because
 * recordUserActivity has no callers: fixing that gate must not wake this job by accident (05).
 */
export const NARRATIVE_ENGINE_FLAG = 'NARRATIVE_ENGINE_ENABLED';

/**
 * Run narrative engine: convert content opportunities into campaign narratives.
 * Call every 4 hours (e.g. from cron).
 *
 * S2 tenant seam (e1, 83 ruling 2): runs PER COMPANY under systemTenantContext (it used to read the latest 100
 * opportunities across all tenants in one call). The fan-out is bounded to companies with work: those with a
 * content opportunity created in the last 7 days - so dormant tenants add nothing. Per-company overrides of the
 * 'narrative_engine' config now apply. The cap of 100 opportunities is per company.
 */
/** The narrative engine's work set: companies with a content opportunity created in the discovery window. */
export async function discoverNarrativeWorkCompanies(
  now: number = Date.now(),
): Promise<{ companyIds: string[]; truncated: boolean }> {
  const since = new Date(now - NARRATIVE_DISCOVERY_WINDOW_MS).toISOString();
  const ids = new Set<string>();
  // Paged in a stable order (newest first) to the END of the window - never a silent row cap (05). If the page
  // limit is reached the result says so, and the caller reports it.
  for (let page = 0; page < NARRATIVE_DISCOVERY_MAX_PAGES; page++) {
    const from = page * NARRATIVE_DISCOVERY_PAGE;
    // cross-tenant: narrative-cron-company-discovery
    const { data, error } = await ownedDbTable('content_opportunities')
      .select('company_id')
      .gte('created_at', since)
      .not('company_id', 'is', null)
      .order('created_at', { ascending: false })
      .range(from, from + NARRATIVE_DISCOVERY_PAGE - 1);
    if (error) throw new Error(`narrative engine: company discovery failed (${error.message})`);
    const rows = (data ?? []) as Array<{ company_id: string | null }>;
    for (const r of rows) if (typeof r.company_id === 'string' && r.company_id.length > 0) ids.add(r.company_id);
    if (rows.length < NARRATIVE_DISCOVERY_PAGE) return { companyIds: [...ids], truncated: false };
  }
  return { companyIds: [...ids], truncated: true };
}

export async function runNarrativeEngine() {
  // Checked FIRST: while off, nothing is read or written (fail closed: only the exact string 'true' enables it).
  if (process.env[NARRATIVE_ENGINE_FLAG] !== 'true') {
    return { skipped: true as const, reason: 'narrative_engine_flag_off' };
  }
  const { companyIds, truncated } = await discoverNarrativeWorkCompanies();

  const total = { opportunities_processed: 0, narratives_created: 0, narratives_skipped: 0, companies_processed: companyIds.length, errors: [] as string[] };
  if (truncated) {
    total.errors.push(`company discovery hit ${NARRATIVE_DISCOVERY_MAX_PAGES * NARRATIVE_DISCOVERY_PAGE} rows; the oldest companies in the window were not reached this run`);
  }
  if (companyIds.length === 0) return total;

  const preloadedGlobal = await getGlobalConfig('narrative_engine');
  const results = await mapWithConcurrency(
    companyIds,
    getSchedulerConcurrency(),
    (companyId) => runWithConfig(
      'narrative_engine',
      companyId,
      () => generateCampaignNarratives(systemTenantContext(companyId, 'narrative engine cron: this company\'s opportunities')),
      'scheduler',
      preloadedGlobal,
    ),
  );
  for (let i = 0; i < results.length; i++) {
    const slot = results[i];
    if (!slot.ok || slot.value === undefined) {
      total.errors.push(`company ${companyIds[i]}: ${slot.error?.message ?? 'unknown error'}`);
      continue;
    }
    const r = slot.value;
    if ('skipped' in r) continue;
    total.opportunities_processed += r.opportunities_processed;
    total.narratives_created += r.narratives_created;
    total.narratives_skipped += r.narratives_skipped;
  }
  return total;
}

/**
 * Run community post engine: convert campaign narratives into platform-ready posts.
 * Call every 3 hours (e.g. from cron).
 */
export async function runCommunityPostEngine() {
  return runWithConfig('community_posts', null, () => generateCommunityPosts());
}

/**
 * Run thread engine: convert community posts into multi-part threads.
 * Call every 3 hours (e.g. from cron).
 */
export async function runThreadEngine() {
  return runWithConfig('thread_engine', null, () => generateCommunityThreads());
}

/**
 * Run engagement capture: capture metrics from platform APIs into engagement_signals.
 * Call every 30 minutes (e.g. from cron).
 */
export async function runEngagementCapture() {
  return runWithConfig('engagement_capture', null, () => captureEngagementSignals());
}

/**
 * Run feedback intelligence engine: analyze engagement and generate insights.
 * Call every 6 hours (e.g. from cron).
 */
export async function runFeedbackIntelligenceEngine() {
  return runWithConfig(
    'feedback_intelligence',
    null,
    () => runInBackgroundJobContext('scheduler.feedbackIntelligence', () => generateFeedbackInsights())
  );
}

/**
 * Run company trend relevance: score theme relevance per company (industry, keywords, competitors).
 * Call every 6 hours (e.g. from cron).
 *
 * Per-company job: checks resolved config (global + company override) for each company.
 */
export async function runCompanyTrendRelevance(): Promise<{
  companies_processed: number;
  total_themes_scored: number;
  errors: string[];
}> {
  const { data: companies, error } = await ownedDbTable('companies')
    .select('id')
    .eq('status', 'active');

  if (error || !companies?.length) {
    return { companies_processed: 0, total_themes_scored: 0, errors: error ? [error.message] : [] };
  }

  // HARDEN-004: (a) the global config and the theme set are company-
  // independent — load each ONCE instead of once per company; (b) per-company
  // work is independent, so run it with bounded concurrency instead of
  // strictly sequentially. Results are aggregated IN INPUT ORDER
  // (mapWithConcurrency guarantees slot order), so totals and the errors
  // array are identical to the sequential run.
  const [preloadedGlobal, preloadedThemes] = await Promise.all([
    getGlobalConfig('trend_relevance'),
    import('../services/companyTrendRelevanceEngine').then((m) => m.loadThemesWithTopic()),
  ]);

  let totalThemesScored = 0;
  const errors: string[] = [];

  const results = await mapWithConcurrency(
    companies as { id: string }[],
    getSchedulerConcurrency(),
    (row) => runWithConfig(
      'trend_relevance',
      row.id,
      () => computeThemeRelevanceForCompany(row.id, preloadedThemes),
      'scheduler',
      preloadedGlobal,
    ),
  );

  for (let i = 0; i < results.length; i++) {
    const slot = results[i];
    if (!slot.ok || slot.value === undefined) {
      const row = (companies as { id: string }[])[i];
      errors.push(`company ${row.id}: ${slot.error?.message ?? 'unknown error'}`);
      continue;
    }
    const result = slot.value;
    if ('skipped' in result) continue;
    totalThemesScored += result.themes_scored;
    errors.push(...result.errors);
  }

  return {
    companies_processed: companies.length,
    total_themes_scored: totalThemesScored,
    errors,
  };
}

// ── Intelligence config-aware runner ──────────────────────────────────────────

/**
 * Wraps an intelligence runner with:
 * - Enabled check (global config + optional company override)
 * - Execution budget guard (daily_job_limit per company)
 * - Dynamic priority adjustment (new company → boost, inactive → deprioritise)
 * - Full execution logging to intelligence_execution_log
 *
 * Returns the runner result, or `{ skipped: true, reason }` if the job is skipped.
 */
async function runWithConfig<T>(
  jobType: string,
  companyId: string | null,
  runner: () => Promise<T>,
  triggeredBy = 'scheduler',
  // HARDEN-004: per-company batch runners preload the (jobType-constant)
  // global config ONCE instead of re-fetching it for every company.
  preloadedGlobal?: GlobalConfigRow | null,
): Promise<T | { skipped: true; reason: string }> {
  const global = preloadedGlobal !== undefined ? preloadedGlobal : await getGlobalConfig(jobType);
  if (!global) {
    console.warn(`[scheduler] ${jobType}: not found in intelligence_global_config — skipping`);
    return { skipped: true, reason: 'job_type_not_found' };
  }

  const override = companyId ? await getCompanyOverride(companyId, jobType) : null;
  const config   = resolveConfig(global, override);

  // ── 1. Enabled check ──────────────────────────────────────────────────────
  if (!config.enabled) {
    console.log(`[scheduler] ${jobType} disabled${companyId ? ` (${companyId})` : ''}`);
    await logSkipped(jobType, companyId, 'disabled', triggeredBy);
    try { recordScheduler({ job: jobType, durationMs: 0, outcome: 'skipped' }); } catch { /* fail-safe */ }
    return { skipped: true, reason: 'disabled' };
  }

  // ── 2. Execution budget guard (per-company only) ───────────────────────────
  if (companyId) {
    const dailyLimit = override?.daily_job_limit ?? global.daily_job_limit;
    const todayCount = await getDailyJobCount(companyId);
    if (todayCount >= dailyLimit) {
      console.log(`[scheduler] ${jobType} budget_exceeded for ${companyId} (${todayCount}/${dailyLimit} today)`);
      await logSkipped(jobType, companyId, 'budget_exceeded', triggeredBy);
      try { recordScheduler({ job: jobType, durationMs: 0, outcome: 'skipped' }); } catch { /* fail-safe */ }
      return { skipped: true, reason: 'budget_exceeded' };
    }
  }

  // ── 3. Dynamic priority adjustment ────────────────────────────────────────
  let effectivePriority = config.priority;
  if (companyId) {
    const adjustment = await getCompanyPriorityAdjustment(companyId);
    if (adjustment === 'new') {
      effectivePriority = Math.max(1, effectivePriority - 2);
      console.log(`[scheduler] ${jobType} priority boosted: ${config.priority}→${effectivePriority} (new company)`);
    } else if (adjustment === 'inactive') {
      effectivePriority = Math.min(10, effectivePriority + 3);
      console.log(`[scheduler] ${jobType} priority lowered: ${config.priority}→${effectivePriority} (inactive company)`);
    }
  }

  // ── 4. Execute with logging ────────────────────────────────────────────────
  const logId = await logExecutionStart(jobType, companyId, triggeredBy);
  // HARDEN-001: scheduler execution timing (fail-safe; no behavior change).
  const _obsStart = Date.now();
  try {
    const result = await runner();
    await logExecutionEnd(logId, 'completed', {
      ...(result as Record<string, unknown>),
      effective_priority: effectivePriority,
    });
    try { recordScheduler({ job: jobType, durationMs: Date.now() - _obsStart, outcome: 'completed' }); } catch { /* fail-safe */ }
    return result;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await logExecutionEnd(logId, 'failed', { effective_priority: effectivePriority }, msg);
    try { recordScheduler({ job: jobType, durationMs: Date.now() - _obsStart, outcome: 'failed' }); } catch { /* fail-safe */ }
    throw err;
  }
}

/** Default platforms/regions for scheduled lead detection (07:00, 18:00). */
const SCHEDULED_LEAD_PLATFORMS = ['reddit', 'linkedin', 'twitter'];
const SCHEDULED_LEAD_REGIONS = ['GLOBAL'];

/**
 * Enqueue lead detection jobs for all companies with profiles.
 * Called by cron at 07:00 and 18:00.
 */
export async function enqueueScheduledLeadDetection(): Promise<{ enqueued: number; errors: string[] }> {
  const { jobQueue } = await import('../queue/jobQueue');
  const { recordLeadQueueEnqueue } = await import('../queue/leadQueueObservability');
  const { data: companies, error } = await ownedDbTable('company_profiles')
    .select('company_id')
    .not('company_id', 'is', null);
  if (error) {
    return { enqueued: 0, errors: [`Failed to load companies: ${error.message}`] };
  }
  const allIds     = (companies ?? []).map((r: { company_id: string }) => r.company_id).filter(Boolean);
  const companyIds = allIds.length > 500 ? allIds.slice(0, 500) : allIds;
  if (companyIds.length === 0) return { enqueued: 0, errors: [] };

  const errors: string[] = [];
  let enqueued = 0;

  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // ── HARDEN-004: the per-company 24h throttle used to be a COUNT query per
  // company (≤500 sequential round-trips). One .in() read + in-memory counting
  // applies the identical `>= 2 → skip` rule.
  const recentCountByCompany = new Map<string, number>();
  try {
    const { data: recentRows, error: recentError } = await ownedDbTable('lead_jobs_v1')
      .select('company_id')
      .in('company_id', companyIds)
      .gt('created_at', twentyFourHoursAgo);
    if (recentError) throw new Error(recentError.message);
    for (const r of (recentRows ?? []) as { company_id: string }[]) {
      recentCountByCompany.set(r.company_id, (recentCountByCompany.get(r.company_id) ?? 0) + 1);
    }
  } catch (countErr: any) {
    // Old behavior on a failing count was per-company error entries; a failing
    // batched count is equivalent to all counts failing.
    return { enqueued: 0, errors: companyIds.map((id) => `${id}: ${countErr?.message ?? String(countErr)}`) };
  }

  const eligibleCompanyIds = companyIds.filter((id) => (recentCountByCompany.get(id) ?? 0) < 2);
  if (eligibleCompanyIds.length === 0) return { enqueued: 0, errors };

  const rowFor = (companyId: string) => ({
    company_id: companyId,
    platforms: SCHEDULED_LEAD_PLATFORMS,
    regions: SCHEDULED_LEAD_REGIONS,
    keywords: null,
    mode: 'REACTIVE',
    status: 'PENDING',
    total_found: 0,
    total_qualified: 0,
    context_payload: { scheduled_run: true },
  });

  // ── HARDEN-004: bulk insert + addBulk (was insert + queue.add per company).
  // jobIds stay `lead-detection:<row id>`. On any bulk failure fall back to the
  // original per-company loop for identical partial-failure semantics.
  let bulkDone = false;
  try {
    const { data: jobs, error: insertError } = await ownedDbTable('lead_jobs_v1')
      .insert(eligibleCompanyIds.map(rowFor))
      .select('id, company_id');
    if (insertError || !jobs || jobs.length !== eligibleCompanyIds.length) {
      throw new Error(insertError?.message ?? 'bulk insert row count mismatch');
    }
    const enqueueStartedAt = Date.now();
    await jobQueue.addBulk(
      (jobs as { id: string }[]).map((job) => ({
        name: 'lead-job',
        data: { type: 'LEAD', jobId: job.id },
        opts: { jobId: `lead-detection:${job.id}` },
      }))
    );
    const perJobMs = Math.round((Date.now() - enqueueStartedAt) / jobs.length);
    for (let i = 0; i < jobs.length; i++) recordLeadQueueEnqueue(perJobMs);
    enqueued = jobs.length;
    bulkDone = true;
  } catch (bulkErr: any) {
    console.warn('[enqueueScheduledLeadDetection] bulk path failed — falling back to per-company', bulkErr?.message);
  }

  if (!bulkDone) {
    for (const companyId of eligibleCompanyIds) {
      try {
        const { data: job, error: insertError } = await ownedDbTable('lead_jobs_v1')
          .insert(rowFor(companyId))
          .select('id')
          .single();
        if (insertError || !job) {
          errors.push(`${companyId}: ${(insertError as Error)?.message ?? 'insert failed'}`);
          continue;
        }
        const enqueueStartedAt = Date.now();
        const queued = await safeEnqueue(jobQueue, 'engine-jobs', 'lead-job', { type: 'LEAD', jobId: job.id }, { jobId: `lead-detection:${job.id}` });
        recordLeadQueueEnqueue(Date.now() - enqueueStartedAt);
        // Shed by backpressure — do NOT count it as enqueued. The lead job row
        // is untouched, so the next scheduler tick retries it.
        if (!queued) continue;
        enqueued++;
      } catch (e: any) {
        errors.push(`${companyId}: ${e?.message ?? String(e)}`);
      }
    }
  }
  return { enqueued, errors };
}
