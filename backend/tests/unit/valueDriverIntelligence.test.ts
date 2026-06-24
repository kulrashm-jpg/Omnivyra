/**
 * Phase 14F — Value Driver Intelligence tests (pure, deterministic). Association, not causation.
 */

import {
  computeAssociation,
  analyzeValueDrivers,
  buildDriverCompanies,
  valueBucketOf,
  CAPABILITY_SIGNALS,
  VALUE_SIGNALS,
  type DriverCompany,
  type AnySignal,
} from '../../services/valueDriverIntelligenceService';

const sig = (over: Partial<Record<AnySignal, boolean>> = {}): Record<AnySignal, boolean> => {
  const base = Object.fromEntries([...CAPABILITY_SIGNALS, ...VALUE_SIGNALS].map((s) => [s, false])) as Record<AnySignal, boolean>;
  return { ...base, ...over };
};
const co = (id: string, valueCats: number, over: Partial<Record<AnySignal, boolean>> = {}): DriverCompany =>
  ({ company_id: id, company_name: id, value_category_count: valueCats, signals: sig(over) });

describe('valueBucketOf', () => {
  it('buckets by category count', () => {
    expect(valueBucketOf(0)).toBe('NO_VALUE');
    expect(valueBucketOf(1)).toBe('EARLY_VALUE');
    expect(valueBucketOf(3)).toBe('REALIZED_VALUE');
  });
});

describe('computeAssociation', () => {
  // 10 companies: 5 with BILLING (4 value-realizing), 5 without (1 value-realizing)
  const companies: DriverCompany[] = [
    ...[1, 1, 1, 1, 0].map((v, i) => co(`b${i}`, v ? 2 : 0, { BILLING_ACTIVE: true })),
    ...[1, 0, 0, 0, 0].map((v, i) => co(`n${i}`, v ? 2 : 0, {})),
  ];
  it('computes rates, lift, delta, support', () => {
    const a = computeAssociation('BILLING_ACTIVE', false, companies);
    expect(a.population_with).toBe(5);
    expect(a.value_with).toBe(4);
    expect(a.rate_with).toBe(80);
    expect(a.rate_without).toBe(20);
    expect(a.lift).toBe(4);
    expect(a.delta).toBe(60);
    expect(a.strength).toBe('STRONG_ASSOCIATION');
  });
  it('INSUFFICIENT_DATA when a side is below the minimum population', () => {
    const few = [co('a', 2, { GA_CONNECTED: true }), ...Array.from({ length: 5 }, (_, i) => co(`x${i}`, 0))];
    expect(computeAssociation('GA_CONNECTED', false, few).strength).toBe('INSUFFICIENT_DATA');
  });
  it('flags value-constituent signals as circular', () => {
    const a = computeAssociation('CONTENT_CREATED', true, companies);
    expect(a.circular).toBe(true);
    expect(a.kind).toBe('VALUE_CONSTITUENT');
  });
});

describe('analyzeValueDrivers', () => {
  const companies: DriverCompany[] = [
    ...[1, 1, 1, 1, 0].map((v, i) => co(`b${i}`, v ? 2 : 0, { BILLING_ACTIVE: true })),
    ...[1, 0, 0, 0, 0].map((v, i) => co(`n${i}`, v ? 2 : 0, { PROFILE_READY: i === 0 })),
  ];
  const r = analyzeValueDrivers(companies);

  it('ranks capabilities; BILLING is a top positive association', () => {
    expect(r.associations[0].signal).toBe('BILLING_ACTIVE');
    expect(r.ranking.top_positive.map((a) => a.signal)).toContain('BILLING_ACTIVE');
  });
  it('separates circular value-constituents from capability drivers', () => {
    expect(r.value_constituents.every((a) => a.circular)).toBe(true);
    expect(r.associations.every((a) => !a.circular)).toBe(true);
  });
  it('reports never-observed + insufficient-data signals', () => {
    expect(r.ranking.never_observed).toContain('GA_CONNECTED'); // nobody has GA
    expect(r.ranking.insufficient_data.length).toBeGreaterThan(0);
  });
  it('paths grouped by value bucket', () => {
    expect(r.paths.realized.some((p) => p.path.includes('BILLING_ACTIVE'))).toBe(true);
    expect(r.paths.no_value.length).toBeGreaterThan(0);
  });
  it('gap comparison realized vs no-value with deltas', () => {
    expect(r.gap_comparison.gaps.find((g) => g.capability === 'BILLING_ACTIVE')).toBeDefined();
    expect(r.gap_comparison.largest_gaps.length).toBeGreaterThan(0);
  });
  it('deterministic + stable ranking', () => {
    expect(JSON.stringify(analyzeValueDrivers(companies))).toBe(JSON.stringify(r));
  });
});

describe('buildDriverCompanies', () => {
  it('composes capability + value signals from readiness + value classifications', () => {
    const tenants = [{ company_id: 'a', company_name: 'A', tenant_status: 'ACTIVE', company_profile_ready: 'READY', website_ready: 'NOT_READY', ga_ready: 'NOT_READY', gsc_ready: 'NOT_READY', social_ready: 'NOT_READY', team_ready: 'NOT_READY', billing_ready: 'READY' }];
    const valueBy = new Map([['a', { value_signals: ['CONTENT', 'REPORTS'] }]]);
    const [d] = buildDriverCompanies(tenants, valueBy);
    expect(d.signals.PROFILE_READY).toBe(true);
    expect(d.signals.BILLING_ACTIVE).toBe(true);
    expect(d.signals.ACTIVATED).toBe(true);
    expect(d.signals.CONTENT_CREATED).toBe(true);
    expect(d.signals.REPORT_GENERATED).toBe(true);
    expect(d.signals.CAMPAIGN_CREATED).toBe(false);
    expect(d.value_category_count).toBe(2);
  });
});
