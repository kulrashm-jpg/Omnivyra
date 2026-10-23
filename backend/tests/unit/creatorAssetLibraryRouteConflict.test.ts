/**
 * SEC-1 at the API boundary — PUT /api/creator-assets/library.
 *
 * The library envelope id is client-chosen and `creator_assets.id` is a global
 * primary key. Before SEC-1 an id-only upsert let company B overwrite company
 * A's row (and re-own it) just by naming its id. The route must refuse with a
 * generic 409 that carries none of A's data or the database's wording, and must
 * leave A's row exactly as it was.
 *
 * The real route handler and the real persistence service run; only the
 * database, config, telemetry, auth context and route factory are faked.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));
jest.mock('../../services/telemetry/telemetryDispatcher', () => ({ trackEvent: jest.fn() }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('@/backend/services/userContextService', () => ({
  enforceCompanyAccess: async ({ companyId }: { companyId: string }) => ({ userId: `user-of-${companyId}` }),
}));

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};
let beforeNextInsert: (() => void) | null = null;

function matches(row: Row, filters: Array<[string, unknown]>): boolean {
  return filters.every(([col, val]) => row[col] === val);
}

function tableApi(table: string) {
  const rows = (db[table] ??= []);
  const filters: Array<[string, unknown]> = [];
  const found = () => rows.find((r) => matches(r, filters)) ?? null;
  const api: Record<string, any> = {
    select: () => api,
    eq: (c: string, v: unknown) => { filters.push([c, v]); return api; },
    is: (c: string, v: unknown) => { filters.push([c, v]); return api; },
    limit: () => api,
    maybeSingle: async () => ({ data: found(), error: null }),
    single: async () => ({ data: found(), error: null }),
    then: (res: any, rej: any) =>
      Promise.resolve({ data: rows.filter((r) => matches(r, filters)), error: null }).then(res, rej),
    insert: (payload: Row) => {
      const hook = beforeNextInsert;
      beforeNextInsert = null;
      hook?.();
      const clash = rows.some((r) => r.id === payload.id);
      if (!clash) rows.push({ created_at: '2026-01-01T00:00:00Z', archived_at: null, deleted_at: null, ...payload });
      const result = clash
        ? { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "creator_assets_pkey"' } }
        : { data: rows.find((r) => r.id === payload.id), error: null };
      return { select: () => ({ single: async () => result }) };
    },
    upsert: (payload: Row) => {
      const hit = rows.find((r) => r.id === payload.id);
      if (hit) Object.assign(hit, payload);
      else rows.push({ ...payload });
      return { select: () => ({ single: async () => ({ data: rows.find((r) => r.id === payload.id), error: null }) }) };
    },
    update: (payload: Row) => {
      const upd: Record<string, any> = {
        eq: (c: string, v: unknown) => { filters.push([c, v]); return upd; },
        select: () => upd,
        maybeSingle: async () => {
          const hit = found();
          if (hit) Object.assign(hit, payload);
          return { data: hit, error: null };
        },
      };
      return upd;
    },
  };
  return api;
}

jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => tableApi(t) }));

import libraryRoute from '../../../pages/api/creator-assets/library';

const A = 'co-A';
const B = 'co-B';
const ID = 'casset_image_shared_id';
const A_SECRET = { title: 'A-only confidential deck', url: 'https://cdn/a-private.png' };
const envelope = (payload: Row) => ({
  id: ID,
  currentVersion: 1,
  versions: [{ version: 1, op: 'generate', payload, createdAt: '2026-01-01' }],
});

function fakeRes() {
  const res: Record<string, any> = { statusCode: 0, body: undefined };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (body: unknown) => { res.body = body; return res; };
  res.setHeader = () => res;
  return res;
}

async function put(companyId: string, payload: Row) {
  const res = fakeRes();
  await (libraryRoute as any)(
    { method: 'PUT', query: {}, headers: {}, body: { company_id: companyId, asset: envelope(payload) } },
    res,
  );
  return res;
}

const rowA = () => db.creator_assets.find((r) => r.id === ID && r.company_id === A);
const snapshot = (row: Row | undefined) => JSON.parse(JSON.stringify(row ?? null));

function expectNoLeak(body: unknown) {
  const text = JSON.stringify(body);
  for (const leak of [A, A_SECRET.title, A_SECRET.url, 'duplicate key', 'creator_assets_pkey']) {
    expect(text).not.toContain(leak);
  }
}

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  db.creator_assets = [];
  db.creator_asset_attachments = [];
  beforeNextInsert = null;
});

describe('SEC-1 — PUT /api/creator-assets/library never crosses a tenant', () => {
  it("the owner can create and then update its own asset", async () => {
    expect((await put(A, A_SECRET)).statusCode).toBe(200);
    const res = await put(A, { ...A_SECRET, title: 'A edited' });
    expect(res.statusCode).toBe(200);
    expect(db.creator_assets).toHaveLength(1);
    expect(rowA()).toMatchObject({ company_id: A, title: 'A edited' });
  });

  it("another company naming the same id gets a generic 409 and A's row is untouched", async () => {
    await put(A, A_SECRET);
    const before = snapshot(rowA());

    const res = await put(B, { title: 'B overwrite attempt', url: 'https://cdn/b.png' });

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: 'asset_id_unavailable' });
    expectNoLeak(res.body);
    expect(db.creator_assets).toHaveLength(1);
    expect(snapshot(rowA())).toEqual(before);
  });

  it('a foreign row appearing between the ownership read and the insert is still refused untouched', async () => {
    let planted: Row | null = null;
    beforeNextInsert = () => {
      db.creator_assets.push({
        id: ID, company_id: A, tenant_id: A, user_id: 'user-of-co-A', title: A_SECRET.title,
        library: envelope(A_SECRET), archived_at: null, deleted_at: null,
      });
      planted = snapshot(db.creator_assets[0]);
    };

    const res = await put(B, { title: 'B race attempt' });

    expect(res.statusCode).toBe(409);
    expectNoLeak(res.body);
    expect(snapshot(rowA())).toEqual(planted);
  });

  it("a GET by the other company never returns A's envelope", async () => {
    await put(A, A_SECRET);
    const res = fakeRes();
    await (libraryRoute as any)({ method: 'GET', query: { company_id: B, id: ID }, headers: {}, body: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ asset: null, server_meta: null });
  });
});
