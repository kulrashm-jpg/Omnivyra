/**
 * digitalAdoptionService.ts
 *
 * READ-ONLY, deterministic intelligence on adoption of Omnivyra's digital foundations after
 * company creation. Pure functions over readiness data (no new DB reads). Evidence-only, no
 * inference, no causality, no writes/recommendations.
 *
 * The adoption funnel is non-strict (ACTIVATED is activity-driven, not capability-gated), so
 * it reports INDEPENDENT stage-reach; capability↔activation links are ASSOCIATION only.
 */

import type { ReadinessState } from './customerReadinessService';

export type Capability = 'PROFILE' | 'DOMAIN_VERIFICATION' | 'GA' | 'GSC' | 'SOCIAL' | 'TEAM' | 'BILLING';
export type AdoptionState = 'NOT_STARTED' | 'PARTIAL' | 'ADOPTED' | 'UNKNOWN';
export type AdoptionStatus = 'ADOPTED' | 'PARTIAL' | 'NOT_STARTED' | 'UNKNOWN';
export type AdoptionStage = 'COMPANY_CREATED' | 'PROFILE_READY' | 'DOMAIN_VERIFIED' | 'GA_CONNECTED' | 'GSC_CONNECTED' | 'SOCIAL_CONNECTED' | 'TEAM_ESTABLISHED' | 'BILLING_ACTIVE' | 'ACTIVATED';
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';

export const CAPABILITIES: Capability[] = ['PROFILE', 'DOMAIN_VERIFICATION', 'GA', 'GSC', 'SOCIAL', 'TEAM', 'BILLING'];
const CAP_TO_STAGE: Record<Capability, AdoptionStage> = {
  PROFILE: 'PROFILE_READY', DOMAIN_VERIFICATION: 'DOMAIN_VERIFIED', GA: 'GA_CONNECTED', GSC: 'GSC_CONNECTED',
  SOCIAL: 'SOCIAL_CONNECTED', TEAM: 'TEAM_ESTABLISHED', BILLING: 'BILLING_ACTIVE',
};

export interface AdoptionCompany { company_id: string; company_name: string; is_active: boolean; capabilities: Record<Capability, AdoptionState>; }

/** Map a readiness state to an adoption state. (Readiness is binary; PARTIAL has no source signal yet.) */
const toAdoption = (s: ReadinessState): AdoptionState => (s === 'READY' ? 'ADOPTED' : s === 'UNKNOWN' ? 'UNKNOWN' : 'NOT_STARTED');

export function adoptionFromReadiness(t: {
  company_id: string; company_name: string; tenant_status: string;
  company_profile_ready: ReadinessState; website_ready: ReadinessState; ga_ready: ReadinessState; gsc_ready: ReadinessState;
  social_ready: ReadinessState; team_ready: ReadinessState; billing_ready: ReadinessState;
}): AdoptionCompany {
  return {
    company_id: t.company_id, company_name: t.company_name, is_active: t.tenant_status === 'ACTIVE',
    capabilities: {
      PROFILE: toAdoption(t.company_profile_ready), DOMAIN_VERIFICATION: toAdoption(t.website_ready),
      GA: toAdoption(t.ga_ready), GSC: toAdoption(t.gsc_ready), SOCIAL: toAdoption(t.social_ready),
      TEAM: toAdoption(t.team_ready), BILLING: toAdoption(t.billing_ready),
    },
  };
}

export interface AdoptionClassification {
  company_id: string; company_name: string;
  adoption_score: number; adoption_status: AdoptionStatus;
  adopted_capabilities: Capability[]; missing_capabilities: Capability[];
  evidence: string; confidence: Confidence;
}

const isAdopted = (c: AdoptionCompany, cap: Capability) => c.capabilities[cap] === 'ADOPTED';

/** Pure: per-company adoption score + status. */
export function classifyAdoption(c: AdoptionCompany): AdoptionClassification {
  const adopted_capabilities = CAPABILITIES.filter((cap) => isAdopted(c, cap));
  const missing_capabilities = CAPABILITIES.filter((cap) => c.capabilities[cap] === 'NOT_STARTED');
  const unknowns = CAPABILITIES.filter((cap) => c.capabilities[cap] === 'UNKNOWN');
  const adoption_score = Math.round((adopted_capabilities.length / CAPABILITIES.length) * 100);
  const adoption_status: AdoptionStatus =
    unknowns.length === CAPABILITIES.length ? 'UNKNOWN' :
    adopted_capabilities.length === CAPABILITIES.length ? 'ADOPTED' :
    adopted_capabilities.length === 0 ? 'NOT_STARTED' : 'PARTIAL';
  return {
    company_id: c.company_id, company_name: c.company_name, adoption_score, adoption_status,
    adopted_capabilities, missing_capabilities,
    evidence: `adopted: ${adopted_capabilities.join(', ') || 'none'}`,
    confidence: unknowns.length === 0 ? 'HIGH' : 'MEDIUM',
  };
}

export interface StageReach { stage: AdoptionStage; reached: number; lost: number; loss_pct: number | null; conversion_pct: number | null; }
export interface CapabilityGap { capability: Capability; ready: number; missing: number; rate_when_present: number | null; rate_when_absent: number | null; }
export interface AdoptionPath { path: string; count: number; activated: number; activation_rate: number | null; }

export interface DigitalAdoptionResult {
  total: number;
  funnel: StageReach[];
  by_status: Record<AdoptionStatus, number>;
  mean_adoption_score: number | null;
  capability_matrix: CapabilityGap[];
  top_missing_capabilities: CapabilityGap[];
  paths_activated: AdoptionPath[];
  paths_non_activated: AdoptionPath[];
  classifications: AdoptionClassification[];
  unknown_gaps: string[];
}

const pct = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

/** Pure: full adoption analysis over the company population. */
export function analyzeDigitalAdoption(companies: AdoptionCompany[]): DigitalAdoptionResult {
  const total = companies.length;
  const activated = companies.filter((c) => c.is_active).length;
  const reach = (cap: Capability) => companies.filter((c) => isAdopted(c, cap)).length;

  const funnel: StageReach[] = [
    { stage: 'COMPANY_CREATED', reached: total, lost: 0, loss_pct: 0, conversion_pct: 100 },
    ...CAPABILITIES.map((cap) => { const r = reach(cap); return { stage: CAP_TO_STAGE[cap], reached: r, lost: total - r, loss_pct: pct(total - r, total), conversion_pct: pct(r, total) }; }),
    { stage: 'ACTIVATED', reached: activated, lost: total - activated, loss_pct: pct(total - activated, total), conversion_pct: pct(activated, total) },
  ];

  const classifications = companies.map(classifyAdoption);
  const by_status: Record<AdoptionStatus, number> = { ADOPTED: 0, PARTIAL: 0, NOT_STARTED: 0, UNKNOWN: 0 };
  for (const c of classifications) by_status[c.adoption_status] += 1;
  const mean_adoption_score = total ? Math.round((classifications.reduce((a, c) => a + c.adoption_score, 0) / total) * 10) / 10 : null;

  const capability_matrix: CapabilityGap[] = CAPABILITIES.map((cap) => {
    const present = companies.filter((c) => isAdopted(c, cap));
    const absent = companies.filter((c) => !isAdopted(c, cap));
    return { capability: cap, ready: present.length, missing: absent.length, rate_when_present: pct(present.filter((c) => c.is_active).length, present.length), rate_when_absent: pct(absent.filter((c) => c.is_active).length, absent.length) };
  });

  // Path = sorted signature of adopted capabilities.
  const sig = (c: AdoptionCompany) => CAPABILITIES.filter((cap) => isAdopted(c, cap)).join('+') || 'NONE';
  const pathStats = (subset: AdoptionCompany[]): AdoptionPath[] => {
    const m = new Map<string, { count: number; activated: number }>();
    for (const c of subset) { const k = sig(c); const e = m.get(k) ?? { count: 0, activated: 0 }; e.count += 1; if (c.is_active) e.activated += 1; m.set(k, e); }
    return Array.from(m.entries()).map(([path, v]) => ({ path, count: v.count, activated: v.activated, activation_rate: pct(v.activated, v.count) })).sort((a, b) => b.count - a.count || a.path.localeCompare(b.path));
  };

  return {
    total, funnel, by_status, mean_adoption_score,
    capability_matrix,
    top_missing_capabilities: [...capability_matrix].sort((a, b) => b.missing - a.missing || a.capability.localeCompare(b.capability)).slice(0, 5),
    paths_activated: pathStats(companies.filter((c) => c.is_active)).slice(0, 5),
    paths_non_activated: pathStats(companies.filter((c) => !c.is_active)).slice(0, 5),
    classifications,
    unknown_gaps: [
      'PARTIAL adoption state has no source signal (readiness is binary READY/NOT_READY)',
      'GA/GSC/SOCIAL are connection-presence, not data-flow (12B)',
      'ACTIVATED is activity-driven, not capability-gated — funnel is independent reach',
    ],
  };
}
