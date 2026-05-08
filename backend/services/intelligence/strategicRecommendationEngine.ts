// Strategic Recommendation Engine.
//
// Phase 4 upgrade: actions stop being a flat list and become a SEQUENCED
// authority playbook with explicit dependencies and multi-pillar impact
// projection. Each action carries:
//
//   - dependency edges (which prerequisites must clear first)
//   - sequence position (1, 2, 3 ... in the canonical execution order)
//   - per-pillar impact projection (foundation/authority/discoverability/trust/momentum)
//   - maturity-shift projection
//
// We do not invent impact — we project from the action's pillar, severity, and
// confidence using deterministic rules. The audit trail makes every projection
// inspectable.

import type {
  CanonicalAction,
  CanonicalReport,
  PillarKey,
  SystemMaturityClass,
} from '../canonicalReport/canonicalReportTypes';

export type StrategicAction = CanonicalAction & {
  /** Position in the canonical execution sequence (1-based). */
  sequence_position: number;
  /** Other action ids that must clear before this can compound. */
  resolved_dependencies: string[];
  /** Per-pillar impact projection (-100..100 points). */
  pillar_impact: Record<PillarKey, number>;
  /** Aggregate AI-visibility impact projection (-100..100). */
  ai_visibility_impact: number;
  /** Discoverability impact projection (-100..100). */
  discoverability_impact: number;
  /** Trust impact projection (-100..100). */
  trust_impact: number;
  /** Authority impact projection (-100..100). */
  authority_impact: number;
  /** Will this action move the brand to the next maturity stage? */
  expected_maturity_shift: 'no' | 'possible' | 'yes';
  /** One-line strategic classification surfaced in the UI. */
  classification:
    | 'tactical_fix'
    | 'strategic_unlock'
    | 'foundational_blocker'
    | 'compounding_authority';
};

export type StrategicPlaybook = {
  actions: StrategicAction[];
  /** Critical-path actions in execution order (foundation → authority → discoverability → momentum). */
  critical_path: StrategicAction[];
  /** Actions that can run in parallel with the critical path (no shared dependencies). */
  parallel_track: StrategicAction[];
  /** Sequence narrative: human-readable execution order. */
  sequence_narrative: string;
};

const PILLAR_KEYS: PillarKey[] = ['foundation', 'authority', 'discoverability', 'trust', 'momentum'];
const PILLAR_RANK: Record<PillarKey, number> = {
  foundation: 0,
  authority: 1,
  discoverability: 2,
  trust: 3,
  momentum: 4,
};

const SEVERITY_IMPACT_BASE: Record<CanonicalAction['severity'], number> = {
  critical: 18,
  moderate: 10,
  low: 4,
};

const CONFIDENCE_MULTIPLIER: Record<CanonicalAction['confidence'], number> = {
  high: 1.0,
  medium: 0.7,
  low: 0.45,
};

// ── Per-action pillar impact projection ───────────────────────────────────────
//
// Each action's primary pillar gets the full base impact. Secondary pillars
// receive a damped fraction based on how downstream they sit in the canonical
// authority chain (foundation → authority → discoverability → trust → momentum).

function projectPillarImpact(action: CanonicalAction): Record<PillarKey, number> {
  const base = SEVERITY_IMPACT_BASE[action.severity] * CONFIDENCE_MULTIPLIER[action.confidence];
  const primary = action.pillar;
  const projection: Record<PillarKey, number> = {
    foundation: 0,
    authority: 0,
    discoverability: 0,
    trust: 0,
    momentum: 0,
  };
  for (const pillar of PILLAR_KEYS) {
    if (pillar === primary) {
      projection[pillar] = Math.round(base);
      continue;
    }
    const distance = Math.abs(PILLAR_RANK[pillar] - PILLAR_RANK[primary]);
    // Foundation-pillar actions cascade strongly to dependent pillars.
    // Other pillars cascade weakly.
    const damp = primary === 'foundation' ? 0.45 : 0.2;
    projection[pillar] = Math.round(base * Math.pow(damp, distance));
  }
  return projection;
}

// ── Maturity-shift estimation ─────────────────────────────────────────────────

function estimateMaturityShift(
  action: CanonicalAction,
  currentMaturity: SystemMaturityClass,
): StrategicAction['expected_maturity_shift'] {
  if (action.maturity_implication === 'shifts_tier') return 'yes';
  if (currentMaturity === 'leading') return 'no';
  if (action.severity === 'critical' && action.confidence === 'high') return 'yes';
  if (action.severity === 'critical' || action.maturity_implication === 'compounds_authority') return 'possible';
  return 'no';
}

// ── Classification ────────────────────────────────────────────────────────────

function classifyAction(action: CanonicalAction): StrategicAction['classification'] {
  if (action.pillar === 'foundation' && action.severity === 'critical') return 'foundational_blocker';
  if (action.maturity_implication === 'shifts_tier') return 'strategic_unlock';
  if (action.maturity_implication === 'compounds_authority') return 'compounding_authority';
  return 'tactical_fix';
}

// ── Dependency resolution ─────────────────────────────────────────────────────
//
// Foundation-pillar actions are prerequisites for every non-foundation action
// at moderate-or-critical severity. Authority-pillar actions gate
// discoverability when the brand is below operational maturity.

function resolveDependencies(
  actions: CanonicalAction[],
  maturity: SystemMaturityClass,
): Map<string, string[]> {
  const byId = new Map(actions.map((a) => [a.id, a]));
  const deps = new Map<string, string[]>();
  for (const action of actions) {
    const explicit = action.dependencies.filter((id) => byId.has(id));
    const inferred: string[] = [];

    // Inferred: any foundation-pillar action with non-low severity blocks
    // non-foundation moderate+ actions.
    if (action.pillar !== 'foundation' && action.severity !== 'low') {
      for (const candidate of actions) {
        if (candidate.id === action.id) continue;
        if (candidate.pillar === 'foundation' && candidate.severity !== 'low') {
          inferred.push(candidate.id);
        }
      }
    }

    // Inferred: pre-operational maturity → authority actions block discoverability actions.
    if (
      action.pillar === 'discoverability' &&
      (maturity === 'structurally_weak' || maturity === 'early_stage' || maturity === 'building_baseline')
    ) {
      for (const candidate of actions) {
        if (candidate.id === action.id) continue;
        if (candidate.pillar === 'authority' && candidate.severity !== 'low') {
          inferred.push(candidate.id);
        }
      }
    }

    deps.set(action.id, [...new Set([...explicit, ...inferred])]);
  }
  return deps;
}

// ── Topological sort with leverage tie-breaking ───────────────────────────────

function topoOrder(
  actions: CanonicalAction[],
  deps: Map<string, string[]>,
): CanonicalAction[] {
  const remaining = new Map(actions.map((a) => [a.id, a]));
  const ordered: CanonicalAction[] = [];

  while (remaining.size > 0) {
    // Pick all actions whose dependencies are satisfied.
    const available = [...remaining.values()].filter((a) => {
      const action_deps = deps.get(a.id) ?? [];
      return action_deps.every((d) => !remaining.has(d));
    });
    if (available.length === 0) {
      // Cycle — fall back to leverage-only ordering for the rest.
      const sorted = [...remaining.values()].sort((a, b) => b.leverage_score - a.leverage_score);
      for (const a of sorted) {
        ordered.push(a);
        remaining.delete(a.id);
      }
      break;
    }
    const picked = available.sort((a, b) => b.leverage_score - a.leverage_score)[0];
    ordered.push(picked);
    remaining.delete(picked.id);
  }
  return ordered;
}

// ── Public builder ────────────────────────────────────────────────────────────

export function buildStrategicPlaybook(
  actions: CanonicalAction[],
  maturity: SystemMaturityClass,
): StrategicPlaybook {
  if (actions.length === 0) {
    return {
      actions: [],
      critical_path: [],
      parallel_track: [],
      sequence_narrative:
        'No actions could be derived from the current evidence. Strategic playbook activates once the action surface is populated.',
    };
  }

  const deps = resolveDependencies(actions, maturity);
  const ordered = topoOrder(actions, deps);

  const strategic: StrategicAction[] = ordered.map((action, idx) => ({
    ...action,
    sequence_position: idx + 1,
    resolved_dependencies: deps.get(action.id) ?? [],
    pillar_impact: projectPillarImpact(action),
    ai_visibility_impact: projectPillarImpact(action).discoverability,
    discoverability_impact: projectPillarImpact(action).discoverability,
    trust_impact: projectPillarImpact(action).trust,
    authority_impact: projectPillarImpact(action).authority,
    expected_maturity_shift: estimateMaturityShift(action, maturity),
    classification: classifyAction(action),
  }));

  // Critical path: actions with non-empty downstream dependency edges
  // (something else depends on them) OR severity=critical.
  const dependedOn = new Set<string>();
  for (const action of strategic) {
    for (const dep of action.resolved_dependencies) dependedOn.add(dep);
  }
  const critical_path = strategic.filter(
    (a) => dependedOn.has(a.id) || a.severity === 'critical',
  );
  const parallel_track = strategic.filter((a) => !dependedOn.has(a.id) && a.severity !== 'critical');

  const sequenceNarrative =
    strategic.length === 0
      ? 'No execution sequence — playbook is empty.'
      : `Execution sequence: ${strategic
          .slice(0, 3)
          .map((a, idx) => `(${idx + 1}) ${a.title}`)
          .join(' → ')}${strategic.length > 3 ? ` → +${strategic.length - 3} more.` : '.'} Actions appear in dependency-resolved order; foundation-pillar prerequisites clear first, authority compounds, then discoverability and momentum follow.`;

  return {
    actions: strategic,
    critical_path,
    parallel_track,
    sequence_narrative: sequenceNarrative,
  };
}
