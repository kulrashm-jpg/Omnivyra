/**
 * Report Journey Orchestrator  (BETA-EVIDENCE-EXEC-003)
 *
 * ONE canonical answer to "where is this customer in the scan → evidence → report journey, and what is
 * the single next thing they should do?" — so a normal customer reaches a complete report without having
 * to understand the platform architecture.
 *
 * It COORDINATES existing systems; it does NOT execute any of them:
 *   • website scan status            ← canonical_pages.last_crawled_at  (populated by POST /api/websites/[id]/analyze)
 *   • input readiness                ← reportReadinessService.getReportReadinessSummary  (domain / profile / analytics)
 *   • existing report + freshness    ← reports table (status, created_at)  vs the scan timestamp
 *   • measurement disposition        ← the same framing reportEvidenceReadiness produces after a build
 *
 * NON-NEGOTIABLE: this module NEVER triggers a crawl, NEVER bypasses a route, NEVER recomputes a score.
 * It reads already-existing state and returns deterministic guidance. The pure resolver is injected with
 * `now` so it is fully deterministic and unit-testable; the async wrapper only gathers the signals.
 *
 * Report Entry Governance (Phase 3): the customer is GUIDED before generation (scan_required / evidence_
 * incomplete) rather than surprised by a preliminary report — but generation itself is never force-blocked
 * here (the report is always allowed; this layer sets expectations, exactly like reportEvidenceReadiness).
 */
import { supabase } from '../../db/supabaseClient';
import { getReportReadinessSummary } from '../reportReadinessService';

/** Deterministic customer states across the whole journey. First matching state (by precedence) wins. */
export type JourneyState =
  | 'website_required' //     no website on the company yet
  | 'scan_required' //        website present, never scanned — the historically-missing prompt
  | 'report_generating' //    a report is being built right now
  | 'report_preliminary' //   a report exists but was built WITHOUT a website scan (thin evidence)
  | 'evidence_incomplete' //  scanned, but input readiness (profile / analytics) is still missing
  | 'evidence_stale' //       a report exists but the scan is older than the freshness window
  | 'ready_to_generate' //    scanned + inputs ready + no current report — generate now
  | 'report_available'; //    scanned + inputs ready + a fresh, complete report exists

export type JourneyActionKind =
  | 'add_website'
  | 'run_scan'
  | 'rescan'
  | 'complete_setup'
  | 'generate_report'
  | 'view_report'
  | 'view_progress';

export interface JourneyNextAction {
  label: string;
  kind: JourneyActionKind;
  /** An existing route the UI can link to (never invented — all confirmed to exist). */
  href: string | null;
}

/** The reused signals, surfaced verbatim for transparency (nothing here is invented). */
export interface JourneySignalSummary {
  has_website: boolean;
  website_scanned: boolean;
  scanned_pages: number;
  last_scanned_at: string | null;
  scan_stale: boolean;
  input_ready: boolean;
  input_missing: string[];
  latest_report_status: 'generating' | 'completed' | 'failed' | 'none';
  latest_report_at: string | null;
}

export interface ReportJourney {
  state: JourneyState;
  /** True when the customer cannot yet obtain a COMPLETE report (guidance, not a hard server block). */
  blocking: boolean;
  headline: string;
  explanation: string;
  current_status: string;
  next_action: JourneyNextAction;
  expected_outcome: string;
  signals: JourneySignalSummary;
}

/** Raw inputs to the pure resolver. `now` is injected so the resolver is deterministic. */
export interface JourneySignals {
  hasWebsite: boolean;
  scannedPages: number;
  lastScannedAt: string | null;
  inputReady: boolean;
  inputMissing: string[];
  latestReportStatus: 'generating' | 'completed' | 'failed' | 'none';
  latestReportAt: string | null;
  now: string;
}

/**
 * Freshness window. We do NOT invent a new freshness signal — we reuse the existing crawl timestamp
 * (canonical_pages.last_crawled_at) and apply this documented governance threshold to it.
 */
export const EVIDENCE_FRESHNESS_DAYS = 30;

const MS_PER_DAY = 86_400_000;

/**
 * Pure, deterministic journey resolver. Composes the reused signals into exactly one customer state with a
 * single next action. Precedence is top-to-bottom: the first condition that matches is the customer's state.
 */
export function resolveReportJourney(s: JourneySignals): ReportJourney {
  const scanned = s.scannedPages > 0 && s.lastScannedAt != null;
  const ageDays = s.lastScannedAt ? (Date.parse(s.now) - Date.parse(s.lastScannedAt)) / MS_PER_DAY : Infinity;
  const scanStale = scanned && ageDays > EVIDENCE_FRESHNESS_DAYS;
  const hasReport = s.latestReportStatus === 'completed';

  const signals: JourneySignalSummary = {
    has_website: s.hasWebsite,
    website_scanned: scanned,
    scanned_pages: s.scannedPages,
    last_scanned_at: s.lastScannedAt,
    scan_stale: scanStale,
    input_ready: s.inputReady,
    input_missing: s.inputMissing,
    latest_report_status: s.latestReportStatus,
    latest_report_at: s.latestReportAt,
  };

  const make = (
    state: JourneyState,
    blocking: boolean,
    headline: string,
    explanation: string,
    current_status: string,
    next_action: JourneyNextAction,
    expected_outcome: string,
  ): ReportJourney => ({ state, blocking, headline, explanation, current_status, next_action, expected_outcome, signals });

  // 1. No website — nothing can be measured.
  if (!s.hasWebsite) {
    return make(
      'website_required',
      true,
      'Add your website to begin',
      'Your authority report is built from your live website. Add your website address so we can measure it.',
      'No website is connected to this company yet.',
      { label: 'Add website', kind: 'add_website', href: '/command-center' },
      'Once a website is connected, you can run the scan that produces a complete report.',
    );
  }

  // 2. A report is being built right now.
  if (s.latestReportStatus === 'generating') {
    return make(
      'report_generating',
      false,
      'Your report is being generated',
      'We are composing your authority report from the evidence collected so far.',
      'Report generation is in progress.',
      { label: 'View progress', kind: 'view_progress', href: '/reports' },
      'The report will appear in a moment; you can watch its progress on the reports page.',
    );
  }

  // 3. Never scanned. This is the historically-missing guidance — a report built now would be preliminary.
  if (!scanned) {
    if (hasReport) {
      return make(
        'report_preliminary',
        true,
        'Your report is preliminary — scan your website to complete it',
        'A report already exists, but your website has not been scanned, so it was built from limited evidence. ' +
          'Running the scan measures your pages and makes the report complete.',
        'A preliminary report exists; the website has never been scanned.',
        { label: 'Scan website', kind: 'run_scan', href: '/website-intelligence' },
        'After the scan, regenerate the report to replace estimates with measured evidence.',
      );
    }
    return make(
      'scan_required',
      true,
      'Scan your website first',
      'Before generating a report, scan your website so we can measure your pages, content, and structure. ' +
        'Generating without a scan produces only a preliminary reading.',
      'Your website has not been scanned yet.',
      { label: 'Scan website', kind: 'run_scan', href: '/website-intelligence' },
      'The scan collects the on-site evidence that makes your first report complete rather than preliminary.',
    );
  }

  // 4. Scanned but stale, and a report already exists — advise a refresh.
  if (hasReport && scanStale) {
    return make(
      'evidence_stale',
      false,
      'Your evidence is out of date',
      `Your website was last scanned more than ${EVIDENCE_FRESHNESS_DAYS} days ago. Re-scan to refresh the evidence before relying on the report.`,
      'A report exists, but the underlying scan is stale.',
      { label: 'Re-scan website', kind: 'rescan', href: '/website-intelligence' },
      'A fresh scan updates the evidence so a regenerated report reflects your current site.',
    );
  }

  // 5. Scanned, but the pre-generation inputs (profile / analytics) are still incomplete.
  if (!s.inputReady) {
    const missing = s.inputMissing.length ? s.inputMissing.join('; ') : 'Some required details are still missing.';
    return make(
      'evidence_incomplete',
      true,
      'A little more is needed before your report is complete',
      `Your website is scanned, but some details are still required: ${missing}`,
      'Website scanned; input requirements not yet met.',
      { label: 'Complete setup', kind: 'complete_setup', href: '/command-center' },
      'Completing these details lets the report measure every pillar instead of leaving some unmeasured.',
    );
  }

  // 6. Everything is ready and a fresh report already exists.
  if (hasReport) {
    return make(
      'report_available',
      false,
      'Your report is ready',
      'Your website is scanned and your inputs are complete. Your authority report reflects measured evidence.',
      'A complete, current report is available.',
      { label: 'View report', kind: 'view_report', href: '/reports' },
      'Open your report to review measured authority across all pillars.',
    );
  }

  // 7. Ready to generate the first complete report.
  return make(
    'ready_to_generate',
    false,
    "You're ready to generate a complete report",
    'Your website is scanned and your inputs are complete. Generate your authority report now — it will be built from measured evidence.',
    'Scan complete and inputs ready; no current report.',
    { label: 'Generate report', kind: 'generate_report', href: '/reports' },
    'A report generated now measures every available pillar rather than reading as preliminary.',
  );
}

function normalizeReportStatus(raw: unknown): JourneySignals['latestReportStatus'] {
  if (raw == null) return 'none';
  const s = String(raw).toLowerCase();
  if (s === 'generating' || s === 'pending' || s === 'processing' || s === 'queued') return 'generating';
  if (s.includes('fail') || s.includes('error')) return 'failed';
  return 'completed';
}

/**
 * Async wrapper: gather the reused signals from the existing sources and resolve the journey.
 * Every read here already exists in the codebase — we only compose them. Fail-open: a signal that cannot
 * be read degrades to its safest value rather than throwing (guidance is best-effort, never a hard error).
 */
export async function getReportJourney(params: { companyId: string; now?: string }): Promise<ReportJourney> {
  const now = params.now ?? new Date().toISOString();

  const [companyRes, scanRes, readiness, reportRes] = await Promise.all([
    supabase.from('companies').select('website').eq('id', params.companyId).maybeSingle(),
    supabase
      .from('canonical_pages')
      .select('last_crawled_at', { count: 'exact' })
      .eq('company_id', params.companyId)
      .order('last_crawled_at', { ascending: false })
      .limit(1),
    getReportReadinessSummary({ companyId: params.companyId }).catch(() => null),
    supabase
      .from('reports')
      .select('status, created_at')
      .eq('company_id', params.companyId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const hasWebsite = Boolean((companyRes.data as { website?: string | null } | null)?.website);
  const scannedPages = scanRes.count ?? 0;
  const lastScannedAt =
    (scanRes.data?.[0] as { last_crawled_at?: string | null } | undefined)?.last_crawled_at ?? null;

  // Input readiness = the SNAPSHOT track (the free/baseline report every customer can reach).
  const snapshot = readiness?.reports?.snapshot ?? null;
  const inputReady = Boolean(snapshot?.ready);
  const inputMissing = snapshot?.missing_requirements ?? [];

  const reportRow = reportRes.data as { status?: string | null; created_at?: string | null } | null;
  const latestReportStatus = reportRow ? normalizeReportStatus(reportRow.status) : 'none';
  const latestReportAt = reportRow?.created_at ?? null;

  return resolveReportJourney({
    hasWebsite,
    scannedPages,
    lastScannedAt,
    inputReady,
    inputMissing,
    latestReportStatus,
    latestReportAt,
    now,
  });
}
