/**
 * Strategic Mix P2 — the SERVER implementation of CreatorAssetBackend.
 *
 * The client library logic (register / version / duplicate / restore /
 * rename) is pure over the backend interface; installing this backend makes
 * the server (`creator_assets.library`) the canonical store while
 * localStorage becomes a WRITE-THROUGH CACHE (fast reads, offline fallback).
 * The cap-50 limit now only bounds the cache, never the canonical history.
 *
 * MIGRATION: `readAll()` diffs the local cache against the server and pushes
 * any local-only assets up (one-time per asset) — pre-P2 localStorage
 * libraries migrate transparently the first time the library/picker loads.
 */

import { fetchWithAuth } from '../../components/community-ai/fetchWithAuth';
import type { CreatorAsset } from './creatorAssetLibrary';
import {
  localCreatorAssetBackend,
  setCreatorAssetBackend,
  type CreatorAssetBackend,
} from './creatorAssetBackend';

const base = '/api/creator-assets/library';

function isEnvelope(v: unknown): v is CreatorAsset {
  return Boolean(v && typeof v === 'object' && !Array.isArray(v) && (v as CreatorAsset).id);
}

export function createServerCreatorAssetBackend(companyId: string): CreatorAssetBackend {
  const cid = encodeURIComponent(companyId);
  let migrated = false;

  const serverRead = async (assetId: string): Promise<CreatorAsset | null> => {
    const res = await fetchWithAuth(`${base}?company_id=${cid}&id=${encodeURIComponent(assetId)}`);
    if (!res.ok) throw new Error(`library read failed (${res.status})`);
    const data = await res.json().catch(() => null);
    return isEnvelope(data?.asset) ? (data.asset as CreatorAsset) : null;
  };

  const serverWrite = async (asset: CreatorAsset): Promise<void> => {
    const res = await fetchWithAuth(base, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id: companyId, asset }),
    });
    if (!res.ok) throw new Error(`library write failed (${res.status})`);
  };

  return {
    async read(assetId) {
      try {
        const remote = await serverRead(assetId);
        if (remote) {
          await localCreatorAssetBackend.write(remote); // refresh cache
          return remote;
        }
        return localCreatorAssetBackend.read(assetId); // cache fallback (e.g. offline-written)
      } catch {
        return localCreatorAssetBackend.read(assetId);
      }
    },

    async readAll() {
      try {
        const res = await fetchWithAuth(`${base}?company_id=${cid}&limit=500`);
        if (!res.ok) throw new Error(`library list failed (${res.status})`);
        const data = await res.json().catch(() => null);
        const remote: CreatorAsset[] = Array.isArray(data?.assets)
          ? data.assets.map((e: { asset: unknown }) => e.asset).filter(isEnvelope)
          : [];
        // One-time migration: push local-only assets up (pre-P2 libraries).
        if (!migrated) {
          migrated = true;
          const remoteIds = new Set(remote.map((a) => a.id));
          const locals = await localCreatorAssetBackend.readAll();
          for (const local of locals) {
            if (remoteIds.has(local.id)) continue;
            try { await serverWrite(local); remote.push(local); } catch { /* retry next load */ }
          }
        }
        // Refresh the cache with the merged view (cache stays capped internally).
        for (const a of remote.slice(0, 50)) await localCreatorAssetBackend.write(a);
        return remote;
      } catch {
        return localCreatorAssetBackend.readAll(); // offline → cache
      }
    },

    async write(asset) {
      await localCreatorAssetBackend.write(asset); // cache first (instant UX)
      try {
        await serverWrite(asset);
      } catch (err) {
        // Offline / transient: the cache holds it; readAll() migration pushes
        // it up on the next successful load.
        console.warn('[asset-library] server write deferred:', (err as Error)?.message);
      }
    },

    async remove(assetId) {
      await localCreatorAssetBackend.remove(assetId);
      try {
        await fetchWithAuth(`${base}?company_id=${cid}&id=${encodeURIComponent(assetId)}`, { method: 'DELETE' });
      } catch { /* convergence cleanup is best-effort */ }
    },
  };
}

let installedFor: string | null = null;

/** Idempotently install the server backend for a company. Safe to call from
 *  multiple surfaces (library page, reuse picker, creator workflows). */
export function installServerCreatorAssetBackend(companyId: string | null | undefined): boolean {
  const cid = typeof companyId === 'string' ? companyId.trim() : '';
  if (!cid || installedFor === cid) return installedFor === cid;
  setCreatorAssetBackend(createServerCreatorAssetBackend(cid));
  installedFor = cid;
  return true;
}

/** Fire-and-forget server usage tracking (attach/reuse events). */
export function reportLibraryAssetUsage(companyId: string | null | undefined, assetId: string): void {
  const cid = typeof companyId === 'string' ? companyId.trim() : '';
  if (!cid || !assetId) return;
  fetchWithAuth('/api/creator-assets/library-actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ company_id: cid, id: assetId, action: 'record-usage' }),
  }).catch(() => { /* usage is a coarse indicator; losses are acceptable */ });
}
