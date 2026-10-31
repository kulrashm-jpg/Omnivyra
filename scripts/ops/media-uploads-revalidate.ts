#!/usr/bin/env tsx
/**
 * H-3 review (Agent A) — OWNER-RUN revalidation report for the public
 * `media-uploads` bucket. NOT run by the review; never run by CI.
 *
 * DEFAULT = DRY-RUN, READ-ONLY: lists objects, reads the first 32 bytes of each
 * through a 60 s signed URL, decodes small images through the safe decoder
 * gate in memory, looks up H-3 provenance (daily_content_plans rows whose
 * content records upload_quarantine_promoted=true for that exact key) and
 * writes a JSON report. It changes nothing.
 *
 *   npx tsx scripts/ops/media-uploads-revalidate.ts --out <report.json> [--max N] [--no-decode]
 *
 * OPTIONAL, NON-DESTRUCTIVE WRITE (explicit flags only):
 *   --copy-to-review --i-understand-this-writes-to <reviewBucket>
 *   server-side COPIES each flagged object to <reviewBucket>/legacy-review/media-uploads/<key>.
 *   The review bucket must exist and be PRIVATE (verified; refuses otherwise).
 *   Nothing in media-uploads is deleted, moved, overwritten or made private.
 *
 * Credentials: the server client (backend/db/supabaseClient) from the
 * environment of the operator's shell. Point it at the intended project
 * deliberately; this script prints the project host, never a key.
 * Exit: 0 report written, no flagged objects; 1 flagged objects present; 2 failure.
 */
import { writeFileSync } from 'node:fs';
import { supabase } from '../../backend/db/supabaseClient';
import {
  runRevalidation,
  type RevalidationIO,
  type StoredObject,
} from '../../backend/services/activityWorkspace/mediaUploadsRevalidation';
import { transformUntrustedImage } from '../../lib/security/safeImageDecode';

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const value = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };

const BUCKET = 'media-uploads';
const out = value('--out');
const max = value('--max') ? Number(value('--max')) : undefined;
const copy = flag('--copy-to-review');
const reviewBucket = value('--i-understand-this-writes-to');

async function listAll(bucket: string): Promise<StoredObject[]> {
  const result: StoredObject[] = [];
  const queue = [''];
  while (queue.length) {
    const prefix = queue.shift()!;
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } });
      if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);
      const rows = data ?? [];
      for (const row of rows) {
        const key = prefix ? `${prefix}/${row.name}` : row.name;
        if (!row.id) { queue.push(key); continue; } // folder placeholder
        const meta = (row.metadata ?? {}) as { size?: number; mimetype?: string };
        result.push({ name: key, size: typeof meta.size === 'number' ? meta.size : null, mimetype: meta.mimetype ?? null, createdAt: row.created_at ?? null });
        if (max && result.length >= max) return result;
      }
      if (rows.length < 1000) break;
    }
  }
  return result;
}

async function provenanceKeys(): Promise<Set<string>> {
  const keys = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('daily_content_plans')
      .select('id, content')
      .like('content', '%"upload_quarantine_promoted":true%')
      .range(from, from + 999);
    if (error) throw new Error(`provenance query: ${error.message}`);
    for (const row of (data ?? []) as Array<{ content: unknown }>) {
      try {
        const c = typeof row.content === 'string' ? JSON.parse(row.content) : row.content;
        if (c?.upload_quarantine_promoted === true && c?.upload_storage_bucket === BUCKET && typeof c?.upload_storage_object_path === 'string') {
          keys.add(c.upload_storage_object_path);
        }
      } catch { /* unparsable content: no provenance */ }
    }
    if (!data || data.length < 1000) break;
  }
  return keys;
}

async function main() {
  if (!out) throw new Error('--out <report.json> is required');
  if (copy && !reviewBucket) throw new Error('--copy-to-review needs --i-understand-this-writes-to <privateBucket>');
  let host = '(unknown)';
  try { host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').host; } catch { /* keep */ }
  console.log(`[media-uploads-revalidate] project host=${host} mode=${copy ? 'copy-to-review' : 'dry-run'}`);

  const all = await listAll(BUCKET);
  const io: RevalidationIO = {
    async listObjects(_b, offset, limit) { return all.slice(offset, offset + limit); },
    async bucketIsPublic(bucket) {
      const { data, error } = await supabase.storage.getBucket(bucket);
      return error || !data ? null : data.public === true;
    },
    async readHead(bucket, name, n) {
      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(name, 60);
      if (error || !data?.signedUrl) return null;
      try {
        // ssrf-ok: signed URL minted by our own client for a listed key
        const resp = await fetch(data.signedUrl, { headers: { range: `bytes=0-${n - 1}` } });
        if (resp.status !== 200 && resp.status !== 206) return null;
        return Buffer.from(await resp.arrayBuffer()).subarray(0, n);
      } catch { return null; }
    },
    async readAll(bucket, name) {
      const { data, error } = await supabase.storage.from(bucket).download(name);
      return error || !data ? null : Buffer.from(await data.arrayBuffer());
    },
    provenanceKeys,
    ...(flag('--no-decode') ? {} : {
      async imageDecodes(bytes: Buffer) {
        await transformUntrustedImage(bytes, (img) => img.resize(32, 32, { fit: 'inside' }).png().toBuffer());
        return true;
      },
    }),
    ...(copy ? {
      async copyToReview(src: string, name: string, dst: string, dstKey: string) {
        const { error } = await supabase.storage.from(src).copy(name, dstKey, { destinationBucket: dst });
        return error ? { ok: false, message: error.message } : { ok: true };
      },
    } : {}),
  };

  const report = await runRevalidation(io, { bucket: BUCKET, mode: copy ? 'copy-to-review' : 'dry-run', ...(reviewBucket ? { reviewBucket } : {}) });
  writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), host, ...report }, null, 2));
  console.log(JSON.stringify({ scanned: report.scanned, bucketPublic: report.bucketPublic, counts: report.counts, flaggedForReview: report.flaggedForReview }, null, 2));
  process.exit(report.flaggedForReview > 0 ? 1 : 0);
}

main().catch((e) => { console.error('[media-uploads-revalidate] FAILED:', (e as Error).message); process.exit(2); });
