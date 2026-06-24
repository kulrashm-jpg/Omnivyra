/**
 * customerOperationsCockpitService.ts
 *
 * THE single READ-ONLY aggregation layer for the Customer Operations Command Center
 * (Phase 13A). Unifies readiness (12A/C) + opportunities (12D) + priority (12E) +
 * executive insights (12F) + evolution (12G/H) + company identity + signup-funnel
 * failures into one per-company view. NO business logic, NO recommendations, NO
 * mutations — only aggregation of existing sources.
 *
 * (Distinct from the unrelated enterprise-scoring `customerOperationsService.ts`.)
 */

import { supabase } from '../db/supabaseClient';
import { getCustomerReadiness, type CompanyReadiness, type TenantStatus, type ReadinessBucket } from './customerReadinessService';
import { detectCustomerOpportunities, type OpportunitySeverity } from './customerOpportunityService';
import { prioritizeCustomers, type PriorityTier } from './customerOpportunityPriorityService';
import { generatePortfolioInsights, type ExecutiveInsight } from './customerExecutiveInsightService';
import { loadReadinessHistory, computeCompanyEvolution, snapshotFromCurrent, generatePortfolioEvolution, type Trajectory } from './customerEvolutionService';
import { checkCompanyIdentityDrift } from './companyIdentityDriftService';
import { getCustomerOutcomes, type OutcomeClassification, type PortfolioOutcomes } from './customerOutcomeIntelligenceService';
import { getCustomerImpactAttribution, type AttributionStatus, type PortfolioImpact } from './customerImpactAttributionService';
import { getCustomerSignalConfidence, type ConfidenceLevel, type PortfolioSignalHealth } from './customerSignalConfidenceService';
import { getCustomerAcquisitionIntelligence, type AcquisitionResult } from './customerAcquisitionIntelligenceService';
import { generatePortfolioPlaybooks, type PlaybookCompanyInput, type RecommendedPlaybook, type PlaybookPortfolio } from './customerActionPlaybookService';
import { scoreCoverage, type TelemetryCoverageResult } from './customerTelemetryCoverageService';
import { getOnboardingConversion, type OnboardingConversionResult } from './onboardingConversionService';
import { analyzeActivation, activationFromReadiness, type ActivationResult } from './customerActivationService';
import { getProfileCompletion, type ProfileCompletionResult } from './profileCompletionIntelligenceService';
import { analyzeDigitalAdoption, adoptionFromReadiness, type DigitalAdoptionResult } from './digitalAdoptionService';
import { getCustomerValueRealization, loadValueCompanies, type ValueRealizationResult } from './customerValueRealizationService';
import { analyzeValueDrivers, buildDriverCompanies, type ValueDriverResult } from './valueDriverIntelligenceService';
import { analyzeCampaignExecution, type ExecutionAdoptionResult } from './campaignExecutionAdoptionService';
import { analyzeMonetization, buildMonetizationCompanies, type MonetizationResult } from './monetizationIntelligenceService';
import { analyzePopulationIntegrity, buildPopulationCompanies, type PopulationIntegrityResult } from './customerPopulationIntegrityService';
import { simulateInterventionPortfolio, type GovCompany, type SimulationResult } from './customerInterventionGovernanceService';
import { buildCustomerSuccessOperatingSystem, type OpsCompany, type OperatingSystemResult } from './customerSuccessOperatingSystemService';
import { simulatePortfolio, type SimInput, type SimulationPortfolio } from './customerInterventionSimulationService';
import { calculateRevenuePortfolio, loadRevenueEvents, type RevenueCompany, type RevenuePortfolio } from './customerRevenueIntelligenceService';
import { calculateDataFoundation, type FoundationResult } from './customerDataFoundationService';
import { VALUE_CATEGORIES } from './customerValueRealizationService';
import type { ReadinessArea, ReadinessState } from './customerReadinessService';

export type IdentityHealth = 'OK' | 'DRIFT' | 'UNKNOWN';

export interface CockpitCompany {
  company_id: string;
  company_name: string;
  website: string | null;
  website_domain: string | null;
  admin_email_domain: string | null;
  identity_health: IdentityHealth;
  tenant_status: TenantStatus;
  plan: string;
  paying: boolean;
  user_count: number;
  active_user_count_30d: number;
  readiness_score: number;
  readiness_bucket: ReadinessBucket;
  priority_score: number;
  priority_tier: PriorityTier;
  key_insight: ExecutiveInsight | null;
  primary_blocker: ExecutiveInsight | null;
  primary_opportunity: ExecutiveInsight | null;
  narrative: string;
  trajectory: Trajectory;
  score_delta: number | null;
  outcome_classification: OutcomeClassification;
  net_change: number | null;
  impact_status: AttributionStatus;
  overall_signal_confidence: ConfidenceLevel;
  stale_sources: number;
  low_confidence_sources: number;
  unknown_sources: number;
  recommended_playbooks: RecommendedPlaybook[];
  ga: string; gsc: string; social: string; community: string;
  opportunity_count: number;
  highest_severity: OpportunitySeverity | null;
  last_activity_at: string | null;
}

export type SignupFunnelBucket = 'PUBLIC_EMAIL' | 'DOMAIN_RESOLUTION_FAILED' | 'NO_WEBSITE_FOUND' | 'DOMAIN_NOT_CANONICAL' | 'FORWARDING_DOMAIN' | 'CLAIMED_DOMAIN';
export interface SignupFunnelEntry { bucket: SignupFunnelBucket; count: number; last_occurrence: string | null; affected_domains: string[]; }
export interface SignupFunnel { onboarded: number; total_failures: number; failures: SignupFunnelEntry[]; }

export interface CockpitFilters {
  status?: TenantStatus; plan?: string; priority?: PriorityTier; readiness?: ReadinessBucket; trajectory?: Trajectory; search?: string;
}

export interface CockpitResult {
  summary: {
    total_companies: number; active: number; dormant: number; inactive: number;
    paying: number; critical_priority: number; signup_failures: number; identity_drift: number;
  };
  companies: CockpitCompany[];
  signup_funnel: SignupFunnel;
  outcomes: PortfolioOutcomes;
  executive_outcome_summary: string[];
  impact: PortfolioImpact;
  signal_health: PortfolioSignalHealth;
  acquisition: AcquisitionResult;
  playbooks: PlaybookPortfolio;
  telemetry: TelemetryCoverageResult;
  onboarding_conversion: OnboardingConversionResult;
  activation: ActivationResult;
  profile_completion: ProfileCompletionResult;
  digital_adoption: DigitalAdoptionResult;
  value_realization: ValueRealizationResult;
  value_drivers: ValueDriverResult;
  execution_adoption: ExecutionAdoptionResult;
  monetization: MonetizationResult;
  population_integrity: PopulationIntegrityResult;
  intervention_governance: SimulationResult;
  operating_system: OperatingSystemResult;
  intervention_simulation: SimulationPortfolio;
  revenue_intelligence: RevenuePortfolio;
  data_foundation: FoundationResult;
  portfolio: {
    priority_distribution: Record<PriorityTier, number>;
    trajectory_distribution: Record<Trajectory, number>;
    top_blockers: ReturnType<typeof generatePortfolioInsights>['portfolio']['top_blockers'];
  };
}

const safe = async <T, F = T>(fn: () => Promise<T>, fb: F): Promise<T | F> => { try { return await fn(); } catch { return fb; } };

async function loadIdentity(ids: string[]): Promise<Map<string, { website: string | null; website_domain: string | null; admin_email_domain: string | null; identity_health: IdentityHealth }>> {
  const map = new Map<string, { website: string | null; website_domain: string | null; admin_email_domain: string | null; identity_health: IdentityHealth }>();
  if (ids.length === 0) return map;
  const rows = await safe(async () => {
    const { data } = await supabase.from('companies').select('id, name, website, website_domain, admin_email_domain').in('id', ids);
    return (data ?? []) as Array<{ id: string; name: string | null; website: string | null; website_domain: string | null; admin_email_domain: string | null }>;
  }, [] as Array<{ id: string; name: string | null; website: string | null; website_domain: string | null; admin_email_domain: string | null }>);
  for (const r of rows) {
    const drift = checkCompanyIdentityDrift(r);
    map.set(r.id, { website: r.website, website_domain: r.website_domain, admin_email_domain: r.admin_email_domain, identity_health: drift.hasDrift ? 'DRIFT' : 'OK' });
  }
  return map;
}

/**
 * Pure: map raw telemetry rows → the 6 signup-funnel buckets. Exported for tests.
 */
export function aggregateSignupFunnel(input: {
  eligibility: Array<{ domain?: string | null; reason?: string | null; checked_at?: string | null }>;
  events: Array<{ event_type?: string | null; final_domain?: string | null; created_at?: string | null }>;
  referrals: Array<{ domain?: string | null; last_attempt_at?: string | null }>;
  onboarded: number;
}): SignupFunnel {
  const agg: Record<SignupFunnelBucket, { count: number; last: string | null; domains: Set<string> }> = {
    PUBLIC_EMAIL: { count: 0, last: null, domains: new Set() },
    DOMAIN_RESOLUTION_FAILED: { count: 0, last: null, domains: new Set() },
    NO_WEBSITE_FOUND: { count: 0, last: null, domains: new Set() },
    DOMAIN_NOT_CANONICAL: { count: 0, last: null, domains: new Set() },
    FORWARDING_DOMAIN: { count: 0, last: null, domains: new Set() },
    CLAIMED_DOMAIN: { count: 0, last: null, domains: new Set() },
  };
  const bump = (b: SignupFunnelBucket, when: string | null | undefined, domain: string | null | undefined) => {
    agg[b].count += 1;
    if (when && (!agg[b].last || when > agg[b].last)) agg[b].last = when;
    if (domain) agg[b].domains.add(String(domain).toLowerCase());
  };
  for (const r of input.eligibility) {
    const reason = String(r.reason ?? '');
    if (/PUBLIC_EMAIL|public_provider/i.test(reason)) bump('PUBLIC_EMAIL', r.checked_at, r.domain);
    else if (/FORWARDING_DOMAIN|forwarding/i.test(reason)) bump('FORWARDING_DOMAIN', r.checked_at, r.domain);
    else if (/DOMAIN_NOT_CANONICAL/i.test(reason)) bump('DOMAIN_NOT_CANONICAL', r.checked_at, r.domain);
    else if (/NO_WEBSITE_FOUND/i.test(reason)) bump('NO_WEBSITE_FOUND', r.checked_at, r.domain);
  }
  for (const e of input.events) {
    const et = String(e.event_type ?? '');
    if (/DOMAIN_RESOLUTION_FAILED|RESOLUTION_BLOCKED/i.test(et)) bump('DOMAIN_RESOLUTION_FAILED', e.created_at, e.final_domain);
    else if (/DOMAIN_NOT_CANONICAL/i.test(et)) bump('DOMAIN_NOT_CANONICAL', e.created_at, e.final_domain);
    else if (/FORWARDING/i.test(et)) bump('FORWARDING_DOMAIN', e.created_at, e.final_domain);
  }
  for (const r of input.referrals) bump('CLAIMED_DOMAIN', r.last_attempt_at, r.domain);

  const failures: SignupFunnelEntry[] = (Object.keys(agg) as SignupFunnelBucket[]).map((bucket) => ({
    bucket, count: agg[bucket].count, last_occurrence: agg[bucket].last, affected_domains: Array.from(agg[bucket].domains).slice(0, 25),
  }));
  return { onboarded: input.onboarded, total_failures: failures.reduce((a, f) => a + f.count, 0), failures };
}

/** Signup-funnel failures from existing telemetry. Read-only; defensive. */
export async function loadSignupFunnel(): Promise<SignupFunnel> {
  const eligibility = await safe(async () => ((await supabase.from('domain_eligibility_cache').select('domain, reason, checked_at')).data ?? []) as any[], [] as any[]);
  const events = await safe(async () => ((await supabase.from('domain_events').select('event_type, final_domain, created_at')).data ?? []) as any[], [] as any[]);
  const referrals = await safe(async () => ((await supabase.from('signup_referrals').select('domain, last_attempt_at')).data ?? []) as any[], [] as any[]);
  const onboarded = await safe(async () => (await supabase.from('companies').select('id', { count: 'exact', head: true })).count ?? 0, 0);
  return aggregateSignupFunnel({ eligibility, events, referrals, onboarded });
}

/** Pure: filter + priority-sort the cockpit rows. Exported for tests. */
export function applyCockpitFilters(list: CockpitCompany[], f: CockpitFilters): CockpitCompany[] {
  const q = f.search?.trim().toLowerCase();
  return list.filter((c) =>
    (!f.status || c.tenant_status === f.status) &&
    (!f.plan || c.plan === f.plan) &&
    (!f.priority || c.priority_tier === f.priority) &&
    (!f.readiness || c.readiness_bucket === f.readiness) &&
    (!f.trajectory || c.trajectory === f.trajectory) &&
    (!q || `${c.company_name} ${c.company_id} ${c.website_domain ?? ''}`.toLowerCase().includes(q)),
  ).sort((a, b) => b.priority_score - a.priority_score || a.company_id.localeCompare(b.company_id));
}

/** Single aggregation entry point. Read-only. */
export async function getCustomerOperations(
  filters: CockpitFilters = {},
  deps: { loadFunnel?: () => Promise<SignupFunnel> } = {},
): Promise<CockpitResult> {
  const nowIso = new Date().toISOString();
  const readiness = await getCustomerReadiness({});
  const tenants = readiness.tenants;
  const ids = tenants.map((t) => t.company_id);

  const oppByCompany = new Map(detectCustomerOpportunities(tenants).per_company.map((c) => [c.company_id, c]));
  const prio = prioritizeCustomers(tenants);
  const prioByCompany = new Map(prio.ranked.map((p) => [p.company_id, p]));
  const ins = generatePortfolioInsights(tenants);
  const insByCompany = new Map(ins.per_company.map((c) => [c.company_id, c]));
  const history = await loadReadinessHistory(ids);
  const identity = await loadIdentity(ids);
  const signup_funnel = await (deps.loadFunnel ?? loadSignupFunnel)();
  const companyRefs = tenants.map((t) => ({ company_id: t.company_id, company_name: t.company_name }));
  const outcomesResult = await getCustomerOutcomes(companyRefs);
  const outcomeByCompany = new Map(outcomesResult.per_company.map((o) => [o.company_id, o]));
  const impactResult = await getCustomerImpactAttribution(companyRefs);
  const impactByCompany = new Map(impactResult.per_company.map((a) => [a.company_id, a]));
  const signalRefs = tenants.map((t) => ({
    company_id: t.company_id, company_name: t.company_name,
    areas: {
      COMPANY_PROFILE: t.company_profile_ready, WEBSITE: t.website_ready, GOOGLE_ANALYTICS: t.ga_ready,
      GOOGLE_SEARCH_CONSOLE: t.gsc_ready, SOCIAL_INTEGRATIONS: t.social_ready, COMMUNITY: t.community_ready,
      TEAM_MEMBERS: t.team_ready, BILLING: t.billing_ready,
    } as Record<ReadinessArea, ReadinessState>,
  }));
  const signalResult = await getCustomerSignalConfidence(signalRefs);
  const signalByCompany = new Map(signalResult.per_company.map((s) => [s.company_id, s]));

  // Acquisition (portfolio-level, pre-company funnel) over the full population.
  const acquisition = await getCustomerAcquisitionIntelligence({
    companies_total: tenants.length,
    active_total: tenants.filter((t) => t.tenant_status === 'ACTIVE').length,
  });
  const acquisitionComplete = acquisition.funnel.every((s) => s.measurable);

  // Onboarding conversion (portfolio-level; two cohorts) — active ids from readiness.
  const onboarding_conversion = await getOnboardingConversion({
    activeCompanyIds: tenants.filter((t) => t.tenant_status === 'ACTIVE').map((t) => t.company_id),
  });

  // Activation intelligence (pure over readiness; no new DB reads).
  const activation = analyzeActivation(tenants.map(activationFromReadiness), Date.now());

  // Profile completion intelligence (own loader; active ids from readiness).
  const profile_completion = await getProfileCompletion({
    activeCompanyIds: tenants.filter((t) => t.tenant_status === 'ACTIVE').map((t) => t.company_id),
  });

  // Digital adoption intelligence (pure over readiness; no new DB reads).
  const digital_adoption = analyzeDigitalAdoption(tenants.map(adoptionFromReadiness));

  // Value-signal counts loaded ONCE, shared by value-realization (14E), drivers (14F), execution (14G).
  const valueCtx = tenants.map((t) => ({ company_id: t.company_id, company_name: t.company_name, is_active: t.tenant_status === 'ACTIVE', is_paying: t.billing_ready === 'READY' }));
  const valueCompanies = await loadValueCompanies(valueCtx);
  const value_realization = await getCustomerValueRealization(valueCtx, { load: async () => valueCompanies });

  // Value driver association (pure; composes readiness + value-realization, no new DB reads).
  const valueByCompany = new Map(value_realization.classifications.map((c) => [c.company_id, { value_signals: c.value_signals as string[] }]));
  const value_drivers = analyzeValueDrivers(buildDriverCompanies(tenants, valueByCompany));

  // Execution adoption depth (pure over the same loaded value-signal counts).
  const execution_adoption = analyzeCampaignExecution(valueCompanies);

  // Monetization alignment (pure; composes billing + activation + execution/value volume).
  const monetizationValueBy = new Map(valueCompanies.map((v) => {
    const volume = VALUE_CATEGORIES.reduce((a, cat) => a + (v.signals[cat] ?? 0), 0);
    return [v.company_id, { value_present: VALUE_CATEGORIES.some((cat) => (v.signals[cat] ?? 0) > 0), volume }];
  }));
  const monetization = analyzeMonetization(buildMonetizationCompanies(tenants, monetizationValueBy));

  // Population integrity (pure; deterministic tenant classification + contamination, no new DB reads).
  const identityBy = new Map(tenants.map((t) => [t.company_id, { website_domain: identity.get(t.company_id)?.website_domain ?? null, admin_email_domain: identity.get(t.company_id)?.admin_email_domain ?? null, domain_verified: t.website_ready === 'READY' }]));
  const adoptionBy = new Map(digital_adoption.classifications.map((c) => [c.company_id, c.adoption_score]));
  const populationValueBy = new Map(valueCompanies.map((v) => [v.company_id, { has_value: VALUE_CATEGORIES.some((cat) => (v.signals[cat] ?? 0) > 0), volume: VALUE_CATEGORIES.reduce((a, cat) => a + (v.signals[cat] ?? 0), 0) }]));
  const population_integrity = analyzePopulationIntegrity(buildPopulationCompanies(tenants, identityBy, adoptionBy, populationValueBy));

  // Action playbooks (admin-only, read-only) — gap → playbook, gated by signal confidence.
  const playbookInputs: PlaybookCompanyInput[] = tenants.map((t) => {
    const sig = signalByCompany.get(t.company_id);
    const signal_confidence = Object.fromEntries((sig?.per_area ?? []).map((s) => [s.area, s.signal_confidence])) as Record<ReadinessArea, ConfidenceLevel>;
    return {
      company_id: t.company_id, company_name: t.company_name,
      priority_tier: prioByCompany.get(t.company_id)?.priority_tier ?? 'READ_ONLY',
      priority_score: prioByCompany.get(t.company_id)?.priority_score ?? 0,
      areas: signalRefs.find((r) => r.company_id === t.company_id)!.areas,
      signal_confidence,
      outcome_classification: outcomeByCompany.get(t.company_id)?.outcome_classification ?? 'NO_HISTORY',
      acquisition_evidence_complete: acquisitionComplete,
    };
  });
  const playbookResult = generatePortfolioPlaybooks(playbookInputs);
  const playbooksByCompany = new Map(playbookResult.per_company.map((c) => [c.company_id, c.recommended]));

  const evolutions: ReturnType<typeof computeCompanyEvolution>[] = [];
  const companiesAll: CockpitCompany[] = tenants.map((t: CompanyReadiness) => {
    const o = oppByCompany.get(t.company_id);
    const p = prioByCompany.get(t.company_id);
    const i = insByCompany.get(t.company_id);
    const id = identity.get(t.company_id);
    const evo = computeCompanyEvolution([...(history.get(t.company_id) ?? []), snapshotFromCurrent(t, nowIso, o?.opportunity_count ?? 0, p?.priority_tier ?? 'READ_ONLY')], t.company_name);
    evolutions.push(evo);
    return {
      company_id: t.company_id, company_name: t.company_name,
      website: id?.website ?? null, website_domain: id?.website_domain ?? null, admin_email_domain: id?.admin_email_domain ?? null,
      identity_health: id?.identity_health ?? 'UNKNOWN',
      tenant_status: t.tenant_status,
      plan: t.plan, paying: t.billing_ready === 'READY', user_count: t.user_count, active_user_count_30d: t.active_user_count_30d,
      readiness_score: t.overall_readiness_score, readiness_bucket: t.readiness_bucket,
      priority_score: p?.priority_score ?? 0, priority_tier: p?.priority_tier ?? 'READ_ONLY',
      key_insight: i?.key_insight ?? null, primary_blocker: i?.primary_blocker ?? null, primary_opportunity: i?.primary_opportunity ?? null, narrative: i?.narrative ?? '',
      trajectory: evo.trajectory, score_delta: evo.score_delta,
      outcome_classification: outcomeByCompany.get(t.company_id)?.outcome_classification ?? 'NO_HISTORY',
      net_change: outcomeByCompany.get(t.company_id)?.net_change ?? null,
      impact_status: impactByCompany.get(t.company_id)?.impact_status ?? 'INSUFFICIENT_DATA',
      overall_signal_confidence: signalByCompany.get(t.company_id)?.overall_signal_confidence ?? 'UNKNOWN',
      stale_sources: signalByCompany.get(t.company_id)?.stale_sources.length ?? 0,
      low_confidence_sources: signalByCompany.get(t.company_id)?.low_confidence_sources.length ?? 0,
      unknown_sources: signalByCompany.get(t.company_id)?.unknown_sources.length ?? 0,
      recommended_playbooks: playbooksByCompany.get(t.company_id) ?? [],
      ga: t.ga_ready, gsc: t.gsc_ready, social: t.social_ready, community: t.community_ready,
      opportunity_count: o?.opportunity_count ?? 0, highest_severity: o?.highest_severity ?? null,
      last_activity_at: t.last_activity_at,
    };
  });

  const companies = applyCockpitFilters(companiesAll, filters);

  // Intervention governance (pure; deterministic state + eligibility + suppression, no new DB reads).
  const populationClassBy = new Map(population_integrity.per_company.map((c) => [c.company_id, c.tenant_class]));
  const trajectoryBy = new Map(companiesAll.map((c) => [c.company_id, c.trajectory]));
  const govCompanies: GovCompany[] = tenants.map((t) => {
    const sig = signalByCompany.get(t.company_id);
    const sigConf = { COMPANY_PROFILE: 'UNKNOWN', WEBSITE: 'UNKNOWN', GOOGLE_ANALYTICS: 'UNKNOWN', GOOGLE_SEARCH_CONSOLE: 'UNKNOWN', SOCIAL_INTEGRATIONS: 'UNKNOWN', COMMUNITY: 'UNKNOWN', TEAM_MEMBERS: 'UNKNOWN', BILLING: 'UNKNOWN' } as Record<ReadinessArea, ConfidenceLevel>;
    for (const s of sig?.per_area ?? []) sigConf[s.area] = s.signal_confidence;
    const vc = valueCompanies.find((x) => x.company_id === t.company_id);
    return {
      company_id: t.company_id, company_name: t.company_name, tenant_class: populationClassBy.get(t.company_id) ?? 'UNKNOWN',
      areas: signalRefs.find((r) => r.company_id === t.company_id)!.areas,
      signal_confidence: sigConf, overall_confidence: sig?.overall_signal_confidence ?? 'UNKNOWN',
      is_active: t.tenant_status === 'ACTIVE', is_paying: t.billing_ready === 'READY',
      has_value: populationValueBy.get(t.company_id)?.has_value ?? false,
      value_category_count: VALUE_CATEGORIES.filter((cat) => (vc?.signals[cat] ?? 0) > 0).length,
      adoption_score: adoptionBy.get(t.company_id) ?? 0, execution_volume: populationValueBy.get(t.company_id)?.volume ?? 0,
      trajectory: trajectoryBy.get(t.company_id) ?? 'UNKNOWN', readiness_bucket: t.readiness_bucket,
      created_at: t.created_at, active_30d: t.active_user_count_30d,
    };
  });
  const intervention_governance = simulateInterventionPortfolio(govCompanies, Date.now());

  // Customer Success Operating System (pure; composes governance + priority + value, no new DB reads).
  const govByCompany = new Map(intervention_governance.per_company.map((g) => [g.company_id, g]));
  const opsCompanies: OpsCompany[] = tenants.map((t) => {
    const g = govByCompany.get(t.company_id)!;
    return {
      company_id: t.company_id, company_name: t.company_name, tenant_class: g.tenant_class,
      customer_state: g.customer_state, priority_score: prioByCompany.get(t.company_id)?.priority_score ?? 0, priority_tier: prioByCompany.get(t.company_id)?.priority_tier ?? 'READ_ONLY',
      eligible_interventions: g.eligible_interventions, globally_suppressed: g.globally_suppressed,
      has_value: populationValueBy.get(t.company_id)?.has_value ?? false, readiness_score: t.overall_readiness_score,
      overall_confidence: signalByCompany.get(t.company_id)?.overall_signal_confidence ?? 'UNKNOWN',
    };
  });
  const operating_system = buildCustomerSuccessOperatingSystem(opsCompanies);

  // Intervention simulation (pure; "if we acted" over governance output, no execution, no new DB reads).
  const simInputs: SimInput[] = intervention_governance.per_company.map((g) => ({ ...g, confidence: g.state_confidence }));
  const intervention_simulation = simulatePortfolio(simInputs);

  // Revenue intelligence (evidence-only; recorded revenue events, UNKNOWN otherwise).
  const revenueEventsBy = await loadRevenueEvents(ids);
  const revenueCompanies: RevenueCompany[] = tenants.map((t) => ({
    company_id: t.company_id, company_name: t.company_name, tenant_class: populationClassBy.get(t.company_id) ?? 'UNKNOWN',
    events: revenueEventsBy.get(t.company_id) ?? [],
    has_value: populationValueBy.get(t.company_id)?.has_value ?? false,
    adoption_score: adoptionBy.get(t.company_id) ?? 0, execution_volume: populationValueBy.get(t.company_id)?.volume ?? 0,
  }));
  const revenue_intelligence = calculateRevenuePortfolio(revenueCompanies);

  // Data foundation audit (pure; composes population + telemetry + confidence + revenue + value).
  const sh = signalResult.portfolio;
  const data_foundation = calculateDataFoundation({
    population: { total: population_integrity.portfolio_summary.total_companies, customer: population_integrity.portfolio_summary.counts.CUSTOMER, qa: population_integrity.portfolio_summary.counts.QA, test: population_integrity.portfolio_summary.counts.TEST, internal: population_integrity.portfolio_summary.counts.INTERNAL, unknown: population_integrity.portfolio_summary.counts.UNKNOWN },
    telemetry_coverage_pct: scoreCoverage().coverage_percentage,
    confidence: { high: sh.healthy_signals, low: sh.low_confidence_signals, unknown: sh.unknown_signals, medium: Math.max(0, (sh.per_area.length * tenants.length) - sh.healthy_signals - sh.low_confidence_signals - sh.unknown_signals) },
    revenue: { coverage_pct: revenue_intelligence.data_quality.revenue_coverage_pct ?? 0, customer_revenue_count: revenue_intelligence.data_quality.customer_class_with_revenue.CUSTOMER ?? 0, mrr_known: revenue_intelligence.mrr !== 'UNKNOWN' },
    value_coverage_pct: value_realization.funnel.find((f) => f.stage === 'VALUE_SIGNAL_PRESENT')?.conversion_pct ?? 0,
    // Audited entity joins: companies↔(profiles,domains,analytics,social,roles,value,canonical_revenue) joinable; ↔(signup_intents,engagement,community,invoices) NOT.
    joinability: { joinable: 7, total: 11 },
  });

  const evoPortfolio = generatePortfolioEvolution(evolutions);
  const summary = {
    total_companies: companies.length,
    active: companies.filter((c) => c.tenant_status === 'ACTIVE').length,
    dormant: companies.filter((c) => c.tenant_status === 'DORMANT').length,
    inactive: companies.filter((c) => c.tenant_status === 'INACTIVE').length,
    paying: companies.filter((c) => c.paying).length,
    critical_priority: companies.filter((c) => c.priority_tier === 'CRITICAL').length,
    signup_failures: signup_funnel.total_failures,
    identity_drift: companies.filter((c) => c.identity_health === 'DRIFT').length,
  };

  return {
    summary, companies, signup_funnel,
    outcomes: outcomesResult.portfolio,
    executive_outcome_summary: outcomesResult.executive_summary,
    impact: impactResult.portfolio,
    signal_health: signalResult.portfolio,
    acquisition,
    playbooks: playbookResult.portfolio,
    telemetry: scoreCoverage(),
    onboarding_conversion,
    activation,
    profile_completion,
    digital_adoption,
    value_realization,
    value_drivers,
    execution_adoption,
    monetization,
    population_integrity,
    intervention_governance,
    operating_system,
    intervention_simulation,
    revenue_intelligence,
    data_foundation,
    portfolio: { priority_distribution: prio.distribution, trajectory_distribution: evoPortfolio.trajectory_distribution, top_blockers: ins.portfolio.top_blockers },
  };
}
