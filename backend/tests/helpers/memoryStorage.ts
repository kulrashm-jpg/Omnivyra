/**
 * MEDIA-H3 test helper — an in-memory, per-bucket stand-in for the slice of the
 * supabase-js Storage API the upload routes use (info, download,
 * createSignedUrl, createSignedUploadUrl, upload, move, remove, getPublicUrl).
 *
 * It models the two storage properties the remediation relies on:
 *   - `upload(..., { upsert: false })` and `move` REFUSE an existing key;
 *   - a private bucket has no public URL that serves bytes (only signed URLs).
 * It does NOT model RLS, signed-token verification, TUS, bucket MIME/size
 * enforcement or CDN behaviour; those are covered (where possible) by the PG
 * policy test and otherwise listed as unproven.
 */
export type StoredObject = { bytes: Buffer; contentType: string };

export function createMemoryStorage(publicBuckets: string[]) {
  const objects = new Map<string, StoredObject>();
  const events: string[] = [];
  const faults: { move?: string; info?: string; upload?: string; sign?: string; sizeOverride?: number } = {};
  const key = (b: string, p: string) => `${b}/${p}`;

  const bucketApi = (bucket: string) => ({
    async info(p: string) {
      events.push(`info:${bucket}:${p}`);
      if (faults.info) return { data: null, error: { message: faults.info } };
      const o = objects.get(key(bucket, p));
      if (!o) return { data: null, error: { message: 'Object not found' } };
      return { data: { size: faults.sizeOverride ?? o.bytes.length, contentType: o.contentType }, error: null };
    },
    async download(p: string) {
      events.push(`download:${bucket}:${p}`);
      const o = objects.get(key(bucket, p));
      if (!o) return { data: null, error: { message: 'Object not found' } };
      const b = o.bytes;
      return { data: { arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }, error: null };
    },
    async createSignedUrl(p: string, expiresIn: number) {
      events.push(`sign:${bucket}:${p}:${expiresIn}`);
      return { data: { signedUrl: `https://storage.test/storage/v1/object/sign/${bucket}/${p}?token=signed` }, error: null };
    },
    async createSignedUploadUrl(p: string, opts?: { upsert: boolean }) {
      events.push(`sign-upload:${bucket}:${p}:upsert=${String(opts?.upsert)}`);
      if (faults.sign) return { data: null, error: { message: faults.sign } };
      return { data: { signedUrl: `https://storage.test/storage/v1/object/upload/sign/${bucket}/${p}?token=tok`, token: `tok:${bucket}:${p}`, path: p }, error: null };
    },
    async upload(p: string, body: Buffer, opts?: { contentType?: string; upsert?: boolean }) {
      events.push(`upload:${bucket}:${p}`);
      if (faults.upload) return { data: null, error: { message: faults.upload } };
      if (!opts?.upsert && objects.has(key(bucket, p))) return { data: null, error: { message: 'The resource already exists' } };
      objects.set(key(bucket, p), { bytes: Buffer.from(body), contentType: opts?.contentType ?? 'application/octet-stream' });
      return { data: { path: p }, error: null };
    },
    async move(from: string, to: string, opts?: { destinationBucket?: string }) {
      const dest = opts?.destinationBucket ?? bucket;
      events.push(`move:${bucket}:${from}->${dest}:${to}`);
      if (faults.move) return { data: null, error: { message: faults.move } };
      const o = objects.get(key(bucket, from));
      if (!o) return { data: null, error: { message: 'Object not found' } };
      if (objects.has(key(dest, to))) return { data: null, error: { message: 'The resource already exists' } };
      objects.delete(key(bucket, from));
      objects.set(key(dest, to), o);
      return { data: { message: 'Successfully moved' }, error: null };
    },
    async remove(paths: string[]) {
      events.push(`remove:${bucket}:${paths.join(',')}`);
      for (const p of paths) objects.delete(key(bucket, p));
      return { data: [], error: null };
    },
    getPublicUrl(p: string) {
      return { data: { publicUrl: `https://storage.test/storage/v1/object/public/${bucket}/${p}` } };
    },
  });

  /** What an anonymous GET of a URL returns: public buckets serve bytes; private ones do not. Signed URLs serve. */
  function serve(url: string, range?: string): { status: number; body: Buffer } {
    const m = /\/storage\/v1\/object\/(public|sign)\/([^/]+)\/([^?]+)/.exec(url);
    if (!m) return { status: 404, body: Buffer.alloc(0) };
    const [, kind, bucket, p] = m;
    if (kind === 'public' && !publicBuckets.includes(bucket)) return { status: 400, body: Buffer.alloc(0) };
    const o = objects.get(key(bucket, decodeURIComponent(p)));
    if (!o) return { status: 404, body: Buffer.alloc(0) };
    const r = range ? /bytes=(\d+)-(\d+)/.exec(range) : null;
    if (r) return { status: 206, body: o.bytes.subarray(Number(r[1]), Number(r[2]) + 1) };
    return { status: 200, body: o.bytes };
  }

  const fetchImpl = async (url: string, init?: { headers?: Record<string, string> }) => {
    const { status, body } = serve(String(url), init?.headers?.range);
    events.push(`fetch:${status}:${url}`);
    // A real fetch Response (stream body + Content-Length): bounded readers
    // (lib/security/boundedBodyRead) read it the way they read storage-api.
    return new Response(status === 204 ? null : new Uint8Array(body), { status, headers: { 'content-length': String(body.length) } });
  };

  return {
    objects, events, faults, serve, fetchImpl,
    storage: { from: (bucket: string) => bucketApi(bucket) },
    put(bucket: string, p: string, bytes: Buffer, contentType: string) { objects.set(key(bucket, p), { bytes, contentType }); },
    has(bucket: string, p: string) { return objects.has(key(bucket, p)); },
    reset() { objects.clear(); events.length = 0; delete faults.move; delete faults.info; delete faults.upload; delete faults.sign; delete faults.sizeOverride; },
  };
}

// ── byte fixtures ────────────────────────────────────────────────────────────
export const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom'), Buffer.alloc(40, 1)]);
export const MP3_ID3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(40, 2)]);
export const TIFF_LE = Buffer.concat([Buffer.from([0x49, 0x49, 0x2a, 0x00]), Buffer.alloc(40, 3)]);
export const RANDOM = Buffer.from(Array.from({ length: 48 }, (_, i) => (i * 37 + 11) & 0xff));
export const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const HTML = Buffer.from('<!doctype html><script>alert(1)</script>');
export const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** A structurally valid PNG whose header DECLARES huge dimensions (a pixel bomb) with almost no data. */
export function pixelBombPng(width = 50000, height = 50000): Buffer {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const zlib = require('zlib');
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([PNG_SIG, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.alloc(16))), chunk('IEND', Buffer.alloc(0))]);
}
