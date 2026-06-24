/**
 * Phase 14H — Monetization Intelligence tests (pure, deterministic). Association, not causation.
 */

import {
  classifyMonetization,
  analyzeMonetization,
  buildMonetizationCompanies,
  type MonetizationCompany,
} from '../../services/monetizationIntelligenceService';

const co = (over: Partial<MonetizationCompany> = {}): MonetizationCompany => ({
  company_id: 'c1', company_name: 'Acme', plan: 'Pro', is_paying: true, is_active: false, has_value: false, is_executing: false, activity_volume: 0, read_ok: true, ...over,
});

describe('classifyMonetization', () => {
  it('PAYING_ACTIVE_VALUE', () => {
    expect(classifyMonetization(co({ is_active: true, has_value: true })).monetization_status).toBe('PAYING_ACTIVE_VALUE');
  });
  it('PAYING_ACTIVE_NO_VALUE', () => {
    expect(classifyMonetization(co({ is_active: true, has_value: false })).monetization_status).toBe('PAYING_ACTIVE_NO_VALUE');
  });
  it('PAYING_INACTIVE', () => {
    expect(classifyMonetization(co({ is_active: false })).monetization_status).toBe('PAYING_INACTIVE');
  });
  it('FREE_ACTIVE_VALUE / FREE_ACTIVE_NO_VALUE / FREE_INACTIVE', () => {
    expect(classifyMonetization(co({ is_paying: false, is_active: true, has_value: true })).monetization_status).toBe('FREE_ACTIVE_VALUE');
    expect(classifyMonetization(co({ is_paying: false, is_active: true, has_value: false })).monetization_status).toBe('FREE_ACTIVE_NO_VALUE');
    expect(classifyMonetization(co({ is_paying: false, is_active: false })).monetization_status).toBe('FREE_INACTIVE');
  });
  it('UNKNOWN when read failed', () => {
    expect(classifyMonetization(co({ read_ok: false })).monetization_status).toBe('UNKNOWN');
  });
});

describe('analyzeMonetization', () => {
  const companies = [
    co({ company_id: 'a', company_name: 'Alpha', plan: 'Pro', is_paying: true, is_active: true, has_value: true, is_executing: true, activity_volume: 100 }),
    co({ company_id: 'b', company_name: 'Beta', plan: 'Pro', is_paying: true, is_active: false, has_value: false, activity_volume: 0 }),
    co({ company_id: 'c', company_name: 'Gamma', plan: 'Free', is_paying: false, is_active: true, has_value: true, is_executing: true, activity_volume: 5 }),
    co({ company_id: 'd', company_name: 'Delta', plan: 'Free', is_paying: false, is_active: false, has_value: false, activity_volume: 0 }),
  ];
  const r = analyzeMonetization(companies);

  it('monetization funnel', () => {
    const by = Object.fromEntries(r.funnel.map((s) => [s.stage, s.reached]));
    expect(by.COMPANY_CREATED).toBe(4);
    expect(by.BILLING_ACTIVE).toBe(2);   // a,b
    expect(by.ACTIVATED).toBe(2);        // a,c
    expect(by.EXECUTING).toBe(2);        // a,c
    expect(by.VALUE_REALIZED).toBe(2);   // a,c
  });
  it('billing-value alignment: aligned = both-present + both-absent', () => {
    // a: billing+value (aligned), b: billing+no_value (mis), c: value+no_billing (mis), d: neither (aligned)
    expect(r.billing_value_alignment.aligned).toBe(2);     // a,d
    expect(r.billing_value_alignment.misaligned).toBe(2);  // b,c
    expect(r.billing_value_alignment.alignment_pct).toBe(50);
  });
  it('revenue + credit concentration are UNKNOWN (never estimated)', () => {
    expect(r.concentration.revenue.available).toBe(false);
    expect(r.concentration.revenue.top1_pct).toBeNull();
    expect(r.concentration.revenue.note).toMatch(/UNKNOWN/);
    expect(r.concentration.credits.available).toBe(false);
  });
  it('execution concentration computed from activity volume', () => {
    expect(r.concentration.execution.total).toBe(105);
    expect(r.concentration.execution.top1_pct).toBeGreaterThan(90); // a=100/105
  });
  it('plan concentration is company-count share', () => {
    expect(r.concentration.plan.total).toBe(4); // 4 companies across 2 plans
    expect(r.concentration.plan.note).toMatch(/NOT revenue/);
  });
  it('revenue alignment cohorts', () => {
    const by = Object.fromEntries(r.revenue_alignment.map((c) => [c.cohort, c.count]));
    expect(by.paying).toBe(2);
    expect(by.paying_no_value).toBe(1); // b
    expect(by.free_value).toBe(1);      // c
  });
  it('status distribution', () => {
    expect(r.by_status.PAYING_ACTIVE_VALUE).toBe(1);
    expect(r.by_status.PAYING_INACTIVE).toBe(1);
    expect(r.by_status.FREE_ACTIVE_VALUE).toBe(1);
    expect(r.by_status.FREE_INACTIVE).toBe(1);
  });
  it('deterministic', () => {
    expect(JSON.stringify(analyzeMonetization(companies))).toBe(JSON.stringify(r));
  });
});

describe('buildMonetizationCompanies', () => {
  it('composes from readiness + value map', () => {
    const tenants = [{ company_id: 'a', company_name: 'A', plan: 'Pro', tenant_status: 'ACTIVE', billing_ready: 'READY' }];
    const valueBy = new Map([['a', { value_present: true, volume: 42 }]]);
    const [m] = buildMonetizationCompanies(tenants, valueBy);
    expect(m.is_paying).toBe(true);
    expect(m.is_active).toBe(true);
    expect(m.has_value).toBe(true);
    expect(m.is_executing).toBe(true);
    expect(m.activity_volume).toBe(42);
  });
});
