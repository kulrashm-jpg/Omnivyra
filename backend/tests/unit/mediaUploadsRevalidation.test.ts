/**
 * H-3 review (Agent A) — read-only revalidation classifier for legacy objects in
 * the public `media-uploads` bucket, against an in-memory store.
 */
import {
  classifyBytes,
  needsReview,
  runRevalidation,
  type RevalidationIO,
  type StoredObject,
} from '../../services/activityWorkspace/mediaUploadsRevalidation';

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
