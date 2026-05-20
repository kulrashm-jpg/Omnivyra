import { computeReconciliationVariance } from '../../services/billing/reconciliationVariance';

describe('computeReconciliationVariance — pure / deterministic', () => {
  test('exact match → none, no anomaly', () => {
    const r = computeReconciliationVariance({ estimated_usd: 10, actual_usd: 10 });
    expect(r.variance_usd).toBe(0);
    expect(r.variance_pct).toBe(0);
    expect(r.severity).toBe('none');
    expect(r.should_emit_anomaly).toBe(false);
  });

  test('small drift (<5%) → none', () => {
    const r = computeReconciliationVariance({ estimated_usd: 100, actual_usd: 103 });
    expect(r.severity).toBe('none');
    expect(r.should_emit_anomaly).toBe(false);
  });

  test('5%–15% drift → low (no anomaly)', () => {
    const r = computeReconciliationVariance({ estimated_usd: 100, actual_usd: 110 });
    expect(r.severity).toBe('low');
    expect(r.should_emit_anomaly).toBe(false);
  });

  test('15%–30% drift → medium (anomaly)', () => {
    const r = computeReconciliationVariance({ estimated_usd: 100, actual_usd: 120 });
    expect(r.severity).toBe('medium');
    expect(r.should_emit_anomaly).toBe(true);
  });

  test('>=30% drift → high (anomaly)', () => {
    const r = computeReconciliationVariance({ estimated_usd: 100, actual_usd: 140 });
    expect(r.severity).toBe('high');
    expect(r.should_emit_anomaly).toBe(true);
  });

  test('over-estimated (actual < estimated) is symmetric in severity', () => {
    const r = computeReconciliationVariance({ estimated_usd: 100, actual_usd: 60 });
    expect(r.variance_usd).toBe(-40);
    expect(r.severity).toBe('high'); // 40% absolute drift
    expect(r.should_emit_anomaly).toBe(true);
  });

  test('estimated zero + actual zero → none', () => {
    const r = computeReconciliationVariance({ estimated_usd: 0, actual_usd: 0 });
    expect(r.variance_pct).toBeNull();
    expect(r.severity).toBe('none');
  });

  test('estimated zero + small actual → low (sub-cent)', () => {
    const r = computeReconciliationVariance({ estimated_usd: 0, actual_usd: 0.005 });
    expect(r.variance_pct).toBeNull();
    expect(r.severity).toBe('low');
  });

  test('estimated zero + material actual → high (orphan usage)', () => {
    const r = computeReconciliationVariance({ estimated_usd: 0, actual_usd: 5 });
    expect(r.variance_pct).toBeNull();
    expect(r.severity).toBe('high');
    expect(r.should_emit_anomaly).toBe(true);
  });

  test('NaN / negative inputs are coerced to zero (defensive)', () => {
    const r = computeReconciliationVariance({ estimated_usd: NaN as unknown as number, actual_usd: -3 });
    expect(r.estimated_usd).toBe(0);
    expect(r.actual_usd).toBe(0);
    expect(r.severity).toBe('none');
  });

  test('determinism: identical inputs produce identical outputs (replay safety)', () => {
    const call = () => computeReconciliationVariance({ estimated_usd: 12.345, actual_usd: 15 });
    const first = call();
    for (let i = 0; i < 50; i++) expect(call()).toEqual(first);
  });
});
