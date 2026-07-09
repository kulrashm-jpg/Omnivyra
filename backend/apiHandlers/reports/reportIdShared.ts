/** reports/[reportId] API (Agent-B split — backend module, not a route). */
/**
 * GET /api/reports/[reportId]?type=snapshot|performance|growth
 *
 * Reads the stored intelligence snapshot from reports.data and maps it
 * to a CMO-friendly view payload for the given report type.
 *
 * All data originates from runCompanyBlogIntelligence — no re-computation here.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../services/supabaseAuthService';
import { trackEvent } from '../../services/telemetry/telemetryDispatcher';
import {
  renderCanonicalReportHtml,
  renderCanonicalReportPdf,
} from '../../services/export/canonicalReportPipeline';
import { renderPdfFromHtml } from '../../services/export/htmlToPdfRenderer';
import {
  performanceRendererMap,
  renderPerformanceDocument,
} from '../../services/performanceHtmlRenderer';
import { performanceSections } from '../../services/performanceReportSections';
import type { PerformanceReportMappedData } from '../../services/performanceReportMapper';
import {
  mapSnapshot,
  mapPerformance,
  mapGrowth,
} from '../../services/reportIntelligenceViewMappers';
import { sanitizeReportViewPayload } from '../../services/reportContentSanitizationService';
import {
  startAsyncReportGeneration,
  MAX_REPORT_GENERATION_ATTEMPTS,
  REPORT_RETRY_COOLDOWN_MINUTES,
  type ReportRecord,
} from '../../services/reportCardService';
import { keepAliveAfterResponse } from '../../../lib/runtime/keepAlive';
import type {
  CompanyBlogIntelligenceResult,
} from '../../../lib/blog/companyBlogIntelligenceService';
import { attachProgressComparison } from '../../../pages/api/reports/reportComparisonAttachment';
import { mapComposedReport } from '../../../pages/api/reports/reportComposedMapper';
import type { ComposedReportData } from '../../../pages/api/reports/reportComposedTypes';
import type { ReportViewPayload } from '../../../pages/api/reports/reportViewPayloadTypes';

// ── Task 6: canonical type derived from the intelligence engine ───────────────
export type ReportIntelligenceData = CompanyBlogIntelligenceResult;

/** Reports older than this are considered stale. */
export const STALE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ── View-layer types (consumed by [reportId].tsx) ─────────────────────────────

export type ReportApiRow = Pick<
  ReportRecord,
  'id' | 'company_id' | 'user_id' | 'domain' | 'report_type' | 'status' | 'created_at' | 'data' | 'metadata'
>;

export function buildGeneratingPayload(
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
export async function requeueIncompleteReport(report: ReportApiRow): Promise<void> {
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

export function sanitizeFilenamePart(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildPdfDownloadFilename(
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

export function isPerformanceIntelligenceComposedReport(value: unknown): value is {
  report_type: 'performance_intelligence';
  html: string;
  mapped_data?: unknown;
  window_days?: unknown;
  warnings?: unknown;
  status?: unknown;
} {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { report_type?: unknown; html?: unknown };
  return candidate.report_type === 'performance_intelligence' && typeof candidate.html === 'string' && candidate.html.trim().length > 0;
}

export function renderCurrentPerformanceHtml(composed: {
  html: string;
  mapped_data?: unknown;
  window_days?: unknown;
  warnings?: unknown;
  status?: unknown;
}, companyName: string | null): string {
  if (!composed.mapped_data || typeof composed.mapped_data !== 'object') {
    return composed.html;
  }
  const warningList = Array.isArray(composed.warnings) ? composed.warnings : [];
  return renderPerformanceDocument(
    performanceSections
      .map((sectionKey) => performanceRendererMap[sectionKey](composed.mapped_data as PerformanceReportMappedData))
      .join(''),
    {
      companyName,
      dateRangeLabel: typeof composed.window_days === 'number'
        ? `Last ${composed.window_days} days`
        : 'Most recent analytics window',
      warning: composed.status === 'partial' || warningList.length > 0
        ? 'Some sections are incomplete or still syncing. Treat low-confidence findings as directional.'
        : null,
    },
  );
}

// PDF export spawns a serverless Chromium (@sparticuz/chromium): allow cold-start +
// render time, and don't cap the binary PDF response at the default 4MB.
export const config = {
  maxDuration: 60,
  api: { responseLimit: false },
};

