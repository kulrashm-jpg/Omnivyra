/**
 * Phase 12G — Customer Evolution Engine tests (pure, deterministic).
 */

import {
  computeCompanyEvolution,
  generatePortfolioEvolution,
  type ReadinessSnapshot,
} from '../../services/customerEvolutionService';
import type { ReadinessArea, ReadinessState } from '../../services/customerReadinessService';

const allAreas = (state: ReadinessState): Record<ReadinessArea, ReadinessState> => ({
  COMPANY_PROFILE: state, WEBSITE: state, GOOGLE_ANALYTICS: state, GOOGLE_SEARCH_CONSOLE: state,
  SOCIAL_INTEGRATIONS: state, COMMUNITY: 'UNKNOWN', TEAM_MEMBERS: state, BILLING: state,
});

const snap = (over: Partial<ReadinessSnapshot> = {}): ReadinessSnapshot => ({
  company_id: 'co_1', taken_at: '2026-06-01T00:00:00Z',
  overall_readiness_score: 50, readiness_bucket: 'PARTIAL', tenant_status: 'ACTIVE',
  opportunity_count: 4, priority_tier: 'MEDIUM', areas: allAreas('NOT_READY'),
  ...over,
});

describe('missing-history behavior', () => {
  it('0 snapshots → UNKNOWN', () => {
    expect(computeCompanyEvolution([]).trajectory).toBe('UNKNOWN');
  });
  it('1 snapshot → UNKNOWN (no guessing)', () => {
    const e = computeCompanyEvolution([snap()]);
    expect(e.trajectory).toBe('UNKNOWN');
    expect(e.snapshots_available).toBe(1);
    expect(e.score_delta).toBeNull();
    expect(e.evidence[0]).toMatch(/Insufficient history/);
  });
});

describe('delta + trajectory calculations', () => {
  it('IMPROVING: score up + bucket up + area improvement', () => {
    const e = computeCompanyEvolution([
      snap({ taken_at: '2026-06-01T00:00:00Z', overall_readiness_score: 40, readiness_bucket: 'AT_RISK', areas: allAreas('NOT_READY') }),
      snap({ taken_at: '2026-06-10T00:00:00Z', overall_readiness_score: 65, readiness_bucket: 'PARTIAL', areas: { ...allAreas('NOT_READY'), WEBSITE: 'READY' } }),
    ]);
    expect(e.trajectory).toBe('IMPROVING');
    expect(e.score_delta).toBe(25);
    expect(e.readiness_movement).toBe('AT_RISK → PARTIAL');
    expect(e.biggest_improvement?.area).toBe('WEBSITE');
    expect(e.biggest_improvement?.direction).toBe('IMPROVED');
  });

  it('DECLINING: score down + status regress + area regression', () => {
    const e = computeCompanyEvolution([
      snap({ taken_at: '2026-06-01T00:00:00Z', overall_readiness_score: 70, readiness_bucket: 'PARTIAL', tenant_status: 'ACTIVE', areas: { ...allAreas('NOT_READY'), WEBSITE: 'READY' } }),
      snap({ taken_at: '2026-06-10T00:00:00Z', overall_readiness_score: 45, readiness_bucket: 'PARTIAL', tenant_status: 'DORMANT', areas: allAreas('NOT_READY') }),
    ]);
    expect(e.trajectory).toBe('DECLINING');
    expect(e.score_delta).toBe(-25);
    expect(e.status_movement).toBe('ACTIVE → DORMANT');
    expect(e.biggest_regression?.area).toBe('WEBSITE');
  });

  it('STABLE: within ±3 band, no bucket/area movement', () => {
    const e = computeCompanyEvolution([
      snap({ taken_at: '2026-06-01T00:00:00Z', overall_readiness_score: 50 }),
      snap({ taken_at: '2026-06-10T00:00:00Z', overall_readiness_score: 52 }),
    ]);
    expect(e.trajectory).toBe('STABLE');
    expect(e.biggest_improvement).toBeNull();
    expect(e.biggest_regression).toBeNull();
  });

  it('opportunity + priority movement captured', () => {
    const e = computeCompanyEvolution([
      snap({ taken_at: '2026-06-01T00:00:00Z', opportunity_count: 8, priority_tier: 'MEDIUM' }),
      snap({ taken_at: '2026-06-10T00:00:00Z', opportunity_count: 3, priority_tier: 'CRITICAL', overall_readiness_score: 50 }),
    ]);
    expect(e.opportunity_delta).toBe(-5);
    expect(e.priority_movement).toBe('MEDIUM → CRITICAL');
  });

  it('uses the latest two snapshots regardless of input order', () => {
    const a = snap({ taken_at: '2026-06-01T00:00:00Z', overall_readiness_score: 40 });
    const b = snap({ taken_at: '2026-06-10T00:00:00Z', overall_readiness_score: 60 });
    const c = snap({ taken_at: '2026-06-05T00:00:00Z', overall_readiness_score: 50 });
    expect(computeCompanyEvolution([b, a, c]).score_delta).toBe(10); // latest=b(60), prev=c(50)
  });

  it('is deterministic', () => {
    const s = [snap({ taken_at: '2026-06-01T00:00:00Z', overall_readiness_score: 40 }), snap({ taken_at: '2026-06-10T00:00:00Z', overall_readiness_score: 60 })];
    expect(computeCompanyEvolution(s)).toEqual(computeCompanyEvolution(s));
  });
});

describe('portfolio aggregation', () => {
  it('ranks improved/declined companies, areas, and trajectory distribution', () => {
    const up = computeCompanyEvolution([
      snap({ company_id: 'up', taken_at: 't1', overall_readiness_score: 30, areas: allAreas('NOT_READY') }),
      snap({ company_id: 'up', taken_at: 't2', overall_readiness_score: 70, areas: { ...allAreas('NOT_READY'), WEBSITE: 'READY' } }),
    ], 'Up');
    const down = computeCompanyEvolution([
      snap({ company_id: 'down', taken_at: 't1', overall_readiness_score: 70, areas: { ...allAreas('NOT_READY'), WEBSITE: 'READY' } }),
      snap({ company_id: 'down', taken_at: 't2', overall_readiness_score: 40, areas: allAreas('NOT_READY') }),
    ], 'Down');
    const unknown = computeCompanyEvolution([snap({ company_id: 'u' })], 'U');

    const p = generatePortfolioEvolution([up, down, unknown]);
    expect(p.total_tenants).toBe(3);
    expect(p.trajectory_distribution).toEqual({ IMPROVING: 1, STABLE: 0, DECLINING: 1, UNKNOWN: 1 });
    expect(p.most_improved[0].company_id).toBe('up');
    expect(p.most_declined[0].company_id).toBe('down');
    expect(p.most_improved_areas[0]).toEqual({ area: 'WEBSITE', count: 1 });
    expect(p.most_common_regressions[0]).toEqual({ area: 'WEBSITE', count: 1 });
  });
});
