/**
 * Execution Health Scorer.
 * Combines Execution Pressure, Momentum, and Drift into a single 0–100 campaign health score
 * for CMOs and executives.
 */

export type CampaignHealthState = 'EXCELLENT' | 'GOOD' | 'WARNING' | 'CRITICAL';

export type ExecutionHealthScore = {
  score: number;
  state: CampaignHealthState;
  signals: {
    pressure?: string;
    momentum?: string;
    drift?: string;
  };
  warnings?: string[];
};

/** Input shapes from get-weekly-plans (optional). */
export type ExecutionPressure = { pressureLevel?: 'LOW' | 'NORMAL' | 'HIGH'; [key: string]: unknown } | null;
export type ExecutionMomentum = { state?: 'STRONG' | 'STABLE' | 'WEAK'; [key: string]: unknown } | null;
export type ExecutionDrift = { state?: 'NONE' | 'MINOR' | 'MAJOR'; [key: string]: unknown } | null;

const MAX_WARNINGS = 3;

function pressureScore(level?: 'LOW' | 'NORMAL' | 'HIGH'): number {
  if (!level) return 0.7;
  if (level === 'LOW') return 0.9;
  if (level === 'NORMAL') return 1;
  if (level === 'HIGH') return 0.5;
  return 0.7;
}

function momentumScore(state?: 'STRONG' | 'STABLE' | 'WEAK'): number {
  if (!state) return 0.7;
  if (state === 'STRONG') return 1;
  if (state === 'STABLE') return 0.75;
  if (state === 'WEAK') return 0.4;
  return 0.7;
}

function driftScore(state?: 'NONE' | 'MINOR' | 'MAJOR'): number {
  if (!state) return 0.8;
  if (state === 'NONE') return 1;
  if (state === 'MINOR') return 0.65;
  if (state === 'MAJOR') return 0.3;
  return 0.8;
}

function healthState(score: number): CampaignHealthState {
  if (score >= 85) return 'EXCELLENT';
  if (score >= 70) return 'GOOD';
  if (score >= 50) return 'WARNING';
  return 'CRITICAL';
}

/**
 * Compute a single 0–100 execution health score from pressure, momentum, and drift.
 * O(1), computed at read time in get-weekly-plans.
 */
export function computeExecutionHealthScore(
  pressure?: ExecutionPressure,
  momentum?: ExecutionMomentum,
  drift?: ExecutionDrift
): ExecutionHealthScore {
  const pLevel = pressure?.pressureLevel;
  const mState = momentum?.state;
  const dState = drift?.state;

  const score =
    pressureScore(pLevel) * 0.35 +
    momentumScore(mState) * 0.35 +
    driftScore(dState) * 0.3;
  const finalScore = Math.round(Math.min(100, Math.max(0, score * 100)));
  const state = healthState(finalScore);

  const signals: ExecutionHealthScore['signals'] = {};
  if (pLevel) signals.pressure = pLevel;
  if (mState) signals.momentum = mState;
  if (dState) signals.drift = dState;

  const warnings: string[] = [];
  if (pressure?.pressureLevel === 'HIGH') {
    warnings.push('Execution pressure is high for this campaign.');
  }
  if (momentum?.state === 'WEAK') {
    warnings.push('Campaign narrative momentum is weakening.');
  }
  if (drift?.state === 'MAJOR') {
    warnings.push('Execution is diverging significantly from the plan.');
  }
  const limited = warnings.slice(0, MAX_WARNINGS);

  return {
    score: finalScore,
    state,
    signals,
    warnings: limited.length > 0 ? limited : undefined,
  };
}
