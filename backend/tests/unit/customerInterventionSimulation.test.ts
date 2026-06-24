/**
 * Phase 15C — Intervention Simulation tests (pure, deterministic). Simulation only.
 */

import {
  simulateInterventions,
  simulatePerCustomer,
  analyzeCollisions,
  analyzeCapacity,
  simulatePortfolio,
  type SimInput,
} from '../../services/customerInterventionSimulationService';
import type { InterventionId } from '../../services/customerInterventionGovernanceService';
import type { TenantClass } from '../../services/customerPopulationIntegrityService';

const si = (over: Partial<SimInput> = {}): SimInput => ({
  company_id: 'c1', company_name: 'Acme', tenant_class: 'CUSTOMER' as TenantClass,
  customer_state: 'ADOPTING', state_confidence: 'MEDIUM', confidence: 'MEDIUM',
  globally_suppressed: false, eligible_interventions: [], ineligible_interventions: [],
  eligibility_evidence: [], state_evidence: [], global_suppression_reason: null, ...over,
} as SimInput);

const elig = (ids: InterventionId[]): SimInput['ineligible_interventions'] =>
  (['PROFILE_COMPLETION', 'DOMAIN_VERIFICATION', 'GA_CONNECTION', 'GSC_CONNECTION', 'SOCIAL_CONNECTION', 'TEAM_EXPANSION', 'VALUE_REALIZATION', 'ACTIVATION_RECOVERY', 'ADOPTION_EXPANSION', 'EXECUTION_EXPANSION'] as InterventionId[])
    .filter((id) => !ids.includes(id)).map((id) => ({ id, status: 'BLOCKED' as const, reason: 'no gap', severity: 'MEDIUM' as const }));

describe('simulateInterventions — per-intervention counts', () => {
  const companies = [
    si({ company_id: 'a', eligible_interventions: ['PROFILE_COMPLETION', 'GA_CONNECTION'], confidence: 'HIGH', ineligible_interventions: elig(['PROFILE_COMPLETION', 'GA_CONNECTION']) }),
    si({ company_id: 'qa', tenant_class: 'QA', globally_suppressed: true, eligible_interventions: [], ineligible_interventions: (['PROFILE_COMPLETION', 'DOMAIN_VERIFICATION', 'GA_CONNECTION', 'GSC_CONNECTION', 'SOCIAL_CONNECTION', 'TEAM_EXPANSION', 'VALUE_REALIZATION', 'ACTIVATION_RECOVERY', 'ADOPTION_EXPANSION', 'EXECUTION_EXPANSION'] as InterventionId[]).map((id) => ({ id, status: 'SUPPRESSED' as const, reason: 'POPULATION_INTEGRITY', severity: 'MEDIUM' as const })) }),
  ];
  const sims = simulateInterventions(companies);

  it('eligible + customer split + confidence distribution', () => {
    const prof = sims.find((s) => s.id === 'PROFILE_COMPLETION')!;
    expect(prof.eligible).toBe(1);
    expect(prof.customer_count).toBe(1);
    expect(prof.confidence_distribution.HIGH).toBe(1);
    expect(prof.non_customer_count).toBe(1); // qa
  });
  it('suppressed counted from non-customer', () => {
    const ga = sims.find((s) => s.id === 'GSC_CONNECTION')!;
    expect(ga.suppressed).toBe(1); // qa suppressed
    expect(ga.blocked).toBe(1);    // a blocked (no gap)
  });
});

describe('per-customer + collision + capacity', () => {
  const companies = [
    si({ company_id: 'a', company_name: 'Alpha', eligible_interventions: ['PROFILE_COMPLETION', 'GA_CONNECTION', 'VALUE_REALIZATION'] }), // 3 → collision
    si({ company_id: 'b', company_name: 'Beta', eligible_interventions: ['DOMAIN_VERIFICATION'] }), // 1
    si({ company_id: 'c', company_name: 'Gamma', eligible_interventions: [] }), // 0
    si({ company_id: 'qa', tenant_class: 'QA', globally_suppressed: true, eligible_interventions: [] }), // excluded
  ];
  const pc = simulatePerCustomer(companies);

  it('per-customer excludes non-customers; ranks by severity', () => {
    expect(pc.map((c) => c.company_id)).toEqual(['a', 'b', 'c']); // qa excluded
    const a = pc.find((c) => c.company_id === 'a')!;
    expect(a.highest_priority_intervention).toBe('PROFILE_COMPLETION'); // HIGH severity first
    expect(a.collision).toBe(true);
    expect(a.deferred_in_collision.length).toBe(2);
  });
  it('collision analysis', () => {
    const col = analyzeCollisions(pc);
    expect(col.collision_count).toBe(1); // only a
    expect(col.collision_matrix[0].count).toBeGreaterThanOrEqual(1);
  });
  it('capacity buckets', () => {
    const cap = analyzeCapacity(pc);
    expect(cap.eligible_customers).toBe(2);             // a,b
    expect(cap.customers_with_1_intervention).toBe(1);  // b
    expect(cap.customers_with_3_plus_interventions).toBe(1); // a
    expect(cap.total_eligible_interventions).toBe(4);   // 3 + 1
    expect(cap.queue_pressure).toBe(4);
  });
});

describe('simulatePortfolio', () => {
  const companies = [
    si({ company_id: 'a', company_name: 'Alpha', eligible_interventions: ['PROFILE_COMPLETION', 'GA_CONNECTION'], confidence: 'HIGH' }),
    si({ company_id: 'qa', tenant_class: 'QA', globally_suppressed: true, eligible_interventions: [] }),
  ];
  const r = simulatePortfolio(companies);

  it('portfolio summary excludes non-customers from eligible', () => {
    expect(r.portfolio_summary.customer_companies).toBe(1);
    expect(r.portfolio_summary.non_customer_excluded).toBe(1);
    expect(r.portfolio_summary.total_eligible).toBe(2); // a's 2 interventions
  });
  it('executive views: reach + eligibility rankings, non-customers excluded', () => {
    expect(r.executive.top_interventions_by_reach[0].eligible).toBeGreaterThanOrEqual(1);
    expect(r.executive.top_customers_by_eligibility[0].company_id).toBe('a');
    expect(r.executive.top_customers_by_eligibility.find((c) => c.company_id === 'qa')).toBeUndefined();
  });
  it('deterministic', () => {
    expect(JSON.stringify(simulatePortfolio(companies))).toBe(JSON.stringify(r));
  });
});
