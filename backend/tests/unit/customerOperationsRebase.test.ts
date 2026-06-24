/**
 * Phase 16B — Customer Operations Rebase tests (pure, deterministic).
 */

import {
  shareByClass,
  attributeRevenue,
  rebaseFoundation,
} from '../../services/customerOperationsRebaseService';

describe('shareByClass — execution attribution', () => {
  it('computes customer vs vendor share (vendor = INTERNAL)', () => {
    const r = shareByClass([
      { tenant_class: 'INTERNAL', volume: 258 },
      { tenant_class: 'CUSTOMER', volume: 17 },
      { tenant_class: 'QA', volume: 4 },
      { tenant_class: 'TEST', volume: 3 },
    ]);
    expect(r.total).toBe(282);
    expect(r.vendor_share_pct).toBe(91.5);
    expect(r.customer_share_pct).toBe(6);
    expect(r.by_class[0].tenant_class).toBe('INTERNAL');
  });
  it('empty → null shares', () => {
    const r = shareByClass([]);
    expect(r.total).toBe(0);
    expect(r.customer_share_pct).toBeNull();
  });
});

describe('attributeRevenue — org=company attribution', () => {
  it('attributes revenue by class and currency; customer = 0 when all test', () => {
    const r = attributeRevenue([
      { tenant_class: 'TEST', amount: 15540, currency: 'INR' },
      { tenant_class: 'TEST', amount: 8700, currency: 'USD' },
    ]);
    const inr = r.find((x) => x.currency === 'INR')!;
    expect(inr.customer_amount).toBe(0);
    expect(inr.by_class[0].tenant_class).toBe('TEST');
    expect(r.find((x) => x.currency === 'USD')!.total).toBe(8700);
  });
  it('customer revenue surfaced when present', () => {
    const r = attributeRevenue([{ tenant_class: 'CUSTOMER', amount: 500, currency: 'USD' }]);
    expect(r[0].customer_amount).toBe(500);
  });
});

describe('rebaseFoundation', () => {
  const r = rebaseFoundation({
    telemetry: 70, confidence: 68.8,
    old_integrity: 13.2, old_joinability: 63.6, old_coverage: 6.6,
    rebased_integrity: 100, rebased_joinability: 90.9, rebased_coverage: 8,
  });
  it('old = LEVEL_1 (integrity cap)', () => {
    expect(r.old.level).toBe('LEVEL_1');
    expect(r.old.foundation).toBe(42.3);
  });
  it('rebased lifts past cap (integrity 100) even with honest low coverage', () => {
    expect(r.rebased.customer_integrity).toBe(100);
    expect(r.rebased.foundation).toBeGreaterThan(r.old.foundation);
    expect(['LEVEL_2', 'LEVEL_3']).toContain(r.rebased.level);
  });
  it('notes record that coverage does NOT rise (corrects 16A optimism)', () => {
    expect(r.notes.some((n) => /coverage.*NOT rise|near-zero|vendor\/test/i.test(n))).toBe(true);
  });
  it('deterministic', () => {
    const args = { telemetry: 70, confidence: 68.8, old_integrity: 13.2, old_joinability: 63.6, old_coverage: 6.6, rebased_integrity: 100, rebased_joinability: 90.9, rebased_coverage: 8 };
    expect(JSON.stringify(rebaseFoundation(args))).toBe(JSON.stringify(rebaseFoundation(args)));
  });
});
