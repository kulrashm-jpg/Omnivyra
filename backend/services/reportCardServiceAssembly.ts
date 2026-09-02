/** Report card — assembly, persistence, entrypoints — split from reportCardService.ts (barrel preserved; importers unchanged). */
import { ownedDbTable } from '../db/writeOwner';
/**
 * Report Card Service
 *
 * Backend truth for free-report eligibility, in-progress protection,
 * and report status transitions.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  LIFECYCLE OWNERSHIP — DO NOT BYPASS
 * ─────────────────────────────────────────────────────────────────────────
 *  The following columns of `public.reports` are owned by this service and
 *  the requeue helper at pages/api/reports/[reportId].ts:requeueIncompleteReport.
 *  Direct UPDATE/INSERT against them from elsewhere is a regression:
 *
 *    status, error_message, completed_at, started_at,
 *    last_heartbeat_at, attempt_count
 *
 *  Approved entry points only:
 *    createReport / createFreeReport / createPaidReport  — initial INSERT
 *    updateReportStatus                                  — terminal transitions
 *    updateReportHeartbeat                               — keepalive ticks
 *    recoverStaleGeneratingReports                       — cron reaper
 *    requeueIncompleteReport (in [reportId].ts)          — operator requeue
 *
 *  Invariants enforced by these functions:
 *    - status transitions are monotonic on the success path
 *      (generating → completed gated by .eq('status','generating'))
 *    - heartbeat writes are no-ops on terminal rows
 *    - recovery touches only `generating` rows that have missed both
 *      the heartbeat threshold AND the legacy timeout fallback
 *    - one in-flight generation per (company_id, domain) — DB-enforced
 *      by partial unique index `unique_generating_report_per_company_domain`
 *    - retry containment with cooldown decay (deriveNextAttemptCount)
 *
 *  If you need to write to these columns from new code: extend one of the
 *  approved functions or open a discussion. Do not add a fresh
 *  `ownedDbTable('reports').update({ status: ... })` call in a new file.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { supabase } from '../db/supabaseClient';
import {
  persistAnalyticsReportInputs,
  resolveAnalyticsReportInput,
} from './analyticsInputResolver';
import { extractDomain } from './companyMatchService';
import { getUserRole, Role } from './rbacService';
import {
  confirmCreditReservation,
  confirmCreditReservationToActual,
  releaseCreditReservation,
  type CreditReservationHandle,
} from './creditExecutionService';
import { getCreditEconomyExecutionMode } from './billing/creditEconomyActivation';
import { runWithUsageCollection, type CollectedUsage } from './aiUsageCollector';
import {
  type ReportRequestPayload,
  type ResolvedReportCategory,
  type ResolvedReportInput,
} from './reportInputResolver';
import { evaluateResolvedReportReadiness } from './reportReadinessService';
import {
  persistSnapshotReportInputs,
  resolveSnapshotReportInput,
} from './snapshotInputResolver';
import { hasPassedFinalCompetitorGate } from './competitorEngineService';
import {
  getReportChargingIdentity,
  resolveMonetizationFeature,
} from '../../shared/monetization/featureRegistry';

import { type ReportStatus, type ReportCategory, type ReportRecord, REPORT_ENGINE_VERSION, REPORT_GENERATION_TIMEOUT_MINUTES, REPORT_HEARTBEAT_STALE_MINUTES, RECOVERY_BATCH_LIMIT, HEARTBEAT_INTERVAL_MS, assertCanonicalReportStatus, type ReportGenerationPayload, type ReportCreditReservationMetadata, mapReportTypeToCategory, ReportRequestError } from './reportCardServiceModel';

function mapRequestedCategory(input: unknown, fallback: ReportCategory): ReportCategory {
  return input === 'performance' || input === 'growth' || input === 'snapshot'
    ? input
    : fallback;
}

function getReportCreditReservation(report: ReportRecord): ReportCreditReservationMetadata | null {
  const metadata = (report.metadata || {}) as Record<string, unknown>;
  const reservation = metadata.credit_reservation;
  if (!reservation || typeof reservation !== 'object') return null;
  const candidate = reservation as Partial<ReportCreditReservationMetadata>;
  if (
    !candidate.holdTransactionId ||
    !candidate.idempotencyKey ||
    !candidate.action ||
    !candidate.orgId ||
    !candidate.userId ||
    !candidate.referenceType ||
    !candidate.referenceId ||
    !candidate.split
  ) {
    return null;
  }
  return candidate as ReportCreditReservationMetadata;
}

async function confirmReportCreditReservation(report: ReportRecord, payload: ReportGenerationPayload, actualUsage?: CollectedUsage): Promise<Awaited<ReturnType<typeof confirmCreditReservation>> | null> {
  const reservation = getReportCreditReservation(report);
  if (!reservation) return null;
  const usageSummary = {
    report_id: report.id,
    report_type: report.report_type,
    generated_at: payload.generated_at,
    engine_version: payload.engine_version,
    has_composed_report: !!payload.composed_report,
  };

  // Phase 10F — token-actual settlement when enabled (PHASE2_ENTRY_CONSUMPTION,
  // default OFF → flat confirm below, byte-identical). The report HOLD is settled
  // against the ACTUAL tokens collected during generation via the shared
  // partial-confirm primitive (releasing the unused remainder). Any pricing
  // failure (e.g. unknown model) falls back to the flat confirm — never blocks.
  const ecMode = await getCreditEconomyExecutionMode({ organizationId: reservation.orgId, surface: 'route.reports-generate' });
  if (ecMode === 'enforce' && actualUsage && (actualUsage.inputTokens > 0 || actualUsage.outputTokens > 0)) {
    try {
      const { resolveLlmCost } = await import('./pricingService');
      const cost = await resolveLlmCost({
        provider:     'openai',
        model:        process.env.OPENAI_MODEL || 'gpt-4o-mini',
        inputTokens:  actualUsage.inputTokens,
        outputTokens: actualUsage.outputTokens,
        actionKey:    reservation.action,
        orgId:        reservation.orgId,
      });
      return await confirmCreditReservationToActual(
        { ...reservation, referenceId: report.id, note: `${reservation.feature_key} report (token-actual)` },
        Math.max(0, cost.credits),
      );
    } catch (err) {
      console.warn('[reportCardService] token-actual settlement failed; flat-confirm fallback:', err instanceof Error ? err.message : err);
      // fall through to the flat confirm below
    }
  }

  return confirmCreditReservation({
    ...reservation,
    referenceId: report.id,
    note: `${reservation.feature_key} report generation completed`,
    usage_context: {
      ...(reservation.usage_context ?? {}),
      usage_summary: usageSummary,
    },
  } as ReportCreditReservationMetadata);
}

async function releaseReportCreditReservation(report: ReportRecord, reason: string): Promise<void> {
  const reservation = getReportCreditReservation(report);
  if (!reservation) return;
  const result = await releaseCreditReservation({
    ...reservation,
    referenceId: report.id,
    note: `${reservation.feature_key} report generation failed: ${reason.slice(0, 120)}`,
  });
  console.warn('[reportCardService] report credit reservation released', {
    reportId: report.id,
    holdTransactionId: reservation.holdTransactionId,
    result: result.status,
    reason,
  });
}

function toResolvedReportCategory(category: ReportCategory): ResolvedReportCategory {
  return category;
}

async function resolveInputForReportCategory(params: {
  companyId: string;
  reportCategory: ReportCategory;
  requestPayload?: ReportRequestPayload | null;
}): Promise<ResolvedReportInput> {
  if (params.reportCategory === 'snapshot') {
    return resolveSnapshotReportInput({
      companyId: params.companyId,
      requestPayload: params.requestPayload,
    });
  }

  return resolveAnalyticsReportInput({
    companyId: params.companyId,
    reportCategory: params.reportCategory,
    requestPayload: params.requestPayload,
  });
}

async function persistInputsForReportCategory(
  reportCategory: ReportCategory,
  resolvedInput: ResolvedReportInput,
): Promise<void> {
  if (reportCategory === 'snapshot') {
    await persistSnapshotReportInputs(resolvedInput);
    return;
  }

  await persistAnalyticsReportInputs(resolvedInput);
}

function enrichComposedReportWithInputContext(params: {
  composedReport: Record<string, unknown> | undefined;
  resolvedInput: ResolvedReportInput;
  readiness: Awaited<ReturnType<typeof evaluateResolvedReportReadiness>>;
}): Record<string, unknown> | undefined {
  if (!params.composedReport) return undefined;

  const sections = Array.isArray(params.composedReport.sections)
    ? [...(params.composedReport.sections as Record<string, unknown>[])]
    : [];
  const safeCompetitorNames = (((params.composedReport.competitor_intelligence as Record<string, unknown> | undefined)?.detected_competitors ?? []) as Array<Record<string, unknown>>)
    .filter((item) => hasPassedFinalCompetitorGate(item as any))
    .map((item) => String(item.name ?? item.domain ?? '').trim())
    .filter(Boolean)
    .slice(0, 5);

  sections.unshift({
    section_name: 'Request Context',
    insights: [
      {
        title: params.resolvedInput.resolved.companyName || 'Company context',
        description: `Business type: ${params.resolvedInput.resolved.businessType || 'unknown'} · Geography: ${params.resolvedInput.resolved.geography || 'unknown'}`,
        impact_score: 55,
        confidence_score: 1,
      },
      {
        title: `Data source: ${params.resolvedInput.resolved.source}`,
        description: `Validated competitors: ${safeCompetitorNames.join(', ') || 'none'} - Social links: ${params.resolvedInput.resolved.socialLinks.length}`,
        impact_score: 50,
        confidence_score: 1,
      },
    ],
    opportunities: params.readiness.missing_requirements.map((item) => ({
      title: item,
      recommendation: `Resolve this requirement to improve ${params.resolvedInput.reportCategory} report quality.`,
      confidence_score: 1,
    })),
    actions: [],
  });

  return {
    ...params.composedReport,
    sections,
    input_context: {
      defaults: params.resolvedInput.defaults,
      resolved: params.resolvedInput.resolved,
      integrations: params.resolvedInput.integrations,
      readiness: params.readiness,
    },
  };
}

/**
 * LIFECYCLE OWNER — sole entry point for transitioning `status`,
 * `completed_at`, and `error_message`.
 *
 * Invariants:
 *   - status MUST be a canonical ReportStatus (asserted at runtime).
 *   - `completed` transition is gated by `.eq('status','generating')` so a
 *     zombie/late completion silently no-ops on a row that has already
 *     terminated.
 *   - `completed` clears any stale `error_message` left by a prior reaper
 *     sweep, unless the caller explicitly passes `errorMessage`.
 *   - `failed` and `generating` transitions remain unconditional on `id`
 *     (the recovery cron and the heartbeat helper own their own
 *     preconditions; the unique partial index arbitrates concurrent inserts).
 *
 * DO NOT add a parallel update path that writes `status` / `error_message`
 * / `completed_at` from another module. Extend this function instead.
 */
export async function updateReportStatus(
  reportId: string,
  status: ReportStatus,
  updates?: {
    data?: Record<string, unknown>;
    errorMessage?: string | null;
  },
): Promise<void> {
  assertCanonicalReportStatus(status);
  if (status === 'completed' && updates?.errorMessage !== undefined && updates.errorMessage !== null) {
    console.warn(
      "[reportCardService] updateReportStatus called with status='completed' and a non-null errorMessage; explicit errorMessage will overwrite the auto-clear",
      { reportId },
    );
  }
  const now = new Date().toISOString();
  const payload: Record<string, unknown> = {
    status,
    updated_at: now,
  };

  if (status === 'completed') {
    payload.completed_at = now;
    // Clear stale failure metadata if a prior recovery sweep marked this
    // row as failed before the original generation finished. An explicit
    // `errorMessage` in `updates` (rare on the success path) still wins
    // because it is applied below.
    payload.error_message = null;
  }

  if (updates?.data) {
    payload.data = updates.data;
  }

  if (updates?.errorMessage !== undefined) {
    payload.error_message = updates.errorMessage;
  }

  // Optimistic lifecycle precondition: a successful completion may only
  // overwrite a row that is still in the `generating` state. This blocks
  // a zombie lambda from resurrecting a row the recovery cron (or any
  // other terminal transition) has already moved out of `generating`.
  // Any other status transition keeps its prior unconditional behavior.
  let query = ownedDbTable('reports').update(payload).eq('id', reportId);
  if (status === 'completed') {
    query = query.eq('status', 'generating');
  }
  const { error } = await query;

  if (error) {
    throw new ReportRequestError('Failed to update report status', 'REPORT_UPDATE_FAILED', 500);
  }
}

export async function generateReportPayload(
  report: ReportRecord,
): Promise<ReportGenerationPayload> {
  const { runCompanyBlogIntelligence } = await import(
    '../../lib/blog/companyBlogIntelligenceService'
  );

  const metadata = (report.metadata || {}) as Record<string, unknown>;
  const requestedCategoryRaw = metadata.requested_report_category;
  const requestedCategory: ReportCategory =
    mapRequestedCategory(requestedCategoryRaw, mapReportTypeToCategory(report.report_type));
  const requestPayload = (metadata.request_payload ?? null) as ReportRequestPayload | null;
  const resolvedInput = await resolveInputForReportCategory({
    companyId: report.company_id,
    reportCategory: toResolvedReportCategory(requestedCategory),
    requestPayload,
  });
  const readiness = await evaluateResolvedReportReadiness(resolvedInput);

  await persistInputsForReportCategory(requestedCategory, resolvedInput);

  // Phase 1A — ensure the snapshot report actually has website evidence to read.
  //
  // Every deterministic engine (technical / content / accessibility / brand) and the
  // public-domain audit read `canonical_pages`. Nothing on the report path ever
  // populated it, so reports composed against empty tables and abstained on
  // everything. This reuses the EXISTING crawler and the EXISTING refresh-policy
  // cooldown: fresh evidence is reused, absent or stale evidence is (re)crawled.
  //
  // Snapshot only — growth/performance reports read connected analytics sources, not
  // the crawl. Never throws: a crawl failure leaves the report to abstain honestly.
  if (requestedCategory === 'snapshot') {
    const { ensureReportCrawlEvidence } = await import('./crawl/reportCrawlEvidenceService');
    const crawlEvidence = await ensureReportCrawlEvidence({
      companyId: report.company_id,
      websiteDomain: resolvedInput.resolved.websiteDomain ?? report.domain ?? null,
    });
    console.info('[reportCardService] report_crawl_evidence', {
      reportId: report.id,
      companyId: report.company_id,
      action: crawlEvidence.action,
      pagesBefore: crawlEvidence.pagesBefore,
      pagesAfter: crawlEvidence.pagesAfter,
      durationMs: crawlEvidence.durationMs,
      reason: crawlEvidence.reason,
      error: crawlEvidence.error,
    });
  }

  const intelligence = await runCompanyBlogIntelligence(report.company_id);

  let composed_report: Record<string, unknown> | undefined;
  try {
    if (requestedCategory === 'growth') {
      const { composeGrowthReport } = await import('./growthReportService');
      composed_report = await composeGrowthReport(report.company_id, { resolvedInput }) as unknown as Record<string, unknown>;
    } else if (requestedCategory === 'performance') {
      const { composePerformanceIntelligenceReport } = await import('./performanceReportService');
      composed_report = await composePerformanceIntelligenceReport(report.company_id, { resolvedInput }) as unknown as Record<string, unknown>;
    } else {
      const { composeSnapshotReport } = await import('./snapshotReportService');
      composed_report = await composeSnapshotReport(report.company_id, {
        resolvedInput,
        readiness,
      }) as unknown as Record<string, unknown>;
    }
  } catch (composeError) {
    console.warn('[reportCardService] composed report generation failed:', composeError);
    if (requestedCategory === 'performance') {
      throw new ReportRequestError(
        composeError instanceof Error
          ? composeError.message
          : 'Performance report composition failed',
        'PERFORMANCE_COMPOSE_FAILED',
        500,
      );
    }
  }

  return {
    generated_at: new Date().toISOString(),
    engine_version: REPORT_ENGINE_VERSION,
    report_id: report.id,
    domain: report.domain,
    report_type: report.report_type,
    requested_category: requestedCategory,
    intelligence: intelligence as unknown as Record<string, unknown>,
    composed_report: enrichComposedReportWithInputContext({
      composedReport: composed_report,
      resolvedInput,
      readiness,
    }),
  };
}

/**
 * LIFECYCLE OWNER — sole entry point for writing `last_heartbeat_at`.
 *
 * Invariants:
 *   - The `.eq('status','generating')` predicate makes heartbeat writes
 *     silent no-ops on terminal rows. A heartbeat MUST NEVER revive a
 *     `failed` or `completed` row.
 *   - Tick failures are recoverable (the reaper takes over after the
 *     stale threshold) — never throw from a heartbeat tick site.
 *
 * DO NOT call ownedDbTable('reports').update({ last_heartbeat_at: ... })
 * from anywhere else. Use this function.
 */
export async function updateReportHeartbeat(reportId: string): Promise<void> {
  const { error } = await ownedDbTable('reports')
    .update({ last_heartbeat_at: new Date().toISOString() })
    .eq('id', reportId)
    .eq('status', 'generating');
  if (error) {
    throw new ReportRequestError(
      'Failed to update report heartbeat',
      'REPORT_HEARTBEAT_FAILED',
      500,
    );
  }
}

/**
 * Phase 1: starts a periodic heartbeat for `reportId` and returns a stop
 * function. Tick failures are logged but never throw — heartbeat loss is
 * recoverable via the cron reaper rather than fatal to generation.
 */
function startReportHeartbeat(reportId: string): () => void {
  const tick = () => {
    void updateReportHeartbeat(reportId).catch((err) => {
      console.warn(
        '[reportCardService] heartbeat tick failed for report',
        reportId,
        err instanceof Error ? err.message : err,
      );
    });
  };
  // One immediate tick so a freshly-inserted row's heartbeat advances even
  // if the lambda is killed before the first interval fires.
  tick();
  const handle = setInterval(tick, HEARTBEAT_INTERVAL_MS);
  return () => clearInterval(handle);
}

/**
 * Phase 3: returns the lifecycle Promise instead of detaching it.
 *
 * The previous `void (async()=>{})()` pattern was unsafe on Vercel: once the
 * HTTP response was flushed the lambda froze, often killing the closure
 * mid-flight and leaving rows pinned at `status='generating'` forever.
 *
 * Callers MUST do one of the following with the returned Promise:
 *   1. `await` it before responding (blocks the request for full generation)
 *   2. Hand it to a platform keep-alive primitive (e.g. Vercel's `waitUntil`)
 *      so the runtime keeps the function warm past response flush.
 *
 * The Promise resolves when the lifecycle terminates (completed OR failed);
 * it never rejects — all errors are caught internally and persisted as a
 * `status='failed'` row. The reaper at /api/cron/recover-stale-reports is
 * the safety net for the worst case where neither (1) nor (2) succeeds.
 */
export function startAsyncReportGeneration(report: ReportRecord): Promise<void> {
  return (async () => {
    // Phase 1: keep last_heartbeat_at fresh while generation is in flight
    // so the recovery cron does not falsely fail a healthy long-running
    // run. The interval is cleared in the outer `finally` regardless of
    // success/failure path.
    const stopHeartbeat = startReportHeartbeat(report.id);
    try {
    let payload: ReportGenerationPayload;
    // Phase 10F — actual token usage produced during report generation, collected
    // via the shared AsyncLocalStorage collector so it reaches token-actual
    // settlement. Default 0 (and ignored) when the entry-consumption flag is off.
    let reportUsage: CollectedUsage = { inputTokens: 0, outputTokens: 0, assetCredits: 0 };

    // Task 2: isolate generateReportPayload so its failure is always captured.
    try {
      const collected = await runWithUsageCollection(() => generateReportPayload(report));
      payload = collected.result;
      reportUsage = collected.usage;
    } catch (error) {
      const error_reason =
        error instanceof Error ? error.message : 'Intelligence engine failed';
      console.error('[reportCardService] generateReportPayload failed:', error_reason);
      await releaseReportCreditReservation(report, error_reason).catch((releaseError) => {
        console.error('[reportCardService] failed to release report credit reservation:', releaseError);
      });
      try {
        await updateReportStatus(report.id, 'failed', {
          errorMessage: error_reason,
          data: { error_reason, failed_at: new Date().toISOString() },
        });
      } catch (updateError) {
        console.error('[reportCardService] failed to mark report as failed:', updateError);
      }
      return;
    }

    let reportCreditConfirmed = false;
    try {
      const metadata = (report.metadata || {}) as Record<string, unknown>;
      const requestedType = metadata.requested_type;
      const requestedCategory = mapRequestedCategory(
        metadata.requested_report_category,
        mapReportTypeToCategory(report.report_type),
      );
      const chargingIdentity = getReportChargingIdentity({
        requested_type: requestedType === 'premium' ? 'premium' : 'free',
        report_category: requestedCategory,
        report_type: report.report_type,
        usage_context: {
          report_id: report.id,
          company_id: report.company_id,
          user_id: report.user_id,
        },
      });

      await updateReportStatus(report.id, 'completed', {
        data: {
          ...(payload as unknown as Record<string, unknown>),
          monetization: {
            feature_key: chargingIdentity.feature_key,
            pricing_key: chargingIdentity.pricing_key,
            action_key: chargingIdentity.action_key,
            plan_tier: chargingIdentity.plan_tier,
            usage_context: chargingIdentity.usage_context,
          },
        },
      });

      if (requestedType === 'premium') {
        const settlement = await confirmReportCreditReservation(report, payload, reportUsage);
        if (!settlement || settlement.status === 'already_released') {
          throw new Error(
            settlement?.status === 'already_released'
              ? 'Report credit reservation was already released before completion'
              : 'Paid report is missing a credit reservation',
          );
        }
        reportCreditConfirmed = settlement.status === 'confirmed' || settlement.status === 'already_confirmed';
      }

      if (requestedCategory === 'snapshot') {
        const { handleSnapshotReportCompleted } = await import('./reportAutomationService');
        await handleSnapshotReportCompleted({
          reportId: report.id,
          companyId: report.company_id,
          domain: report.domain,
          data: payload as unknown as Record<string, unknown>,
        }).catch((automationError) => {
          console.error('[reportCardService] snapshot automation hook failed:', automationError);
        });
      }

      const { syncFeatureCompletionAsync } = await import('./featureCompletionEventTriggers');
      await syncFeatureCompletionAsync(report.company_id).catch((syncError) => {
        console.error('[reportCardService] feature sync failed:', syncError);
      });
    } catch (error) {
      console.error('[reportCardService] failed to persist completed report:', error);
      if (!reportCreditConfirmed) {
        await releaseReportCreditReservation(
          report,
          error instanceof Error ? error.message : 'Failed to persist completed report',
        ).catch((releaseError) => {
          console.error('[reportCardService] failed to release report credit reservation:', releaseError);
        });
      }
      try {
        await updateReportStatus(report.id, 'failed', {
          errorMessage:
            error instanceof Error
              ? error.message
              : 'Failed to persist completed report',
          data: {
            error_reason:
              error instanceof Error
                ? error.message
                : 'Failed to persist completed report',
            failed_at: new Date().toISOString(),
          },
        });
      } catch (updateError) {
        console.error('[reportCardService] failed to mark persistence failure on report:', updateError);
      }
    }
    } finally {
      stopHeartbeat();
    }
  })();
}

export interface StaleReportRecoveryResult {
  scanned: number;
  recovered: number;
  recoveredIds: string[];
  cutoffIso: string;
  timeoutMinutes: number;
}

/**
 * PostgREST OR-filter that matches stale generating rows under the new
 * heartbeat-aware semantics:
 *   - last_heartbeat_at < heartbeatCutoff (primary signal), OR
 *   - last_heartbeat_at IS NULL AND started_at < timeoutCutoff (legacy
 *     row that pre-dates the heartbeat column), OR
 *   - last_heartbeat_at IS NULL AND started_at IS NULL AND created_at <
 *     timeoutCutoff (oldest legacy rows).
 */
function buildStaleFilter(heartbeatCutoff: string, timeoutCutoff: string): string {
  return (
    `last_heartbeat_at.lt.${heartbeatCutoff},` +
    `and(last_heartbeat_at.is.null,started_at.lt.${timeoutCutoff}),` +
    `and(last_heartbeat_at.is.null,started_at.is.null,created_at.lt.${timeoutCutoff})`
  );
}

/**
 * LIFECYCLE OWNER — sole authority for transitioning `generating` rows to
 * `failed` for missed-heartbeat / timeout reasons.
 *
 * Invariants:
 *   - SELECT-then-UPDATE pattern with re-checked `.eq('status','generating')`
 *     so a row that completes between the two statements is naturally
 *     skipped. NEVER touches non-`generating` rows.
 *   - Bounded by RECOVERY_BATCH_LIMIT — a backlog drains across multiple
 *     cron ticks rather than risking a single huge UPDATE.
 *   - Oldest-first ordering on `(last_heartbeat_at NULLS FIRST, started_at
 *     NULLS FIRST)` for deterministic drain order.
 *   - Idempotent: a second invocation against the already-cleaned set is a
 *     zero-row no-op.
 *
 * DO NOT add a separate path that flips `generating` rows to `failed` for
 * the same reason. The recovery cron + this function are the canonical
 * timeout transition.
 *
 * Phases 2 + 3: Reap reports that are stuck in `status='generating'`. A row
 * is considered stale when its heartbeat is older than
 * REPORT_HEARTBEAT_STALE_MINUTES, or (for rows with no heartbeat) when its
 * start time exceeds the legacy REPORT_GENERATION_TIMEOUT_MINUTES.
 */
export async function recoverStaleGeneratingReports(
  timeoutMinutes: number = REPORT_GENERATION_TIMEOUT_MINUTES,
  heartbeatStaleMinutes: number = REPORT_HEARTBEAT_STALE_MINUTES,
  batchLimit: number = RECOVERY_BATCH_LIMIT,
): Promise<StaleReportRecoveryResult> {
  const heartbeatCutoff = new Date(Date.now() - heartbeatStaleMinutes * 60_000).toISOString();
  const timeoutCutoff = new Date(Date.now() - timeoutMinutes * 60_000).toISOString();
  const nowIso = new Date().toISOString();

  // Two-step: SELECT a bounded oldest-first batch of candidate ids, then
  // UPDATE only those ids re-checking status='generating'. The partial
  // index `idx_reports_generating_liveness` supports the SELECT's ORDER BY.
  const { data: candidates, error: selectErr } = await ownedDbTable('reports')
    .select('*')
    .eq('status', 'generating')
    .or(buildStaleFilter(heartbeatCutoff, timeoutCutoff))
    .order('last_heartbeat_at', { ascending: true, nullsFirst: true })
    .order('started_at', { ascending: true, nullsFirst: true })
    .limit(batchLimit);

  if (selectErr) {
    throw new ReportRequestError(
      `Failed to scan stale reports: ${selectErr.message}`,
      'STALE_REPORT_RECOVERY_FAILED',
      500,
    );
  }

  const candidateRows = (candidates || []) as ReportRecord[];
  const candidateIds = candidateRows.map((r) => r.id);
  if (candidateIds.length === 0) {
    return { scanned: 0, recovered: 0, recoveredIds: [], cutoffIso: heartbeatCutoff, timeoutMinutes };
  }

  const { data: updated, error: updateErr } = await ownedDbTable('reports')
    .update({
      status: 'failed',
      error_message: 'Generation timeout recovery',
      updated_at: nowIso,
    })
    .in('id', candidateIds)
    .eq('status', 'generating') // re-check: a row may have completed between SELECT and UPDATE
    .select('id');

  if (updateErr) {
    throw new ReportRequestError(
      `Failed to recover stale reports: ${updateErr.message}`,
      'STALE_REPORT_RECOVERY_FAILED',
      500,
    );
  }

  const recoveredIds = ((updated || []) as Array<{ id: string }>).map((r) => r.id);
  const recoveredIdSet = new Set(recoveredIds);
  await Promise.all(
    candidateRows
      .filter((row) => recoveredIdSet.has(row.id))
      .map((row) =>
        releaseReportCreditReservation(row, 'Generation timeout recovery').catch((releaseError) => {
          console.error('[reportCardService] failed to release stale report reservation:', releaseError);
        }),
      ),
  );
  return {
    scanned: candidateIds.length,
    recovered: recoveredIds.length,
    recoveredIds,
    cutoffIso: heartbeatCutoff,
    timeoutMinutes,
  };
}

export async function listStaleGeneratingReports(
  timeoutMinutes: number = REPORT_GENERATION_TIMEOUT_MINUTES,
  heartbeatStaleMinutes: number = REPORT_HEARTBEAT_STALE_MINUTES,
  batchLimit: number = RECOVERY_BATCH_LIMIT,
): Promise<Array<{
  id: string;
  company_id: string;
  domain: string;
  started_at: string | null;
  created_at: string;
  last_heartbeat_at: string | null;
  attempt_count: number | null;
}>> {
  const heartbeatCutoff = new Date(Date.now() - heartbeatStaleMinutes * 60_000).toISOString();
  const timeoutCutoff = new Date(Date.now() - timeoutMinutes * 60_000).toISOString();
  const { data, error } = await ownedDbTable('reports')
    .select('id, company_id, domain, started_at, created_at, last_heartbeat_at, attempt_count')
    .eq('status', 'generating')
    .or(buildStaleFilter(heartbeatCutoff, timeoutCutoff))
    .order('last_heartbeat_at', { ascending: true, nullsFirst: true })
    .order('started_at', { ascending: true, nullsFirst: true })
    .limit(batchLimit);

  if (error) {
    throw new ReportRequestError(
      `Failed to list stale reports: ${error.message}`,
      'STALE_REPORT_LIST_FAILED',
      500,
    );
  }

  return (data || []) as Array<{
    id: string;
    company_id: string;
    domain: string;
    started_at: string | null;
    created_at: string;
    last_heartbeat_at: string | null;
    attempt_count: number | null;
  }>;
}

