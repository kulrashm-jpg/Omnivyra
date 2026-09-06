/**
 * GAP-14 — Report 2 reads the PERSISTED Report 1 baseline.
 *
 * THE DEFECT
 * `buildSnapshotFoundationForPerformance` called `composeSnapshotReport()` live, so every
 * Performance Intelligence run recomputed the whole of Report 1 — crawl, SERP and LLM acquisition
 * included. Two consequences: the customer paid for the same acquisition twice, and the baseline
 * shown in Report 2 was a freshly-computed object rather than the Report 1 they had actually been
 * shown, so the two reports could disagree.
 *
 * THE CONTRACT UNDER TEST
 *   • the foundation is built from the latest COMPLETED persisted report's `composed_report`;
 *   • `composeSnapshotReport` is never invoked on this path;
 *   • priorities come from `digital_snapshot.topPriorities`, never from the deprecated
 *     `SnapshotReport.top_priorities` when the canonical field is present;
 *   • the GAP-04 state gate still refuses `insufficient_signal` / `unavailable`;
 *   • with no completed baseline the foundation is null — Report 1 is NEVER recomposed as a
 *     fallback, and the existing empty state renders.
 */

// The Report 2 service pulls in the whole analytics/AI surface at import time. Only the report
// read matters here, so the heavy collaborators are stubbed; the DB seam is the real subject.
const selectMock = jest.fn();
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => selectMock(table),
}));

const composeSnapshotReportSpy = jest.fn();
jest.mock('../../services/snapshotReportService', () => ({
  __esModule: true,
  composeSnapshotReport: (...args: unknown[]) => composeSnapshotReportSpy(...args),
}));

type Row = { id: string; created_at: string | null; data: unknown };

/** A PostgREST-shaped chained builder that records the filters it was given. */
function queryBuilder(rows: Row[], captured: Record<string, unknown>) {
  const builder: Record<string, unknown> = {};
  const chain = (key: string) => (...args: unknown[]) => {
    captured[key] = args.length === 1 ? args[0] : args;
    return builder;
  };
  builder.select = chain('select');
  builder.order = chain('order');
  builder.eq = (column: string, value: unknown) => {
    captured[`eq:${column}`] = value;
    return builder;
  };
  builder.limit = (n: number) => {
    captured.limit = n;
    return Promise.resolve({ data: rows, error: null });
  };
  return builder;
}

function score(value: number | null, state: string) {
  return { value, state, band: 'developing', confidence: 'high' };
}

/** A stored `composed_report`: the same shape `composeSnapshotReport` returns. */
function composedReport(overrides: Record<string, unknown> = {}) {
  return {
    canonical: {
      authority_overview: { overall_score: score(39, 'measured') },
      maturity_stage: { label: 'Emerging' },
      executive_insights: {
        headline_thesis: { text: 'Authority is imbalanced.' },
        primary_constraint: { text: 'Authority at 22/100 is the dominant drag.' },
      },
      pillars: [
        { label: 'Foundation', score: { value: 72, band: 'strong' }, primary_signal: 'crawl' },
        { label: 'Authority', score: { value: 22, band: 'weak' }, primary_signal: 'backlinks' },
      ],
    },
    score: { value: 41, state: 'measured', label: 'legacy-band' },
    company_context: { market_position: 'ahead', positioning: null },
    decision_snapshot: { primary_focus_area: 'focus', whats_broken: 'broken' },
    summary: 'summary',
    primary_problem: 'problem',
    system_maturity: 'Baseline forming',
    digital_snapshot: {
      topPriorities: [
        {
          id: 'reachability_foundation',
          title: 'Fix the pages that cannot be reached',
          problem: 'Broken pages end the visit.',
          businessImplication: 'Lost sessions',
          expectedImpact: 'Recovered crawlable surface',
          confidence: 'high',
          priorityScore: 55,
        },
      ],
      opportunities: [],
      unmeasuredDimensions: [],
      empty: false,
    },
    top_priorities: [
      { title: 'LEGACY PRIORITY — MUST NOT BE USED', why_now: 'legacy why', impact: 'legacy impact', confidence_score: 0.5 },
    ],
    ...overrides,
  };
}

const row = (id: string, createdAt: string, data: unknown): Row => ({ id, created_at: createdAt, data });

async function buildFoundation(rows: Row[], captured: Record<string, unknown> = {}) {
  selectMock.mockImplementation((table: string) => {
    captured.table = table;
    return queryBuilder(rows, captured);
  });
  const { buildSnapshotFoundationForPerformance } = await import('../../services/performanceReportService');
  return buildSnapshotFoundationForPerformance({ companyId: 'company-1' });
}

describe('GAP-14 — Report 2 reads the persisted Report 1 baseline', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    composeSnapshotReportSpy.mockReset();
  });

  // ── A. No live composition ────────────────────────────────────────────────
  describe('A. Report 1 is never recomposed', () => {
    it('does not invoke composeSnapshotReport when a persisted baseline exists', async () => {
      await buildFoundation([row('r1', '2026-09-06T10:00:00Z', { composed_report: composedReport() })]);
      expect(composeSnapshotReportSpy).not.toHaveBeenCalled();
    });

    it('reads the reports table instead', async () => {
      const captured: Record<string, unknown> = {};
      await buildFoundation([row('r1', '2026-09-06T10:00:00Z', { composed_report: composedReport() })], captured);
      expect(captured.table).toBe('reports');
      expect(captured['eq:company_id']).toBe('company-1');
      expect(captured['eq:status']).toBe('completed');
    });
  });

  // ── B. The foundation comes from the persisted object ─────────────────────
  describe('B. the foundation is built from the persisted composed_report', () => {
    it('carries the persisted score, band, maturity, headline and constraint', async () => {
      const foundation = await buildFoundation([
        row('r1', '2026-09-06T10:00:00Z', { composed_report: composedReport() }),
      ]) as Record<string, unknown>;
      expect(foundation).not.toBeNull();
      expect(foundation.authority_score).toBe(39);
      expect(foundation.authority_band).toBe('developing');
      expect(foundation.maturity_label).toBe('Emerging');
      expect(foundation.headline).toBe('Authority is imbalanced.');
      expect(foundation.primary_constraint).toBe('Authority at 22/100 is the dominant drag.');
    });

    it('carries the persisted pillar scores', async () => {
      const foundation = await buildFoundation([
        row('r1', '2026-09-06T10:00:00Z', { composed_report: composedReport() }),
      ]) as { pillar_scores: Array<Record<string, unknown>> };
      expect(foundation.pillar_scores).toHaveLength(2);
      expect(foundation.pillar_scores[0]).toMatchObject({ label: 'Foundation', value: 72 });
    });
  });

  // ── C. digital_snapshot.topPriorities wins ────────────────────────────────
  describe('C. priorities come from digital_snapshot.topPriorities', () => {
    it('uses the canonical priorities and ignores a conflicting legacy array', async () => {
      const foundation = await buildFoundation([
        row('r1', '2026-09-06T10:00:00Z', { composed_report: composedReport() }),
      ]) as { top_priorities: Array<Record<string, unknown>> };
      expect(foundation.top_priorities).toHaveLength(1);
      expect(foundation.top_priorities[0].title).toBe('Fix the pages that cannot be reached');
      expect(foundation.top_priorities[0].why_now).toBe('Broken pages end the visit.');
      expect(foundation.top_priorities[0].impact).toBe('Recovered crawlable surface');
    });

    it('never lets the deprecated field override the canonical one', async () => {
      const foundation = await buildFoundation([
        row('r1', '2026-09-06T10:00:00Z', { composed_report: composedReport() }),
      ]) as { top_priorities: Array<Record<string, unknown>> };
      const titles = foundation.top_priorities.map((p) => p.title);
      expect(titles).not.toContain('LEGACY PRIORITY — MUST NOT BE USED');
    });
  });

  // ── D. Legacy compatibility ───────────────────────────────────────────────
  describe('D. baselines predating digital_snapshot still populate', () => {
    it('falls back to the legacy array only when the canonical field is absent', async () => {
      const legacyOnly = composedReport({ digital_snapshot: null });
      const foundation = await buildFoundation([
        row('r1', '2026-09-06T10:00:00Z', { composed_report: legacyOnly }),
      ]) as { top_priorities: Array<Record<string, unknown>> };
      expect(foundation.top_priorities).toHaveLength(1);
      expect(foundation.top_priorities[0].title).toBe('LEGACY PRIORITY — MUST NOT BE USED');
      expect(foundation.top_priorities[0].confidence).toBe(50);
    });

    it('returns no priorities when neither source is present, rather than inventing them', async () => {
      const neither = composedReport({ digital_snapshot: null, top_priorities: undefined });
      const foundation = await buildFoundation([
        row('r1', '2026-09-06T10:00:00Z', { composed_report: neither }),
      ]) as { top_priorities: unknown[] };
      expect(foundation.top_priorities).toEqual([]);
    });

    it('treats an empty canonical priority list as absent rather than as an empty answer', async () => {
      const empty = composedReport({
        digital_snapshot: { topPriorities: [], opportunities: [], unmeasuredDimensions: [], empty: true },
      });
      const foundation = await buildFoundation([
        row('r1', '2026-09-06T10:00:00Z', { composed_report: empty }),
      ]) as { top_priorities: Array<Record<string, unknown>> };
      expect(foundation.top_priorities[0].title).toBe('LEGACY PRIORITY — MUST NOT BE USED');
    });
  });

  // ── E. GAP-04 state gate ──────────────────────────────────────────────────
  describe('E. the GAP-04 state gate applies to the persisted score', () => {
    it.each(['insufficient_signal', 'unavailable'])('refuses a %s canonical score', async (state) => {
      const gated = composedReport({
        canonical: {
          ...composedReport().canonical,
          authority_overview: { overall_score: score(10, state) },
        },
        // The legacy score must not become the fallback either.
        score: { value: 10, state, label: 'legacy-band' },
      });
      const foundation = await buildFoundation([
        row('r1', '2026-09-06T10:00:00Z', { composed_report: gated }),
      ]) as Record<string, unknown>;
      expect(foundation.authority_score).toBeNull();
      expect(foundation.authority_band).toBe('insufficient');
    });

    it('does not let the legacy score smuggle a number past a gated canonical score', async () => {
      const gated = composedReport({
        canonical: {
          ...composedReport().canonical,
          authority_overview: { overall_score: score(10, 'insufficient_signal') },
        },
        score: { value: 77, state: 'unavailable', label: 'legacy-band' },
      });
      const foundation = await buildFoundation([
        row('r1', '2026-09-06T10:00:00Z', { composed_report: gated }),
      ]) as Record<string, unknown>;
      expect(foundation.authority_score).toBeNull();
    });

    it('keeps a measured score usable', async () => {
      const foundation = await buildFoundation([
        row('r1', '2026-09-06T10:00:00Z', { composed_report: composedReport() }),
      ]) as Record<string, unknown>;
      expect(foundation.authority_score).toBe(39);
    });

    it('keeps an inferred score usable — it is evidence-backed, not absent', async () => {
      const inferred = composedReport({
        canonical: {
          ...composedReport().canonical,
          authority_overview: { overall_score: score(31, 'inferred') },
        },
      });
      const foundation = await buildFoundation([
        row('r1', '2026-09-06T10:00:00Z', { composed_report: inferred }),
      ]) as Record<string, unknown>;
      expect(foundation.authority_score).toBe(31);
    });
  });

  // ── F. No baseline ────────────────────────────────────────────────────────
  describe('F. no completed baseline', () => {
    it('returns null and does not recompose Report 1', async () => {
      const foundation = await buildFoundation([]);
      expect(foundation).toBeNull();
      expect(composeSnapshotReportSpy).not.toHaveBeenCalled();
    });

    it('returns null when the only completed rows are not Report 1 shaped', async () => {
      // A performance report stores a different composed shape: no `canonical`.
      const foundation = await buildFoundation([
        row('perf', '2026-09-06T12:00:00Z', { composed_report: { report_type: 'performance', sections: [] } }),
      ]);
      expect(foundation).toBeNull();
      expect(composeSnapshotReportSpy).not.toHaveBeenCalled();
    });
  });

  // ── G. Selection correctness ──────────────────────────────────────────────
  describe('G. the latest completed Report 1 is selected', () => {
    it('orders by created_at descending and takes the newest', async () => {
      const captured: Record<string, unknown> = {};
      const older = composedReport();
      const newer = composedReport({
        canonical: { ...composedReport().canonical, maturity_stage: { label: 'NEWEST' } },
      });
      const foundation = await buildFoundation([
        row('r-new', '2026-09-06T12:00:00Z', { composed_report: newer }),
        row('r-old', '2026-09-01T09:00:00Z', { composed_report: older }),
      ], captured) as Record<string, unknown>;
      expect(foundation.maturity_label).toBe('NEWEST');
      expect(captured.order).toEqual(['created_at', { ascending: false }]);
    });

    it('skips a newer non-Report-1 row and takes the newest Report 1', async () => {
      const foundation = await buildFoundation([
        row('perf', '2026-09-06T13:00:00Z', { composed_report: { sections: [] } }),
        row('r1', '2026-09-06T12:00:00Z', { composed_report: composedReport() }),
      ]) as Record<string, unknown>;
      expect(foundation.maturity_label).toBe('Emerging');
    });

    it('never queries a status other than completed', async () => {
      const captured: Record<string, unknown> = {};
      await buildFoundation([row('r1', '2026-09-06T10:00:00Z', { composed_report: composedReport() })], captured);
      expect(captured['eq:status']).toBe('completed');
      expect(Object.keys(captured).filter((k) => k.startsWith('eq:')).sort())
        .toEqual(['eq:company_id', 'eq:status']);
    });
  });
});
