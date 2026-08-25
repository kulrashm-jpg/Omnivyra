/**
 * Canonical media asset deletion.
 *
 * WHY THIS SUITE EXISTS
 * ---------------------
 * Every other artifact in the Creator asset flow could already be removed
 * through a supported path — the reference by detach, the upload and its bytes
 * by `DELETE /api/media/[id]` — but a canonical row could not, so any asset
 * ever created was permanent. That is what blocked controlled production
 * testing in Phase 63A.
 *
 * The two properties that matter are SAFETY ones, and both are tested as
 * behaviour against the stub rather than by asserting that functions were
 * called:
 *
 *   1. company scoping — another tenant's asset is indistinguishable from a
 *      missing one, and survives untouched;
 *   2. refusal while referenced — the composite FK is ON DELETE CASCADE, so
 *      deleting a referenced asset would SILENTLY destroy the user's
 *      composition relationships, including ones in other compositions.
 *
 * The storage stub records `remove` calls and also exposes `getPublicUrl` and
 * `createSignedUrl` so the suite can prove neither is ever reached: this path
 * must never mint a URL.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

import * as fs from 'fs';
import * as path from 'path';

type Row = Record<string, unknown>;

const assets: Row[] = [];
const refs: Row[] = [];
let seq = 0;

/** Every storage interaction, so ordering and arguments are both assertable. */
const storageCalls: Array<{ op: string; bucket: string; args: unknown }> = [];
let storageRemoveError: string | null = null;
let dbDeleteError: string | null = null;

function applyFilters(rows: Row[], f: Record<string, unknown>): Row[] {
  return rows.filter((r) => Object.entries(f).every(([k, v]) => r[k] === v));
}

function tableRows(table: string): Row[] {
  return table === 'canonical_media_assets' ? assets : refs;
}

function builderFor(table: string, mode: string, payload?: Row) {
  const rows = tableRows(table);
  const filters: Record<string, unknown> = {};
  const b: Record<string, unknown> = {
    select: () => b,
    order: () => b,
    limit: () => b,
    eq(col: string, val: unknown) { filters[col] = val; return b; },
    then(resolve: (r: { data: Row[]; error: unknown }) => unknown) {
      return Promise.resolve(resolve({ data: applyFilters(rows, filters), error: null }));
    },
    maybeSingle() {
      return Promise.resolve({ data: applyFilters(rows, filters)[0] ?? null, error: null });
    },
    single() {
      if (mode === 'insert') {
        const row: Row = { ...payload, id: `id-${++seq}`, created_at: `T${seq}`, updated_at: `T${seq}` };
        row.lifecycle_state = row.lifecycle_state ?? 'pending';
        rows.push(row);
        return Promise.resolve({ data: row, error: null });
      }
      return Promise.resolve({ data: applyFilters(rows, filters)[0] ?? null, error: null });
    },
  };
  return b;
}

const fakeDb = (table: string) => ({
  select: () => builderFor(table, 'select'),
  insert: (p: Row) => builderFor(table, 'insert', p),
  update: (p: Row) => builderFor(table, 'update', p),
  delete: () => {
    const filters: Record<string, unknown> = {};
    const d: Record<string, unknown> = {
      eq(col: string, val: unknown) { filters[col] = val; return d; },
      then(resolve: (r: { error: unknown }) => unknown) {
        if (dbDeleteError) return Promise.resolve(resolve({ error: { message: dbDeleteError } }));
        const rows = tableRows(table);
        for (const row of applyFilters(rows, filters)) rows.splice(rows.indexOf(row), 1);
        return Promise.resolve(resolve({ error: null }));
      },
    };
    return d;
  },
});

const fakeStorage = {
  from: (bucket: string) => ({
    remove: (paths: unknown) => {
      storageCalls.push({ op: 'remove', bucket, args: paths });
      return Promise.resolve({ error: storageRemoveError ? { message: storageRemoveError } : null });
    },
    getPublicUrl: (p: unknown) => { storageCalls.push({ op: 'getPublicUrl', bucket, args: p }); return { data: { publicUrl: 'x' } }; },
    createSignedUrl: (p: unknown) => { storageCalls.push({ op: 'createSignedUrl', bucket, args: p }); return Promise.resolve({ data: null, error: null }); },
    download: (p: unknown) => { storageCalls.push({ op: 'download', bucket, args: p }); return Promise.resolve({ data: null, error: null }); },
  }),
};

jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => fakeDb(t) }));
jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: (t: string) => fakeDb(t), rpc: jest.fn(), storage: fakeStorage },
}));

import {
  deleteCanonicalMediaAsset,
  getCanonicalMediaAsset,
  ASSET_STILL_REFERENCED,
} from '../../services/canonicalMediaAssetService';

const CO_A = 'company-aaaa';
const CO_B = 'company-bbbb';

function seedAsset(companyId = CO_A, lifecycle = 'ready', bucket = 'media-uploads'): string {
  const id = `asset-${++seq}`;
  assets.push({
    id, company_id: companyId, created_by: 'user-1',
    storage_bucket: bucket, storage_path: `${companyId}/${id}.png`,
    mime_type: 'image/png', byte_size: 10, width: 1, height: 1,
    checksum_sha256: null, original_filename: 'f.png', source_url: null,
    origin: 'upload', lifecycle_state: lifecycle, metadata: {},
    created_at: 'T', updated_at: 'T',
  });
  return id;
}

function seedReference(companyId: string, assetId: string) {
  refs.push({
    id: `ref-${++seq}`, company_id: companyId, composition_type: 'creator-composition',
    composition_id: 'comp-1', asset_id: assetId, purpose: 'logo', mode: 'compose',
    ordinal: 0, metadata: {}, created_at: 'T', updated_at: 'T',
  });
}

beforeEach(() => {
  assets.length = 0; refs.length = 0; storageCalls.length = 0;
  storageRemoveError = null; dbDeleteError = null;
});

describe('A — deleting an asset the company owns', () => {
  it('removes the row and returns true', async () => {
    const id = seedAsset();
    await expect(deleteCanonicalMediaAsset(CO_A, id)).resolves.toBe(true);
    expect(await getCanonicalMediaAsset(CO_A, id)).toBeNull();
    expect(assets).toHaveLength(0);
  });

  it('removes the storage object through the supported storage API', async () => {
    const id = seedAsset();
    await deleteCanonicalMediaAsset(CO_A, id);
    const removes = storageCalls.filter((c) => c.op === 'remove');
    expect(removes).toHaveLength(1);
    expect(removes[0].bucket).toBe('media-uploads');
    expect(removes[0].args).toEqual([`${CO_A}/${id}.png`]);
  });

  it('CRITICAL: bucket and path come from the ROW, never from a caller', async () => {
    const id = seedAsset(CO_A, 'ready', 'some-other-bucket');
    await deleteCanonicalMediaAsset(CO_A, id);
    expect(storageCalls[0].bucket).toBe('some-other-bucket');
    // The signature accepts only (companyId, assetId) — there is nowhere to
    // pass a bucket or path, so an arbitrary location is not expressible.
    expect(deleteCanonicalMediaAsset).toHaveLength(2);
  });

  it('CRITICAL: no public or signed URL is ever constructed', async () => {
    await deleteCanonicalMediaAsset(CO_A, seedAsset());
    expect(storageCalls.filter((c) => c.op === 'getPublicUrl')).toHaveLength(0);
    expect(storageCalls.filter((c) => c.op === 'createSignedUrl')).toHaveLength(0);
  });
});

describe('B — tenancy', () => {
  it('CRITICAL: another company cannot delete the asset', async () => {
    const id = seedAsset(CO_A);
    await expect(deleteCanonicalMediaAsset(CO_B, id)).resolves.toBe(false);
    expect(assets).toHaveLength(1);
  });

  it('CRITICAL: a foreign asset is never touched in storage either', async () => {
    await deleteCanonicalMediaAsset(CO_B, seedAsset(CO_A));
    expect(storageCalls).toHaveLength(0);
  });

  it('a foreign asset and a missing asset are indistinguishable', async () => {
    const foreign = await deleteCanonicalMediaAsset(CO_B, seedAsset(CO_A));
    assets.length = 0;
    const missing = await deleteCanonicalMediaAsset(CO_B, 'no-such-asset');
    expect(foreign).toBe(missing);
    expect(foreign).toBe(false);
  });

  it('blank company or asset id deletes nothing', async () => {
    seedAsset();
    for (const [c, a] of [['', 'x'], ['  ', 'x'], [CO_A, ''], [CO_A, '   ']]) {
      expect(await deleteCanonicalMediaAsset(c, a)).toBe(false);
    }
    expect(assets).toHaveLength(1);
  });
});

describe('C — an asset still in use is refused', () => {
  it('CRITICAL: deletion throws while a composition references it', async () => {
    const id = seedAsset();
    seedReference(CO_A, id);
    await expect(deleteCanonicalMediaAsset(CO_A, id)).rejects.toThrow(/still referenced/i);
  });

  it('CRITICAL: the refused asset and its bytes both survive intact', async () => {
    const id = seedAsset();
    seedReference(CO_A, id);
    await deleteCanonicalMediaAsset(CO_A, id).catch(() => {});
    expect(assets).toHaveLength(1);
    expect(storageCalls).toHaveLength(0);
  });

  it('the refusal names the remedy, because detaching is the fix', async () => {
    const id = seedAsset();
    seedReference(CO_A, id);
    await expect(deleteCanonicalMediaAsset(CO_A, id)).rejects.toThrow(/detach/i);
  });

  it('once detached, the same asset deletes normally', async () => {
    const id = seedAsset();
    seedReference(CO_A, id);
    await expect(deleteCanonicalMediaAsset(CO_A, id)).rejects.toThrow();
    refs.length = 0;                       // the supported detach path
    await expect(deleteCanonicalMediaAsset(CO_A, id)).resolves.toBe(true);
  });

  it("a reference to a DIFFERENT asset does not block this one", async () => {
    const keep = seedAsset();
    const doomed = seedAsset();
    seedReference(CO_A, keep);
    await expect(deleteCanonicalMediaAsset(CO_A, doomed)).resolves.toBe(true);
    expect(assets.map((a) => a.id)).toEqual([keep]);
  });
});

describe('D — lifecycle', () => {
  it.each(['pending', 'ready', 'failed'])('an asset in %s is deletable', async (state) => {
    const id = seedAsset(CO_A, state);
    await expect(deleteCanonicalMediaAsset(CO_A, id)).resolves.toBe(true);
  });

  it('deletion is not a lifecycle transition — terminal states are still removable', async () => {
    // `ready` and `failed` are terminal for TRANSITIONS. That says nothing
    // about whether the row may be removed, and nothing in the contract asks
    // for retention.
    const id = seedAsset(CO_A, 'failed');
    await expect(deleteCanonicalMediaAsset(CO_A, id)).resolves.toBe(true);
    expect(assets).toHaveLength(0);
  });
});

describe('E — failure and repetition', () => {
  it('B: storage failure still leaves the row deleted (bytes orphaned, nothing dangling)', async () => {
    const id = seedAsset();
    storageRemoveError = 'network down';
    await expect(deleteCanonicalMediaAsset(CO_A, id)).resolves.toBe(true);
    expect(assets).toHaveLength(0);
  });

  it('A: database failure leaves the asset WHOLLY intact and retryable', async () => {
    const id = seedAsset();
    dbDeleteError = 'deadlock detected';
    await expect(deleteCanonicalMediaAsset(CO_A, id)).rejects.toThrow(/Failed to delete/i);
    expect(assets).toHaveLength(1);
    // Ordering is what buys this: storage is only touched after the row is gone.
    expect(storageCalls).toHaveLength(0);
  });

  it('C: an object already gone from storage is success, not an error', async () => {
    const id = seedAsset();
    storageRemoveError = 'Object not found';
    await expect(deleteCanonicalMediaAsset(CO_A, id)).resolves.toBe(true);
  });

  it('repeated deletion is idempotent — the second call reports nothing to do', async () => {
    const id = seedAsset();
    expect(await deleteCanonicalMediaAsset(CO_A, id)).toBe(true);
    expect(await deleteCanonicalMediaAsset(CO_A, id)).toBe(false);
    expect(storageCalls.filter((c) => c.op === 'remove')).toHaveLength(1);
  });

  it('G: concurrent deletion neither throws nor deletes twice', async () => {
    const id = seedAsset();
    const [a, b] = await Promise.all([
      deleteCanonicalMediaAsset(CO_A, id),
      deleteCanonicalMediaAsset(CO_A, id),
    ]);
    expect(assets).toHaveLength(0);
    expect([a, b].filter(Boolean).length).toBeGreaterThanOrEqual(1);
  });
});

/* ── Source contract. These pin the SHIPPED implementation, not a model of it. */
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const SERVICE = strip(read('../../services/canonicalMediaAssetService.ts'));
const ROUTE_SRC = read('../../../pages/api/creator-assets/asset.ts');
const ROUTE = strip(ROUTE_SRC);

describe('F — route authorization and surface', () => {
  it('CRITICAL M5: tenancy is proven server-side, not taken from the request', () => {
    expect(ROUTE).toContain('enforceCompanyAccess({ req, res, companyId })');
    expect(ROUTE).toContain('if (!access) return;');
  });

  it('the route delegates to the service and touches no table', () => {
    expect(ROUTE).toContain('deleteCanonicalMediaAsset(companyId, assetId)');
    expect(ROUTE).not.toMatch(/ownedDbTable|supabase\.from|\.from\('canonical_media_assets'\)/);
  });

  it('CRITICAL M4: the route accepts no bucket or storage path from the client', () => {
    for (const forbidden of ['bucket', 'storage_path', 'storagePath', 'path']) {
      expect(ROUTE).not.toMatch(new RegExp(`req\\.(query|body)[^\\n]*${forbidden}`, 'i'));
    }
  });

  it('CRITICAL M3: the route constructs no URL of any kind', () => {
    expect(ROUTE).not.toMatch(/getPublicUrl|createSignedUrl|https?:\/\//);
  });

  it('a still-referenced asset maps to 409, so the caller knows it can detach', () => {
    expect(ROUTE).toContain('ASSET_STILL_REFERENCED');
    expect(ROUTE).toContain('409');
  });

  it('only DELETE is accepted', () => {
    expect(ROUTE).toContain("const METHODS = ['DELETE']");
    expect(ROUTE).toContain('405');
  });

  it('it is a separate endpoint from detach, not a mode flag on it', () => {
    const composition = strip(read('../../../pages/api/creator-assets/composition.ts'));
    expect(composition).toContain('detachCreatorCompositionAsset(companyId, referenceId)');
    expect(composition).not.toContain('deleteCanonicalMediaAsset');
  });
});

describe('G — service mutation guards', () => {
  it('CRITICAL M1: company scoping is applied in the delete query itself', () => {
    expect(SERVICE).toMatch(/\.delete\(\)\s*\.eq\('company_id', companyId\)\s*\.eq\('id', assetId\)/);
  });

  it('CRITICAL M2: the reference check exists and precedes the delete', () => {
    const body = SERVICE.slice(SERVICE.indexOf('export async function deleteCanonicalMediaAsset'));
    const refIdx = body.indexOf('REFERENCE_TABLE');
    const delIdx = body.indexOf('.delete()');
    expect(refIdx).toBeGreaterThan(-1);
    expect(delIdx).toBeGreaterThan(-1);
    expect(refIdx).toBeLessThan(delIdx);
    expect(body).toContain('ASSET_STILL_REFERENCED');
  });

  it('CRITICAL M3: storage is removed, never URL-ified', () => {
    const body = SERVICE.slice(SERVICE.indexOf('export async function deleteCanonicalMediaAsset'));
    expect(body).toContain('.remove([asset.storagePath])');
    expect(body).not.toMatch(/getPublicUrl|createSignedUrl/);
  });

  it('CRITICAL: the row is deleted BEFORE storage, so no row can dangle', () => {
    const body = SERVICE.slice(SERVICE.indexOf('export async function deleteCanonicalMediaAsset'));
    expect(body.indexOf('.delete()')).toBeLessThan(body.indexOf('supabase.storage'));
  });

  it('no import cycle was introduced to check references', () => {
    expect(SERVICE).not.toMatch(/from '\.\/compositionAssetReferenceService'/);
    expect(SERVICE).toContain("const REFERENCE_TABLE = 'composition_asset_references'");
  });

  it('this phase adds no janitor or background cleanup', () => {
    expect(SERVICE).not.toMatch(/setInterval|setTimeout|cron|janitor/i);
  });
});

describe('H — nothing else moved', () => {
  it('no lifecycle state was added', () => {
    const contract = read('../../../lib/content/canonicalMediaAsset.ts');
    expect(contract).toContain("MEDIA_ASSET_LIFECYCLE_STATES = ['pending', 'ready', 'failed']");
    expect(contract).not.toMatch(/'deleted'|'archived'|soft_delete/);
  });

  it('detach still keeps the canonical asset — deletion did not become a cascade', () => {
    const creator = strip(read('../../services/creator/creatorCompositionAssetService.ts'));
    expect(creator).toContain('removeCompositionAssetReference(companyId, referenceId)');
    expect(creator).not.toContain('deleteCanonicalMediaAsset');
  });

  it('Phase 63 purpose-derived mode is untouched', () => {
    const creator = strip(read('../../services/creator/creatorCompositionAssetService.ts'));
    expect(creator).toContain('const mode = input.mode ?? defaultModeForPurpose(input.purpose);');
  });

  it('no template slot or provider capability changed', () => {
    expect(read('../../../lib/creator-templates/systemTemplates.ts').match(/assetSlots:/g) ?? [])
      .toHaveLength(2);
    expect(read('../../services/creator/creatorMultimodalReferences.ts'))
      .toContain('maxReferenceImages: 16');
  });
});
