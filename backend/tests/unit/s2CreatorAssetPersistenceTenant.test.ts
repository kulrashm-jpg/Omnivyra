/**
 * S2 tenant seam (e1) - backend/services/creatorAssetPersistenceService.ts. creator_assets and
 * creator_asset_attachments are direct tenant tables (company_id). Every B row shares its id with an A row (B also
 * holds one id A does not). Tenant A must never read, update, archive, soft-delete, count usage on or delete B's
 * rows, and every insert / upsert A makes is stamped with A.
 */
jest.mock('../../db/writeOwner', () => require('../helpers/s2FaithfulFakeDb').writeOwnerModule());
const mockStorageRemove = jest.fn(async () => ({ data: null, error: null }));
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: () => { throw new Error('raw supabase.from must not be used'); },
    storage: { from: () => ({ remove: mockStorageRemove, createSignedUrl: async () => ({ data: null, error: null }) }) },
  },
}));
jest.mock('../../services/creatorAssetRendererContracts', () => ({ IMAGE_BUCKET: 'media-images', DOCUMENT_BUCKET: 'media-documents' }));
jest.mock('../../services/telemetry/telemetryDispatcher', () => ({ trackEvent: jest.fn() }));

import { db, writes, reads, resetDb } from '../helpers/s2FaithfulFakeDb';
import { tenantContextFor } from '../../db/tenantTable';
import {
  upsertCreatorAssetRecord,
  attachCreatorAsset,
  listCreatorAssetAttachments,
  listCreatorAssets,
  validatePersistedCreatorAsset,
  detectCreatorAssetStaleState,
  deleteCreatorAssetRecord,
  libraryWriteAsset,
  libraryReadAsset,
  libraryListAssets,
  libraryRemoveAsset,
  archiveLibraryAsset,
  softDeleteLibraryAsset,
  recordLibraryAssetUsage,
  LibraryAssetIdConflictError,
  LibraryVersionConflictError,
} from '../../services/creatorAssetPersistenceService';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const ASSETS = 'creator_assets';
const ATT = 'creator_asset_attachments';
const ctxA = tenantContextFor({ userId: 'user-a' }, A);

const asset = (id: string, company: string, extra: Record<string, unknown> = {}) => ({
  id, company_id: company, tenant_id: company, user_id: company === A ? 'user-a' : 'user-b',
  creator_type: 'image', title: `${company === A ? 'A' : 'B'} ${id}`, url: null, files: [],
  metadata: { companyId: company, persistenceCompletion: { status: 'partial' } },
  library: { id, currentVersion: 1, versions: [{ version: 1, payload: {} }] },
  usage_count: 0, deleted_at: null, archived_at: null, render_identity_hash: null,
  created_at: company === A ? '2026-01-01T00:00:00Z' : '2026-02-01T00:00:00Z',
  updated_at: company === A ? '2026-01-01T00:00:00Z' : '2026-02-01T00:00:00Z',
  ...extra,
});
const attachment = (id: string, company: string, assetId: string) => ({
  id, company_id: company, tenant_id: company, user_id: 'user-a', source_type: 'post', source_id: 'post-1',
  creator_asset_id: assetId, creator_type: 'image', title: 't', attachment_order: 0,
  created_at: company === A ? '2026-01-01T00:00:00Z' : '2026-02-01T00:00:00Z',
});

function seed() {
  resetDb({
    [ASSETS]: [
      asset('asset-1', A), asset('asset-2', A),
      // B: same ids (and B's user_id is deliberately 'user-a' on asset-2 so a user filter alone cannot separate them)
      asset('asset-1', B), asset('asset-2', B, { user_id: 'user-a' }), asset('asset-b-only', B),
    ],
    [ATT]: [
      attachment('att-1', A, 'asset-1'),
      attachment('att-1', B, 'asset-1'),
    ],
  }, { [ASSETS]: [['id']] });
  mockStorageRemove.mockClear();
}
const bState = () => JSON.stringify([db[ASSETS].filter((r) => r.company_id === B), db[ATT].filter((r) => r.company_id === B)]);
const allAOrNone = (rows: any[]) => rows.every((r) => r.company_id === A);

beforeEach(seed);

describe('creatorAssetPersistenceService reads under the tenant seam', () => {
  it('libraryReadAsset returns A\'s row for an id B also holds', async () => {
    const rec = await libraryReadAsset(ctxA, { assetId: 'asset-1' });
    expect(rec?.envelope).toMatchObject({ id: 'asset-1' });
    // (the schema-availability probe reads `select('id').limit(1)` with no filter and no data use; only by-id reads are asserted)
    const byId = reads.filter((r) => r.table === ASSETS && r.filters.some((f) => f.col === 'id'));
    expect(byId.length).toBeGreaterThan(0);
    expect(byId.every((r) => r.filters.some((f) => f.op === 'eq' && f.col === 'company_id' && f.value === A))).toBe(true);
  });

  it('libraryReadAsset of a B-only id is null for A', async () => {
    await expect(libraryReadAsset(ctxA, { assetId: 'asset-b-only' })).resolves.toBeNull();
  });

  it('listCreatorAssets / libraryListAssets list only A\'s rows', async () => {
    const rows = await listCreatorAssets(ctxA, { userId: 'user-a' });
    expect(rows).toHaveLength(2);
    expect(allAOrNone(rows)).toBe(true);
    const lib = await libraryListAssets(ctxA, {});
    expect(lib.map((r) => r.envelope.id).sort()).toEqual(['asset-1', 'asset-2']);
  });

  it('listCreatorAssetAttachments lists only A\'s attachments', async () => {
    const rows = await listCreatorAssetAttachments(ctxA, { userId: 'user-a', sourceType: 'post', sourceId: 'post-1' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ company_id: A });
  });

  it('validatePersistedCreatorAsset reads A\'s row (B\'s same id + same user is not a PGRST116 or a leak)', async () => {
    const res = await validatePersistedCreatorAsset(ctxA, { userId: 'user-a', assetId: 'asset-2' });
    expect(res.asset).toMatchObject({ id: 'asset-2', company_id: A });
  });

  it('detectCreatorAssetStaleState reports only A\'s candidates', async () => {
    const res = await detectCreatorAssetStaleState(ctxA, { userId: 'user-a' });
    expect(res.candidates.map((c) => c.id).sort()).toEqual(['asset-1', 'asset-2']);
  });
});

describe('creatorAssetPersistenceService writes under the tenant seam', () => {
  it('archiveLibraryAsset / softDeleteLibraryAsset / recordLibraryAssetUsage change only A\'s row', async () => {
    const before = bState();
    await expect(archiveLibraryAsset(ctxA, { assetId: 'asset-1', archived: true })).resolves.toBe(true);
    await expect(softDeleteLibraryAsset(ctxA, { assetId: 'asset-2' })).resolves.toBe(true);
    await recordLibraryAssetUsage(ctxA, { assetId: 'asset-1' });
    expect(bState()).toBe(before);
    const a1 = db[ASSETS].find((r) => r.id === 'asset-1' && r.company_id === A)!;
    expect(a1.archived_at).not.toBeNull();
    expect(a1.usage_count).toBe(1);
    for (const w of writes) {
      expect(w.filters).toContainEqual({ op: 'eq', col: 'company_id', value: A });
      expect(allAOrNone(w.affected)).toBe(true);
    }
  });

  it('archive / soft-delete / usage on a B-only id do nothing', async () => {
    const before = bState();
    await expect(archiveLibraryAsset(ctxA, { assetId: 'asset-b-only', archived: true })).resolves.toBe(false);
    await expect(softDeleteLibraryAsset(ctxA, { assetId: 'asset-b-only' })).resolves.toBe(false);
    await recordLibraryAssetUsage(ctxA, { assetId: 'asset-b-only' });
    expect(bState()).toBe(before);
  });

  it('deleteCreatorAssetRecord removes A\'s asset and A\'s attachments only', async () => {
    const before = bState();
    const res = await deleteCreatorAssetRecord(ctxA, { assetId: 'asset-1' });
    expect(res).toEqual({ deletedAsset: true, deletedAttachments: 1 });
    expect(bState()).toBe(before);
    expect(db[ASSETS].some((r) => r.id === 'asset-1' && r.company_id === A)).toBe(false);
    for (const w of writes.filter((x) => x.verb === 'delete')) {
      expect(w.filters).toContainEqual({ op: 'eq', col: 'company_id', value: A });
    }
  });

  it('deleteCreatorAssetRecord / libraryRemoveAsset of a B-only id delete nothing', async () => {
    const before = bState();
    await expect(deleteCreatorAssetRecord(ctxA, { assetId: 'asset-b-only' })).resolves.toEqual({ deletedAsset: false, deletedAttachments: 0 });
    await expect(libraryRemoveAsset(ctxA, { assetId: 'asset-b-only' })).resolves.toBe(false);
    expect(bState()).toBe(before);
  });

  it('the sharer scan after a delete reads A\'s rows only (B\'s reference does not keep A\'s object alive)', async () => {
    const url = `https://x.supabase.co/storage/v1/object/public/media-images/creator/${A}/c/u/obj-0123456789ab.png`;
    db[ASSETS].find((r) => r.id === 'asset-1' && r.company_id === A)!.url = url;
    db[ASSETS].find((r) => r.id === 'asset-1' && r.company_id === B)!.url = url;
    await deleteCreatorAssetRecord(ctxA, { assetId: 'asset-1' });
    expect(mockStorageRemove).toHaveBeenCalledWith([`creator/${A}/c/u/obj-0123456789ab.png`]);
  });

  it('libraryWriteAsset updates A\'s existing row in place; B\'s same-id row is untouched', async () => {
    const before = bState();
    const rec = await libraryWriteAsset(ctxA, { userId: 'user-a', envelope: { id: 'asset-1', currentVersion: 2, versions: [{ version: 1, payload: {} }, { version: 2, payload: { title: 'v2' } }] } });
    expect(rec.envelope).toMatchObject({ id: 'asset-1', currentVersion: 2 });
    expect(bState()).toBe(before);
    expect(writes.every((w) => w.filters.some((f) => f.col === 'company_id' && f.value === A))).toBe(true);
  });

  it('libraryWriteAsset CAS on A\'s row: B\'s row on the expected version does not satisfy it', async () => {
    const before = bState();
    db[ASSETS].find((r) => r.id === 'asset-1' && r.company_id === A)!.library.currentVersion = 5;
    await expect(libraryWriteAsset(ctxA, { userId: 'user-a', envelope: { id: 'asset-1', currentVersion: 2, versions: [] }, expectedCurrentVersion: 1 }))
      .rejects.toBeInstanceOf(LibraryVersionConflictError);
    expect(bState()).toBe(before);
  });

  it('libraryWriteAsset of an id only B holds is refused (insert 23505 -> not A\'s) and B\'s row is untouched', async () => {
    const before = bState();
    await expect(libraryWriteAsset(ctxA, { userId: 'user-a', envelope: { id: 'asset-b-only', currentVersion: 1, versions: [] } }))
      .rejects.toBeInstanceOf(LibraryAssetIdConflictError);
    expect(bState()).toBe(before);
    const ins = writes.filter((w) => w.verb === 'insert');
    expect(ins).toHaveLength(1);
    expect((ins[0].payload as any).company_id).toBe(A);
  });

  it('libraryWriteAsset of a new id inserts a row stamped with A', async () => {
    const rec = await libraryWriteAsset(ctxA, { userId: 'user-a', envelope: { id: 'asset-new', currentVersion: 1, versions: [] } });
    expect(rec.envelope).toMatchObject({ id: 'asset-new' });
    expect(db[ASSETS].filter((r) => r.id === 'asset-new').map((r) => r.company_id)).toEqual([A]);
  });

  it('upsertCreatorAssetRecord inserts a row stamped with A and touches nothing of B', async () => {
    const before = bState();
    const row = await upsertCreatorAssetRecord(ctxA, { userId: 'user-a', creatorType: 'image', title: 'new', url: null });
    expect(row).toMatchObject({ company_id: A });
    expect(bState()).toBe(before);
    expect(writes.filter((w) => w.verb === 'insert').every((w) => (w.payload as any).company_id === A)).toBe(true);
    expect(writes.filter((w) => w.verb === 'update').every((w) => w.filters.some((f) => f.col === 'company_id' && f.value === A))).toBe(true);
  });

  it('upsertCreatorAssetRecord when B holds the deterministic id re-homes under A and never touches B\'s row', async () => {
    // First write computes the deterministic id; move that row to B to simulate B holding it.
    const first = await upsertCreatorAssetRecord(ctxA, { userId: 'user-a', creatorType: 'image', title: 'collide', url: null });
    const det = String(first.id);
    db[ASSETS].find((r) => r.id === det)!.company_id = B;
    const before = bState();
    writes.length = 0;
    const second = await upsertCreatorAssetRecord(ctxA, { userId: 'user-a', creatorType: 'image', title: 'collide', url: null });
    expect(second.id).not.toBe(det);
    expect(second).toMatchObject({ company_id: A });
    expect((second.metadata as any).rehomedFrom).toBe(det);
    expect(bState()).toBe(before);
  });

  it('attachCreatorAsset upserts an attachment stamped with A (conflict key carries company_id); B\'s same-source attachment is untouched', async () => {
    const before = bState();
    const row = await attachCreatorAsset(ctxA, {
      userId: 'user-a', sourceType: 'post', sourceId: 'post-1', creatorAssetId: 'asset-1', creatorType: 'image', title: 'att',
    });
    expect(row).toMatchObject({ company_id: A, creator_asset_id: 'asset-1' });
    const ups = writes.filter((w) => w.verb === 'upsert');
    expect(ups).toHaveLength(1);
    expect((ups[0].payload as any).company_id).toBe(A);
    expect(bState()).toBe(before);
  });

  it('a caller-supplied tenantId naming B is ignored: tenant_id follows the context on the asset AND the attachment (e1 review)', async () => {
    const before = bState();
    await attachCreatorAsset(ctxA, {
      tenantId: B, userId: 'user-a', sourceType: 'post', sourceId: 'post-9', creatorAssetId: 'asset-9', creatorType: 'image', title: 't',
    });
    const stamped = writes.filter((w) => w.verb === 'insert' || w.verb === 'upsert').map((w) => [w.verb, (w.payload as any).tenant_id]);
    expect(stamped.length).toBeGreaterThanOrEqual(2);
    expect(stamped.every(([, t]) => t === A)).toBe(true);
    expect(bState()).toBe(before);
  });

  it('every exported writer refuses a missing context (fail closed) and writes nothing', async () => {
    await expect(libraryWriteAsset(undefined as never, { userId: 'u', envelope: { id: 'asset-1' } })).rejects.toThrow(/TENANT_CONTEXT_MISSING/);
    await expect(deleteCreatorAssetRecord(undefined as never, { assetId: 'asset-1' })).rejects.toThrow(/TENANT_CONTEXT_MISSING/);
    await expect(archiveLibraryAsset(undefined as never, { assetId: 'asset-1', archived: true })).rejects.toThrow(/TENANT_CONTEXT_MISSING/);
    expect(writes).toHaveLength(0);
  });
});
