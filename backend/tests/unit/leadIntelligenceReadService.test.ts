/**
 * Unified read service — merge (durable ∪ legacy), dedupe, filter/search/paginate,
 * anti-N+1 (each source read once), tenant isolation, large dataset, export,
 * backward compatibility (durable empty → legacy serves). Custom readers injected
 * so no DB is touched; server deps mocked for safe module load.
 */
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) }));
jest.mock('../../services/leadIntelligence/leadIntelligenceRepository', () => ({ listCanonicalLeads: jest.fn(async () => []) }));

import { searchLeads, exportLeads, type LeadSourceReaders } from '../../services/leadIntelligence/leadIntelligenceReadService';
import type { CanonicalLeadView } from '../../../lib/leadIntelligence';

const durableView = (id: string): CanonicalLeadView => ({
  organizationId: 'co1', source: 'website', sourceLabel: 'Website', unifiedPersonId: `up_${id}`,
  identity: { email: `${id}@b.com` }, scores: { intent: 0.9 }, status: 'new', campaign: 'q3', content: null, referrer: null,
  utm: { source: null, medium: null, campaign: null, content: null, term: null }, occurredAt: '2026-03-01T00:00:00Z',
  sourceRef: { table: 'lead_intelligence', id }, attribution: { originalSource: null, originalChannel: null, campaign: 'q3', content: null, session: null, journey: null, referrer: null, utm: { source: null, medium: null, campaign: null, content: null, term: null }, identity: {}, sourceMetadata: {} },
});

function readers(over: Partial<LeadSourceReaders> = {}): { r: LeadSourceReaders; calls: Record<string, number> } {
  const calls = { durable: 0, activeLeads: 0, leads: 0, canonicalLeads: 0 };
  const r: LeadSourceReaders = {
    durable: async (c) => { calls.durable += 1; return over.durable ? over.durable(c) : []; },
    activeLeads: async (c) => { calls.activeLeads += 1; return over.activeLeads ? over.activeLeads(c) : []; },
    leads: async (c) => { calls.leads += 1; return over.leads ? over.leads(c) : []; },
    canonicalLeads: async (c) => { calls.canonicalLeads += 1; return over.canonicalLeads ? over.canonicalLeads(c) : []; },
  };
  return { r, calls };
}

describe('Lead Intelligence read service', () => {
  it('merges durable ∪ legacy into one unified result', async () => {
    const { r } = readers({
      durable: async () => [durableView('d1')],
      activeLeads: async () => [{ id: 'o1', organization_id: 'co1', opportunity_type: 'buying_intent', contact_id: 'c1', total_score: 0.5, status: 'new' }],
      leads: async () => [{ id: 'l1', company_id: 'co1', email: 'x@b.com', source: 'form_embed' }],
      canonicalLeads: async () => [{ id: 'cl1', company_id: 'co1', email: 'y@b.com', source: 'hubspot', unified_source: { category: 'crm' } }],
    });
    const res = await searchLeads({ companyId: 'co1' }, r);
    expect(res.total).toBe(4);
    expect(res.rows.map((v) => v.source).sort()).toEqual(['community', 'crm', 'website', 'website']);
  });

  it('anti-N+1: each source is read exactly once per query', async () => {
    const { r, calls } = readers({ leads: async () => Array.from({ length: 100 }, (_, i) => ({ id: `l${i}`, company_id: 'co1', email: `${i}@b.com`, source: 'form_embed' })) });
    await searchLeads({ companyId: 'co1' }, r);
    expect(calls).toEqual({ durable: 1, activeLeads: 1, leads: 1, canonicalLeads: 1 });
  });

  it('dedupes durable vs legacy (durable wins)', async () => {
    const { r } = readers({
      durable: async () => [{ ...durableView('1'), sourceRef: { table: 'leads', id: '1' }, status: 'durable' }],
      leads: async () => [{ id: '1', company_id: 'co1', email: 'a@b.com', source: 'form_embed' }],
    });
    const res = await searchLeads({ companyId: 'co1' }, r);
    expect(res.total).toBe(1);
    expect(res.rows[0].status).toBe('durable');
  });

  it('applies filters + pagination through the service', async () => {
    const { r } = readers({ leads: async () => Array.from({ length: 10 }, (_, i) => ({ id: `l${i}`, company_id: 'co1', email: `${i}@b.com`, source: 'form_embed' })) });
    const page = await searchLeads({ companyId: 'co1', page: { limit: 3, offset: 0 } }, r);
    expect(page.rows).toHaveLength(3);
    expect(page.total).toBe(10);
  });

  it('tenant isolation (no leakage) + missing company short-circuits', async () => {
    const { r } = readers({ leads: async () => [{ id: 'l1', company_id: 'co2', email: 'x@b.com', source: 'form_embed' }] });
    expect((await searchLeads({ companyId: 'co1' }, r)).total).toBe(0);
    expect((await searchLeads({ companyId: '' }, r)).total).toBe(0);
  });

  it('backward compatible: durable empty → legacy serves the data', async () => {
    const { r } = readers({ durable: async () => [], leads: async () => [{ id: 'l1', company_id: 'co1', email: 'x@b.com', source: 'form_embed' }] });
    expect((await searchLeads({ companyId: 'co1' }, r)).total).toBe(1);
  });

  it('handles a large dataset within the service cap', async () => {
    const { r } = readers({ leads: async () => Array.from({ length: 3000 }, (_, i) => ({ id: `l${i}`, company_id: 'co1', email: `${i}@b.com`, source: 'form_embed' })) });
    const res = await searchLeads({ companyId: 'co1', page: { limit: 500, offset: 0 } }, r);
    expect(res.total).toBe(3000);
    expect(res.rows).toHaveLength(500);
  });

  it('exports CSV + Excel over the unified set', async () => {
    const { r } = readers({ leads: async () => [{ id: 'l1', company_id: 'co1', email: 'a@b.com', source: 'form_embed' }] });
    const csv = await exportLeads({ companyId: 'co1' }, 'csv', r);
    expect(csv.contentType).toContain('text/csv');
    expect(csv.body).toContain('identity,company,source');
    expect(csv.body).toContain('a@b.com');
    const xls = await exportLeads({ companyId: 'co1' }, 'excel', r);
    expect(xls.contentType).toContain('ms-excel');
    expect(xls.body).toContain('Excel.Sheet');
  });
});
