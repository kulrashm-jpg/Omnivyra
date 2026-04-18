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
import { renderOmnivyraSnapshotMasterHtml, renderReportHtmlTemplate } from '../../../backend/services/export/reportHtmlTemplateRenderer';
import { renderReportPdf } from '../../../backend/services/export/reportPdfRenderer';
import {
  mapSnapshot,
  mapPerformance,
  mapGrowth,
} from '../../../backend/services/reportIntelligenceViewMappers';
import { sanitizeReportViewPayload } from '../../../backend/services/reportContentSanitizationService';
import {
  startAsyncReportGeneration,
  type ReportRecord,
} from '../../../backend/services/reportCardService';
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
    confidenceSource: '',
    insights: [],
    metrics: [],
    opportunities: [],
    topPriorities: [],
    nextSteps: [],
  };
}

async function requeueIncompleteReport(report: ReportApiRow): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('reports')
    .update({
      status: 'generating',
      updated_at: now,
      completed_at: null,
      error_message: null,
    })
    .eq('id', report.id)
    .eq('status', 'completed');

  if (error) {
    console.error('[reports/[reportId]] failed to requeue incomplete report:', error);
    return;
  }

  startAsyncReportGeneration(report as ReportRecord);
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

  // Fetch the report record — confirm ownership via company membership
  const { data: report, error: reportError } = await supabase
    .from('reports')
    .select('id, company_id, user_id, domain, report_type, status, created_at, data, metadata')
    .eq('id', reportId)
    .maybeSingle();

  if (reportError || !report) {
    return res.status(404).json({ error: 'Report not found', code: 'NOT_FOUND' });
  }

  // Confirm the requesting user belongs to this company
  const { data: membership } = await supabase
    .from('user_company_roles')
    .select('company_id')
    .eq('user_id', user.id)
    .eq('company_id', report.company_id)
    .eq('status', 'active')
    .maybeSingle();

  if (!membership) {
    return res.status(403).json({ error: 'Access denied', code: 'ACCESS_DENIED' });
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
    const sanitizedWithComparison = sanitizeReportViewPayload(withComparison);
    if (format === 'html') {
      const html = type === 'snapshot'
        ? renderOmnivyraSnapshotMasterHtml(sanitizedWithComparison).html
        : renderReportHtmlTemplate(sanitizedWithComparison).html;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'private, no-store');
      return (res as NextApiResponse<any>).status(200).send(html);
    }
    if (format === 'pdf') {
      const pdfBuffer = await renderReportPdf(sanitizedWithComparison);
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
  const sanitizedPayloadWithComparison = sanitizeReportViewPayload(payloadWithComparison);

  if (format === 'html') {
    const html = type === 'snapshot'
      ? renderOmnivyraSnapshotMasterHtml(sanitizedPayloadWithComparison).html
      : renderReportHtmlTemplate(sanitizedPayloadWithComparison).html;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'private, no-store');
    return (res as NextApiResponse<any>).status(200).send(html);
  }

  if (format === 'pdf') {
    const pdfBuffer = await renderReportPdf(sanitizedPayloadWithComparison);
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
