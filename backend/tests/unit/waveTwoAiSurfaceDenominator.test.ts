/**
 * WAVE-2 INTEGRATION — the AI surface must divide by what can actually be measured.
 *
 * `reportEvidenceReadiness` was corrected to divide coverage by `measurable_cells`. Two
 * consumers in the competitive surface were still dividing by `total_cells`, the enumerated
 * provider x query-class grid. Only retrieval-grounded adapters can ever produce a measured
 * cell, so that grid permanently contains cells no configuration can close:
 *
 *   - `retrieval_consistency_pct` published a percentage capped far below 100 for a run that
 *     measured everything measurable, i.e. a shortfall the operator could not act on;
 *   - the leading-band defence gate in `buildAIStrategicUnlock` compared that ratio against
 *     0.6 and was therefore structurally unreachable — no run, however complete, could fire it.
 *
 * NOTE on scope: `buildAITrajectory` is NOT involved. It reads `change_intelligence` and never
 * touches the cell grid, so it was correct already and is deliberately unchanged.
 */
import type { CanonicalReport } from '../../services/canonicalReport/canonicalReportTypes';
import {
  buildAIVisibilityState,
  buildAIStrategicUnlock,
} from '../../services/intelligence/dossier/intelligenceSurfacesCompetitive';

type CoverageShape = {
  measured_cells: number;
  unavailable_cells: number;
  total_cells: number;
  measurable_cells?: number;
  structurally_unmeasurable_cells?: number;
};

/** A report carrying one citation-matrix coverage block and an AI score. */
const reportWith = (coverage: CoverageShape, aiValue: number | null, citedCellRates: number[] = []): CanonicalReport => ({
  ai_surface_presence: {
    score: aiValue == null
      ? { value: null, state: 'insufficient_signal' }
      : { value: aiValue, state: 'measured' },
    citation_matrix: {
      cells: citedCellRates.map((rate, i) => ({
        provider: `p${i}`,
        query_class: 'brand',
        state: 'measured',
        citation_rate: rate,
      })),
      by_provider: [{ provider: 'perplexity', state: 'measured' }],
      coverage,
    },
  },
  knowledge_graph: { entity: null },
  // `buildAIStrategicUnlock` also reads trust coherence; unmeasured keeps it out of the
  // way so the coverage gate under test is what decides the outcome.
  trust_coherence: { score: { value: null, state: 'insufficient_signal' } },
} as unknown as CanonicalReport);

/** 20-cell grid, 4 grounded. Every grounded cell measured — a complete run. */
const COMPLETE_RUN: CoverageShape = {
  measured_cells: 4,
  unavailable_cells: 16,
  total_cells: 20,
  measurable_cells: 4,
  structurally_unmeasurable_cells: 16,
};

describe('wave-2 — AI coverage divides by measurable cells, not the whole grid', () => {
  it('a complete run over every measurable cell reads 100%, not a fraction of the grid', () => {
    const pct = buildAIVisibilityState(reportWith(COMPLETE_RUN, 80)).retrieval_consistency_pct;
    expect(pct).toBe(100);
    // The pre-fix value, for contrast: 4/20.
    expect(pct).not.toBe(20);
  });

  it('structurally unmeasurable cells contribute nothing to the denominator', () => {
    // Same 2 measured cells; the grid grows from 20 to 40 but measurable stays 4.
    const narrow = buildAIVisibilityState(
      reportWith({ ...COMPLETE_RUN, measured_cells: 2, total_cells: 20 }, 60),
    ).retrieval_consistency_pct;
    const wide = buildAIVisibilityState(
      reportWith({ ...COMPLETE_RUN, measured_cells: 2, total_cells: 40, unavailable_cells: 38 }, 60),
    ).retrieval_consistency_pct;
    expect(narrow).toBe(50);
    expect(wide).toBe(50);
    expect(wide).toEqual(narrow);
  });

  it('no measurable cell at all is null, never 0%', () => {
    const pct = buildAIVisibilityState(
      reportWith({ measured_cells: 0, unavailable_cells: 20, total_cells: 20, measurable_cells: 0, structurally_unmeasurable_cells: 20 }, null),
    ).retrieval_consistency_pct;
    expect(pct).toBeNull();
    expect(pct).not.toBe(0);
  });

  it('a report persisted before the field existed keeps its historical denominator', () => {
    // No `measurable_cells` key at all — must not be read as zero.
    const pct = buildAIVisibilityState(
      reportWith({ measured_cells: 1, unavailable_cells: 19, total_cells: 20 }, 40),
    ).retrieval_consistency_pct;
    expect(pct).toBe(5);
  });

  it('PARTIAL coverage is still reported as partial — not rounded up to complete', () => {
    const pct = buildAIVisibilityState(
      reportWith({ ...COMPLETE_RUN, measured_cells: 1 }, 40),
    ).retrieval_consistency_pct;
    expect(pct).toBe(25);
  });

  it('a genuine measured zero stays legitimate evidence', () => {
    // Grounded cells answered and cited nothing: rate 0, still measured.
    const surface = buildAIVisibilityState(reportWith(COMPLETE_RUN, 0, [0, 0, 0, 0]));
    // Coverage is complete — the company was genuinely looked for, everywhere possible.
    expect(surface.retrieval_consistency_pct).toBe(100);
    // And a zero score is a real finding, not an absence of measurement.
    expect(surface.state).toBe('absent');
    expect(surface.state_label).not.toBe('Not Yet Measured');
  });

  it('unmeasured stays unmeasured — a zero score with no measured cell is not a finding', () => {
    const surface = buildAIVisibilityState(
      reportWith({ measured_cells: 0, unavailable_cells: 20, total_cells: 20, measurable_cells: 4, structurally_unmeasurable_cells: 16 }, 0),
    );
    expect(surface.state).toBe('unmeasured');
    expect(surface.state_label).toBe('Not Yet Measured');
  });
});

describe('wave-2 — the leading-band defence gate is reachable again', () => {
  it('fires for a leading score whose measurable coverage clears the bar', () => {
    const unlock = buildAIStrategicUnlock(reportWith(COMPLETE_RUN, 80));
    expect(unlock.concept).toBe('trajectory_defence');
  });

  it('does NOT fire on thin coverage — the gate still discriminates', () => {
    // 1 of 4 measurable = 0.25, below the 0.6 bar.
    const unlock = buildAIStrategicUnlock(reportWith({ ...COMPLETE_RUN, measured_cells: 1 }, 80));
    expect(unlock.concept).not.toBe('trajectory_defence');
  });

  it('was unreachable before the fix — 4 of 20 is 0.2, under the same 0.6 bar', () => {
    // The pre-fix arithmetic, asserted directly: a complete run could not clear the gate.
    expect(COMPLETE_RUN.measured_cells / COMPLETE_RUN.total_cells).toBeLessThan(0.6);
    expect(COMPLETE_RUN.measured_cells / (COMPLETE_RUN.measurable_cells as number)).toBeGreaterThanOrEqual(0.6);
  });
});
