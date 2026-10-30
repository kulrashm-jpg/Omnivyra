/**
 * Provenance in the unified lead reader (Agent 3).
 *
 *   - contributionReader: contract mapping, deterministic order, chunked reads,
 *     tenant re-check, missing-table fail-open that is OBSERVABLE, truncation;
 *   - read service: `sources[]` / `evidence[]` populated for canonical prospects,
 *     one read per page, no duplicate prospects, explicit score scales, Apollo
 *     not displayed as CRM, visible truncation, no cross-tenant contributions;
 *   - dedupe: the fallback key reaches contactId, anonymous rows never collapse,
 *     distinct prospects never merge, contributions are never dropped.
 *
 * No database: the contribution reader takes an injected port, and the read
 * service takes injected readers; `writeOwner` is doubled with a table-keyed fake
 * for the default-reader paths.
 */
type Behaviour = { error?: { code: string; message: string }; data?: Array<Record<string, unknown>>; throws?: string };
const db: Record<string, Behaviour> = {};
const issued: Array<{ table: string; filters: Array<[string, string, unknown]>; orders: string[]; limit: number | null }> = [];

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const call = { table, filters: [] as Array<[string, string, unknown]>, orders: [] as string[], limit: null as number | null };
    const chain: Record<string, unknown> = {};
    const run = async () => {
      issued.push(call);
      const b = db[table] ?? {};
      if (b.throws) throw new Error(b.throws);
      if (b.error) return { data: null, error: b.error };
      // Honour eq / in like PostgREST so tenant filters are really exercised.
      const rows = (b.data ?? []).filter((r) => call.filters.every(([op, col, val]) =>
        op === 'eq' ? r[col] === val : op === 'in' ? (val as unknown[]).includes(r[col]) : op === 'is' ? r[col] === val : true));
      return { data: call.limit != null ? rows.slice(0, call.limit) : rows, error: null };
    };
    chain.select = () => chain;
    chain.eq = (c: string, v: unknown) => { call.filters.push(['eq', c, v]); return chain; };
    chain.in = (c: string, v: unknown) => { call.filters.push(['in', c, v]); return chain; };
    chain.is = (c: string, v: unknown) => { call.filters.push(['is', c, v]); return chain; };
    chain.order = (c: string) => { call.orders.push(c); return chain; };
    chain.limit = (n: number) => { call.limit = n; return run(); };
    (chain as { then?: unknown }).then = (res: (v: unknown) => void, rej: (e: unknown) => void) => run().then(res, rej);
    return chain;
  },
}));
jest.mock('../../services/leadIntelligence/leadIntelligenceRepository', () => ({ listCanonicalLeads: jest.fn(async () => []) }));

import {
  readContributionsForLeads,
  readOriginatingContributions,
  mapContributionRow,
  resetContributionReadReportsForTests,
  CHUNK,
  READ_CAP,
  type ContributionQueryPort,
  type ContributionReadResult,
} from '../../services/prospectProvenance/contributionReader';
import {
  searchLeads,
  getLeadStats,
  getLeadProfile,
  listAllLeads,
  defaultLeadSourceReaders,
  resetReadFailureReportsForTests,
  type LeadSourceReaders,
} from '../../services/leadIntelligence/leadIntelligenceReadService';
import { dedupeViews, leadKeyFor, projectExistingRow, type CanonicalLeadView } from '../../../lib/leadIntelligence';
import type { ProvenanceContribution } from '../../../lib/prospectProvenance/contract';

const CO1 = '11111111-1111-1111-1111-111111111111';
const CO2 = '22222222-2222-2222-2222-222222222222';

const contributionRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'c-1', organization_id: CO1, canonical_lead_id: 'cl-1', contribution_role: 'originating',
  source_category: 'community', external_ref: 'community:feed-1', source_record_id: 'sr-1', platform: 'reddit',
  source_url: 'https://reddit.com/r/x/comments/1', contact_id: null, lead_signal_id: null,
  opportunity_feed_item_id: 'feed-1', engagement_message_id: null, observed_at: '2026-10-01T10:00:00+00:00',
  evidence: { excerpt_hash: 'h1' }, source_metadata: { secret_payload: 'must-not-be-read' },
  ...over,
});

const okResult = (byLead: Record<string, ProvenanceContribution[]>): ContributionReadResult =>
  ({ status: 'ok', byLead: new Map(Object.entries(byLead)), truncated: false, reads: 1 });

const contribution = (over: Partial<ProvenanceContribution> = {}): ProvenanceContribution => ({
  id: 'c-1', role: 'originating', sourceCategory: 'community', externalRef: 'community:feed-1', platform: 'reddit',
  sourceUrl: 'https://reddit.com/r/x/comments/1', sourceRecordId: 'sr-1', observedAt: '2026-10-01T10:00:00+00:00',
  signalRefs: { opportunityFeedItemId: 'feed-1', leadSignalId: null, engagementMessageId: null, contactId: null },
  evidence: { excerpt_hash: 'h1' }, ...over,
});

let warn: jest.SpyInstance;
beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  issued.length = 0;
  resetContributionReadReportsForTests();
  resetReadFailureReportsForTests();
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => warn.mockRestore());

/* ── contributionReader ──────────────────────────────────────────────────── */

describe('contributionReader — mapping and order', () => {
  it('maps a row to the contract shape and never exposes source_metadata', () => {
    const c = mapContributionRow(contributionRow());
    expect(c).toEqual({
      id: 'c-1', role: 'originating', sourceCategory: 'community', externalRef: 'community:feed-1', platform: 'reddit',
      sourceUrl: 'https://reddit.com/r/x/comments/1', sourceRecordId: 'sr-1', observedAt: '2026-10-01T10:00:00+00:00',
      signalRefs: { leadSignalId: null, opportunityFeedItemId: 'feed-1', engagementMessageId: null, contactId: null },
      evidence: { excerpt_hash: 'h1' },
    });
    expect(JSON.stringify(c)).not.toContain('must-not-be-read');
  });

  it('rejects rows that violate the contract (unknown category / role / missing time)', () => {
    expect(mapContributionRow(contributionRow({ source_category: 'social' }))).toBeNull();
    expect(mapContributionRow(contributionRow({ contribution_role: 'primary' }))).toBeNull();
    expect(mapContributionRow(contributionRow({ observed_at: null }))).toBeNull();
  });

  it('returns the complete history per lead: originating first, then by observedAt, then id', async () => {
    const port: ContributionQueryPort = {
      byLeads: async () => ({ data: [
        contributionRow({ id: 'c-3', contribution_role: 'contributing', source_category: 'pi_enrichment', platform: 'apollo', external_ref: 'apollo:p1', observed_at: '2026-10-05T00:00:00+00:00' }),
        contributionRow({ id: 'c-2', contribution_role: 'contributing', source_category: 'crm', platform: 'hubspot', external_ref: 'crm_hubspot:9', observed_at: '2026-10-03T00:00:00+00:00' }),
        contributionRow({ id: 'c-1', observed_at: '2026-10-09T00:00:00+00:00' }),
      ], error: null }),
      originating: async () => ({ data: [], error: null }),
    };
    const r = await readContributionsForLeads(CO1, ['cl-1'], { port });
    expect(r.status).toBe('ok');
    expect(r.byLead.get('cl-1')!.map((c) => c.id)).toEqual(['c-1', 'c-2', 'c-3']);
  });
});

describe('contributionReader — tenant isolation', () => {
  it('drops (and reports) a row of another tenant or of an unrequested lead', async () => {
    const port: ContributionQueryPort = {
      byLeads: async () => ({ data: [
        contributionRow(),
        contributionRow({ id: 'x-1', organization_id: CO2 }),
        contributionRow({ id: 'x-2', canonical_lead_id: 'cl-other' }),
      ], error: null }),
      originating: async () => ({ data: [], error: null }),
    };
    const r = await readContributionsForLeads(CO1, ['cl-1'], { port });
    expect([...r.byLead.values()].flat().map((c) => c.id)).toEqual(['c-1']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0].join(' '))).toContain('outside the requested tenant');
  });

  it('the default port filters by organization_id and canonical_lead_id', async () => {
    db.prospect_source_contributions = { data: [contributionRow(), contributionRow({ id: 'x-1', organization_id: CO2 })] };
    const r = await readContributionsForLeads(CO1, ['cl-1']);
    expect([...r.byLead.values()].flat().map((c) => c.id)).toEqual(['c-1']);
    const call = issued.find((c) => c.table === 'prospect_source_contributions')!;
    expect(call.filters).toEqual(expect.arrayContaining([['eq', 'organization_id', CO1], ['in', 'canonical_lead_id', ['cl-1']]]));
    expect(call.orders).toEqual(['canonical_lead_id', 'observed_at', 'id']);
    expect(call.limit).toBe(READ_CAP + 1);
  });
});

describe('contributionReader — fail-open, observably', () => {
  it.each([
    ['42P01', 'relation "public.prospect_source_contributions" does not exist'],
    ['PGRST205', "Could not find the table 'public.prospect_source_contributions' in the schema cache"],
  ])('missing table (%s) → empty, status table_missing, reported once — never throws', async (code, message) => {
    db.prospect_source_contributions = { error: { code, message } };
    const a = await readContributionsForLeads(CO1, ['cl-1']);
    const b = await readContributionsForLeads(CO1, ['cl-2']);
    expect(a).toMatchObject({ status: 'table_missing', truncated: false });
    expect(a.byLead.size).toBe(0);
    expect(b.status).toBe('table_missing');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]).toEqual(expect.arrayContaining([code]));
  });

  it('a thrown exception is status error, reported, never thrown', async () => {
    db.prospect_source_contributions = { throws: 'socket hang up' };
    await expect(readContributionsForLeads(CO1, ['cl-1'])).resolves.toMatchObject({ status: 'error' });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('the originating-only read fails open the same way', async () => {
    db.prospect_source_contributions = { error: { code: '42P01', message: 'missing' } };
    await expect(readOriginatingContributions(CO1)).resolves.toMatchObject({ status: 'table_missing' });
  });
});

describe('contributionReader — bounded reads', () => {
  it('one read per chunk of ≤ CHUNK lead ids (a page of 50 is one read)', async () => {
    const seen: number[] = [];
    const port: ContributionQueryPort = {
      byLeads: async (_o, ids) => { seen.push(ids.length); return { data: [], error: null }; },
      originating: async () => ({ data: [], error: null }),
    };
    expect((await readContributionsForLeads(CO1, Array.from({ length: 50 }, (_, i) => `l${i}`), { port })).reads).toBe(1);
    seen.length = 0;
    const r = await readContributionsForLeads(CO1, Array.from({ length: CHUNK * 2 + 5 }, (_, i) => `l${i}`), { port });
    expect(r.reads).toBe(3);
    expect(seen).toEqual([CHUNK, CHUNK, 5]);
  });

  it('hitting READ_CAP sets truncated and logs it', async () => {
    const port: ContributionQueryPort = {
      byLeads: async () => ({ data: Array.from({ length: READ_CAP + 1 }, (_, i) => contributionRow({ id: `c${String(i).padStart(5, '0')}`, external_ref: `community:${i}`, contribution_role: i === 0 ? 'originating' : 'contributing' })), error: null }),
      originating: async () => ({ data: [], error: null }),
    };
    const r = await readContributionsForLeads(CO1, ['cl-1'], { port });
    expect(r.truncated).toBe(true);
    expect(r.byLead.get('cl-1')).toHaveLength(READ_CAP);
    expect(warn.mock.calls.flat().join(' ')).toContain('truncated');
  });
});

/* ── read service ────────────────────────────────────────────────────────── */

const canonicalRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'cl-1', company_id: CO1, user_id: 'u1', source: 'community', created_at: '2026-10-01T10:00:00Z',
  qualification_score: 40, external_lead_key: 'feed-1', lead_status: null, lead_metadata: { company_name: 'Acme' }, unified_person_id: 'up-1',
  ...over,
});

function readers(over: Partial<LeadSourceReaders> = {}): LeadSourceReaders & { contributionCalls: string[][] } {
  const contributionCalls: string[][] = [];
  return {
    durable: async () => [],
    leads: async () => [],
    canonicalLeads: async () => [canonicalRow()],
    contributions: async (_c, ids) => { contributionCalls.push(ids); return okResult({ 'cl-1': [contribution()] }); },
    originatingContributions: async () => okResult({ 'cl-1': [contribution()] }),
    ...over,
    contributionCalls,
  };
}

describe('read service — sources[] and evidence[]', () => {
  it('populates typed sources and evidence for a canonical prospect', async () => {
    const res = await searchLeads({ companyId: CO1 }, readers());
    expect(res.provenance).toBe('ok');
    const v = res.rows[0];
    expect(v.provenanceStatus).toBe('loaded');
    expect(v.sources).toEqual([contribution()]);
    expect(v.origin).toEqual({ category: 'community', platform: 'reddit', observedAt: '2026-10-01T10:00:00+00:00' });
    expect(v.evidence!.map((e) => [e.kind, e.ref])).toEqual([
      ['source_url', 'https://reddit.com/r/x/comments/1'],
      ['source_record', 'sr-1'],
      ['opportunity_feed_item', 'feed-1'],
    ]);
    expect(v.evidence!.every((e) => e.contributionId === 'c-1' && e.role === 'originating')).toBe(true);
  });

  it('non-canonical rows are marked not_applicable with empty arrays (always set)', async () => {
    const res = await searchLeads({ companyId: CO1 }, readers({
      canonicalLeads: async () => [],
      leads: async () => [{ id: 'l1', company_id: CO1, email: 'a@b.com', source: 'form_embed' }],
    }));
    expect(res.rows[0]).toMatchObject({ sources: [], evidence: [], provenanceStatus: 'not_applicable' });
    expect(res.provenance).toBe('not_requested');
  });

  it('reads provenance ONCE for the returned page only, with that page\'s ids', async () => {
    const r = readers({ canonicalLeads: async () => Array.from({ length: 120 }, (_, i) => canonicalRow({ id: `cl-${String(i).padStart(3, '0')}`, created_at: `2026-10-01T10:${String(i % 60).padStart(2, '0')}:00Z` })) });
    const res = await searchLeads({ companyId: CO1, page: { limit: 20, offset: 0 } }, r);
    expect(res.total).toBe(120);
    expect(r.contributionCalls).toHaveLength(1);
    expect(r.contributionCalls[0]).toHaveLength(20);
    expect(r.contributionCalls[0].sort()).toEqual(res.rows.map((v) => v.sourceRef!.id!).sort());
  });

  it('missing table in production → rows still served, provenance unavailable, logged once, no throw', async () => {
    db.prospect_source_contributions = { error: { code: '42P01', message: 'relation does not exist' } };
    const { contributions, ...rest } = readers();
    void contributions;
    const r: LeadSourceReaders = { ...rest, contributions: defaultLeadSourceReaders.contributions };
    const a = await searchLeads({ companyId: CO1 }, r);
    await searchLeads({ companyId: CO1 }, r);
    expect(a.total).toBe(1);
    expect(a.provenance).toBe('unavailable');
    expect(a.rows[0]).toMatchObject({ provenanceStatus: 'unavailable', sources: [], evidence: [] });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]).toEqual(expect.arrayContaining(['42P01']));
  });

  it('an injected contributions reader that throws is fail-open too', async () => {
    const res = await searchLeads({ companyId: CO1 }, readers({ contributions: async () => { throw new Error('boom'); } }));
    expect(res.provenance).toBe('unavailable');
    expect(res.rows[0].provenanceStatus).toBe('unavailable');
  });

  it('the profile timeline carries one event per contribution', async () => {
    const r = readers({
      contributions: async () => okResult({ 'cl-1': [
        contribution(),
        contribution({ id: 'c-2', role: 'contributing', sourceCategory: 'pi_enrichment', platform: 'apollo', externalRef: 'apollo:p1', observedAt: '2026-10-04T00:00:00+00:00', sourceUrl: null }),
      ] }),
    });
    const list = await searchLeads({ companyId: CO1 }, r);
    const profile = await getLeadProfile(CO1, leadKeyFor(list.rows[0]), r);
    const types = profile!.timeline.map((e) => e.eventType);
    expect(types).toEqual(expect.arrayContaining(['lead_captured', 'source_originated', 'source_contributed']));
    expect(profile!.view.sources).toHaveLength(2);
  });
});

describe('read service — the legacy active_leads source is gone', () => {
  it('no active_leads read is issued by the default readers', async () => {
    db.leads = { data: [] };
    db.canonical_leads = { data: [] };
    await searchLeads({ companyId: CO1 }, defaultLeadSourceReaders);
    expect(issued.map((c) => c.table)).not.toContain('active_leads');
    expect(issued.map((c) => c.table).sort()).toEqual(['canonical_leads', 'leads']);
  });
});

describe('read service — no duplicate prospects', () => {
  it('a durable view of the same canonical prospect collapses into one row that keeps the full history', async () => {
    const durable: CanonicalLeadView = { ...projectExistingRow('community', canonicalRow()), sourceRef: { table: 'canonical_leads', id: 'cl-1' } };
    const res = await searchLeads({ companyId: CO1 }, readers({
      durable: async () => [durable],
      contributions: async () => okResult({ 'cl-1': [contribution(), contribution({ id: 'c-2', role: 'contributing', externalRef: 'community:feed-2' })] }),
    }));
    expect(res.total).toBe(1);
    expect(res.rows[0].sources!.map((c) => c.id)).toEqual(['c-1', 'c-2']);
  });

  it('many contributions on one prospect never become extra rows', async () => {
    const many = Array.from({ length: 7 }, (_, i) => contribution({ id: `c-${i}`, role: i === 0 ? 'originating' : 'contributing', externalRef: `community:f${i}` }));
    const res = await searchLeads({ companyId: CO1 }, readers({ contributions: async () => okResult({ 'cl-1': many }) }));
    expect(res.total).toBe(1);
    expect(res.rows[0].sources).toHaveLength(7);
  });
});

describe('read service — explicit score scales', () => {
  it('canonical_leads.qualification_score (percent) is converted to unit, raw kept', async () => {
    const res = await searchLeads({ companyId: CO1 }, readers());
    expect(res.rows[0].scores).toMatchObject({ total: 0.4, scale: 'unit' });
    expect(res.rows[0].scores.sourceScores).toEqual([{ field: 'qualification_score', value: 40, scale: 'percent', unit: 0.4 }]);
  });

  it('community opportunity_score (unit, CHECK 0..1) is no longer dropped', () => {
    const v = projectExistingRow('community', { id: 'o1', organization_id: CO1, opportunity_type: 'buying_intent', opportunity_score: 0.72, urgency_score: 0.3, confidence_score: 0.6 });
    expect(v.scores.total).toBe(0.72);
    expect(v.scores.urgency).toBe(0.3);
  });

  it('an out-of-range score is not used, but is kept with its scale (never silently rescaled)', () => {
    const v = projectExistingRow('crm', { id: 'x', company_id: CO1, source: 'hubspot', qualification_score: 140 });
    expect(v.scores.total).toBeNull();
    expect(v.scores.sourceScores).toEqual([{ field: 'qualification_score', value: 140, scale: 'percent', unit: null }]);
  });

  it('numeric strings (PostgREST numeric) convert too', () => {
    expect(projectExistingRow('crm', { id: 'x', company_id: CO1, source: 'hubspot', qualification_score: '25.50' }).scores.total).toBeCloseTo(0.255);
  });
});

describe('read service — Apollo is not displayed as CRM', () => {
  it('row-level: a canonical prospect with raw source apollo', async () => {
    const res = await searchLeads({ companyId: CO1 }, readers({
      canonicalLeads: async () => [canonicalRow({ source: 'apollo' })],
      contributions: async () => okResult({}),
    }));
    const v = res.rows[0];
    expect(v.source).toBe('crm');            // persisted display source unchanged (keys/memberships)
    expect(v.sourceLabel).toBe('Prospect discovery · Apollo');
    expect(v.origin).toMatchObject({ category: 'pi_discovery', platform: 'apollo' });
  });

  it('contribution-level: a pi_enrichment originating contribution on platform apollo', async () => {
    const res = await searchLeads({ companyId: CO1 }, readers({
      canonicalLeads: async () => [canonicalRow({ source: 'hubspot_import' })],
      contributions: async () => okResult({ 'cl-1': [contribution({ sourceCategory: 'pi_enrichment', platform: 'apollo', externalRef: 'apollo:p1' })] }),
    }));
    expect(res.rows[0].sourceLabel).toBe('Prospect enrichment · Apollo');
  });

  it('a real CRM origin keeps the CRM label', async () => {
    const res = await searchLeads({ companyId: CO1 }, readers({
      canonicalLeads: async () => [canonicalRow({ source: 'hubspot' })],
      contributions: async () => okResult({ 'cl-1': [contribution({ sourceCategory: 'crm', platform: 'hubspot', externalRef: 'crm_hubspot:1' })] }),
    }));
    expect(res.rows[0].sourceLabel).toBe('CRM');
  });
});

describe('read service — visible truncation', () => {
  it('default readers order deterministically and flag a capped source', async () => {
    db.leads = { data: Array.from({ length: 2001 }, (_, i) => ({ id: `l${i}`, company_id: CO1, email: `${i}@b.com`, source: 'form_embed', created_at: '2026-10-01T00:00:00Z' })) };
    db.canonical_leads = { data: [] };
    const res = await searchLeads({ companyId: CO1 }, { ...defaultLeadSourceReaders });
    expect(res.total).toBe(2000);
    expect(res.truncated).toBe(true);
    expect(res.truncatedSources).toEqual(['leads']);
    const call = issued.find((c) => c.table === 'leads')!;
    expect(call.orders).toEqual(['created_at', 'id']);
    expect(call.limit).toBe(2001);
    expect(warn.mock.calls.flat().join(' ')).toContain('hit its cap of 2000');
  });

  it('an uncapped read is not flagged', async () => {
    const res = await searchLeads({ companyId: CO1 }, readers());
    expect(res.truncated).toBe(false);
    expect(res.truncatedSources).toEqual([]);
  });
});

describe('read service — tenant isolation', () => {
  it('another tenant\'s canonical prospect never appears, and its id is never sent to the provenance read', async () => {
    const r = readers({ canonicalLeads: async () => [canonicalRow(), canonicalRow({ id: 'cl-foreign', company_id: CO2 })] });
    const res = await searchLeads({ companyId: CO1 }, r);
    expect(res.rows.map((v) => v.sourceRef!.id)).toEqual(['cl-1']);
    expect(r.contributionCalls.flat()).not.toContain('cl-foreign');
  });

  it('default path: contributions of another tenant on the same lead id are not returned', async () => {
    db.prospect_source_contributions = { data: [contributionRow(), contributionRow({ id: 'foreign-c', organization_id: CO2 })] };
    const { contributions, ...rest } = readers();
    void contributions;
    const res = await searchLeads({ companyId: CO1 }, { ...rest, contributions: defaultLeadSourceReaders.contributions });
    expect(res.rows[0].sources!.map((c) => c.id)).toEqual(['c-1']);
    expect(JSON.stringify(res)).not.toContain('foreign-c');
  });
});

describe('listAllLeads — the whole set for audience evaluation', () => {
  it('is not clamped at 500 (searchLeads pages are) and provenance is opt-in', async () => {
    const r = readers({ canonicalLeads: async () => Array.from({ length: 750 }, (_, i) => canonicalRow({ id: `cl-${i}` })) });
    const plain = await listAllLeads({ companyId: CO1 }, {}, r);
    expect(plain.total).toBe(750);
    expect(plain.rows).toHaveLength(750);
    expect(plain.provenance).toBe('not_requested');
    expect(r.contributionCalls).toHaveLength(0);
    const withProv = await listAllLeads({ companyId: CO1 }, { withProvenance: true }, r);
    expect(withProv.provenance).toBe('ok');
    expect(withProv.rows.find((v) => v.sourceRef!.id === 'cl-1')!.sources).toHaveLength(1);
  });
});

describe('stats — per-source breakdowns kept and extended', () => {
  it('keeps bySource and adds byOriginCategory / bySourceLabel', async () => {
    const s = await getLeadStats({ companyId: CO1 }, readers({
      canonicalLeads: async () => [canonicalRow(), canonicalRow({ id: 'cl-2', source: 'apollo' })],
      leads: async () => [{ id: 'l1', company_id: CO1, email: 'a@b.com', source: 'form_embed' }],
      originatingContributions: async () => okResult({ 'cl-1': [contribution()] }),
    }));
    expect(s.bySource).toEqual({ community: 1, crm: 1, website: 1 });
    expect(s.byOriginCategory).toEqual({ community: 1, pi_discovery: 1, unknown: 1 });
    expect(s.bySourceLabel).toEqual({ Community: 1, 'Prospect discovery · Apollo': 1, Website: 1 });
    expect(s.provenance).toBe('ok');
    expect(s.truncated).toBe(false);
  });

  it('stats stay served when provenance is unavailable', async () => {
    const s = await getLeadStats({ companyId: CO1 }, readers({ originatingContributions: async () => ({ status: 'table_missing', byLead: new Map(), truncated: false, reads: 1 }) }));
    expect(s.total).toBe(1);
    expect(s.provenance).toBe('unavailable');
  });
});

/* ── dedupe ─────────────────────────────────────────────────────────────── */

const bare = (over: Partial<CanonicalLeadView> = {}): CanonicalLeadView => ({
  organizationId: CO1, source: 'community', sourceLabel: 'Community', unifiedPersonId: null, identity: {}, scores: {}, status: null,
  campaign: null, content: null, referrer: null, utm: { source: null, medium: null, campaign: null, content: null, term: null },
  occurredAt: '2026-10-01T00:00:00Z', sourceRef: null,
  attribution: { originalSource: null, originalChannel: null, campaign: null, content: null, session: null, journey: null, referrer: null, utm: { source: null, medium: null, campaign: null, content: null, term: null }, identity: {}, sourceMetadata: {} },
  ...over,
});

describe('dedupe', () => {
  it('the fallback key reaches contactId (lc() returns "", never null)', () => {
    const out = dedupeViews([bare({ identity: { contactId: 'c1' } }), bare({ identity: { contactId: 'c2' } })]);
    expect(out).toHaveLength(2);
  });

  it('the same contact at the same time still collapses', () => {
    expect(dedupeViews([bare({ identity: { contactId: 'c1' } }), bare({ identity: { contactId: 'C1' } })])).toHaveLength(1);
  });

  it('rows with no id and no identity are never collapsed', () => {
    expect(dedupeViews([bare(), bare()])).toHaveLength(2);
  });

  it('distinct canonical prospects never merge, even with the same person and time', () => {
    const a = bare({ source: 'crm', unifiedPersonId: 'up1', sourceRef: { table: 'canonical_leads', id: 'cl-1' } });
    const b = bare({ source: 'crm', unifiedPersonId: 'up1', sourceRef: { table: 'canonical_leads', id: 'cl-2' } });
    expect(dedupeViews([a, b])).toHaveLength(2);
  });

  it('collapsing two views of the same row unions their contributions (none dropped)', () => {
    const ref = { table: 'canonical_leads', id: 'cl-1' };
    const a = bare({ source: 'crm', sourceRef: ref, sources: [contribution()], evidence: [] });
    const b = bare({ source: 'crm', sourceRef: ref, sources: [contribution(), contribution({ id: 'c-2', role: 'contributing' })] });
    const out = dedupeViews([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0].sources!.map((c) => c.id)).toEqual(['c-1', 'c-2']);
    expect(a.sources).toHaveLength(1); // inputs are not mutated
  });
});
