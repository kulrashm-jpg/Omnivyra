/**
 * H-3 review (Agent A) — READ-ONLY revalidation of objects already sitting in
 * the PUBLIC `media-uploads` bucket (written before MEDIA-H3 by the browser
 * with the publishable key, i.e. never validated server-side).
 *
 * Pure core with injected I/O so it can be tested against an in-memory store.
 * The CLI (scripts/ops/media-uploads-revalidate.ts) defaults to a dry-run
 * report. The only write it can perform (`copyToReview`) COPIES flagged
 * objects into a PRIVATE review bucket; it never deletes, moves, overwrites or
 * changes the visibility of anything in `media-uploads`. Removing an object
 * from public delivery is a separate, owner-approved manual step.
 *
 * Classification flags per object (an object can carry several):
 *   has_provenance        a daily_content_plans row records this exact key with
 *                         upload_quarantine_promoted=true (MEDIA-H3 finalize)
 *   no_provenance         none does — the bytes were never validated by H-3
 *   publicly_accessible   the bucket is public (every object is world-readable)
 *   format_mismatch       magic bytes disagree with the stored mimetype
 *   unrecognized_bytes    bytes match no allowed signature at all
 *   undecodable           image bytes are refused by the safe decoder gate
 *   read_failed           head bytes could not be read (transient; re-run)
 */
import { nonImageBytesMatchDeclaredType } from '../../../lib/security/mediaByteSignature';
import { sniffSafeImageMime } from '../../../lib/security/safeImageDecode';

export type StoredObject = {
  name: string;
  size: number | null;
  mimetype: string | null;
  createdAt: string | null;
};

export type RevalidationIO = {
  /** Paginated listing; returns [] when exhausted. Recursive keys (prefix/a/b.mp4). */
  listObjects(bucket: string, offset: number, limit: number): Promise<StoredObject[]>;
  bucketIsPublic(bucket: string): Promise<boolean | null>;
  /** First `n` bytes, or null on read failure. */
  readHead(bucket: string, name: string, n: number): Promise<Buffer | null>;
  /** Full bytes for small images only (decode check); null on failure. */
  readAll?(bucket: string, name: string): Promise<Buffer | null>;
  /** Set of object keys that carry H-3 provenance. */
  provenanceKeys(): Promise<Set<string>>;
  /** Optional decode probe for images (throws/false = undecodable). */
  imageDecodes?(bytes: Buffer): Promise<boolean>;
  /** Copy into a PRIVATE review bucket. Must refuse to overwrite. */
  copyToReview?(srcBucket: string, name: string, reviewBucket: string, reviewKey: string): Promise<{ ok: boolean; message?: string }>;
};

export type ObjectFlag =
  | 'has_provenance' | 'no_provenance' | 'publicly_accessible'
  | 'format_mismatch' | 'unrecognized_bytes' | 'undecodable' | 'read_failed';

export type ObjectReport = {
  name: string;
  prefix: string;
  size: number | null;
  mimetype: string | null;
  createdAt: string | null;
  sniffed: string | null;
  flags: ObjectFlag[];
  copied?: { ok: boolean; reviewKey: string; message?: string };
};

export type RevalidationReport = {
  bucket: string;
  mode: 'dry-run' | 'copy-to-review';
  bucketPublic: boolean | null;
  scanned: number;
  counts: Record<ObjectFlag, number>;
  byPrefix: Record<string, number>;
  flaggedForReview: number;
  objects: ObjectReport[];
};

export const HEAD_BYTES = 32;
export const DECODE_MAX_BYTES = 25 * 1024 * 1024;
const ALL_FLAGS: ObjectFlag[] = ['has_provenance', 'no_provenance', 'publicly_accessible', 'format_mismatch', 'unrecognized_bytes', 'undecodable', 'read_failed'];

function norm(m: string | null): string {
  return String(m ?? '').trim().toLowerCase().split(';')[0].trim();
}

/** What the bytes are, as far as the repo's strict signature checks can say. */
export function sniffAllowed(head: Buffer): string | null {
  const image = sniffSafeImageMime(head);
  if (image) return image;
  for (const candidate of ['video/mp4', 'video/webm', 'video/quicktime', 'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'application/pdf']) {
    if (nonImageBytesMatchDeclaredType(head, candidate)) return candidate.split('/')[0] === 'video' ? 'video/*' : candidate.split('/')[0] === 'audio' ? 'audio/*' : candidate;
  }
  return null;
}

export function classifyBytes(head: Buffer, storedMime: string | null): { sniffed: string | null; flags: ObjectFlag[] } {
  const declared = norm(storedMime);
  const sniffed = sniffAllowed(head);
  const flags: ObjectFlag[] = [];
  if (!sniffed) {
    flags.push('unrecognized_bytes');
    return { sniffed, flags };
  }
  const declaredTop = declared.split('/')[0];
  let matches: boolean;
  if (declaredTop === 'image') matches = sniffed === declared;
  else if (declaredTop === 'video' || declaredTop === 'audio' || declared === 'application/pdf') matches = nonImageBytesMatchDeclaredType(head, declared);
  else matches = false;
  if (!matches) flags.push('format_mismatch');
  return { sniffed, flags };
}

export function needsReview(flags: ObjectFlag[]): boolean {
  return flags.some((f) => f === 'no_provenance' || f === 'format_mismatch' || f === 'unrecognized_bytes' || f === 'undecodable');
}

export async function runRevalidation(io: RevalidationIO, options: {
  bucket?: string;
  mode?: 'dry-run' | 'copy-to-review';
  reviewBucket?: string;
  pageSize?: number;
  maxObjects?: number;
} = {}): Promise<RevalidationReport> {
  const bucket = options.bucket ?? 'media-uploads';
  const mode = options.mode ?? 'dry-run';
  const reviewBucket = options.reviewBucket ?? 'media-quarantine';
  if (mode === 'copy-to-review') {
    if (!io.copyToReview) throw new Error('copy-to-review requested but no copy implementation was provided');
    if (reviewBucket === bucket) throw new Error('review bucket must differ from the scanned bucket');
  }
  const pageSize = options.pageSize ?? 500;
  const maxObjects = options.maxObjects ?? Number.POSITIVE_INFINITY;

  const bucketPublic = await io.bucketIsPublic(bucket);
  if (mode === 'copy-to-review' && (await io.bucketIsPublic(reviewBucket)) !== false) {
    throw new Error(`review bucket "${reviewBucket}" is not verifiably private; refusing to copy`);
  }
  const provenance = await io.provenanceKeys();
  const counts = Object.fromEntries(ALL_FLAGS.map((f) => [f, 0])) as Record<ObjectFlag, number>;
  const byPrefix: Record<string, number> = {};
  const objects: ObjectReport[] = [];

  for (let offset = 0; objects.length < maxObjects; offset += pageSize) {
    const page = await io.listObjects(bucket, offset, pageSize);
    if (!page.length) break;
    for (const obj of page) {
      if (objects.length >= maxObjects) break;
      const prefix = obj.name.includes('/') ? obj.name.split('/')[0] : '(root)';
      byPrefix[prefix] = (byPrefix[prefix] ?? 0) + 1;
      const flags: ObjectFlag[] = [provenance.has(obj.name) ? 'has_provenance' : 'no_provenance'];
      if (bucketPublic !== false) flags.push('publicly_accessible');
      let sniffed: string | null = null;
      const head = await io.readHead(bucket, obj.name, HEAD_BYTES);
      if (!head) {
        flags.push('read_failed');
      } else {
        const c = classifyBytes(head, obj.mimetype);
        sniffed = c.sniffed;
        flags.push(...c.flags);
        if (sniffed?.startsWith('image/') && io.imageDecodes && io.readAll && (obj.size ?? 0) <= DECODE_MAX_BYTES) {
          const all = await io.readAll(bucket, obj.name);
          let decodes = false;
          if (all) { try { decodes = await io.imageDecodes(all); } catch { decodes = false; } }
          if (!all) flags.push('read_failed');
          else if (!decodes) flags.push('undecodable');
        } else if (sniffed?.startsWith('image/') && (obj.size ?? 0) > DECODE_MAX_BYTES) {
          flags.push('undecodable');
        }
      }
      for (const f of flags) counts[f] += 1;
      const report: ObjectReport = { name: obj.name, prefix, size: obj.size, mimetype: obj.mimetype, createdAt: obj.createdAt, sniffed, flags };
      if (mode === 'copy-to-review' && needsReview(flags) && io.copyToReview) {
        const reviewKey = `legacy-review/${bucket}/${obj.name}`;
        const r = await io.copyToReview(bucket, obj.name, reviewBucket, reviewKey);
        report.copied = { ok: r.ok, reviewKey, ...(r.message ? { message: r.message } : {}) };
      }
      objects.push(report);
    }
    if (page.length < pageSize) break;
  }
  return {
    bucket, mode, bucketPublic, scanned: objects.length, counts, byPrefix,
    flaggedForReview: objects.filter((o) => needsReview(o.flags)).length, objects,
  };
}
