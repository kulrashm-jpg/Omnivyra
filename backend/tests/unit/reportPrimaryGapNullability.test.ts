/**
 * Report 1 — GEO/AEO primary-gap nullability (evidence discipline, propagation layer).
 *
 * `geoAeoSummaryHelpers` sets `primary_gap: null` when AI evidence is insufficient to name
 * a gap, and `snapshotReportTypes.ts` has always declared that field nullable with the note
 * "Consumers must handle null". The propagation layer did not: the view builder substituted
 * placeholder copy through `||` fallbacks — including a confident "if not addressed"
 * consequence — and every export path dereferenced the gap unguarded.
 *
 * These are governance assertions, not implementation tests. If a future change reintroduces
 * a fabricated gap behind an abstaining score, or re-adds an unguarded dereference that
 * throws on an abstaining snapshot, these must fail.
 */
import { buildGeoAeoExecutiveSummary as buildGeoAeoExecutiveSummaryView } from '../../../pages/api/reports/reportViewSectionBuilders';
import { buildTemplateVariables } from '../../services/export/reportHtmlTemplateVariables';
import { renderSection6AiVisibility } from '../../services/export/reportHtmlSectionsExtended';
import { renderGeoAeoFlow } from '../../services/export/reportHtmlNarrativeFlows';
import type { PdfReportPayload } from '../../services/export/pdf/pdfTypes';

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** The stored snapshot row shape the view builder reads. */
function storedReport(primaryGap: unknown) {
  return {
    geo_aeo_executive_summary: {
      overall_ai_visibility_score: primaryGap === null ? null : 44,
      overall_ai_visibility_score_state: primaryGap === null ? 'insufficient_signal' : 'measured',
      primary_gap: primaryGap,
      top_3_actions: [],
      visibility_opportunity: null,
      confidence: 'low',
    },
  };
}

const MEASURED_GAP = {
  title: 'Answer coverage measured at 31/100',
  type: 'answer_gap',
  severity: 'moderate',
  reasoning: 'Answer coverage measured at 31/100 across sampled queries.',
  if_not_addressed: 'Measured consequence text.',
};

const BASE_PAYLOAD: PdfReportPayload = {
  domain: 'example.com',
  title: 'SEO Snapshot Report',
  reportType: 'snapshot',
  generatedDate: 'Apr 2, 2026',
  diagnosis: 'Clear diagnosis text.',
  summary: 'Compact summary text.',
  topPriorities: [],
  insights: [],
  nextSteps: [],
};

/** Export payload whose GEO/AEO section exists but abstains from naming a gap. */
function payloadWithAbstainingGeo(): PdfReportPayload {
  return {
    ...BASE_PAYLOAD,
    geoAeoExecutiveSummary: {
      overallAiVisibilityScore: null,
      primaryGap: null,
      top3Actions: [],
      visibilityOpportunity: null,
      confidence: 'low',
    },
  } as PdfReportPayload;
}

/**
 * Copy that must never appear while the section is abstaining. These are the exact
 * placeholder strings the removed `||` fallbacks used, plus the consequence language that
 * made the fabrication read as a measured finding.
 */
const FABRICATED_GAP_COPY = [
  'ai answer visibility gap',
  'answer coverage is too thin',
  'reduced ai citation',
  'if not addressed',
  'competitors will capture',
];

// ── P1–P3: the view builder must not resurrect a withheld gap ─────────────────

describe('Report 1 primary gap — view builder', () => {
  it('P1: null primary_gap produces a null primaryGap, not placeholder copy', () => {
    const view = buildGeoAeoExecutiveSummaryView(storedReport(null));

    expect(view.primaryGap).toBeNull();
    const serialized = JSON.stringify(view).toLowerCase();
    for (const claim of FABRICATED_GAP_COPY) {
      expect(serialized).not.toContain(claim);
    }
  });

  it('P2: a measured primary_gap passes through unchanged, with no substitution', () => {
    const view = buildGeoAeoExecutiveSummaryView(storedReport(MEASURED_GAP));

    expect(view.primaryGap).toEqual({
      title: MEASURED_GAP.title,
      type: MEASURED_GAP.type,
      severity: MEASURED_GAP.severity,
      reasoning: MEASURED_GAP.reasoning,
      ifNotAddressed: MEASURED_GAP.if_not_addressed,
    });
  });

  it('P3: an absent geo section still yields undefined, not a synthesised summary', () => {
    expect(buildGeoAeoExecutiveSummaryView({})).toBeUndefined();
  });
});

// ── P4–P7: every export path survives the abstention and states it honestly ───

describe('Report 1 primary gap — export propagation', () => {
  it('P4: HTML template variables do not throw and assert no gap', () => {
    const vars = buildTemplateVariables(payloadWithAbstainingGeo());

    const serialized = JSON.stringify(vars).toLowerCase();
    for (const claim of FABRICATED_GAP_COPY) {
      expect(serialized).not.toContain(claim);
    }
  });

  it('P5: the AI visibility section renders without a fabricated gap narrative', () => {
    const payload = payloadWithAbstainingGeo();
    const html = renderSection6AiVisibility(payload, buildTemplateVariables(payload), true);

    expect(typeof html).toBe('string');
    const lowered = html.toLowerCase();
    for (const claim of FABRICATED_GAP_COPY) {
      expect(lowered).not.toContain(claim);
    }
  });

  it('P6: the GEO/AEO narrative flow states the abstention instead of a gap', () => {
    const html = renderGeoAeoFlow(payloadWithAbstainingGeo());

    expect(html).toContain('Primary gap not determined');
    // No fabricated severity or gap-type badge may be emitted for an unnamed gap.
    expect(html).not.toContain('CRITICAL');
    expect(html).not.toContain('ANSWER GAP');
  });

  it('P7: a measured gap still renders its measured title, severity and type', () => {
    const html = renderGeoAeoFlow({
      ...BASE_PAYLOAD,
      geoAeoExecutiveSummary: {
        overallAiVisibilityScore: 44,
        primaryGap: {
          title: MEASURED_GAP.title,
          type: 'answer_gap',
          severity: 'moderate',
          reasoning: MEASURED_GAP.reasoning,
        },
        top3Actions: [],
        visibilityOpportunity: null,
        confidence: 'low',
      },
    } as PdfReportPayload);

    expect(html).toContain('Answer coverage measured at 31/100');
    expect(html).toContain('MODERATE');
    expect(html).not.toContain('Primary gap not determined');
  });
});

// ── P8: the competitor contract stays independent ─────────────────────────────

describe('Report 1 primary gap — competitor independence', () => {
  it('P8: the competitor summary keeps its non-null gap and is unaffected by geo abstention', () => {
    const payload = {
      ...payloadWithAbstainingGeo(),
      competitorIntelligenceSummary: {
        topCompetitor: 'competitor.com',
        competitorExplanation: 'Explanation text.',
        primaryGap: {
          title: 'Competitor gap title',
          type: 'keyword_gap',
          severity: 'moderate',
          reasoning: 'Competitor gap reasoning.',
        },
        top3Actions: [],
        confidence: 'medium',
      },
    } as unknown as PdfReportPayload;

    const vars = buildTemplateVariables(payload);
    expect(JSON.stringify(vars)).toContain('Competitor gap');
  });
});
