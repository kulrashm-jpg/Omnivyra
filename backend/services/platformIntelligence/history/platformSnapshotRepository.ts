/**
 * Platform snapshot repository (Phase 37). Deterministic persistence of canonical plugin
 * snapshots behind a pluggable SnapshotStore. The default store is in-memory (process-local)
 * so the history/trend/anomaly layer works with NO schema change; a durable Supabase-table
 * adapter can be injected via setSnapshotStore() once a migration is approved (the row shape
 * IS HistoricalSnapshot — `platform_intelligence_snapshots`).
 */
import type { HistoricalSnapshot } from './platformSnapshotTypes';

export interface SnapshotStore {
  save(rows: HistoricalSnapshot[]): Promise<void>;
  /** Returns rows for (companyId[, pluginId]) sorted oldest → newest by takenAt. */
  list(companyId: string, pluginId?: string): Promise<HistoricalSnapshot[]>;
}

/** Default in-memory store (no schema change). Swap via setSnapshotStore for durability. */
function createInMemoryStore(): SnapshotStore {
  const byCompany = new Map<string, HistoricalSnapshot[]>();
  return {
    async save(rows) {
      for (const r of rows) {
        const arr = byCompany.get(r.companyId) ?? [];
        arr.push(r);
        arr.sort((a, b) => a.takenAt.localeCompare(b.takenAt));
        byCompany.set(r.companyId, arr);
      }
    },
    async list(companyId, pluginId) {
      const arr = byCompany.get(companyId) ?? [];
      return (pluginId ? arr.filter((r) => r.pluginId === pluginId) : arr).slice();
    },
  };
}

let store: SnapshotStore = createInMemoryStore();
export function setSnapshotStore(s: SnapshotStore): void { store = s; }
export function getSnapshotStore(): SnapshotStore { return store; }
export function __resetSnapshotStore(): void { store = createInMemoryStore(); } // test isolation

export async function saveSnapshots(rows: HistoricalSnapshot[]): Promise<void> { return store.save(rows); }
export async function listSnapshots(companyId: string, pluginId?: string): Promise<HistoricalSnapshot[]> { return store.list(companyId, pluginId); }

export async function latestSnapshot(companyId: string, pluginId: string): Promise<HistoricalSnapshot | null> {
  const rows = await store.list(companyId, pluginId);
  return rows.length ? rows[rows.length - 1]! : null;
}
export async function previousSnapshot(companyId: string, pluginId: string): Promise<HistoricalSnapshot | null> {
  const rows = await store.list(companyId, pluginId);
  return rows.length >= 2 ? rows[rows.length - 2]! : null;
}
