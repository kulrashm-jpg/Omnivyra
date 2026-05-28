/**
 * Phase 2 — Automated topology snapshot engine.
 *
 * Captures the on-disk + in-memory shape of a thread at named lifecycle
 * phases (pre_generation, post_generation, post_edit, post_reorder,
 * post_recovery) so consumers can diff phases or replay later.
 *
 * Inputs: the caller hands us the current node list. We don't reach into
 * the registry to read DB state — that's the caller's job (they own the
 * supabase client). We compute topology integrity here.
 *
 * Pure / deterministic. In-memory storage of past snapshots per thread.
 */

import type {
  JoinIntegrity,
  OrderingIntegrity,
  ThreadNodeShape,
  ThreadSnapshotPhase,
  ThreadTopologySnapshot,
} from './threadRuntimeTypes';

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function clamp100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function computeOrderingIntegrity(positions: number[]): OrderingIntegrity {
  if (positions.length === 0) return 'monotonic';
  const sorted = [...positions].sort((a, b) => a - b);
  const seen = new Set<number>();
  let hasDuplicate = false;
  for (const p of sorted) {
    if (seen.has(p)) { hasDuplicate = true; break; }
    seen.add(p);
  }
  if (hasDuplicate) return 'duplicates';
  // gaps: positions should be 0..N-1 (or 1..N — accept either as monotonic).
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const expectedSpan = max - min + 1;
  if (expectedSpan !== sorted.length) return 'gaps';
  return 'monotonic';
}

function computeJoinIntegrity(nodes: ThreadNodeShape[], rootId: string | null): JoinIntegrity {
  if (nodes.length === 0) return 'intact';
  if (!rootId) return 'broken';
  // Every non-root node must point to root (or to another descendant chain).
  let nonRootCount = 0;
  let broken = 0;
  let gaps = 0;
  const ids = new Set(nodes.map((n) => n.nodeId));
  for (const n of nodes) {
    if (n.nodeId === rootId) continue;
    nonRootCount += 1;
    if (!n.parentNodeId) { broken += 1; continue; }
    if (!ids.has(n.parentNodeId)) gaps += 1;
  }
  if (nonRootCount === 0) return 'intact';
  if (broken > 0) return 'broken';
  if (gaps > 0) return 'gaps';
  return 'intact';
}

function findOrphans(nodes: ThreadNodeShape[], rootId: string | null): string[] {
  if (!rootId) return nodes.map((n) => n.nodeId);
  const ids = new Set(nodes.map((n) => n.nodeId));
  const orphans: string[] = [];
  for (const n of nodes) {
    if (n.nodeId === rootId) continue;
    if (!n.parentNodeId) { orphans.push(n.nodeId); continue; }
    if (!ids.has(n.parentNodeId)) orphans.push(n.nodeId);
  }
  return orphans;
}

function computeTopologyIntegrityScore(input: {
  nodes: ThreadNodeShape[];
  rootId: string | null;
  orphans: string[];
  join: JoinIntegrity;
  ordering: OrderingIntegrity;
}): number {
  if (input.nodes.length === 0) return 100;
  let score = 100;
  // Root absent on a multi-node thread → severe.
  if (input.nodes.length >= 1 && !input.rootId) score -= 40;
  // Orphan penalty: 15 per orphan, capped at 50.
  score -= Math.min(50, input.orphans.length * 15);
  // Join integrity.
  if (input.join === 'broken') score -= 25;
  else if (input.join === 'gaps') score -= 12;
  // Ordering integrity.
  if (input.ordering === 'duplicates') score -= 18;
  else if (input.ordering === 'gaps') score -= 8;
  // Content presence — empty nodes cost some integrity.
  const emptyCount = input.nodes.filter((n) => !n.hasContent).length;
  score -= Math.min(20, emptyCount * 4);
  return clamp100(score);
}

export interface CaptureSnapshotInput {
  threadId: string;
  companyId: string;
  phase: ThreadSnapshotPhase;
  nodes: ThreadNodeShape[];
  rootNodeId?: string | null;
  takenAt?: string;
}

export interface ThreadTopologySnapshotEngine {
  capture(input: CaptureSnapshotInput): ThreadTopologySnapshot;
  list(threadId: string): ThreadTopologySnapshot[];
  current(threadId: string): ThreadTopologySnapshot | null;
  diff(threadId: string, fromPhase: ThreadSnapshotPhase, toPhase: ThreadSnapshotPhase): {
    addedNodeIds: string[];
    removedNodeIds: string[];
    reorderedNodeIds: string[];
    fromScore: number;
    toScore: number;
    integrityDelta: number;
  } | null;
  clear(threadId?: string): void;
  size(threadId?: string): number;
}

export function createThreadTopologySnapshotEngine(options?: {
  maxSnapshotsPerThread?: number;
}): ThreadTopologySnapshotEngine {
  const cap = Math.max(5, options?.maxSnapshotsPerThread ?? 50);
  const buckets = new Map<string, ThreadTopologySnapshot[]>();

  function bucket(threadId: string): ThreadTopologySnapshot[] {
    let b = buckets.get(threadId);
    if (!b) { b = []; buckets.set(threadId, b); }
    return b;
  }

  return {
    capture(input) {
      const positions = input.nodes.map((n) => n.position);
      const inferredRoot = input.rootNodeId
        ?? input.nodes.find((n) => n.position === 0 || (n.parentNodeId === null && input.nodes.length === 1))?.nodeId
        ?? null;
      const orphans = findOrphans(input.nodes, inferredRoot);
      const join = computeJoinIntegrity(input.nodes, inferredRoot);
      const ordering = computeOrderingIntegrity(positions);
      const topologyIntegrityScore = computeTopologyIntegrityScore({
        nodes: input.nodes, rootId: inferredRoot, orphans, join, ordering,
      });
      const snap: ThreadTopologySnapshot = {
        snapshotId: newId('snap'),
        threadId: input.threadId,
        companyId: input.companyId,
        takenAt: input.takenAt ?? new Date().toISOString(),
        phase: input.phase,
        nodes: [...input.nodes],
        rootNodeId: inferredRoot,
        orphanNodeIds: orphans,
        joinIntegrity: join,
        orderingIntegrity: ordering,
        topologyIntegrityScore,
      };
      const b = bucket(input.threadId);
      b.push(snap);
      while (b.length > cap) b.shift();
      return snap;
    },
    list(threadId) { return [...(buckets.get(threadId) ?? [])]; },
    current(threadId) {
      const b = buckets.get(threadId);
      if (!b || b.length === 0) return null;
      return b[b.length - 1];
    },
    diff(threadId, fromPhase, toPhase) {
      const b = buckets.get(threadId);
      if (!b) return null;
      const fromSnap = [...b].reverse().find((s) => s.phase === fromPhase);
      const toSnap = [...b].reverse().find((s) => s.phase === toPhase);
      if (!fromSnap || !toSnap) return null;
      const fromIds = new Set(fromSnap.nodes.map((n) => n.nodeId));
      const toIds = new Set(toSnap.nodes.map((n) => n.nodeId));
      const addedNodeIds: string[] = [];
      const removedNodeIds: string[] = [];
      const reorderedNodeIds: string[] = [];
      toIds.forEach((id) => { if (!fromIds.has(id)) addedNodeIds.push(id); });
      fromIds.forEach((id) => { if (!toIds.has(id)) removedNodeIds.push(id); });
      // reorder: same id, different position
      const fromByPos = new Map(fromSnap.nodes.map((n) => [n.nodeId, n.position]));
      for (const n of toSnap.nodes) {
        if (fromByPos.has(n.nodeId) && fromByPos.get(n.nodeId) !== n.position) reorderedNodeIds.push(n.nodeId);
      }
      return {
        addedNodeIds, removedNodeIds, reorderedNodeIds,
        fromScore: fromSnap.topologyIntegrityScore,
        toScore: toSnap.topologyIntegrityScore,
        integrityDelta: toSnap.topologyIntegrityScore - fromSnap.topologyIntegrityScore,
      };
    },
    clear(threadId) {
      if (!threadId) { buckets.clear(); return; }
      buckets.delete(threadId);
    },
    size(threadId) {
      if (threadId) return buckets.get(threadId)?.length ?? 0;
      let total = 0;
      buckets.forEach((b) => { total += b.length; });
      return total;
    },
  };
}

let _default: ThreadTopologySnapshotEngine | null = null;
export function getDefaultThreadTopologySnapshotEngine(): ThreadTopologySnapshotEngine {
  if (!_default) _default = createThreadTopologySnapshotEngine();
  return _default;
}
export function setDefaultThreadTopologySnapshotEngine(e: ThreadTopologySnapshotEngine): void {
  _default = e;
}
