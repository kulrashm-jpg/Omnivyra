/**
 * Server-side Creator Asset Resolver — the publish-time counterpart of the client
 * resolver. Given a CreatorAssetRef it returns the rendering payload by reading
 * the EXISTING creator-assets persistence (`listCreatorAssets`) — no second store.
 *
 * This lets the publishing pipeline accept CreatorAssetRef[] and resolve assets on
 * the server, instead of depending on client-resolved payloads. It never throws:
 * if persistence is unavailable or a ref can't be resolved, it returns nothing so
 * the caller can fall back to any legacy payload (backward compatibility).
 */

import { listCreatorAssets } from '../creatorAssetPersistenceService';

export interface ServerAssetRef { assetId: string; version?: number; selectedVariant?: string | null }
export interface ServerResolvedAsset {
  assetId: string;
  url: string | null;
  files: string[];
  previewUrl: string | null;
  creatorType: string | null;
  metadata: Record<string, unknown>;
}
export interface ServerResolveContext { companyId: string; userId: string }

function obj(v: unknown): Record<string, unknown> { return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}; }
function rowId(row: Record<string, unknown>): string { return String(row.id ?? row.creator_asset_id ?? row.persisted_asset_id ?? ''); }
function rowToResolved(row: Record<string, unknown>): ServerResolvedAsset {
  const files = Array.isArray(row.files) ? (row.files as unknown[]).map(String).filter(Boolean) : [];
  const url = typeof row.url === 'string' && row.url.trim() ? row.url : null;
  return {
    assetId: rowId(row),
    url,
    files,
    previewUrl: url ?? files[0] ?? null,
    creatorType: typeof row.creator_type === 'string' ? row.creator_type : null,
    metadata: obj(row.metadata),
  };
}

/**
 * Resolve refs from the existing persistence (by company). Matches a ref against
 * the row's canonical id / creator_asset_id. Returns only resolvable refs.
 */
export async function resolveCreatorAssetRefsServer(input: ServerResolveContext & { refs: ServerAssetRef[] }): Promise<ServerResolvedAsset[]> {
  const refs = (input.refs ?? []).filter((r) => r && typeof r.assetId === 'string' && r.assetId.trim());
  if (!refs.length || !input.companyId || !input.userId) return [];
  let rows: Record<string, unknown>[] = [];
  try {
    rows = await listCreatorAssets({ companyId: input.companyId, userId: input.userId, limit: 200 });
  } catch {
    return []; // persistence unavailable → caller falls back to legacy payload
  }
  const byId = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    for (const key of [String(row.id ?? ''), String((row as Record<string, unknown>).creator_asset_id ?? ''), String((row as Record<string, unknown>).persisted_asset_id ?? '')]) {
      if (key && !byId.has(key)) byId.set(key, row);
    }
  }
  const out: ServerResolvedAsset[] = [];
  for (const ref of refs) {
    const row = byId.get(ref.assetId);
    if (row) out.push(rowToResolved(row));
  }
  return out;
}

/** Single-ref conceptual API (mirrors the client resolver). */
export async function resolveCreatorAssetServer(ctx: ServerResolveContext, ref: ServerAssetRef): Promise<ServerResolvedAsset | null> {
  return (await resolveCreatorAssetRefsServer({ ...ctx, refs: [ref] }))[0] ?? null;
}
export async function resolveCreatorAssetFilesServer(ctx: ServerResolveContext, ref: ServerAssetRef): Promise<string[]> {
  const r = await resolveCreatorAssetServer(ctx, ref);
  return r ? [...(r.url ? [r.url] : []), ...r.files].filter(Boolean) : [];
}
export async function resolveCreatorAssetPreviewServer(ctx: ServerResolveContext, ref: ServerAssetRef): Promise<string | null> {
  return (await resolveCreatorAssetServer(ctx, ref))?.previewUrl ?? null;
}

/** All media URLs (url + files, de-duped) for a set of refs — server-resolved. */
export async function resolveCreatorAssetMediaUrlsServer(input: ServerResolveContext & { refs: ServerAssetRef[] }): Promise<string[]> {
  const resolved = await resolveCreatorAssetRefsServer(input);
  const urls: string[] = [];
  for (const a of resolved) {
    if (a.url) urls.push(a.url);
    for (const f of a.files) urls.push(f);
  }
  return Array.from(new Set(urls));
}

/**
 * Back-compat: accept the new `assetRefs` format OR legacy `creatorAttachments` /
 * `attachments` payloads, converting once into canonical refs.
 */
export function normalizeServerAssetRefs(input: { assetRefs?: unknown; creatorAttachments?: unknown; attachments?: unknown }): ServerAssetRef[] {
  if (Array.isArray(input.assetRefs)) {
    return input.assetRefs.map(obj).filter((r) => typeof r.assetId === 'string' && (r.assetId as string).trim())
      .map((r) => ({ assetId: String(r.assetId), version: Number(r.version) || 1, selectedVariant: typeof r.selectedVariant === 'string' ? r.selectedVariant : null }));
  }
  const legacy = Array.isArray(input.creatorAttachments) ? input.creatorAttachments : Array.isArray(input.attachments) ? input.attachments : [];
  return legacy.map(obj)
    .map((a) => ({ assetId: String((a.asset_ref && obj(a.asset_ref).assetId) || a.id || ''), version: Number((a.asset_ref && obj(a.asset_ref).version) || a.version) || 1, selectedVariant: null }))
    .filter((r) => r.assetId.trim());
}
