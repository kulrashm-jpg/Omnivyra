/**
 * F3 convergence — concurrent writes of ONE logical asset by ONE company.
 *
 * Canonical-identity rule under test:
 *   1. The asset's identity is its deterministic id (stableAssetId). While this
 *      company owns that id, every write — sequential or concurrent — lands on
 *      that one row; the global primary key makes concurrent creates atomic.
 *   2. If ANOTHER company holds the deterministic id, the asset is re-homed:
 *      the canonical row is this company's OLDEST row whose
 *      metadata.rehomedFrom equals the deterministic id (ties by id).
 *   3. Concurrent first re-homes converge only with the proposed unique index
 *      on (company_id, metadata->>'rehomedFrom'); without it a perfectly
 *      simultaneous pair can leave a second row, and later writes still
 *      converge on the oldest. The index is modelled here (`rehomeIndex`),
 *      not applied anywhere.
 *   4. The foreign row is never modified, and `rehomedFrom` is server-owned.
 *
 * The real persistence functions run against an in-memory table; a barrier
 * holds INSERTs until both writers have passed their lookups, so the race is
 * deterministic rather than timing-dependent.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));
jest.mock('../../services/telemetry/telemetryDispatcher', () => ({ trackEvent: jest.fn() }));

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};
let clock = 0;
let rehomeIndex = false;
/** Fail the creator_assets INSERT that comes after `skip` more inserts, once. */
let failInsert: { skip: number; error: { code: string; message: string } } | null = null;
let insertBarrier: { size: number; waiting: Array<() => void> } | null = null;

const metaOf = (row: Row) => (row.metadata ?? {}) as Record<string, unknown>;

function matches(row: Row, filters: Array<[string, unknown]>): boolean {
  return filters.every(([col, val]) => {
    if (col.startsWith('metadata->>')) return String(metaOf(row)[col.slice(11)] ?? '') === String(val);
    return row[col] === val;
  });
}

async function passBarrier() {
  const barrier = insertBarrier;
  if (!barrier) return;
  await new Promise<void>((resolve) => {
    barrier.waiting.push(resolve);
    if (barrier.waiting.length >= barrier.size) {
      insertBarrier = null;
      barrier.waiting.forEach((r) => r());
    }
  });
}

function uniqueViolation(rows: Row[], payload: Row): string | null {
  if (rows.some((r) => r.id === payload.id)) return 'creator_assets_pkey';
  const from = metaOf(payload).rehomedFrom;
  if (rehomeIndex && from && rows.some((r) => r.company_id === payload.company_id && metaOf(r).rehomedFrom === from)) {
    return 'creator_assets_company_rehomed_from_uniq';
  }
  return null;
}

function tableApi(table: string) {
  const rows = (db[table] ??= []);
  const filters: Array<[string, unknown]> = [];
  const sorts: Array<[string, boolean]> = [];
  const selected = () => {
    const hit = rows.filter((r) => matches(r, filters));
    for (const [col, asc] of [...sorts].reverse()) {
      hit.sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (asc ? 1 : -1));
    }
    return hit;
  };
  const api: Record<string, any> = {
    select: () => api,
    eq: (c: string, v: unknown) => { filters.push([c, v]); return api; },
    is: (c: string, v: unknown) => { filters.push([c, v]); return api; },
    in: () => api,
    ilike: () => api,
    order: (c: string, o?: { ascending?: boolean }) => { sorts.push([c, o?.ascending !== false]); return api; },
    limit: () => api,
    maybeSingle: async () => ({ data: selected()[0] ?? null, error: null }),
    single: async () => ({ data: selected()[0] ?? null, error: null }),
    then: (res: any, rej: any) => Promise.resolve({ data: selected(), error: null }).then(res, rej),
    insert: (payload: Row) => ({
      select: () => ({
        single: async () => {
          if (table === 'creator_assets') await passBarrier();
          if (table === 'creator_assets' && failInsert) {
            if (failInsert.skip > 0) failInsert.skip -= 1;
            else {
              const e = failInsert.error;
              failInsert = null;
              return { data: null, error: e };
            }
          }
          const clash = uniqueViolation(rows, payload);
          if (clash) return { data: null, error: { code: '23505', message: `duplicate key value violates unique constraint "${clash}"` } };
          clock += 1;
          rows.push({ created_at: `2026-01-01T00:00:${String(clock).padStart(2, '0')}Z`, archived_at: null, deleted_at: null, ...payload });
          return { data: rows[rows.length - 1], error: null };
        },
      }),
    }),
    // PostgREST upsert (INSERT … ON CONFLICT (id) DO UPDATE) — only the pre-SEC-1 library write uses it here.
    upsert: (payload: Row) => ({
      select: () => ({
        single: async () => {
          const hit = rows.find((r) => r.id === payload.id);
          if (hit) Object.assign(hit, payload);
          else { clock += 1; rows.push({ created_at: `2026-01-01T00:00:${String(clock).padStart(2, '0')}Z`, archived_at: null, deleted_at: null, ...payload }); }
          return { data: rows.find((r) => r.id === payload.id), error: null };
        },
      }),
    }),
    update: (payload: Row) => {
      const upd: Record<string, any> = {
        eq: (c: string, v: unknown) => { filters.push([c, v]); return upd; },
        select: () => upd,
        maybeSingle: async () => {
          const hit = rows.find((r) => matches(r, filters)) ?? null;
          if (hit) Object.assign(hit, payload);
          return { data: hit, error: null };
        },
        // awaited without maybeSingle (archive / soft delete): every matching row, as an array.
        then: (res: any, rej: any) => {
          const hits = rows.filter((r) => matches(r, filters));
          hits.forEach((h) => Object.assign(h, payload));
          return Promise.resolve({ data: hits, error: null }).then(res, rej);
        },
      };
      return upd;
    },
  };
  return api;
}

jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => tableApi(t) }));

import {
  upsertCreatorAssetRecord,
  libraryWriteAsset,
  libraryReadAsset,
  archiveLibraryAsset,
  softDeleteLibraryAsset,
} from '../../services/creatorAssetPersistenceService';

const A = 'co-A';
const B = 'co-B';
const B_INPUT = { companyId: B, userId: 'user-of-co-B', creatorType: 'image', title: 'Creator asset' };
const A_SECRET = 'A-only confidential deck';

function reset() {
  for (const k of Object.keys(db)) delete db[k];
  db.creator_assets = [];
  db.creator_asset_attachments = [];
  clock = 0;
  rehomeIndex = false;
  failInsert = null;
  insertBarrier = null;
}

async function deterministicIdOfB(): Promise<string> {
  reset();
  const id = String((await upsertCreatorAssetRecord(B_INPUT)).id);
  reset();
  return id;
}

async function plantAsA(id: string): Promise<string> {
  await libraryWriteAsset({
    companyId: A,
    userId: 'user-of-co-A',
    envelope: { id, currentVersion: 1, versions: [{ version: 1, op: 'generate', payload: { title: A_SECRET }, createdAt: '2026-01-01' }] },
  });
  return JSON.stringify(db.creator_assets.find((r) => r.id === id));
}

const bRows = () => db.creator_assets.filter((r) => r.company_id === B);
const foreignRow = (id: string) => JSON.stringify(db.creator_assets.find((r) => r.id === id));
const together = <T,>(...writes: Array<() => Promise<T>>) => {
  insertBarrier = { size: writes.length, waiting: [] };
  return Promise.all(writes.map((w) => w()));
};

beforeEach(reset);

describe('rule 1 — the company owns its deterministic id', () => {
  it('two simultaneous first writes of the same asset converge on one row', async () => {
    const id = await deterministicIdOfB();
    const [a, b] = await together(() => upsertCreatorAssetRecord(B_INPUT), () => upsertCreatorAssetRecord(B_INPUT));
    expect([a.id, b.id]).toEqual([id, id]);
    expect(db.creator_assets).toHaveLength(1);
  });

  it('repeated identical writes never create another asset', async () => {
    for (let i = 0; i < 3; i += 1) await upsertCreatorAssetRecord(B_INPUT);
    expect(db.creator_assets).toHaveLength(1);
  });

  it('concurrent writes with different non-identity fields leave one row holding one complete write', async () => {
    const writes = [['https://cdn/one.png'], ['https://cdn/two.png']];
    await together(...writes.map((files) => () => upsertCreatorAssetRecord({ ...B_INPUT, files })));
    expect(db.creator_assets).toHaveLength(1);
    expect(writes).toContainEqual(db.creator_assets[0].files);
  });

  it('a retry after a transient database error converges on one row and leaks nothing', async () => {
    failInsert = { skip: 0, error: { code: '57014', message: 'canceling statement due to statement timeout' } };
    const first = await upsertCreatorAssetRecord(B_INPUT).catch((e: Error) => e);
    expect(first).toBeInstanceOf(Error);
    expect(String((first as Error).message)).toMatch(/^Failed to persist creator asset:/);
    const retried = await upsertCreatorAssetRecord(B_INPUT);
    expect(retried.company_id).toBe(B);
    expect(db.creator_assets).toHaveLength(1);
  });
});

describe('rule 2/3 — the deterministic id is held by another company', () => {
  it('with the proposed unique index, simultaneous first re-homes converge on ONE row', async () => {
    const id = await deterministicIdOfB();
    const aBefore = await plantAsA(id);
    rehomeIndex = true;
    const [x, y] = await together(() => upsertCreatorAssetRecord(B_INPUT), () => upsertCreatorAssetRecord(B_INPUT));
    expect(x.id).toBe(y.id);
    expect(x.id).not.toBe(id);
    expect(bRows()).toHaveLength(1);
    expect(foreignRow(id)).toBe(aBefore);
  });

  it('with the index, simultaneous re-homes with different fields still leave one row', async () => {
    const id = await deterministicIdOfB();
    await plantAsA(id);
    rehomeIndex = true;
    const writes = [['https://cdn/one.png'], ['https://cdn/two.png']];
    await together(...writes.map((files) => () => upsertCreatorAssetRecord({ ...B_INPUT, files })));
    expect(bRows()).toHaveLength(1);
    expect(writes).toContainEqual(bRows()[0].files);
  });

  it('WITHOUT the index, a perfectly simultaneous pair can leave a second row; later writes converge on the oldest', async () => {
    const id = await deterministicIdOfB();
    const aBefore = await plantAsA(id);
    await together(() => upsertCreatorAssetRecord(B_INPUT), () => upsertCreatorAssetRecord(B_INPUT));
    expect(bRows().length).toBeLessThanOrEqual(2); // the documented residual without the index
    const oldest = [...bRows()].sort((p, q) => String(p.created_at).localeCompare(String(q.created_at)))[0];
    for (let i = 0; i < 3; i += 1) {
      expect((await upsertCreatorAssetRecord({ ...B_INPUT, files: [`https://cdn/v${i}.png`] })).id).toBe(oldest.id);
    }
    expect(foreignRow(id)).toBe(aBefore);
  });

  it('sequential re-home writes never create another asset', async () => {
    const id = await deterministicIdOfB();
    await plantAsA(id);
    const ids = new Set<string>();
    for (let i = 0; i < 3; i += 1) ids.add(String((await upsertCreatorAssetRecord(B_INPUT)).id));
    expect(ids.size).toBe(1);
    expect(bRows()).toHaveLength(1);
  });

  it('a retry after a transient error during re-home converges on one row', async () => {
    const id = await deterministicIdOfB();
    const aBefore = await plantAsA(id);
    rehomeIndex = true;
    // Insert #1 is the deterministic id (23505: foreign); insert #2 — the re-home — fails transiently.
    failInsert = { skip: 1, error: { code: '08006', message: 'connection failure' } };
    const first = await upsertCreatorAssetRecord(B_INPUT).catch((e: Error) => e);
    expect(first).toBeInstanceOf(Error);
    expect(String((first as Error).message)).toMatch(/^Failed to persist creator asset:/);
    expect(String((first as Error).message)).not.toContain(A_SECRET);
    expect(bRows()).toHaveLength(0);

    const retried = await upsertCreatorAssetRecord(B_INPUT);
    const again = await upsertCreatorAssetRecord(B_INPUT);
    expect(again.id).toBe(retried.id);
    expect(bRows()).toHaveLength(1);
    expect(foreignRow(id)).toBe(aBefore);
  });
});

describe('rule 4 — the foreign row is untouched and rehomedFrom is server-owned', () => {
  it('a caller-supplied metadata.rehomedFrom is stripped from an ordinary write', async () => {
    const row = await upsertCreatorAssetRecord({ ...B_INPUT, metadata: { rehomedFrom: 'someone-elses-id', note: 'kept' } });
    expect((row.metadata as Row).rehomedFrom).toBeUndefined();
    expect((row.metadata as Row).note).toBe('kept');
  });

  it("a forged rehomedFrom on the victim's own unrelated asset cannot divert the re-home", async () => {
    const id = await deterministicIdOfB();
    await plantAsA(id);
    await upsertCreatorAssetRecord({ ...B_INPUT, title: 'Unrelated', metadata: { rehomedFrom: id } });
    const unrelated = bRows()[0];
    const rehomed = await upsertCreatorAssetRecord(B_INPUT);
    expect(rehomed.id).not.toBe(unrelated.id);
    expect(bRows().find((r) => r.id === unrelated.id)).toMatchObject({ title: 'Unrelated' });
  });

  it("the canonical re-homed asset reloads through the library read path without A's data", async () => {
    const id = await deterministicIdOfB();
    await plantAsA(id);
    const row = await upsertCreatorAssetRecord(B_INPUT);
    const read = await libraryReadAsset({ companyId: B, assetId: String(row.id) });
    expect(read).not.toBeNull();
    expect(JSON.stringify(read)).not.toContain(A_SECRET);
    expect(await libraryReadAsset({ companyId: B, assetId: id })).toBeNull();
  });
});

describe('lifecycle compatibility of the canonical re-homed asset', () => {
  async function rehomedAsset() {
    const id = await deterministicIdOfB();
    const aBefore = await plantAsA(id);
    const row = await upsertCreatorAssetRecord(B_INPUT);
    return { id, aBefore, canonical: String(row.id) };
  }

  it('archive and restore apply to the canonical row and later writes keep converging on it', async () => {
    const { id, aBefore, canonical } = await rehomedAsset();
    expect(await archiveLibraryAsset({ companyId: B, assetId: canonical, archived: true })).toBe(true);
    expect((await upsertCreatorAssetRecord(B_INPUT)).id).toBe(canonical);
    expect(bRows()[0].archived_at).not.toBeNull(); // a write does not silently un-archive (same as the deterministic path)
    expect(await archiveLibraryAsset({ companyId: B, assetId: canonical, archived: false })).toBe(true);
    expect(bRows()[0].archived_at).toBeNull();
    expect(bRows()).toHaveLength(1);
    expect(foreignRow(id)).toBe(aBefore);
  });

  it('a soft-deleted canonical row stays deleted on a later write (same as the deterministic path)', async () => {
    const { canonical } = await rehomedAsset();
    expect(await softDeleteLibraryAsset({ companyId: B, assetId: canonical })).toBe(true);
    expect((await upsertCreatorAssetRecord(B_INPUT)).id).toBe(canonical);
    expect(bRows()).toHaveLength(1);
    expect(bRows()[0].deleted_at).not.toBeNull();
  });

  it('after the canonical row is hard-deleted, the next write re-homes afresh and the foreign row is untouched', async () => {
    const { id, aBefore, canonical } = await rehomedAsset();
    // The outcome of a hard delete (libraryRemoveAsset also cleans storage, which is out of scope here).
    db.creator_assets.splice(db.creator_assets.findIndex((r) => r.id === canonical), 1);
    const next = await upsertCreatorAssetRecord(B_INPUT);
    expect(next.id).not.toBe(canonical);
    expect(bRows()).toHaveLength(1);
    expect(foreignRow(id)).toBe(aBefore);
  });
});
