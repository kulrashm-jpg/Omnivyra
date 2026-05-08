// Strategic action grouping for the executive dossier.
//
// The canonical action_playbook + strategic_playbook return a single ranked
// list. The dossier needs them grouped into four sequenced buckets so the
// reader sees the playbook as a multi-horizon programme rather than a linear
// to-do list. Mapping rules below are deterministic — same input, same buckets.

import type {
  CanonicalAction,
  CanonicalReport,
  PillarKey,
} from '../../canonicalReport/canonicalReportTypes';

export type ActionGroupKind =
  | 'immediate'              // Critical foundational fixes
  | 'high_leverage'          // Highest authority/discoverability gains
  | 'authority_expansion'    // Market amplification + trust building
  | 'long_term_multiplier';  // Compounding investments

export type GroupedAction = CanonicalAction & {
  group_kind: ActionGroupKind;
  /** One-sentence explanation of why this action lands in this bucket. */
  bucket_rationale: string;
};

export type ActionDossierGroup = {
  kind: ActionGroupKind;
  label: string;
  description: string;
  actions: GroupedAction[];
};

const GROUP_META: Record<ActionGroupKind, { label: string; description: string }> = {
  immediate: {
    label: 'Immediate Actions',
    description: 'Critical foundational fixes. Every downstream gain is suppressed until these clear.',
  },
  high_leverage: {
    label: 'High-Leverage Actions',
    description: 'Each move materially shifts a pillar and unlocks compounding behaviour.',
  },
  authority_expansion: {
    label: 'Authority Expansion',
    description: 'Market amplification and trust building — extending reach once the foundation holds.',
  },
  long_term_multiplier: {
    label: 'Long-Term Multipliers',
    description: 'Compounding investments. No immediate lift, but they create the conditions for non-linear future gains.',
  },
};

function classify(action: CanonicalAction): ActionGroupKind {
  // Rules are evaluated top-down; first match wins.

  // Foundational blockers ALWAYS come first regardless of leverage.
  if (action.pillar === 'foundation' && (action.severity === 'critical' || action.severity === 'moderate')) {
    return 'immediate';
  }

  // Tier-shifting moves are the highest-leverage bucket.
  if (action.maturity_implication === 'shifts_tier' || action.severity === 'critical') {
    return 'high_leverage';
  }

  // Authority + Trust expansion moves: these grow the brand in market.
  if (
    action.pillar === 'authority' ||
    action.pillar === 'trust' ||
    action.maturity_implication === 'compounds_authority' ||
    action.maturity_implication === 'reinforces_trust'
  ) {
    return 'authority_expansion';
  }

  // Momentum + low-severity discoverability work compounds over time.
  if (
    action.pillar === 'momentum' ||
    action.maturity_implication === 'accelerates_momentum' ||
    action.severity === 'low'
  ) {
    return 'long_term_multiplier';
  }

  // Default: high-leverage if it reaches discoverability or extension.
  return 'high_leverage';
}

function rationaleFor(action: CanonicalAction, kind: ActionGroupKind): string {
  if (kind === 'immediate') {
    return `Foundation-pillar ${action.severity}-severity issue — every other pillar's gain is throttled until this clears.`;
  }
  if (kind === 'high_leverage') {
    if (action.maturity_implication === 'shifts_tier') return 'Rated to shift the maturity stage — this is the single largest move available.';
    if (action.severity === 'critical') return 'Critical severity in a measured pillar — high-leverage by definition.';
    return `Direct lift to the ${action.pillar} pillar with downstream cascade.`;
  }
  if (kind === 'authority_expansion') {
    if (action.pillar === 'trust') return 'Reinforces trust coherence — strengthens how the brand reads to AI and to humans simultaneously.';
    if (action.pillar === 'authority') return 'Extends authority inflow — broadens the brand\'s presence in the corroborating ecosystem.';
    return 'Compounding authority move — extends reach without depending on foundational fixes.';
  }
  return 'Compounding investment — produces no isolated lift but creates the conditions for non-linear future gains.';
}

const PILLAR_ORDER: Record<PillarKey, number> = {
  foundation: 0,
  authority: 1,
  discoverability: 2,
  trust: 3,
  momentum: 4,
};

export function groupActionsForDossier(report: CanonicalReport): ActionDossierGroup[] {
  // Use strategic_playbook actions when present (they carry sequence_position),
  // otherwise fall back to action_playbook.
  const source = report.strategic_playbook?.actions?.length
    ? report.strategic_playbook.actions
    : report.action_playbook.actions;

  const grouped: Record<ActionGroupKind, GroupedAction[]> = {
    immediate: [],
    high_leverage: [],
    authority_expansion: [],
    long_term_multiplier: [],
  };

  for (const action of source) {
    const kind = classify(action);
    grouped[kind].push({
      ...action,
      group_kind: kind,
      bucket_rationale: rationaleFor(action, kind),
    });
  }

  // Within each bucket, sort by leverage_score desc, then pillar order, then title.
  for (const key of Object.keys(grouped) as ActionGroupKind[]) {
    grouped[key].sort((a, b) => {
      if (b.leverage_score !== a.leverage_score) return b.leverage_score - a.leverage_score;
      const pillarDelta = PILLAR_ORDER[a.pillar] - PILLAR_ORDER[b.pillar];
      if (pillarDelta !== 0) return pillarDelta;
      return a.title.localeCompare(b.title);
    });
  }

  // Cap each bucket at 3 — recommendations should feel strategically
  // prioritised, not operationally exhaustive. An executive-grade dossier
  // surfaces the leading 3 moves per horizon; the rest live in the
  // canonical strategic_playbook for the working team.
  return (Object.keys(grouped) as ActionGroupKind[]).map((kind) => ({
    kind,
    label: GROUP_META[kind].label,
    description: GROUP_META[kind].description,
    actions: grouped[kind].slice(0, 3),
  }));
}
