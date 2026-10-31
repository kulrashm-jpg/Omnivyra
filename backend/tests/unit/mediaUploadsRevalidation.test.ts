/**
 * H-3 review (Agent A) — read-only revalidation classifier for legacy objects in
 * the public `media-uploads` bucket, against an in-memory store.
 */
import {
  DECODE_MAX_BYTES,
  classifyBytes,
  needsReview,
  runRevalidation,
  type RevalidationIO,
  type StoredObject,
} from '../../services/activityWorkspace/mediaUploadsRevalidation';
import { readBodyBounded, fetchBounded } from '../../../lib/security/boundedBodyRead';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40)]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(40)]);
const TIFF = Buffer.concat([Buffer.from('II*\u0000', 'latin1'), Buffer.alloc(40)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const HTML = Buffer.from('<!doctype html><script>alert(1)</script>');

type Entry = { obj: StoredObject; bytes: Buffer | null };

function memoryIO(entries: Entry[], opts: { public?: Record<string, boolean | null>; provenance?: string[]; decodes?: (b: Buffer) => boolean } = {}) {
  const writes: string[] = [];
  const review = new Map<string, Buffer>();
  const io: RevalidationIO & { writes: string[]; review: Map<string, Buffer> } = {
    writes,
    review,
    async listObjects(_bucket, offset, limit) { return entries.slice(offset, offset + limit).map((e) => e.obj); },
    async bucketIsPublic(bucket) { return opts.public && bucket in opts.public ? opts.public[bucket] : bucket === 'media-uploads'; },
    async readHead(_b, name, n) { const e = entries.find((x) => x.obj.name === name); return e?.bytes ? e.bytes.subarray(0, n) : null; },
    async readAll(_b, name) { return entries.find((x) => x.obj.name === name)?.bytes ?? null; },
    async provenanceKeys() { return new Set(opts.provenance ?? []); },
    async imageDecodes(bytes) { return opts.decodes ? opts.decodes(bytes) : true; },
    async copyToReview(src, name, reviewBucket, reviewKey) {
      writes.push(`copy ${src}/${name} -> ${reviewBucket}/${reviewKey}`);
      if (review.has(reviewKey)) return { ok: false, message: 'exists' };
      review.set(reviewKey, entries.find((x) => x.obj.name === name)!.bytes!);
      return { ok: true };
    },
  };
  return io;
}

const o = (name: string, mimetype: string | null, size = 100): StoredObject => ({ name, mimetype, size, createdAt: '2026-10-01T00:00:00Z' });

describe('classifyBytes', () => {
  it('matching image / video → no byte flags', () => {
    expect(classifyBytes(PNG, 'image/png').flags).toEqual([]);
    expect(classifyBytes(MP4, 'video/mp4').flags).toEqual([]);
  });
  it('JPEG stored as image/png → format_mismatch', () => {
    expect(classifyBytes(JPEG, 'image/png')).toEqual({ sniffed: 'image/jpeg', flags: ['format_mismatch'] });
  });
  it('PNG stored as video/mp4 (the H-3 /_next/image vector) → format_mismatch', () => {
    expect(classifyBytes(PNG, 'video/mp4').flags).toEqual(['format_mismatch']);
  });
  it('TIFF / SVG / HTML → unrecognized_bytes whatever the stored type', () => {
    expect(classifyBytes(TIFF, 'video/mp4').flags).toEqual(['unrecognized_bytes']);
    expect(classifyBytes(SVG, 'image/png').flags).toEqual(['unrecognized_bytes']);
    expect(classifyBytes(HTML, 'text/html').flags).toEqual(['unrecognized_bytes']);
  });
  it('valid bytes with a non-media stored type (text/html) → format_mismatch', () => {
    expect(classifyBytes(PNG, 'text/html').flags).toEqual(['format_mismatch']);
  });
});

describe('runRevalidation (dry-run default)', () => {
  const entries: Entry[] = [
    { obj: o('c1/a1/video/good.mp4', 'video/mp4'), bytes: MP4 },
    { obj: o('c1/a1/video/spoof.mp4', 'video/mp4'), bytes: TIFF },
    { obj: o('a2/image/x.png', 'image/png'), bytes: JPEG },
    { obj: o('c2/a3/image/bad.png', 'image/png'), bytes: PNG },
    { obj: o('c2/a3/video/gone.mp4', 'video/mp4'), bytes: null },
  ];

  it('classifies every object, counts by flag and prefix, and performs ZERO writes', async () => {
    const io = memoryIO(entries, { provenance: ['c1/a1/video/good.mp4'], decodes: (b) => b !== PNG });
    const r = await runRevalidation(io);
    expect(r.mode).toBe('dry-run');
    expect(r.bucketPublic).toBe(true);
    expect(r.scanned).toBe(5);
    const byName = Object.fromEntries(r.objects.map((x) => [x.name, x.flags]));
    expect(byName['c1/a1/video/good.mp4']).toEqual(['has_provenance', 'publicly_accessible']);
    expect(byName['c1/a1/video/spoof.mp4']).toEqual(['no_provenance', 'publicly_accessible', 'unrecognized_bytes']);
    expect(byName['a2/image/x.png']).toEqual(['no_provenance', 'publicly_accessible', 'format_mismatch']);
    expect(byName['c2/a3/image/bad.png']).toEqual(['no_provenance', 'publicly_accessible', 'undecodable']);
    expect(byName['c2/a3/video/gone.mp4']).toEqual(['no_provenance', 'publicly_accessible', 'read_failed']);
    expect(r.counts.publicly_accessible).toBe(5);
    expect(r.counts.no_provenance).toBe(4);
    expect(r.byPrefix).toEqual({ c1: 2, a2: 1, c2: 2 });
    expect(r.flaggedForReview).toBe(4);
    expect(io.writes).toEqual([]);
  });

  it('paginates and honours maxObjects', async () => {
    const many: Entry[] = Array.from({ length: 7 }, (_, i) => ({ obj: o(`c/a/video/${i}.mp4`, 'video/mp4'), bytes: MP4 }));
    const r = await runRevalidation(memoryIO(many), { pageSize: 3 });
    expect(r.scanned).toBe(7);
    const capped = await runRevalidation(memoryIO(many), { pageSize: 3, maxObjects: 4 });
    expect(capped.scanned).toBe(4);
  });

  it('an unknown bucket visibility is treated as publicly accessible (fail closed)', async () => {
    const r = await runRevalidation(memoryIO(entries.slice(0, 1), { public: { 'media-uploads': null } }));
    expect(r.objects[0].flags).toContain('publicly_accessible');
  });

  it('needsReview: provenance + clean bytes is the only clean state', () => {
    expect(needsReview(['has_provenance', 'publicly_accessible'])).toBe(false);
    expect(needsReview(['no_provenance', 'publicly_accessible'])).toBe(true);
    expect(needsReview(['has_provenance', 'format_mismatch'])).toBe(true);
  });
});

describe('runRevalidation copy-to-review (non-destructive)', () => {
  const entries: Entry[] = [
    { obj: o('c1/a1/video/good.mp4', 'video/mp4'), bytes: MP4 },
    { obj: o('c1/a1/video/spoof.mp4', 'video/mp4'), bytes: TIFF },
  ];

  it('COPIES only flagged objects into the private review bucket; nothing is deleted or moved', async () => {
    const io = memoryIO(entries, { provenance: ['c1/a1/video/good.mp4'], public: { 'media-uploads': true, 'media-quarantine': false } });
    const r = await runRevalidation(io, { mode: 'copy-to-review' });
    expect(io.writes).toEqual(['copy media-uploads/c1/a1/video/spoof.mp4 -> media-quarantine/legacy-review/media-uploads/c1/a1/video/spoof.mp4']);
    expect(r.objects.find((x) => x.name.endsWith('spoof.mp4'))?.copied).toEqual({ ok: true, reviewKey: 'legacy-review/media-uploads/c1/a1/video/spoof.mp4' });
    expect(r.objects.find((x) => x.name.endsWith('good.mp4'))?.copied).toBeUndefined();
    // a re-run is idempotent: the copy refuses to overwrite and reports it
    const again = await runRevalidation(io, { mode: 'copy-to-review' });
    expect(again.objects.find((x) => x.name.endsWith('spoof.mp4'))?.copied?.ok).toBe(false);
  });

  it('refuses when the review bucket is public or of unknown visibility, or equals the scanned bucket', async () => {
    await expect(runRevalidation(memoryIO(entries, { public: { 'media-uploads': true, 'media-quarantine': true } }), { mode: 'copy-to-review' }))
      .rejects.toThrow(/not verifiably private/);
    await expect(runRevalidation(memoryIO(entries, { public: { 'media-uploads': true, 'media-quarantine': null } }), { mode: 'copy-to-review' }))
      .rejects.toThrow(/not verifiably private/);
    await expect(runRevalidation(memoryIO(entries), { mode: 'copy-to-review', reviewBucket: 'media-uploads' }))
      .rejects.toThrow(/must differ/);
  });
});

describe('J1 H3-4 - objects of unknown or excessive size are never read whole', () => {
  it('an image with NO size in the listing is flagged size_unknown (needs review) and is never fully read', async () => {
    const io = memoryIO([{ obj: { ...o('c/a/image/nosize.png', 'image/png'), size: null }, bytes: PNG }], { provenance: ['c/a/image/nosize.png'] });
    const readAll = jest.spyOn(io, 'readAll' as never);
    const r = await runRevalidation(io);
    expect(r.objects[0].flags).toContain('size_unknown');
    expect(readAll).not.toHaveBeenCalled();
    expect(needsReview(r.objects[0].flags)).toBe(true);
    expect(r.counts.size_unknown).toBe(1);
    expect(r.flaggedForReview).toBe(1);
  });
  it('a non-image with no size is also size_unknown (unknown is never 0)', async () => {
    const r = await runRevalidation(memoryIO([{ obj: { ...o('c/a/video/nosize.mp4', 'video/mp4'), size: null }, bytes: MP4 }], { provenance: ['c/a/video/nosize.mp4'] }));
    expect(r.objects[0].flags).toEqual(['has_provenance', 'publicly_accessible', 'size_unknown']);
  });
  it('readAll is asked for at most DECODE_MAX_BYTES; a too_large answer is undecodable and never decoded', async () => {
    const io = memoryIO([{ obj: o('c/a/image/liar.png', 'image/png', 100), bytes: PNG }]);
    const decode = jest.fn(async () => true);
    io.imageDecodes = decode;
    io.readAll = jest.fn(async () => 'too_large' as const);
    const r = await runRevalidation(io);
    expect(io.readAll).toHaveBeenCalledWith('media-uploads', 'c/a/image/liar.png', DECODE_MAX_BYTES);
    expect(r.objects[0].flags).toContain('undecodable');
    expect(decode).not.toHaveBeenCalled();
  });
  it('a misbehaving readAll that returns more than the cap is treated as undecodable, not decoded', async () => {
    const io = memoryIO([{ obj: o('c/a/image/big.png', 'image/png', 100), bytes: PNG }]);
    const decode = jest.fn(async () => true);
    io.imageDecodes = decode;
    io.readAll = jest.fn(async () => Buffer.alloc(DECODE_MAX_BYTES + 1));
    const r = await runRevalidation(io);
    expect(r.objects[0].flags).toContain('undecodable');
    expect(decode).not.toHaveBeenCalled();
  });
});

describe('J1 H3-4 / H3-5a - bounded body reads (lib/security/boundedBodyRead)', () => {
  /** A lazily generated body of `total` bytes in `chunk`-byte pieces; counts what was pulled. */
  function lazyBody(total: number, chunk = 64 * 1024, contentLength?: number) {
    let produced = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (produced >= total) { controller.close(); return; }
        const n = Math.min(chunk, total - produced);
        produced += n;
        controller.enqueue(new Uint8Array(n).fill(0x89));
      },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 });
    const headers = new Headers(contentLength === undefined ? {} : { 'content-length': String(contentLength) });
    return { resp: { status: 200, body: stream, headers }, pulled: () => produced, wasCancelled: () => cancelled };
  }

  it("mode 'fail': a body larger than the cap (no Content-Length) is aborted at the cap, not read whole", async () => {
    const GiB = 1024 * 1024 * 1024;
    const b = lazyBody(4 * GiB);
    const r = await readBodyBounded(b.resp as never, 1024 * 1024, 'fail');
    expect(r).toEqual({ ok: false, reason: 'too_large' });
    expect(b.pulled()).toBeLessThan(1024 * 1024 + 3 * 64 * 1024);
    expect(b.wasCancelled()).toBe(true);
  });
  it("mode 'fail': a declared Content-Length over the cap is refused before any read", async () => {
    const b = lazyBody(10, 10, 10 * 1024 * 1024);
    expect(await readBodyBounded(b.resp as never, 1024, 'fail')).toEqual({ ok: false, reason: 'too_large' });
    expect(b.pulled()).toBe(0);
  });
  it("mode 'fail': a body within the cap is returned whole", async () => {
    const b = lazyBody(5000, 1000);
    const r = await readBodyBounded(b.resp as never, 5000, 'fail');
    expect(r.ok && r.bytes.length).toBe(5000);
  });
  it("mode 'truncate': a server that ignores Range (200 + huge body) yields only the first n bytes", async () => {
    const b = lazyBody(1024 * 1024 * 1024, 64 * 1024);
    const r = await readBodyBounded(b.resp as never, 32, 'truncate');
    expect(r.ok && r.bytes.length).toBe(32);
    expect(b.pulled()).toBeLessThanOrEqual(2 * 64 * 1024);
    expect(b.wasCancelled()).toBe(true);
  });
  it('fetchBounded sends a Range one byte past the cap and aborts an over-cap 200 body', async () => {
    const b = lazyBody(512 * 1024 * 1024);
    const seen: Array<Record<string, string>> = [];
    const r = await fetchBounded('https://storage.test/x', 1000, 'fail', async (_u, init) => { seen.push(init.headers); return b.resp as never; });
    expect(seen[0]).toEqual({ range: 'bytes=0-1000' });
    expect(r).toEqual({ ok: false, reason: 'too_large' });
    expect(b.pulled()).toBeLessThan(1000 + 3 * 64 * 1024);
  });
  it('without a stream interface and without a declared length, nothing is buffered', async () => {
    const arrayBuffer = jest.fn(async () => new ArrayBuffer(10));
    expect(await readBodyBounded({ arrayBuffer } as never, 1024, 'fail')).toEqual({ ok: false, reason: 'read_failed' });
    expect(arrayBuffer).not.toHaveBeenCalled();
  });
});
