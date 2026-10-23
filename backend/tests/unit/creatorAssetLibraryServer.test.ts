/**
 * Strategic Mix P2 — server Asset Library contract
 * (libraryWriteAsset / libraryReadAsset / libraryListAssets / archive /
 * soft-delete / usage on creatorAssetPersistenceService).
 *
 * Key invariants:
 *  - ONE model: the envelope lives in creator_assets.library; flat columns
 *    sync from the CURRENT version so every legacy reader is unchanged.
 *  - Legacy rows (library IS NULL) surface as synthesized v1 envelopes —
 *    every pre-P2 asset appears in the library with history.
 *  - Existing rows' reconstruction `metadata` column is NOT overwritten by
 *    library writes.
 *  - Soft-deleted rows vanish everywhere; archived rows hide by default.
 */

type Row = Record<string, unknown>;
let tableRows: Row[] = [];
const updates: Array<{ payload: Row; id: unknown }> = [];
/** Last row payload written by upsert, insert or a single-row update. */
let lastUpsert: Row | null = null;
/** When true, the next non-update maybeSingle read returns null once (simulates a concurrent create). */
let hideNextRead = false;

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const filters: Array<{ op: string; col?: string; val?: unknown }> = [];
    const builder: any = {};
    builder.select = () => builder;
    builder.eq = (col: string, val: unknown) => { filters.push({ op: 'eq', col, val }); return builder; };
    builder.is = (col: string, val: unknown) => { filters.push({ op: 'is', col, val }); return builder; };
    builder.in = (col: string, val: unknown) => { filters.push({ op: 'in', col, val }); return builder; };
    builder.ilike = (col: string, val: unknown) => { filters.push({ op: 'ilike', col, val }); return builder; };
    builder.order = () => builder;
    builder.limit = (n: number) => { filters.push({ op: 'limit', val: n }); return builder; };
    const applyFilters = (rows: Row[]) =>
      rows.filter((r) =>
        filters.every((f) => {
          if (f.op === 'eq' && f.col === 'library->>currentVersion') {
            return String((r.library as { currentVersion?: unknown } | null)?.currentVersion) === f.val;
          }
          if (f.op === 'eq') return r[f.col!] === f.val;
          if (f.op === 'is') return (r[f.col!] ?? null) === f.val;
          if (f.op === 'in') return (f.val as unknown[]).includes(r[f.col!]);
          if (f.op === 'ilike') {
            const needle = String(f.val).replace(/%/g, '').toLowerCase();
            return String(r[f.col!] ?? '').toLowerCase().includes(needle);
          }
          return true;
        }),
      );
    builder.maybeSingle = () => ({
      then: (res: any, rej: any) => {
        if (hideNextRead) {
          hideNextRead = false;
          return Promise.resolve({ data: null, error: null }).then(res, rej);
        }
        return Promise.resolve({ data: table === 'creator_assets' ? applyFilters(tableRows)[0] ?? null : null, error: null }).then(res, rej);
      },
    });
    // Like Postgres: `id` is a GLOBAL primary key — a duplicate id fails with
    // 23505 and changes nothing, whichever company owns the existing row.
    builder.insert = (payload: Row) => {
      lastUpsert = payload;
      const clash = tableRows.some((r) => r.id === payload.id);
      if (!clash) tableRows.push({ created_at: new Date().toISOString(), usage_count: 0, ...payload });
      const stored = tableRows.find((r) => r.id === payload.id)!;
      return {
        select: () => ({
          single: () => Promise.resolve(clash
            ? { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "creator_assets_pkey"' } }
            : { data: stored, error: null }),
        }),
      };
    };
    builder.upsert = (payload: Row) => {
      lastUpsert = payload;
      const idx = tableRows.findIndex((r) => r.id === payload.id);
      if (idx >= 0) tableRows[idx] = { ...tableRows[idx], ...payload };
      else tableRows.push({ created_at: new Date().toISOString(), usage_count: 0, ...payload });
      const stored = tableRows.find((r) => r.id === payload.id)!;
      return { select: () => ({ single: () => Promise.resolve({ data: stored, error: null }) }) };
    };
    builder.update = (payload: Row) => {
      const upd = { payload, id: undefined as unknown };
      updates.push(upd);
      const updBuilder: any = {
        eq: (col: string, val: unknown) => { if (col === 'id') upd.id = val; filters.push({ op: 'eq', col, val }); return updBuilder; },
        select: () => updBuilder,
        maybeSingle: () => {
          const hits = applyFilters(tableRows);
          hits.forEach((r) => Object.assign(r, payload));
          if (hits.length > 0) lastUpsert = payload;
          return Promise.resolve({ data: hits[0] ?? null, error: null });
        },
        then: (res: any, rej: any) => {
          const hits = applyFilters(tableRows);
          hits.forEach((r) => Object.assign(r, payload));
          return Promise.resolve({ data: hits.map((r) => ({ id: r.id })), error: null }).then(res, rej);
        },
      };
      return updBuilder;
    };
    builder.delete = () => builder;
    builder.then = (res: any, rej: any) =>
      Promise.resolve({ data: applyFilters(tableRows), error: null }).then(res, rej);
    return builder;
  },
}));
jest.mock('../../services/telemetry/telemetryDispatcher', () => ({ trackEvent: jest.fn() }));

import {
  libraryWriteAsset,
  libraryReadAsset,
  libraryListAssets,
  archiveLibraryAsset,
  softDeleteLibraryAsset,
  recordLibraryAssetUsage,
  LibraryAssetIdConflictError,
  LibraryVersionConflictError,
} from '../../services/creatorAssetPersistenceService';

const envelope = (id: string, title: string, opts: { versions?: number; tags?: string[] } = {}) => {
  const versions = Array.from({ length: opts.versions ?? 1 }, (_, i) => ({
    version: i + 1,
    op: i === 0 ? 'generate' : 'regenerate',
    payload: { id, creatorType: 'infographic', title: i + 1 === (opts.versions ?? 1) ? title : `${title} (old)`, url: `https://cdn/x-${i + 1}.png`, createdAt: '2026-07-11T00:00:00Z' },
    createdAt: '2026-07-11T00:00:00Z',
  }));
  return {
    id,
    currentVersion: versions.length,
    versions,
    selectedVariant: null,
    metadata: { assetType: 'infographic', tags: opts.tags ?? [], organizationId: 'co-1', version: versions.length },
    createdAt: '2026-07-11T00:00:00Z',
    updatedAt: '2026-07-11T00:00:00Z',
  };
};

beforeEach(() => {
  tableRows = [];
  updates.length = 0;
  lastUpsert = null;
  hideNextRead = false;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('libraryWriteAsset — envelope + flat sync (one model)', () => {
  it('stores the envelope and syncs flat columns from the CURRENT version', async () => {
    const record = await libraryWriteAsset({ companyId: 'co-1', userId: 'u-1', envelope: envelope('a1', 'KPI map', { versions: 2 }) });
    expect((record.envelope as { currentVersion: number }).currentVersion).toBe(2);
    expect(lastUpsert).toMatchObject({
      id: 'a1',
      company_id: 'co-1',
      creator_type: 'infographic',
      title: 'KPI map', // current version's title, not v1's
      url: 'https://cdn/x-2.png',
    });
    expect((lastUpsert!.library as { versions: unknown[] }).versions).toHaveLength(2);
  });

  it('does NOT overwrite an existing row’s reconstruction metadata column', async () => {
    tableRows = [{ id: 'a1', company_id: 'co-1', metadata: { reconstructionVersion: 'creator-asset-reconstruction-v1' } }];
    await libraryWriteAsset({ companyId: 'co-1', userId: 'u-1', envelope: envelope('a1', 'KPI map') });
    expect(lastUpsert!.metadata).toBeUndefined(); // metadata column untouched on existing rows
    const stored = tableRows.find((r) => r.id === 'a1')!;
    expect((stored.metadata as Row).reconstructionVersion).toBe('creator-asset-reconstruction-v1');
  });
});

describe('SEC-1 — a library write can never overwrite another company’s asset', () => {
  const foreignRow = () => ({
    id: 'shared-id', company_id: 'co-OTHER', tenant_id: 'co-OTHER', user_id: 'u-other',
    title: 'Their asset', library: envelope('shared-id', 'Their asset'), metadata: { owner: 'co-OTHER' },
  });

  it('refuses an id owned by another company and leaves that row untouched', async () => {
    tableRows = [foreignRow()];
    const before = JSON.stringify(tableRows[0]);
    await expect(
      libraryWriteAsset({ companyId: 'co-1', userId: 'u-1', envelope: envelope('shared-id', 'Hijack') }),
    ).rejects.toBeInstanceOf(LibraryAssetIdConflictError);
    expect(tableRows).toHaveLength(1);
    expect(JSON.stringify(tableRows[0])).toBe(before);
    expect(tableRows[0].company_id).toBe('co-OTHER');
  });

  it('refuses a foreign id on the CAS path too (company-scoped; no row moves)', async () => {
    tableRows = [foreignRow()];
    const before = JSON.stringify(tableRows[0]);
    await expect(
      libraryWriteAsset({ companyId: 'co-1', userId: 'u-1', envelope: envelope('shared-id', 'Hijack'), expectedCurrentVersion: 1 }),
    ).rejects.toBeInstanceOf(LibraryVersionConflictError);
    expect(JSON.stringify(tableRows[0])).toBe(before);
  });

  it('a brand-new id is inserted for the caller (creation unchanged)', async () => {
    const record = await libraryWriteAsset({ companyId: 'co-1', userId: 'u-1', envelope: envelope('fresh', 'New') });
    expect((record.envelope as { id: string }).id).toBe('fresh');
    expect(tableRows).toEqual([expect.objectContaining({ id: 'fresh', company_id: 'co-1', title: 'New' })]);
  });

  it('the caller’s own existing row is updated in place, never duplicated', async () => {
    tableRows = [{ id: 'mine', company_id: 'co-1', title: 'Old', metadata: { keep: true } }];
    await libraryWriteAsset({ companyId: 'co-1', userId: 'u-1', envelope: envelope('mine', 'Renamed') });
    expect(tableRows).toHaveLength(1);
    expect(tableRows[0]).toMatchObject({ id: 'mine', company_id: 'co-1', title: 'Renamed', metadata: { keep: true } });
  });

  it('a concurrent same-company create (insert hits 23505) falls back to the scoped update', async () => {
    tableRows = [{ id: 'race', company_id: 'co-1', title: 'Created concurrently', metadata: { keep: true } }];
    hideNextRead = true; // the pre-read misses the row a concurrent request just created
    await libraryWriteAsset({ companyId: 'co-1', userId: 'u-1', envelope: envelope('race', 'Second writer') });
    expect(tableRows).toHaveLength(1);
    expect(tableRows[0]).toMatchObject({ id: 'race', company_id: 'co-1', title: 'Second writer', metadata: { keep: true } });
  });

  it('the CAS path still lands for the owning company on the expected version', async () => {
    tableRows = [{ id: 'v-own', company_id: 'co-1', title: 'v1', library: envelope('v-own', 'v1') }];
    await libraryWriteAsset({ companyId: 'co-1', userId: 'u-1', envelope: envelope('v-own', 'v2', { versions: 2 }), expectedCurrentVersion: 1 });
    expect((tableRows[0].library as { currentVersion: number }).currentVersion).toBe(2);
  });
});

describe('libraryReadAsset — legacy synthesis (every pre-P2 asset has history)', () => {
  it('synthesizes a v1 envelope from flat columns when library IS NULL', async () => {
    tableRows = [{
      id: 'legacy1', company_id: 'co-1', user_id: 'u-1', creator_type: 'carousel',
      title: 'Old deck', url: 'https://cdn/old.png', files: [], metadata: { tags: ['launch'] },
      created_at: '2026-06-01T00:00:00Z', updated_at: '2026-06-02T00:00:00Z',
      library: null, deleted_at: null,
    }];
    const record = await libraryReadAsset({ companyId: 'co-1', assetId: 'legacy1' });
    const env = record!.envelope as { currentVersion: number; versions: Array<{ payload: { title: string } }>; metadata: { assetType: string; tags: string[] } };
    expect(env.currentVersion).toBe(1);
    expect(env.versions[0].payload.title).toBe('Old deck');
    expect(env.metadata.assetType).toBe('carousel');
    expect(env.metadata.tags).toEqual(['launch']);
  });

  it('soft-deleted assets are invisible', async () => {
    tableRows = [{ id: 'gone', company_id: 'co-1', deleted_at: '2026-07-11T00:00:00Z', library: null }];
    expect(await libraryReadAsset({ companyId: 'co-1', assetId: 'gone' })).toBeNull();
  });
});

describe('libraryListAssets — filters', () => {
  beforeEach(() => {
    tableRows = [
      { id: 'v1', company_id: 'co-1', creator_type: 'infographic', title: 'Visible KPI', library: envelope('v1', 'Visible KPI', { tags: ['kpi'] }), deleted_at: null, archived_at: null, usage_count: 3, updated_at: '2026-07-11T02:00:00Z' },
      { id: 'v2', company_id: 'co-1', creator_type: 'carousel', title: 'Deck', library: envelope('v2', 'Deck'), deleted_at: null, archived_at: '2026-07-10T00:00:00Z', updated_at: '2026-07-11T01:00:00Z' },
      { id: 'v3', company_id: 'co-1', creator_type: 'image', title: 'Dead', library: null, deleted_at: '2026-07-11T00:00:00Z', archived_at: null },
      { id: 'v4', company_id: 'co-OTHER', creator_type: 'image', title: 'Foreign', library: null, deleted_at: null, archived_at: null },
    ];
  });

  it('default view: company-scoped, excludes deleted AND archived', async () => {
    const records = await libraryListAssets({ companyId: 'co-1' });
    expect(records.map((r) => (r.envelope as { id: string }).id)).toEqual(['v1']);
    expect(records[0].serverMeta.usageCount).toBe(3);
  });

  it('include_archived surfaces archived assets (still never deleted ones)', async () => {
    const records = await libraryListAssets({ companyId: 'co-1', includeArchived: true });
    expect(records.map((r) => (r.envelope as { id: string }).id).sort()).toEqual(['v1', 'v2']);
  });

  it('type + title-search + tag filters compose', async () => {
    expect((await libraryListAssets({ companyId: 'co-1', creatorTypes: ['carousel'], includeArchived: true })).map((r) => (r.envelope as { id: string }).id)).toEqual(['v2']);
    expect((await libraryListAssets({ companyId: 'co-1', q: 'kpi' })).map((r) => (r.envelope as { id: string }).id)).toEqual(['v1']);
    expect((await libraryListAssets({ companyId: 'co-1', tags: ['KPI'] })).map((r) => (r.envelope as { id: string }).id)).toEqual(['v1']);
    expect(await libraryListAssets({ companyId: 'co-1', tags: ['nope'] })).toEqual([]);
  });
});

describe('server actions', () => {
  beforeEach(() => {
    tableRows = [{ id: 'a1', company_id: 'co-1', library: envelope('a1', 'X'), deleted_at: null, archived_at: null, usage_count: 1 }];
  });

  it('archive / unarchive toggle archived_at', async () => {
    expect(await archiveLibraryAsset({ companyId: 'co-1', assetId: 'a1', archived: true })).toBe(true);
    expect(tableRows[0].archived_at).toBeTruthy();
    expect(await archiveLibraryAsset({ companyId: 'co-1', assetId: 'a1', archived: false })).toBe(true);
    expect(tableRows[0].archived_at).toBeNull();
  });

  it('soft delete stamps deleted_at (row retained)', async () => {
    expect(await softDeleteLibraryAsset({ companyId: 'co-1', assetId: 'a1' })).toBe(true);
    expect(tableRows[0].deleted_at).toBeTruthy();
    expect(tableRows).toHaveLength(1);
  });

  it('usage tracking increments count + stamps last_used_at', async () => {
    await recordLibraryAssetUsage({ companyId: 'co-1', assetId: 'a1' });
    expect(tableRows[0].usage_count).toBe(2);
    expect(tableRows[0].last_used_at).toBeTruthy();
  });

  it('actions are company-scoped (foreign company is a no-op)', async () => {
    expect(await archiveLibraryAsset({ companyId: 'co-OTHER', assetId: 'a1', archived: true })).toBe(false);
    expect(tableRows[0].archived_at).toBeNull();
  });
});
