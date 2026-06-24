/**
 * customerActivationService.ts
 *
 * READ-ONLY, deterministic activation intelligence: why companies stall between creation
 * and becoming ACTIVE. Pure functions over readiness data (no new DB reads). Evidence-only,
 * no inference, no causality claims, no writes/recommendations/automation.
 *
 * NOTE: `tenant_status=ACTIVE` is activity-driven, not milestone-gated — an ACTIVE company
 * need not have met every milestone. So the funnel reports INDEPENDENT stage-reach (not a
 * forced strict funnel), and milestone↔activation links are reported as ASSOCIATION only.
 */

import type { ReadinessState } from './customerReadinessService';

export type ActivationStatus = 'ACTIVATED' | 'IN_PROGRESS' | 'BLOCKED' | 'ABANDONED' | 'UNKNOWN';
export type ActivationBlocker =
  | 'PROFILE_INCOMPLETE' | 'DOMAIN_UNVERIFIED' | 'GA_NOT_CONNECTED' | 'GSC_NOT_CONNECTED'
  | 'SOCIAL_NOT_CONNECTED' | 'TEAM_NOT_ESTABLISHED' | 'NO_MEANINGFUL_ACTIVITY' | 'MULTIPLE_BLOCKERS' | 'UNKNOWN';
export type ActivationStage =
  | 'COMPANY_CREATED' | 'PROFILE_COMPLETED' | 'DOMAIN_VERIFIED' | 'GA_CONNECTED' | 'GSC_CONNECTED'
  | 'SOCIAL_CONNECTED' | 'TEAM_ESTABLISHED' | 'FIRST_MEANINGFUL_ACTIVITY' | 'ACTIVATED';
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';

const STALE_DAYS = 14;

export interface ActivationCompany {
  company_id: string; company_name: string; created_at: string | null; is_active: boolean;
  profile: ReadinessState; domain: ReadinessState; ga: ReadinessState; gsc: ReadinessState;
  social: ReadinessState; team: ReadinessState; active_user_count_30d: number;
}

interface Milestone { stage: Exclude<ActivationStage, 'COMPANY_CREATED' | 'ACTIVATED'>; blocker: ActivationBlocker; met: (c: ActivationCompany) => boolean; unknown: (c: ActivationCompany) => boolean; }

const MILESTONES: Milestone[] = [
  { stage: 'PROFILE_COMPLETED', blocker: 'PROFILE_INCOMPLETE', met: (c) => c.profile === 'READY', unknown: (c) => c.profile === 'UNKNOWN' },
  { stage: 'DOMAIN_VERIFIED', blocker: 'DOMAIN_UNVERIFIED', met: (c) => c.domain === 'READY', unknown: (c) => c.domain === 'UNKNOWN' },
  { stage: 'GA_CONNECTED', blocker: 'GA_NOT_CONNECTED', met: (c) => c.ga === 'READY', unknown: (c) => c.ga === 'UNKNOWN' },
  { stage: 'GSC_CONNECTED', blocker: 'GSC_NOT_CONNECTED', met: (c) => c.gsc === 'READY', unknown: (c) => c.gsc === 'UNKNOWN' },
  { stage: 'SOCIAL_CONNECTED', blocker: 'SOCIAL_NOT_CONNECTED', met: (c) => c.social === 'READY', unknown: (c) => c.social === 'UNKNOWN' },
  { stage: 'TEAM_ESTABLISHED', blocker: 'TEAM_NOT_ESTABLISHED', met: (c) => c.team === 'READY', unknown: (c) => c.team === 'UNKNOWN' },
  { stage: 'FIRST_MEANINGFUL_ACTIVITY', blocker: 'NO_MEANINGFUL_ACTIVITY', met: (c) => c.active_user_count_30d > 0, unknown: () => false },
];

const olderThan = (iso: string | null, days: number, nowMs: number) => (iso ? (nowMs - Date.parse(iso)) / 86_400_000 > days : false);

export interface ActivationClassification {
  company_id: string; company_name: string;
  status: ActivationStatus; blocker: ActivationBlocker | null; all_blockers: ActivationBlocker[];
  reason: string; evidence: string; confidence: Confidence;
}

/** Pure: classify one company's activation state. */
export function classifyActivation(c: ActivationCompany, nowMs: number): ActivationClassification {
  const base = { company_id: c.company_id, company_name: c.company_name };
  if (c.is_active) return { ...base, status: 'ACTIVATED', blocker: null, all_blockers: [], reason: 'tenant active', evidence: 'tenant_status=ACTIVE', confidence: 'HIGH' };

  const unmet = MILESTONES.filter((m) => !m.met(c));
  const all_blockers = unmet.map((m) => m.blocker);
  const anyUnknown = unmet.some((m) => m.unknown(c));
  // UNKNOWN only when every AREA signal is UNKNOWN and there is no activity evidence either
  // (the activity milestone is never "unknown" — it is observed as 0).
  const areaUnknownAll = MILESTONES.filter((m) => m.stage !== 'FIRST_MEANINGFUL_ACTIVITY').every((m) => m.unknown(c));
  if (areaUnknownAll && c.active_user_count_30d === 0) {
    return { ...base, status: 'UNKNOWN', blocker: 'UNKNOWN', all_blockers, reason: 'all activation signals unknown', evidence: 'no definite readiness signals', confidence: 'UNKNOWN' };
  }
  const blocker: ActivationBlocker = all_blockers.length === 0 ? 'NO_MEANINGFUL_ACTIVITY' : all_blockers.length >= 2 ? 'MULTIPLE_BLOCKERS' : all_blockers[0];

  const engaged = c.active_user_count_30d > 0;
  const stale = olderThan(c.created_at, STALE_DAYS, nowMs);
  const status: ActivationStatus = engaged ? 'IN_PROGRESS' : stale ? 'ABANDONED' : 'BLOCKED';
  const confidence: Confidence = anyUnknown ? 'MEDIUM' : 'HIGH';
  return { ...base, status, blocker, all_blockers, reason: `${all_blockers.length} unmet milestone(s)`, evidence: `blockers: ${all_blockers.join(', ') || 'none'}; active_30d=${c.active_user_count_30d}`, confidence };
}

export interface StageReach { stage: ActivationStage; reached: number; lost: number; loss_pct: number | null; }
export interface ActivationCorrelation { milestone: ActivationStage; population_with: number; activated_with: number; rate_with: number | null; population_without: number; activated_without: number; rate_without: number | null; }

export interface ActivationResult {
  total: number;
  funnel: StageReach[];
  largest_dropoff: { stage: ActivationStage; lost: number; loss_pct: number | null } | null;
  by_status: Record<ActivationStatus, number>;
  by_blocker: Array<{ blocker: ActivationBlocker; count: number }>;
  activation_conversion_pct: number | null;
  correlations: ActivationCorrelation[];
  classifications: ActivationClassification[];
  unknown_gaps: string[];
}

const pct = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

/** Pure: full activation analysis over the company population. */
export function analyzeActivation(companies: ActivationCompany[], nowMs: number): ActivationResult {
  const total = companies.length;
  const activated = companies.filter((c) => c.is_active).length;
  const reachCount = (m: Milestone) => companies.filter((c) => m.met(c)).length;

  const funnel: StageReach[] = [
    { stage: 'COMPANY_CREATED', reached: total, lost: 0, loss_pct: 0 },
    ...MILESTONES.map((m) => { const reached = reachCount(m); return { stage: m.stage, reached, lost: total - reached, loss_pct: pct(total - reached, total) }; }),
    { stage: 'ACTIVATED', reached: activated, lost: total - activated, loss_pct: pct(total - activated, total) },
  ];

  const mids = funnel.filter((s) => s.stage !== 'COMPANY_CREATED');
  const largest = mids.reduce<StageReach | null>((mx, s) => (!mx || s.lost > mx.lost ? s : mx), null);

  const classifications = companies.map((c) => classifyActivation(c, nowMs));
  const by_status: Record<ActivationStatus, number> = { ACTIVATED: 0, IN_PROGRESS: 0, BLOCKED: 0, ABANDONED: 0, UNKNOWN: 0 };
  for (const c of classifications) by_status[c.status] += 1;
  const blockerCounts = new Map<ActivationBlocker, number>();
  for (const c of classifications) if (c.blocker) blockerCounts.set(c.blocker, (blockerCounts.get(c.blocker) ?? 0) + 1);

  const correlations: ActivationCorrelation[] = MILESTONES.map((m) => {
    const withM = companies.filter((c) => m.met(c));
    const withoutM = companies.filter((c) => !m.met(c));
    const aWith = withM.filter((c) => c.is_active).length;
    const aWithout = withoutM.filter((c) => c.is_active).length;
    return { milestone: m.stage, population_with: withM.length, activated_with: aWith, rate_with: pct(aWith, withM.length), population_without: withoutM.length, activated_without: aWithout, rate_without: pct(aWithout, withoutM.length) };
  });

  return {
    total, funnel,
    largest_dropoff: largest ? { stage: largest.stage, lost: largest.lost, loss_pct: largest.loss_pct } : null,
    by_status,
    by_blocker: Array.from(blockerCounts.entries()).map(([blocker, count]) => ({ blocker, count })).sort((a, b) => b.count - a.count || a.blocker.localeCompare(b.blocker)),
    activation_conversion_pct: pct(activated, total),
    correlations,
    classifications,
    unknown_gaps: [
      'FIRST_MEANINGFUL_ACTIVITY uses 30-day sign-in proxy (no product-event telemetry)',
      'GA/GSC/SOCIAL are connection-presence, not data-flow (12B)',
      'tenant_status=ACTIVE is activity-driven, not milestone-gated — funnel is independent reach, not strict',
    ],
  };
}

/** Map a readiness tenant to the activation input shape. */
export function activationFromReadiness(t: {
  company_id: string; company_name: string; created_at: string | null; tenant_status: string;
  company_profile_ready: ReadinessState; website_ready: ReadinessState; ga_ready: ReadinessState; gsc_ready: ReadinessState;
  social_ready: ReadinessState; team_ready: ReadinessState; active_user_count_30d: number;
}): ActivationCompany {
  return {
    company_id: t.company_id, company_name: t.company_name, created_at: t.created_at, is_active: t.tenant_status === 'ACTIVE',
    profile: t.company_profile_ready, domain: t.website_ready, ga: t.ga_ready, gsc: t.gsc_ready, social: t.social_ready, team: t.team_ready,
    active_user_count_30d: t.active_user_count_30d,
  };
}
