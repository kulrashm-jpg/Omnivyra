import { buildImprovementTodos, IMPROVEMENT_TODO_TUNING } from '../../services/canonicalReport/improvementTodoBuilder';
import { geometricMean } from '../../services/canonicalReport/scoringGovernance';
import { PILLAR_META } from '../../services/canonicalReport/canonicalReportTypes';
import type {
  CanonicalDimension,
  CanonicalDimensionKey,
  CanonicalPillarScore,
  CanonicalScore,
  PillarKey,
  ScoreState,
} from '../../services/canonicalReport/canonicalReportTypes';

function score(value: number | null, state: ScoreState = 'measured'): CanonicalScore {
  return {
    value,
    state,
    confidence: 'medium',
    band: 'developing',
    evidence: { count: 3, sources: [], freshness: { last_observed_at: null, age_hours: null }, observations: [] },
    benchmark: { value: null, label: null },
  };
}

function dim(key: CanonicalDimensionKey, pillar: PillarKey, value: number | null, state: ScoreState = 'measured'): CanonicalDimension {
  return { key, label: key, pillar, score: score(value, state), rationale: '' };
}

function pillar(key: PillarKey, dims: CanonicalDimension[]): CanonicalPillarScore {
  const measured = dims.filter((d) => typeof d.score.value === 'number' && d.score.state !== 'insufficient_signal' && d.score.state !== 'unavailable');
  const value = measured.length
    ? Math.round(measured.reduce((s, d) => s + (d.score.value as number), 0) / measured.length)
    : null;
  return {
    pillar: key,
    label: PILLAR_META[key].label,
    purpose: '',
    score: score(value, value == null ? 'insufficient_signal' : 'measured'),
    dimensions: dims,
    primary_signal: null,
  };
}

function overallScore(pillars: CanonicalPillarScore[]): CanonicalScore {
  const values = pillars
    .filter((p) => typeof p.score.value === 'number')
    .map((p) => p.score.value as number);
  return score(Math.round(Math.min(100, Math.max(0, geometricMean(values)))));
}

// Foundation pillar carries the only weak dimension (index_integrity = 40); the other
// four pillars are healthy single-dimension pillars.
function makePillars(): CanonicalPillarScore[] {
  return [
    pillar('foundation', [
      dim('index_integrity', 'foundation', 40),
      dim('extraction_readiness', 'foundation', 80),
      dim('accessibility', 'foundation', 78),
    ]),
    pillar('authority', [dim('authority_inflow', 'authority', 75), dim('entity_graph_strength', 'authority', 72)]),
    pillar('discoverability', [dim('topical_authority', 'discoverability', 74), dim('ai_surface_presence', 'discoverability', 71)]),
    pillar('trust', [dim('trust_coherence', 'trust', 76)]),
    pillar('momentum', [dim('authority_velocity', 'momentum', 73)]),
  ];
}

describe('buildImprovementTodos', () => {
  it('emits a to-do only for measurably weak dimensions (< WEAK_THRESHOLD)', () => {
    const pillars = makePillars();
    const todos = buildImprovementTodos(pillars, overallScore(pillars));

    const weakKeys = todos.map((t) => t.dimension);
    expect(weakKeys).toContain('index_integrity'); // 40 < 70
    expect(weakKeys).not.toContain('extraction_readiness'); // 80 >= 70
    expect(weakKeys).not.toContain('accessibility'); // 78 >= 70
    expect(todos.every((t) => t.current_score < IMPROVEMENT_TODO_TUNING.WEAK_THRESHOLD)).toBe(true);
  });

  it('projects the EXACT point gain by re-running the real aggregation (never inflated)', () => {
    const pillars = makePillars();
    const overall = overallScore(pillars);
    const todos = buildImprovementTodos(pillars, overall);

    const todo = todos.find((t) => t.dimension === 'index_integrity');
    expect(todo).toBeTruthy();
    if (!todo) return;

    // Expected target: min(85, 40 + 25) = 65.
    expect(todo.target_score).toBe(Math.min(IMPROVEMENT_TODO_TUNING.TARGET_CAP, 40 + IMPROVEMENT_TODO_TUNING.MAX_SINGLE_CYCLE_LIFT));

    // Recompute foundation pillar average with index_integrity raised to target.
    const newFoundation = Math.round((todo.target_score + 80 + 78) / 3);
    const expectedPillarGain = newFoundation - 60; // current foundation avg = round((40+80+78)/3) = 66? verify
    // current foundation = round((40+80+78)/3) = round(66) = 66
    expect(pillars[0].score.value).toBe(66);
    expect(todo.projected_pillar_gain).toBe(newFoundation - 66);

    // Recompute overall geometric mean with the new foundation value substituted.
    const currentVector = pillars.map((p) => p.score.value as number);
    const newVector = currentVector.map((v, i) => (i === 0 ? newFoundation : v));
    const expectedOverallGain =
      Math.round(Math.min(100, Math.max(0, geometricMean(newVector)))) -
      (overall.value as number);
    expect(todo.projected_overall_gain).toBe(Math.max(0, expectedOverallGain));
    // Honesty guard: overall gain never exceeds the pillar gain (a single dim inside a
    // geometric mean cannot move the whole more than it moves its own pillar).
    expect(todo.projected_overall_gain).toBeLessThanOrEqual(todo.projected_pillar_gain);
  });

  it('orders to-dos by projected overall gain, highest first', () => {
    // Two weak dimensions in different pillars.
    const pillars: CanonicalPillarScore[] = [
      pillar('foundation', [dim('index_integrity', 'foundation', 30), dim('extraction_readiness', 'foundation', 85), dim('accessibility', 'foundation', 85)]),
      pillar('authority', [dim('authority_inflow', 'authority', 45), dim('entity_graph_strength', 'authority', 88)]),
      pillar('discoverability', [dim('topical_authority', 'discoverability', 80), dim('ai_surface_presence', 'discoverability', 80)]),
      pillar('trust', [dim('trust_coherence', 'trust', 82)]),
      pillar('momentum', [dim('authority_velocity', 'momentum', 80)]),
    ];
    const todos = buildImprovementTodos(pillars, overallScore(pillars));
    for (let i = 1; i < todos.length; i += 1) {
      expect(todos[i - 1].projected_overall_gain).toBeGreaterThanOrEqual(todos[i].projected_overall_gain);
    }
  });

  it('carries concrete WHAT and multi-step HOW guidance for every emitted to-do', () => {
    const pillars = makePillars();
    const todos = buildImprovementTodos(pillars, overallScore(pillars));
    expect(todos.length).toBeGreaterThan(0);
    for (const todo of todos) {
      expect(todo.what.length).toBeGreaterThan(10);
      expect(todo.how.length).toBeGreaterThanOrEqual(3);
      expect(todo.how.every((step) => step.trim().length > 0)).toBe(true);
      expect(todo.pillar_label).toBe(PILLAR_META[todo.pillar].label);
    }
  });

  it('returns [] when the overall score is not measurable', () => {
    const pillars = makePillars();
    expect(buildImprovementTodos(pillars, score(null, 'insufficient_signal'))).toEqual([]);
  });
});
