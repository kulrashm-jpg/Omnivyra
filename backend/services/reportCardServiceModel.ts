/** Report card — types, scoring model, band helpers — split from reportCardService.ts (barrel preserved; importers unchanged). */
import { ownedDbTable } from '../db/writeOwner';
import { timeInto, type TimingSink } from '../../lib/platform/serverTiming';
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

export const REPORT_ENGINE_VERSION = 'v1' as const;
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
export const HEARTBEAT_INTERVAL_MS = 60_000;

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

export type ReportGenerationPayload = {
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

export type ReportCreditReservationMetadata = CreditReservationHandle & {
  feature_key: string;
  pricing_key: string;
  plan_tier: string | null;
  usage_context: Record<string, unknown>;
  pricing_snapshot?: Record<string, unknown>;
  registry_snapshot?: Record<string, unknown>;
  generation_context?: Record<string, unknown>;
};

export function mapReportTypeToCategory(reportType: ReportType): ReportCategory {
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
  timing?: TimingSink,
): Promise<CompanyReportsResult> {
  const resolvedDomain = domain
    ? normalizeReportDomain(domain)
    : await timeInto(timing, 'domain', () => getCompanyDomain(companyId));
  // Parallelism preserved: each leaf is wrapped individually, so the group
  // still starts together and the recorded durations are per-leaf, not summed.
  const [reports, roleResult, domainState] = await Promise.all([
    timeInto(timing, 'reports', () => getCompanyReports(companyId)),
    timeInto(timing, 'role', () => getUserRole(userId, companyId)),
    timeInto(timing, 'state', () => getDomainReportState(resolvedDomain, companyId)),
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

