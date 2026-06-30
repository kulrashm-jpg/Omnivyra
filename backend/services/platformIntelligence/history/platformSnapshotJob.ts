/**
 * Platform snapshot job (Phase 39). Composes every registered plugin EXACTLY ONCE for a
 * company (shared CompositionContext + composePluginSnapshotMemoized) and persists the batch.
 * No second composition, no second persistence, no plugin recalculation beyond the single
 * shared composition. Reuses the existing registry + Phase-37 writer.
 */
import { getPlugins, composePluginSnapshotMemoized, createCompositionContext, type IntelligencePlugin, type PluginSnapshot } from '../registry';
import { persistSnapshots } from './platformSnapshotWriter';

export interface SnapshotJobResult {
  companyId: string;
  takenAt: string;
  pluginsComposed: number;
  snapshotsPersisted: number;
  durationMs: number;
  errors: Array<{ pluginId: string; error: string }>;
}

/** Run the snapshot job for one company. `plugins`/`nowMs` injectable for testing. */
export async function runPlatformSnapshotJob(
  companyId: string,
  opts: { nowMs?: number; plugins?: IntelligencePlugin[] } = {},
): Promise<SnapshotJobResult> {
  const startedAt = opts.nowMs ?? Date.now();
  const nowMs = startedAt;
  const takenAt = new Date(nowMs).toISOString();
  const plugins = opts.plugins ?? getPlugins();
  const ctx = createCompositionContext(); // one shared context → each plugin composes once

  const errors: Array<{ pluginId: string; error: string }> = [];
  const settled = await Promise.all(plugins.map((p) =>
    composePluginSnapshotMemoized(p, companyId, nowMs, ctx)
      .then((s): PluginSnapshot | null => s)
      .catch((e) => { errors.push({ pluginId: p.id, error: e instanceof Error ? e.message : String(e) }); return null; }),
  ));
  const snapshots = settled.filter((s): s is PluginSnapshot => s != null);

  const rows = await persistSnapshots(companyId, snapshots, takenAt); // exactly one write per composed plugin
  return {
    companyId, takenAt,
    pluginsComposed: snapshots.length,
    snapshotsPersisted: rows.length,
    durationMs: (opts.nowMs != null ? 0 : Date.now() - startedAt),
    errors,
  };
}
