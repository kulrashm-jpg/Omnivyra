/**
 * Phase 8 — Runtime archival manager.
 *
 * Cold-storage for evicted events: takes events older than the retention
 * threshold, compresses them into a single archival entry per session,
 * and lets operators query them later. Also emits replay checkpoints —
 * "you can resume from this sequence" anchors that survive truncation.
 *
 * No external persistence; archives live in-memory by default but are
 * pluggable (the SnapshotStore pattern from Phase 13 cross-modal layer
 * is the reference template).
 *
 * Pure / deterministic.
 */

import type {
  PersistedRuntimeEvent,
  RuntimeArchiveEntry,
  RuntimeReplayCheckpoint,
} from './threadRuntimeTypes';

function stableHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h) ^ text.charCodeAt(i);
  return (h >>> 0).toString(16);
}
function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export interface RuntimeArchiveStore {
  put(entry: RuntimeArchiveEntry): Promise<void> | void;
  get(archiveId: string): Promise<RuntimeArchiveEntry | null> | RuntimeArchiveEntry | null;
  listForCompany(companyId: string): Promise<RuntimeArchiveEntry[]> | RuntimeArchiveEntry[];
  delete(archiveId: string): Promise<void> | void;
}

export function createInMemoryRuntimeArchiveStore(): RuntimeArchiveStore {
  const map = new Map<string, RuntimeArchiveEntry>();
  return {
    put(e) { map.set(e.archiveId, e); },
    get(id) { return map.get(id) ?? null; },
    listForCompany(companyId) {
      const out: RuntimeArchiveEntry[] = [];
      map.forEach((e) => { if (e.companyId === companyId) out.push(e); });
      return out.sort((a, b) => a.archivedAt.localeCompare(b.archivedAt));
    },
    delete(id) { map.delete(id); },
  };
}

export interface RuntimeCheckpointStore {
  put(c: RuntimeReplayCheckpoint): Promise<void> | void;
  latestFor(input: { companyId: string; threadId: string }): Promise<RuntimeReplayCheckpoint | null> | RuntimeReplayCheckpoint | null;
  listForCompany(companyId: string): Promise<RuntimeReplayCheckpoint[]> | RuntimeReplayCheckpoint[];
}

export function createInMemoryRuntimeCheckpointStore(): RuntimeCheckpointStore {
  const map = new Map<string, RuntimeReplayCheckpoint[]>(); // company → list
  return {
    put(c) {
      const arr = map.get(c.companyId) ?? [];
      arr.push(c);
      map.set(c.companyId, arr);
    },
    latestFor(input) {
      const arr = map.get(input.companyId) ?? [];
      const candidates = arr.filter((c) => c.threadId === input.threadId).sort((a, b) => b.takenAt.localeCompare(a.takenAt));
      return candidates[0] ?? null;
    },
    listForCompany(companyId) {
      return [...(map.get(companyId) ?? [])].sort((a, b) => a.takenAt.localeCompare(b.takenAt));
    },
  };
}

export interface RuntimeArchivalManager {
  archiveSession(input: { events: PersistedRuntimeEvent[]; companyId: string; threadId: string; runtimeSessionId: string }): Promise<RuntimeArchiveEntry>;
  retrieveArchive(archiveId: string): Promise<{ entry: RuntimeArchiveEntry; events: PersistedRuntimeEvent[]; integrityOk: boolean } | null>;
  checkpointReplay(input: { events: PersistedRuntimeEvent[]; companyId: string; threadId: string; runtimeSessionId: string }): Promise<RuntimeReplayCheckpoint | null>;
  latestCheckpoint(input: { companyId: string; threadId: string }): Promise<RuntimeReplayCheckpoint | null>;
}

export interface RuntimeArchivalManagerOptions {
  archiveStore?: RuntimeArchiveStore;
  checkpointStore?: RuntimeCheckpointStore;
}

export function createRuntimeArchivalManager(options?: RuntimeArchivalManagerOptions): RuntimeArchivalManager {
  const archiveStore = options?.archiveStore ?? createInMemoryRuntimeArchiveStore();
  const checkpointStore = options?.checkpointStore ?? createInMemoryRuntimeCheckpointStore();

  function topologyDigest(events: PersistedRuntimeEvent[]): string {
    // Compact digest: archetype counts + nodeIds in canonical order.
    const sig = events
      .map((e) => `${e.eventType}|${e.orchestrationSequence}|${Array.isArray((e.payloadJson as { childNodeIds?: string[] })?.childNodeIds) ? ((e.payloadJson as { childNodeIds?: string[] }).childNodeIds!).join(',') : ''}`)
      .join('|');
    return stableHash(sig);
  }

  return {
    async archiveSession(input) {
      if (input.events.length === 0) {
        const empty: RuntimeArchiveEntry = {
          archiveId: newId('arch'),
          companyId: input.companyId,
          threadId: input.threadId,
          runtimeSessionId: input.runtimeSessionId,
          archivedAt: new Date().toISOString(),
          windowStart: new Date().toISOString(),
          windowEnd: new Date().toISOString(),
          blob: '[]',
          integrityHash: 'arch_empty',
          eventCount: 0,
        };
        await archiveStore.put(empty);
        return empty;
      }
      const sorted = [...input.events].sort((a, b) => a.orchestrationSequence - b.orchestrationSequence);
      const blob = JSON.stringify(sorted);
      const integrityHash = `arch_${stableHash(blob)}`;
      const entry: RuntimeArchiveEntry = {
        archiveId: newId('arch'),
        companyId: input.companyId,
        threadId: input.threadId,
        runtimeSessionId: input.runtimeSessionId,
        archivedAt: new Date().toISOString(),
        windowStart: sorted[0].timestamp,
        windowEnd: sorted[sorted.length - 1].timestamp,
        blob,
        integrityHash,
        eventCount: sorted.length,
      };
      await archiveStore.put(entry);
      return entry;
    },
    async retrieveArchive(archiveId) {
      const got = archiveStore.get(archiveId);
      const entry = got instanceof Promise ? await got : got;
      if (!entry) return null;
      let events: PersistedRuntimeEvent[] = [];
      let integrityOk = true;
      try {
        events = JSON.parse(entry.blob) as PersistedRuntimeEvent[];
      } catch {
        events = [];
        integrityOk = false;
      }
      const recomputed = `arch_${stableHash(entry.blob)}`;
      if (recomputed !== entry.integrityHash) integrityOk = false;
      return { entry, events, integrityOk };
    },
    async checkpointReplay(input) {
      if (input.events.length === 0) return null;
      const sorted = [...input.events].sort((a, b) => a.orchestrationSequence - b.orchestrationSequence);
      const last = sorted[sorted.length - 1];
      const cp: RuntimeReplayCheckpoint = {
        checkpointId: newId('cp'),
        companyId: input.companyId,
        threadId: input.threadId,
        runtimeSessionId: input.runtimeSessionId,
        takenAt: new Date().toISOString(),
        lastIncludedSequence: last.orchestrationSequence,
        lastIncludedEventId: last.eventId,
        topologyDigest: topologyDigest(sorted),
      };
      await checkpointStore.put(cp);
      return cp;
    },
    async latestCheckpoint(input) {
      const v = checkpointStore.latestFor(input);
      return v instanceof Promise ? await v : v;
    },
  };
}
