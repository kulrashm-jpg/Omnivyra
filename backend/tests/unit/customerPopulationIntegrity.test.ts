/**
 * Phase 14I — Customer Population Integrity tests (pure, deterministic, evidence-based).
 */

import {
  classifyTenant,
  analyzePopulationIntegrity,
  type TenantIdentity,
  type PopulationCompany,
} from '../../services/customerPopulationIntegrityService';

const id = (over: Partial<TenantIdentity> = {}): TenantIdentity => ({
  company_id: 'c1', company_name: 'Acme Inc', website_domain: 'acme.com', admin_email_domain: 'acme.com', domain_verified: false, ...over,
});

describe('classifyTenant — evidence hierarchy (TEST > QA > DEMO > INTERNAL > CUSTOMER > UNKNOWN)', () => {
  it('TEST by name or placeholder domain', () => {
    expect(classifyTenant(id({ company_name: 'Ingestion Activation Test', website_domain: 'python.org' })).tenant_class).toBe('TEST');
    expect(classifyTenant(id({ company_name: 'Wrong Tenant mp4x', website_domain: 'wrong.example.com' })).tenant_class).toBe('TEST');
    expect(classifyTenant(id({ company_name: 'Plain', website_domain: 'foo.example.com' })).tenant_class).toBe('TEST');
  });
  it('TEST beats QA (placeholder domain wins over QA name)', () => {
    expect(classifyTenant(id({ company_name: 'Wrong Tenant QA mp4j', website_domain: 'wrong-mp4j.example.com' })).tenant_class).toBe('TEST');
  });
  it('QA by name', () => {
    expect(classifyTenant(id({ company_name: 'Creator Final QA mp4loo4c', website_domain: 'omnivyra.com' })).tenant_class).toBe('QA');
  });
  it('DEMO by name', () => {
    expect(classifyTenant(id({ company_name: 'Acme Demo', website_domain: 'acme.com' })).tenant_class).toBe('DEMO');
  });
  it('INTERNAL by vendor domain (HIGH if verified)', () => {
    const c = classifyTenant(id({ company_name: 'Omnivyra', website_domain: 'omnivyra.com', admin_email_domain: 'omnivyra.com', domain_verified: true }));
    expect(c.tenant_class).toBe('INTERNAL');
    expect(c.classification_confidence).toBe('HIGH');
  });
  it('CUSTOMER by real registrable domain (MEDIUM when email matches, unverified)', () => {
    const c = classifyTenant(id({ company_name: 'Drishiq', website_domain: 'drishiq.com', admin_email_domain: 'drishiq.com' }));
    expect(c.tenant_class).toBe('CUSTOMER');
    expect(c.classification_confidence).toBe('MEDIUM');
  });
  it('CUSTOMER HIGH when domain verified', () => {
    expect(classifyTenant(id({ website_domain: 'acme.com', domain_verified: true })).classification_confidence).toBe('HIGH');
  });
  it('CUSTOMER LOW when email does not match domain', () => {
    expect(classifyTenant(id({ website_domain: 'acme.com', admin_email_domain: 'gmail.com' })).classification_confidence).toBe('LOW');
  });
  it('UNKNOWN when no classifying signal', () => {
    const c = classifyTenant(id({ company_name: 'Mystery', website_domain: null, admin_email_domain: null }));
    expect(c.tenant_class).toBe('UNKNOWN');
    expect(c.classification_confidence).toBe('UNKNOWN');
  });
  it('every classification carries explicit evidence', () => {
    for (const c of [id(), id({ company_name: 'X QA' }), id({ website_domain: 'a.example.com' }), id({ website_domain: null, admin_email_domain: null })]) {
      expect(classifyTenant(c).classification_evidence.length).toBeGreaterThan(0);
    }
  });
});

const popCo = (over: Partial<PopulationCompany> & { name?: string; wd?: string; aed?: string } = {}): PopulationCompany => ({
  company_id: over.company_id ?? 'c', company_name: over.name ?? 'Acme', website_domain: over.wd ?? 'acme.com', admin_email_domain: over.aed ?? 'acme.com', domain_verified: over.domain_verified ?? false,
  metrics: { readiness_score: 50, is_active: false, profile_ready: false, adoption_score: 0, has_value: false, execution_volume: 0, is_paying: true, paying_with_value: false, ...(over.metrics ?? {}) },
});

describe('analyzePopulationIntegrity — purity + contamination', () => {
  const companies: PopulationCompany[] = [
    popCo({ company_id: 'cust', name: 'Realco', wd: 'realco.com', aed: 'realco.com', metrics: { readiness_score: 40, is_active: true, profile_ready: true, adoption_score: 30, has_value: true, execution_volume: 20, is_paying: true, paying_with_value: true } }),
    popCo({ company_id: 'omni', name: 'Omnivyra', wd: 'omnivyra.com', aed: 'omnivyra.com', domain_verified: true, metrics: { readiness_score: 80, is_active: true, profile_ready: true, adoption_score: 90, has_value: true, execution_volume: 260, is_paying: true, paying_with_value: true } }),
    popCo({ company_id: 'qa1', name: 'Creator Final QA mp4', wd: 'omnivyra.com', metrics: { readiness_score: 10, is_active: false, profile_ready: false, adoption_score: 0, has_value: false, execution_volume: 4, is_paying: true, paying_with_value: false } }),
    popCo({ company_id: 'test1', name: 'Wrong Tenant mp4', wd: 'wrong.example.com', metrics: { readiness_score: 5, is_active: false, profile_ready: false, adoption_score: 0, has_value: false, execution_volume: 0, is_paying: false, paying_with_value: false } }),
  ];
  const r = analyzePopulationIntegrity(companies);

  it('classifies the population', () => {
    expect(r.portfolio_summary.counts.CUSTOMER).toBe(1);
    expect(r.portfolio_summary.counts.INTERNAL).toBe(1);
    expect(r.portfolio_summary.counts.QA).toBe(1);
    expect(r.portfolio_summary.counts.TEST).toBe(1);
  });
  it('purity score = customer / total × 100', () => {
    expect(r.portfolio_summary.population_purity_score).toBe(25); // 1/4
  });
  it('contamination: execution volume hugely inflated by internal', () => {
    const exec = r.contamination.find((c) => c.domain === 'EXECUTION_ADOPTION')!;
    expect(exec.all).toBe(284);          // 20+260+4+0
    expect(exec.customer_only).toBe(20); // just Realco
    expect(exec.internal_only).toBe(260);
    expect(exec.delta_all_vs_customer).toBe(264);
  });
  it('contamination: activation rate differs all vs customer-only', () => {
    const act = r.contamination.find((c) => c.domain === 'ACTIVATION')!;
    expect(act.all).toBe(50);          // 2 of 4 active
    expect(act.customer_only).toBe(100); // 1 of 1
  });
  it('confidence impact covers the 4 domains, flags tiny customer n', () => {
    expect(r.confidence_impact).toHaveLength(4);
    expect(r.confidence_impact[0].customer_n).toBe(1);
    expect(r.confidence_impact[0].note).toMatch(/too small/);
  });
  it('deterministic', () => {
    expect(JSON.stringify(analyzePopulationIntegrity(companies))).toBe(JSON.stringify(r));
  });
});
