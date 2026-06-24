/**
 * Phase 15B — Customer Success Operating System tests (pure, deterministic). Visibility only.
 */

import {
  queuesFor,
  buildCustomerQueues,
  buildExecutiveAttentionList,
  analyzeWorkload,
  buildCustomerSuccessOperatingSystem,
  type OpsCompany,
} from '../../services/customerSuccessOperatingSystemService';

const oc = (over: Partial<OpsCompany> = {}): OpsCompany => ({
  company_id: 'c1', company_name: 'Acme', tenant_class: 'CUSTOMER', customer_state: 'ADOPTING',
  priority_score: 50, priority_tier: 'MEDIUM', eligible_interventions: [], globally_suppressed: false,
  has_value: false, readiness_score: 40, overall_confidence: 'HIGH', ...over,
});

describe('queuesFor — queue assignment (CUSTOMER only)', () => {
  it('non-customer → no queues (governance enforced)', () => {
    expect(queuesFor(oc({ tenant_class: 'QA', globally_suppressed: true }))).toEqual([]);
    expect(queuesFor(oc({ tenant_class: 'INTERNAL' }))).toEqual([]);
  });
  it('AT_RISK / CHURNED → RETENTION', () => {
    expect(queuesFor(oc({ customer_state: 'AT_RISK' })).map((q) => q.queue)).toEqual(['RETENTION']);
    expect(queuesFor(oc({ customer_state: 'CHURNED' })).map((q) => q.queue)).toEqual(['RETENTION']);
  });
  it('EXPANDING / VALUE_REALIZING → EXPANSION', () => {
    expect(queuesFor(oc({ customer_state: 'EXPANDING' })).map((q) => q.queue)).toEqual(['EXPANSION']);
  });
  it('ADOPTING with adoption + value interventions → ADOPTION + VALUE (multiple)', () => {
    const qs = queuesFor(oc({ customer_state: 'ADOPTING', eligible_interventions: ['GA_CONNECTION', 'VALUE_REALIZATION'] })).map((q) => q.queue);
    expect(qs).toEqual(expect.arrayContaining(['ADOPTION', 'VALUE']));
    expect(qs.length).toBe(2);
  });
  it('ACTIVATING with activation interventions → ACTIVATION', () => {
    expect(queuesFor(oc({ customer_state: 'ACTIVATING', eligible_interventions: ['PROFILE_COMPLETION'] })).map((q) => q.queue)).toContain('ACTIVATION');
  });
  it('customer with no eligible interventions → OBSERVATION', () => {
    expect(queuesFor(oc({ customer_state: 'ADOPTING', eligible_interventions: [] })).map((q) => q.queue)).toEqual(['OBSERVATION']);
  });
});

describe('buildCustomerQueues + workload', () => {
  const companies: OpsCompany[] = [
    oc({ company_id: 'a', company_name: 'Alpha', customer_state: 'ADOPTING', priority_score: 80, eligible_interventions: ['GA_CONNECTION', 'VALUE_REALIZATION'] }),
    oc({ company_id: 'b', company_name: 'Beta', customer_state: 'AT_RISK', priority_score: 60 }),
    oc({ company_id: 'c', company_name: 'Gamma', customer_state: 'ADOPTING', priority_score: 90, eligible_interventions: [] }), // observation
    oc({ company_id: 'qa', company_name: 'QA1', tenant_class: 'QA', globally_suppressed: true, customer_state: 'AT_RISK' }),
  ];
  const q = buildCustomerQueues(companies);

  it('queues populated, sorted by priority desc', () => {
    expect(q.adoption_queue.map((e) => e.company_id)).toEqual(['a']);
    expect(q.value_queue.map((e) => e.company_id)).toEqual(['a']);
    expect(q.retention_queue.map((e) => e.company_id)).toEqual(['b']); // qa excluded
    expect(q.observation_queue.map((e) => e.company_id)).toEqual(['c']);
  });
  it('non-customer excluded from all queues', () => {
    const all = [...q.activation_queue, ...q.adoption_queue, ...q.value_queue, ...q.retention_queue, ...q.expansion_queue, ...q.observation_queue];
    expect(all.find((e) => e.company_id === 'qa')).toBeUndefined();
  });
  it('workload analysis', () => {
    const w = analyzeWorkload(companies);
    expect(w.customer_companies).toBe(3);
    expect(w.suppressed_companies).toBe(1); // qa
    expect(w.customer_companies_with_multiple_queues).toBe(1); // a (adoption+value)
    expect(w.customer_companies_without_actionable_queue).toBe(1); // c (observation only)
    expect(w.companies_per_queue.RETENTION).toBe(1);
  });
});

describe('buildExecutiveAttentionList', () => {
  const companies: OpsCompany[] = [
    oc({ company_id: 'risk', company_name: 'Risk', customer_state: 'AT_RISK', priority_score: 70, overall_confidence: 'HIGH' }),
    oc({ company_id: 'adopt', company_name: 'Adopt', customer_state: 'ADOPTING', priority_score: 80, has_value: true, overall_confidence: 'MEDIUM' }),
    oc({ company_id: 'qa', tenant_class: 'TEST', globally_suppressed: true, priority_score: 100 }),
  ];
  it('ranks customers by attention score; excludes non-customers', () => {
    const { top_5 } = buildExecutiveAttentionList(companies);
    expect(top_5.find((e) => e.company_id === 'qa')).toBeUndefined(); // TEST excluded despite priority 100
    expect(top_5).toHaveLength(2);
    // risk: 70 + 30(AT_RISK) + 0 + 5 = 105; adopt: 80 + 15 + 5 + 2 = 102 → risk first
    expect(top_5[0].company_id).toBe('risk');
  });
  it('deterministic', () => {
    expect(JSON.stringify(buildCustomerSuccessOperatingSystem(companies))).toBe(JSON.stringify(buildCustomerSuccessOperatingSystem(companies)));
  });
});
