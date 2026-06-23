/**
 * customerTelemetryCoverageService.ts
 *
 * READ-ONLY audit of the Customer Operations platform's observability. Deterministic
 * scoring over a STRUCTURAL CATALOG of every telemetry signal/stage, classified by the
 * evidence gathered across phases 13A–13G. No inference, no writes, no schema/telemetry
 * changes — audit and visibility only.
 *
 * Observability classes:
 *   COMPLETE     — fully observable, persisted, trustworthy
 *   PARTIAL      — observable with gaps (coverage / freshness / confidence / history)
 *   UNKNOWN      — could be observed but is not persisted/linked (a fixable gap)
 *   UNOBSERVABLE — structurally impossible to observe with the current architecture
 */

export type ObservabilityClass = 'COMPLETE' | 'PARTIAL' | 'UNKNOWN' | 'UNOBSERVABLE';
export type TelemetryDomain = 'ACQUISITION' | 'READINESS' | 'OPERATIONS' | 'EVOLUTION' | 'OUTCOMES' | 'ATTRIBUTION' | 'PLAYBOOKS';
export type ImpactBand = 'HIGH' | 'MEDIUM' | 'LOW';
export type EngineName = 'READINESS' | 'OPPORTUNITY' | 'PRIORITY' | 'INSIGHTS' | 'EVOLUTION' | 'OUTCOMES' | 'ATTRIBUTION' | 'SIGNAL_CONFIDENCE' | 'ACQUISITION' | 'PLAYBOOKS';

export interface TelemetryItem {
  id: string;
  label: string;
  domain: TelemetryDomain;
  observability: ObservabilityClass;
  source: string;
  missing: string | null;
  reason: string;
  impact: ImpactBand;
  consumers: EngineName[];
  temporal?: boolean; // observability resolves over time (e.g. snapshot history accrual)
}

/** The structural telemetry catalog (audit findings from 13A–13G, deterministic). */
export const TELEMETRY_CATALOG: TelemetryItem[] = [
  // ── Acquisition ──
  { id: 'VISITOR', label: 'Visitor traffic', domain: 'ACQUISITION', observability: 'UNOBSERVABLE', source: '(none)', missing: 'web-analytics integration', reason: 'no source captures pre-signup traffic', impact: 'LOW', consumers: ['ACQUISITION'] },
  { id: 'SIGNUP_STARTED', label: 'Signup started', domain: 'ACQUISITION', observability: 'PARTIAL', source: 'signup_intents', missing: 'invite/manual entries', reason: 'invites bypass signup_intents (24 intents vs 38 companies)', impact: 'MEDIUM', consumers: ['ACQUISITION'] },
  { id: 'EMAIL_VERIFIED', label: 'Email verified', domain: 'ACQUISITION', observability: 'UNKNOWN', source: 'auth.users.email_confirmed_at', missing: 'public-schema mirror', reason: 'auth schema not exposed via PostgREST', impact: 'MEDIUM', consumers: ['ACQUISITION'] },
  { id: 'IDENTITY_VALIDATED', label: 'Identity validated', domain: 'ACQUISITION', observability: 'UNKNOWN', source: 'validation verdict (not persisted)', missing: 'per-signup verdict persistence', reason: 'verdict computed at signup, never stored', impact: 'MEDIUM', consumers: ['ACQUISITION'] },
  { id: 'COMPANY_CREATED', label: 'Company created', domain: 'ACQUISITION', observability: 'COMPLETE', source: 'companies', missing: null, reason: 'row-level evidence', impact: 'HIGH', consumers: ['ACQUISITION', 'READINESS'] },
  { id: 'PROFILE_COMPLETED', label: 'Profile completed', domain: 'ACQUISITION', observability: 'COMPLETE', source: 'company_profiles (overall_confidence >= 60)', missing: null, reason: 'row-level evidence', impact: 'HIGH', consumers: ['ACQUISITION', 'READINESS'] },
  { id: 'ACTIVE_CUSTOMER', label: 'Active customer', domain: 'ACQUISITION', observability: 'COMPLETE', source: 'readiness tenant_status', missing: null, reason: 'derived deterministically', impact: 'HIGH', consumers: ['ACQUISITION', 'PRIORITY'] },
  { id: 'ACQUISITION_LOSS_REASON', label: 'Acquisition loss reason', domain: 'ACQUISITION', observability: 'PARTIAL', source: 'signup_referrals + domain_eligibility_cache', missing: 'abandonment-stage capture', reason: 'pending intents carry no granular reason', impact: 'MEDIUM', consumers: ['ACQUISITION'] },

  // ── Readiness ──
  { id: 'COMPANY_PROFILE', label: 'Company profile readiness', domain: 'READINESS', observability: 'COMPLETE', source: 'company_profiles (overall_confidence, last_refined_at)', missing: null, reason: 'authoritative + timestamped', impact: 'HIGH', consumers: ['READINESS', 'SIGNAL_CONFIDENCE', 'PLAYBOOKS'] },
  { id: 'WEBSITE', label: 'Website verification', domain: 'READINESS', observability: 'COMPLETE', source: 'company_domains (verified, verified_at)', missing: null, reason: 'authoritative + timestamped', impact: 'HIGH', consumers: ['READINESS', 'ATTRIBUTION', 'PLAYBOOKS'] },
  { id: 'GOOGLE_ANALYTICS', label: 'GA integration', domain: 'READINESS', observability: 'PARTIAL', source: 'analytics_integrations (provider GA4)', missing: 'deep data-flow validation', reason: 'connection-presence only (12B); capped MEDIUM', impact: 'MEDIUM', consumers: ['READINESS', 'OPPORTUNITY', 'ATTRIBUTION', 'PLAYBOOKS'] },
  { id: 'GOOGLE_SEARCH_CONSOLE', label: 'GSC integration', domain: 'READINESS', observability: 'PARTIAL', source: 'analytics_integrations (provider GSC)', missing: 'deep data-flow validation', reason: 'connection-presence only (12B)', impact: 'MEDIUM', consumers: ['READINESS', 'OPPORTUNITY', 'ATTRIBUTION', 'PLAYBOOKS'] },
  { id: 'SOCIAL_INTEGRATIONS', label: 'Social integrations', domain: 'READINESS', observability: 'PARTIAL', source: 'social_accounts', missing: 'deep posting-capability validation', reason: 'connection-presence + refresh state', impact: 'MEDIUM', consumers: ['READINESS', 'OPPORTUNITY', 'PLAYBOOKS'] },
  { id: 'TEAM_MEMBERS', label: 'Team members', domain: 'READINESS', observability: 'COMPLETE', source: 'user_company_roles (accepted_at)', missing: null, reason: 'authoritative + timestamped', impact: 'LOW', consumers: ['READINESS', 'PLAYBOOKS'] },
  { id: 'BILLING', label: 'Billing / plan', domain: 'READINESS', observability: 'PARTIAL', source: 'organization_plan_assignments / organization_credits', missing: 'per-company freshness (org-keyed; assignment table empty)', reason: 'org-scoped, no company-level timestamp', impact: 'HIGH', consumers: ['READINESS', 'PRIORITY', 'PLAYBOOKS'] },
  { id: 'COMMUNITY', label: 'Community', domain: 'READINESS', observability: 'UNOBSERVABLE', source: '(none)', missing: 'community data source', reason: 'no community source exists', impact: 'LOW', consumers: ['READINESS'] },

  // ── Operations (deterministic derivations) ──
  { id: 'OPPORTUNITIES', label: 'Opportunity detection', domain: 'OPERATIONS', observability: 'COMPLETE', source: 'derived from readiness', missing: null, reason: 'deterministic', impact: 'HIGH', consumers: ['OPPORTUNITY', 'PRIORITY', 'INSIGHTS'] },
  { id: 'PRIORITY', label: 'Priority scoring', domain: 'OPERATIONS', observability: 'COMPLETE', source: 'derived from readiness + opportunities', missing: null, reason: 'deterministic', impact: 'HIGH', consumers: ['PRIORITY'] },
  { id: 'EXECUTIVE_INSIGHTS', label: 'Executive insights', domain: 'OPERATIONS', observability: 'COMPLETE', source: 'derived from readiness', missing: null, reason: 'deterministic narrative templates', impact: 'MEDIUM', consumers: ['INSIGHTS'] },
  { id: 'SIGNAL_CONFIDENCE', label: 'Signal confidence', domain: 'OPERATIONS', observability: 'COMPLETE', source: 'derived from source timestamps', missing: null, reason: 'deterministic', impact: 'HIGH', consumers: ['SIGNAL_CONFIDENCE', 'PLAYBOOKS'] },

  // ── Evolution (temporal) ──
  { id: 'SNAPSHOT_HISTORY', label: 'Readiness snapshot history', domain: 'EVOLUTION', observability: 'PARTIAL', source: 'customer_readiness_snapshots', missing: '>= 2 daily snapshots', reason: 'day-1 only; grows daily once cron runs', impact: 'HIGH', consumers: ['EVOLUTION', 'OUTCOMES', 'ATTRIBUTION'], temporal: true },
  { id: 'EVOLUTION_TRAJECTORY', label: 'Evolution trajectory', domain: 'EVOLUTION', observability: 'PARTIAL', source: 'derived from snapshots', missing: '2nd snapshot day', reason: 'UNKNOWN until >= 2 snapshots', impact: 'MEDIUM', consumers: ['EVOLUTION'], temporal: true },

  // ── Outcomes (temporal) ──
  { id: 'OUTCOME_CLASSIFICATION', label: 'Outcome classification', domain: 'OUTCOMES', observability: 'PARTIAL', source: 'derived from snapshots', missing: '2nd snapshot day', reason: 'NO_HISTORY until >= 2 snapshots', impact: 'MEDIUM', consumers: ['OUTCOMES'], temporal: true },

  // ── Attribution (temporal) ──
  { id: 'IMPACT_ATTRIBUTION', label: 'Impact attribution', domain: 'ATTRIBUTION', observability: 'PARTIAL', source: 'derived from snapshot area-flips', missing: '2nd snapshot day + event-level timestamps', reason: 'INSUFFICIENT_DATA until day 2; co-observed within day', impact: 'MEDIUM', consumers: ['ATTRIBUTION'], temporal: true },
  { id: 'INTERVENTION_EVENTS', label: 'Intervention events', domain: 'ATTRIBUTION', observability: 'PARTIAL', source: 'company_domains / analytics_integrations / social_accounts timestamps', missing: 'direct event→outcome linkage', reason: 'engine uses snapshot proxy, not event timestamps', impact: 'LOW', consumers: ['ATTRIBUTION'] },

  // ── Playbooks (deterministic) ──
  { id: 'PLAYBOOK_GENERATION', label: 'Playbook generation', domain: 'PLAYBOOKS', observability: 'COMPLETE', source: 'derived from readiness + confidence', missing: null, reason: 'deterministic rules', impact: 'HIGH', consumers: ['PLAYBOOKS'] },
  { id: 'PLAYBOOK_SUPPRESSION', label: 'Playbook suppression', domain: 'PLAYBOOKS', observability: 'COMPLETE', source: 'derived from signal confidence', missing: null, reason: 'deterministic rules', impact: 'MEDIUM', consumers: ['PLAYBOOKS'] },
];

const IMPACT_RANK: Record<ImpactBand, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };

export interface DomainCoverage {
  domain: TelemetryDomain;
  total: number; complete: number; partial: number; unknown: number; unobservable: number;
  coverage_percentage: number | null;
}
export interface TelemetryCoverageResult {
  total_signals: number;
  fully_observable_signals: number;
  partially_observable_signals: number;
  unknown_signals: number;
  unobservable_signals: number;
  coverage_percentage: number;
  by_domain: DomainCoverage[];
  largest_gaps: DomainCoverage[];
  highest_impact_blind_spots: TelemetryItem[];
  most_frequent_unknown_states: TelemetryItem[];
  no_history_states: TelemetryItem[];
  dependency_chains_affected: Array<{ item: string; observability: ObservabilityClass; consumers: EngineName[] }>;
}

/** Coverage % = (complete + 0.5·partial) / (complete + partial + unknown). UNOBSERVABLE excluded from the denominator (out of architectural scope). */
function coverageOf(complete: number, partial: number, unknown: number): number | null {
  const denom = complete + partial + unknown;
  if (denom === 0) return null;
  return Math.round(((complete + 0.5 * partial) / denom) * 1000) / 10;
}

const DOMAINS: TelemetryDomain[] = ['ACQUISITION', 'READINESS', 'OPERATIONS', 'EVOLUTION', 'OUTCOMES', 'ATTRIBUTION', 'PLAYBOOKS'];

/** Pure, deterministic coverage scoring over the catalog. */
export function scoreCoverage(items: TelemetryItem[] = TELEMETRY_CATALOG): TelemetryCoverageResult {
  const count = (subset: TelemetryItem[], c: ObservabilityClass) => subset.filter((i) => i.observability === c).length;
  const by_domain: DomainCoverage[] = DOMAINS.map((domain) => {
    const subset = items.filter((i) => i.domain === domain);
    const complete = count(subset, 'COMPLETE'), partial = count(subset, 'PARTIAL'), unknown = count(subset, 'UNKNOWN'), unobservable = count(subset, 'UNOBSERVABLE');
    return { domain, total: subset.length, complete, partial, unknown, unobservable, coverage_percentage: coverageOf(complete, partial, unknown) };
  }).filter((d) => d.total > 0);

  const fully = count(items, 'COMPLETE'), partially = count(items, 'PARTIAL'), unknown = count(items, 'UNKNOWN'), unobservable = count(items, 'UNOBSERVABLE');
  const blindSpots = items.filter((i) => i.observability === 'UNKNOWN' || i.observability === 'UNOBSERVABLE');

  return {
    total_signals: items.length,
    fully_observable_signals: fully,
    partially_observable_signals: partially,
    unknown_signals: unknown,
    unobservable_signals: unobservable,
    coverage_percentage: coverageOf(fully, partially, unknown) ?? 0,
    by_domain,
    largest_gaps: [...by_domain].sort((a, b) => (a.coverage_percentage ?? 101) - (b.coverage_percentage ?? 101) || a.domain.localeCompare(b.domain)),
    highest_impact_blind_spots: [...blindSpots].sort((a, b) => IMPACT_RANK[b.impact] - IMPACT_RANK[a.impact] || a.id.localeCompare(b.id)),
    most_frequent_unknown_states: items.filter((i) => i.observability === 'UNKNOWN'),
    no_history_states: items.filter((i) => i.temporal === true),
    dependency_chains_affected: blindSpots.map((i) => ({ item: i.id, observability: i.observability, consumers: i.consumers })),
  };
}
