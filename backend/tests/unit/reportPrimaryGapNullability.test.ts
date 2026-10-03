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

// ── The removed export-propagation pins (P4–P8) ─────────────────────────────
//
// P4–P8 asserted the same abstention against the legacy snapshot renderer
// (reportHtmlTemplateVariables / reportHtmlSectionsExtended / reportHtmlNarrativeFlows). That
// family had zero production entry points -- the live export path is renderCanonicalReportHtml /
// renderCanonicalReportPdf (backend/services/export/canonicalReportPipeline.ts) -- and was
// removed. The canonical export payload and renderer carry no `primary_gap` concept at all, so
// the canonical path cannot fabricate a GEO/AEO gap and there is no canonical surface those pins
// could be migrated onto. The propagation layer that IS live -- the view builder in
// reportViewSectionBuilders -- stays pinned by P1–P3 above.
