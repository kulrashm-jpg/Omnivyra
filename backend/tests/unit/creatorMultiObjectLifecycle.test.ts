/**
 * A creator asset can own MORE than one rendered object.
 *
 * WHY THIS SUITE EXISTS
 * ---------------------
 * Phase 74 made deletion remove a creator asset's rendered object — reading
 * `url`. That is the whole story for an image, a banner or an infographic.
 *
 * It is not the story for a carousel. `creatorAssetRendererCarousel` returns
 * `url: files[0]`, `files` (every slide) and `metadata.document_url` (the PDF),
 * so deleting one left N-1 slides and the document in storage permanently —
 * the same defect Phase 74 set out to fix, surviving in the shape nobody tested.
 *
 * Phase 74's own suite seeded a single-`url` asset in every case: it had ZERO
 * mentions of `files` or `document_url`. The untested shape was the broken one.
 * That is the pattern this programme has now hit three times, so these tests
 * drive the REAL function against a realistic carousel row.
 */

const CFG = { REDIS_URL: 'redis://127.0.0.1:6379' };
jest.mock('@/config', () => ({ config: CFG, getValidatedConfig: () => CFG }));

import * as fs from 'fs';
import * as path from 'path';

type Row = Record<string, unknown>;

const assets: Row[] = [];
const attachments: Row[] = [];
const storageCalls: Array<{ op: string; bucket: string; args: unknown; rowsAtCall: number }> = [];
let storageRemoveError: string | null = null;
let storageRemoveThrowFor: string | null = null;
let deleteError: string | null = null;

const CO = 'company-aaaa';
const OTHER_CO = 'company-bbbb';

const slidePath = (n: number, co = CO) => `creator/${co}/campaign-1/user-1/slider-${`${n}`.repeat(12)}.png`;
const pdfPath = (co = CO) => `creator/${co}/campaign-1/user-1/pdf-abcdefabcdef.pdf`;
const signed = (bucket: string, p: string) =>
  `https://ref.supabase.co/storage/v1/object/sign/${bucket}/${p}?token=t${Math.floor(p.length)}`;
const publicUrl = (bucket: string, p: string) =>
  `https://ref.supabase.co/storage/v1/object/public/${bucket}/${p}`;

function tableRows(t: string): Row[] {
  return t === 'creator_assets' ? assets : attachments;
}

function builder(table: string) {
  const rows = tableRows(table);
  const filters: Record<string, unknown> = {};
  const b: Record<string, unknown> = {
    select: () => b,
    limit: () => b,
    eq(c: string, v: unknown) { filters[c] = v; return b; },
    ilike() { return b; },
    then(resolve: (r: { data: Row[]; error: unknown }) => unknown) {
      const out = rows.filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
      return Promise.resolve(resolve({ data: out.map((r) => ({ ...r })), error: null }));
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
      const first = Array.isArray(paths) ? String(paths[0]) : '';
      storageCalls.push({ op: 'remove', bucket, args: paths, rowsAtCall: assets.length });
      if (storageRemoveThrowFor && first.includes(storageRemoveThrowFor)) {
        return Promise.reject(new Error('storage exploded'));
      }
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
jest.mock('../../services/telemetry/telemetryDispatcher', () => ({ trackEvent: jest.fn() }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { deleteCreatorAssetRecord } = require('../../services/creatorAssetPersistenceService');

function seed(opts: {
  id?: string; companyId?: string;
  url?: string | null; files?: unknown; metadata?: unknown;
} = {}) {
  const id = opts.id ?? `asset-${assets.length + 1}`;
  assets.push({
    id,
    company_id: opts.companyId ?? CO,
    url: opts.url ?? null,
    files: opts.files ?? [],
    metadata: opts.metadata ?? {},
  });
  return id;
}

/** A realistic carousel: url === files[0], three slides, plus a PDF. */
function seedCarousel(opts: { id?: string; companyId?: string } = {}) {
  const co = opts.companyId ?? CO;
  const slides = [slidePath(1, co), slidePath(2, co), slidePath(3, co)];
  return seed({
    id: opts.id, companyId: co,
    url: signed('media-images', slides[0]),
    files: slides.map((p) => signed('media-images', p)),
    metadata: { document_url: signed('media-documents', pdfPath(co)) },
  });
}

const removes = () => storageCalls.filter((c) => c.op === 'remove');
const removedPaths = () => removes().map((c) => (c.args as string[])[0]).sort();

beforeEach(() => {
  assets.length = 0; attachments.length = 0; storageCalls.length = 0;
  storageRemoveError = null; storageRemoveThrowFor = null; deleteError = null;
});

describe('M1 — every object a carousel owns is removed', () => {
  it('CRITICAL: three slides AND the PDF are deleted', async () => {
    const id = seedCarousel();
    const r = await deleteCreatorAssetRecord({ assetId: id, companyId: CO });
    expect(r.deletedAsset).toBe(true);
    expect(removedPaths()).toEqual([pdfPath(), slidePath(1), slidePath(2), slidePath(3)].sort());
  });

  it('exactly four removals — url duplicates files[0] and must not double', async () => {
    await deleteCreatorAssetRecord({ assetId: seedCarousel(), companyId: CO });
    expect(removes()).toHaveLength(4);
  });

  it('the PDF is removed from the document bucket, slides from the image bucket', async () => {
    await deleteCreatorAssetRecord({ assetId: seedCarousel(), companyId: CO });
    const byBucket = removes().reduce<Record<string, number>>((a, c) => {
      a[c.bucket] = (a[c.bucket] ?? 0) + 1; return a;
    }, {});
    expect(byBucket['media-images']).toBe(3);
    expect(byBucket['media-documents']).toBe(1);
  });

  it('CRITICAL: the row is gone before any object is touched', async () => {
    await deleteCreatorAssetRecord({ assetId: seedCarousel(), companyId: CO });
    for (const c of removes()) expect(c.rowsAtCall).toBe(0);
  });
});

describe('M2 — duplicates are removed at most once', () => {
  it('CRITICAL: a path repeated across url, files and document_url deletes once', async () => {
    const p1 = slidePath(1);
    const p2 = slidePath(2);
    const id = seed({
      url: signed('media-images', p1),
      files: [signed('media-images', p1), signed('media-images', p2), publicUrl('media-images', p2)],
      metadata: { document_url: signed('media-images', p2) },
    });
    await deleteCreatorAssetRecord({ assetId: id, companyId: CO });
    expect(removedPaths()).toEqual([p1, p2].sort());
    expect(removes()).toHaveLength(2);
  });

  it('dedup is by bucket+path, not by URL string (signed URLs differ by token)', async () => {
    const p = slidePath(1);
    const id = seed({
      url: `${signed('media-images', p)}&v=1`,
      files: [`${signed('media-images', p)}&v=2`],
    });
    await deleteCreatorAssetRecord({ assetId: id, companyId: CO });
    expect(removes()).toHaveLength(1);
  });
});

describe('M3 — shared objects are protected, per object', () => {
  it('CRITICAL: a shared slide is retained while its siblings and the PDF go', async () => {
    const doomed = seedCarousel();
    // Another asset legitimately shares slide 2 (byte-identical render).
    seed({ id: 'sibling', files: [signed('media-images', slidePath(2))] });
    await deleteCreatorAssetRecord({ assetId: doomed, companyId: CO });
    expect(removedPaths()).toEqual([pdfPath(), slidePath(1), slidePath(3)].sort());
    expect(removedPaths()).not.toContain(slidePath(2));
  });

  it('sharing is detected in files[] and metadata, not just url', async () => {
    // A sharer referencing the PDF only through metadata.document_url.
    const doomed = seedCarousel();
    seed({ id: 'sibling', metadata: { document_url: signed('media-documents', pdfPath()) } });
    await deleteCreatorAssetRecord({ assetId: doomed, companyId: CO });
    expect(removedPaths()).not.toContain(pdfPath());
    expect(removedPaths()).toEqual([slidePath(1), slidePath(2), slidePath(3)].sort());
  });

  it('once the last owner goes, everything is removed', async () => {
    const a = seedCarousel();
    const b = seedCarousel({ id: 'twin' });
    await deleteCreatorAssetRecord({ assetId: a, companyId: CO });
    expect(removes()).toHaveLength(0);           // twin still owns all four
    storageCalls.length = 0;
    await deleteCreatorAssetRecord({ assetId: b, companyId: CO });
    expect(removes()).toHaveLength(4);
  });

  it("another company's asset never counts as a sharer", async () => {
    const doomed = seedCarousel();
    seed({ id: 'foreign', companyId: OTHER_CO, files: [signed('media-images', slidePath(2))] });
    await deleteCreatorAssetRecord({ assetId: doomed, companyId: CO });
    expect(removedPaths()).toContain(slidePath(2));
  });
});

describe('M4–M6 — invalid candidates are refused, and never block their siblings', () => {
  it('CRITICAL: a malformed location is skipped, the rest still deleted', async () => {
    const id = seed({
      url: 'not a url',
      files: [signed('media-images', slidePath(1)), 'https://evil.example.com/x.png'],
      metadata: { document_url: signed('media-documents', pdfPath()) },
    });
    await deleteCreatorAssetRecord({ assetId: id, companyId: CO });
    expect(removedPaths()).toEqual([pdfPath(), slidePath(1)].sort());
  });

  it('CRITICAL: a non-render bucket is refused', async () => {
    const id = seed({
      files: [signed('media-uploads', slidePath(1)), signed('media-images', slidePath(2))],
    });
    await deleteCreatorAssetRecord({ assetId: id, companyId: CO });
    expect(removedPaths()).toEqual([slidePath(2)]);
  });

  it("CRITICAL: another company's namespace is refused", async () => {
    const id = seed({
      files: [signed('media-images', slidePath(1, OTHER_CO)), signed('media-images', slidePath(2))],
    });
    await deleteCreatorAssetRecord({ assetId: id, companyId: CO });
    expect(removedPaths()).toEqual([slidePath(2)]);
  });

  it('CRITICAL: traversal is refused', async () => {
    const id = seed({
      files: [signed('media-images', `creator/${CO}/../../elsewhere/x.png`), signed('media-images', slidePath(2))],
    });
    await deleteCreatorAssetRecord({ assetId: id, companyId: CO });
    expect(removedPaths()).toEqual([slidePath(2)]);
  });

  it('a path outside the creator namespace entirely is refused', async () => {
    const id = seed({ files: [signed('media-images', `${CO}/loose.png`)] });
    await deleteCreatorAssetRecord({ assetId: id, companyId: CO });
    expect(removes()).toHaveLength(0);
  });
});

describe('M7–M8 — failure semantics match Phase 74', () => {
  it('an already-missing object is success, and siblings still process', async () => {
    storageRemoveError = 'Object not found';
    const r = await deleteCreatorAssetRecord({ assetId: seedCarousel(), companyId: CO });
    expect(r.deletedAsset).toBe(true);
    expect(removes()).toHaveLength(4);
  });

  it('CRITICAL: one object throwing does not stop the others', async () => {
    storageRemoveThrowFor = slidePath(2);
    const r = await deleteCreatorAssetRecord({ assetId: seedCarousel(), companyId: CO });
    expect(r.deletedAsset).toBe(true);
    expect(removes()).toHaveLength(4);          // all four attempted
  });

  it('storage failure still reports success — the row deletion is committed', async () => {
    storageRemoveError = 'network down';
    const r = await deleteCreatorAssetRecord({ assetId: seedCarousel(), companyId: CO });
    expect(r.deletedAsset).toBe(true);
    expect(assets).toHaveLength(0);
  });

  it('a database failure throws and touches no storage', async () => {
    deleteError = 'deadlock detected';
    await expect(deleteCreatorAssetRecord({ assetId: seedCarousel(), companyId: CO }))
      .rejects.toThrow(/Failed to delete creator asset/i);
    expect(storageCalls).toHaveLength(0);
  });
});

describe('M9–M10 — single-object and empty assets behave as before', () => {
  it('a single-visual asset still deletes exactly its one object', async () => {
    const id = seed({ url: signed('media-images', slidePath(1)) });
    await deleteCreatorAssetRecord({ assetId: id, companyId: CO });
    expect(removedPaths()).toEqual([slidePath(1)]);
  });

  it('an asset with no storage references deletes cleanly, touching nothing', async () => {
    for (const row of [{}, { url: null }, { url: '', files: [] }, { url: '   ', metadata: {} }]) {
      assets.length = 0; storageCalls.length = 0;
      const id = seed(row as never);
      const r = await deleteCreatorAssetRecord({ assetId: id, companyId: CO });
      expect(r.deletedAsset).toBe(true);
      expect(removes()).toHaveLength(0);
    }
  });

  it('a foreign company deletes nothing and touches no object', async () => {
    const id = seedCarousel({ companyId: CO });
    const r = await deleteCreatorAssetRecord({ assetId: id, companyId: OTHER_CO });
    expect(r.deletedAsset).toBe(false);
    expect(assets).toHaveLength(1);
    expect(storageCalls).toHaveLength(0);
  });

  it('attachment deletion still runs', async () => {
    const id = seedCarousel();
    attachments.push({ id: 'at-1', company_id: CO, creator_asset_id: id });
    const r = await deleteCreatorAssetRecord({ assetId: id, companyId: CO });
    expect(r.deletedAttachments).toBe(1);
  });
});

describe('M11 — no caller-supplied storage location', () => {
  it('CRITICAL: bucket/path/url on the input are ignored entirely', async () => {
    const id = seed({ url: signed('media-images', slidePath(1)) });
    await deleteCreatorAssetRecord({
      assetId: id, companyId: CO,
      bucket: 'secrets', path: `creator/${CO}/x.png`,
      url: signed('secrets', `creator/${CO}/y.png`),
      files: [signed('secrets', `creator/${CO}/z.png`)],
    } as never);
    expect(removedPaths()).toEqual([slidePath(1)]);
    expect(removes().every((c) => c.bucket === 'media-images')).toBe(true);
  });

  it('the signature takes one argument — there is nowhere to pass a location', () => {
    expect(deleteCreatorAssetRecord).toHaveLength(1);
  });

  it('no URL is ever minted while deleting', async () => {
    await deleteCreatorAssetRecord({ assetId: seedCarousel(), companyId: CO });
    expect(storageCalls.filter((c) => c.op !== 'remove')).toHaveLength(0);
  });
});

/* ── Source contract: pins the SHIPPED implementation ─────────────────────── */
const realFs = jest.requireActual('fs') as typeof fs;
const read = (p: string) => realFs.readFileSync(path.resolve(__dirname, p), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const SVC = strip(read('../../services/creatorAssetPersistenceService.ts'));

describe('M12 + guards — the shipped code', () => {
  it('CRITICAL: the delete projects every object-bearing column', () => {
    // Anchored to the DELETE chain: another query in this file projects the
    // same columns, so a bare substring would not pin the one that matters.
    expect(SVC).toContain(
      "    .delete()\n" +
      "    .eq('id', input.assetId)\n" +
      "    .eq('company_id', input.companyId)\n" +
      "    .select('id, url, files, metadata');",
    );
    expect(SVC).not.toContain(".select('id, url')");
  });

  it('CRITICAL: one definition of what a row owns, shared with the integrity report', () => {
    expect(SVC).toContain('function renderedObjectUrlsForRow');
    expect(SVC).toContain('metadata.document_url');
    expect(SVC).toContain('normalizeFiles(row.files)');
    // buildStorageReferences reuses it — the two cannot disagree.
    expect(SVC).toContain('return renderedObjectUrlsForRow(input).map((url) => {');
  });

  it('CRITICAL: authorization stays on the row, company-scoped', () => {
    expect(SVC).toContain("eq('company_id', input.companyId)");
    expect(SVC).toContain('path.startsWith(`${RENDER_NAMESPACE}${companyId}/`)');
  });

  it('CRITICAL: the row is deleted before storage', () => {
    expect(SVC.indexOf("    .eq('id', input.assetId)"))
      .toBeLessThan(SVC.indexOf('await removeRenderedObjectsForDeletedAsset('));
  });

  it('bucket + traversal guards survive, and there is still ONE parser', () => {
    expect(SVC).toContain('RENDER_BUCKETS.has(bucket)');
    expect(SVC).toContain("seg === '..'");
    expect((SVC.match(/function parseStorageReference/g) ?? [])).toHaveLength(1);
  });

  it('CRITICAL: an incomplete sharer scan refuses to delete rather than guess', () => {
    // A truncated scan cannot prove an object is unreferenced, and a false
    // negative there would widen deletion.
    expect(SVC).toContain('if (rows.length >= SHARER_SCAN_LIMIT) return null;');
    expect(SVC).toContain("if (referenced === null) {");
  });

  it('canonical assets and composition references are untouched', () => {
    expect(SVC).not.toContain('canonical_media_assets');
    expect(SVC).not.toContain('composition_asset_references');
  });

  it('no URL minting on the delete path', () => {
    const body = SVC.slice(SVC.indexOf('async function removeRenderedObjectsForDeletedAsset'));
    expect(body).not.toContain('getPublicUrl');
    expect(body).not.toContain('createSignedUrl');
  });
});

describe('Unrelated behaviour is unchanged', () => {
  it('CONDITION disclosure from Phase 76 is intact', () => {
    const img = strip(read('../../services/creatorAssetRendererImage.ts'));
    expect(img).toContain('condition_reference_status: conditionDegradation?.status,');
    expect(img).toContain('CREATOR_EVENTS.CONDITION_REFERENCE_DEGRADED');
  });

  it('canonical asset deletion still refuses a referenced asset', () => {
    const canonical = strip(read('../../services/canonicalMediaAssetService.ts'));
    expect(canonical).toContain('ASSET_STILL_REFERENCED');
  });

  it('media ownership remains server-authoritative', () => {
    expect(strip(read('../../../pages/api/media/upload.ts'))).toContain('const userId = user.id;');
  });
});
