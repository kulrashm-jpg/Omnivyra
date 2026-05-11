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
  releaseCreditReservation,
  type CreditReservationHandle,
} from './creditExecutionService';
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

export type ReportStatus = 'generating' | 'completed' | 'failed';
export type ReportType = 'content_readiness' | 'competitor_analysis' | 'gap_analysis' | 'performance_intelligence';
export type ReportCategory = 'snapshot' | 'performance' | 'growth';
export type ReportCardAvailabilityState = 'free_available' | 'generating' | 'used';

export interface ReportRecord {
  id: string;
  company_id: string;
  user_id: string;
  domain: string;
  is_free: boolean;
  report_type: ReportType;
  status: ReportStatus;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  updated_at?: string | null;
  error_message?: string | null;
  data?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

export interface ReportCardContext {
  userRole: string;
  domain: string;
  companyId: string;
  hasReportGenerated?: boolean;
  hasFreeReportUsed?: boolean;
  hasGeneratingReport?: boolean;
}

export interface DomainReportState {
  domain: string;
  hasFreeReportUsed: boolean;
  hasGeneratingReport: boolean;
  reportState: ReportCardAvailabilityState;
}

export interface CompanyReportsResult extends DomainReportState {
  reports: ReportRecord[];
  canGenerateFreeReport: boolean;
  userRole: Role | null;
}

const REPORT_ENGINE_VERSION = 'v1' as const;
const RELAX_FREE_REPORT_LIMIT = true;

/**
 * Phase 2: single source of truth for the stale-generation timeout.
 * Any report stuck in `status='generating'` longer than this is reaped
 * by the recovery cron and demoted to `status='failed'`.
 *
 * Override at runtime via REPORT_GENERATION_TIMEOUT_MINUTES.
 */
export const REPORT_GENERATION_TIMEOUT_MINUTES: number = (() => {
  const raw = process.env.REPORT_GENERATION_TIMEOUT_MINUTES;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return 10;
})();

/**
 * Heartbeat-aware staleness threshold (Phase 1+2). The recovery cron treats
 * a generating row as stale when:
 *   - last_heartbeat_at exists AND is older than this threshold, OR
 *   - last_heartbeat_at is null AND started_at/created_at exceed the legacy
 *     REPORT_GENERATION_TIMEOUT_MINUTES (fallback for pre-migration rows).
 *
 * The default of 3 minutes safely exceeds the 60-second heartbeat tick so
 * a single missed beat does not falsely fail an active generation.
 */
export const REPORT_HEARTBEAT_STALE_MINUTES: number = (() => {
  const raw = process.env.REPORT_HEARTBEAT_STALE_MINUTES;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return 3;
})();

/**
 * Bounded recovery batch (Phase 3). The reaper processes at most this many
 * stale rows per invocation, oldest-first. Bounds DB lock pressure under
 * mass-failure scenarios; the next cron tick picks up any remainder.
 */
export const RECOVERY_BATCH_LIMIT: number = (() => {
  const raw = process.env.RECOVERY_BATCH_LIMIT;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return 100;
})();

/**
 * Retry containment ceiling (Phase 4). When the most recent attempt for a
 * (company_id, domain) ended in `failed` with an attempt_count at or above
 * this value, new generation requests are rejected with MAX_ATTEMPTS_EXCEEDED
 * — but only while the cooldown window (below) is still active.
 */
export const MAX_REPORT_GENERATION_ATTEMPTS: number = (() => {
  const raw = process.env.MAX_REPORT_GENERATION_ATTEMPTS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return 5;
})();

/**
 * Retry-decay cooldown window. Once a (company_id, domain) chain hits the
 * ceiling, subsequent generation requests are rejected for this many minutes
 * past the latest failure's `updated_at`. After the window expires, the
 * chain self-resets — the next attempt starts fresh at attempt_count = 1
 * with no operator intervention.
 *
 * Default of 60 minutes safely exceeds the worst-case 5-failure burst
 * cadence (each failure takes at least heartbeat-stale + reaper-tick to
 * land, so 5 rapid failures take ~25-50 minutes; the cooldown then gives
 * a real pause before the next chain may begin).
 */
export const REPORT_RETRY_COOLDOWN_MINUTES: number = (() => {
  const raw = process.env.REPORT_RETRY_COOLDOWN_MINUTES;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return 60;
})();

/** Heartbeat tick interval. Stays well under REPORT_HEARTBEAT_STALE_MINUTES. */
const HEARTBEAT_INTERVAL_MS = 60_000;

// ─── Lifecycle invariant assertions ─────────────────────────────────────────
// Lightweight runtime guards. Each assertion logs a warning and either
// no-ops or throws a typed ReportRequestError so callers fail loudly in dev
// without crashing production.

const CANONICAL_STATUSES: ReadonlyArray<ReportStatus> = ['generating', 'completed', 'failed'];

/**
 * Throws if `status` is not a canonical ReportStatus. TypeScript already
 * gates this at the type layer; the runtime guard catches dynamic callers
 * (JSON bodies, dynamic imports, etc.) before they corrupt the table.
 */
export function assertCanonicalReportStatus(status: string): asserts status is ReportStatus {
  if (!CANONICAL_STATUSES.includes(status as ReportStatus)) {
    throw new ReportRequestError(
      `Invalid report status '${status}'. Allowed: ${CANONICAL_STATUSES.join(', ')}`,
      'INVALID_REPORT_STATUS',
      500,
    );
  }
}

/**
 * Defensive guard for any new `reports`-table INSERT site that is NOT
 * createReport (e.g. reportPersistenceService.persistOrchestratedReport):
 * such paths must NEVER originate a `generating` row, because that would
 * bypass the dedupe pre-check and the partial unique index slot management.
 */
export function assertNotGeneratingOnInsert(payload: { status?: string | null }): void {
  if (payload?.status === 'generating') {
    throw new ReportRequestError(
      'Direct insert of status=generating is forbidden outside createReport. ' +
        'Route this through createReport so dedupe + retry containment apply.',
      'LIFECYCLE_BYPASS_FORBIDDEN',
      500,
    );
  }
}

type ReportGenerationPayload = {
  generated_at: string;
  engine_version: typeof REPORT_ENGINE_VERSION;
  report_id: string;
  domain: string;
  report_type: ReportType;
  requested_category: ReportCategory;
  /** Full blog intelligence snapshot — { posts, portfolio, gaps, graph } */
  intelligence: Record<string, unknown>;
  /** Category-specific composed report output for downstream use */
  composed_report?: Record<string, unknown>;
};

function mapCategoryToReportType(category: ReportCategory): ReportType {
  const resolution = resolveMonetizationFeature({ report_category: category });
  const reportType = resolution?.feature.report_type_mapping?.report_type;
  if (reportType) return reportType as ReportType;
  if (category === 'growth') return 'competitor_analysis';
  if (category === 'performance') return 'performance_intelligence';
  return 'content_readiness';
}

type ReportCreditReservationMetadata = CreditReservationHandle & {
  feature_key: string;
  pricing_key: string;
  plan_tier: string | null;
  usage_context: Record<string, unknown>;
  pricing_snapshot?: Record<string, unknown>;
  registry_snapshot?: Record<string, unknown>;
  generation_context?: Record<string, unknown>;
};

function mapReportTypeToCategory(reportType: ReportType): ReportCategory {
  if (reportType === 'competitor_analysis') return 'growth';
  if (reportType === 'gap_analysis' || reportType === 'performance_intelligence') return 'performance';
  return 'snapshot';
}

export class ReportRequestError extends Error {
  code: string;
  httpStatus: number;

  constructor(message: string, code: string, httpStatus = 400) {
    super(message);
    this.name = 'ReportRequestError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export function isCompanyAdmin(role: string | null | undefined): boolean {
  if (!role) return false;
  return role === Role.COMPANY_ADMIN || role === Role.SUPER_ADMIN;
}

export function canGenerateFreeReport(context: ReportCardContext): boolean {
  return (
    isCompanyAdmin(context.userRole) &&
    !context.hasFreeReportUsed &&
    !context.hasGeneratingReport
  );
}

export function getReportCardAvailabilityState(
  context: ReportCardContext,
): ReportCardAvailabilityState {
  if (context.hasGeneratingReport) return 'generating';
  if (context.hasFreeReportUsed) return 'used';
  return 'free_available';
}

export function getReportCTALabel(context: ReportCardContext): string {
  if (!isCompanyAdmin(context.userRole)) {
    return 'View Reports';
  }

  switch (getReportCardAvailabilityState(context)) {
    case 'generating':
      return 'Generating...';
    case 'used':
      return 'Upgrade to Generate Report';
    default:
      return 'Generate Free Report';
  }
}

export function getReportCTARoute(context: ReportCardContext): string {
  if (!isCompanyAdmin(context.userRole)) {
    return '/reports';
  }

  switch (getReportCardAvailabilityState(context)) {
    case 'used':
      return '/pricing?upgrade=reports';
    default:
      return '/reports/digital-authority-snapshot';
  }
}

export function getReportCardState(
  context: ReportCardContext,
): 'not_started' | 'in_progress' | 'ready' {
  if (context.hasGeneratingReport) return 'in_progress';
  if (context.hasReportGenerated || context.hasFreeReportUsed) return 'ready';
  return 'not_started';
}

export function normalizeReportDomain(input: string): string {
  const normalized = extractDomain(input);
  if (!normalized) {
    throw new ReportRequestError('A valid company domain is required', 'INVALID_DOMAIN', 400);
  }
  return normalized.toLowerCase();
}

async function getCompanyDomain(companyId: string): Promise<string> {
  const { data, error } = await ownedDbTable('companies')
    .select('website, website_domain')
    .eq('id', companyId)
    .maybeSingle();

  if (error) {
    throw new ReportRequestError('Failed to load company domain', 'COMPANY_LOOKUP_FAILED', 500);
  }

  const rawDomain =
    ((data as { website?: string | null; website_domain?: string | null } | null)?.website) ||
    ((data as { website?: string | null; website_domain?: string | null } | null)?.website_domain) ||
    '';

  return normalizeReportDomain(rawDomain);
}

export async function getDomainReportState(
  domain: string,
  companyId?: string,
): Promise<DomainReportState> {
  const normalizedDomain = normalizeReportDomain(domain);

  let query = ownedDbTable('reports')
    .select('is_free, status')
    .eq('domain', normalizedDomain);

  // Phase 1 fix: dedupe is scoped per (company_id, domain). A missing
  // companyId is preserved for legacy callers but logged so we can find them.
  if (companyId) {
    query = query.eq('company_id', companyId);
  } else {
    console.warn(
      '[reportCardService] getDomainReportState called without companyId; result is cross-tenant',
    );
  }

  const { data, error } = await query;

  if (error) {
    throw new ReportRequestError('Failed to load report state', 'REPORT_LOOKUP_FAILED', 500);
  }

  const rows = (data || []) as Array<{ is_free?: boolean | null; status?: string | null }>;
  const hasGeneratingReport = rows.some((row) => row.status === 'generating');
  const hasFreeReportUsed = rows.some((row) => row.is_free === true);

  return {
    domain: normalizedDomain,
    hasGeneratingReport,
    hasFreeReportUsed,
    reportState: hasGeneratingReport
      ? 'generating'
      : hasFreeReportUsed
        ? 'used'
        : 'free_available',
  };
}

export async function getCompanyReports(companyId: string): Promise<ReportRecord[]> {
  const { data, error } = await ownedDbTable('reports')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });

  if (error) {
    throw new ReportRequestError('Failed to load reports', 'REPORT_LIST_FAILED', 500);
  }

  return (data || []) as ReportRecord[];
}

export async function getCompanyReportsForCard(
  userId: string,
  companyId: string,
  domain?: string,
): Promise<CompanyReportsResult> {
  const resolvedDomain = domain ? normalizeReportDomain(domain) : await getCompanyDomain(companyId);
  const [reports, roleResult, domainState] = await Promise.all([
    getCompanyReports(companyId),
    getUserRole(userId, companyId),
    getDomainReportState(resolvedDomain, companyId),
  ]);

  return {
    ...domainState,
    reports,
    canGenerateFreeReport: canGenerateFreeReport({
      userRole: roleResult.role ?? '',
      domain: resolvedDomain,
      companyId,
      hasFreeReportUsed: domainState.hasFreeReportUsed,
      hasGeneratingReport: domainState.hasGeneratingReport,
      hasReportGenerated: reports.length > 0,
    }),
    userRole: roleResult.role,
  };
}

/**
 * Phase 4: chain-aware attempt counter. Looks at the most recent row for
 * (company_id, domain). If it is `failed` and at the ceiling, throws
 * MAX_ATTEMPTS_EXCEEDED. Otherwise returns the next attempt number.
 *
 * `generating` rows are not consulted — the domain-scoped pre-check in
 * createReport already rejects those with REPORT_IN_PROGRESS before this
 * function runs.
 */
/**
 * LIFECYCLE HELPER — exported for reuse by any path that needs to evaluate
 * the retry-containment + cooldown-decay rule before initiating a fresh
 * generation attempt for (companyId, domain). Returns the attempt_count
 * the new row should carry. Throws 429 MAX_ATTEMPTS_EXCEEDED inside the
 * cooldown window. DO NOT inline this calculation elsewhere.
 */
export async function deriveNextAttemptCount(
  companyId: string,
  domain: string,
): Promise<number> {
  const { data, error } = await ownedDbTable('reports')
    .select('status, attempt_count, updated_at, created_at')
    .eq('company_id', companyId)
    .eq('domain', domain)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new ReportRequestError(
      'Failed to evaluate retry ceiling',
      'REPORT_LOOKUP_FAILED',
      500,
    );
  }

  const row = (data || null) as {
    status?: string | null;
    attempt_count?: number | null;
    updated_at?: string | null;
    created_at?: string | null;
  } | null;
  if (!row || row.status !== 'failed') return 1;
  const prev = row.attempt_count ?? 1;
  if (prev < MAX_REPORT_GENERATION_ATTEMPTS) return prev + 1;

  // Phase 1 + 2: ceiling reached. Decide between cooldown-block and natural
  // reset based on how long since the latest failure landed.
  const lastFailureIso = row.updated_at ?? row.created_at ?? null;
  const lastFailureMs = lastFailureIso ? new Date(lastFailureIso).getTime() : 0;
  const cooldownExpiresAtMs = lastFailureMs + REPORT_RETRY_COOLDOWN_MINUTES * 60_000;
  if (Date.now() < cooldownExpiresAtMs) {
    const remainingMinutes = Math.max(
      1,
      Math.ceil((cooldownExpiresAtMs - Date.now()) / 60_000),
    );
    throw new ReportRequestError(
      `Generation temporarily blocked: ${MAX_REPORT_GENERATION_ATTEMPTS} consecutive failures for this domain. Retry available in ${remainingMinutes} minute${remainingMinutes === 1 ? '' : 's'}.`,
      'MAX_ATTEMPTS_EXCEEDED',
      429,
    );
  }
  // Cooldown expired → natural reset; next chain starts fresh.
  return 1;
}

function mapInsertConflict(errorMessage: string): ReportRequestError {
  const message = errorMessage.toLowerCase();
  if (message.includes('unique_free_report_per_domain')) {
    return new ReportRequestError(
      'Free report already used for this domain',
      'FREE_REPORT_LIMIT',
      409,
    );
  }
  if (
    message.includes('unique_generating_report_per_company_domain') ||
    message.includes('unique_generating_report_per_domain')
  ) {
    return new ReportRequestError(
      'Report already in progress',
      'REPORT_IN_PROGRESS',
      409,
    );
  }
  return new ReportRequestError(
    process.env.NODE_ENV !== 'production'
      ? `Failed to create report: ${errorMessage}`
      : 'Failed to create report',
    'REPORT_CREATE_FAILED',
    500,
  );
}

/**
 * LIFECYCLE OWNER — sole entry point for INSERTing a report into the
 * `generating` state.
 *
 * Invariants:
 *   - Pre-checks `getDomainReportState(domain, companyId)` to fail fast on
 *     any in-flight (company_id, domain) collision (DB partial unique index
 *     is the authoritative arbiter; the pre-check is an early-return
 *     optimisation).
 *   - Calls `deriveNextAttemptCount` to enforce the retry-ceiling +
 *     cooldown-decay contract; throws 429 MAX_ATTEMPTS_EXCEEDED inside the
 *     cooldown window and naturally resets to 1 once it expires.
 *   - Seeds `last_heartbeat_at = now` so the recovery reaper does not
 *     immediately reap a freshly-inserted row.
 *
 * DO NOT replicate this INSERT in another module. New entry points must
 * call this function (or createFreeReport / createPaidReport).
 */
async function createReport(
  userId: string,
  companyId: string,
  input: {
    domain?: string;
    isFree: boolean;
    reportType?: ReportType;
    metadata?: Record<string, unknown>;
  },
): Promise<ReportRecord> {
  const domain = input.domain ? normalizeReportDomain(input.domain) : await getCompanyDomain(companyId);
  const state = await getDomainReportState(domain, companyId);

  if (state.hasGeneratingReport) {
    throw new ReportRequestError('Report already in progress', 'REPORT_IN_PROGRESS', 409);
  }

  // Phase 4: retry containment. If the previous attempt for this
  // (company_id, domain) ended in `failed` with attempt_count at or above
  // the ceiling, refuse new attempts. The new row inherits attempt_count
  // = previous + 1 so the chain is monotonic.
  const nextAttemptCount = await deriveNextAttemptCount(companyId, domain);

  if (input.isFree) {
    const { role, error } = await getUserRole(userId, companyId);
    if (error || !isCompanyAdmin(role)) {
      throw new ReportRequestError(
        'Only Company Admins can generate free reports',
        'ADMIN_REQUIRED',
        403,
      );
    }

    if (!RELAX_FREE_REPORT_LIMIT && state.hasFreeReportUsed) {
      throw new ReportRequestError(
        'Free report already used for this domain',
        'FREE_REPORT_LIMIT',
        409,
      );
    }
  }

  const now = new Date().toISOString();
  const { data, error } = await ownedDbTable('reports')
    .insert({
      company_id: companyId,
      user_id: userId,
      domain,
      is_free: input.isFree,
      report_type: input.reportType || 'content_readiness',
      status: 'generating',
      started_at: now,
      last_heartbeat_at: now,
      attempt_count: nextAttemptCount,
      updated_at: now,
      metadata: {
        ...(input.metadata || {}),
        requested_at: now,
      },
    })
    .select('*')
    .single();

  if (error || !data) {
    throw error ? mapInsertConflict(error.message) : new ReportRequestError(
      process.env.NODE_ENV !== 'production'
        ? 'Failed to create report: insert returned no report row'
        : 'Failed to create report',
      'REPORT_CREATE_FAILED',
      500,
    );
  }

  return data as ReportRecord;
}

export async function createFreeReport(
  userId: string,
  companyId: string,
  domain?: string,
  options?: {
    reportCategory?: ReportCategory;
    requestPayload?: ReportRequestPayload;
    resolvedInput?: Record<string, unknown>;
    readiness?: Record<string, unknown>;
    creditReservation?: ReportCreditReservationMetadata;
  },
): Promise<ReportRecord> {
  const reportCategory = options?.reportCategory ?? 'snapshot';
  const chargingIdentity = getReportChargingIdentity({
    requested_type: 'free',
    report_category: reportCategory,
  });
  return createReport(userId, companyId, {
    domain,
    isFree: !RELAX_FREE_REPORT_LIMIT,
    reportType: mapCategoryToReportType(reportCategory),
    metadata: {
      requested_type: 'free',
      free_limit_relaxed: RELAX_FREE_REPORT_LIMIT,
      requested_report_category: reportCategory,
      monetization: {
        feature_key: chargingIdentity.feature_key,
        pricing_key: chargingIdentity.pricing_key,
        action_key: chargingIdentity.action_key,
        plan_tier: chargingIdentity.plan_tier,
        charge_mode: 'free',
        usage_context: chargingIdentity.usage_context,
      },
      request_payload: options?.requestPayload ?? null,
      resolved_input: options?.resolvedInput ?? null,
      readiness: options?.readiness ?? null,
    },
  });
}

export async function createPaidReport(
  userId: string,
  companyId: string,
  domain?: string,
  options?: {
    reportCategory?: ReportCategory;
    requestPayload?: ReportRequestPayload;
    resolvedInput?: Record<string, unknown>;
    readiness?: Record<string, unknown>;
    creditReservation?: ReportCreditReservationMetadata;
  },
): Promise<ReportRecord> {
  const reportCategory = options?.reportCategory ?? 'performance';
  const chargingIdentity = getReportChargingIdentity({
    requested_type: 'premium',
    report_category: reportCategory,
  });
  return createReport(userId, companyId, {
    domain,
    isFree: false,
    reportType: mapCategoryToReportType(reportCategory),
    metadata: {
      requested_type: 'premium',
      requested_report_category: reportCategory,
      credit_reservation: options?.creditReservation ?? null,
      monetization: {
        feature_key: chargingIdentity.feature_key,
        pricing_key: chargingIdentity.pricing_key,
        action_key: chargingIdentity.action_key,
        plan_tier: chargingIdentity.plan_tier,
        charge_mode: 'fixed_credits',
        usage_context: chargingIdentity.usage_context,
      },
      request_payload: options?.requestPayload ?? null,
      resolved_input: options?.resolvedInput ?? null,
      readiness: options?.readiness ?? null,
    },
  });
}

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

async function confirmReportCreditReservation(report: ReportRecord, payload: ReportGenerationPayload): Promise<Awaited<ReturnType<typeof confirmCreditReservation>> | null> {
  const reservation = getReportCreditReservation(report);
  if (!reservation) return null;
  const usageSummary = {
    report_id: report.id,
    report_type: report.report_type,
    generated_at: payload.generated_at,
    engine_version: payload.engine_version,
    has_composed_report: !!payload.composed_report,
  };
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
    // Non-fatal: we still persist core intelligence payload.
    console.warn('[reportCardService] composed report generation failed:', composeError);
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

    // Task 2: isolate generateReportPayload so its failure is always captured
    try {
      payload = await generateReportPayload(report);
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
        const settlement = await confirmReportCreditReservation(report, payload);
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
