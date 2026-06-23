/**
 * Phase 13C — Customer Outcome Intelligence tests (pure, deterministic).
 */

import {
  computeCompanyOutcome,
  generatePortfolioOutcomes,
  executiveOutcomeSummary,
  getCustomerOutcomes,
  type OutcomeSnapshot,
} from '../../services/customerOutcomeIntelligenceService';
import type { ReadinessState } from '../../services/customerReadinessService';

const AREAS_DEFAULT: OutcomeSnapshot['areas'] = {
  COMPANY_PROFILE: 'NOT_READY', WEBSITE: 'NOT_READY', GOOGLE_ANALYTICS: 'NOT_READY', GOOGLE_SEARCH_CONSOLE: 'NOT_READY',
  SOCIAL_INTEGRATIONS: 'NOT_READY', COMMUNITY: 'UNKNOWN', TEAM_MEMBERS: 'NOT_READY', BILLING: 'NOT_READY',
};
const snap = (over: Partial<OutcomeSnapshot> & { areas?: Partial<OutcomeSnapshot['areas']> } = {}): OutcomeSnapshot => ({
  company_id: 'co_1', snapshot_date: '2026-06-23', taken_at: '2026-06-23T06:00:00Z',
  readiness_score: 50, readiness_bucket: 'PARTIAL', priority_score: 40, opportunity_count: 5,
  ...over,
  areas: { ...AREAS_DEFAULT, ...(over.areas ?? {}) },
});

describe('computeCompanyOutcome — classification', () => {
  it('NO_HISTORY with < 2 snapshots', () => {
    expect(computeCompanyOutcome([]).outcome_classification).toBe('NO_HISTORY');
    expect(computeCompanyOutcome([snap()]).outcome_classification).toBe('NO_HISTORY');
  });

  it('IMPROVED: +20 readiness, −3 opps, PARTIAL→READY, website verified', () => {
    const o = computeCompanyOutcome([
      snap({ snapshot_date: '2026-06-23', taken_at: '2026-06-23T06:00:00Z', readiness_score: 50, readiness_bucket: 'PARTIAL', opportunity_count: 8 }),
      snap({ snapshot_date: '2026-06-25', taken_at: '2026-06-25T06:00:00Z', readiness_score: 70, readiness_bucket: 'READY', opportunity_count: 5, areas: { WEBSITE: 'READY' } }),
    ]);
    expect(o.outcome_classification).toBe('IMPROVED');
    expect(o.net_change).toBe(20);
    expect(o.opportunity_delta).toBe(-3);
    expect(o.bucket_movement).toBe('PARTIAL → READY');
    expect(o.area_improvements).toContain('WEBSITE');
    expect(o.previous_score).toBe(50);
    expect(o.current_score).toBe(70);
  });

  it('DECLINED: readiness drop beyond band', () => {
    const o = computeCompanyOutcome([
      snap({ taken_at: '2026-06-23T06:00:00Z', readiness_score: 60 }),
      snap({ taken_at: '2026-06-25T06:00:00Z', readiness_score: 48 }),
    ]);
    expect(o.outcome_classification).toBe('DECLINED');
    expect(o.net_change).toBe(-12);
  });

  it('UNCHANGED: small drift within band, no bucket move', () => {
    const o = computeCompanyOutcome([
      snap({ taken_at: '2026-06-23T06:00:00Z', readiness_score: 50 }),
      snap({ taken_at: '2026-06-25T06:00:00Z', readiness_score: 52 }),
    ]);
    expect(o.outcome_classification).toBe('UNCHANGED');
  });

  it('bucket movement overrides a small score change (IMPROVED)', () => {
    const o = computeCompanyOutcome([
      snap({ taken_at: '2026-06-23T06:00:00Z', readiness_score: 39, readiness_bucket: 'AT_RISK' }),
      snap({ taken_at: '2026-06-25T06:00:00Z', readiness_score: 41, readiness_bucket: 'PARTIAL' }),
    ]);
    expect(o.outcome_classification).toBe('IMPROVED'); // +2 score but bucket up
  });

  it('orders by taken_at regardless of input order (earliest vs latest)', () => {
    const o = computeCompanyOutcome([
      snap({ taken_at: '2026-06-25T06:00:00Z', readiness_score: 70 }),
      snap({ taken_at: '2026-06-23T06:00:00Z', readiness_score: 50 }),
    ]);
    expect(o.previous_score).toBe(50);
    expect(o.current_score).toBe(70);
  });

  it('detects regression areas (READY → NOT_READY)', () => {
    const o = computeCompanyOutcome([
      snap({ taken_at: '2026-06-23T06:00:00Z', readiness_score: 60, areas: { GOOGLE_ANALYTICS: 'READY' } }),
      snap({ taken_at: '2026-06-25T06:00:00Z', readiness_score: 60, areas: { GOOGLE_ANALYTICS: 'NOT_READY' } }),
    ]);
    expect(o.area_regressions).toContain('GOOGLE_ANALYTICS');
  });
});

describe('generatePortfolioOutcomes + executiveOutcomeSummary', () => {
  const improved = computeCompanyOutcome([
    snap({ company_id: 'a', taken_at: '2026-06-23T06:00:00Z', readiness_score: 40 }),
    snap({ company_id: 'a', taken_at: '2026-06-25T06:00:00Z', readiness_score: 70, areas: { GOOGLE_ANALYTICS: 'READY', WEBSITE: 'READY' } }),
  ], 'Alpha');
  const declined = computeCompanyOutcome([
    snap({ company_id: 'b', taken_at: '2026-06-23T06:00:00Z', readiness_score: 60 }),
    snap({ company_id: 'b', taken_at: '2026-06-25T06:00:00Z', readiness_score: 45 }),
  ], 'Beta');
  const stable = computeCompanyOutcome([
    snap({ company_id: 'c', taken_at: '2026-06-23T06:00:00Z', readiness_score: 50 }),
    snap({ company_id: 'c', taken_at: '2026-06-25T06:00:00Z', readiness_score: 51 }),
  ], 'Gamma');
  const none = computeCompanyOutcome([snap({ company_id: 'd' })], 'Delta');
  const p = generatePortfolioOutcomes([improved, declined, stable, none]);

  it('aggregates counts', () => {
    expect(p.improved_companies).toBe(1);
    expect(p.declined_companies).toBe(1);
    expect(p.unchanged_companies).toBe(1);
    expect(p.no_history_companies).toBe(1);
  });
  it('average over companies with history only', () => {
    expect(p.average_readiness_change).toBe(5.3); // (30 + -15 + 1)/3 = 5.33 → 5.3
  });
  it('top improvers / decliners ordered', () => {
    expect(p.top_improvers[0].company_name).toBe('Alpha');
    expect(p.top_decliners[0].company_name).toBe('Beta');
  });
  it('most improved areas ranked (GA + Website on Alpha)', () => {
    const areas = p.most_improved_areas.map((a) => a.area);
    expect(areas).toEqual(expect.arrayContaining(['GOOGLE_ANALYTICS', 'WEBSITE']));
  });
  it('deterministic executive summary lines', () => {
    const lines = executiveOutcomeSummary(p);
    expect(lines).toContain('1 company improved readiness.');
    expect(lines).toContain('1 company declined.');
    expect(lines.some((l) => l.startsWith('GA adoption increased by 1'))).toBe(true);
    expect(lines.some((l) => l.startsWith('Website verification increased by 1'))).toBe(true);
  });
});

describe('getCustomerOutcomes — orchestrator with injected loader', () => {
  it('binds company_id/name and classifies via injected snapshots', async () => {
    const load = async () => new Map<string, OutcomeSnapshot[]>([
      ['a', [snap({ company_id: 'a', taken_at: '2026-06-23T06:00:00Z', readiness_score: 40 }), snap({ company_id: 'a', taken_at: '2026-06-25T06:00:00Z', readiness_score: 75 })]],
    ]);
    const res = await getCustomerOutcomes([{ company_id: 'a', company_name: 'Alpha' }, { company_id: 'z', company_name: 'Zeta' }], { load });
    const byId = Object.fromEntries(res.per_company.map((o) => [o.company_id, o]));
    expect(byId['a'].outcome_classification).toBe('IMPROVED');
    expect(byId['a'].company_name).toBe('Alpha');
    expect(byId['z'].outcome_classification).toBe('NO_HISTORY'); // no snapshots
  });
});
