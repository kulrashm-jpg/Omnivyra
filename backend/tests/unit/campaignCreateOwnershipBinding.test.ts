/**
 * 3AH-115 (WS-C) — POST /api/campaigns: create-flow ownership and id
 * collision protection.
 *
 *   - the caller is authorized for the company BEFORE the id is examined;
 *   - the id (caller UUID, lower-cased, or server-generated) must resolve to
 *     NOT_FOUND over every owner record (canonical resolver) before any write;
 *   - an existing id — own, foreign, orphan, unowned or conflicting — is one
 *     identical 409, a failed lookup is 503, never a create;
 *   - campaigns.company_id AND the first campaign_versions row both carry the
 *     authorized company, and the created campaign must resolve to exactly that
 *     company or this request's rows are removed;
 *   - no raw database error reaches the response.
 *
 * Only the database, identity provider and telemetry are fake; RBAC and the
 * canonical resolver run for real.
 */
import {
  seed, invoke, calls, writeCalls, rows, CO_A, CO_B, USER_A,
} from '../helpers/routeAuthHarness';

type Fault = { table: string; op: string; error: { code: string; message: string }; after?: () => boolean };
const mockFaults: Fault[] = [];
const mockAfterInsert: Array<(table: string) => void> = [];
const mockEvents: string[] = [];

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => {
  const h = jest.requireActual('../helpers/routeAuthHarness');
  const from = (table: string) => {
    const b = h.fakeSupabase.from(table);
    let op = 'select';
    for (const m of ['insert', 'update', 'upsert', 'delete']) {
      const original = b[m];
      b[m] = (...args: unknown[]) => { op = m; original(...args); return b; };
    }
    const fault = () => mockFaults.find((f) => f.table === table && f.op === op && (!f.after || f.after()));
    const settle = (r: unknown) => {
      if (op === 'insert') for (const hook of mockAfterInsert) hook(table);
      return r;
    };
    for (const m of ['single', 'maybeSingle']) {
      const original = b[m];
      b[m] = async () => {
        const f = fault();
        if (f) { mockEvents.push(`fault:${op}:${table}`); return { data: null, error: f.error }; }
        return settle(await original());
      };
    }
    const then = b.then;
    b.then = (ok: (v: unknown) => unknown, err: (e: unknown) => unknown) => {
      const f = fault();
      if (f) { mockEvents.push(`fault:${op}:${table}`); return Promise.resolve({ data: null, error: f.error, count: null }).then(ok, err); }
      return then((r: unknown) => settle(r), err).then(ok, err);
    };
    return b;
  };
  const supabase = { ...h.fakeSupabase, from };
  return { supabase, default: supabase, getSupabase: () => supabase, supabaseAdmin: supabase };
});
// The write-owner seam goes through the same fault-injecting client, so rollback deletes can fail too.
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => jest.requireMock('../../db/supabaseClient').supabase.from(t),
}));
jest.mock('../../services/supabaseAuthService', () => jest.requireActual('../helpers/routeAuthHarness').authModule());
jest.mock('../../security/IdentityResolver', () => jest.requireActual('../helpers/routeAuthHarness').identityModule());
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../observability', () => ({ withApiObservability: (h: unknown) => h }));
jest.mock('../../services/telemetry/telemetryDispatcher', () => ({
  trackEvent: jest.fn((e: { type: string }) => { mockEvents.push(`telemetry:${e.type}`); }),
}));

import handler from '../../../pages/api/campaigns/index';
import { resolveCampaignOwnership } from '../../services/campaignOwnershipService';

const EXISTING = '0c000000-0000-4000-8000-00000000000e';
const FRESH = '0c000000-0000-4000-8000-0000000000f1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TAKEN = { error: 'Campaign id is not available', code: 'CAMPAIGN_ID_CONFLICT' };
const LOOKUP = {
  error: 'Campaign ownership check is temporarily unavailable. Please try again.',
  code: 'CAMPAIGN_LOOKUP_ERROR',
  retryable: true,
};
const RAW_DB = /forced|duplicate key|violates|XX000|23505|constraint|relation/i;

type Row = Record<string, unknown>;

function world(campaign: Row | null = null, versions: Row[] = []): void {
  seed({
    campaigns: campaign ? [{ id: EXISTING, user_id: USER_A, name: 'Existing', status: 'planning', ...campaign }] : [],
    campaign_versions: versions.map((v, i) => ({ id: `ver-${i}`, campaign_id: EXISTING, version: 1, created_at: '2026-01-01T00:00:00Z', ...v })),
  });
}

const create = (as: 'A' | 'B' | 'SUPER' | null, body: Row = {}, query: Row = { companyId: CO_A }) =>
  invoke(handler as never, { method: 'POST', as, query, body: { name: 'New campaign', ...body } });

const campaignWrites = () => writeCalls(['campaigns', 'campaign_versions']);
const ownershipReads = () => calls().filter((c) => c.op === 'select' && (c.table === 'campaigns' || c.table === 'campaign_versions'));

beforeEach(() => {
  mockFaults.length = 0;
  mockAfterInsert.length = 0;
  mockEvents.length = 0;
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => { jest.restoreAllMocks(); });

// ── Fresh create ─────────────────────────────────────────────────────────────
describe('fresh create binds the authorized company on BOTH owner records', () => {
  it('no id supplied → a server-generated UUID, owned by the caller company', async () => {
    world();
    const r = await create('A');
    expect(r.status).toBe(201);
    const id = (r.body as { campaign: { id: string } }).campaign.id;
    expect(id).toMatch(UUID);
    expect(rows('campaigns').find((c) => c.id === id)).toMatchObject({ company_id: CO_A });
    expect(rows('campaign_versions').filter((v) => v.campaign_id === id)).toEqual([expect.objectContaining({ company_id: CO_A, version: 1 })]);
    expect(await resolveCampaignOwnership(id)).toMatchObject({ status: 'OWNED', companyId: CO_A, orphan: false });
    expect(mockEvents).toContain('telemetry:campaign.created');
  });

  it('a caller-supplied fresh UUID is used (lower-cased) and owned by the caller company', async () => {
    world();
    const r = await create('A', { id: FRESH.toUpperCase() });
    expect(r.status).toBe(201);
    expect((r.body as { campaign: { id: string } }).campaign.id).toBe(FRESH);
    expect(await resolveCampaignOwnership(FRESH)).toMatchObject({ status: 'OWNED', companyId: CO_A });
  });

  it('a platform super admin creating for another company binds THAT authorized company', async () => {
    world();
    const r = await create('SUPER', { id: FRESH }, { companyId: CO_B });
    expect(r.status).toBe(201);
    expect(await resolveCampaignOwnership(FRESH)).toMatchObject({ status: 'OWNED', companyId: CO_B });
  });

  it('a body company_id cannot redirect ownership away from the authorized query company', async () => {
    world();
    const r = await create('A', { id: FRESH, company_id: CO_B, companyId: CO_B }, { companyId: CO_A });
    expect(r.status).toBe(201);
    expect(await resolveCampaignOwnership(FRESH)).toMatchObject({ status: 'OWNED', companyId: CO_A });
    expect(rows('campaign_versions').filter((v) => v.company_id === CO_B)).toEqual(
      rows('campaign_versions').filter((v) => v.company_id === CO_B && v.campaign_id !== FRESH),
    );
  });

  it('the ownership check runs before the first write', async () => {
    world();
    await create('A', { id: FRESH });
    const log = calls().map((c) => `${c.op}:${c.table}`);
    const firstWrite = log.findIndex((e) => /^(insert|update|upsert|delete):/.test(e));
    expect(log.indexOf('select:campaign_versions')).toBeGreaterThan(-1);
    expect(log.indexOf('select:campaign_versions')).toBeLessThan(firstWrite);
    expect(log.indexOf('select:campaigns')).toBeLessThan(firstWrite);
  });
});

// ── Invalid / missing input ──────────────────────────────────────────────────
describe('invalid ids and missing company are refused before any write', () => {
  it.each([
    ['not a UUID', 'camp-x'],
    ['empty string', ''],
    ['a number', 42],
    ['an object', { id: FRESH }],
    ['a UUID with trailing junk', `${FRESH}x`],
  ])('%s → 400 INVALID_CAMPAIGN_ID', async (_n, id) => {
    world();
    const r = await create('A', { id });
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ error: 'Invalid campaign id', code: 'INVALID_CAMPAIGN_ID' });
    expect(campaignWrites()).toEqual([]);
  });

  it('missing company → 400 before authentication or any database access', async () => {
    world();
    const r = await create('A', { id: FRESH }, {});
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ error: 'companyId required' });
    expect(calls()).toEqual([]);
  });
});

// ── Authorization precedes the id check ──────────────────────────────────────
describe('unauthorized callers learn nothing about the id and write nothing', () => {
  it.each([
    ['anonymous', null, CO_A, 401],
    ['member of B naming company A', 'B', CO_A, 403],
  ] as const)('%s → %s… no ownership read, no write', async (_n, as, company, status) => {
    for (const existing of [true, false]) {
      if (existing) world({ company_id: CO_A }, [{ company_id: CO_A }]); else world();
      const r = await create(as, { id: EXISTING }, { companyId: company });
      expect(r.status).toBe(status);
      expect(ownershipReads()).toEqual([]);
      expect(campaignWrites()).toEqual([]);
    }
  });
});

// ── Existing ids: never adopted, never re-created ────────────────────────────
describe('an existing id is refused identically, whoever owns it', () => {
  const EXISTING_SHAPES: Array<[string, Row | null, Row[]]> = [
    ['same tenant (campaign + version A)', { company_id: CO_A }, [{ company_id: CO_A }]],
    ['same tenant, campaigns row only', { company_id: CO_A }, []],
    ['foreign tenant (campaign + version B)', { company_id: CO_B }, [{ company_id: CO_B }]],
    ['foreign orphan versions (no campaigns row) — the adoption attack', null, [{ company_id: CO_B }]],
    ['same-tenant orphan versions', null, [{ company_id: CO_A }]],
    ['unowned campaigns row', { company_id: null }, []],
    ['ownership collision (campaign A, version B)', { company_id: CO_A }, [{ company_id: CO_B }]],
  ];

  it.each(EXISTING_SHAPES)('%s → 409 CAMPAIGN_ID_CONFLICT, nothing written, owner records untouched', async (_n, campaign, versions) => {
    world(campaign, versions);
    const before = { c: JSON.stringify(rows('campaigns')), v: JSON.stringify(rows('campaign_versions')) };
    const r = await create('A', { id: EXISTING });
    expect(r.status).toBe(409);
    expect(r.body).toEqual(TAKEN);
    expect(campaignWrites()).toEqual([]);
    expect(JSON.stringify(rows('campaigns'))).toBe(before.c);
    expect(JSON.stringify(rows('campaign_versions'))).toBe(before.v);
    expect(mockEvents).not.toContain('telemetry:campaign.created');
  });

  it('an upper-cased spelling of an existing id is the same id', async () => {
    world({ company_id: CO_B }, [{ company_id: CO_B }]);
    const r = await create('A', { id: EXISTING.toUpperCase() });
    expect(r.status).toBe(409);
    expect(campaignWrites()).toEqual([]);
  });

  it('a super admin cannot re-create or adopt an existing id either', async () => {
    world(null, [{ company_id: CO_B }]);
    const r = await create('SUPER', { id: EXISTING }, { companyId: CO_A });
    expect(r.status).toBe(409);
    expect(campaignWrites()).toEqual([]);
  });

  it('creating the same id twice: the second request is refused and one campaign exists', async () => {
    world();
    expect((await create('A', { id: FRESH })).status).toBe(201);
    const second = await create('A', { id: FRESH });
    expect(second.status).toBe(409);
    expect(rows('campaigns').filter((c) => c.id === FRESH)).toHaveLength(1);
    expect(rows('campaign_versions').filter((v) => v.campaign_id === FRESH)).toHaveLength(1);
  });
});

// ── Lookup failure ───────────────────────────────────────────────────────────
describe('a failed ownership lookup is 503, never a create and never NOT_FOUND', () => {
  it.each(['campaigns', 'campaign_versions'])('failed %s read → 503, nothing written', async (table) => {
    world();
    mockFaults.push({ table, op: 'select', error: { code: 'XX000', message: 'forced failure' } });
    const r = await create('A', { id: FRESH });
    expect(r.status).toBe(503);
    expect(r.body).toEqual(LOOKUP);
    expect(campaignWrites()).toEqual([]);
  });
});

// ── Concurrency, partial failure, error hygiene ──────────────────────────────
describe('concurrent and partial creates fail closed without leaking database detail', () => {
  it('losing the primary-key race (23505) → 409, no version row, no raw error', async () => {
    world();
    mockFaults.push({ table: 'campaigns', op: 'insert', error: { code: '23505', message: 'duplicate key value violates unique constraint "campaigns_pkey"' } });
    const r = await create('A', { id: FRESH });
    expect(r.status).toBe(409);
    expect(r.body).toEqual(TAKEN);
    expect(writeCalls(['campaign_versions'])).toEqual([]);
    expect(JSON.stringify(r.body)).not.toMatch(RAW_DB);
  });

  it('any other campaigns insert failure → generic 500 with no database detail', async () => {
    world();
    mockFaults.push({ table: 'campaigns', op: 'insert', error: { code: 'XX000', message: 'forced failure on relation campaigns' } });
    const r = await create('A', { id: FRESH });
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ error: 'Failed to create campaign' });
  });

  it('a failed version insert removes the campaigns row it created → generic 500, no orphan', async () => {
    world();
    mockFaults.push({ table: 'campaign_versions', op: 'insert', error: { code: 'XX000', message: 'forced failure violates constraint' } });
    const r = await create('A', { id: FRESH });
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ error: 'Failed to create campaign mapping' });
    expect(rows('campaigns').filter((c) => c.id === FRESH)).toEqual([]);
    expect(await resolveCampaignOwnership(FRESH)).toEqual({ status: 'NOT_FOUND' });
  });

  it('a foreign owner record appearing mid-create → 409, this request’s rows removed, the foreign record kept', async () => {
    world();
    mockAfterInsert.push((table) => {
      if (table === 'campaigns' && !rows('campaign_versions').some((v) => v.id === 'foreign-race')) {
        rows('campaign_versions').push({ id: 'foreign-race', campaign_id: FRESH, company_id: CO_B, version: 1, created_at: '2026-01-01T00:00:00Z' });
      }
    });
    const r = await create('A', { id: FRESH });
    expect(r.status).toBe(409);
    expect(r.body).toEqual(TAKEN);
    expect(rows('campaigns').filter((c) => c.id === FRESH)).toEqual([]);
    expect(rows('campaign_versions').filter((v) => v.campaign_id === FRESH)).toEqual([
      expect.objectContaining({ id: 'foreign-race', company_id: CO_B }),
    ]);
    expect(mockEvents).not.toContain('telemetry:campaign.created');
  });

  it('a rollback that itself fails is reported, still fails closed, and leaves only rows owned by the caller company', async () => {
    world();
    mockFaults.push({ table: 'campaign_versions', op: 'insert', error: { code: 'XX000', message: 'forced failure' } });
    mockFaults.push({ table: 'campaigns', op: 'delete', error: { code: '42501', message: 'forced failure' } });
    const r = await create('A', { id: FRESH });
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ error: 'Failed to create campaign mapping' });
    expect(console.error).toHaveBeenCalledWith('[campaigns] create rollback failed', 'campaigns:42501');
    expect(rows('campaigns').filter((c) => c.id === FRESH)).toEqual([expect.objectContaining({ company_id: CO_A })]);
    expect(await resolveCampaignOwnership(FRESH)).toMatchObject({ status: 'OWNED', companyId: CO_A });
    expect(mockEvents).not.toContain('telemetry:campaign.created');
    mockFaults.length = 0;
    expect((await create('A', { id: FRESH })).status).toBe(409);
  });

  it('a failed rollback after a mid-create conflict leaves a CONFLICT (fail closed), never a foreign-owned grant', async () => {
    world();
    mockAfterInsert.push((table) => {
      if (table === 'campaigns' && !rows('campaign_versions').some((v) => v.id === 'foreign-race')) {
        rows('campaign_versions').push({ id: 'foreign-race', campaign_id: FRESH, company_id: CO_B, version: 1, created_at: '2026-01-01T00:00:00Z' });
      }
    });
    mockFaults.push({ table: 'campaign_versions', op: 'delete', error: { code: 'XX000', message: 'forced failure' } });
    mockFaults.push({ table: 'campaigns', op: 'delete', error: { code: 'XX000', message: 'forced failure' } });
    const r = await create('A', { id: FRESH });
    expect(r.status).toBe(409);
    expect(r.body).toEqual(TAKEN);
    expect(console.error).toHaveBeenCalledWith('[campaigns] create rollback failed', 'campaign_versions:XX000,campaigns:XX000');
    const written = [...writeCalls(['campaigns', 'campaign_versions'])].filter((c) => c.op === 'insert');
    expect(written.length).toBe(2);
    for (const w of written) {
      for (const row of [w.payload].flat()) expect(row).toEqual(expect.objectContaining({ company_id: CO_A }));
    }
    expect(await resolveCampaignOwnership(FRESH)).toMatchObject({ status: 'CONFLICT' });
  });

  it('an unreadable binding after the inserts → 503 and this request’s rows removed', async () => {
    world();
    let inserted = false;
    mockAfterInsert.push((table) => { if (table === 'campaign_versions') inserted = true; });
    mockFaults.push({ table: 'campaign_versions', op: 'select', error: { code: 'XX000', message: 'forced failure' }, after: () => inserted });
    const r = await create('A', { id: FRESH });
    expect(r.status).toBe(503);
    expect(r.body).toEqual(LOOKUP);
    expect(rows('campaigns').filter((c) => c.id === FRESH)).toEqual([]);
    expect(rows('campaign_versions').filter((v) => v.campaign_id === FRESH)).toEqual([]);
  });
});
