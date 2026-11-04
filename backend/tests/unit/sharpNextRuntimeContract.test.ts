/**
 * SECURITY/B (next + sharp upgrade): runtime contract for the image stack.
 *
 * Pins the behaviour the repo relies on from the installed `sharp` and `next`
 * so a dependency bump that changes it fails here, not in production:
 *
 *  - the CommonJS `require('sharp')` binding the renderer uses is still a
 *    callable factory (creatorAssetRendererContracts / renderQualityAssurance);
 *  - valid images decode; invalid, truncated, malformed-header and
 *    decompression-bomb inputs REJECT with a plain Error (controlled failure,
 *    never a process crash, never a hang);
 *  - `limitInputPixels` (default and explicit) refuses huge declared
 *    dimensions BEFORE pixel allocation;
 *  - `timeout()` aborts a long-running pipeline with an Error;
 *  - next.config.js still validates against the installed Next config schema
 *    and its `images.remotePatterns` still match/reject as intended.
 *
 * No network, no filesystem writes; every input is synthesised in-memory.
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const sharp = require('sharp');

const REPO = path.resolve(__dirname, '..', '..', '..');

// ── fixtures ────────────────────────────────────────────────────────────────
function crc32(buf: Buffer): number {
  let c: number;
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** A syntactically valid PNG header declaring width x height with a tiny IDAT. */
function pngDeclaring(width: number, height: number): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const idat = zlib.deflateSync(Buffer.alloc(64));
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

async function validPng(w = 64, h = 48): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 10, g: 120, b: 200 } } }).png().toBuffer();
}
async function validJpeg(): Promise<Buffer> {
  return sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 200, g: 20, b: 20 } } }).jpeg().toBuffer();
}

async function expectControlledRejection(p: Promise<unknown>): Promise<Error> {
  let caught: unknown = null;
  try { await p; } catch (e) { caught = e; }
  expect(caught).toBeInstanceOf(Error);
  expect(typeof (caught as Error).message).toBe('string');
  expect((caught as Error).message.length).toBeGreaterThan(0);
  return caught as Error;
}

jest.setTimeout(60_000);

describe('sharp binding the renderer uses', () => {
  it('require("sharp") is a callable factory with versions metadata', () => {
    expect(typeof sharp).toBe('function');
    expect(typeof sharp.versions?.vips).toBe('string');
    expect(typeof sharp.versions?.sharp).toBe('string');
  });

  it('the installed sharp matches the version pinned in package.json', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
    const installed = JSON.parse(fs.readFileSync(path.join(REPO, 'node_modules/sharp/package.json'), 'utf8'));
    expect(pkg.dependencies.sharp).toBe(installed.version);
  });

  it('the repo loads sharp through require() in the renderer contracts and QA (source pin)', () => {
    const contracts = fs.readFileSync(path.join(REPO, 'backend/services/creatorAssetRendererContracts.ts'), 'utf8');
    const qa = fs.readFileSync(path.join(REPO, 'backend/services/creator/renderQualityAssurance.ts'), 'utf8');
    expect(contracts).toMatch(/export const sharp = require\('sharp'\)/);
    expect(qa).toMatch(/sharp = require\('sharp'\)/);
  });
});

describe('valid input', () => {
  it('decodes PNG and JPEG metadata and re-encodes', async () => {
    const png = await validPng();
    const meta = await sharp(png).metadata();
    expect(meta).toMatchObject({ format: 'png', width: 64, height: 48 });
    const jpg = await validJpeg();
    expect((await sharp(jpg).metadata()).format).toBe('jpeg');
    const out = await sharp(png).resize(32, 24).webp().toBuffer();
    expect((await sharp(out).metadata()).format).toBe('webp');
  });
});

describe('invalid / truncated / malformed input rejects with a controlled Error', () => {
  it('random bytes', async () => {
    await expectControlledRejection(sharp(Buffer.from('this is not an image at all, just text')).metadata());
  });

  it('empty buffer', async () => {
    await expectControlledRejection(Promise.resolve().then(() => sharp(Buffer.alloc(0)).metadata()));
  });

  it('truncated PNG (signature + partial IHDR) on metadata', async () => {
    const png = await validPng();
    await expectControlledRejection(sharp(png.subarray(0, 20)).metadata());
  });

  it('truncated PNG body on full decode', async () => {
    const png = await validPng(256, 256);
    const cut = png.subarray(0, Math.floor(png.length * 0.6));
    await expectControlledRejection(sharp(cut, { failOn: 'truncated' }).raw().toBuffer());
  });

  it('truncated JPEG on full decode', async () => {
    const big = await sharp({ create: { width: 512, height: 512, channels: 3, background: '#3366aa' } })
      .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><circle cx="256" cy="256" r="200" fill="#f0a"/></svg>') }])
      .jpeg({ quality: 95 }).toBuffer();
    const cut = big.subarray(0, Math.floor(big.length * 0.5));
    await expectControlledRejection(sharp(cut, { failOn: 'truncated' }).raw().toBuffer());
  });

  it('malformed header: PNG signature followed by garbage', async () => {
    const bad = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 0x41)]);
    await expectControlledRejection(sharp(bad).metadata());
  });

  it('malformed header: corrupt IHDR CRC with failOn=error', async () => {
    const png = await validPng();
    const bad = Buffer.from(png);
    bad[29] ^= 0xff; // inside IHDR CRC
    await expectControlledRejection(sharp(bad, { failOn: 'error' }).raw().toBuffer());
  });
});

describe('decompression bomb / huge dimensions', () => {
  it('a 70-byte PNG declaring 100000x100000 is refused by the default limitInputPixels', async () => {
    const bomb = pngDeclaring(100000, 100000);
    expect(bomb.length).toBeLessThan(200);
    const err = await expectControlledRejection(sharp(bomb).raw().toBuffer());
    expect(err.message).toMatch(/pixel limit|exceeds|too large/i);
  });

  it('an explicit limitInputPixels refuses an image just above it, before decode', async () => {
    const decl = pngDeclaring(8001, 8000); // 64,008,000 px
    const err = await expectControlledRejection(sharp(decl, { limitInputPixels: 8000 * 8000 }).raw().toBuffer());
    expect(err.message).toMatch(/pixel limit|exceeds/i);
  });

  it('metadata() on a bomb header returns declared dimensions without allocating pixels', async () => {
    const bomb = pngDeclaring(100000, 100000);
    const before = process.memoryUsage().rss;
    const meta = await sharp(bomb, { limitInputPixels: false }).metadata();
    expect(meta.width).toBe(100000);
    expect(meta.height).toBe(100000);
    // Header-only read: RSS growth must be nowhere near 30 GB of pixels.
    expect(process.memoryUsage().rss - before).toBeLessThan(512 * 1024 * 1024);
  });

  it('limitInputPixels: a valid image under the limit still decodes', async () => {
    const png = await validPng(100, 100);
    const out = await sharp(png, { limitInputPixels: 100 * 100 }).raw().toBuffer();
    expect(out.length).toBe(100 * 100 * 3);
  });
});

describe('oversized bytes', () => {
  it('trailing junk after a valid PNG does not change decoded pixels (no unbounded read of the tail)', async () => {
    const png = await validPng();
    const padded = Buffer.concat([png, Buffer.alloc(8 * 1024 * 1024, 0x00)]);
    const meta = await sharp(padded).metadata();
    expect(meta).toMatchObject({ format: 'png', width: 64, height: 48 });
  });
});

describe('timeouts', () => {
  it('timeout({seconds}) aborts a long pipeline with an Error instead of hanging', async () => {
    // A large blur on a large canvas takes well over a second on any CI box;
    // sharp must reject with its timeout error rather than block.
    const start = Date.now();
    const err = await expectControlledRejection(
      sharp({ create: { width: 6000, height: 6000, channels: 3, background: '#808080' } })
        .blur(200)
        .timeout({ seconds: 1 })
        .png()
        .toBuffer(),
    );
    expect(err.message).toMatch(/timeout/i);
    expect(Date.now() - start).toBeLessThan(30_000);
  });
});

describe('next.config.js under the installed Next', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nextConfig = require(path.join(REPO, 'next.config.js'));

  it('validates against the installed Next config schema', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { configSchema } = require('next/dist/server/config-schema');
    const result = configSchema.safeParse(nextConfig);
    if (!result.success) {
      // Surface the exact issue paths if the schema ever rejects the config.
      throw new Error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it('images.remotePatterns match intended hosts and reject others (Next matcher)', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { hasRemoteMatch } = require('next/dist/shared/lib/match-remote-pattern');
    const patterns = nextConfig.images.remotePatterns;
    const ok = (u: string) => hasRemoteMatch([], patterns, new URL(u));
    expect(ok('https://images.unsplash.com/photo-1')).toBe(true);
    // MEDIA-H3 (16fdec2a) removed the Supabase Storage entry: the optimizer must
    // not fetch stored objects, public or signed (nextConfigNoSupabaseImageHost).
    expect(ok('https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/b/x.png')).toBe(false);
    expect(ok('https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/sign/b/x.png')).toBe(false);
    expect(ok('http://images.unsplash.com/photo-1')).toBe(false);
    expect(ok('https://evil.example.com/storage/v1/object/public/b/x.png')).toBe(false);
  });

  it('the installed next satisfies the package.json range floor', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
    const installed = JSON.parse(fs.readFileSync(path.join(REPO, 'node_modules/next/package.json'), 'utf8'));
    const floor = String(pkg.dependencies.next).replace(/^[\^~]/, '');
    const toN = (v: string) => v.split('.').map(Number);
    const [a, b] = [toN(installed.version), toN(floor)];
    const cmp = a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
    expect(cmp).toBeGreaterThanOrEqual(0);
  });
});
