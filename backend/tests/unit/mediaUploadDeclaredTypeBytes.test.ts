/**
 * SEC-SHARP-001 residual R-C1: a NON-image declared type must be backed by
 * bytes of that category.
 *
 * C v2 sniffs the bytes only when the client declares `image/*`. Anything
 * declared `video/*`, `audio/*` or `application/pdf` was stored with the
 * client's type whatever the bytes were. Those objects live in a public
 * bucket, and Next's image optimizer (`/_next/image`, allowed for the project's
 * own Supabase host by `images.remotePatterns`) ignores the stored
 * Content-Type: it detects the format from the bytes and hands TIFF (and any
 * bytes its detector does not know, via `sharp().metadata()`) to sharp. So a
 * TIFF/SVG/PPM payload declared `video/mp4` reached libvips without passing
 * the app's image gate.
 *
 * These tests drive the ROUTE and assert what `uploadMedia` is asked to store.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

const AUTH_USER = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';

let uploadCalls: Array<Record<string, unknown>> = [];
let declaredMime = 'video/mp4';
let fileBytes: Buffer = Buffer.alloc(0);

jest.mock('formidable', () => jest.fn(() => ({
  on: () => undefined,
  parse: async () => [
    {},
    { file: [{ filepath: '/tmp/upload-x', originalFilename: 'clip.bin', mimetype: declaredMime, size: fileBytes.length }] },
  ],
})));

jest.mock('fs', () => {
  const real = jest.requireActual('fs');
  return { ...real, readFileSync: jest.fn(() => fileBytes), unlinkSync: jest.fn() };
});

jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: async () => ({ user: { id: AUTH_USER }, error: null }),
}));

jest.mock('../../services/mediaService', () => ({
  MAX_IMAGE_UPLOAD_BYTES: 10 * 1024 * 1024,
  // The real validateMedia only checks the DECLARED type against its allowlist;
  // accept everything here so the byte check under test is the only gate.
  validateMedia: async () => ({ valid: true, errors: [], warnings: [] }),
  uploadMedia: async (opts: Record<string, unknown>) => {
    uploadCalls.push(opts);
    return { id: 'media-1', user_id: opts.userId };
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const route = require('../../../pages/api/media/upload').default;

function makeRes() {
  const res: Record<string, unknown> = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.setHeader = () => res;
  return res;
}

async function upload(mime: string, bytes: Buffer) {
  declaredMime = mime;
  fileBytes = bytes;
  const res = makeRes();
  await route({ method: 'POST', headers: {}, query: {} } as never, res as never);
  return res;
}

const ftyp = (brand: string) => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftyp' + brand, 'latin1'), Buffer.alloc(16)]);
const atom = (type: string) => Buffer.concat([Buffer.from([0, 0, 0, 0x08]), Buffer.from(type, 'latin1'), Buffer.alloc(16)]);

const TIFF_LE = Buffer.concat([Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0, 0, 0]), Buffer.alloc(24)]);
const TIFF_BE = Buffer.concat([Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 0x08]), Buffer.alloc(24)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const XML_SVG = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>');
const PPM = Buffer.from('P6\n1 1\n255\n\x00\x00\x00', 'latin1');
const HTML = Buffer.from('<!doctype html><script>alert(1)</script>');
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PDF = Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'latin1');
const WAV = Buffer.concat([Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt ', 'latin1'), Buffer.alloc(16)]);
const MP3_ID3 = Buffer.concat([Buffer.from('ID3\x04\x00\x00', 'latin1'), Buffer.alloc(16)]);
const OGG = Buffer.concat([Buffer.from('OggS', 'latin1'), Buffer.alloc(16)]);
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(16)]);
const AVI = Buffer.concat([Buffer.from('RIFF\x24\x00\x00\x00AVI LIST', 'latin1'), Buffer.alloc(16)]);

beforeEach(() => { uploadCalls = []; });

describe('R-C1 — declared non-image types must match their bytes', () => {
  it.each([
    ['TIFF (LE) declared video/mp4', 'video/mp4', TIFF_LE],
    ['TIFF (BE) declared video/quicktime', 'video/quicktime', TIFF_BE],
    ['SVG declared video/mp4', 'video/mp4', SVG],
    ['SVG with XML prolog declared application/pdf', 'application/pdf', XML_SVG],
    ['PPM declared audio/mpeg', 'audio/mpeg', PPM],
    ['HTML declared application/pdf', 'application/pdf', HTML],
    ['PNG declared video/mp4', 'video/mp4', PNG],
    ['JPEG declared audio/wav', 'audio/wav', JPEG],
    ['HEIC (ftyp heic) declared video/mp4', 'video/mp4', ftyp('heic')],
    ['AVIF (ftyp avif) declared video/mp4', 'video/mp4', ftyp('avif')],
    ['audio bytes declared video/mp4', 'video/mp4', WAV],
    ['video bytes declared audio/mpeg', 'audio/mpeg', ftyp('isom')],
    ['PDF bytes declared video/mp4', 'video/mp4', PDF],
    ['empty file declared video/mp4', 'video/mp4', Buffer.alloc(0)],
  ])('CRITICAL: %s is refused with 400 and nothing is stored', async (_label, mime, bytes) => {
    const res = await upload(mime, bytes);
    expect(res.statusCode).toBe(400);
    expect(uploadCalls).toHaveLength(0);
    expect(String((res.body as Record<string, unknown>).error)).toMatch(/does not match the declared type/);
  });

  it.each([
    ['MP4 (isom)', 'video/mp4', ftyp('isom')],
    ['MP4 (mp42)', 'video/mp4', ftyp('mp42')],
    ['QuickTime (ftyp qt)', 'video/quicktime', ftyp('qt  ')],
    ['legacy QuickTime without ftyp (moov first)', 'video/quicktime', atom('moov')],
    ['legacy QuickTime without ftyp (wide first)', 'video/mov', atom('wide')],
    ['legacy QuickTime without ftyp (mdat first)', 'video/quicktime', atom('mdat')],
    ['WebM', 'video/webm', WEBM],
    ['AVI', 'video/avi', AVI],
    ['MP3 (ID3)', 'audio/mpeg', MP3_ID3],
    ['MP3 (frame sync)', 'audio/mp3', Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x64]), Buffer.alloc(16)])],
    ['WAV', 'audio/wav', WAV],
    ['OGG', 'audio/ogg', OGG],
    ['M4A', 'audio/m4a', ftyp('M4A ')],
    ['M4A (x-m4a)', 'audio/x-m4a', ftyp('M4A ')],
    ['PDF', 'application/pdf', PDF],
  ])('a genuine %s upload is still accepted with its declared type', async (_label, mime, bytes) => {
    const res = await upload(mime, bytes);
    expect(res.statusCode).toBe(200);
    expect(uploadCalls).toHaveLength(1);
    expect(uploadCalls[0].mimeType).toBe(mime);
  });

  it('legacy QuickTime atoms are NOT accepted for a declared video/mp4 or audio type', async () => {
    for (const mime of ['video/mp4', 'audio/m4a']) {
      uploadCalls = [];
      const res = await upload(mime, atom('moov'));
      expect(res.statusCode).toBe(400);
      expect(uploadCalls).toHaveLength(0);
    }
  });

  it('declared image/* keeps the C v2 behaviour (stored type comes from the bytes)', async () => {
    const res = await upload('image/jpeg', PNG);
    expect(res.statusCode).toBe(200);
    expect(uploadCalls[0].mimeType).toBe('image/png');
    uploadCalls = [];
    const rejected = await upload('image/png', TIFF_LE);
    expect(rejected.statusCode).toBe(400);
    expect(uploadCalls).toHaveLength(0);
  });
});
