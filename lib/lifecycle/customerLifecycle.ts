/**
 * customerLifecycle.ts — the ONE canonical Customer Lifecycle model (CSA-004).
 *
 * PURE, deterministic, no AI, no IO. It derives a single lifecycle STAGE and its
 * TRANSITION for a company from signals produced by EXISTING authorities:
 *   - Platform Ready        (company-scoped onboarding completion)
 *   - CSA-003 Health         (score + state — itself a composite of readiness,
 *                             integrations, usage, activity)
 *   - CSA-002 Evolution      (trajectory / score delta)
 *   - CSA-001 Usage          (active days / users — for explanation signals)
 *   - Existing Readiness     (integration coverage, activity)
 *
 * This is the SINGLE lifecycle model. It never recomputes health/readiness — it
 * consumes them. Every future Customer Success capability (Automation, Renewal,
 * Expansion, Retention, Dashboard) reads lifecycle through this model.
 */

export type LifecycleStage =
  | 'ONBOARDING' | 'ACTIVATED' | 'ADOPTING' | 'GROWING' | 'MATURE' | 'DECLINING' | 'DORMANT';

export type Trajectory = 'IMPROVING' | 'STABLE' | 'DECLINING' | 'UNKNOWN';

/** Progression ladder rank (off-ladder negatives are handled separately). */
const STAGE_RANK: Record<LifecycleStage, number> = {
  ONBOARDING: 0, ACTIVATED: 1, ADOPTING: 2, GROWING: 3, MATURE: 4,
  DECLINING: -1, DORMANT: -2,
};

export interface LifecycleInputs {
  companyId: string;
  now: string;
  platformReady: boolean;
  healthScore: number;      // CSA-003 composite 0–100
  healthState: string;      // CSA-003 state (only 'INACTIVE' is special-cased)
  trajectory: Trajectory;   // CSA-002 evolution
  scoreDelta: number | null;
  integrationCoverage: number; // 0–100 (from readiness areas)
  inactiveDays: number | null;
  usageActiveDays: number;
  activeUsers: number;
  /** Prior persisted stage (for transition detection). Null on first evaluation. */
  previousStage?: LifecycleStage | null;
  /** ISO of when the prior stage was entered (carried forward when unchanged). */
  previousStageSince?: string | null;
}

export interface LifecycleTransition {
  changed: boolean;
  from: LifecycleStage | null;
  to: LifecycleStage;
  /** PROMOTION when advancing the ladder, REGRESSION when falling back, INITIAL first time, NONE when unchanged. */
  direction: 'PROMOTION' | 'REGRESSION' | 'INITIAL' | 'NONE';
  reason: string;
  /** When the current stage was entered (now if changed, else carried). */
  at: string;
  trajectory: Trajectory;
}

export interface LifecycleExplanation {
  why: string;
  majorSignals: string[];
  blockingFactors: string[];
  nextMilestone: string;
  recommendedProgression: string;
}

export interface CustomerLifecycle {
  companyId: string;
  stage: LifecycleStage;
  transition: LifecycleTransition;
  /** When the current stage was entered. */
  stageSince: string;
  explanation: LifecycleExplanation;
  evaluatedAt: string;
}

// ── deterministic stage classification ──────────────────────────────────────
const MATURE_MIN = 85;
const GROWING_MIN = 70;
const GROWING_IMPROVING_MIN = 55;
const ADOPTING_MIN = 50;

function classifyStage(i: LifecycleInputs): LifecycleStage {
  if (!i.platformReady) return 'ONBOARDING';
  if (i.healthState === 'INACTIVE') return 'DORMANT';
  if (i.trajectory === 'DECLINING') return 'DECLINING';
  if (i.healthScore >= MATURE_MIN) return 'MATURE';
  if (i.healthScore >= GROWING_MIN) return 'GROWING';
  if (i.healthScore >= GROWING_IMPROVING_MIN && i.trajectory === 'IMPROVING') return 'GROWING';
  if (i.healthScore >= ADOPTING_MIN) return 'ADOPTING';
  return 'ACTIVATED';
}

const STAGE_LABEL: Record<LifecycleStage, string> = {
  ONBOARDING: 'Onboarding', ACTIVATED: 'Activated', ADOPTING: 'Adopting',
  GROWING: 'Growing', MATURE: 'Mature', DECLINING: 'Declining', DORMANT: 'Dormant',
};

/** Deterministic transition reason keyed by the destination stage + direction. */
function transitionReason(to: LifecycleStage, direction: LifecycleTransition['direction']): string {
  if (direction === 'INITIAL') return 'Initial lifecycle classification.';
  switch (to) {
    case 'ONBOARDING': return 'Setup is incomplete — returned to onboarding.';
    case 'DORMANT':    return 'The account went inactive.';
    case 'DECLINING':  return 'Readiness/health is trending down.';
    case 'ACTIVATED':  return 'Reached Platform Ready — the account is activated.';
    case 'ADOPTING':   return 'Adoption is progressing.';
    case 'GROWING':    return 'Adoption is expanding.';
    case 'MATURE':     return 'Reached mature, sustained adoption.';
  }
}

const NEXT: Record<LifecycleStage, { milestone: string; progression: string }> = {
  ONBOARDING: { milestone: 'Activated', progression: 'Finish mandatory setup to reach Platform Ready.' },
  ACTIVATED: { milestone: 'Adopting', progression: 'Connect integrations and start using core features.' },
  ADOPTING: { milestone: 'Growing', progression: 'Increase activity and connect analytics/search.' },
  GROWING: { milestone: 'Mature', progression: 'Sustain activity and complete remaining integrations.' },
  MATURE: { milestone: 'Sustain', progression: 'Keep engagement and integrations healthy.' },
  DECLINING: { milestone: 'Growing', progression: 'Re-engage and address the declining areas.' },
  DORMANT: { milestone: 'Re-activated', progression: 'Return and complete a key action to re-activate.' },
};

/**
 * Compute a company's canonical lifecycle stage + transition. Pure and
 * deterministic — identical inputs (incl. previousStage) yield identical output.
 */
export function computeCustomerLifecycle(inputs: LifecycleInputs): CustomerLifecycle {
  const stage = classifyStage(inputs);
  const prev = inputs.previousStage ?? null;

  const changed = prev !== null && prev !== stage;
  const direction: LifecycleTransition['direction'] =
    prev === null ? 'INITIAL'
    : prev === stage ? 'NONE'
    : STAGE_RANK[stage] > STAGE_RANK[prev] ? 'PROMOTION'
    : 'REGRESSION';

  const at = changed || prev === null ? inputs.now : (inputs.previousStageSince ?? inputs.now);
  const stageSince = at;
  const reason = direction === 'NONE'
    ? `Remained ${STAGE_LABEL[stage]}.`
    : transitionReason(stage, direction);

  const transition: LifecycleTransition = {
    changed, from: prev, to: stage, direction, reason, at, trajectory: inputs.trajectory,
  };

  // ── explanation (deterministic copy) ──────────────────────────────────────
  const majorSignals: string[] = [];
  majorSignals.push(`Health ${inputs.healthState} (${inputs.healthScore}/100)`);
  if (inputs.platformReady) majorSignals.push('Platform Ready');
  if (inputs.trajectory === 'IMPROVING') majorSignals.push('Improving readiness trajectory');
  if (inputs.usageActiveDays > 0) majorSignals.push(`${inputs.usageActiveDays} active day(s)`);
  if (inputs.integrationCoverage >= 75) majorSignals.push('Strong integration coverage');

  const blockingFactors: string[] = [];
  if (!inputs.platformReady) blockingFactors.push('Mandatory setup incomplete');
  if (inputs.healthState === 'INACTIVE') blockingFactors.push(inputs.inactiveDays !== null ? `Inactive for ${inputs.inactiveDays} days` : 'No recorded activity');
  if (inputs.trajectory === 'DECLINING') blockingFactors.push('Declining readiness');
  if (inputs.integrationCoverage < 50 && inputs.platformReady) blockingFactors.push('Few integrations connected');
  if (inputs.usageActiveDays === 0 && inputs.healthState !== 'INACTIVE') blockingFactors.push('No recent product usage');

  const next = NEXT[stage];
  const why = ((): string => {
    switch (stage) {
      case 'ONBOARDING': return 'The account is still completing mandatory setup.';
      case 'ACTIVATED': return 'The account reached Platform Ready but adoption is just beginning.';
      case 'ADOPTING': return 'The account is actively adopting the platform.';
      case 'GROWING': return 'Adoption is expanding with healthy momentum.';
      case 'MATURE': return 'The account is mature with sustained, healthy adoption.';
      case 'DECLINING': return 'Readiness/health is trending down and needs attention.';
      case 'DORMANT': return 'The account has gone inactive.';
    }
  })();

  return {
    companyId: inputs.companyId,
    stage,
    transition,
    stageSince,
    explanation: {
      why, majorSignals, blockingFactors,
      nextMilestone: next.milestone, recommendedProgression: next.progression,
    },
    evaluatedAt: inputs.now,
  };
}

export { STAGE_LABEL, STAGE_RANK };
