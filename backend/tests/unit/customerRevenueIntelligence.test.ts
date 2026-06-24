/**
 * Phase 15D — Customer Revenue Intelligence tests (pure, deterministic). Evidence-only.
 */

import {
  calculateRevenueByCustomer,
  calculateRevenueConcentration,
  calculateRevenuePortfolio,
  type RevenueCompany,
} from '../../services/customerRevenueIntelligenceService';

const rc = (over: Partial<RevenueCompany> = {}): RevenueCompany => ({
  company_id: 'c1', company_name: 'Acme', tenant_class: 'CUSTOMER', events: [], has_value: false, adoption_score: 0, execution_volume: 0, ...over,
});

describe('calculateRevenueByCustomer', () => {
  it('no events → UNKNOWN total, not measurable', () => {
    const r = calculateRevenueByCustomer(rc());
    expect(r.measurable).toBe(false);
    expect(r.total_revenue).toBe('UNKNOWN');
    expect(r.confidence).toBe('UNKNOWN');
  });
  it('single-currency events → summed total, HIGH confidence', () => {
    const r = calculateRevenueByCustomer(rc({ events: [{ company_id: 'c1', amount: 2500, currency: 'USD' }, { company_id: 'c1', amount: 3300, currency: 'USD' }] }));
    expect(r.total_revenue).toBe(5800);
    expect(r.primary_currency).toBe('USD');
    expect(r.confidence).toBe('HIGH');
  });
  it('mixed currency → total UNKNOWN (never summed across currencies), MEDIUM confidence', () => {
    const r = calculateRevenueByCustomer(rc({ events: [{ company_id: 'c1', amount: 2500, currency: 'USD' }, { company_id: 'c1', amount: 2520, currency: 'INR' }] }));
    expect(r.total_revenue).toBe('UNKNOWN');
    expect(r.revenue_by_currency).toEqual({ USD: 2500, INR: 2520 });
    expect(r.confidence).toBe('MEDIUM');
  });
});

describe('calculateRevenueConcentration', () => {
  it('per-currency shares; single company → 100%', () => {
    const per = [rc({ company_id: 'a', company_name: 'A', events: [{ company_id: 'a', amount: 8700, currency: 'USD' }] })].map(calculateRevenueByCustomer);
    const conc = calculateRevenueConcentration(per);
    expect(conc[0].currency).toBe('USD');
    expect(conc[0].total).toBe(8700);
    expect(conc[0].top1_share_pct).toBe(100);
  });
});

describe('calculateRevenuePortfolio', () => {
  it('MRR / ARR / subscriptions are always UNKNOWN (no recurring data)', () => {
    const r = calculateRevenuePortfolio([rc({ events: [{ company_id: 'c1', amount: 100, currency: 'USD' }] })]);
    expect(r.mrr).toBe('UNKNOWN');
    expect(r.arr).toBe('UNKNOWN');
    expect(r.active_subscriptions).toBe('UNKNOWN');
  });
  it('zero recorded events → revenue UNKNOWN for all; can_revenue_be_measured = NO', () => {
    const r = calculateRevenuePortfolio([rc(), rc({ company_id: 'c2' })]);
    expect(r.paying_customers).toBe(0);
    expect(r.data_quality.customers_with_unknown_revenue).toBe(2);
    expect(r.data_quality.revenue_confidence).toBe('UNKNOWN');
    expect(r.can_revenue_be_measured).toMatch(/^NO/);
    expect(r.cross_signal.revenue_without_value).toBe('UNKNOWN');
  });
  it('revenue only for a TEST tenant → PARTIAL, no customer revenue, confidence LOW', () => {
    const r = calculateRevenuePortfolio([
      rc({ company_id: 'test', company_name: 'TestOrg', tenant_class: 'TEST', events: [{ company_id: 'test', amount: 8700, currency: 'USD' }] }),
      rc({ company_id: 'cust', company_name: 'Real', tenant_class: 'CUSTOMER', has_value: true }),
    ]);
    expect(r.paying_customers).toBe(1);
    expect(r.data_quality.customer_class_with_revenue).toEqual({ TEST: 1 });
    expect(r.data_quality.revenue_confidence).toBe('LOW'); // no CUSTOMER revenue
    expect(r.can_revenue_be_measured).toMatch(/NONE are classified CUSTOMER/);
    expect(r.observable_revenue_by_currency).toEqual({ USD: 8700 });
  });
  it('cross-signal measurable when revenue present: value_without_revenue counts real customers', () => {
    const r = calculateRevenuePortfolio([
      rc({ company_id: 'test', tenant_class: 'TEST', events: [{ company_id: 'test', amount: 100, currency: 'USD' }], has_value: false }),
      rc({ company_id: 'cust', tenant_class: 'CUSTOMER', has_value: true }), // value, no revenue
    ]);
    expect(r.cross_signal.value_without_revenue).toBe(1);          // cust
    expect(r.cross_signal.revenue_without_value).toBe(1);         // test (revenue, no value)
  });
  it('deterministic', () => {
    const companies = [rc({ company_id: 'a', events: [{ company_id: 'a', amount: 50, currency: 'USD' }] })];
    expect(JSON.stringify(calculateRevenuePortfolio(companies))).toBe(JSON.stringify(calculateRevenuePortfolio(companies)));
  });
});
