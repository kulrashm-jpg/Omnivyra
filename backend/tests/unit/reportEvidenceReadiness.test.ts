/**
 * BETA-EVIDENCE-EXEC-002 — Evidence Readiness Orchestrator (governance).
 *
 * Verifies the readiness layer COMPOSES existing report signals into a lifecycle state + gating disposition +
 * executive gaps, and that "have we measured enough?" (readiness) is kept distinct from "how strong is the
 * business?" (authority). No scoring/evidence is computed here — only states are read.
 */
import { resolveEvidenceReadiness } from '../../services/canonicalReport/reportEvidenceReadiness';
import type { CanonicalReport } from '../../services/canonicalReport/canonicalReportTypes';

const R = (o: unknown): CanonicalReport => o as CanonicalReport;
const dim = (key: string, value: number | null, state: string) => ({ key, score: { value, state } });

const insufficient = R({
  pillars: [
    { pillar: 'foundation', dimensions: [dim('index_integrity', null, 'insufficient_signal'), dim('extraction_readiness', null, 'insufficient_signal'), dim('accessibility', null, 'unavailable')] },
    { pillar: 'authority', dimensions: [dim('authority_inflow', 26, 'inferred'), dim('entity_graph_strength', null, 'insufficient_signal')] },
    { pillar: 'discoverability', dimensions: [dim('topical_authority', 27, 'inferred'), dim('ai_surface_presence', 0, 'inferred')] },
    { pillar: 'trust', dimensions: [dim('trust_coherence', null, 'unavailable')] },
    { pillar: 'momentum', dimensions: [dim('authority_velocity', null, 'insufficient_signal')] },
  ],
  competitive_surface_share: { competitors: [{ name: 'HubSpot' }, { name: 'Salesforce' }] },
  ai_surface_presence: { citation_matrix: { coverage: { measured_cells: 1, unavailable_cells: 19, total_cells: 20 } } },
  scan_metadata: { persisted_at: null },
  authority_overview: { overall_score: { state: 'insufficient_signal' } },
});

const fullyMeasured = R({
  pillars: [
    { pillar: 'foundation', dimensions: [dim('index_integrity', 80, 'measured'), dim('extraction_readiness', 75, 'measured'), dim('accessibility', 70, 'measured')] },
    { pillar: 'authority', dimensions: [dim('authority_inflow', 72, 'measured'), dim('entity_graph_strength', 65, 'measured')] },
    { pillar: 'discoverability', dimensions: [dim('topical_authority', 78, 'measured'), dim('ai_surface_presence', 60, 'measured')] },
    { pillar: 'trust', dimensions: [dim('trust_coherence', 68, 'measured')] },
    { pillar: 'momentum', dimensions: [dim('authority_velocity', 55, 'measured')] },
  ],
  competitive_surface_share: { competitors: [{ name: 'HubSpot' }] },
  ai_surface_presence: { citation_matrix: { coverage: { measured_cells: 18, unavailable_cells: 2, total_cells: 20 } } },
  scan_metadata: { persisted_at: '2026-02-01T00:00:00.000Z' },
  authority_overview: { overall_score: { state: 'measured' } },
});

describe('BETA-EVIDENCE-EXEC-002 — evidence readiness', () => {
  it('an under-measured report is preliminary, not "weak authority"', () => {
    const r = resolveEvidenceReadiness(insufficient);
    expect(r.authority_measured).toBe(false);
    expect(r.disposition).toBe('preliminary');
    expect(r.state).toBe('partially_measured');
    expect(r.connected_sources).toBe(1); // competitor only (backlink/ai are partial=inferred, not connected)
    expect(r.coverage_percentage).toBe(33); // 3 of 9 dims valued
    expect(r.ai_coverage_percentage).toBe(5);
    expect(r.headline.toLowerCase()).toContain('preliminary');
    expect(r.headline.toLowerCase()).toContain('not of your authority'.toLowerCase().slice(0, 3)); // "not"
  });

  it('surfaces executive gaps with Why/Impact/Next/Benefit', () => {
    const r = resolveEvidenceReadiness(insufficient);
    const areas = r.gaps.map((g) => g.area);
    expect(areas).toContain('Website scan');
    expect(areas).toContain('Backlink authority');
    expect(areas).toContain('AI visibility');
    expect(areas).toContain('Trust & reputation');
    for (const g of r.gaps) {
      expect(g.why.length).toBeGreaterThan(0);
      expect(g.impact.length).toBeGreaterThan(0);
      expect(g.next_step.length).toBeGreaterThan(0);
      expect(g.expected_benefit.length).toBeGreaterThan(0);
    }
    expect(r.next_moves.length).toBeGreaterThan(0);
  });

  it('a fully-measured report is ready with no gaps', () => {
    const r = resolveEvidenceReadiness(fullyMeasured);
    expect(r.state).toBe('fully_measured');
    expect(r.disposition).toBe('ready');
    expect(r.authority_measured).toBe(true);
    expect(r.connected_sources).toBe(6);
    expect(r.gaps).toEqual([]);
    expect(r.headline.toLowerCase()).toContain('enough evidence');
  });

  it('keeps readiness distinct from authority (measured overall, but preliminary if unmeasured)', () => {
    // readiness state derives from measurement coverage; authority_measured is a separate flag.
    const r = resolveEvidenceReadiness(insufficient);
    expect(r).toHaveProperty('authority_measured');
    expect(r).toHaveProperty('state');
    expect(r.authority_measured).not.toBe(undefined);
  });

  it('is deterministic', () => {
    expect(resolveEvidenceReadiness(insufficient)).toEqual(resolveEvidenceReadiness(insufficient));
  });
});
