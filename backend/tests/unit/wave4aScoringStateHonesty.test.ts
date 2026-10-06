/**
 * WAVE-4A — a score may not claim more than its evidence supports.
 *
 * The live Report 1 model (5 pillars, 9 canonical dimensions) deliberately lets an `inferred`
 * dimension CONTRIBUTE a value: `isMeasured` admits `measured` and `inferred`, and excludes
 * only `insufficient_signal` and `unavailable`. That is unchanged and is not the defect.
 *
 * The defect was the STATE. It was decided by count alone, so a pillar whose dimensions were
 * ALL inferred heuristics was published as `measured`. Authority is exactly that case — both
 * its dimensions are on-page proxies, and BR-H-001 already downgrades one of them to
 * `inferred` for this very reason, only for the pillar above it to relabel the pair as
 * observed.
 *
 * It was not merely a label: `buildDataConfidence` counts `pillar.score.state`, so an
 * all-inferred pillar was being counted in the customer-facing *measured* column of the Data
 * Confidence & Coverage section — the one surface whose purpose is to disclose how much was
 * actually observed. The mislabel corrupted its own disclosure.
 *
 * These tests pin that the VALUES did not move. If a fix to a state label changed a score,
 * that would be a scoring change, which Wave 4A forbids.
 */
import { aggregateOverallScore, aggregatePillarScore, isMeasured } from '../../services/canonicalReport/canonicalReportBuilderInputs';
import type {
  CanonicalDimension,
  CanonicalPillarScore,
  CanonicalReport,
  ScoreState,
} from '../../services/canonicalReport/canonicalReportTypes';
import { buildDataConfidence } from '../../services/intelligence/dossier/intelligenceSurfacesFoundations';

const dim = (key: string, value: number | null, state: ScoreState): CanonicalDimension => ({
  key,
  label: key,
  score: {
    value,
    state,
    confidence: 'medium',
    band: null,
    evidence: { count: 1, sources: ['heuristic'], freshness: { last_observed_at: null, age_hours: null }, observations: [] },
    benchmark: { value: null, label: null },
  },
  rationale: 'r',
} as unknown as CanonicalDimension);

/**
 * Builds a pillar by calling the PRODUCTION aggregator. Re-implementing the rule here would
 * make every assertion below vacuous: the suite would pass while production diverged — which
 * the first negative-control run of this file actually demonstrated.
 */
const pillarOf = (key: string, dimensions: CanonicalDimension[]): CanonicalPillarScore => ({
  pillar: key,
  label: key,
  purpose: 'p',
  score: aggregatePillarScore(dimensions),
  dimensions,
} as unknown as CanonicalPillarScore);

// ── A/B — inferred evidence contributes, but is not called observed ──────────

describe('wave-4A — inferred contributes a value but never claims observation', () => {
  it('an inferred dimension still contributes to the pillar value', () => {
    // The live rule, unchanged: only insufficient_signal and unavailable are excluded.
    expect(isMeasured(60, 'measured')).toBe(true);
    expect(isMeasured(60, 'inferred')).toBe(true);
    expect(isMeasured(60, 'insufficient_signal')).toBe(false);
    expect(isMeasured(60, 'unavailable')).toBe(false);
    expect(isMeasured(null, 'measured')).toBe(false);
  });

  it('an all-inferred pillar is INFERRED, not measured — and its value is unchanged', () => {
    const p = pillarOf('authority', [dim('authority_inflow', 58, 'inferred'), dim('entity_graph_strength', 78, 'inferred')]);
    expect(p.score.state).toBe('inferred');
    expect(p.score.state).not.toBe('measured');
    // The arithmetic mean of the same two contributors, unmoved.
    expect(p.score.value).toBe(68);
  });

  it('a genuinely all-measured pillar is still MEASURED — not blanket suppression', () => {
    const p = pillarOf('foundation', [dim('a', 70, 'measured'), dim('b', 76, 'measured')]);
    expect(p.score.state).toBe('measured');
    expect(p.score.value).toBe(73);
  });

  it('one inferred dimension among measured ones makes the pillar inferred', () => {
    const p = pillarOf('foundation', [dim('a', 70, 'measured'), dim('b', 76, 'inferred')]);
    expect(p.score.state).toBe('inferred');
  });
});

// ── A — unavailable never becomes a zero ────────────────────────────────────

describe('wave-4A — unavailable and insufficient never become numeric zero', () => {
  it('a pillar with no contributing dimension has a NULL value, not 0', () => {
    const p = pillarOf('trust', [dim('trust_coherence', null, 'unavailable')]);
    expect(p.score.value).toBeNull();
    expect(p.score.value).not.toBe(0);
    expect(p.score.state).toBe('insufficient_signal');
  });

  it('an unavailable dimension does not drag the pillar toward zero', () => {
    const withUnavailable = pillarOf('x', [dim('a', 80, 'measured'), dim('b', null, 'unavailable')]);
    const withoutIt = pillarOf('x', [dim('a', 80, 'measured')]);
    // Excluded, not counted as 0 — otherwise this would read 40.
    expect(withUnavailable.score.value).toBe(80);
    expect(withUnavailable.score.value).toEqual(withoutIt.score.value);
    expect(withUnavailable.score.value).not.toBe(40);
  });
});

// ── Overall score — same rule one level up ─────────────────────────────────

describe('wave-4A — the overall score inherits the same honesty rule', () => {
  it('all-inferred pillars yield an INFERRED overall, with the geometric mean unchanged', () => {
    const overall = aggregateOverallScore([
      pillarOf('a', [dim('x', 64, 'inferred')]),
      pillarOf('b', [dim('y', 81, 'inferred')]),
    ]);
    expect(overall.state).toBe('inferred');
    expect(overall.state).not.toBe('measured');
    // geomean(64, 81) = 72
    expect(overall.value).toBe(72);
  });

  it('all-measured pillars still yield a MEASURED overall', () => {
    const overall = aggregateOverallScore([
      pillarOf('a', [dim('x', 64, 'measured')]),
      pillarOf('b', [dim('y', 81, 'measured')]),
    ]);
    expect(overall.state).toBe('measured');
    expect(overall.value).toBe(72);
  });

  it('no contributing pillar yields insufficient_signal and a null value, never 0', () => {
    const overall = aggregateOverallScore([pillarOf('a', [dim('x', null, 'unavailable')])]);
    expect(overall.state).toBe('insufficient_signal');
    expect(overall.value).toBeNull();
  });
});

// ── D — the disclosure the mislabel used to corrupt ─────────────────────────

describe('wave-4A — coverage disclosure counts the corrected state', () => {
  const reportWith = (pillars: CanonicalPillarScore[]): CanonicalReport => ({
    pillars,
    authority_overview: { overall_score: { state: 'inferred' } },
    ai_surface_presence: { score: { state: 'insufficient_signal' } },
    knowledge_graph: { score: { state: 'unavailable' } },
    authority_inflow: { score: { state: 'inferred' } },
    trust_coherence: { score: { state: 'unavailable' } },
    evidence_trace: { overall: { count: 3 } },
    provider_observability: { providers: [] },
  } as unknown as CanonicalReport);

  it('an all-inferred pillar is counted as inferred, not measured, in Data Confidence', () => {
    const conf = buildDataConfidence(reportWith([
      pillarOf('authority', [dim('authority_inflow', 58, 'inferred'), dim('entity_graph_strength', 78, 'inferred')]),
    ]));
    // 1 pillar (inferred) + 2 dimensions (inferred) + authority_overview + authority_inflow = 5 inferred.
    expect(conf.inferred_count).toBe(5);
    expect(conf.measured_count).toBe(0);
  });

  it('a genuinely measured pillar still raises the measured count', () => {
    const conf = buildDataConfidence(reportWith([
      pillarOf('foundation', [dim('a', 70, 'measured'), dim('b', 76, 'measured')]),
    ]));
    // 1 pillar + 2 dimensions = 3 measured.
    expect(conf.measured_count).toBe(3);
  });

  it('performance and coverage stay distinguishable — a value exists while coverage is partial', () => {
    const conf = buildDataConfidence(reportWith([
      pillarOf('authority', [dim('a', 58, 'inferred')]),
      pillarOf('trust', [dim('t', null, 'unavailable')]),
    ]));
    // There is a number for authority AND an explicit account of what was not observed.
    expect(conf.measured_count).toBe(0);
    expect(conf.inferred_count).toBeGreaterThan(0);
    expect(conf.unavailable_count + conf.insufficient_count).toBeGreaterThan(0);
  });
});
