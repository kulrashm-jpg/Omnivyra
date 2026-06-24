/**
 * customerOnboardingForensicsService.ts
 *
 * READ-ONLY forensic analysis (Phase 16D) of WHY CUSTOMER companies fail the onboarding-setup
 * milestones (PROFILE → DOMAIN → GA → GSC → SOCIAL → TEAM). Distinguishes "never attempted"
 * from "attempted but the product failed to complete it" — classifying each blocker as
 * CUSTOMER_BEHAVIOR / PRODUCT_FLOW / MISSING_TELEMETRY / UNKNOWN. Pure, deterministic,
 * evidence-only. No recommendations, remediation, writes, or customer contact. UNKNOWN
 * preserved.
 */

export type SetupMilestone = 'PROFILE' | 'DOMAIN' | 'GA' | 'GSC' | 'TEAM';
export type SetupState = 'COMPLETE' | 'ATTEMPTED_PENDING' | 'ATTEMPTED_DISCONNECTED' | 'ATTEMPTED_UNSCORED' | 'NEVER_STARTED' | 'UNKNOWN';
export type BottleneckClass = 'CUSTOMER_BEHAVIOR' | 'PRODUCT_FLOW' | 'MISSING_TELEMETRY' | 'UNKNOWN';
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';

export const SETUP_ORDER: SetupMilestone[] = ['PROFILE', 'DOMAIN', 'GA', 'GSC', 'TEAM'];

export interface CustomerSetupRecords {
  company_id: string; company_name: string;
  profile: { exists: boolean; confidence: number; refined: boolean };
  domain: { rows: number; verified: boolean };               // unverified row present ⇒ attempted/pending
  ga: 'CONNECTED' | 'DISCONNECTED' | 'NONE';
  gsc: 'CONNECTED' | 'DISCONNECTED' | 'NONE';
  team: { users: number; invites: number };
}

/** Pure: forensic state of one milestone for one customer. */
export function milestoneState(r: CustomerSetupRecords, m: SetupMilestone): SetupState {
  switch (m) {
    case 'PROFILE':
      if (!r.profile.exists) return 'NEVER_STARTED';
      if (r.profile.confidence >= 60) return 'COMPLETE';
      return r.profile.refined ? 'UNKNOWN' : 'ATTEMPTED_UNSCORED'; // row exists, never refined ⇒ scoring trigger missing
    case 'DOMAIN':
      if (r.domain.verified) return 'COMPLETE';
      return r.domain.rows > 0 ? 'ATTEMPTED_PENDING' : 'NEVER_STARTED';
    case 'GA':
      return r.ga === 'CONNECTED' ? 'COMPLETE' : r.ga === 'DISCONNECTED' ? 'ATTEMPTED_DISCONNECTED' : 'NEVER_STARTED';
    case 'GSC':
      return r.gsc === 'CONNECTED' ? 'COMPLETE' : r.gsc === 'DISCONNECTED' ? 'ATTEMPTED_DISCONNECTED' : 'NEVER_STARTED';
    case 'TEAM':
      return r.team.invites > 0 || r.team.users > 1 ? 'COMPLETE' : 'NEVER_STARTED';
  }
}

const ATTEMPTED: SetupState[] = ['ATTEMPTED_PENDING', 'ATTEMPTED_DISCONNECTED', 'ATTEMPTED_UNSCORED'];

/** Pure: classify a milestone's bottleneck from the spread of customer states. */
export function classifyBottleneck(states: SetupState[]): { classification: BottleneckClass; confidence: Confidence; evidence: string } {
  const total = states.length;
  const attempted = states.filter((s) => ATTEMPTED.includes(s)).length;
  const neverStarted = states.filter((s) => s === 'NEVER_STARTED').length;
  const complete = states.filter((s) => s === 'COMPLETE').length;

  // Attempted-but-failed is direct evidence the PRODUCT did not finish the step.
  if (attempted > 0 && attempted >= neverStarted) return { classification: 'PRODUCT_FLOW', confidence: attempted >= Math.ceil(total / 2) ? 'HIGH' : 'MEDIUM', evidence: `${attempted}/${total} attempted but product left them pending/disconnected/unscored` };
  if (attempted > 0) return { classification: 'PRODUCT_FLOW', confidence: 'MEDIUM', evidence: `${attempted}/${total} attempted-and-failed; ${neverStarted} never started` };
  // No attempts recorded anywhere → cannot tell behavior from a missing prompt.
  if (neverStarted === total - complete && neverStarted > 0) return { classification: 'UNKNOWN', confidence: 'LOW', evidence: `${neverStarted}/${total} never started — cannot distinguish customer behavior from a missing onboarding prompt (no attempt telemetry)` };
  return { classification: 'UNKNOWN', confidence: 'UNKNOWN', evidence: 'insufficient evidence' };
}

export interface FrictionRow { milestone: SetupMilestone; position: number; reached: number; failed: number; drop_rate_pct: number | null; states: Record<SetupState, number>; bottleneck: BottleneckClass; bottleneck_confidence: Confidence; evidence: string; }

const STATES: SetupState[] = ['COMPLETE', 'ATTEMPTED_PENDING', 'ATTEMPTED_DISCONNECTED', 'ATTEMPTED_UNSCORED', 'NEVER_STARTED', 'UNKNOWN'];
const pct = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

export interface ForensicsResult {
  per_customer: Array<{ company_id: string; company_name: string; states: Record<SetupMilestone, SetupState>; last_completed: SetupMilestone | null; first_incomplete: SetupMilestone | null }>;
  friction: FrictionRow[];
  highest_friction: SetupMilestone | null; lowest_friction: SetupMilestone | null;
  single_highest_confidence_failure: { milestone: SetupMilestone; classification: BottleneckClass; confidence: Confidence; evidence: string } | null;
}

/** Pure: full onboarding forensics over the CUSTOMER population. */
export function analyzeOnboardingForensics(customers: CustomerSetupRecords[]): ForensicsResult {
  const n = customers.length;
  const per_customer = customers.map((r) => {
    const states = Object.fromEntries(SETUP_ORDER.map((m) => [m, milestoneState(r, m)])) as Record<SetupMilestone, SetupState>;
    const completedOrder = SETUP_ORDER.filter((m) => states[m] === 'COMPLETE');
    const first_incomplete = SETUP_ORDER.find((m) => states[m] !== 'COMPLETE') ?? null;
    return { company_id: r.company_id, company_name: r.company_name, states, last_completed: completedOrder[completedOrder.length - 1] ?? null, first_incomplete };
  });

  const friction: FrictionRow[] = SETUP_ORDER.map((milestone, position) => {
    const states = customers.map((r) => milestoneState(r, milestone));
    const stateCounts = Object.fromEntries(STATES.map((s) => [s, states.filter((x) => x === s).length])) as Record<SetupState, number>;
    const reached = stateCounts.COMPLETE;
    const failed = n - reached;
    const b = classifyBottleneck(states);
    return { milestone, position, reached, failed, drop_rate_pct: pct(failed, n), states: stateCounts, bottleneck: b.classification, bottleneck_confidence: b.confidence, evidence: b.evidence };
  });

  const ranked = [...friction].sort((a, b) => b.failed - a.failed || a.position - b.position);
  const CONF_RANK: Record<Confidence, number> = { HIGH: 3, MEDIUM: 2, LOW: 1, UNKNOWN: 0 };
  const highestConf = [...friction].filter((f) => f.failed > 0).sort((a, b) => CONF_RANK[b.bottleneck_confidence] - CONF_RANK[a.bottleneck_confidence] || b.failed - a.failed || a.position - b.position)[0];

  return {
    per_customer, friction,
    highest_friction: ranked[0]?.milestone ?? null,
    lowest_friction: ranked[ranked.length - 1]?.milestone ?? null,
    single_highest_confidence_failure: highestConf ? { milestone: highestConf.milestone, classification: highestConf.bottleneck, confidence: highestConf.bottleneck_confidence, evidence: highestConf.evidence } : null,
  };
}
