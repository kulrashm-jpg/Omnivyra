/**
 * BETA-EVIDENCE-EXEC-003 — Report Journey Orchestrator (customer journey coordination).
 *
 * Verifies the pure resolver COMPOSES reused signals (website presence, scan timestamp, input readiness,
 * latest report) into exactly one deterministic customer state + single next action, and that a customer is
 * GUIDED to scan before receiving a preliminary report — the historically-missing journey step.
 */
import {
  resolveReportJourney,
  EVIDENCE_FRESHNESS_DAYS,
  type JourneySignals,
} from '../../services/canonicalReport/reportJourneyOrchestrator';

const NOW = '2026-07-02T00:00:00.000Z';
const daysAgo = (n: number) => new Date(Date.parse(NOW) - n * 86_400_000).toISOString();

const base: JourneySignals = {
  hasWebsite: true,
  scannedPages: 0,
  lastScannedAt: null,
  inputReady: true,
  inputMissing: [],
  latestReportStatus: 'none',
  latestReportAt: null,
  now: NOW,
};

describe('BETA-EVIDENCE-EXEC-003 — report journey orchestrator', () => {
  it('no website → website_required (blocking)', () => {
    const j = resolveReportJourney({ ...base, hasWebsite: false });
    expect(j.state).toBe('website_required');
    expect(j.blocking).toBe(true);
    expect(j.next_action.kind).toBe('add_website');
  });

  it('website but never scanned → scan_required, guiding the scan BEFORE a preliminary report', () => {
    const j = resolveReportJourney({ ...base, scannedPages: 0 });
    expect(j.state).toBe('scan_required');
    expect(j.blocking).toBe(true);
    expect(j.next_action.kind).toBe('run_scan');
    expect(j.explanation.toLowerCase()).toContain('preliminary');
  });

  it('a report that exists WITHOUT a scan is flagged preliminary, not presented as complete', () => {
    const j = resolveReportJourney({ ...base, scannedPages: 0, latestReportStatus: 'completed', latestReportAt: daysAgo(1) });
    expect(j.state).toBe('report_preliminary');
    expect(j.blocking).toBe(true);
    expect(j.next_action.kind).toBe('run_scan');
  });

  it('generation in progress → report_generating', () => {
    const j = resolveReportJourney({ ...base, latestReportStatus: 'generating' });
    expect(j.state).toBe('report_generating');
    expect(j.next_action.kind).toBe('view_progress');
  });

  it('scanned but inputs missing → evidence_incomplete, listing the missing requirements', () => {
    const j = resolveReportJourney({
      ...base,
      scannedPages: 20,
      lastScannedAt: daysAgo(1),
      inputReady: false,
      inputMissing: ['Confirm your company profile'],
    });
    expect(j.state).toBe('evidence_incomplete');
    expect(j.blocking).toBe(true);
    expect(j.explanation).toContain('Confirm your company profile');
  });

  it('scanned + inputs ready + no report → ready_to_generate', () => {
    const j = resolveReportJourney({ ...base, scannedPages: 20, lastScannedAt: daysAgo(1) });
    expect(j.state).toBe('ready_to_generate');
    expect(j.blocking).toBe(false);
    expect(j.next_action.kind).toBe('generate_report');
  });

  it('scanned + inputs ready + fresh report → report_available', () => {
    const j = resolveReportJourney({
      ...base,
      scannedPages: 20,
      lastScannedAt: daysAgo(1),
      latestReportStatus: 'completed',
      latestReportAt: daysAgo(1),
    });
    expect(j.state).toBe('report_available');
    expect(j.blocking).toBe(false);
    expect(j.next_action.kind).toBe('view_report');
  });

  it('report exists but scan older than the freshness window → evidence_stale', () => {
    const j = resolveReportJourney({
      ...base,
      scannedPages: 20,
      lastScannedAt: daysAgo(EVIDENCE_FRESHNESS_DAYS + 5),
      latestReportStatus: 'completed',
      latestReportAt: daysAgo(EVIDENCE_FRESHNESS_DAYS + 4),
    });
    expect(j.state).toBe('evidence_stale');
    expect(j.next_action.kind).toBe('rescan');
    expect(j.signals.scan_stale).toBe(true);
  });

  it('a scan just inside the freshness window is NOT stale', () => {
    const j = resolveReportJourney({
      ...base,
      scannedPages: 20,
      lastScannedAt: daysAgo(EVIDENCE_FRESHNESS_DAYS - 1),
      latestReportStatus: 'completed',
      latestReportAt: daysAgo(1),
    });
    expect(j.state).toBe('report_available');
    expect(j.signals.scan_stale).toBe(false);
  });

  it('every state carries explanation + status + next action + expected outcome', () => {
    const j = resolveReportJourney(base);
    expect(j.headline.length).toBeGreaterThan(0);
    expect(j.explanation.length).toBeGreaterThan(0);
    expect(j.current_status.length).toBeGreaterThan(0);
    expect(j.next_action.label.length).toBeGreaterThan(0);
    expect(j.expected_outcome.length).toBeGreaterThan(0);
  });

  it('is deterministic', () => {
    expect(resolveReportJourney(base)).toEqual(resolveReportJourney(base));
  });
});
