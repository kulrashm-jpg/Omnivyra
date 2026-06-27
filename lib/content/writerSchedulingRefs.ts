/**
 * Scheduling/publishing asset references — reference-based transport.
 *
 * The scheduler operates on `CreatorAssetRef[]` (assetId + version + variant),
 * not raw `WriterAttachedAsset` payloads. Payload resolution happens exactly once,
 * at the schedule/publish action (the latest client-controlled point before the
 * platform upload) via the canonical resolver — never from payload-extraction
 * helpers. `normalizeIncomingAssetRefs` lets the server accept both the new
 * reference format and legacy payload requests, converting once to refs.
 */

import { listAssetsForConsumer, type AssetConsumer } from './creatorAssetUsageGraph';
import { resolveCreatorAsset, type CreatorAssetRef } from './creatorAssetResolver';
import type { WriterAttachedAsset } from './writerCreatorAssetLaunch';

/** Canonical references for a consumer (graph-owned, ordered). */
export async function attachmentRefsForConsumer(consumer: AssetConsumer): Promise<CreatorAssetRef[]> {
  return listAssetsForConsumer(consumer);
}

/** Resolve refs → payloads (once) at the publish boundary. */
export async function resolveSchedulingPayloads(refs: CreatorAssetRef[]): Promise<WriterAttachedAsset[]> {
  const out: WriterAttachedAsset[] = [];
  for (const ref of refs) {
    const payload = await resolveCreatorAsset(ref);
    if (payload) out.push(payload);
  }
  return out;
}

/**
 * Resolver-driven media URLs for scheduling refs — replaces
 * `mediaUrlsFromCreatorAttachments(...)` payload extraction. Resolves once, then
 * de-dupes primary url + files across attachments (same output, reference-sourced).
 */
export async function resolveSchedulingMediaUrls(refs: CreatorAssetRef[]): Promise<string[]> {
  const urls: string[] = [];
  for (const ref of refs) {
    const payload = await resolveCreatorAsset(ref);
    if (!payload) continue;
    if (typeof payload.url === 'string' && payload.url.trim()) urls.push(payload.url.trim());
    for (const f of payload.files ?? []) if (typeof f === 'string' && f.trim()) urls.push(f.trim());
  }
  return Array.from(new Set(urls));
}

/**
 * Back-compat normalization for the server: accept the new `assetRefs` format OR
 * legacy `creatorAttachments` / `attachments` payloads, returning canonical
 * `CreatorAssetRef[]` (converted once). Raw payloads never continue past here.
 */
export function normalizeIncomingAssetRefs(input: {
  assetRefs?: unknown;
  creatorAttachments?: unknown;
  attachments?: unknown;
}): CreatorAssetRef[] {
  const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
  if (Array.isArray(input.assetRefs)) {
    return input.assetRefs
      .map(obj)
      .filter((r) => typeof r.assetId === 'string' && (r.assetId as string).trim())
      .map((r) => ({ assetId: String(r.assetId), version: Number(r.version) || 1, selectedVariant: typeof r.selectedVariant === 'string' ? r.selectedVariant : null }));
  }
  const legacy = Array.isArray(input.creatorAttachments)
    ? input.creatorAttachments
    : Array.isArray(input.attachments) ? input.attachments : [];
  return legacy
    .map(obj)
    .filter((a) => typeof a.id === 'string' && (a.id as string).trim())
    .map((a) => ({ assetId: String(a.id), version: Number(a.version) || 1, selectedVariant: null }));
}
