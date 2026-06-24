/**
 * Phase 14G — Campaign Execution Adoption tests (pure, deterministic). Association, not causation.
 */

import {
  classifyExecution,
  analyzeCampaignExecution,
} from '../../services/campaignExecutionAdoptionService';
import type { ValueCompany, ValueCategory } from '../../services/customerValueRealizationService';
import { VALUE_CATEGORIES } from '../../services/customerValueRealizationService';

const sig = (over: Partial<Record<ValueCategory, number>> = {}): Record<ValueCategory, number> => {
  const base = Object.fromEntries(VALUE_CATEGORIES.map((c) => [c, 0])) as Record<ValueCategory, number>;
  return { ...base, ...over };
};
const co = (id: string, signals: Partial<Record<ValueCategory, number>> = {}, over: Partial<ValueCompany> = {}): ValueCompany =>
  ({ company_id: id, company_name: id, is_active: false, is_paying: true, read_ok: true, signals: sig(signals), ...over });

describe('classifyExecution', () => {
  it('NO_EXECUTION at zero volume', () => {
    expect(classifyExecution(co('a')).execution_status).toBe('NO_EXECUTION');
  });
  it('EARLY_EXECUTION at single execution', () => {
    expect(classifyExecution(co('a', { CONTENT: 1 })).execution_status).toBe('EARLY_EXECUTION');
  });
  it('ACTIVE_EXECUTION at repeat volume', () => {
    expect(classifyExecution(co('a', { CONTENT: 4 })).execution_status).toBe('ACTIVE_EXECUTION');
  });
  it('SUSTAINED_EXECUTION at high volume or breadth ≥ 3', () => {
    expect(classifyExecution(co('a', { CONTENT: 15 })).execution_status).toBe('SUSTAINED_EXECUTION');
    expect(classifyExecution(co('b', { CONTENT: 1, CAMPAIGN: 1, REPORTS: 1 })).execution_status).toBe('SUSTAINED_EXECUTION');
  });
  it('UNKNOWN when read failed', () => {
    expect(classifyExecution(co('a', {}, { read_ok: false })).execution_status).toBe('UNKNOWN');
  });
  it('frequency = total volume; signals = present categories', () => {
    const c = classifyExecution(co('a', { CONTENT: 5, REPORTS: 2 }));
    expect(c.execution_frequency).toBe(7);
    expect(c.execution_signals).toEqual(['CONTENT', 'REPORTS']);
  });
});

describe('analyzeCampaignExecution', () => {
  const companies = [
    co('a', { CONTENT: 50, CAMPAIGN: 5, REPORTS: 10 }, { is_active: true }), // dominant
    co('b', { CONTENT: 3 }),                                                 // repeat
    co('c', { CAMPAIGN: 1 }),                                                // single-use
    co('d', {}),                                                            // none
  ];
  const r = analyzeCampaignExecution(companies);

  it('execution funnel reach', () => {
    const by = Object.fromEntries(r.funnel.map((s) => [s.stage, s.reached]));
    expect(by.ACTIVATED).toBe(1);
    expect(by.FIRST_CONTENT).toBe(2);  // a,b
    expect(by.FIRST_CAMPAIGN).toBe(2); // a,c
    expect(by.SUSTAINED_EXECUTION).toBe(1); // a
  });
  it('depth bands: single-use / repeat / sustained', () => {
    expect(r.depth.single_use).toBe(1);  // c
    expect(r.depth.repeat).toBe(1);      // b (3)
    expect(r.depth.sustained).toBe(1);   // a (65)
  });
  it('concentration: top company dominates total volume', () => {
    // total volume = 65 + 3 + 1 = 69; a = 65 → ~94%
    expect(r.concentration.total_volume).toBe(69);
    expect(r.concentration.top1_share_pct).toBeGreaterThan(90);
    expect(r.concentration.top_companies[0].company_name).toBe('a');
  });
  it('status distribution', () => {
    expect(r.by_status.SUSTAINED_EXECUTION).toBe(1);
    expect(r.by_status.NO_EXECUTION).toBe(1);
  });
  it('patterns grouped by value bucket', () => {
    expect(r.patterns.realized.some((p) => p.pattern.includes('CONTENT'))).toBe(true);
    expect(r.patterns.no_value.some((p) => p.pattern === 'NONE')).toBe(true);
  });
  it('frequency bands sum to total companies', () => {
    expect(r.depth.frequency_bands.reduce((a, b) => a + b.count, 0)).toBe(4);
  });
  it('deterministic', () => {
    expect(JSON.stringify(analyzeCampaignExecution(companies))).toBe(JSON.stringify(r));
  });
});
