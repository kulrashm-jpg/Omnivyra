/**
 * MEDIA-H3 — quarantine validation + promotion service
 * (backend/services/activityWorkspace/quarantinedMediaUpload.ts).
 *
 * Storage is the in-memory stand-in (helpers/memoryStorage); sharp is REAL, so
 * the image cases exercise libvips through lib/security/safeImageDecode.
 */
import {
  createMemoryStorage, MP4, MP3_ID3, TIFF_LE, RANDOM, HTML, SVG, pixelBombPng,
} from '../helpers/memoryStorage';

const mockMem = createMemoryStorage(['media-uploads']);
jest.mock('../../db/supabaseClient', () => ({ supabase: { storage: { from: (b: string) => mockMem.storage.from(b) } } }));

import {
  QUARANTINE_BUCKET, DELIVERY_BUCKET, MAX_QUARANTINE_BYTES,
  mintQuarantineObjectPath, validateQuarantinedMedia, promoteQuarantinedMedia,
  appendConsumedObjectPath, CONSUMED_SESSIONS_CAP, sha256Hex,
} from '../../services/activityWorkspace/quarantinedMediaUpload';
import { isActivityObjectPath } from '../../services/activityWorkspace/activityObjectPath';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const sharp = require('sharp');

const KEY = 'company-a/plan-a/video/1700000000000-0123456789abcdef0123456789abcdef.mp4';
const realFetch = (global as any).fetch;

beforeEach(() => {
  mockMem.reset();
  (global as any).fetch = jest.fn(mockMem.fetchImpl);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => { (global as any).fetch = realFetch; jest.restoreAllMocks(); });

const validate = (declaredMime: string, expectedCategory: 'video' | 'audio' | 'image' = 'video', objectPath = KEY) =>
  validateQuarantinedMedia({ objectPath, declaredMime, expectedCategory, companyId: 'company-a', sharp });

describe('mintQuarantineObjectPath', () => {
  it('mints a server-chosen, tenant-scoped, unguessable key that the finalize scope check accepts', () => {
    const a = mintQuarantineObjectPath({ companyId: 'company-a', activityId: 'plan-a', mime: 'video/mp4' });
    const b = mintQuarantineObjectPath({ companyId: 'company-a', activityId: 'plan-a', mime: 'video/mp4' });
    expect(a.objectPath).toMatch(/^company-a\/plan-a\/video\/\d+-[0-9a-f]{32}\.mp4$/);
    expect(a.objectPath).not.toBe(b.objectPath);
    expect(isActivityObjectPath(a.objectPath, 'plan-a', 'company-a')).toBe(true);
    expect(isActivityObjectPath(a.objectPath, 'plan-a', 'company-b')).toBe(false);
  });
});

describe('validateQuarantinedMedia — stored bytes and stored metadata, never the claim', () => {
  it('genuine mp4 → ok, size from storage (not the client)', async () => {
    mockMem.put(QUARANTINE_BUCKET, KEY, MP4, 'video/mp4');
    const r = await validate('video/mp4');
    expect(r).toEqual({ ok: true, category: 'video', mime: 'video/mp4', sizeBytes: MP4.length, headSha256: sha256Hex(MP4.subarray(0, 32)) });
    // Read through a short-lived signed URL with a Range header — the bucket is private.
    expect(mockMem.events.some((e) => e.startsWith(`sign:${QUARANTINE_BUCKET}:${KEY}:60`))).toBe(true);
  });
  it('genuine mp3 for an audio row → ok', async () => {
    mockMem.put(QUARANTINE_BUCKET, KEY, MP3_ID3, 'audio/mpeg');
    expect((await validate('audio/mpeg', 'audio')).ok).toBe(true);
  });
  it.each([
    ['TIFF declared video/mp4 (the R-C1 / optimizer path)', TIFF_LE],
    ['random bytes declared video/mp4', RANDOM],
    ['HTML declared video/mp4', HTML],
    ['SVG declared video/mp4', SVG],
    ['a PNG declared video/mp4 (extension/MIME spoof)', pixelBombPng(10, 10)],
    ['audio bytes declared video/mp4', MP3_ID3],
  ])('%s → 415 UPLOAD_MIME_SPOOF, discard', async (_n, bytes) => {
    mockMem.put(QUARANTINE_BUCKET, KEY, bytes, 'video/mp4');
    const r = await validate('video/mp4');
    expect(r).toMatchObject({ ok: false, status: 415, code: 'UPLOAD_MIME_SPOOF', discard: true });
  });
  it('stored Content-Type differs from the declared type (e.g. text/html set in TUS metadata) → 415, discard', async () => {
    mockMem.put(QUARANTINE_BUCKET, KEY, MP4, 'text/html');
    expect(await validate('video/mp4')).toMatchObject({ ok: false, status: 415, code: 'UPLOAD_STORED_TYPE_MISMATCH', discard: true });
  });
  it('declared type outside the allowlist (image/tiff) → 415 even if stored type agrees', async () => {
    mockMem.put(QUARANTINE_BUCKET, KEY, TIFF_LE, 'image/tiff');
    expect(await validate('image/tiff', 'image')).toMatchObject({ ok: false, status: 415, discard: true });
  });
  it('declared type in the wrong category → 415 UPLOAD_MIME_MISMATCH', async () => {
    mockMem.put(QUARANTINE_BUCKET, KEY, MP3_ID3, 'audio/mpeg');
    expect(await validate('audio/mpeg', 'video')).toMatchObject({ ok: false, status: 415, code: 'UPLOAD_MIME_MISMATCH' });
  });
  it('empty stored object → 400 discard', async () => {
    mockMem.put(QUARANTINE_BUCKET, KEY, Buffer.alloc(0), 'video/mp4');
    expect(await validate('video/mp4')).toMatchObject({ ok: false, status: 400, code: 'UPLOAD_EMPTY', discard: true });
  });
  it('oversized STORED object (client claimed small) → 413 discard', async () => {
    mockMem.put(QUARANTINE_BUCKET, KEY, MP4, 'video/mp4');
    mockMem.faults.sizeOverride = MAX_QUARANTINE_BYTES + 1;
    expect(await validate('video/mp4')).toMatchObject({ ok: false, status: 413, code: 'UPLOAD_TOO_LARGE', discard: true });
  });
  it('no object (upload never completed / wrong key) → 404, NOT discarded', async () => {
    expect(await validate('video/mp4')).toMatchObject({ ok: false, status: 404, code: 'UPLOAD_OBJECT_NOT_FOUND', discard: false });
  });
  it('storage metadata read failure → 503 transient, object kept for retry', async () => {
    mockMem.put(QUARANTINE_BUCKET, KEY, MP4, 'video/mp4');
    mockMem.faults.info = 'upstream timeout';
    expect(await validate('video/mp4')).toMatchObject({ ok: false, status: 503, code: 'UPLOAD_INSPECT_FAILED', discard: false });
    expect(mockMem.has(QUARANTINE_BUCKET, KEY)).toBe(true);
  });
});

describe('validateQuarantinedMedia — images go through safeImageDecode (real sharp)', () => {
  const IMG_KEY = 'company-a/plan-a/image/1700000000000-0123456789abcdef0123456789abcdef.png';
  it('valid PNG → ok, re-encoded bytes (the delivered object is decoder output)', async () => {
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#336699' } })
      .withMetadata({ exif: { IFD0: { Copyright: 'tracking-id-123' } } }).png().toBuffer();
    mockMem.put(QUARANTINE_BUCKET, IMG_KEY, png, 'image/png');
    const r = await validate('image/png', 'image', IMG_KEY);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.mime).toBe('image/png');
      expect(r.normalized).toBeInstanceOf(Buffer);
      const meta = await sharp(r.normalized).metadata();
      expect([meta.format, meta.width, meta.height]).toEqual(['png', 8, 8]);
      expect(meta.exif).toBeUndefined();
    }
  });
  it('pixel bomb (50000x50000 declared) → 415 UPLOAD_IMAGE_REJECTED before any pixel decode', async () => {
    mockMem.put(QUARANTINE_BUCKET, IMG_KEY, pixelBombPng(), 'image/png');
    expect(await validate('image/png', 'image', IMG_KEY)).toMatchObject({ ok: false, status: 415, code: 'UPLOAD_IMAGE_REJECTED', discard: true });
  });
  it('malformed PNG (valid signature, truncated body) → 415, discard', async () => {
    const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#000' } }).png().toBuffer();
    mockMem.put(QUARANTINE_BUCKET, IMG_KEY, png.subarray(0, 40), 'image/png');
    expect(await validate('image/png', 'image', IMG_KEY)).toMatchObject({ ok: false, status: 415, discard: true });
  });
  it('JPEG bytes declared image/png → 415 UPLOAD_MIME_SPOOF', async () => {
    const jpg = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000' } }).jpeg().toBuffer();
    mockMem.put(QUARANTINE_BUCKET, IMG_KEY, jpg, 'image/png');
    expect(await validate('image/png', 'image', IMG_KEY)).toMatchObject({ ok: false, code: 'UPLOAD_MIME_SPOOF' });
  });
  it('SVG/TIFF declared as image/png → 415 (never reaches a libvips loader)', async () => {
    for (const bytes of [SVG, TIFF_LE]) {
      mockMem.put(QUARANTINE_BUCKET, IMG_KEY, bytes, 'image/png');
      expect(await validate('image/png', 'image', IMG_KEY)).toMatchObject({ ok: false, status: 415 });
    }
  });
  it('image over the 25 MiB decode cap → 413 without downloading', async () => {
    mockMem.put(QUARANTINE_BUCKET, IMG_KEY, Buffer.concat([pixelBombPng(10, 10), Buffer.alloc(26 * 1024 * 1024)]), 'image/png');
    expect(await validate('image/png', 'image', IMG_KEY)).toMatchObject({ ok: false, status: 413 });
    expect(mockMem.events.some((e) => e.startsWith('download:'))).toBe(false);
  });
});

describe('promoteQuarantinedMedia', () => {
  it('moves quarantine → delivery under the same key; quarantine copy is gone', async () => {
    mockMem.put(QUARANTINE_BUCKET, KEY, MP4, 'video/mp4');
    const v = await validate('video/mp4');
    expect(v.ok).toBe(true);
    const p = await promoteQuarantinedMedia({ objectPath: KEY, validated: v as any });
    expect(p).toEqual({ ok: true, deliveryPath: KEY, alreadyPromoted: false });
    expect(mockMem.has(DELIVERY_BUCKET, KEY)).toBe(true);
    expect(mockMem.has(QUARANTINE_BUCKET, KEY)).toBe(false);
    expect(mockMem.objects.get(`${DELIVERY_BUCKET}/${KEY}`)?.contentType).toBe('video/mp4');
  });
  it('promotion failure → ok:false, nothing public, quarantined object kept for retry', async () => {
    mockMem.put(QUARANTINE_BUCKET, KEY, MP4, 'video/mp4');
    const v = await validate('video/mp4');
    mockMem.faults.move = 'storage unavailable';
    const p = await promoteQuarantinedMedia({ objectPath: KEY, validated: v as any });
    expect(p.ok).toBe(false);
    expect(mockMem.has(DELIVERY_BUCKET, KEY)).toBe(false);
    expect(mockMem.has(QUARANTINE_BUCKET, KEY)).toBe(true);
    delete mockMem.faults.move;
    expect(await promoteQuarantinedMedia({ objectPath: KEY, validated: v as any })).toMatchObject({ ok: true, alreadyPromoted: false });
  });
  it('a concurrent duplicate (delivery already holds the key) → NOT adopted by the service (unproven), no overwrite, nothing deleted', async () => {
    // J1 H3-1: the real race - validated here, then a concurrent winner's MOVE consumed the source.
    // H3-FIX (F-H3-1): a consumed source + equal size/type/head does not PROVE a
    // move (a planted object passes the same checks), so the service never
    // adopts a non-image; the route accepts it only on a committed row.
    mockMem.put(QUARANTINE_BUCKET, KEY, MP4, 'video/mp4');
    const v = await validate('video/mp4');
    await mockMem.storage.from(QUARANTINE_BUCKET).move(KEY, KEY, { destinationBucket: DELIVERY_BUCKET });
    expect(await promoteQuarantinedMedia({ objectPath: KEY, validated: v as any })).toMatchObject({ ok: false, unproven: true });
    expect(mockMem.objects.get(`${DELIVERY_BUCKET}/${KEY}`)?.bytes.equals(MP4)).toBe(true);
    expect(mockMem.events.some((e) => e.startsWith(`remove:${DELIVERY_BUCKET}:`))).toBe(false);
    expect(mockMem.has(QUARANTINE_BUCKET, KEY)).toBe(false);
  });
  it('images: uploads the NORMALIZED bytes (upsert:false) and removes the quarantined original', async () => {
    const IMG = 'company-a/plan-a/image/1700000000000-0123456789abcdef0123456789abcdef.png';
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } }).png().toBuffer();
    mockMem.put(QUARANTINE_BUCKET, IMG, png, 'image/png');
    const v = await validate('image/png', 'image', IMG);
    const p = await promoteQuarantinedMedia({ objectPath: IMG, validated: v as any });
    expect(p.ok).toBe(true);
    expect(mockMem.objects.get(`${DELIVERY_BUCKET}/${IMG}`)?.bytes.equals((v as any).normalized)).toBe(true);
    expect(mockMem.has(QUARANTINE_BUCKET, IMG)).toBe(false);
  });
});

describe('J1 H3-1 - promotion never adopts a delivery object it did not validate', () => {
  const IMG = 'company-a/plan-a/image/1700000000000-0123456789abcdef0123456789abcdef.png';
  const conflictLogged = (spy: jest.SpyInstance) =>
    spy.mock.calls.some((c) => String(c[0]).includes('[security][media-h3]') && (c[1] as any)?.event === 'media_h3_delivery_conflict');

  it('ATTACK (video): valid quarantined file + arbitrary bytes pre-planted at the delivery key -> conflict, planted bytes untouched, quarantine kept private', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockMem.put(QUARANTINE_BUCKET, KEY, MP4, 'video/mp4');
    mockMem.put(DELIVERY_BUCKET, KEY, RANDOM, 'video/mp4');
    const v = await validate('video/mp4');
    expect(v.ok).toBe(true);
    const p = await promoteQuarantinedMedia({ objectPath: KEY, validated: v as any });
    expect(p).toMatchObject({ ok: false, conflict: true });
    expect(mockMem.objects.get(`${DELIVERY_BUCKET}/${KEY}`)?.bytes.equals(RANDOM)).toBe(true);
    expect(mockMem.has(QUARANTINE_BUCKET, KEY)).toBe(true);
    expect(mockMem.events.some((e) => e.startsWith(`remove:${DELIVERY_BUCKET}:`))).toBe(false);
    expect(conflictLogged(errSpy)).toBe(true);
  });
  it('ATTACK (video): identical size + type + head, different tail, quarantine source not consumed -> conflict', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockMem.put(QUARANTINE_BUCKET, KEY, MP4, 'video/mp4');
    const planted = Buffer.from(MP4); planted[planted.length - 1] ^= 0xff;
    mockMem.put(DELIVERY_BUCKET, KEY, planted, 'video/mp4');
    const v = await validate('video/mp4');
    const p = await promoteQuarantinedMedia({ objectPath: KEY, validated: v as any });
    expect(p).toMatchObject({ ok: false, conflict: true, reason: expect.stringContaining('quarantine_source_not_consumed') });
  });
  it('ATTACK (video): quarantine source gone but delivery head bytes differ -> conflict', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockMem.put(QUARANTINE_BUCKET, KEY, MP4, 'video/mp4');
    const v = await validate('video/mp4');
    mockMem.objects.delete(`${QUARANTINE_BUCKET}/${KEY}`);
    const planted = Buffer.from(MP4); planted[0] = 0x7f;
    mockMem.put(DELIVERY_BUCKET, KEY, planted, 'video/mp4');
    expect(await promoteQuarantinedMedia({ objectPath: KEY, validated: v as any })).toMatchObject({ ok: false, conflict: true, reason: expect.stringContaining('head_sha256_differs') });
  });
  it.each([
    ['different size', Buffer.concat([MP4, Buffer.alloc(1)]), 'video/mp4', 'size_differs'],
    ['different content type', MP4, 'text/html', 'content_type_differs'],
  ])('ATTACK (video): %s at the delivery key -> conflict', async (_n, bytes, type, reason) => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockMem.put(QUARANTINE_BUCKET, KEY, MP4, 'video/mp4');
    mockMem.put(DELIVERY_BUCKET, KEY, bytes as Buffer, type as string);
    const v = await validate('video/mp4');
    expect(await promoteQuarantinedMedia({ objectPath: KEY, validated: v as any })).toMatchObject({ ok: false, conflict: true, reason: expect.stringContaining(reason as string) });
  });
  it('ATTACK (image): planted bytes of the same length and type but a different sha256 -> conflict', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } }).png().toBuffer();
    mockMem.put(QUARANTINE_BUCKET, IMG, png, 'image/png');
    const v = await validate('image/png', 'image', IMG);
    expect(v.ok).toBe(true);
    const planted = Buffer.from((v as any).normalized); planted[planted.length - 5] ^= 0xff;
    mockMem.put(DELIVERY_BUCKET, IMG, planted, 'image/png');
    expect(await promoteQuarantinedMedia({ objectPath: IMG, validated: v as any })).toMatchObject({ ok: false, conflict: true, reason: expect.stringContaining('sha256_differs') });
    expect(mockMem.objects.get(`${DELIVERY_BUCKET}/${IMG}`)?.bytes.equals(planted)).toBe(true);
  });
  it('image race: delivery already holds exactly the re-encoded bytes -> alreadyPromoted', async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } }).png().toBuffer();
    mockMem.put(QUARANTINE_BUCKET, IMG, png, 'image/png');
    const v = await validate('image/png', 'image', IMG);
    mockMem.put(DELIVERY_BUCKET, IMG, Buffer.from((v as any).normalized), 'image/png');
    expect(await promoteQuarantinedMedia({ objectPath: IMG, validated: v as any })).toEqual({ ok: true, deliveryPath: IMG, alreadyPromoted: true });
    expect(mockMem.has(QUARANTINE_BUCKET, IMG)).toBe(false);
  });
  it('delivery metadata unreadable after a failed move -> transient failure (not adopted, not a conflict)', async () => {
    mockMem.put(QUARANTINE_BUCKET, KEY, MP4, 'video/mp4');
    const v = await validate('video/mp4');
    mockMem.put(DELIVERY_BUCKET, KEY, MP4, 'video/mp4');
    mockMem.faults.info = 'upstream timeout';
    const p = await promoteQuarantinedMedia({ objectPath: KEY, validated: v as any });
    expect(p.ok).toBe(false);
    expect((p as any).conflict).toBeUndefined();
  });
});

describe('quarantine is not publicly readable (storage stand-in semantics)', () => {
  it('a public URL for a quarantined key serves nothing; a delivery object is public only after promotion', async () => {
    mockMem.put(QUARANTINE_BUCKET, KEY, TIFF_LE, 'video/mp4');
    expect(mockMem.serve(`https://storage.test/storage/v1/object/public/${QUARANTINE_BUCKET}/${KEY}`).status).toBe(400);
    expect(mockMem.serve(`https://storage.test/storage/v1/object/public/${DELIVERY_BUCKET}/${KEY}`).status).toBe(404);
    const v = await validate('video/mp4');
    expect(v.ok).toBe(false);
    expect(mockMem.serve(`https://storage.test/storage/v1/object/public/${DELIVERY_BUCKET}/${KEY}`).status).toBe(404);
  });
});

describe('consumed-session bookkeeping', () => {
  it('appends without duplicates and is bounded', () => {
    let content: Record<string, unknown> = {};
    for (let i = 0; i < CONSUMED_SESSIONS_CAP + 5; i++) content = { upload_consumed_object_paths: appendConsumedObjectPath(content, `k${i}`) };
    const list = content.upload_consumed_object_paths as string[];
    expect(list).toHaveLength(CONSUMED_SESSIONS_CAP);
    expect(list[list.length - 1]).toBe(`k${CONSUMED_SESSIONS_CAP + 4}`);
    expect(appendConsumedObjectPath({ upload_consumed_object_paths: ['a', 'b'] }, 'a')).toEqual(['b', 'a']);
  });
});
