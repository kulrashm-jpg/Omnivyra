/**
 * SEC-SHARP-001 — untrusted image decode gate (v2: error taxonomy, audit A6-19).
 *
 * Real sharp/libvips, real bytes. Every crafted input below must be refused
 * with a stable `ImageRejectedError.reason` BEFORE (or, for truncation, AT)
 * decode; well-formed PNG / JPEG / WebP / GIF must still decode; and errors
 * that are NOT about the input (programming errors, sharp argument errors)
 * must propagate unchanged instead of being relabelled as a decode failure.
 */
import * as zlib from 'zlib';
import sharp from 'sharp';
import type { Sharp } from 'sharp';
import {
  assertAllowedImageBytes,
  classifyDecoderError,
  fetchUntrustedImageBytes,
  ImageRejectedError,
  ImageSourceUnavailableError,
  isImageRejectedError,
  openUntrustedImage,
  reportImageFailure,
  sniffSafeImageFormat,
  sniffSafeImageMime,
  transformUntrustedImage,
  SAFE_IMAGE_DEFAULT_MAX_PIXELS,
  type SharpFactory,
} from '../../../lib/security/safeImageDecode';

async function solid(format: 'png' | 'jpeg' | 'webp' | 'gif', width = 8, height = 8): Promise<Buffer> {
  const base = sharp({ create: { width, height, channels: 3, background: { r: 10, g: 120, b: 200 } } });
  return base[format]().toBuffer();
}

/** A syntactically valid PNG whose IHDR declares `width` x `height` (one tiny IDAT row). */
function pngWithDeclaredSize(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.alloc(2))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a rejection');
}

async function expectReason(promise: Promise<unknown>, reason: string): Promise<ImageRejectedError> {
  const error = await caught(promise);
  expect(isImageRejectedError(error)).toBe(true);
  expect((error as ImageRejectedError).reason).toBe(reason);
  expect((error as ImageRejectedError).code).toBe(reason);
  return error as ImageRejectedError;
}

/**
 * A fake sharp factory that records disposal and lets a test choose what
 * `metadata()` and the transform do. Used for the timeout simulation and the
 * injected internal errors.
 */
function fakeSharp(opts: {
  metadata?: () => Promise<{ format?: string; width?: number; height?: number }>;
  toBuffer?: () => Promise<Buffer>;
}) {
  const state = { destroyed: 0, created: 0 };
  const factory = ((_bytes: Buffer) => {
    state.created += 1;
    const image: Record<string, unknown> = {};
    image.timeout = () => image;
    image.metadata = opts.metadata ?? (async () => ({ format: 'png', width: 8, height: 8 }));
    image.resize = () => image;
    image.png = () => image;
    image.toBuffer = opts.toBuffer ?? (async () => Buffer.from('out'));
    image.destroy = () => { state.destroyed += 1; };
    return image as unknown as Sharp;
  }) as unknown as SharpFactory;
  return { factory, state };
}

const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
const SVG_WITH_XML_DECL = Buffer.from(`<?xml version="1.0"?>\n${SVG.toString()}`);
const AVIF_HEADER = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x1c]), Buffer.from('ftypavif', 'latin1'), Buffer.alloc(20),
]);
const HEIC_HEADER = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18]), Buffer.from('ftypheic', 'latin1'), Buffer.alloc(16),
]);
const TIFF_HEADER = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0, 0, 0, 0]);
const PDF_HEADER = Buffer.from('%PDF-1.7\n%\xff\xff\n', 'latin1');
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let warnSpy: jest.SpyInstance;
let errorSpy: jest.SpyInstance;
beforeEach(() => {
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  warnSpy.mockRestore();
  errorSpy.mockRestore();
});

describe('A — unsupported formats (incl. SVG) are refused before decode', () => {
  it.each(['png', 'jpeg', 'webp', 'gif'] as const)('sniffs real %s bytes', async (format) => {
    const bytes = await solid(format);
    expect(sniffSafeImageFormat(bytes)).toBe(format);
    expect(sniffSafeImageMime(bytes)).toBe(`image/${format}`);
  });

  it.each([
    ['SVG', SVG],
    ['SVG with XML declaration', SVG_WITH_XML_DECL],
    ['AVIF', AVIF_HEADER],
    ['HEIC', HEIC_HEADER],
    ['TIFF', TIFF_HEADER],
    ['PDF', PDF_HEADER],
    ['plain text', Buffer.from('hello world, not an image')],
    ['too short', Buffer.from([0x89, 0x50])],
  ])('refuses %s with image_format_not_allowed; sharp is never constructed', async (_label, bytes) => {
    const fake = fakeSharp({});
    expect(sniffSafeImageFormat(bytes)).toBeNull();
    expect(() => assertAllowedImageBytes(bytes)).toThrow(ImageRejectedError);
    const error = await expectReason(openUntrustedImage(bytes, { sharp: fake.factory }), 'image_format_not_allowed');
    expect(fake.state.created).toBe(0);
    expect(error.detail.byteLength).toBe(bytes.length);
  });

  it('honours a narrower per-call allowlist', async () => {
    const gif = await solid('gif');
    await expectReason(openUntrustedImage(gif, { allowedFormats: ['png', 'jpeg', 'webp'] }), 'image_format_not_allowed');
  });

  it('the rejection message is user-safe and the detail carries no bytes', async () => {
    const error = await expectReason(openUntrustedImage(SVG), 'image_format_not_allowed');
    expect(error.userMessage).toBe('The image must be a PNG, JPEG, WebP or GIF file.');
    expect(error.message).not.toMatch(/svg|<|xmlns/i);
    expect(JSON.stringify(error.detail)).not.toContain('svg');
    expect(Object.keys(error.detail).sort()).toEqual(['byteLength', 'sniffedType']);
  });
});

describe('B — malformed bytes behind a valid magic number', () => {
  it('refuses a truncated PNG with image_decode_failed and a user-safe message', async () => {
    const png = await solid('png', 256, 256);
    const truncated = png.subarray(0, Math.floor(png.length / 2));
    const error = await expectReason(
      transformUntrustedImage(truncated, (image) => image.resize(16, 16).png().toBuffer()),
      'image_decode_failed',
    );
    expect(error.message).toBe('The image file is damaged or could not be read.');
    expect(error.message).not.toMatch(/pngload|vips/i);
  });

  it('refuses a truncated JPEG', async () => {
    const jpeg = await solid('jpeg', 256, 256);
    await expectReason(
      transformUntrustedImage(jpeg.subarray(0, 40), (image) => image.resize(16, 16).png().toBuffer()),
      'image_decode_failed',
    );
  });

  it('refuses a PNG with a corrupt IDAT stream (accepted before only because of failOn: none)', async () => {
    const corrupt = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      'base64',
    );
    await expectReason(
      transformUntrustedImage(corrupt, (image) => image.resize(4, 4).png().toBuffer()),
      'image_decode_failed',
    );
  });

  it('refuses SVG markup smuggled behind a PNG signature', async () => {
    await expectReason(openUntrustedImage(Buffer.concat([PNG_SIG, SVG])), 'image_decode_failed');
  });

  it('refuses a format mismatch (libvips picks a different loader than the sniffer)', async () => {
    const fake = fakeSharp({ metadata: async () => ({ format: 'svg', width: 8, height: 8 }) });
    const png = await solid('png');
    const error = await expectReason(openUntrustedImage(png, { sharp: fake.factory }), 'image_format_mismatch');
    expect(error.detail).toMatchObject({ sniffedType: 'image/png', detectedFormat: 'svg' });
    expect(fake.state.destroyed).toBe(1);
  });
});

describe('C — oversized bytes and oversized pixels', () => {
  it('refuses empty input', async () => {
    await expectReason(openUntrustedImage(Buffer.alloc(0)), 'image_empty');
  });

  it('refuses input over the byte cap before sharp is constructed', async () => {
    const png = await solid('png', 64, 64);
    const fake = fakeSharp({});
    const error = await expectReason(
      openUntrustedImage(png, { maxBytes: png.length - 1, sharp: fake.factory }),
      'image_too_large_bytes',
    );
    expect(error.detail).toMatchObject({ byteLength: png.length, maxBytes: png.length - 1, sniffedType: 'image/png' });
    expect(fake.state.created).toBe(0);
  });

  it('refuses a decompression bomb: a ~70-byte PNG whose header declares 100000 x 100000', async () => {
    const bomb = pngWithDeclaredSize(100_000, 100_000);
    expect(bomb.length).toBeLessThan(100);
    expect(sniffSafeImageFormat(bomb)).toBe('png');
    const error = await expectReason(openUntrustedImage(bomb), 'image_dimensions_exceeded');
    expect(error.detail.maxInputPixels).toBe(SAFE_IMAGE_DEFAULT_MAX_PIXELS);
  });

  it('refuses a huge-header image just over the default cap (8001 x 8000) without decoding it', async () => {
    await expectReason(openUntrustedImage(pngWithDeclaredSize(8001, 8000)), 'image_dimensions_exceeded');
  });

  it('refuses real pixels over a caller-provided pixel limit', async () => {
    const png = await solid('png', 200, 200);
    await expectReason(openUntrustedImage(png, { maxInputPixels: 200 * 200 - 1 }), 'image_dimensions_exceeded');
  });

  it('the default pixel limit is well below sharp\'s 268 MP default', () => {
    expect(SAFE_IMAGE_DEFAULT_MAX_PIXELS).toBeLessThan(268_402_689);
  });
});

describe('D — timeout (simulated)', () => {
  // The message shape is what sharp 0.34.5 / libvips 8.17 produced for a real
  // `.timeout({ seconds: 1 })` kill during this change's probe:
  //   "timeout: 28% complete\nVipsImage: killed for image \"temp-187\""
  const LIBVIPS_TIMEOUT = 'timeout: 42% complete\nVipsImage: killed for image "temp-1"';

  it('a libvips timeout during the transform becomes image_decode_timeout, and the pipeline is disposed', async () => {
    const fake = fakeSharp({ toBuffer: async () => { throw new Error(LIBVIPS_TIMEOUT); } });
    const png = await solid('png');
    const error = await expectReason(
      transformUntrustedImage(png, (image) => image.resize(4, 4).png().toBuffer(), { sharp: fake.factory, timeoutSeconds: 3 }),
      'image_decode_timeout',
    );
    expect(error.detail.timeoutSeconds).toBe(3);
    expect(error.message).toBe('The image took too long to process.');
    expect(fake.state.destroyed).toBe(1);
  });

  it('a libvips timeout while reading the header is also image_decode_timeout', async () => {
    const fake = fakeSharp({ metadata: async () => { throw new Error(LIBVIPS_TIMEOUT); } });
    await expectReason(openUntrustedImage(await solid('png'), { sharp: fake.factory }), 'image_decode_timeout');
    expect(fake.state.destroyed).toBe(1);
  });
});

describe('E — internal errors are NOT relabelled and NOT swallowed', () => {
  it('a programming error inside the transform propagates unchanged', async () => {
    const png = await solid('png');
    const bug = new TypeError('injected: cannot read properties of undefined');
    const error = await caught(transformUntrustedImage(png, async () => { throw bug; }));
    expect(error).toBe(bug);
    expect(isImageRejectedError(error)).toBe(false);
  });

  it('a sharp argument error (caller bug, plain Error from real sharp) propagates unchanged', async () => {
    const png = await solid('png');
    const error = await caught(transformUntrustedImage(png, (image) => image.resize(-1).png().toBuffer()));
    expect(isImageRejectedError(error)).toBe(false);
    // sharp 0.34: 'Expected positive integer for width ...'; 0.35: 'Expected positive integer between 1 and 100000000 for width ...'
    expect((error as Error).message).toMatch(/^Expected positive integer.* for width/);
  });

  it('an unexpected error while reading the header propagates unchanged, and the pipeline is disposed', async () => {
    const bug = new ReferenceError('injected: helper is not defined');
    const fake = fakeSharp({ metadata: async () => { throw bug; } });
    const error = await caught(openUntrustedImage(await solid('png'), { sharp: fake.factory }));
    expect(error).toBe(bug);
    expect(fake.state.destroyed).toBe(1);
  });

  it('an unknown plain Error is classified as internal, not as a decode failure', () => {
    expect(classifyDecoderError(new Error('database connection reset'))).toBeNull();
    expect(classifyDecoderError(new TypeError('pngload_buffer: looks like libvips but is a TypeError'))).toBeNull();
    expect(classifyDecoderError(new Error('pngload_buffer: end of stream'))).toBe('decode');
    expect(classifyDecoderError(new Error('Input buffer contains unsupported image format'))).toBe('decode');
    // libvips 8.18 (sharp 0.35) spng loader message, lower-case prefix.
    expect(classifyDecoderError(new Error('vipspng: libpng read error' + String.fromCharCode(10) + 'vips2png: unable to write to target target'))).toBe('decode');
    expect(classifyDecoderError(new Error('VipsJpeg: premature end of JPEG image'))).toBe('decode');
    expect(classifyDecoderError(new Error('Input image exceeds pixel limit'))).toBe('pixel_limit');
  });

  it('reportImageFailure logs an internal error at error level with stack and call site', () => {
    const bug = new TypeError('injected internal failure');
    expect(reportImageFailure(bug, { callSite: 'test.site', companyId: 'c-1' })).toBe('internal');
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [tag, payload] = errorSpy.mock.calls[0];
    expect(tag).toBe('[safe-image][internal-error]');
    expect(payload).toMatchObject({ callSite: 'test.site', errorName: 'TypeError', message: 'injected internal failure', companyId: 'c-1' });
    expect(String(payload.stack)).toContain('TypeError: injected internal failure');
  });

  it('reportImageFailure logs a rejection at warn with reason code, byte length, sniffed type — never bytes', async () => {
    const error = await caught(openUntrustedImage(SVG));
    expect(reportImageFailure(error, { callSite: 'test.site' })).toBe('rejected');
    expect(errorSpy).not.toHaveBeenCalled();
    const [tag, payload] = warnSpy.mock.calls[0];
    expect(tag).toBe('[safe-image][rejected]');
    expect(payload).toEqual({
      callSite: 'test.site', reason: 'image_format_not_allowed', byteLength: SVG.length, sniffedType: null, companyId: null,
    });
    expect(JSON.stringify(payload)).not.toMatch(/svg|xmlns/i);
  });

  it('a fetch failure is a source failure (warn), with HTTP status but no URL', async () => {
    const error = await caught(fetchUntrustedImageBytes(async () => {
      throw new Error('Image download failed with 404');
    }));
    expect(error).toBeInstanceOf(ImageSourceUnavailableError);
    expect(reportImageFailure(error, { callSite: 'test.fetch' })).toBe('source_unavailable');
    expect(warnSpy.mock.calls[0][1]).toEqual({ callSite: 'test.fetch', causeName: 'Error', httpStatus: 404, companyId: null });
  });
});

describe('F — well-formed images still decode; pipelines are disposed', () => {
  it.each(['png', 'jpeg', 'webp', 'gif'] as const)('%s decodes and resizes', async (format) => {
    const bytes = await solid(format, 40, 20);
    const { image, info } = await openUntrustedImage(bytes);
    image.destroy();
    expect(info).toMatchObject({ format, width: 40, height: 20 });
    const out = await transformUntrustedImage(bytes, (img) => img.resize(10, 5).png().toBuffer());
    const meta = await sharp(out).metadata();
    expect(meta).toMatchObject({ format: 'png', width: 10, height: 5 });
  });

  it('a 1x1 PNG (the compose-lane fixture) decodes', async () => {
    const onePx = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==',
      'base64',
    );
    const opened = await openUntrustedImage(onePx);
    opened.image.destroy();
    expect(opened.info).toMatchObject({ format: 'png', width: 1, height: 1 });
  });

  it('transformUntrustedImage disposes the pipeline after success', async () => {
    const fake = fakeSharp({});
    await transformUntrustedImage(await solid('png'), (image) => image.toBuffer(), { sharp: fake.factory });
    expect(fake.state.destroyed).toBe(1);
  });

  it('the helper creates no temp files (no fs write API is referenced)', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const src = require('fs').readFileSync(require('path').resolve(__dirname, '../../../lib/security/safeImageDecode.ts'), 'utf8');
    expect(src).not.toMatch(/from 'fs'|require\('fs'\)|writeFile|mkdtemp|tmpdir/);
  });
});
