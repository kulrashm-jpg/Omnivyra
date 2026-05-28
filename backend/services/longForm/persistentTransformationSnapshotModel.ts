/**
 * Phase 13.4 — Persistent transformation snapshot model.
 *
 * Pluggable persistence abstraction for cross-modal governance state.
 * In-memory by default; consumers can swap in any storage backend
 * implementing `PersistentSnapshotStore`.
 *
 * Snapshots capture:
 *   - cross-modal assets + lineages
 *   - feedback events
 *   - fatigue patterns
 *   - chain-health records
 *   - adaptive samples
 *
 * Restore mode reconstructs state in-process (does NOT auto-wire it back
 * into the live registries — caller decides whether to clear-and-replay).
 *
 * Pure / deterministic. No DB integration required.
 */

import type {
  AdaptiveTransformationProfile,
  ChainHealthResult,
  CrossModalAsset,
  FeedbackEvent,
  PersistedTransformationSnapshot,
  SnapshotIntegrityResult,
  TransformationFatiguePattern,
  TransformationLineage,
} from './longFormRecommendationTypes';

const SCHEMA_VERSION = 1;

function stableHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h) ^ text.charCodeAt(i);
  return (h >>> 0).toString(16);
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export interface SnapshotPayload {
  assets: CrossModalAsset[];
  lineages: TransformationLineage[];
  feedbackEvents: FeedbackEvent[];
  fatiguePatterns: TransformationFatiguePattern[];
  chainHealthRecords: ChainHealthResult[];
  adaptiveSamples: AdaptiveTransformationProfile[];
}

export interface PersistentSnapshotStore {
  put(snapshot: PersistedTransformationSnapshot): Promise<void> | void;
  get(snapshotId: string): Promise<PersistedTransformationSnapshot | null> | PersistedTransformationSnapshot | null;
  listForCompany(companyId: string): Promise<PersistedTransformationSnapshot[]> | PersistedTransformationSnapshot[];
  delete(snapshotId: string): Promise<void> | void;
}

export function createInMemorySnapshotStore(): PersistentSnapshotStore {
  const map = new Map<string, PersistedTransformationSnapshot>();
  return {
    put(s) { map.set(s.snapshotId, s); },
    get(id) { return map.get(id) ?? null; },
    listForCompany(companyId) {
      const out: PersistedTransformationSnapshot[] = [];
      map.forEach((s) => { if (s.companyId === companyId) out.push(s); });
      return out.sort((a, b) => a.takenAt.localeCompare(b.takenAt));
    },
    delete(id) { map.delete(id); },
  };
}

export interface PersistentTransformationSnapshotModel {
  takeSnapshot(input: { companyId: string; payload: SnapshotPayload }): Promise<PersistedTransformationSnapshot>;
  verify(snapshot: PersistedTransformationSnapshot): SnapshotIntegrityResult;
  restore(snapshot: PersistedTransformationSnapshot): { payload: SnapshotPayload; integrity: SnapshotIntegrityResult };
  list(companyId: string): Promise<PersistedTransformationSnapshot[]>;
  delete(snapshotId: string): Promise<void>;
}

export function createPersistentTransformationSnapshotModel(store?: PersistentSnapshotStore): PersistentTransformationSnapshotModel {
  const backing = store ?? createInMemorySnapshotStore();

  function serialize(payload: SnapshotPayload): string {
    // Stable key ordering for hash stability.
    return JSON.stringify({
      assets: payload.assets,
      lineages: payload.lineages,
      feedbackEvents: payload.feedbackEvents,
      fatiguePatterns: payload.fatiguePatterns,
      chainHealthRecords: payload.chainHealthRecords,
      adaptiveSamples: payload.adaptiveSamples,
    });
  }

  function deserialize(blob: string): SnapshotPayload {
    const parsed = JSON.parse(blob) as Partial<SnapshotPayload>;
    return {
      assets: parsed.assets ?? [],
      lineages: parsed.lineages ?? [],
      feedbackEvents: parsed.feedbackEvents ?? [],
      fatiguePatterns: parsed.fatiguePatterns ?? [],
      chainHealthRecords: parsed.chainHealthRecords ?? [],
      adaptiveSamples: parsed.adaptiveSamples ?? [],
    };
  }

  return {
    async takeSnapshot(input) {
      const blob = serialize(input.payload);
      const integrityHash = `snap_${stableHash(blob)}`;
      const snapshot: PersistedTransformationSnapshot = {
        snapshotId: newId('snap'),
        companyId: input.companyId,
        takenAt: new Date().toISOString(),
        schemaVersion: SCHEMA_VERSION,
        payloads: {
          assets: input.payload.assets.length,
          lineages: input.payload.lineages.length,
          feedbackEvents: input.payload.feedbackEvents.length,
          fatiguePatterns: input.payload.fatiguePatterns.length,
          chainHealthRecords: input.payload.chainHealthRecords.length,
          adaptiveSamples: input.payload.adaptiveSamples.length,
        },
        blob,
        integrityHash,
      };
      await backing.put(snapshot);
      return snapshot;
    },
    verify(snapshot) {
      const warnings: string[] = [];
      const schemaOk = snapshot.schemaVersion === SCHEMA_VERSION;
      if (!schemaOk) warnings.push(`Schema version mismatch: snapshot=${snapshot.schemaVersion} runtime=${SCHEMA_VERSION}.`);

      let payloadCountsMatch = true;
      let hashVerified = true;
      try {
        const parsed = deserialize(snapshot.blob);
        const expectedCounts = snapshot.payloads;
        const actualCounts = {
          assets: parsed.assets.length,
          lineages: parsed.lineages.length,
          feedbackEvents: parsed.feedbackEvents.length,
          fatiguePatterns: parsed.fatiguePatterns.length,
          chainHealthRecords: parsed.chainHealthRecords.length,
          adaptiveSamples: parsed.adaptiveSamples.length,
        };
        for (const k of Object.keys(expectedCounts) as Array<keyof typeof expectedCounts>) {
          if (expectedCounts[k] !== actualCounts[k]) {
            payloadCountsMatch = false;
            warnings.push(`Payload count mismatch for ${k}: expected ${expectedCounts[k]}, got ${actualCounts[k]}.`);
          }
        }
        const recomputedHash = `snap_${stableHash(snapshot.blob)}`;
        if (recomputedHash !== snapshot.integrityHash) {
          hashVerified = false;
          warnings.push(`Integrity hash mismatch: expected ${snapshot.integrityHash}, recomputed ${recomputedHash}.`);
        }
      } catch (err) {
        payloadCountsMatch = false;
        hashVerified = false;
        warnings.push(`Snapshot blob unparseable: ${(err as Error).message}.`);
      }

      const score = [schemaOk, payloadCountsMatch, hashVerified].filter(Boolean).length;
      return {
        snapshotIntegrityScore: Math.round((score / 3) * 100),
        schemaOk,
        payloadCountsMatch,
        hashVerified,
        warnings,
      };
    },
    restore(snapshot) {
      const integrity = this.verify(snapshot);
      const payload = integrity.payloadCountsMatch
        ? deserialize(snapshot.blob)
        : { assets: [], lineages: [], feedbackEvents: [], fatiguePatterns: [], chainHealthRecords: [], adaptiveSamples: [] };
      return { payload, integrity };
    },
    async list(companyId) {
      const result = backing.listForCompany(companyId);
      return Array.isArray(result) ? result : await result;
    },
    async delete(snapshotId) {
      await backing.delete(snapshotId);
    },
  };
}

let _default: PersistentTransformationSnapshotModel | null = null;
export function getDefaultPersistentTransformationSnapshotModel(): PersistentTransformationSnapshotModel {
  if (!_default) _default = createPersistentTransformationSnapshotModel();
  return _default;
}
export function setDefaultPersistentTransformationSnapshotModel(m: PersistentTransformationSnapshotModel): void {
  _default = m;
}

export { SCHEMA_VERSION };
