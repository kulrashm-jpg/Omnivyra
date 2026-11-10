/**
 * WhatsApp sender-account ownership.
 *
 * A broadcast is sent with the Meta token and phone number of the
 * `social_account_id` it names, and that id comes from the request body. The
 * routes checked that the caller may act for `company_id`, but never that the
 * account belongs to that company, so an admin of company A could create, queue
 * and send a broadcast through company B's WhatsApp number and token. The
 * template route had the same gap (it submits templates with the account's token).
 *
 * Covered: create (own / foreign / missing / unreadable), enqueue and
 * processBatch for a draft created before the check (foreign account stored),
 * and the template route. Foreign and missing get the same 404, as in
 * pages/api/social/comments.ts, so the caller cannot learn whether an account id
 * exists in another company.
 *
 * Only the data layer, auth seam, token and queue are mocked. Nothing contacts Meta.
 */

type Row = Record<string, unknown>;

const COMPANY_A = 'a0000000-0000-0000-0000-00000000000a';
const COMPANY_B = 'b0000000-0000-0000-0000-00000000000b';
const ACCOUNT_A = 'sa-a';
const ACCOUNT_B = 'sa-b';

const db = {
  social_accounts: [] as Row[],
  whatsapp_broadcasts: [] as Row[],
  whatsapp_broadcast_recipients: [] as Row[],
  failTable: null as string | null,
  inserts: [] as Array<{ table: string; row: Row }>,
};

const tokenReads: string[] = [];
const rateChecks: Row[] = [];
const enqueued: Row[] = [];
const templateSubmits: Row[] = [];
const fetchCalls: string[] = [];

function table(name: string) {
  const st = { op: 'select' as 'select' | 'update' | 'insert', patch: null as Row | null, eq: [] as Array<[string, unknown]>, ins: [] as Array<[string, unknown[]]>, gt: [] as Array<[string, unknown]>, limit: Infinity };
  const rows = (): Row[] => ((db as unknown as Record<string, Row[]>)[name] ?? []);
  const match = (r: Row) => st.eq.every(([c, v]) => r[c] === v) && st.ins.every(([c, vs]) => vs.includes(r[c]))
    && st.gt.every(([c, v]) => String(r[c]) > String(v));
  const run = async (): Promise<{ data: unknown; error: unknown; count?: number }> => {
    if (db.failTable === name) return { data: null, error: { message: `${name} unreadable` } };
    if (st.op === 'insert') {
      const row = { id: `${name}-new-${db.inserts.length + 1}`, ...(st.patch as Row) };
      rows().push(row);
      db.inserts.push({ table: name, row });
      return { data: [row], error: null };
    }
    if (st.op === 'update') {
      rows().filter(match).forEach((r) => Object.assign(r, st.patch));
      return { data: null, error: null };
    }
    // W1's paged recipient read: keyset paging on id (gt + order + limit).
    const found = rows().filter(match).sort((a, b) => String(a.id).localeCompare(String(b.id))).slice(0, st.limit);
    return { data: found, error: null, count: found.length };
  };
  const first = async () => {
    const r = await run();
    return { data: Array.isArray(r.data) ? (r.data as Row[])[0] ?? null : r.data, error: r.error };
  };
  const api: Record<string, unknown> = {
    select: () => api,
    insert: (p: Row) => { st.op = 'insert'; st.patch = p; return api; },
    update: (p: Row) => { st.op = 'update'; st.patch = p; return api; },
    upsert: (p: Row[]) => { st.op = 'insert'; st.patch = p[0]; return api; },
    eq: (c: string, v: unknown) => { st.eq.push([c, v]); return api; },
    is: (c: string, v: unknown) => { st.eq.push([c, v]); return api; },
    in: (c: string, vs: unknown[]) => { st.ins.push([c, vs]); return api; },
    range: () => api,
    gt: (c: string, v: unknown) => { st.gt.push([c, v]); return api; },
    limit: (n: number) => { st.limit = n; return api; },
    order: () => api,
    single: first,
    maybeSingle: first,
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => run().then(res, rej),
  };
  return api;
}

jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => table(t) }));
jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: (t: string) => table(t), rpc: async () => ({ data: null, error: null }) },
}));
jest.mock('../../services/userContextService', () => ({
  enforceCompanyAccess: async () => ({ userId: 'admin-of-a' }),
}));
jest.mock('../../services/rbacService', () => ({
  enforceRole: async () => true,
  Role: { COMPANY_ADMIN: 'COMPANY_ADMIN', SUPER_ADMIN: 'SUPER_ADMIN' },
}));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../auth/metaAuthService', () => ({
  getValidAccessToken: async (id: string) => { tokenReads.push(id); return `token-of-${id}`; },
}));
jest.mock('../../auth/credentialEncryption', () => ({ requireEncryptionKey: () => Buffer.from('11'.repeat(32), 'hex') }));
jest.mock('../../middleware/queueBackpressure', () => ({
  enqueueOrThrow: async (_q: unknown, _n: string, _j: string, data: Row) => { enqueued.push(data); },
}));
jest.mock('../../queue/contentGenerationQueues', () => ({ getContentQueue: () => ({}) }));
jest.mock('../../services/whatsappTemplateService', () => ({
  getActiveTemplate: async () => ({ name: 'tpl' }),
  submitTemplate: async (input: Row) => { templateSubmits.push(input); return 'tpl-1'; },
}));
jest.mock('../../services/whatsappRateLimiter', () => ({
  checkAndConsume: async (p: Row) => { rateChecks.push(p); return { allowed: true, tier: 1, remaining: 1000 }; },
  getBroadcastChunkStrategy: () => ({ batch_size: 10, delay_ms: 0 }),
}));
jest.mock('../../services/prospectIdentity/contactGovernanceRepository', () => ({
  loadTenantGovernanceRecords: async () => ({ ok: true, records: [] }),
  normalizeGovernanceTarget: (_c: string, t: string) => t,
}));

import createRoute from '../../../pages/api/whatsapp/broadcasts/index';
import idRoute from '../../../pages/api/whatsapp/broadcasts/[id]';
import templatesRoute from '../../../pages/api/whatsapp/templates/index';
import { processBatch } from '../../services/whatsappBroadcastService';

function mockRes() {
  const res: any = { statusCode: 0, body: undefined };
  res.setHeader = () => res;
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (p: unknown) => { res.body = p; return res; };
  return res;
}

async function call(handler: unknown, req: Row) {
  const res = mockRes();
  await (handler as (q: unknown, s: unknown) => Promise<void>)({ headers: {}, query: {}, body: {}, ...req }, res);
  return res;
}

const createBody = (social_account_id: string) => ({
  company_id: COMPANY_A, social_account_id, name: 'Spring', message_type: 'text', body: 'hi',
});

beforeEach(() => {
  db.social_accounts = [
    { id: ACCOUNT_A, company_id: COMPANY_A, phone_number_id: 'pn-a' },
    { id: ACCOUNT_B, company_id: COMPANY_B, phone_number_id: 'pn-b' },
  ];
  db.whatsapp_broadcasts = [];
  db.whatsapp_broadcast_recipients = [];
  db.failTable = null;
  db.inserts = [];
  tokenReads.length = 0; rateChecks.length = 0; enqueued.length = 0; templateSubmits.length = 0; fetchCalls.length = 0;
  (global as unknown as { fetch: unknown }).fetch = async (url: string) => {
    fetchCalls.push(String(url));
    return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.1' }] }) };
  };
});

const broadcastInserts = () => db.inserts.filter((i) => i.table === 'whatsapp_broadcasts');

describe('POST /api/whatsapp/broadcasts — sender account must belong to company_id', () => {
  it('own account: broadcast is created', async () => {
    const res = await call(createRoute, { method: 'POST', body: createBody(ACCOUNT_A) });
    expect(res.statusCode).toBe(201);
    expect(broadcastInserts()).toHaveLength(1);
    expect(broadcastInserts()[0].row.social_account_id).toBe(ACCOUNT_A);
  });

  it("another company's account: 404, nothing created", async () => {
    const res = await call(createRoute, { method: 'POST', body: createBody(ACCOUNT_B) });
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Social account not found' });
    expect(broadcastInserts()).toHaveLength(0);
  });

  it('missing account: the same 404 as a foreign one (existence not revealed)', async () => {
    const foreign = await call(createRoute, { method: 'POST', body: createBody(ACCOUNT_B) });
    const missing = await call(createRoute, { method: 'POST', body: createBody('sa-does-not-exist') });
    expect(missing.statusCode).toBe(404);
    expect(missing.body).toEqual(foreign.body);
    expect(broadcastInserts()).toHaveLength(0);
  });

  it('unreadable account lookup: 503, nothing created (fail closed)', async () => {
    db.failTable = 'social_accounts';
    const res = await call(createRoute, { method: 'POST', body: createBody(ACCOUNT_A) });
    expect(res.statusCode).toBe(503);
    expect(broadcastInserts()).toHaveLength(0);
  });
});

describe('a broadcast stored before the check, naming a foreign account', () => {
  beforeEach(() => {
    db.whatsapp_broadcasts.push({
      id: 'legacy-1', company_id: COMPANY_A, social_account_id: ACCOUNT_B,
      name: 'legacy', message_type: 'text', body: 'hi', status: 'draft',
    });
    db.whatsapp_broadcast_recipients.push({ id: 'r1', broadcast_id: 'legacy-1', status: 'pending', encrypted_phone: 'x' });
  });

  it('enqueue: 404, no rate limit consumed on the foreign account, nothing queued', async () => {
    const res = await call(idRoute, { method: 'POST', query: { id: 'legacy-1', action: 'enqueue' }, body: {} });
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Social account not found' });
    expect(rateChecks).toHaveLength(0);
    expect(enqueued).toHaveLength(0);
  });

  it('processBatch (already queued): refuses before the token is read; nothing sent', async () => {
    await expect(processBatch('legacy-1', ['r1'])).rejects.toThrow('WhatsApp sender account not found');
    expect(tokenReads).toHaveLength(0);
    expect(fetchCalls).toHaveLength(0);
    expect(db.whatsapp_broadcast_recipients[0].status).toBe('pending');
  });

  it('own account: enqueue still works', async () => {
    db.whatsapp_broadcasts[0].social_account_id = ACCOUNT_A;
    const res = await call(idRoute, { method: 'POST', query: { id: 'legacy-1', action: 'enqueue' }, body: {} });
    expect(res.statusCode).toBe(200);
    expect(rateChecks).toHaveLength(1);
    expect(enqueued).toHaveLength(1);
  });
});

describe('POST /api/whatsapp/templates — same ownership rule', () => {
  const body = (social_account_id: string) => ({
    company_id: COMPANY_A, social_account_id, template_name: 't', template_category: 'MARKETING', components: [],
  });

  it('own account: submitted', async () => {
    const res = await call(templatesRoute, { method: 'POST', body: body(ACCOUNT_A) });
    expect(res.statusCode).toBe(201);
    expect(templateSubmits).toHaveLength(1);
  });

  it('foreign and missing accounts: 404, not submitted', async () => {
    const foreign = await call(templatesRoute, { method: 'POST', body: body(ACCOUNT_B) });
    const missing = await call(templatesRoute, { method: 'POST', body: body('nope') });
    expect(foreign.statusCode).toBe(404);
    expect(missing.statusCode).toBe(404);
    expect(missing.body).toEqual(foreign.body);
    expect(templateSubmits).toHaveLength(0);
  });
});
