/**
 * Workstream D — unified deduplication of signal records and canonical prospects
 * (owner decision 4) + account-only prospect display (read side).
 *
 * A community feed item / engagement signal surfaces as a durable
 * `lead_intelligence` view (keyed by the signal row) AND as a canonical prospect
 * whose provenance contribution references the same signal. They must be ONE
 * lead carrying every source, with the durable key kept as an alias.
 *
 * No database: the contribution/account readers run against in-memory ports that
 * honour the tenant + id filters like PostgREST; `writeOwner` is a table-keyed
 * fake (governance + audience persistence).
 */
type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
const upserts: Array<{ table: string; row: Row }> = [];

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const filters: Array<[string, unknown, 'eq' | 'lt']> = [];
    let mode: 'select' | 'upsert' | 'update' | 'insert' = 'select';
    let payload: Row | null = null;
    const chain: Record<string, unknown> = {};
    const rows = () => (tables[table] ?? []).filter((r) => filters.every(([c, v, op]) => (op === 'lt' ? String(r[c]) < String(v) : r[c] === v)));
    const result = () => {
      if (mode === 'upsert' && payload) {
        upserts.push({ table, row: payload });
        const list = (tables[table] ??= []);
        const i = list.findIndex((r) => r.audience_id === payload!.audience_id && r.entity_id === payload!.entity_id);
        if (i >= 0) list[i] = { ...list[i], ...payload }; else list.push({ ...payload });
        return { data: { id: 'x' }, error: null };
      }
      if (mode === 'update' && payload) {
        for (const r of rows()) Object.assign(r, payload);
        return { data: null, error: null };
      }
      return { data: rows(), error: null };
    };
    chain.select = () => chain;
    chain.eq = (c: string, v: unknown) => { filters.push([c, v, 'eq']); return chain; };
    chain.lt = (c: string, v: unknown) => { filters.push([c, v, 'lt']); return chain; };
    for (const m of ['is', 'in', 'order']) chain[m] = () => chain;
    chain.upsert = (p: Row) => { mode = 'upsert'; payload = p; return chain; };
    chain.update = (p: Row) => { mode = 'update'; payload = p; return chain; };
    chain.insert = (p: Row) => { mode = 'insert'; payload = p; return chain; };
    chain.limit = async () => result();
    chain.maybeSingle = async () => { const r = result(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: null }; };
    (chain as { then?: unknown }).then = (res: (v: unknown) => void, rej: (e: unknown) => void) => Promise.resolve(result()).then(res, rej);
    return chain;
  },
}));
jest.mock('../../services/leadIntelligence/leadIntelligenceRepository', () => ({ listCanonicalLeads: jest.fn(async () => []) }));
// Audiences read through `listAllLeads` with the default readers; route that one
// call through the injected test readers.
jest.mock('../../services/leadIntelligence/leadIntelligenceReadService', () => {
  const actual = jest.requireActual('../../services/leadIntelligence/leadIntelligenceReadService');
  return {
    ...actual,
    listAllLeads: (q: unknown, o: unknown, r?: unknown) =>
      actual.listAllLeads(q, o, r ?? (globalThis as { __testReaders?: unknown }).__testReaders),
  };
});

import {
  searchLeads,
  getLeadStats,
  getLeadProfile,
  listAllLeads,
  exportLeads,
  getActiveLeadsView,
  resetReadFailureReportsForTests,
  type LeadSourceReaders,
} from '../../services/leadIntelligence/leadIntelligenceReadService';
import {
  readContributionsForLeads,
  readContributionsBySignalRefs,
  resetContributionReadReportsForTests,
  type ContributionQueryPort,
} from '../../services/prospectProvenance/contributionReader';
import {
  readAccountsForSourceRecords,
  resetAccountReadReportsForTests,
  type AccountQueryPort,
} from '../../services/prospectProvenance/accountReader';
import {
  projectExistingRow,
  mergeSignalLinkedViews,
  leadKeyFor,
  type CanonicalLeadView,
  type SignalLink,
} from '../../../lib/leadIntelligence';
import { evaluateAudience, previewAudience, membershipKeyFor } from '../../services/audience/audienceService';

const CO1 = '11111111-1111-1111-1111-111111111111';
const CO2 = '22222222-2222-2222-2222-222222222222';

/* ── fixtures ───────────────────────────────────────────────────────────── */

const feedRow = (id: string, org = CO1, over: Row = {}): Row => ({
  id, organization_id: org, platform: 'reddit', opportunity_type: 'buying_signal', status: 'new',
  signal_excerpt: `excerpt ${id}`, content_text: `post ${id}`, opportunity_score: 0.8,
  author_metadata: { platform_user_id: `u-${id}` }, created_at: '2026-10-01T09:00:00Z', ...over,
});
const durableCommunity = (id: string, org = CO1, over: Row = {}): CanonicalLeadView =>
  projectExistingRow('community', feedRow(id, org, over));
const durableEngagement = (signalId: string, org = CO1): CanonicalLeadView =>
  projectExistingRow('engagement', {
    id: signalId, organization_id: org, source_type: 'engagement', platform: 'linkedin', source_id: `msg-${signalId}`,
    content_text: 'DM: interested', total_score: 0.6, created_at: '2026-10-02T09:00:00Z',
  });
const canonicalRow = (id: string, org = CO1, over: Row = {}): Row => ({
  id, company_id: org, source: 'community', unified_person_id: null, qualification_score: null,
  created_at: '2026-10-01T10:00:00Z', ...over,
});

const contributionRow = (over: Row): Row => ({
  id: 'c-x', organization_id: CO1, canonical_lead_id: 'cl-1', contribution_role: 'originating',
  source_category: 'community', external_ref: 'community:feed-1', source_record_id: 'sr-1', platform: 'reddit',
  source_url: 'https://reddit.com/r/x/comments/1', contact_id: null, lead_signal_id: null,
  opportunity_feed_item_id: null, engagement_message_id: null, observed_at: '2026-10-01T09:00:00+00:00', evidence: {},
  ...over,
});

/** A port that honours tenant + id filters exactly like PostgREST would. */
function contributionPort(rows: Row[], calls: string[] = []): ContributionQueryPort {
  return {
    async byLeads(org, ids) {
      calls.push('byLeads');
      return { data: rows.filter((r) => r.organization_id === org && ids.includes(String(r.canonical_lead_id))), error: null };
    },
    async originating(org) {
      calls.push('originating');
      return { data: rows.filter((r) => r.organization_id === org && r.contribution_role === 'originating'), error: null };
    },
    async bySignalRefs(org, column, ids) {
      calls.push(`bySignalRefs:${column}`);
      return { data: rows.filter((r) => r.organization_id === org && ids.includes(String(r[column]))), error: null };
    },
  };
}

function accountPort(sourceRecords: Row[], accounts: Row[], calls: string[] = []): AccountQueryPort {
  return {
    async sourceRecords(org, ids) {
      calls.push('source_records');
      return { data: sourceRecords.filter((r) => r.organization_id === org && ids.includes(String(r.id))), error: null };
    },
    async accounts(org, ids) {
      calls.push('prospect_accounts');
      return { data: accounts.filter((r) => r.organization_id === org && ids.includes(String(r.id))), error: null };
    },
  };
}

interface World {
  durable?: CanonicalLeadView[];
  canonical?: Row[];
  contributions?: Row[];
  sourceRecords?: Row[];
  accounts?: Row[];
  signalLinksFail?: boolean;
}

function readers(w: World, calls: string[] = []): LeadSourceReaders {
  const cPort = contributionPort(w.contributions ?? [], calls);
  return {
    durable: async (co) => (w.durable ?? []).filter((v) => v.organizationId === co),
    leads: async () => [],
    canonicalLeads: async (co) => (w.canonical ?? []).filter((r) => r.company_id === co),
    contributions: (co, ids) => readContributionsForLeads(co, ids, { port: cPort }),
    originatingContributions: async (co) => ({ status: 'ok', byLead: (await readContributionsForLeads(co, (w.canonical ?? []).map((r) => String(r.id)), { port: cPort })).byLead, truncated: false, reads: 1 }),
    signalLinks: w.signalLinksFail
      ? async () => ({ status: 'table_missing', byLead: new Map(), truncated: false, reads: 1 })
      : (co, refs) => readContributionsBySignalRefs(co, refs, { port: cPort }),
    accounts: (co, ids) => readAccountsForSourceRecords(co, ids, { port: accountPort(w.sourceRecords ?? [], w.accounts ?? [], calls) }),
  };
}

/** The standard pair: durable community lead for feed-1 + canonical prospect cl-1 bridged from feed-1. */
const pair = (over: World = {}): World => ({
  durable: [durableCommunity('feed-1')],
  canonical: [canonicalRow('cl-1')],
  contributions: [contributionRow({ id: 'c-1', opportunity_feed_item_id: 'feed-1', lead_signal_id: 'sig-1' })],
  ...over,
});

let warn: jest.SpyInstance;
beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  upserts.length = 0;
  resetReadFailureReportsForTests();
  resetContributionReadReportsForTests();
  resetAccountReadReportsForTests();
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => warn.mockRestore());

/* ── acceptance #7: no duplicate unified leads ─────────────────────────── */

describe('signal merge — community evidence does not duplicate leads', () => {
  it('durable + canonical for the same feed item → ONE lead carrying both sources', async () => {
    const res = await searchLeads({ companyId: CO1 }, readers(pair()));
    expect(res.total).toBe(1);
    const lead = res.rows[0];
    expect(lead.sourceRef).toEqual(expect.objectContaining({ table: 'canonical_leads', id: 'cl-1' }));
    expect(lead.linkedRecords).toHaveLength(1);
    expect(lead.linkedRecords![0]).toMatchObject({
      source: 'community', sourceRef: { table: 'opportunity_feed_items', id: 'feed-1' },
      matchedOn: { kind: 'opportunity_feed_item', ref: 'feed-1' },
    });
    expect(lead.sources!.map((c) => c.id)).toEqual(['c-1']);
    expect(lead.evidence!.map((e) => e.kind)).toEqual(expect.arrayContaining(['opportunity_feed_item', 'lead_signal']));
    expect(res.signalMerge).toEqual({ status: 'ok', merged: 1, ambiguous: 0 });
  });

  it('the canonical key stays stable; the durable key becomes an alias', async () => {
    const durableKey = leadKeyFor(durableCommunity('feed-1'));
    const res = await searchLeads({ companyId: CO1 }, readers(pair()));
    expect(leadKeyFor(res.rows[0])).toBe('id::community::canonical_leads::cl-1');
    expect(res.rows[0].aliasKeys).toEqual([durableKey]);
  });

  it('gap-fills the representative only where it has no value (score)', async () => {
    const res = await searchLeads({ companyId: CO1 }, readers(pair()));
    expect(res.rows[0].scores.total).toBe(0.8);
    const withScore = await searchLeads({ companyId: CO1 }, readers(pair({ canonical: [canonicalRow('cl-1', CO1, { qualification_score: 30 })] })));
    expect(withScore.rows[0].scores.total).toBe(0.3); // representative value never overwritten
  });

  it('a lead_signals-keyed engagement durable view merges through lead_signal_id', async () => {
    const res = await searchLeads({ companyId: CO1 }, readers({
      durable: [durableEngagement('sig-9')],
      canonical: [canonicalRow('cl-9', CO1, { source: 'engagement' })],
      contributions: [contributionRow({ id: 'c-9', canonical_lead_id: 'cl-9', source_category: 'engagement', external_ref: 'engagement:msg-sig-9', lead_signal_id: 'sig-9', engagement_message_id: 'msg-sig-9' })],
    }));
    expect(res.total).toBe(1);
    expect(res.rows[0].linkedRecords![0].matchedOn).toEqual({ kind: 'lead_signal', ref: 'sig-9' });
  });

  it('retries / repeated ingestion stay ONE lead (duplicate rows and repeated contributions)', async () => {
    const w = pair({
      durable: [durableCommunity('feed-1'), durableCommunity('feed-1')],
      contributions: [
        contributionRow({ id: 'c-1', opportunity_feed_item_id: 'feed-1', lead_signal_id: 'sig-1' }),
        contributionRow({ id: 'c-1', opportunity_feed_item_id: 'feed-1', lead_signal_id: 'sig-1' }),
      ],
    });
    const once = await searchLeads({ companyId: CO1 }, readers(w));
    const twice = await searchLeads({ companyId: CO1 }, readers(w));
    expect(once.total).toBe(1);
    expect(once.rows[0].linkedRecords).toHaveLength(1);
    expect(twice.rows).toEqual(once.rows);
  });

  it('community + enrichment + CRM on one prospect → ONE lead, THREE sources', async () => {
    const res = await searchLeads({ companyId: CO1 }, readers(pair({
      contributions: [
        contributionRow({ id: 'c-1', opportunity_feed_item_id: 'feed-1' }),
        contributionRow({ id: 'c-2', contribution_role: 'contributing', source_category: 'pi_enrichment', platform: 'apollo', external_ref: 'apollo:p1', observed_at: '2026-10-03T00:00:00+00:00' }),
        contributionRow({ id: 'c-3', contribution_role: 'contributing', source_category: 'crm', platform: 'hubspot', external_ref: 'crm_hubspot:42', observed_at: '2026-10-04T00:00:00+00:00' }),
      ],
    })));
    expect(res.total).toBe(1);
    expect(res.rows[0].sources!.map((c) => c.sourceCategory)).toEqual(['community', 'pi_enrichment', 'crm']);
    expect(res.rows[0].linkedRecords).toHaveLength(1);
  });

  it('identity resolved later (person linked to the prospect) → still ONE lead with the same key', async () => {
    const before = await searchLeads({ companyId: CO1 }, readers(pair()));
    const after = await searchLeads({ companyId: CO1 }, readers(pair({ canonical: [canonicalRow('cl-1', CO1, { unified_person_id: 'up-1' })] })));
    expect(after.total).toBe(1);
    expect(leadKeyFor(after.rows[0])).toBe(leadKeyFor(before.rows[0]));
    expect(after.rows[0].aliasKeys).toEqual(before.rows[0].aliasKeys);
  });

  it('two different feed items → two leads', async () => {
    const res = await searchLeads({ companyId: CO1 }, readers(pair({
      durable: [durableCommunity('feed-1'), durableCommunity('feed-2')],
      canonical: [canonicalRow('cl-1'), canonicalRow('cl-2')],
      contributions: [
        contributionRow({ id: 'c-1', canonical_lead_id: 'cl-1', opportunity_feed_item_id: 'feed-1' }),
        contributionRow({ id: 'c-2', canonical_lead_id: 'cl-2', external_ref: 'community:feed-2', opportunity_feed_item_id: 'feed-2' }),
      ],
    })));
    expect(res.total).toBe(2);
    expect(res.rows.map((r) => r.sourceRef!.id).sort()).toEqual(['cl-1', 'cl-2']);
  });

  it('a durable signal with no referencing prospect stays its own lead; a prospect never merges with a prospect', async () => {
    const res = await searchLeads({ companyId: CO1 }, readers(pair({
      durable: [durableCommunity('feed-1'), durableCommunity('feed-3')],
      canonical: [canonicalRow('cl-1'), canonicalRow('cl-2')],
      contributions: [
        contributionRow({ id: 'c-1', canonical_lead_id: 'cl-1', opportunity_feed_item_id: 'feed-1' }),
        contributionRow({ id: 'c-2', canonical_lead_id: 'cl-2', external_ref: 'community:feed-1b', opportunity_feed_item_id: 'feed-1b' }),
      ],
    })));
    expect(res.total).toBe(3); // cl-1(+feed-1), cl-2, feed-3
  });

  it('a signal referenced by TWO prospects is ambiguous: nothing merges, reported', async () => {
    const res = await searchLeads({ companyId: CO1 }, readers(pair({
      canonical: [canonicalRow('cl-1'), canonicalRow('cl-2')],
      contributions: [
        contributionRow({ id: 'c-1', canonical_lead_id: 'cl-1', opportunity_feed_item_id: 'feed-1' }),
        contributionRow({ id: 'c-2', canonical_lead_id: 'cl-2', external_ref: 'community:feed-1', opportunity_feed_item_id: 'feed-1' }),
      ],
    })));
    expect(res.total).toBe(3);
    expect(res.signalMerge).toEqual({ status: 'ok', merged: 0, ambiguous: 1 });
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/referenced by more than one canonical prospect/);
  });

  it('cross-tenant: identical ids in another tenant never merge (and are never read)', async () => {
    const calls: string[] = [];
    const w: World = {
      durable: [durableCommunity('feed-1', CO1), durableCommunity('feed-1', CO2)],
      canonical: [canonicalRow('cl-1', CO2)], // the prospect lives in CO2 only
      contributions: [contributionRow({ id: 'c-1', organization_id: CO2, opportunity_feed_item_id: 'feed-1' })],
    };
    const r1 = await searchLeads({ companyId: CO1 }, readers(w, calls));
    expect(r1.total).toBe(1);
    expect(r1.rows[0].sourceRef!.table).toBe('opportunity_feed_items');
    expect(r1.rows[0].linkedRecords).toBeUndefined();
    const r2 = await searchLeads({ companyId: CO2 }, readers(w));
    expect(r2.total).toBe(1);
    expect(r2.rows[0].linkedRecords!.map((l) => l.leadKey)).toEqual([leadKeyFor(durableCommunity('feed-1', CO2))]);
  });

  it('pure merge never merges across tenants even if a link claims it', () => {
    const v1 = durableCommunity('feed-1', CO1);
    const p2 = projectExistingRow('crm', canonicalRow('cl-1', CO2));
    const links: SignalLink[] = [{ organizationId: CO1, canonicalLeadId: 'cl-1', kind: 'opportunity_feed_item', ref: 'feed-1' }];
    expect(mergeSignalLinkedViews([v1, p2], links).merged).toBe(0);
  });

  it('pure merge is order-independent and idempotent', () => {
    const views = [durableCommunity('feed-1'), durableEngagement('sig-9'), projectExistingRow('crm', canonicalRow('cl-1'))];
    const links: SignalLink[] = [
      { organizationId: CO1, canonicalLeadId: 'cl-1', kind: 'opportunity_feed_item', ref: 'feed-1' },
      { organizationId: CO1, canonicalLeadId: 'cl-1', kind: 'lead_signal', ref: 'sig-9' },
    ];
    const a = mergeSignalLinkedViews(views, links).views;
    const b = mergeSignalLinkedViews([...views].reverse(), [...links].reverse()).views;
    expect(a).toHaveLength(1);
    expect(b).toEqual(a);
    expect(mergeSignalLinkedViews(a, links).views).toEqual(a);
    expect(a[0].linkedRecords!.map((r) => r.source)).toEqual(['community', 'engagement']);
  });

  it('provenance store unreadable → no merge, status unavailable (rows still served)', async () => {
    const res = await searchLeads({ companyId: CO1 }, readers(pair({ signalLinksFail: true })));
    expect(res.total).toBe(2);
    expect(res.signalMerge).toEqual({ status: 'unavailable', merged: 0, ambiguous: 0 });
  });

  it('no signal-keyed views → no signal read issued', async () => {
    const calls: string[] = [];
    await searchLeads({ companyId: CO1 }, readers(pair({ durable: [] }), calls));
    expect(calls.filter((c) => c.startsWith('bySignalRefs'))).toEqual([]);
  });
});

/* ── counts / filters / alias resolution ───────────────────────────────── */

describe('signal merge — counts, filters, profile alias', () => {
  it('stats count the merged lead ONCE', async () => {
    const stats = await getLeadStats({ companyId: CO1 }, readers(pair()));
    expect(stats.total).toBe(1);
    expect(stats.bySource).toEqual({ community: 1 });
    expect(stats.byOriginCategory).toEqual({ community: 1 });
    expect(stats.signalMerge).toEqual({ status: 'ok', merged: 1, ambiguous: 0 });
  });

  it('listAllLeads and Active Leads see it once; a source filter matches through a linked source', async () => {
    expect((await listAllLeads({ companyId: CO1 }, {}, readers(pair()))).total).toBe(1);
    expect((await getActiveLeadsView({ companyId: CO1 }, readers(pair()))).total).toBe(1);
    const crmProspect = pair({ canonical: [canonicalRow('cl-1', CO1, { source: 'hubspot' })] });
    const filtered = await searchLeads({ companyId: CO1, filters: { source: 'community' } }, readers(crmProspect));
    expect(filtered.total).toBe(1);
    expect(filtered.rows[0].source).toBe('crm');
  });

  it('the durable key (alias) resolves to the merged profile; timeline keeps both captures', async () => {
    const durableKey = leadKeyFor(durableCommunity('feed-1'));
    const profile = await getLeadProfile(CO1, durableKey, readers(pair()));
    expect(profile).not.toBeNull();
    expect(profile!.leadKey).toBe('id::community::canonical_leads::cl-1');
    const origins = profile!.timeline.map((e) => `${e.origin}:${e.eventType}`);
    expect(origins).toEqual(expect.arrayContaining([
      'canonical_leads:lead_captured', 'opportunity_feed_items:lead_captured', 'prospect_source_contributions:source_originated',
    ]));
    expect(await getLeadProfile(CO2, durableKey, readers(pair()))).toBeNull();
  });
});

/* ── account-only prospects ─────────────────────────────────────────────── */

describe('account-only prospect display (read side)', () => {
  const accountWorld = (over: World = {}): World => pair({
    sourceRecords: [{ id: 'sr-1', organization_id: CO1, account_id: 'acc-1' }],
    accounts: [{ id: 'acc-1', organization_id: CO1, name: 'Acme Corp', domain_normalized: 'acme.com' }],
    ...over,
  });

  it('shows the account of the originating contribution\'s source record', async () => {
    const calls: string[] = [];
    const res = await searchLeads({ companyId: CO1 }, readers(accountWorld(), calls));
    expect(res.rows[0].account).toEqual({ id: 'acc-1', name: 'Acme Corp', domain: 'acme.com', via: 'originating_source_record' });
    expect(res.rows[0].accountStatus).toBe('loaded');
    expect(calls.filter((c) => c === 'source_records' || c === 'prospect_accounts')).toEqual(['source_records', 'prospect_accounts']);
  });

  it('is batched: many account-only prospects on a page → one read per table', async () => {
    const calls: string[] = [];
    const n = 30;
    const w: World = {
      canonical: Array.from({ length: n }, (_, i) => canonicalRow(`cl-${i}`)),
      contributions: Array.from({ length: n }, (_, i) => contributionRow({ id: `c-${i}`, canonical_lead_id: `cl-${i}`, source_record_id: `sr-${i}`, external_ref: `community:f${i}` })),
      sourceRecords: Array.from({ length: n }, (_, i) => ({ id: `sr-${i}`, organization_id: CO1, account_id: 'acc-1' })),
      accounts: [{ id: 'acc-1', organization_id: CO1, name: 'Acme Corp', domain_normalized: 'acme.com' }],
    };
    const res = await searchLeads({ companyId: CO1 }, readers(w, calls));
    expect(res.rows.every((r) => r.account?.name === 'Acme Corp')).toBe(true);
    expect(calls.filter((c) => c === 'source_records')).toHaveLength(1);
    expect(calls.filter((c) => c === 'prospect_accounts')).toHaveLength(1);
  });

  it('tenant-filtered: another tenant\'s source record / account is never shown', async () => {
    const res = await searchLeads({ companyId: CO1 }, readers(accountWorld({
      sourceRecords: [{ id: 'sr-1', organization_id: CO2, account_id: 'acc-1' }],
      accounts: [{ id: 'acc-1', organization_id: CO2, name: 'Other Tenant Inc', domain_normalized: 'other.com' }],
    })));
    expect(res.rows[0].account).toBeNull();
    expect(res.rows[0].accountStatus).toBe('not_found');
  });

  it('a prospect WITH a person is not account-only (no read)', async () => {
    const calls: string[] = [];
    const res = await searchLeads({ companyId: CO1 }, readers(accountWorld({ canonical: [canonicalRow('cl-1', CO1, { unified_person_id: 'up-1' })] }), calls));
    expect(res.rows[0].accountStatus).toBe('not_applicable');
    expect(calls).not.toContain('source_records');
  });

  it('fail-open and observable: missing table → unavailable, warned once, rows served', async () => {
    const failing: AccountQueryPort = {
      sourceRecords: async () => ({ data: null, error: { code: '42P01', message: 'relation does not exist' } }),
      accounts: async () => ({ data: [], error: null }),
    };
    const direct = await readAccountsForSourceRecords(CO1, ['sr-1'], { port: failing });
    expect(direct.status).toBe('table_missing');
    const r = readers(accountWorld());
    r.accounts = (co, ids) => readAccountsForSourceRecords(co, ids, { port: failing });
    const res = await searchLeads({ companyId: CO1 }, r);
    await searchLeads({ companyId: CO1 }, r);
    expect(res.total).toBe(1);
    expect(res.rows[0].accountStatus).toBe('unavailable');
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('[accountReader]'))).toHaveLength(1);
  });
});

/* ── export / audiences: source evidence survives, no leak ─────────────── */

describe('export + audiences reflect the merged lead once, with attribution', () => {
  it('export: one row, contributors + linked sources, account as company, no linked ids/keys', async () => {
    tables.contact_governance_records = [];
    const out = await exportLeads({ companyId: CO1 }, 'csv', readers(pair({
      sourceRecords: [{ id: 'sr-1', organization_id: CO1, account_id: 'acc-1' }],
      accounts: [{ id: 'acc-1', organization_id: CO1, name: 'Acme Corp', domain_normalized: 'acme.com' }],
    })));
    const lines = out.body.replace(/^﻿/, '').split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0].endsWith(',provenance_status,linked_sources')).toBe(true);
    expect(lines[1]).toContain('Acme Corp');
    expect(lines[1]).toContain('originating:community/reddit@2026-10-01T09:00:00+00:00');
    expect(lines[1]).toContain('Community@2026-10-01T09:00:00Z');
    expect(lines[1]).not.toContain('feed-1');
    expect(lines[1]).not.toContain('u-feed-1');
  });

  it('audience: merged lead is ONE member; an existing membership under the durable key is kept (no re-key)', async () => {
    const w = pair();
    (globalThis as { __testReaders?: unknown }).__testReaders = readers(w);
    const durableKey = leadKeyFor(durableCommunity('feed-1'));
    tables.audiences = [{ id: 'aud-1', company_id: CO1, rules: { op: 'and', conditions: [{ field: 'source', operator: 'eq', value: 'community' }] } }];
    tables.audience_memberships = [{ audience_id: 'aud-1', company_id: CO1, entity_type: 'canonical_lead', entity_id: durableKey, active: true, evaluated_at: '2026-01-01T00:00:00Z' }];
    const r = await evaluateAudience(CO1, 'aud-1');
    expect(r.member_count).toBe(1);
    const memberUpserts = upserts.filter((u) => u.table === 'audience_memberships');
    expect(memberUpserts.map((u) => u.row.entity_id)).toEqual([durableKey]);
    expect(tables.audience_memberships).toHaveLength(1);
    expect(tables.audience_memberships[0].active).toBe(true);
  });

  it('audience: a new membership uses the stable canonical key; preview counts once', async () => {
    (globalThis as { __testReaders?: unknown }).__testReaders = readers(pair());
    const p = await previewAudience(CO1, { op: 'and', conditions: [{ field: 'source', operator: 'eq', value: 'community' }] });
    expect(p.total).toBe(1);
    expect(p.sample[0].entityId).toBe('id::community::canonical_leads::cl-1');
    expect(p.intelligence.bySource).toEqual({ community: 1 });
    const merged = (await searchLeads({ companyId: CO1 }, readers(pair()))).rows[0];
    expect(membershipKeyFor(merged, new Set(['id::community::canonical_leads::cl-1', merged.aliasKeys![0]]))).toBe('id::community::canonical_leads::cl-1');
  });
});

/* ── signal-ref reader ─────────────────────────────────────────────────── */

describe('readContributionsBySignalRefs', () => {
  it('reads per column, absorbs a contribution matching two columns once, drops rows without a requested ref', async () => {
    const calls: string[] = [];
    const rows = [
      contributionRow({ id: 'c-1', opportunity_feed_item_id: 'feed-1', lead_signal_id: 'sig-1' }),
      contributionRow({ id: 'c-2', canonical_lead_id: 'cl-2', external_ref: 'community:feed-2', opportunity_feed_item_id: 'feed-2' }),
    ];
    const res = await readContributionsBySignalRefs(CO1, { opportunityFeedItemIds: ['feed-1'], leadSignalIds: ['sig-1'] }, { port: contributionPort(rows, calls) });
    expect(calls).toEqual(['bySignalRefs:opportunity_feed_item_id', 'bySignalRefs:lead_signal_id']);
    expect([...res.byLead.keys()]).toEqual(['cl-1']);
    expect(res.byLead.get('cl-1')!.map((c) => c.id)).toEqual(['c-1']);
  });

  it('no ids → no read; another tenant\'s rows are dropped', async () => {
    const calls: string[] = [];
    expect((await readContributionsBySignalRefs(CO1, {}, { port: contributionPort([], calls) })).reads).toBe(0);
    const leaky: ContributionQueryPort = {
      ...contributionPort([]),
      bySignalRefs: async () => ({ data: [contributionRow({ id: 'c-x', organization_id: CO2, opportunity_feed_item_id: 'feed-1' })], error: null }),
    };
    const res = await readContributionsBySignalRefs(CO1, { opportunityFeedItemIds: ['feed-1'] }, { port: leaky });
    expect(res.byLead.size).toBe(0);
  });
});
