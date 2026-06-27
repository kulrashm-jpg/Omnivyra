/**
 * Thread per-node attachments ⇄ Usage Graph.
 *
 * Per-node thread attachments are now canonical relationships in the ONE Usage
 * Graph, keyed by a `thread-node` consumer (`<threadToken>:<position>`). There is
 * no thread-specific relationship store at runtime: the legacy
 * `thread_node_attachments_<token>` map is read EXACTLY ONCE by a marker-gated
 * migration, after which all node relationships live in (and are read from) the
 * graph. `ThreadNode.attachments` becomes a resolved projection. An asset on
 * multiple nodes = one asset + multiple edges (no duplication).
 */

import {
  attachUsage,
  detachUsage,
  listAssetsForConsumer,
  listUsageEdges,
  type AssetConsumer,
} from '../content/creatorAssetUsageGraph';
import { resolveCreatorAsset, resolveCreatorAssetCurrentVersion } from '../content/creatorAssetResolver';
import { writerAssetToCanonicalAttachments } from './threadNodeAttachmentResolver';
import { loadThreadNodeAttachments, type ThreadNodeAttachmentMap } from './threadStorage';
import type { CanonicalAttachment } from '@/lib/shared/attachments/canonicalAttachment';

/** Canonical consumer for a single thread node (position). */
export function threadNodeConsumer(threadToken: string, position: number): AssetConsumer {
  return { type: 'thread-node', id: `${threadToken}:${position}` };
}

/* ── One-time migration (legacy map → graph) ─────────────────────────── */

const migratedKey = (threadToken: string): string => `thread_node_graph_migrated_${threadToken}`;
function isMigrated(threadToken: string): boolean {
  if (typeof window === 'undefined') return false;
  try { return window.localStorage.getItem(migratedKey(threadToken)) === '1'; } catch { return false; }
}
function markMigrated(threadToken: string): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(migratedKey(threadToken), '1'); } catch { /* ignore */ }
}

async function attachRefForAsset(threadToken: string, position: number, assetId: string): Promise<void> {
  const version = await resolveCreatorAssetCurrentVersion(assetId);
  if (version == null) return; // stale id (not in library) — skip, mirrors render-time policy
  await attachUsage({ assetId, version, selectedVariant: null }, threadNodeConsumer(threadToken, position), { role: 'thread-node' });
}

/** Migrate a thread's legacy per-node map into the graph, once. Idempotent. */
export async function migrateThreadNodeAttachmentsToGraph(threadToken: string): Promise<boolean> {
  if (!threadToken || isMigrated(threadToken)) return false;
  const map = loadThreadNodeAttachments(threadToken) ?? {};
  for (const [positionKey, assetIds] of Object.entries(map)) {
    const position = Number(positionKey);
    if (!Number.isFinite(position) || position < 0 || !Array.isArray(assetIds)) continue;
    for (const assetId of assetIds) {
      if (typeof assetId === 'string' && assetId) await attachRefForAsset(threadToken, position, assetId);
    }
  }
  markMigrated(threadToken);
  return true;
}

/* ── Mutations (UI delegates here — no local relationship storage) ───── */

export async function attachThreadNodeAsset(threadToken: string, position: number, assetId: string): Promise<void> {
  await attachRefForAsset(threadToken, position, assetId);
}
export async function detachThreadNodeAsset(threadToken: string, position: number, assetId: string): Promise<void> {
  await detachUsage(assetId, threadNodeConsumer(threadToken, position));
}

/**
 * Reconcile a full position→assetId[] map onto the graph (attach added, detach
 * removed) — the canonical replacement for `saveThreadNodeAttachments`.
 */
export async function syncThreadNodeMapToGraph(threadToken: string, map: ThreadNodeAttachmentMap): Promise<void> {
  if (!threadToken) return;
  await migrateThreadNodeAttachmentsToGraph(threadToken);
  const positions = new Set<number>();
  for (const k of Object.keys(map)) { const p = Number(k); if (Number.isFinite(p) && p >= 0) positions.add(p); }
  // include any positions currently in the graph (so cleared positions are detached)
  const prefix = `${threadToken}:`;
  for (const e of await listUsageEdges()) {
    if (e.consumerType === 'thread-node' && e.consumerId.startsWith(prefix)) {
      const p = Number(e.consumerId.slice(prefix.length));
      if (Number.isFinite(p)) positions.add(p);
    }
  }
  for (const position of positions) {
    const desired = new Set((map[position] ?? []).filter((id) => typeof id === 'string' && id));
    const current = new Set((await listAssetsForConsumer(threadNodeConsumer(threadToken, position))).map((r) => r.assetId));
    for (const id of desired) if (!current.has(id)) await attachRefForAsset(threadToken, position, id);
    for (const id of current) if (!desired.has(id)) await detachUsage(id, threadNodeConsumer(threadToken, position));
  }
}

/* ── Projections (read from the graph; never from ThreadNode.attachments) ── */

/** Per-node asset-id map for the UI display state (derived from the graph). */
export async function getThreadNodeAttachmentMapFromGraph(threadToken: string): Promise<ThreadNodeAttachmentMap> {
  await migrateThreadNodeAttachmentsToGraph(threadToken);
  const prefix = `${threadToken}:`;
  const map: ThreadNodeAttachmentMap = {};
  for (const e of await listUsageEdges()) {
    if (e.consumerType !== 'thread-node' || !e.consumerId.startsWith(prefix)) continue;
    const position = Number(e.consumerId.slice(prefix.length));
    if (!Number.isFinite(position)) continue;
    (map[position] ??= []).push(e.assetId);
  }
  return map;
}

/** Resolved per-node attachments for publishing/rendering (the projection). */
export async function getThreadNodeAttachmentsFromGraph(threadToken: string): Promise<Record<number, CanonicalAttachment[]>> {
  await migrateThreadNodeAttachmentsToGraph(threadToken);
  const out: Record<number, CanonicalAttachment[]> = {};
  const map = await getThreadNodeAttachmentMapFromGraph(threadToken);
  for (const [positionKey, assetIds] of Object.entries(map)) {
    const position = Number(positionKey);
    const atts: CanonicalAttachment[] = [];
    for (const assetId of assetIds) {
      const payload = await resolveCreatorAsset({ assetId, version: await resolveCreatorAssetCurrentVersion(assetId) ?? 1 });
      if (payload) atts.push(...writerAssetToCanonicalAttachments(payload));
    }
    if (atts.length) out[position] = atts;
  }
  return out;
}
