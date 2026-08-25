/**
 * Deleting a creator asset must remove its rendered object.
 *
 * WHY THIS SUITE EXISTS
 * ---------------------
 * `deleteCreatorAssetRecord` removed the row and its attachments and left the
 * rendered image in storage forever. Nothing swept it: the janitor scans
 * `media-uploads`, renders live in `media-images`/`media-documents`, and it is
 * dormant regardless. So every user who deleted a generated image left its
 * bytes behind permanently — unbounded growth in a bucket nothing watches.
 *
 * THE TWO PROPERTIES THAT MATTER
 * ------------------------------
 *  1. the object is actually removed, from the AUTHORIZED row's own url;
 *  2. nothing else can ever be removed — not another bucket, not another
 *     company's namespace, not a path a caller supplied, and not an object a
 *     second creator asset still points at.
 *
 * The second is why this is tested as behaviour against a storage stub that
 * records every call, rather than by asserting that a function was invoked.
 */

jest.mock('@/config', () => {
  const CFG = { REDIS_URL: 'redis://127.0.0.1:6379' };
  return { config: CFG, getValidatedConfig: () => CFG };
});

import * as fs from 'fs';
import * as path from 'path';

type Row = Record<string, unknown>;

const assets: Row[] = [];
const attachments: Row[] = [];
/** Every storage interaction, so arguments AND ordering are assertable. */
const storageCalls: Array<{ op: string; bucket: string; args: unknown; rowsAtCall: number }> = [];
let storageRemoveError: string | null = null;
let deleteError: string | null = null;

const CO = 'company-aaaa';
const OTHER_CO = 'company-bbbb';
const RENDER = (co = CO, digest = 'abc123abc123') =>
  `creator/${co}/campaign-1/user-1/banner-${digest}.png`;
const signedUrl = (bucket: string, p: string) =>
  `https://ref.supabase.co/storage/v1/object/sign/${bucket}/${p}?token=xyz`;
const publicUrl = (bucket: string, p: string) =>
  `https://ref.supabase.co/storage/v1/object/public/${bucket}/${p}`;

function tableRows(t: string): Row[] {
  return t === 'creator_assets' ? assets : attachments;
}

function builder(table: string) {
  const rows = tableRows(table);
  const filters: Record<string, unknown> = {};
  let likeCol: string | null = null;
  let likeVal = '';
  const b: Record<string, unknown> = {
    select: () => b,
    limit: () => b,
    eq(c: string, v: unknown) { filters[c] = v; return b; },
    ilike(c: string, v: string) { likeCol = c; likeVal = v.replace(/%/g, ''); return b; },
    then(resolve: (r: { data: Row[]; error: unknown }) => unknown) {
      let out = rows.filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
      if (likeCol) out = out.filter((r) => String(r[likeCol!] ?? '').includes(likeVal));
      return Promise.resolve(resolve({ data: out, error: null }));
    },
    delete() {
      const d: Record<string, unknown> = {
        eq(c: string, v: unknown) { filters[c] = v; return d; },
        select() {
          if (deleteError && table === 'creator_assets') {
            return Promise.resolve({ data: null, error: { message: deleteError } });
          }
          const doomed = rows.filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
          for (const x of doomed) rows.splice(rows.indexOf(x), 1);
          return Promise.resolve({ data: doomed.map((x) => ({ ...x })), error: null });
        },
      };
      return d;
    },
  };
  return b;
}

const fakeStorage = {
  from: (bucket: string) => ({
    remove: (paths: unknown) => {
      storageCalls.push({ op: 'remove', bucket, args: paths, rowsAtCall: assets.length });
      return Promise.resolve({ error: storageRemoveError ? { message: storageRemoveError } : null });
    },
    createSignedUrl: (p: unknown) => {
      storageCalls.push({ op: 'createSignedUrl', bucket, args: p, rowsAtCall: assets.length });
      return Promise.resolve({ data: { signedUrl: 'x' }, error: null });
    },
    getPublicUrl: (p: unknown) => {
      storageCalls.push({ op: 'getPublicUrl', bucket, args: p, rowsAtCall: assets.length });
      return { data: { publicUrl: 'x' } };
    },
  }),
};

jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => builder(t) }));
jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: (t: string) => builder(t), rpc: jest.fn(), storage: fakeStorage },
}));
// Availability probe is a DB round-trip the stub above satisfies; keep it green.
jest.mock('../../services/telemetry/telemetryDispatcher', () => ({ trackEvent: jest.fn() }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { deleteCreatorAssetRecord } = require('../../services/creatorAssetPersistenceService');

function seedAsset(opts: { id?: string; companyId?: string; url?: string | null } = {}) {
  const id = opts.id ?? `asset-${assets.length + 1}`;
  assets.push({
    id,
    company_id: opts.companyId ?? CO,
    url: opts.url === undefined ? signedUrl('media-images', RENDER()) : opts.url,
  });
  return id;
}
const removes = () => storageCalls.filter((c) => c.op === 'remove');

beforeEach(() => {
  assets.length = 0; attachments.length = 0; storageCalls.length = 0;
  storageRemoveError = null; deleteError = null;
});

describe('A — the rendered object is removed', () => {
  it('CRITICAL: deleting a creator asset removes its rendered object', async () => {
    const id = seedAsset();
    const r = await deleteCreatorAssetRecord({ assetId: id, companyId: CO });
    expect(r.deletedAsset).toBe(true);
    expect(removes()).toHaveLength(1);
    expect(removes()[0].bucket).toBe('media-images');
    expect(removes()[0].args).toEqual([RENDER()]);
  });

  it('works for a public url as well as a signed one', async () => {
    const id = seedAsset({ url: publicUrl('media-images', RENDER()) });
    await deleteCreatorAssetRecord({ assetId: id, companyId: CO });
    expect(removes()[0].args).toEqual([RENDER()]);
  });

  it('works for a PDF render in the document bucket', async () => {
    const p = `creator/${CO}/campaign-1/user-1/doc-abc123abc123.pdf`;
    const id = seedAsset({ url: signedUrl('media-documents', p) });
    await deleteCreatorAssetRecord({ assetId: id, companyId: CO });
    expect(removes()[0].bucket).toBe('media-documents');
    expect(removes()[0].args).toEqual([p]);
  });

  it('CRITICAL: the row is deleted BEFORE the object', async () => {
    // Ordering is the whole safety argument: orphaned bytes are a cost, a row
    // pointing at missing bytes is a defect.
    const id = seedAsset();
    await deleteCreatorAssetRecord({ assetId: id, companyId: CO });
    expect(removes()[0].rowsAtCall).toBe(0);   // row already gone when storage ran
  });

  it('never mints a URL while deleting', async () => {
    await deleteCreatorAssetRecord({ assetId: seedAsset(), companyId: CO });
    expect(storageCalls.filter((c) => c.op !== 'remove')).toHaveLength(0);
  });
});

describe('B — nothing else can ever be removed', () => {
  it('CRITICAL: a foreign company cannot delete the asset, and touches no object', async () => {
    const id = seedAsset({ companyId: CO });
    const r = await deleteCreatorAssetRecord({ assetId: id, companyId: OTHER_CO });
    expect(r.deletedAsset).toBe(false);
    expect(assets).toHaveLength(1);
    expect(storageCalls).toHaveLength(0);
  });

  it("CRITICAL: a url naming ANOTHER company's namespace is refused", async () => {
    const id = seedAsset({ url: signedUrl('media-images', RENDER(OTHER_CO)) });
    await deleteCreatorAssetRecord({ assetId: id, companyId: CO });
    expect(removes()).toHaveLength(0);
  });

  it('CRITICAL: a non-render bucket is refused', async () => {
    for (const bucket of ['media-uploads', 'secrets', 'avatars']) {
      assets.length = 0; storageCalls.length = 0;
      const id = seedAsset({ url: signedUrl(bucket, RENDER()) });
      await deleteCreatorAssetRecord({ assetId: id, companyId: CO });
      expect(removes()).toHaveLength(0);
    }
  });

  it('CRITICAL: a path outside the creator namespace is refused', async () => {
    const id = seedAsset({ url: signedUrl('media-images', `${CO}/not-a-render.png`) });
    await deleteCreatorAssetRecord({ assetId: id, companyId: CO });
    expect(removes()).toHaveLength(0);
  });

  it('CRITICAL: traversal is refused', async () => {
    const id = seedAsset({ url: signedUrl('media-images', `creator/${CO}/../../other/x.png`) });
    await deleteCreatorAssetRecord({ assetId: id, companyId: CO });
    expect(removes()).toHaveLength(0);
  });

  it('a malformed or non-storage url causes no deletion', async () => {
    for (const u of ['not a url', 'https://evil.example.com/x.png', 'https://ref.supabase.co/other/path']) {
      assets.length = 0; storageCalls.length = 0;
      const id = seedAsset({ url: u });
      await deleteCreatorAssetRecord({ assetId: id, companyId: CO });
      expect(removes()).toHaveLength(0);
    }
  });

  it('a null or empty url is a no-op, not an error', async () => {
    for (const u of [null, '', '   ']) {
      assets.length = 0; storageCalls.length = 0;
      const id = seedAsset({ url: u });
      const r = await deleteCreatorAssetRecord({ assetId: id, companyId: CO });
      expect(r.deletedAsset).toBe(true);
      expect(removes()).toHaveLength(0);
    }
  });

  it('CRITICAL: the caller supplies no bucket or path — the signature has nowhere for one', async () => {
    // Location comes only from the deleted row.
    expect(deleteCreatorAssetRecord).toHaveLength(1);
    const id = seedAsset();
    await deleteCreatorAssetRecord({
      assetId: id, companyId: CO,
      bucket: 'secrets', path: 'creator/x/y/z.png', url: signedUrl('secrets', 'a/b.png'),
    } as never);
    expect(removes()[0].bucket).toBe('media-images');
    expect(removes()[0].args).toEqual([RENDER()]);
  });
});

describe('C — a shared object is never pulled from under another row', () => {
  it('CRITICAL: an object another creator asset still references is left alone', async () => {
    // The key ends in a sha1 of the bytes, so byte-identical renders for the
    // same company/campaign/user collide on ONE path.
    const shared = signedUrl('media-images', RENDER());
    const doomed = seedAsset({ url: shared });
    seedAsset({ id: 'sibling', url: shared });
    await deleteCreatorAssetRecord({ assetId: doomed, companyId: CO });
    expect(removes()).toHaveLength(0);
    expect(assets.map((a) => a.id)).toEqual(['sibling']);
  });

  it('once the last referencing row goes, the object is removed', async () => {
    const shared = signedUrl('media-images', RENDER());
    const a = seedAsset({ url: shared });
    const b = seedAsset({ id: 'sibling', url: shared });
    await deleteCreatorAssetRecord({ assetId: a, companyId: CO });
    expect(removes()).toHaveLength(0);
    await deleteCreatorAssetRecord({ assetId: b, companyId: CO });
    expect(removes()).toHaveLength(1);
  });

  it('a DIFFERENT object does not block this one', async () => {
    const doomed = seedAsset();
    seedAsset({ id: 'other', url: signedUrl('media-images', RENDER(CO, 'ffffffffffff')) });
    await deleteCreatorAssetRecord({ assetId: doomed, companyId: CO });
    expect(removes()).toHaveLength(1);
  });
});

describe('D — failure semantics match the sibling deletions', () => {
  it('storage failure still reports success — the row deletion is committed', async () => {
    storageRemoveError = 'network down';
    const id = seedAsset();
    const r = await deleteCreatorAssetRecord({ assetId: id, companyId: CO });
    expect(r.deletedAsset).toBe(true);
    expect(assets).toHaveLength(0);
  });

  it('an object already gone is success, not an error', async () => {
    storageRemoveError = 'Object not found';
    const r = await deleteCreatorAssetRecord({ assetId: seedAsset(), companyId: CO });
    expect(r.deletedAsset).toBe(true);
  });

  it('a database failure throws and touches no storage', async () => {
    deleteError = 'deadlock detected';
    await expect(deleteCreatorAssetRecord({ assetId: seedAsset(), companyId: CO }))
      .rejects.toThrow(/Failed to delete creator asset/i);
    expect(storageCalls).toHaveLength(0);
  });

  it('attachment deletion still runs', async () => {
    const id = seedAsset();
    attachments.push({ id: 'at-1', company_id: CO, creator_asset_id: id });
    const r = await deleteCreatorAssetRecord({ assetId: id, companyId: CO });
    expect(r.deletedAttachments).toBe(1);
    expect(attachments).toHaveLength(0);
  });
});

/* ── Source contract: pins the SHIPPED implementation ─────────────────────── */
const realFs = jest.requireActual('fs') as typeof fs;
const read = (p: string) => realFs.readFileSync(path.resolve(__dirname, p), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const SVC = strip(read('../../services/creatorAssetPersistenceService.ts'));

describe('E — mutation guards on the shipped code', () => {
  it('M1: rendered-object deletion is invoked from the delete path', () => {
    expect(SVC).toContain('await removeRenderedObjectsForDeletedAsset(');
    expect(SVC).toContain('.remove([path])');
  });

  it('M2: the DB delete precedes the storage call in source order', () => {
    expect(SVC.indexOf("ownedDbTable('creator_assets')\n    .delete()"))
      .toBeLessThan(SVC.indexOf('await removeRenderedObjectsForDeletedAsset('));
  });

  it('M3/M9: the location is parsed from the row by the EXISTING parser', () => {
    expect(SVC).toContain('parseStorageReference(url)');
    // Phase 78 widened this projection: `url` alone orphaned every slide of a
    // carousel but the first, plus its PDF.
    expect(SVC).toContain("    .select('id, url, files, metadata');");
    // Exactly one parser in the file — no duplicate.
    expect((SVC.match(/function parseStorageReference/g) ?? [])).toHaveLength(1);
  });

  it('M4: bucket validation is present and closed', () => {
    expect(SVC).toContain('RENDER_BUCKETS.has(bucket)');
    expect(SVC).toContain('new Set([IMAGE_BUCKET, DOCUMENT_BUCKET])');
  });

  it('M5: company scoping guards both the row and the namespace', () => {
    expect(SVC).toContain("eq('company_id', input.companyId)");
    expect(SVC).toContain('path.startsWith(`${RENDER_NAMESPACE}${companyId}/`)');
  });

  it('M6/M7: no guessed path, and traversal is rejected', () => {
    expect(SVC).not.toMatch(/remove\(\[`creator\//);
    expect(SVC).toContain("seg === '..'");
  });

  it('M8: canonical assets and composition references are NOT touched', () => {
    expect(SVC).not.toContain('canonical_media_assets');
    expect(SVC).not.toContain('composition_asset_references');
    expect(SVC).not.toContain('deleteCanonicalMediaAsset');
  });

  it('M10: storage failure is handled, not suppressed into silence', () => {
    expect(SVC).toContain('rendered-object-skipped');
    expect(SVC).toContain('storage remove failed');
  });

  it('no public or signed URL is minted on the delete path', () => {
    const body = SVC.slice(SVC.indexOf('async function removeRenderedObjectForDeletedAsset'));
    expect(body).not.toContain('getPublicUrl');
    expect(body).not.toContain('createSignedUrl');
  });
});

describe('F — unrelated behaviour is unchanged', () => {
  it('CONDITION and COMPOSE routing are untouched by this file', () => {
    expect(SVC).not.toMatch(/images\.edit|conditionPlan|composePlan|gpt-image/);
  });

  it('canonical asset deletion still refuses a referenced asset', () => {
    const canonical = strip(read('../../services/canonicalMediaAssetService.ts'));
    expect(canonical).toContain('ASSET_STILL_REFERENCED');
    expect(canonical).toMatch(/\.delete\(\)\s*\.eq\('company_id', companyId\)\s*\.eq\('id', assetId\)/);
  });

  it('media ownership remains server-authoritative', () => {
    expect(strip(read('../../../pages/api/media/upload.ts'))).toContain('const userId = user.id;');
  });
});
