/**
 * Phase 14E — Customer Value Realization tests (pure, deterministic).
 */

import {
  classifyValue,
  analyzeValueRealization,
  VALUE_CATEGORIES,
  type ValueCompany,
  type ValueCategory,
} from '../../services/customerValueRealizationService';

const sig = (over: Partial<Record<ValueCategory, number>> = {}): Record<ValueCategory, number> => {
  const base = Object.fromEntries(VALUE_CATEGORIES.map((c) => [c, 0])) as Record<ValueCategory, number>;
  return { ...base, ...over };
};
const co = (over: Partial<ValueCompany> = {}): ValueCompany => ({
  company_id: 'c1', company_name: 'Acme', is_active: false, is_paying: true, read_ok: true, signals: sig(), ...over,
});

describe('classifyValue', () => {
  it('NO_VALUE at 0 signals', () => {
    const c = classifyValue(co());
    expect(c.value_status).toBe('NO_VALUE');
    expect(c.value_score).toBe(0);
    expect(c.missing_value_signals).toHaveLength(5);
  });
  it('EARLY_VALUE at exactly 1 signal', () => {
    expect(classifyValue(co({ signals: sig({ CONTENT: 3 }) })).value_status).toBe('EARLY_VALUE');
  });
  it('REALIZED_VALUE at ≥ 2 signals; lists present + missing', () => {
    const c = classifyValue(co({ signals: sig({ CONTENT: 1, REPORTS: 4 }) }));
    expect(c.value_status).toBe('REALIZED_VALUE');
    expect(c.value_signals).toEqual(['CONTENT', 'REPORTS']);
    expect(c.value_score).toBe(40); // 2/5
  });
  it('UNKNOWN when read failed', () => {
    expect(classifyValue(co({ read_ok: false })).value_status).toBe('UNKNOWN');
  });
});

describe('analyzeValueRealization — funnel + segments + billing', () => {
  const companies = [
    co({ company_id: 'a', company_name: 'Alpha', is_active: true, is_paying: true, signals: sig({ CONTENT: 5, CAMPAIGN: 2, REPORTS: 3 }) }), // sustained, active+paying+value
    co({ company_id: 'b', company_name: 'Beta', is_active: false, is_paying: true, signals: sig({ CONTENT: 1 }) }),                          // paying, early value
    co({ company_id: 'c', company_name: 'Gamma', is_active: false, is_paying: true, signals: sig() }),                                       // paying, no value
    co({ company_id: 'd', company_name: 'Delta', is_active: false, is_paying: false, signals: sig({ REPORTS: 2 }) }),                        // non-paying with value
  ];
  const r = analyzeValueRealization(companies);

  it('value funnel reach', () => {
    const by = Object.fromEntries(r.funnel.map((s) => [s.stage, s.reached]));
    expect(by.COMPANY_CREATED).toBe(4);
    expect(by.ACTIVATED).toBe(1);
    expect(by.VALUE_SIGNAL_PRESENT).toBe(3); // a,b,d
    expect(by.MULTIPLE_VALUE_SIGNALS).toBe(1); // a
    expect(by.SUSTAINED_VALUE).toBe(1); // a (3 signals)
  });
  it('segments assigned by precedence', () => {
    const by = Object.fromEntries(r.segments.map((s) => [s.segment, s.count]));
    expect(by.PAYING_WITH_VALUE).toBe(2);     // a,b
    expect(by.PAYING_WITHOUT_VALUE).toBe(1);  // c
    expect(by.NON_PAYING_WITH_VALUE).toBe(1); // d
  });
  it('billing vs value, with NOT-COMPUTABLE timing', () => {
    expect(r.billing_vs_value.paying).toBe(3);
    expect(r.billing_vs_value.value_realized).toBe(3);
    expect(r.billing_vs_value.paying_without_value).toBe(1); // c
    expect(r.billing_vs_value.value_before_payment).toBeNull();
    expect(r.billing_vs_value.note).toMatch(/NOT COMPUTABLE/);
  });
  it('category presence', () => {
    const byCat = Object.fromEntries(r.category_presence.map((c) => [c.category, c.companies_with]));
    expect(byCat.CONTENT).toBe(2); // a,b
    expect(byCat.REPORTS).toBe(2); // a,d
    expect(byCat.PUBLISHING).toBe(0);
  });
  it('status distribution + mean score', () => {
    expect(r.by_status.REALIZED_VALUE).toBe(1);
    expect(r.by_status.EARLY_VALUE).toBe(2); // b,d
    expect(r.by_status.NO_VALUE).toBe(1);    // c
    expect(r.mean_value_score).toBeGreaterThan(0);
  });
  it('deterministic', () => {
    expect(JSON.stringify(analyzeValueRealization(companies))).toBe(JSON.stringify(r));
  });
});
