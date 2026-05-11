/**
 * GET /api/reports/[reportId]?type=snapshot|performance|growth
 *
 * Reads the stored intelligence snapshot from reports.data and maps it
 * to a CMO-friendly view payload for the given report type.
 *
 * All data originates from runCompanyBlogIntelligence — no re-computation here.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import {
  renderCanonicalReportHtml,
  renderCanonicalReportPdf,
} from '../../../backend/services/export/canonicalReportPipeline';
import {
  mapSnapshot,
  mapPerformance,
  mapGrowth,
} from '../../../backend/services/reportIntelligenceViewMappers';
import { sanitizeReportViewPayload } from '../../../backend/services/reportContentSanitizationService';
import {
  startAsyncReportGeneration,
  MAX_REPORT_GENERATION_ATTEMPTS,
  REPORT_RETRY_COOLDOWN_MINUTES,
  type ReportRecord,
} from '../../../backend/services/reportCardService';
import { keepAliveAfterResponse } from '../../../lib/runtime/keepAlive';
import type {
  CompanyBlogIntelligenceResult,
} from '../../../lib/blog/companyBlogIntelligenceService';
import { attachProgressComparison } from './reportComparisonAttachment';
import { mapComposedReport } from './reportComposedMapper';
import type { ComposedReportData } from './reportComposedTypes';
import type { ReportViewPayload } from './reportViewPayloadTypes';

// ── Task 6: canonical type derived from the intelligence engine ───────────────
export type ReportIntelligenceData = CompanyBlogIntelligenceResult;

/** Reports older than this are considered stale. */
const STALE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ── View-layer types (consumed by [reportId].tsx) ─────────────────────────────

type ReportApiRow = Pick<
  ReportRecord,
  'id' | 'company_id' | 'user_id' | 'domain' | 'report_type' | 'status' | 'created_at' | 'data' | 'metadata'
>;

function buildGeneratingPayload(
  reportId: string,
  companyId: string,
  domain: string,
  reportType: 'snapshot' | 'performance' | 'growth',
  createdAt: string,
): ReportViewPayload {
  return {
    reportId,
    companyId,
    domain,
    reportType,
    generatedDate: createdAt,
    generated_at: createdAt,
    is_stale: false,
    engine_version: 'v1',
    status: 'generating',
    title: '',
    diagnosis: '',
    summary: '',
    overallScore: 0,
    overallScoreState: 'insufficient_signal',
    systemMaturity: 'building_baseline',
    canonical: null,
    confidenceSource: '',
    insights: [],
    metrics: [],
    opportunities: [],
    topPriorities: [],
    nextSteps: [],
  };
}

/**
 * LIFECYCLE OWNER — sole entry point for re-running a previously-completed
 * report row. Counts as one of the approved lifecycle services alongside
 * createReport / updateReportStatus / updateReportHeartbeat /
 * recoverStaleGeneratingReports.
 *
 * Invariants:
 *   - The flip back to `generating` is gated by `.eq('status','completed')`
 *     so a row that has already been requeued (by a concurrent request) is
 *     not re-flipped twice.
 *   - Resets `started_at` and `last_heartbeat_at` to `now` so the recovery
 *     reaper does not immediately reap the freshly-requeued row.
 *   - Bumps `attempt_count` and applies the same retry-ceiling +
 *     cooldown-decay rule as createReport. Inside the cooldown window the
 *     requeue is skipped (no row mutation, no generation kicked off).
 *
 * DO NOT write a parallel "re-run" path in another module. Extend or call
 * this function instead.
 */
async function requeueIncompleteReport(report: ReportApiRow): Promise<void> {
  // Phase 4 + cooldown decay: enforce retry ceiling on requeue. Missing/null
  // attempt_count (legacy rows) is treated as 1.
  const currentAttempts =
    typeof (report as { attempt_count?: number | null }).attempt_count === 'number'
      ? ((report as { attempt_count?: number | null }).attempt_count as number)
      : 1;

  let nextAttempts = currentAttempts + 1;
  if (currentAttempts >= MAX_REPORT_GENERATION_ATTEMPTS) {
    // Cooldown decay: use the row's own `updated_at` as the anchor.
    const updatedAtIso = (report as { updated_at?: string | null }).updated_at;
    const lastUpdatedMs = updatedAtIso ? new Date(updatedAtIso).getTime() : 0;
    const cooldownExpiresAtMs = lastUpdatedMs + REPORT_RETRY_COOLDOWN_MINUTES * 60_000;
    if (Date.now() < cooldownExpiresAtMs) {
      console.warn(
        '[reports/[reportId]] requeue skipped: attempt_count',
        currentAttempts,
        '>= MAX_REPORT_GENERATION_ATTEMPTS',
        MAX_REPORT_GENERATION_ATTEMPTS,
        '(cooldown active until',
        new Date(cooldownExpiresAtMs).toISOString(),
        ') for report',
        report.id,
      );
      return;
    }
    // Cooldown expired → natural reset.
    nextAttempts = 1;
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from('reports')
    .update({
      status: 'generating',
      updated_at: now,
      started_at: now,
      // Phase 1: anchor heartbeat to requeue moment so the reaper does not
      // immediately reap a freshly requeued row.
      last_heartbeat_at: now,
      // Phase 4: bump or reset attempt counter per cooldown decision above.
      attempt_count: nextAttempts,
      completed_at: null,
      error_message: null,
    })
    .eq('id', report.id)
    .eq('status', 'completed');

  if (error) {
    console.error('[reports/[reportId]] failed to requeue incomplete report:', error);
    return;
  }

  // Phase 3: same keep-alive as /api/reports/generate so the lifecycle
  // promise is not orphaned by a Vercel lambda freeze.
  await keepAliveAfterResponse(startAsyncReportGeneration(report as ReportRecord));
}

// ── Mappers: CompanyBlogIntelligenceResult → ReportViewPayload ────────────────

function sanitizeFilenamePart(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildPdfDownloadFilename(
  type: 'snapshot' | 'performance' | 'growth',
  companyName: string | null | undefined,
  domain: string,
): string {
  const brand = sanitizeFilenamePart(companyName) || sanitizeFilenamePart(domain) || 'Report';
  const prefix = type === 'snapshot'
    ? 'Digital Snapshot'
    : type === 'performance'
      ? 'Performance Report'
      : 'Growth Report';
  return `${prefix} - ${brand}.pdf`;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ReportViewPayload | { error: string; code: string }>,
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
  }

  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) {
    return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  }

  const reportId = req.query.reportId as string;
  const format = typeof req.query.format === 'string' ? req.query.format : 'json';

  // Task 4 — reject invalid report type values before any DB work
  const VALID_TYPES = ['snapshot', 'performance', 'growth'] as const;
  type ValidReportType = typeof VALID_TYPES[number];
  const rawType = req.query.type;
  if (typeof rawType !== 'string' || !VALID_TYPES.includes(rawType as ValidReportType)) {
    return res.status(400).json({
      error: `Invalid report type. Must be one of: ${VALID_TYPES.join(', ')}`,
      code: 'INVALID_REPORT_TYPE',
    });
  }
  const type = rawType as ValidReportType;

  // SECURITY: filter the report query by the caller's accessible companies up
  // front. Returning the same 404 for nonexistent and forbidden ids prevents
  // enumeration of report uuids across the tenant boundary.
  const { data: membershipRows } = await supabase
    .from('user_company_roles')
    .select('company_id')
    .eq('user_id', user.id)
    .eq('status', 'active');
  const accessibleCompanyIds = (membershipRows ?? [])
    .map((row) => (row as { company_id?: string | null }).company_id)
    .filter((cid): cid is string => Boolean(cid));

  if (accessibleCompanyIds.length === 0) {
    return res.status(404).json({ error: 'Report not found', code: 'NOT_FOUND' });
  }

  const { data: report, error: reportError } = await supabase
    .from('reports')
    .select('id, company_id, user_id, domain, report_type, status, created_at, data, metadata')
    .eq('id', reportId)
    .in('company_id', accessibleCompanyIds)
    .maybeSingle();

  if (reportError || !report) {
    return res.status(404).json({ error: 'Report not found', code: 'NOT_FOUND' });
  }

  // Still generating — return status so the view page shows the spinner
  if (report.status !== 'completed' && report.status !== 'failed') {
    return res.status(202).json(
      buildGeneratingPayload(reportId, report.company_id, report.domain, type, report.created_at),
    );
  }

  if (report.status === 'failed') {
    return res.status(500).json({ error: 'Report generation failed', code: 'REPORT_FAILED' });
  }

  // Extract the stored intelligence snapshot
  const stored = report.data as {
    intelligence?: ReportIntelligenceData;
    composed_report?: ComposedReportData;
    engine_version?: string;
  } | null;
  const intel = stored?.intelligence;
  const composedReport = stored?.composed_report;

  if ((!intel || !intel.posts) && !composedReport) {
    void requeueIncompleteReport(report as ReportApiRow);
    return res.status(202).json(
      buildGeneratingPayload(reportId, report.company_id, report.domain, type, report.created_at),
    );
  }

  // Task 1 — staleness
  const generated_at = report.created_at;
  const is_stale = Date.now() - new Date(generated_at).getTime() > STALE_THRESHOLD_MS;

  const generatedDate = new Date(generated_at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  // Task 3 — engine version stored at generation time, fall back to v1
  const engine_version = stored?.engine_version ?? 'v1';

  const composedPayload = composedReport
    ? mapComposedReport(
        composedReport,
        type,
        reportId,
        report.company_id,
        report.domain,
        generatedDate,
        generated_at,
        is_stale,
        engine_version,
      )
    : null;

  // Pull live brand assets so reports generated before logo_url/favicon_url
  // were persisted still get them. Tolerates missing columns and ignores
  // errors so a partial schema does not break the render.
  let liveLogoUrl: string | null = null;
  let liveFaviconUrl: string | null = null;
  try {
    const { data: profileRow } = await supabase
      .from('company_profiles')
      .select('logo_url, favicon_url')
      .eq('company_id', report.company_id)
      .maybeSingle();
    const logoCandidate = (profileRow as { logo_url?: string | null } | null)?.logo_url;
    if (typeof logoCandidate === 'string' && /^https?:\/\//i.test(logoCandidate.trim())) {
      liveLogoUrl = logoCandidate.trim();
    }
    const faviconCandidate = (profileRow as { favicon_url?: string | null } | null)?.favicon_url;
    if (typeof faviconCandidate === 'string' && /^https?:\/\//i.test(faviconCandidate.trim())) {
      liveFaviconUrl = faviconCandidate.trim();
    }
  } catch {
    liveLogoUrl = null;
    liveFaviconUrl = null;
  }
  const applyLogoFallback = <T>(payload: T): T => {
    if (!payload) return payload;
    const ctxHolder = payload as { companyContext?: { logoUrl?: string | null; faviconUrl?: string | null } | undefined };
    const ctx = ctxHolder.companyContext;
    if (!ctx) return payload;
    let nextCtx = ctx;
    if (liveLogoUrl && !(typeof ctx.logoUrl === 'string' && ctx.logoUrl.trim())) {
      nextCtx = { ...nextCtx, logoUrl: liveLogoUrl };
    }
    if (liveFaviconUrl && !(typeof ctx.faviconUrl === 'string' && ctx.faviconUrl.trim())) {
      nextCtx = { ...nextCtx, faviconUrl: liveFaviconUrl };
    }
    if (nextCtx !== ctx) ctxHolder.companyContext = nextCtx;
    return payload;
  };

  const mapStoredReportToPayload = (
    reportRow: {
      id: string;
      company_id: string;
      domain: string;
      report_type: string;
      status: string;
      created_at: string;
      data: unknown;
      metadata: unknown;
    },
  ): ReportViewPayload | null => {
    const rowStored = reportRow.data as {
      intelligence?: ReportIntelligenceData;
      composed_report?: ComposedReportData;
      engine_version?: string;
    } | null;

    const rowGeneratedAt = reportRow.created_at;
    const rowGeneratedDate = new Date(rowGeneratedAt).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    const rowIsStale = Date.now() - new Date(rowGeneratedAt).getTime() > STALE_THRESHOLD_MS;
    const rowEngineVersion = rowStored?.engine_version ?? 'v1';

    if (rowStored?.composed_report) {
      return mapComposedReport(
        rowStored.composed_report,
        'snapshot',
        reportRow.id,
        reportRow.company_id,
        reportRow.domain,
        rowGeneratedDate,
        rowGeneratedAt,
        rowIsStale,
        rowEngineVersion,
      );
    }

    if (rowStored?.intelligence?.posts) {
      return mapSnapshot(
        rowStored.intelligence,
        reportRow.id,
        reportRow.company_id,
        reportRow.domain,
        rowGeneratedDate,
        rowGeneratedAt,
        rowIsStale,
        rowEngineVersion,
      );
    }

    return null;
  };

  if (composedPayload) {
    const { data: timelineReports } = await supabase
      .from('reports')
      .select('id, company_id, domain, report_type, status, created_at, data, metadata')
      .eq('company_id', report.company_id)
      .eq('domain', report.domain)
      .in('report_type', ['snapshot', 'content_readiness'])
      .eq('status', 'completed')
      .lte('created_at', report.created_at)
      .order('created_at', { ascending: false })
      .limit(18);
    const withComparison = attachProgressComparison({
      currentPayload: composedPayload,
      type,
      timelineReports: timelineReports ?? [],
      mapStoredReportToPayload,
    });
    applyLogoFallback(withComparison);
    const sanitizedWithComparison = applyLogoFallback(sanitizeReportViewPayload(withComparison));
    if (format === 'html') {
      const html = renderCanonicalReportHtml(sanitizedWithComparison);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'private, no-store');
      return (res as NextApiResponse<any>).status(200).send(html);
    }
    if (format === 'pdf') {
      const pdfBuffer = await renderCanonicalReportPdf(sanitizedWithComparison);
      const filename = buildPdfDownloadFilename(
        type,
        sanitizedWithComparison.companyContext?.companyName ?? null,
        report.domain,
      );
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=\"${filename}\"`,
      );
      res.setHeader('Cache-Control', 'private, no-store');
      return (res as NextApiResponse).status(200).send(pdfBuffer);
    }
    return res.status(200).json(sanitizedWithComparison);
  }

  if (!intel || !intel.posts) {
    void requeueIncompleteReport(report as ReportApiRow);
    return res.status(202).json(
      buildGeneratingPayload(reportId, report.company_id, report.domain, type, report.created_at),
    );
  }

  const payload =
    type === 'performance'
      ? mapPerformance(intel, reportId, report.company_id, report.domain, generatedDate, generated_at, is_stale, engine_version)
      : type === 'growth'
        ? mapGrowth(intel, reportId, report.company_id, report.domain, generatedDate, generated_at, is_stale, engine_version)
        : mapSnapshot(intel, reportId, report.company_id, report.domain, generatedDate, generated_at, is_stale, engine_version);
  const { data: timelineReports } = await supabase
    .from('reports')
    .select('id, company_id, domain, report_type, status, created_at, data, metadata')
    .eq('company_id', report.company_id)
    .eq('domain', report.domain)
    .in('report_type', ['snapshot', 'content_readiness'])
    .eq('status', 'completed')
    .lte('created_at', report.created_at)
    .order('created_at', { ascending: false })
    .limit(18);
  const payloadWithComparison = attachProgressComparison({
    currentPayload: payload,
    type,
    timelineReports: timelineReports ?? [],
    mapStoredReportToPayload,
  });
  applyLogoFallback(payloadWithComparison);
  const sanitizedPayloadWithComparison = applyLogoFallback(sanitizeReportViewPayload(payloadWithComparison));

  if (format === 'html') {
    const html = renderCanonicalReportHtml(sanitizedPayloadWithComparison);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'private, no-store');
    return (res as NextApiResponse<any>).status(200).send(html);
  }

  if (format === 'pdf') {
    const pdfBuffer = await renderCanonicalReportPdf(sanitizedPayloadWithComparison);
    const filename = buildPdfDownloadFilename(
      type,
      sanitizedPayloadWithComparison.companyContext?.companyName ?? null,
      report.domain,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=\"${filename}\"`,
    );
    res.setHeader('Cache-Control', 'private, no-store');
    return (res as NextApiResponse).status(200).send(pdfBuffer);
  }

  return res.status(200).json(sanitizedPayloadWithComparison);
}
