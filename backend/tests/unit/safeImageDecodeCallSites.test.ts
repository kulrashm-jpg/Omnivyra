/**
 * SEC-SHARP-001 — the untrusted-image gate is wired at the tenant-input call sites.
 *
 *   A. compose lane (compositionAssetComposeService): stored bytes that are
 *      not an allowed raster image become a `bytes_rejected` rejection; they
 *      never reach a resize, and a valid PNG still composes. An INTERNAL error
 *      in the transform is logged at error and propagates (v2, audit A6-19).
 *   B. brand mark (creatorAssetRendererOverlay.loadBrandMark): keeps its
 *      fall-open contract (null), but every failure is logged at the right
 *      level — rejection → warn, fetch failure → warn, internal → error.
 *   C. upload route (pages/api/media/upload): the stored MIME comes from the
 *      bytes, not from the multipart declaration; SVG / non-image bytes
 *      declared as image/* are refused before anything is stored.
 *   D. source guards: no tenant-input site decodes with `failOn: 'none'`, and
 *      every catch around the gate reports the failure (no silent fall-open).
 */
jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

import * as fs from 'fs';
import * as path from 'path';

const ONE_PX_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==',
  'base64',
);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');

let storedBytes: Buffer = ONE_PX_PNG;
let uploadBytes: Buffer = ONE_PX_PNG;
let declaredMime = 'image/png';
const uploadCalls: Array<Record<string, unknown>> = [];

/** When set, the next sharp pipeline's `resize`/`ensureAlpha` throws this (an injected internal error). */
let injectedInternalError: Error | null = null;
/** What the brand-mark fetch returns or throws. */
let remoteImage: () => Promise<Buffer> = async () => ONE_PX_PNG;

jest.mock('../../services/creatorAssetRendererContracts', () => {
  const actual = jest.requireActual('../../services/creatorAssetRendererContracts');
  // The real sharp, resolved lazily: the contracts module and the overlay import
  // each other, so `actual.sharp` can still be undefined while this factory runs.
  const wrapped = (...args: unknown[]) => {
    const realSharp = jest.requireActual('sharp');
    const image = realSharp(...args);
    if (injectedInternalError) {
      const error = injectedInternalError;
      image.resize = () => { throw error; };
      image.ensureAlpha = () => { throw error; };
    }
    return image;
  };
  return { ...actual, sharp: wrapped };
});

jest.mock('../../services/creatorAssetRendererSvg', () => ({
  ...jest.requireActual('../../services/creatorAssetRendererSvg'),
  bufferFromRemoteImage: jest.fn(() => remoteImage()),
}));

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
    storage: {
      from: () => ({
        download: async () => ({ data: { arrayBuffer: async () => storedBytes }, error: null }),
      }),
    },
  },
}));

const assets: Record<string, unknown>[] = [];
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => {
    const filters: Record<string, unknown> = {};
    const b: Record<string, unknown> = {
      select: () => b, order: () => b, limit: () => b,
      eq(c: string, v: unknown) { filters[c] = v; return b; },
      maybeSingle: () => Promise.resolve({
        data: assets.find((r) => Object.entries(filters).every(([k, v]) => r[k] === v)) ?? null,
        error: null,
      }),
      single: () => Promise.resolve({ data: null, error: null }),
      then: (res: (r: { data: unknown[]; error: null }) => unknown) =>
        Promise.resolve(res({ data: assets.filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v)), error: null })),
    };
    return b;
  },
}));

jest.mock('formidable', () => jest.fn(() => ({
  on: () => undefined,
  parse: async () => [
    {},
    { file: [{ filepath: '/tmp/x', originalFilename: 'x.png', mimetype: declaredMime, size: uploadBytes.length }] },
  ],
})));

jest.mock('fs', () => {
  const real = jest.requireActual('fs');
  return {
    ...real,
    readFileSync: jest.fn((p: unknown, ...rest: unknown[]) => (p === '/tmp/x' ? uploadBytes : real.readFileSync(p, ...rest))),
    unlinkSync: jest.fn(),
  };
});

jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: async () => ({ user: { id: 'user-1' }, error: null }),
}));

jest.mock('../../services/mediaService', () => ({
  MAX_IMAGE_UPLOAD_BYTES: 10 * 1024 * 1024,
  validateMedia: async () => ({ valid: true, errors: [], warnings: [] }),
  uploadMedia: async (opts: Record<string, unknown>) => {
    uploadCalls.push(opts);
    return { id: 'media-1' };
  },
}));

import { buildComposeLayers } from '../../services/compositionAssetComposeService';
import { loadBrandMark } from '../../services/creatorAssetRendererOverlay';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const uploadRoute = require('../../../pages/api/media/upload').default;

const COMPANY = 'company-aaaa';
const SLOT = {
  purpose: 'logo', mode: 'compose', max: 1,
  placement: { top: 0.35, left: 0.35, maxWidth: 0.3, maxHeight: 0.3, fit: 'contain' as const },
};

function seedAsset(id: string) {
  assets.push({
    id, company_id: COMPANY, storage_bucket: 'media-uploads',
    storage_path: `${COMPANY}/${id}.png`, mime_type: 'image/png', origin: 'upload',
    lifecycle_state: 'ready', metadata: {}, created_at: 'T0', updated_at: 'T0',
    created_by: 'user-1', byte_size: 1, width: 1, height: 1,
    checksum_sha256: null, original_filename: null, source_url: null,
  });
}

function composeInput(assetId: string) {
  const reference = {
    id: `ref-${assetId}`, companyId: COMPANY, compositionType: 'creator_card', compositionId: 'c1',
    assetId, purpose: 'logo', mode: 'compose', ordinal: 1, metadata: {}, createdAt: 'T1', updatedAt: 'T1',
  };
  return {
    companyId: COMPANY,
    compose: [{ reference, sourceUrl: `media-uploads/${assetId}.png` }] as never,
    templateSlots: [SLOT] as never,
    width: 100,
    height: 100,
  };
}

let brandSeq = 0;
/** A brand kit whose mark is a remote logo; unique hash per call so the render cache never hits. */
function brandKit() {
  brandSeq += 1;
  return {
    tenantId: 'tenant-1',
    companyId: COMPANY,
    renderIdentityHash: `hash-${brandSeq}`,
    resolvedBrandMark: 'https://brand.example.test/logo.png',
    resolvedBrandMarkType: 'logo',
    fallbackInitials: 'CO',
  } as never;
}

function makeRes() {
  const res: Record<string, unknown> = { statusCode: 0, body: null, headersSent: false };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.setHeader = () => res;
  return res as { statusCode: number; body: Record<string, unknown> };
}

async function postUpload() {
  const res = makeRes();
  await uploadRoute({ method: 'POST', headers: {}, query: {} } as never, res as never);
  return res;
}

let warnSpy: jest.SpyInstance;
let errorSpy: jest.SpyInstance;
const tagged = (spy: jest.SpyInstance, tag: string) => spy.mock.calls.filter((c) => c[0] === tag);

beforeEach(() => {
  assets.length = 0;
  uploadCalls.length = 0;
  storedBytes = ONE_PX_PNG;
  uploadBytes = ONE_PX_PNG;
  declaredMime = 'image/png';
  injectedInternalError = null;
  remoteImage = async () => ONE_PX_PNG;
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  warnSpy.mockRestore();
  errorSpy.mockRestore();
});

describe('A — compose lane', () => {
  it('a real PNG still composes into one layer', async () => {
    seedAsset('a1');
    const out = await buildComposeLayers(composeInput('a1'));
    expect(out.rejected).toEqual([]);
    expect(out.layers).toHaveLength(1);
  });

  it.each([
    ['SVG', SVG, 'image_format_not_allowed'],
    ['AVIF header', Buffer.concat([Buffer.from([0, 0, 0, 0x1c]), Buffer.from('ftypavif', 'latin1'), Buffer.alloc(20)]), 'image_format_not_allowed'],
    ['truncated PNG', ONE_PX_PNG.subarray(0, 30), 'image_decode_failed'],
    ['text', Buffer.from('not an image at all'), 'image_format_not_allowed'],
  ])('%s → bytes_rejected, no layer, warn log with reason', async (_label, bytes, reason) => {
    seedAsset('a1');
    storedBytes = bytes;
    const out = await buildComposeLayers(composeInput('a1'));
    expect(out.layers).toHaveLength(0);
    expect(out.rejected).toHaveLength(1);
    expect(out.rejected[0].reason).toBe('bytes_rejected');
    expect(out.rejected[0].detail).toContain(reason);
    const logs = tagged(warnSpy, '[safe-image][rejected]');
    expect(logs).toHaveLength(1);
    expect(logs[0][1]).toMatchObject({ callSite: 'compose.slot_asset', reason, byteLength: bytes.length });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('an injected INTERNAL error is logged at error and propagates (not relabelled bytes_rejected)', async () => {
    seedAsset('a1');
    injectedInternalError = new TypeError('injected internal failure');
    await expect(buildComposeLayers(composeInput('a1'))).rejects.toBe(injectedInternalError);
    const logs = tagged(errorSpy, '[safe-image][internal-error]');
    expect(logs).toHaveLength(1);
    expect(logs[0][1]).toMatchObject({ callSite: 'compose.slot_asset', errorName: 'TypeError' });
    expect(String(logs[0][1].stack)).toContain('injected internal failure');
    expect(tagged(warnSpy, '[safe-image][rejected]')).toHaveLength(0);
  });
});

describe('B — brand mark keeps its fall-open contract but never fails silently', () => {
  const placement = { maxWidth: 32, maxHeight: 32 };

  it('a real PNG logo renders', async () => {
    const out = await loadBrandMark({ brandKit: brandKit(), placement });
    expect(Buffer.isBuffer(out)).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('an SVG logo → null, warn [safe-image][rejected] with the reason code and no URL', async () => {
    remoteImage = async () => SVG;
    await expect(loadBrandMark({ brandKit: brandKit(), placement })).resolves.toBeNull();
    const logs = tagged(warnSpy, '[safe-image][rejected]');
    expect(logs).toHaveLength(1);
    expect(logs[0][1]).toMatchObject({ callSite: 'creator.brand_mark', reason: 'image_format_not_allowed', companyId: COMPANY });
    expect(JSON.stringify(logs[0][1])).not.toContain('brand.example.test');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('a failed logo download → null, warn [safe-image][source-unavailable] (not an image error)', async () => {
    remoteImage = async () => { throw new Error('Image download failed with 503'); };
    await expect(loadBrandMark({ brandKit: brandKit(), placement })).resolves.toBeNull();
    const logs = tagged(warnSpy, '[safe-image][source-unavailable]');
    expect(logs).toHaveLength(1);
    expect(logs[0][1]).toMatchObject({ callSite: 'creator.brand_mark', httpStatus: 503 });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('an injected INTERNAL error → null (contract) but logged at error with stack — the v1 ReferenceError would now be visible', async () => {
    injectedInternalError = new ReferenceError('transformUntrustedImage is not defined');
    await expect(loadBrandMark({ brandKit: brandKit(), placement })).resolves.toBeNull();
    const logs = tagged(errorSpy, '[safe-image][internal-error]');
    expect(logs).toHaveLength(1);
    expect(logs[0][1]).toMatchObject({ callSite: 'creator.brand_mark', errorName: 'ReferenceError' });
    expect(String(logs[0][1].stack)).toContain('ReferenceError');
    expect(tagged(warnSpy, '[safe-image][rejected]')).toHaveLength(0);
  });
});

describe('C — upload stores the sniffed MIME, not the declared one', () => {
  it('PNG bytes declared as image/jpeg are stored as image/png', async () => {
    declaredMime = 'image/jpeg';
    const res = await postUpload();
    expect(res.statusCode).toBe(200);
    expect(uploadCalls).toHaveLength(1);
    expect(uploadCalls[0].mimeType).toBe('image/png');
  });

  it.each([
    ['SVG declared as image/png', SVG, 'image/png'],
    ['SVG declared as image/svg+xml', SVG, 'image/svg+xml'],
    ['text declared as image/gif', Buffer.from('GIF? no'), 'image/gif'],
    ['AVIF declared as image/avif', Buffer.concat([Buffer.from([0, 0, 0, 0x1c]), Buffer.from('ftypavif', 'latin1'), Buffer.alloc(20)]), 'image/avif'],
  ])('%s → 400, nothing stored', async (_label, bytes, mime) => {
    uploadBytes = bytes;
    declaredMime = mime;
    const res = await postUpload();
    expect(res.statusCode).toBe(400);
    expect(String(res.body.error)).toMatch(/not a supported image/);
    expect(uploadCalls).toHaveLength(0);
  });

  it('non-image uploads keep their declared type (video is not sniffed here)', async () => {
    uploadBytes = Buffer.from('....ftypisom', 'latin1');
    declaredMime = 'video/mp4';
    const res = await postUpload();
    expect(res.statusCode).toBe(200);
    expect(uploadCalls[0].mimeType).toBe('video/mp4');
  });
});

describe('D — source guards', () => {
  const read = (rel: string) => jest.requireActual('fs').readFileSync(path.resolve(__dirname, '../../..', rel), 'utf8') as string;
  void fs;

  const SITES = [
    'backend/services/creatorAssetRendererOverlay.ts',
    'backend/services/compositionAssetComposeService.ts',
    'backend/services/creatorAssetRendererCarousel.ts',
    'backend/services/creatorAssetRendererInfographic.ts',
  ];

  it.each(SITES)('%s routes untrusted bytes through transformUntrustedImage and imports the reporter', (rel) => {
    const src = read(rel);
    expect(src).toContain('transformUntrustedImage(');
    // IMPORTED, not merely referenced: a missing import at a fall-open site was
    // the v1 defect (a ReferenceError swallowed as "no background").
    expect(src).toMatch(/import \{[^}]*\btransformUntrustedImage\b[^}]*\} from '\.\.\/\.\.\/lib\/security\/safeImageDecode';/);
    expect(src).toMatch(/import \{[^}]*\breportImageFailure\b[^}]*\} from '\.\.\/\.\.\/lib\/security\/safeImageDecode';/);
  });

  it.each(SITES)('%s: every catch after a transformUntrustedImage call reports or rethrows (no silent fall-open)', (rel) => {
    const src = read(rel);
    // Every `transformUntrustedImage(` occurrence is a call (the import has no paren).
    const callSites: number[] = [];
    for (let at = src.indexOf('transformUntrustedImage('); at >= 0; at = src.indexOf('transformUntrustedImage(', at + 1)) callSites.push(at);
    expect(callSites.length).toBeGreaterThan(0);
    for (const callAt of callSites) {
      const catchAt = src.indexOf('} catch', callAt);
      expect(catchAt).toBeGreaterThan(callAt);
      const body = src.slice(catchAt, catchAt + 900);
      expect(body.startsWith('} catch {')).toBe(false);
      expect(body).toMatch(/reportImageFailure\(error, \{ callSite: '[a-z_.]+'/);
    }
  });

  it('no tenant-input site keeps failOn: none on bytes', () => {
    for (const rel of SITES.slice(1)) {
      expect(read(rel)).not.toMatch(/sharp\((bytes|raw|buffer), \{ failOn: 'none' \}\)/);
    }
    // Overlay keeps failOn:'none' only for the trusted AI-provider buffer.
    expect(read(SITES[0])).not.toMatch(/sharp\(buffer, \{ failOn: 'none' \}\)/);
  });

  it('the old error class name and relabel-everything behaviour are gone', () => {
    const helper = read('lib/security/safeImageDecode.ts');
    expect(helper).not.toContain('UnsafeImageInputError');
    for (const rel of SITES) expect(read(rel)).not.toContain('isUnsafeImageInputError');
  });
});
