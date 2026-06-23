/**
 * Phase 13D — Customer Impact Attribution tests (pure, deterministic).
 */

import {
  attributeCompany,
  generatePortfolioImpact,
  getCustomerImpactAttribution,
} from '../../services/customerImpactAttributionService';
import type { OutcomeSnapshot } from '../../services/customerOutcomeIntelligenceService';

const AREAS_DEFAULT: OutcomeSnapshot['areas'] = {
  COMPANY_PROFILE: 'NOT_READY', WEBSITE: 'NOT_READY', GOOGLE_ANALYTICS: 'NOT_READY', GOOGLE_SEARCH_CONSOLE: 'NOT_READY',
  SOCIAL_INTEGRATIONS: 'NOT_READY', COMMUNITY: 'UNKNOWN', TEAM_MEMBERS: 'NOT_READY', BILLING: 'NOT_READY',
};
const snap = (over: Partial<OutcomeSnapshot> & { areas?: Partial<OutcomeSnapshot['areas']> } = {}): OutcomeSnapshot => ({
  company_id: 'co_1', snapshot_date: '2026-06-23', taken_at: '2026-06-23T06:00:00Z',
  readiness_score: 50, readiness_bucket: 'PARTIAL', priority_score: 40, opportunity_count: 5,
  ...over, areas: { ...AREAS_DEFAULT, ...(over.areas ?? {}) },
});

describe('attributeCompany — classification', () => {
  it('INSUFFICIENT_DATA with < 2 snapshots', () => {
    expect(attributeCompany([]).impact_status).toBe('INSUFFICIENT_DATA');
    expect(attributeCompany([snap()]).impact_status).toBe('INSUFFICIENT_DATA');
  });

  it('ATTRIBUTED: single area flip (domain verified) + readiness increase', () => {
    const a = attributeCompany([
      snap({ taken_at: '2026-06-23T06:00:00Z', readiness_score: 50 }),
      snap({ taken_at: '2026-06-24T06:00:00Z', readiness_score: 62, areas: { WEBSITE: 'READY' } }),
    ]);
    expect(a.impact_status).toBe('ATTRIBUTED');
    expect(a.candidates).toHaveLength(1);
    expect(a.candidates[0].intervention_type).toBe('DOMAIN_VERIFICATION');
    expect(a.candidates[0].outcome_types).toContain('READINESS_INCREASE');
    expect(a.candidates[0].readiness_delta).toBe(12);
    expect(a.candidates[0].event_date).toBe('2026-06-23');
  });

  it('POSSIBLY_ATTRIBUTED: multiple area flips + positive outcome', () => {
    const a = attributeCompany([
      snap({ taken_at: '2026-06-23T06:00:00Z', readiness_score: 40 }),
      snap({ taken_at: '2026-06-24T06:00:00Z', readiness_score: 70, areas: { WEBSITE: 'READY', GOOGLE_ANALYTICS: 'READY' } }),
    ]);
    expect(a.impact_status).toBe('POSSIBLY_ATTRIBUTED');
    expect(a.candidates).toHaveLength(2);
    expect(a.candidates.every((c) => c.attribution_status === 'POSSIBLY_ATTRIBUTED')).toBe(true);
    expect(a.candidates.map((c) => c.intervention_type).sort()).toEqual(['DOMAIN_VERIFICATION', 'GA_CONNECTION']);
  });

  it('NOT_ATTRIBUTED: area flip but no positive outcome', () => {
    const a = attributeCompany([
      snap({ taken_at: '2026-06-23T06:00:00Z', readiness_score: 50, opportunity_count: 5 }),
      snap({ taken_at: '2026-06-24T06:00:00Z', readiness_score: 50, opportunity_count: 5, areas: { WEBSITE: 'READY' } }),
    ]);
    expect(a.impact_status).toBe('NOT_ATTRIBUTED');
    expect(a.candidates[0].attribution_status).toBe('NOT_ATTRIBUTED');
  });

  it('unattributed improvement: readiness up with no area flip', () => {
    const a = attributeCompany([
      snap({ taken_at: '2026-06-23T06:00:00Z', readiness_score: 50 }),
      snap({ taken_at: '2026-06-24T06:00:00Z', readiness_score: 60 }),
    ]);
    expect(a.candidates).toHaveLength(0);
    expect(a.unattributed_improvements).toBe(1);
    expect(a.impact_status).toBe('NOT_ATTRIBUTED');
  });

  it('opportunity reduction counts as a positive outcome', () => {
    const a = attributeCompany([
      snap({ taken_at: '2026-06-23T06:00:00Z', readiness_score: 50, opportunity_count: 8 }),
      snap({ taken_at: '2026-06-24T06:00:00Z', readiness_score: 50, opportunity_count: 5, areas: { GOOGLE_ANALYTICS: 'READY' } }),
    ]);
    expect(a.impact_status).toBe('ATTRIBUTED');
    expect(a.candidates[0].outcome_types).toContain('OPPORTUNITY_REDUCTION');
  });
});

describe('generatePortfolioImpact', () => {
  const a1 = attributeCompany([snap({ company_id: 'a', taken_at: 't1', readiness_score: 50 }), snap({ company_id: 'a', taken_at: 't2', readiness_score: 62, areas: { WEBSITE: 'READY' } })], 'Alpha');
  const a2 = attributeCompany([snap({ company_id: 'b', taken_at: 't1', readiness_score: 40 }), snap({ company_id: 'b', taken_at: 't2', readiness_score: 70, areas: { WEBSITE: 'READY', GOOGLE_ANALYTICS: 'READY' } })], 'Beta');
  const a3 = attributeCompany([snap({ company_id: 'c', taken_at: 't1', readiness_score: 50 }), snap({ company_id: 'c', taken_at: 't2', readiness_score: 60 })], 'Gamma'); // unattributed
  const a4 = attributeCompany([snap({ company_id: 'd' })], 'Delta'); // insufficient
  const p = generatePortfolioImpact([a1, a2, a3, a4]);

  it('aggregates attributed / possible / unattributed / insufficient', () => {
    expect(p.attributed_improvements).toBe(1);   // a1
    expect(p.possible_improvements).toBe(2);      // a2 (2 candidates)
    expect(p.unattributed_improvements).toBe(1);  // a3
    expect(p.insufficient_data_companies).toBe(1);// a4
  });
  it('top impact drivers ranked by attributed then possible', () => {
    expect(p.top_impact_drivers[0].intervention_type).toBe('DOMAIN_VERIFICATION'); // 1 attributed + 1 possible
    expect(p.top_impact_drivers[0].attributed).toBe(1);
  });
  it('most common improvement paths', () => {
    expect(p.most_common_improvement_paths.some((x) => x.path === 'DOMAIN_VERIFICATION → READINESS_INCREASE')).toBe(true);
  });
});

describe('determinism + orchestrator', () => {
  it('identical inputs yield identical output', () => {
    const s = [snap({ taken_at: 't1', readiness_score: 50 }), snap({ taken_at: 't2', readiness_score: 62, areas: { WEBSITE: 'READY' } })];
    expect(JSON.stringify(attributeCompany(s))).toBe(JSON.stringify(attributeCompany(s)));
  });
  it('orchestrator binds company refs via injected loader', async () => {
    const load = async () => new Map<string, OutcomeSnapshot[]>([
      ['a', [snap({ company_id: 'a', taken_at: 't1', readiness_score: 50 }), snap({ company_id: 'a', taken_at: 't2', readiness_score: 70, areas: { WEBSITE: 'READY' } })]],
    ]);
    const res = await getCustomerImpactAttribution([{ company_id: 'a', company_name: 'Alpha' }, { company_id: 'z', company_name: 'Zeta' }], { load });
    const byId = Object.fromEntries(res.per_company.map((c) => [c.company_id, c]));
    expect(byId['a'].impact_status).toBe('ATTRIBUTED');
    expect(byId['z'].impact_status).toBe('INSUFFICIENT_DATA');
  });
});
