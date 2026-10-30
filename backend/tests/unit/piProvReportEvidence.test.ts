/**
 * Workstream D — source evidence survives the report plugin
 * (`leadIntelligenceSnapshotAdapter`): a signal seen both as a durable lead and as
 * a canonical prospect is counted ONCE, with its source + origin breakdown, and
 * the merge outcome is stated in the pipeline findings.
 */
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => {
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'is', 'in', 'order']) chain[m] = () => chain;
    chain.limit = async () => ({ data: [], error: null });
    (chain as { then?: unknown }).then = (res: (v: unknown) => void) => res({ data: [], error: null });
    return chain;
  },
}));
jest.mock('../../services/leadIntelligence/leadIntelligenceRepository', () => ({ listCanonicalLeads: jest.fn(async () => []) }));
jest.mock('../../services/activationReadinessService', () => ({ buildActivationReadiness: jest.fn(async () => null) }));
jest.mock('../../services/leadIntelligence/leadIntelligenceReadService', () => {
  const actual = jest.requireActual('../../services/leadIntelligence/leadIntelligenceReadService');
  return {
    ...actual,
    getLeadStats: (q: unknown, r?: unknown) => actual.getLeadStats(q, r ?? (globalThis as { __testReaders?: unknown }).__testReaders),
  };
});

import { leadPlugin } from '../../services/leadIntelligence/leadIntelligenceSnapshotAdapter';
import type { LeadSourceReaders } from '../../services/leadIntelligence/leadIntelligenceReadService';
import { readContributionsForLeads, readContributionsBySignalRefs, type ContributionQueryPort } from '../../services/prospectProvenance/contributionReader';
import { projectExistingRow } from '../../../lib/leadIntelligence';

const CO1 = '11111111-1111-1111-1111-111111111111';
type Row = Record<string, unknown>;

const contributions: Row[] = [{
  id: 'c-1', organization_id: CO1, canonical_lead_id: 'cl-1', contribution_role: 'originating', source_category: 'community',
  external_ref: 'community:feed-1', source_record_id: null, platform: 'reddit', source_url: null, contact_id: null,
  lead_signal_id: null, opportunity_feed_item_id: 'feed-1', engagement_message_id: null,
  observed_at: '2026-10-01T09:00:00+00:00', evidence: {},
}];
const port: ContributionQueryPort = {
  byLeads: async (org, ids) => ({ data: contributions.filter((r) => r.organization_id === org && ids.includes(String(r.canonical_lead_id))), error: null }),
  originating: async (org) => ({ data: contributions.filter((r) => r.organization_id === org), error: null }),
  bySignalRefs: async (org, col, ids) => ({ data: contributions.filter((r) => r.organization_id === org && ids.includes(String(r[col]))), error: null }),
};

function readers(signalFails = false): LeadSourceReaders {
  return {
    durable: async () => [projectExistingRow('community', { id: 'feed-1', organization_id: CO1, opportunity_type: 'x', created_at: '2026-10-01T09:00:00Z' })],
    leads: async () => [],
    canonicalLeads: async () => [{ id: 'cl-1', company_id: CO1, source: 'community', unified_person_id: null, created_at: '2026-10-01T10:00:00Z' }],
    contributions: (co, ids) => readContributionsForLeads(co, ids, { port }),
    originatingContributions: async (co) => ({ status: 'ok', byLead: (await readContributionsForLeads(co, ['cl-1'], { port })).byLead, truncated: false, reads: 1 }),
    signalLinks: signalFails
      ? async () => ({ status: 'table_missing', byLead: new Map(), truncated: false, reads: 1 })
      : (co, refs) => readContributionsBySignalRefs(co, refs, { port }),
  };
}

let warn: jest.SpyInstance;
beforeEach(() => { warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined); });
afterEach(() => warn.mockRestore());

describe('report plugin — merged signal evidence', () => {
  it('counts the merged lead once and keeps source + origin attribution', async () => {
    (globalThis as { __testReaders?: unknown }).__testReaders = readers();
    const data = await leadPlugin.provide({ companyId: CO1 } as never);
    const pipeline = data.modules.find((m) => m.key === 'pipeline')!;
    expect(pipeline.findings).toEqual(expect.arrayContaining([
      '1 leads in pipeline',
      '1 from community',
      '1 originated via community',
      '1 signal record(s) linked to their canonical prospect (counted once)',
    ]));
  });

  it('states when signal linking is unavailable (possible double count)', async () => {
    (globalThis as { __testReaders?: unknown }).__testReaders = readers(true);
    const data = await leadPlugin.provide({ companyId: CO1 } as never);
    const pipeline = data.modules.find((m) => m.key === 'pipeline')!;
    expect(pipeline.findings).toEqual(expect.arrayContaining([
      '2 leads in pipeline',
      'Signal linking unavailable — a signal may be counted both as a lead and as a prospect',
    ]));
  });
});
