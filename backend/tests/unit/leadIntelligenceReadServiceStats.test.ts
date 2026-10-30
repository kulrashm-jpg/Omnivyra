jest.mock('../../db/writeOwner', () => ({ ownedDbTable: () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) }));
jest.mock('../../services/leadIntelligence/leadIntelligenceRepository', () => ({ listCanonicalLeads: jest.fn(async () => []) }));

import { getLeadStats, getActiveLeadsView, type LeadSourceReaders } from '../../services/leadIntelligence/leadIntelligenceReadService';

function readers(): { r: LeadSourceReaders; calls: Record<string, number> } {
  const calls = { durable: 0, leads: 0, canonicalLeads: 0 };
  const r: LeadSourceReaders = {
    durable: async () => { calls.durable += 1; return []; },
    leads: async () => { calls.leads += 1; return [{ id: 'l1', company_id: 'co1', email: 'a@b.com', source: 'form_embed', metadata: {} }]; },
    // Community prospects now arrive as canonical prospects (persisted source
    // `community`); the legacy `active_leads` reader is removed.
    canonicalLeads: async () => { calls.canonicalLeads += 1; return [
      { id: 'cl1', company_id: 'co1', email: 'z@b.com', source: 'hubspot', unified_source: { category: 'crm' }, qualification_score: 90 },
      { id: 'cl2', company_id: 'co1', contact_id: 'c1', source: 'community', qualification_score: 80, lead_status: 'new' },
      { id: 'cl3', company_id: 'co1', contact_id: 'c2', source: 'community', qualification_score: 30, lead_status: 'reviewing' },
    ]; },
    contributions: async () => ({ status: 'ok', byLead: new Map(), truncated: false, reads: 1 }),
    originatingContributions: async () => ({ status: 'ok', byLead: new Map(), truncated: false, reads: 1 }),
  };
  return { r, calls };
}

describe('Read service — repository-owned aggregation', () => {
  it('getLeadStats aggregates across all merged sources (anti-N+1)', async () => {
    const { r, calls } = readers();
    const s = await getLeadStats({ companyId: 'co1' }, r);
    expect(s.total).toBe(4);
    expect(s.bySource).toEqual({ community: 2, website: 1, crm: 1 });
    expect(calls).toEqual({ durable: 1, leads: 1, canonicalLeads: 1 });
  });

  it('getLeadStats respects filters', async () => {
    const { r } = readers();
    const s = await getLeadStats({ companyId: 'co1', filters: { source: 'community' } }, r);
    expect(s.total).toBe(2);
  });

  it('getActiveLeadsView returns community scope only, paginated', async () => {
    const { r } = readers();
    const view = await getActiveLeadsView({ companyId: 'co1', page: { limit: 1, offset: 0 } }, r);
    expect(view.total).toBe(2); // both community
    expect(view.rows).toHaveLength(1); // paginated
    expect(view.rows[0].source).toBe('community');
  });

  it('empty company short-circuits', async () => {
    const { r } = readers();
    expect((await getLeadStats({ companyId: '' }, r)).total).toBe(0);
    expect((await getActiveLeadsView({ companyId: '' }, r)).total).toBe(0);
  });
});
