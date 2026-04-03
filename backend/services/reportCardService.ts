/**
 * Report Card Service
 *
 * Backend truth for free-report eligibility, in-progress protection,
 * and report status transitions.
 */

import { supabase } from '../db/supabaseClient';
import { extractDomain } from './companyMatchService';
import { getUserRole, Role } from './rbacService';
import { deductCreditsAwaited } from './creditExecutionService';
import {
  persistResolvedReportInputs,
  resolveReportInput,
  type ReportRequestPayload,
  type ResolvedReportCategory,
} from './reportInputResolver';
import { evaluateResolvedReportReadiness } from './reportReadinessService';

export type ReportStatus = 'generating' | 'completed' | 'failed';
export type ReportType = 'content_readiness' | 'competitor_analysis' | 'gap_analysis';
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
  if (category === 'growth') return 'competitor_analysis';
  if (category === 'performance') return 'gap_analysis';
  return 'content_readiness';
}

function mapReportTypeToCategory(reportType: ReportType): ReportCategory {
  if (reportType === 'competitor_analysis') return 'growth';
  if (reportType === 'gap_analysis') return 'performance';
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
  const { data, error } = await supabase
    .from('companies')
    .select('website_url, website_domain')
    .eq('id', companyId)
    .maybeSingle();

  if (error) {
    throw new ReportRequestError('Failed to load company domain', 'COMPANY_LOOKUP_FAILED', 500);
  }

  const rawDomain =
    ((data as { website_url?: string | null; website_domain?: string | null } | null)?.website_url) ||
    ((data as { website_url?: string | null; website_domain?: string | null } | null)?.website_domain) ||
    '';

  return normalizeReportDomain(rawDomain);
}

export async function getDomainReportState(domain: string): Promise<DomainReportState> {
  const normalizedDomain = normalizeReportDomain(domain);

  const { data, error } = await supabase
    .from('reports')
    .select('is_free, status')
    .eq('domain', normalizedDomain);

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
  const { data, error } = await supabase
    .from('reports')
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
    getDomainReportState(resolvedDomain),
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

function mapInsertConflict(errorMessage: string): ReportRequestError {
  const message = errorMessage.toLowerCase();
  if (message.includes('unique_free_report_per_domain')) {
    return new ReportRequestError(
      'Free report already used for this domain',
      'FREE_REPORT_LIMIT',
      409,
    );
  }
  if (message.includes('unique_generating_report_per_domain')) {
    return new ReportRequestError(
      'Report already in progress',
      'REPORT_IN_PROGRESS',
      409,
    );
  }
  return new ReportRequestError('Failed to create report', 'REPORT_CREATE_FAILED', 500);
}

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
  const state = await getDomainReportState(domain);

  if (state.hasGeneratingReport) {
    throw new ReportRequestError('Report already in progress', 'REPORT_IN_PROGRESS', 409);
  }

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
  const { data, error } = await supabase
    .from('reports')
    .insert({
      company_id: companyId,
      user_id: userId,
      domain,
      is_free: input.isFree,
      report_type: input.reportType || 'content_readiness',
      status: 'generating',
      started_at: now,
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
      'Failed to create report',
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
  },
): Promise<ReportRecord> {
  const reportCategory = options?.reportCategory ?? 'snapshot';
  return createReport(userId, companyId, {
    domain,
    isFree: !RELAX_FREE_REPORT_LIMIT,
    reportType: mapCategoryToReportType(reportCategory),
    metadata: {
      requested_type: 'free',
      free_limit_relaxed: RELAX_FREE_REPORT_LIMIT,
      requested_report_category: reportCategory,
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
  },
): Promise<ReportRecord> {
  const reportCategory = options?.reportCategory ?? 'performance';
  return createReport(userId, companyId, {
    domain,
    isFree: false,
    reportType: mapCategoryToReportType(reportCategory),
    metadata: {
      requested_type: 'premium',
      requested_report_category: reportCategory,
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

function toResolvedReportCategory(category: ReportCategory): ResolvedReportCategory {
  return category;
}

function getCreditActionForCategory(category: ReportCategory): 'website_audit' | 'deep_analysis' | 'full_strategy' {
  if (category === 'growth') return 'full_strategy';
  if (category === 'performance') return 'deep_analysis';
  return 'website_audit';
}

function enrichComposedReportWithInputContext(params: {
  composedReport: Record<string, unknown> | undefined;
  resolvedInput: Awaited<ReturnType<typeof resolveReportInput>>;
  readiness: ReturnType<typeof evaluateResolvedReportReadiness>;
}): Record<string, unknown> | undefined {
  if (!params.composedReport) return undefined;

  const sections = Array.isArray(params.composedReport.sections)
    ? [...(params.composedReport.sections as Record<string, unknown>[])]
    : [];

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
        description: `Competitors: ${
          params.resolvedInput.resolved.competitors.slice(0, 5).join(', ') || 'none provided'
        } · Social links: ${params.resolvedInput.resolved.socialLinks.length}`,
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

export async function updateReportStatus(
  reportId: string,
  status: ReportStatus,
  updates?: {
    data?: Record<string, unknown>;
    errorMessage?: string | null;
  },
): Promise<void> {
  const now = new Date().toISOString();
  const payload: Record<string, unknown> = {
    status,
    updated_at: now,
  };

  if (status === 'completed') {
    payload.completed_at = now;
  }

  if (updates?.data) {
    payload.data = updates.data;
  }

  if (updates?.errorMessage !== undefined) {
    payload.error_message = updates.errorMessage;
  }

  const { error } = await supabase
    .from('reports')
    .update(payload)
    .eq('id', reportId);

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
  const resolvedInput = await resolveReportInput({
    companyId: report.company_id,
    reportCategory: toResolvedReportCategory(requestedCategory),
    requestPayload,
  });
  const readiness = evaluateResolvedReportReadiness(resolvedInput);

  await persistResolvedReportInputs(resolvedInput);

  const intelligence = await runCompanyBlogIntelligence(report.company_id);

  let composed_report: Record<string, unknown> | undefined;
  try {
    if (requestedCategory === 'growth') {
      const { composeGrowthReport } = await import('./growthReportService');
      composed_report = await composeGrowthReport(report.company_id) as unknown as Record<string, unknown>;
    } else if (requestedCategory === 'performance') {
      const { composePerformanceReport } = await import('./performanceReportService');
      composed_report = await composePerformanceReport(report.company_id, {
        resolvedInput,
      }) as unknown as Record<string, unknown>;
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

export function startAsyncReportGeneration(report: ReportRecord): void {
  void (async () => {
    let payload: ReportGenerationPayload;

    // Task 2: isolate generateReportPayload so its failure is always captured
    try {
      payload = await generateReportPayload(report);
    } catch (error) {
      const error_reason =
        error instanceof Error ? error.message : 'Intelligence engine failed';
      console.error('[reportCardService] generateReportPayload failed:', error_reason);
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

    try {
      await updateReportStatus(report.id, 'completed', { data: payload as unknown as Record<string, unknown> });
      const metadata = (report.metadata || {}) as Record<string, unknown>;
      const requestedType = metadata.requested_type;
      const requestedCategory = mapRequestedCategory(
        metadata.requested_report_category,
        mapReportTypeToCategory(report.report_type),
      );

      if (requestedType === 'premium') {
        await deductCreditsAwaited(report.company_id, getCreditActionForCategory(requestedCategory), {
          userId: report.user_id,
          referenceId: report.id,
          note: `${requestedCategory} report generation`,
        });
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
  })();
}
