/**
 * Creator Asset Library — the canonical, consumer-independent home for every
 * generated asset.
 *
 * Each generated asset gets a STABLE id and a version history; the full payload
 * (url / files / metadata) is stored here exactly ONCE. Sessions and writer/
 * campaign/calendar/automation consumers store only a `CreatorAssetRef`
 * (assetId + version + selectedVariant) and dereference via the resolver
 * (`resolveCreatorAsset`) — never by reading this module's storage directly.
 * Versioning operations (generate / regenerate / replace / duplicate / restore)
 * never break existing references — they add versions or mint new ids.
 *
 * Creator writes here at generation time and never knows who consumes the asset.
 */

import type { WriterAttachedAsset } from './writerCreatorAssetLaunch';
import { creatorAssetBackend } from './creatorAssetBackend';
import { invalidateAssetCache } from './creatorAssetCache';
import { generateCreatorAssetId, duplicateCreatorAssetId } from './creatorAssetIdFactory';

export type CreatorAssetOp = 'generate' | 'regenerate' | 'replace' | 'duplicate' | 'restore';

export interface CreatorAssetVersion {
  version: number;
  op: CreatorAssetOp;
  /** The canonical asset payload for this version — stored once, here. */
  payload: WriterAttachedAsset;
  createdAt: string;
  restoredFrom?: number;
}
/**
 * Canonical discovery metadata that lives WITH the asset record. The catalog
 * searches/filters on this alone — payloads are never loaded merely to search.
 * Derived from the generation payload at register time (no new caller args, so
 * existing behavior is unchanged).
 */
export interface CreatorAssetMetadata {
  organizationId: string | null;
  campaignId: string | null;
  creatorSource: string | null;
  assetType: string;
  templateId: string | null;
  createdBy: string | null;
  createdAt: string;
  tags: string[];
  status: string;
  platform: string | null;
  version: number;
}

export interface CreatorAsset {
  id: string;
  currentVersion: number;
  versions: CreatorAssetVersion[];
  selectedVariant: string | null;
  /** Canonical discovery metadata (catalog reads this; never the payload). */
  metadata: CreatorAssetMetadata;
  createdAt: string;
  updatedAt: string;
}
/** A reference a consumer stores instead of the full asset payload. */
export interface CreatorAssetRef {
  assetId: string;
  version: number;
  selectedVariant?: string | null;
}

/**
 * The asset ID for a registration. An explicit id (caller restoring an existing
 * asset, or a test fixture) is honored; otherwise the canonical ID FACTORY mints
 * one. No `Date.now()`/template-string minting happens here — the factory is the
 * sole source of new asset identity.
 */
function newAssetId(payload: WriterAttachedAsset): string {
  return payload.id && String(payload.id).trim() ? String(payload.id) : generateCreatorAssetId({ kind: payload.creatorType });
}

/** Internal ref builder (writes return a ref for consumers to store). */
function makeAssetRef(asset: CreatorAsset, version?: number): CreatorAssetRef {
  return { assetId: asset.id, version: version ?? asset.currentVersion, selectedVariant: asset.selectedVariant };
}

/** Derive canonical discovery metadata from the generation payload (no new
 *  caller args — existing behavior unchanged). `createdAt` is preserved across
 *  versions by the caller. */
function deriveAssetMetadata(payload: WriterAttachedAsset, version: number, now: string): CreatorAssetMetadata {
  const m = (payload.metadata ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return {
    organizationId: str(m.company_id ?? m.organization_id ?? m.organizationId),
    campaignId: str(m.campaign_id ?? m.campaignId),
    creatorSource: str(m.origin ?? m.creator_source ?? m.creatorSource) ?? 'creator',
    assetType: str(payload.creatorType) ?? 'asset',
    templateId: str(m.template_id ?? m.templateId),
    createdBy: str(m.created_by ?? m.createdBy ?? m.user_id),
    createdAt: str(payload.createdAt) ?? now,
    tags: Array.isArray(m.tags) ? (m.tags as unknown[]).map(String).filter(Boolean) : [],
    status: str(m.status) ?? 'ready',
    platform: str(payload.platformContext ?? m.platform ?? m.platform_context),
    version,
  };
}

/* ── Lifecycle WRITES (the only mutation API). Reads go through the resolver. ─ */

/**
 * Register a generated asset. New id → v1 ('generate'); existing id → a new
 * version. Returns the canonical asset + a ref consumers should store.
 */
export async function registerGeneratedAsset(
  payload: WriterAttachedAsset,
  opts?: { assetId?: string; op?: CreatorAssetOp; selectedVariant?: string | null; now?: string },
): Promise<{ asset: CreatorAsset; ref: CreatorAssetRef }> {
  const backend = creatorAssetBackend();
  const now = opts?.now ?? new Date().toISOString();
  const id = opts?.assetId ?? newAssetId(payload);
  const existing = await backend.read(id);
  if (existing) {
    const version = existing.currentVersion + 1;
    existing.versions.push({ version, op: opts?.op ?? 'regenerate', payload: { ...payload, id }, createdAt: now });
    existing.currentVersion = version;
    if (opts?.selectedVariant !== undefined) existing.selectedVariant = opts.selectedVariant;
    existing.metadata = { ...deriveAssetMetadata({ ...payload, id }, version, now), createdAt: existing.metadata.createdAt };
    existing.updatedAt = now;
    await backend.write(existing);
    invalidateAssetCache(id);
    return { asset: existing, ref: makeAssetRef(existing, version) };
  }
  const asset: CreatorAsset = {
    id,
    currentVersion: 1,
    versions: [{ version: 1, op: opts?.op ?? 'generate', payload: { ...payload, id }, createdAt: now }],
    selectedVariant: opts?.selectedVariant ?? null,
    metadata: deriveAssetMetadata({ ...payload, id }, 1, now),
    createdAt: now,
    updatedAt: now,
  };
  await backend.write(asset);
  invalidateAssetCache(id);
  return { asset, ref: makeAssetRef(asset, 1) };
}

/** Add a new version to an existing asset (regenerate / replace). */
export async function addAssetVersion(
  assetId: string,
  payload: WriterAttachedAsset,
  op: CreatorAssetOp,
  opts?: { now?: string },
): Promise<{ asset: CreatorAsset; ref: CreatorAssetRef } | null> {
  const backend = creatorAssetBackend();
  const asset = await backend.read(assetId);
  if (!asset) return null;
  const now = opts?.now ?? new Date().toISOString();
  const version = asset.currentVersion + 1;
  asset.versions.push({ version, op, payload: { ...payload, id: assetId }, createdAt: now });
  asset.currentVersion = version;
  asset.metadata = { ...deriveAssetMetadata({ ...payload, id: assetId }, version, now), createdAt: asset.metadata.createdAt };
  asset.updatedAt = now;
  await backend.write(asset);
  invalidateAssetCache(assetId);
  return { asset, ref: makeAssetRef(asset, version) };
}

/** Duplicate an asset into a brand-new id (its current version becomes the copy's v1). */
export async function duplicateAsset(assetId: string, opts?: { now?: string }): Promise<{ asset: CreatorAsset; ref: CreatorAssetRef } | null> {
  const src = await creatorAssetBackend().read(assetId);
  if (!src) return null;
  const now = opts?.now ?? new Date().toISOString();
  const cur = src.versions.find((v) => v.version === src.currentVersion);
  if (!cur) return null;
  const newId = duplicateCreatorAssetId(assetId);
  return registerGeneratedAsset(cur.payload, { assetId: newId, op: 'duplicate', selectedVariant: src.selectedVariant, now });
}

/**
 * Identity migration — rename an asset from a temporary id to the canonical
 * persisted id. This is NOT a recreate: versions, history, op log, selectedVariant
 * and metadata are preserved; only the id (and each version payload's id) changes.
 * If the canonical id already holds a record (idempotent re-converge), the temp
 * record is dropped and the existing canonical asset is returned.
 */
export async function renameAsset(oldId: string, newId: string, opts?: { now?: string }): Promise<{ asset: CreatorAsset; ref: CreatorAssetRef } | null> {
  if (!oldId || !newId) return null;
  const backend = creatorAssetBackend();
  if (oldId === newId) { const a = await backend.read(oldId); return a ? { asset: a, ref: makeAssetRef(a) } : null; }
  const src = await backend.read(oldId);
  if (!src) return null;
  const now = opts?.now ?? new Date().toISOString();
  const existingNew = await backend.read(newId);
  if (existingNew) {
    await backend.remove(oldId);
    invalidateAssetCache(oldId);
    return { asset: existingNew, ref: makeAssetRef(existingNew) };
  }
  const renamed: CreatorAsset = {
    ...src,
    id: newId,
    versions: src.versions.map((v) => ({ ...v, payload: { ...v.payload, id: newId } })),
    updatedAt: now,
  };
  await backend.write(renamed);
  await backend.remove(oldId);
  invalidateAssetCache(oldId);
  invalidateAssetCache(newId);
  return { asset: renamed, ref: makeAssetRef(renamed) };
}

/** Restore a previous version by appending it as a new current version. */
export async function restoreAssetVersion(assetId: string, version: number, opts?: { now?: string }): Promise<{ asset: CreatorAsset; ref: CreatorAssetRef } | null> {
  const backend = creatorAssetBackend();
  const asset = await backend.read(assetId);
  const target = asset?.versions.find((v) => v.version === version);
  if (!asset || !target) return null;
  const now = opts?.now ?? new Date().toISOString();
  const newVersion = asset.currentVersion + 1;
  asset.versions.push({ version: newVersion, op: 'restore', payload: target.payload, createdAt: now, restoredFrom: version });
  asset.currentVersion = newVersion;
  asset.metadata = { ...deriveAssetMetadata(target.payload, newVersion, now), createdAt: asset.metadata.createdAt };
  asset.updatedAt = now;
  await backend.write(asset);
  invalidateAssetCache(assetId);
  return { asset, ref: makeAssetRef(asset, newVersion) };
}
