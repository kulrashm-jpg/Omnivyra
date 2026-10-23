/**
 * F3 — a deterministic creator-asset write can never adopt another company's row.
 *
 * `upsertCreatorAssetRecord` derives `creator_assets.id` from
 * sha1(companyId|userId|sourceType|sourceId|creatorType|renderHash||url||title).
 * Nothing in it is secret, and `creator_assets.id` is a GLOBAL primary key. The
 * library route lets a client INSERT a row under any id it chooses, so company A
 * can pre-create the id company B will later compute. An id-only upsert by B
 * then rewrote company_id to B while leaving A's `library` envelope (and its
 * archived/deleted state) on the row — and every library read prefers that
 * envelope, so B's library, reload and refinement served A's payload.
 *
 * Fixed behaviour: the foreign row is never touched, and B's asset is not
 * dropped either — it is re-homed to a fresh random id owned by B and
 * remembered as metadata.rehomedFrom, so later writes converge on it.
 *
 * Only the database (`ownedDbTable`), config and telemetry are faked; the real
 * persistence functions and the real route handler run against an in-memory
 * table that enforces the global primary key and PostgREST upsert semantics.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));
// Forces the re-home id when set, to prove the last-resort refusal; otherwise real.
let mockForcedRandomHex: string | null = null;
jest.mock('crypto', () => {
  const actual = jest.requireActual('crypto');
  return {
    ...actual,
    randomBytes: (size: number) => (mockForcedRandomHex ? Buffer.from(mockForcedRandomHex, 'hex') : actual.randomBytes(size)),
  };
});
jest.mock('../../services/telemetry/telemetryDispatcher', () => ({ trackEvent: jest.fn() }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('@/backend/services/userContextService', () => ({
  enforceCompanyAccess: async ({ companyId }: { companyId: string }) => ({ userId: `user-of-${companyId}` }),
}));

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};
/** Runs once, immediately before the next INSERT/UPSERT reaches the table (race injection). */
let beforeNextWrite: (() => void) | null = null;

function fireBeforeWrite() {
  const hook = beforeNextWrite;
  beforeNextWrite = null;
  hook?.();
}

function matches(row: Row, filters: Array<[string, unknown]>): boolean {
  return filters.every(([col, val]) => {
    if (col.startsWith('metadata->>')) {
      const meta = (row.metadata ?? {}) as Record<string, unknown>;
      return String(meta[col.slice('metadata->>'.length)] ?? '') === String(val);
    }
    return row[col] === val;
  });
}

function tableApi(table: string) {
  const rows = (db[table] ??= []);
  const filters: Array<[string, unknown]> = [];
  const found = () => rows.find((r) => matches(r, filters)) ?? null;
  const api: Record<string, any> = {
    select: () => api,
    eq: (c: string, v: unknown) => { filters.push([c, v]); return api; },
    is: (c: string, v: unknown) => { filters.push([c, v]); return api; },
    in: () => api,
    ilike: () => api,
    order: () => api,
    limit: () => api,
    maybeSingle: async () => ({ data: found(), error: null }),
    single: async () => ({ data: found(), error: null }),
    then: (res: any, rej: any) =>
      Promise.resolve({ data: rows.filter((r) => matches(r, filters)), error: null }).then(res, rej),
    insert: (payload: Row) => {
      fireBeforeWrite();
      const clash = rows.some((r) => r.id === payload.id);
      if (!clash) rows.push({ created_at: '2026-01-01T00:00:00Z', archived_at: null, deleted_at: null, ...payload });
      const result = clash
        ? { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "creator_assets_pkey"' } }
        : { data: rows.find((r) => r.id === payload.id), error: null };
      return { select: () => ({ single: async () => result }) };
    },
    // PostgREST upsert = INSERT … ON CONFLICT (id) DO UPDATE SET <supplied columns>.
    upsert: (payload: Row) => {
      fireBeforeWrite();
      const hit = rows.find((r) => r.id === payload.id);
      if (hit) Object.assign(hit, payload);
      else rows.push({ created_at: '2026-01-01T00:00:00Z', archived_at: null, deleted_at: null, ...payload });
      const result = { data: rows.find((r) => r.id === payload.id), error: null };
      return { select: () => ({ single: async () => result }) };
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

import {
  CreatorAssetIdConflictError,
  upsertCreatorAssetRecord,
  libraryWriteAsset,
  libraryReadAsset,
  libraryListAssets,
} from '../../services/creatorAssetPersistenceService';
import creatorAssetsRoute from '../../../pages/api/creator-assets/index';

const A = 'co-A';
const B = 'co-B';
const B_INPUT = { companyId: B, userId: 'user-of-co-B', creatorType: 'image', title: 'Creator asset' };
const A_SECRET = { title: 'A-only confidential deck', url: 'https://cdn/a-private.png' };

function reset() {
  for (const k of Object.keys(db)) delete db[k];
  db.creator_assets = [];
  db.creator_asset_attachments = [];
  beforeNextWrite = null;
}

/** The id B's write will compute — learnt exactly as an attacker could: by running the same derivation. */
async function idCompanyBWillUse(): Promise<string> {
  reset();
  const row = await upsertCreatorAssetRecord(B_INPUT);
  const id = String(row.id);
  reset();
  return id;
}

const plantedEnvelope = (id: string) => ({
  id,
  currentVersion: 1,
  versions: [{ version: 1, op: 'generate', payload: A_SECRET, createdAt: '2026-01-01' }],
});

/** Company A plants a library row (archived, with its own envelope) under B's future id. */
async function plantAsCompanyA(id: string): Promise<Row> {
  await libraryWriteAsset({ companyId: A, userId: 'user-of-co-A', envelope: plantedEnvelope(id) });
  const row = db.creator_assets.find((r) => r.id === id)!;
  row.archived_at = '2026-02-02T00:00:00Z';
  return row;
}

const snapshot = (row: Row) => JSON.parse(JSON.stringify(row));
const serialized = () => JSON.stringify(db.creator_assets);

beforeEach(reset);

const HEX32 = /^[0-9a-f]{32}$/;
const bRows = () => db.creator_assets.filter((r) => r.company_id === B);
const rehomedFrom = (row: Row) => (row.metadata as Record<string, unknown> | undefined)?.rehomedFrom;

describe('F3 — a deterministic write never adopts a row owned by another company', () => {
  it('a normal write by a company creates its own row under the deterministic id', async () => {
    const id = await idCompanyBWillUse();
    const row = await upsertCreatorAssetRecord(B_INPUT);
    expect(row).toMatchObject({ id, company_id: B, title: 'Creator asset' });
    expect(rehomedFrom(row)).toBeUndefined();
    expect(db.creator_assets).toHaveLength(1);
  });

  it('re-writing the same deterministic asset updates it in place for the same company', async () => {
    const first = await upsertCreatorAssetRecord({ ...B_INPUT, files: ['https://cdn/v1.png'] });
    const second = await upsertCreatorAssetRecord({ ...B_INPUT, files: ['https://cdn/v2.png'] });
    expect(second.id).toBe(first.id);
    expect(db.creator_assets).toHaveLength(1);
    expect(db.creator_assets[0]).toMatchObject({ company_id: B, files: ['https://cdn/v2.png'] });
  });

  it("the same company's own library envelope survives its own re-render", async () => {
    const own = await upsertCreatorAssetRecord(B_INPUT);
    await libraryWriteAsset({ companyId: B, userId: 'user-of-co-B', envelope: plantedEnvelope(String(own.id)) });
    await upsertCreatorAssetRecord(B_INPUT);
    expect((db.creator_assets[0].library as { currentVersion: number }).currentVersion).toBe(1);
    expect(db.creator_assets[0].company_id).toBe(B);
  });

  it("a planted foreign row is left field-for-field unchanged and B's asset is re-homed to its own row", async () => {
    const id = await idCompanyBWillUse();
    const planted = await plantAsCompanyA(id);
    const before = snapshot(planted);

    const row = await upsertCreatorAssetRecord(B_INPUT);

    // A's row: untouched, including company, envelope, archive and delete state.
    expect(snapshot(db.creator_assets.find((r) => r.id === id)!)).toEqual(before);
    expect(before).toMatchObject({ company_id: A, archived_at: '2026-02-02T00:00:00Z', deleted_at: null });
    // B's asset: persisted under a fresh, unpredictable id that B owns.
    expect(row.id).not.toBe(id);
    expect(String(row.id)).toMatch(HEX32);
    expect(row).toMatchObject({ company_id: B, tenant_id: B, title: 'Creator asset', archived_at: null, deleted_at: null });
    expect(rehomedFrom(row)).toBe(id);
    expect(row.library ?? null).toBeNull();
    expect(JSON.stringify(row)).not.toContain(A_SECRET.title);
    expect(db.creator_assets).toHaveLength(2);
  });

  it('every later write of the re-homed asset converges on the same row', async () => {
    const id = await idCompanyBWillUse();
    await plantAsCompanyA(id);
    const first = await upsertCreatorAssetRecord({ ...B_INPUT, files: ['https://cdn/v1.png'] });
    const second = await upsertCreatorAssetRecord({ ...B_INPUT, files: ['https://cdn/v2.png'] });
    expect(second.id).toBe(first.id);
    expect(bRows()).toHaveLength(1);
    expect(bRows()[0]).toMatchObject({ files: ['https://cdn/v2.png'] });
    expect(rehomedFrom(bRows()[0])).toBe(id);
  });

  it("company B can never read company A's envelope — by id or in its library list", async () => {
    const id = await idCompanyBWillUse();
    await plantAsCompanyA(id);
    const row = await upsertCreatorAssetRecord(B_INPUT);

    expect(await libraryReadAsset({ companyId: B, assetId: id })).toBeNull();
    expect(JSON.stringify(await libraryReadAsset({ companyId: B, assetId: String(row.id) }))).not.toContain(A_SECRET.title);
    const listed = await libraryListAssets({ companyId: B, includeArchived: true });
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(A_SECRET.title);
    // A still owns and sees its own row.
    expect((await libraryReadAsset({ companyId: A, assetId: id }))?.envelope).toMatchObject({ id, currentVersion: 1 });
  });

  it("a foreign row claiming to be B's re-home target is never used or touched", async () => {
    const id = await idCompanyBWillUse();
    await plantAsCompanyA(id);
    db.creator_assets.push({
      id: 'a-decoy-row', company_id: A, tenant_id: A, title: 'A decoy',
      metadata: { rehomedFrom: id }, library: plantedEnvelope('a-decoy-row'), archived_at: null, deleted_at: null,
    });
    const before = serialized();

    const row = await upsertCreatorAssetRecord(B_INPUT);

    expect(row.id).not.toBe('a-decoy-row');
    expect(row.company_id).toBe(B);
    expect(JSON.stringify(db.creator_assets.filter((r) => r.company_id === A))).toBe(
      JSON.stringify(JSON.parse(before).filter((r: Row) => r.company_id === A)),
    );
  });

  it('a row planted concurrently, between the ownership check and the insert, is left untouched', async () => {
    const id = await idCompanyBWillUse();
    let planted: Row | null = null;
    beforeNextWrite = () => {
      db.creator_assets.push({
        id, company_id: A, tenant_id: A, user_id: 'user-of-co-A', title: 'A row',
        library: plantedEnvelope(id), archived_at: null, deleted_at: null,
      });
      planted = snapshot(db.creator_assets[db.creator_assets.length - 1]);
    };

    const row = await upsertCreatorAssetRecord(B_INPUT);

    expect(planted).not.toBeNull();
    expect(snapshot(db.creator_assets.find((r) => r.id === id)!)).toEqual(planted);
    expect(row).toMatchObject({ company_id: B });
    expect(rehomedFrom(row)).toBe(id);
  });

  it('a concurrent create by the SAME company converges on that row', async () => {
    const id = await idCompanyBWillUse();
    beforeNextWrite = () => {
      db.creator_assets.push({ id, company_id: B, tenant_id: B, user_id: 'user-of-co-B', title: 'race', archived_at: null, deleted_at: null });
    };
    const row = await upsertCreatorAssetRecord({ ...B_INPUT, files: ['https://cdn/final.png'] });
    expect(row).toMatchObject({ id, company_id: B });
    expect(db.creator_assets).toHaveLength(1);
    expect(db.creator_assets[0]).toMatchObject({ company_id: B, files: ['https://cdn/final.png'] });
  });

  it("two concurrent writes by the victim never touch the planted row and never carry A's data", async () => {
    const id = await idCompanyBWillUse();
    await plantAsCompanyA(id);
    const aBefore = JSON.stringify(db.creator_assets.filter((r) => r.company_id === A));
    const results = await Promise.allSettled([upsertCreatorAssetRecord(B_INPUT), upsertCreatorAssetRecord(B_INPUT)]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(JSON.stringify(db.creator_assets.filter((r) => r.company_id === A))).toBe(aBefore);
    // A same-company race may leave B two re-homed rows (benign duplicate); each is B's and A-free.
    expect(bRows().length).toBeGreaterThanOrEqual(1);
    for (const r of bRows()) {
      expect(rehomedFrom(r)).toBe(id);
      expect(JSON.stringify(r)).not.toContain(A_SECRET.title);
    }
  });

  it('when even the random re-home id collides, the write is refused and nothing is modified', async () => {
    const id = await idCompanyBWillUse();
    await plantAsCompanyA(id);
    const forced = 'f'.repeat(32);
    db.creator_assets.push({ id: forced, company_id: A, tenant_id: A, title: 'A second row', archived_at: null, deleted_at: null });
    const before = serialized();
    mockForcedRandomHex = forced;
    try {
      await expect(upsertCreatorAssetRecord(B_INPUT)).rejects.toBeInstanceOf(CreatorAssetIdConflictError);
    } finally {
      mockForcedRandomHex = null;
    }
    expect(serialized()).toBe(before);
  });
});

describe('F3 — the API boundary never exposes the foreign row', () => {
  function fakeRes() {
    const res: Record<string, any> = { statusCode: 0, body: undefined };
    res.status = (code: number) => { res.statusCode = code; return res; };
    res.json = (body: unknown) => { res.body = body; return res; };
    res.setHeader = () => res;
    return res;
  }
  const post = async () => {
    const res = fakeRes();
    await (creatorAssetsRoute as any)(
      { method: 'POST', query: {}, headers: {}, body: { company_id: B, asset: { creatorType: 'image' } } },
      res,
    );
    return res;
  };
  const expectNoLeak = (body: unknown, id: string) => {
    const text = JSON.stringify(body);
    for (const leak of [A, A_SECRET.title, A_SECRET.url, id, 'duplicate key', 'creator_assets_pkey']) {
      expect(text).not.toContain(leak);
    }
  };

  it("POST /api/creator-assets saves B's asset under its own id and returns none of A's data", async () => {
    const id = await idCompanyBWillUse();
    await plantAsCompanyA(id);
    const aBefore = JSON.stringify(db.creator_assets.filter((r) => r.company_id === A));
    const res = await post();
    expect(res.statusCode).toBe(200);
    expect(res.body.asset).toMatchObject({ company_id: B });
    expect(res.body.asset.id).not.toBe(id);
    expect(JSON.stringify(res.body)).not.toContain(A_SECRET.title);
    expect(JSON.stringify(db.creator_assets.filter((r) => r.company_id === A))).toBe(aBefore);
  });

  it('an unplaceable write answers a generic 409 asset_id_unavailable', async () => {
    const id = await idCompanyBWillUse();
    await plantAsCompanyA(id);
    const forced = 'e'.repeat(32);
    db.creator_assets.push({ id: forced, company_id: A, tenant_id: A, title: 'A second row', archived_at: null, deleted_at: null });
    const before = serialized();
    mockForcedRandomHex = forced;
    let res: Record<string, any>;
    try {
      res = await post();
    } finally {
      mockForcedRandomHex = null;
    }
    expect(res!.statusCode).toBe(409);
    expect(res!.body).toEqual({ error: 'asset_id_unavailable' });
    expectNoLeak(res!.body, id);
    expect(serialized()).toBe(before);
  });
});
