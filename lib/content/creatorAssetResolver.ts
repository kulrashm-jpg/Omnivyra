/**
 * Creator Asset Resolver — the ONE canonical read API for the asset library.
 *
 * Every consumer (Session, Writer, Campaign Creator, Calendar, Automation,
 * future modules) resolves asset data ONLY through here, operating only on a
 * `CreatorAssetRef` — never on `CreatorAsset` and never on storage. This is the
 * single resolution layer; it reads through the pluggable backend, so the
 * storage substrate (local → server / CDN / blob / DB) can change without any
 * consumer changing.
 */

import { creatorAssetBackend } from './creatorAssetBackend';
import { getCachedAsset, setCachedAsset } from './creatorAssetCache';
import type { CreatorAsset, CreatorAssetRef, CreatorAssetVersion, CreatorAssetOp, CreatorAssetMetadata } from './creatorAssetLibrary';
import type { WriterAttachedAsset } from './writerCreatorAssetLaunch';

// Re-export the discovery types so the catalog depends on the resolver ALONE.
export type { CreatorAssetRef, CreatorAssetMetadata } from './creatorAssetLibrary';

/** Read-through: serve from the transparent cache, else load the authoritative
 *  backend and populate the cache. Library writes invalidate affected ids. */
async function loadAsset(assetId: string): Promise<CreatorAsset | null> {
  const cached = getCachedAsset(assetId);
  if (cached) return cached;
  const asset = await creatorAssetBackend().read(assetId);
  if (asset) setCachedAsset(asset);
  return asset;
}

async function versionFor(ref: CreatorAssetRef | null | undefined): Promise<CreatorAssetVersion | null> {
  if (!ref || !ref.assetId) return null;
  const asset = await loadAsset(ref.assetId);
  if (!asset) return null;
  // pinned version, else current — a stale ref never breaks
  return asset.versions.find((v) => v.version === ref.version)
    ?? asset.versions.find((v) => v.version === asset.currentVersion)
    ?? null;
}

/** The canonical payload for a ref (pinned version, else current). */
export async function resolveCreatorAsset(ref: CreatorAssetRef | null | undefined): Promise<WriterAttachedAsset | null> {
  return (await versionFor(ref))?.payload ?? null;
}
/** Alias for the rendering payload (same canonical object). */
export async function resolveCreatorAssetRenderingPayload(ref: CreatorAssetRef | null | undefined): Promise<WriterAttachedAsset | null> {
  return resolveCreatorAsset(ref);
}
/** The resolved version number (handles "current" fallback). */
export async function resolveCreatorAssetVersion(ref: CreatorAssetRef | null | undefined): Promise<number | null> {
  return (await versionFor(ref))?.version ?? null;
}
export async function resolveCreatorAssetMetadata(ref: CreatorAssetRef | null | undefined): Promise<Record<string, unknown> | null> {
  return (await versionFor(ref))?.payload.metadata ?? null;
}
/** Canonical DISCOVERY metadata for a ref (assetType / platform / campaign / tags
 *  / templateId / createdAt) — what the catalog filters on. Not the payload. */
export async function resolveCreatorAssetCatalogMetadata(ref: CreatorAssetRef | null | undefined): Promise<CreatorAssetMetadata | null> {
  if (!ref || !ref.assetId) return null;
  return (await loadAsset(ref.assetId))?.metadata ?? null;
}
export async function resolveCreatorAssetFiles(ref: CreatorAssetRef | null | undefined): Promise<string[]> {
  return (await versionFor(ref))?.payload.files ?? [];
}
export async function resolveCreatorAssetPreviewUrl(ref: CreatorAssetRef | null | undefined): Promise<string | null> {
  const p = (await versionFor(ref))?.payload;
  return (p?.url ?? p?.files?.[0]) ?? null;
}
export async function resolveCreatorAssetThumbnails(ref: CreatorAssetRef | null | undefined): Promise<string[]> {
  const p = (await versionFor(ref))?.payload;
  const t = p?.url ?? p?.files?.[0];
  return t ? [t] : [];
}
/** Current version number for an asset id (no payload exposed). */
export async function resolveCreatorAssetCurrentVersion(assetId: string): Promise<number | null> {
  return (await loadAsset(assetId))?.currentVersion ?? null;
}

export interface CreatorAssetHistoryEntry { version: number; op: CreatorAssetOp; createdAt: string; restoredFrom?: number }
/** Audit / version history for a ref's asset (no CreatorAsset object exposed). */
export async function resolveCreatorAssetHistory(ref: CreatorAssetRef | null | undefined): Promise<CreatorAssetHistoryEntry[]> {
  if (!ref?.assetId) return [];
  const asset = await loadAsset(ref.assetId);
  return asset ? asset.versions.map((v) => ({ version: v.version, op: v.op, createdAt: v.createdAt, restoredFrom: v.restoredFrom })) : [];
}

/** All library assets as references (consumers operate on refs, not records). */
export async function listCreatorAssetRefs(): Promise<CreatorAssetRef[]> {
  return (await creatorAssetBackend().readAll()).map((a) => ({ assetId: a.id, version: a.currentVersion, selectedVariant: a.selectedVariant }));
}

/** Discovery entry — a reference + its canonical metadata, NO payload. The
 *  catalog's single data source (metadata-driven discovery without loading payloads). */
export interface CreatorAssetCatalogEntry { ref: CreatorAssetRef; metadata: CreatorAssetMetadata }
export async function listCreatorAssetEntries(): Promise<CreatorAssetCatalogEntry[]> {
  return (await creatorAssetBackend().readAll()).map((a) => ({
    ref: { assetId: a.id, version: a.currentVersion, selectedVariant: a.selectedVariant },
    metadata: a.metadata,
  }));
}
