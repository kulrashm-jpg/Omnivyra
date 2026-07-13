/**
 * customerHealth.ts — the ONE canonical Customer Health model (CSA-003).
 *
 * PURE, deterministic, no AI, no IO. It derives a single company Health score,
 * state, and risk classification from signals produced by EXISTING authorities:
 *   - Platform Ready        (onboarding authority; company-scoped reflection)
 *   - Existing Readiness     (customerReadinessService — score/bucket/areas/activity)
 *   - Integration coverage   (readiness area states — NOT re-derived)
 *   - Historical Evolution   (customerEvolutionService trajectory/score delta)
 *   - Usage                  (CSA-001 usage authority — activity/adoption)
 *   - Activity recency       (readiness last_activity_at)
 *
 * This is the SINGLE health authority's math. It never recomputes readiness — it
 * consumes it. Every Customer Success capability (Lifecycle, Risk, Renewal,
 * Engagement, Automation) reads health through this model (via the service).
 */

export type HealthState =
  | 'EXCELLENT' | 'HEALTHY' | 'STABLE' | 'NEEDS_ATTENTION' | 'AT_RISK' | 'INACTIVE';

export type RiskLevel = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type ReadinessAreaState = 'READY' | 'NOT_READY' | 'UNKNOWN';
export type Trajectory = 'IMPROVING' | 'STABLE' | 'DECLINING' | 'UNKNOWN';

/** The readiness areas that represent integration/setup coverage (reused, not re-derived). */
export const HEALTH_AREAS = [
  'COMPANY_PROFILE', 'WEBSITE', 'GOOGLE_ANALYTICS', 'GOOGLE_SEARCH_CONSOLE', 'SOCIAL_INTEGRATIONS',
] as const;
export type HealthArea = (typeof HEALTH_AREAS)[number];

/** Only the connectable integrations count toward "integration coverage". */
const INTEGRATION_AREAS: HealthArea[] = ['WEBSITE', 'GOOGLE_ANALYTICS', 'GOOGLE_SEARCH_CONSOLE', 'SOCIAL_INTEGRATIONS'];

const AREA_LABELS: Record<HealthArea, string> = {
  COMPANY_PROFILE: 'Company profile',
  WEBSITE: 'Website / CMS',
  GOOGLE_ANALYTICS: 'Google Analytics',
  GOOGLE_SEARCH_CONSOLE: 'Google Search Console',
  SOCIAL_INTEGRATIONS: 'Social accounts',
};

export interface HealthUsageInput {
  /** Events in the window. */
  totalEvents: number;
  /** Distinct active users in the window. */
  activeUsers: number;
  /** Distinct days with any event in the window. */
  activeDays: number;
  /** Capabilities exercised in the window (from usage byCapability). */
  capabilitiesUsed: string[];
}

export interface HealthInputs {
  companyId: string;
  /** ISO — the evaluation instant (deterministic clock). */
  now: string;
  /** Company-scoped Platform Ready (all mandatory setup complete). */
  platformReady: boolean;
  /** Existing readiness score 0–100 (consumed, never recomputed). */
  readinessScore: number;
  readinessBucket: 'AT_RISK' | 'PARTIAL' | 'READY';
  /** Existing tenant status (e.g. ACTIVE/DORMANT/INACTIVE); only 'INACTIVE' is special-cased. */
  tenantStatus: string;
  lastActivityAt: string | null;
  /** Readiness area states (integration/setup coverage). */
  areas: Record<HealthArea, ReadinessAreaState>;
  /** Historical trajectory from the Evolution engine. */
  trajectory: Trajectory;
  scoreDelta: number | null;
  usage: HealthUsageInput;
}

export interface HealthContributor {
  key: string;
  label: string;
  /** Component score 0–100. */
  value: number;
  /** Weight applied in the composite. */
  weight: number;
}

export interface HealthRisk {
  level: RiskLevel;
  reasons: string[];
  /** Not-ready integration/setup areas (human labels). */
  missingPrerequisites: string[];
  /** Whole days since last activity (null when never active). */
  inactiveDays: number | null;
  /** Capabilities/integrations with no adoption. */
  adoptionGaps: string[];
}

export interface HealthExplanation {
  why: string;
  majorContributors: string[];
  negativeContributors: string[];
  recommendedImprovements: string[];
}

export interface CustomerHealth {
  companyId: string;
  /** Composite health score 0–100. */
  score: number;
  state: HealthState;
  risk: HealthRisk;
  contributors: HealthContributor[];
  explanation: HealthExplanation;
  evaluatedAt: string;
}

// ── deterministic thresholds ────────────────────────────────────────────────
const STATE_THRESHOLDS: Array<[number, HealthState]> = [
  [85, 'EXCELLENT'], [70, 'HEALTHY'], [55, 'STABLE'], [40, 'NEEDS_ATTENTION'], [0, 'AT_RISK'],
];
const INACTIVE_DAYS = 30;
const DECLINING_DELTA = -3;

// component weights (sum = 1.0)
const W_READINESS = 0.5;
const W_INTEGRATION = 0.2;
const W_ACTIVITY = 0.3;
const EVOLUTION_ADJ = 8;      // ± bounded evolution modifier
const PLATFORM_READY_BONUS = 4;

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const round = (n: number) => Math.round(n);

function daysSince(iso: string | null, nowMs: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((nowMs - t) / 86_400_000));
}

/** Activity recency score (0–100) from last-activity age. Deterministic. */
function recencyScore(inactiveDays: number | null): number {
  if (inactiveDays === null) return 0;
  if (inactiveDays <= 7) return 100;
  if (inactiveDays <= 14) return 80;
  if (inactiveDays <= 30) return 50;
  if (inactiveDays <= 60) return 25;
  return 0;
}

/** Usage-activity score (0–100) from distinct active days in the window. */
function usageScore(u: HealthUsageInput): number {
  if (u.activeDays >= 15) return 100;
  if (u.activeDays >= 7) return 80;
  if (u.activeDays >= 3) return 60;
  if (u.activeDays >= 1) return 40;
  return 0;
}

function integrationCoverage(areas: Record<HealthArea, ReadinessAreaState>): number {
  const ready = INTEGRATION_AREAS.filter((a) => areas[a] === 'READY').length;
  return (ready / INTEGRATION_AREAS.length) * 100;
}

function stateForScore(score: number): HealthState {
  for (const [threshold, state] of STATE_THRESHOLDS) {
    if (score >= threshold) return state;
  }
  return 'AT_RISK';
}

function bumpRisk(level: RiskLevel): RiskLevel {
  const order: RiskLevel[] = ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
  return order[Math.min(order.length - 1, order.indexOf(level) + 1)];
}

function riskForState(state: HealthState): RiskLevel {
  switch (state) {
    case 'EXCELLENT': return 'NONE';
    case 'HEALTHY': return 'LOW';
    case 'STABLE': return 'LOW';
    case 'NEEDS_ATTENTION': return 'MEDIUM';
    case 'AT_RISK': return 'HIGH';
    case 'INACTIVE': return 'CRITICAL';
  }
}

/**
 * Compute a company's canonical Customer Health. Pure + deterministic — the same
 * inputs always yield the same result (replay/refresh/snapshot safe).
 */
export function computeCustomerHealth(inputs: HealthInputs): CustomerHealth {
  const nowMs = Date.parse(inputs.now);
  const inactiveDays = daysSince(inputs.lastActivityAt, Number.isFinite(nowMs) ? nowMs : Date.parse(inputs.now));

  // ── component scores ──────────────────────────────────────────────────────
  const readiness = clamp(inputs.readinessScore);
  const integration = integrationCoverage(inputs.areas);
  const activity = Math.max(recencyScore(inactiveDays), usageScore(inputs.usage));

  const contributors: HealthContributor[] = [
    { key: 'readiness', label: 'Setup readiness', value: round(readiness), weight: W_READINESS },
    { key: 'integration', label: 'Integration coverage', value: round(integration), weight: W_INTEGRATION },
    { key: 'activity', label: 'Recent activity', value: round(activity), weight: W_ACTIVITY },
  ];

  let score = readiness * W_READINESS + integration * W_INTEGRATION + activity * W_ACTIVITY;

  // Evolution modifier (bounded).
  const evolutionAdj =
    inputs.trajectory === 'IMPROVING' ? EVOLUTION_ADJ
    : inputs.trajectory === 'DECLINING' ? -EVOLUTION_ADJ
    : 0;
  score += evolutionAdj;
  if (inputs.platformReady) score += PLATFORM_READY_BONUS;
  score = clamp(round(score));

  // ── state (INACTIVE overrides purely-numeric state) ───────────────────────
  const isInactive = inputs.tenantStatus === 'INACTIVE' || (inactiveDays !== null && inactiveDays >= INACTIVE_DAYS);
  const state: HealthState = isInactive ? 'INACTIVE' : stateForScore(score);

  // ── risk ──────────────────────────────────────────────────────────────────
  const missingPrerequisites = HEALTH_AREAS.filter((a) => inputs.areas[a] === 'NOT_READY').map((a) => AREA_LABELS[a]);
  const adoptionGaps = INTEGRATION_AREAS.filter((a) => inputs.areas[a] !== 'READY').map((a) => AREA_LABELS[a]);

  let riskLevel = riskForState(state);
  if (inputs.trajectory === 'DECLINING' || (inputs.scoreDelta !== null && inputs.scoreDelta < DECLINING_DELTA)) {
    riskLevel = bumpRisk(riskLevel);
  }

  const reasons: string[] = [];
  if (state === 'INACTIVE') reasons.push(inactiveDays !== null ? `No activity for ${inactiveDays} days.` : 'No recorded activity.');
  if (readiness < 55) reasons.push(`Setup readiness is low (${round(readiness)}/100).`);
  if (missingPrerequisites.length > 0) reasons.push(`Missing setup: ${missingPrerequisites.join(', ')}.`);
  if (integration < 50) reasons.push('Few integrations connected.');
  if (inputs.trajectory === 'DECLINING') reasons.push('Readiness is trending down.');
  if (activity < 50 && state !== 'INACTIVE') reasons.push('Low recent activity.');

  const risk: HealthRisk = { level: riskLevel, reasons, missingPrerequisites, inactiveDays, adoptionGaps };

  // ── explanation (deterministic copy) ──────────────────────────────────────
  const sorted = [...contributors].sort((a, b) => b.value - a.value);
  const majorContributors = sorted.filter((c) => c.value >= 70).map((c) => `${c.label} (${c.value}/100)`);
  const negativeContributors = sorted.filter((c) => c.value < 50).map((c) => `${c.label} (${c.value}/100)`);
  if (inputs.trajectory === 'DECLINING') negativeContributors.push('Declining readiness trajectory');
  if (inputs.trajectory === 'IMPROVING') majorContributors.push('Improving readiness trajectory');

  const recommendedImprovements: string[] = [];
  for (const label of missingPrerequisites) recommendedImprovements.push(`Complete ${label}.`);
  if (activity < 50) recommendedImprovements.push('Increase workspace activity — publish or plan content.');
  if (!inputs.platformReady) recommendedImprovements.push('Finish onboarding to reach Platform Ready.');

  const why = ((): string => {
    switch (state) {
      case 'EXCELLENT': return 'Setup, integrations, and activity are all strong.';
      case 'HEALTHY': return 'The account is well set up and active.';
      case 'STABLE': return 'The account is steady with room to deepen adoption.';
      case 'NEEDS_ATTENTION': return 'Setup or activity gaps are holding this account back.';
      case 'AT_RISK': return 'Low readiness and/or activity put this account at risk.';
      case 'INACTIVE': return 'The account has gone inactive.';
    }
  })();

  return {
    companyId: inputs.companyId,
    score,
    state,
    risk,
    contributors,
    explanation: { why, majorContributors, negativeContributors, recommendedImprovements },
    evaluatedAt: inputs.now,
  };
}

export { INACTIVE_DAYS, AREA_LABELS };
