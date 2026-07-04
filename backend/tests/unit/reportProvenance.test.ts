/**
 * BETA-REPORT-EXEC-007 — Trajectory + competitor provenance (BR-H-002 + BR-H-003).
 *
 * Verifies truthful, deterministic provenance labels that reuse the provider's own state/classification and
 * the competitor crawl origin — distinguishing measured history vs projected vs unavailable, and crawl-derived
 * competitor observations vs unavailable. No trajectory, growth, projection, or competitor evidence invented.
 */
import {
  resolveTrajectoryProvenance,
  resolveCompetitorProvenance,
} from '../../services/canonicalReport/reportProvenance';

describe('BETA-REPORT-EXEC-007 — trajectory provenance (BR-H-002)', () => {
  it('measured history: ≥2 real snapshots + measured state', () => {
    const p = resolveTrajectoryProvenance({ state: 'measured', snapshotCount: 3, classification: 'sustained_growth', forecastPresent: true, reasonUnavailable: null });
    expect(p.history).toBe('measured');
    expect(p.forecast).toBe('projected');
    expect(p.classification).toBe('sustained_growth');
    // the projection is explicitly flagged as not-measured
    expect(p.limitations.some((l) => /projection.*not measured/i.test(l))).toBe(true);
  });

  it('insufficient history: a single snapshot is not a measured trend', () => {
    const p = resolveTrajectoryProvenance({ state: 'inferred', snapshotCount: 1, classification: 'insufficient_history', forecastPresent: false, reasonUnavailable: null });
    expect(p.history).toBe('insufficient');
    expect(p.forecast).toBe('unavailable');
    expect(p.limitations.some((l) => /at least two/i.test(l))).toBe(true);
  });

  it('unavailable history: no snapshots → no measured trend or projection', () => {
    const p = resolveTrajectoryProvenance({ state: 'unavailable', snapshotCount: 0, classification: 'insufficient_history', forecastPresent: false, reasonUnavailable: 'no history persisted' });
    expect(p.history).toBe('unavailable');
    expect(p.forecast).toBe('unavailable');
    expect(p.reason_unavailable).toBe('no history persisted');
    expect(p.basis.toLowerCase()).toContain('no authority history');
  });

  it('does not upgrade to measured without a measured state even with snapshots', () => {
    const p = resolveTrajectoryProvenance({ state: 'inferred', snapshotCount: 4, classification: 'stagnation', forecastPresent: false, reasonUnavailable: null });
    expect(p.history).not.toBe('measured'); // never claim measured history the provider didn't confirm
  });

  it('is deterministic', () => {
    const args = { state: 'measured' as const, snapshotCount: 2, classification: 'decay', forecastPresent: true, reasonUnavailable: null };
    expect(resolveTrajectoryProvenance(args)).toEqual(resolveTrajectoryProvenance(args));
  });
});

describe('BETA-REPORT-EXEC-007 — competitor provenance (BR-H-003)', () => {
  it('labels crawl origin (not a market panel) when competitors exist', () => {
    const p = resolveCompetitorProvenance({ confidence: 'medium', competitorCount: 3 });
    expect(p.source).toBe('competitor_intelligence');
    expect(p.measured).toBe(true);
    expect(p.confidence).toBe('medium');
    expect(p.basis.toLowerCase()).toContain('not a licensed market-data panel');
    expect(p.limitations.some((l) => /blank.*unavailable.*not zero/i.test(l))).toBe(true);
  });

  it('honestly reports no observations when there are no competitors', () => {
    const p = resolveCompetitorProvenance({ confidence: 'low', competitorCount: 0 });
    expect(p.measured).toBe(false);
    expect(p.basis.toLowerCase()).toContain('no competitor observations');
  });

  it('is deterministic', () => {
    const args = { confidence: 'low' as const, competitorCount: 2 };
    expect(resolveCompetitorProvenance(args)).toEqual(resolveCompetitorProvenance(args));
  });
});
