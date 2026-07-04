/**
 * Platform root-cause engine (Phase 40). Deterministic attribution over changes already
 * derived from persisted history. No plugin execution, no new calculations — it ranks the
 * negative changes by magnitude and cites the dependency chain from the registry.
 */
import { getPlugins } from '../registry';
import type { Change } from './platformChangeEngine';

export interface RootCause {
  primaryCause: string | null;
  primaryPlugin: string | null;
  supportingCauses: string[];
  affectedPlugins: string[];
  affectedDimensions: string[];
  evidenceChain: string[];
  dependencyChain: string[];
  confidence: number;
}

const magnitude = (c: Change) => (typeof c.delta === 'number' ? Math.abs(c.delta) : 12);

/** dimsByPlugin: pluginId → businessImpact.topDimensions (from the latest snapshots). */
export function analyzeRootCause(changes: Change[], dimsByPlugin: Record<string, string[]> = {}): RootCause {
  const negatives = changes.filter((c) => c.negative).sort((a, b) => magnitude(b) - magnitude(a));
  if (negatives.length === 0) {
    return { primaryCause: null, primaryPlugin: null, supportingCauses: [], affectedPlugins: [], affectedDimensions: [], evidenceChain: [], dependencyChain: [], confidence: 0 };
  }
  const primary = negatives[0]!;
  const affectedPlugins = [...new Set(negatives.map((c) => c.pluginId))];
  const affectedDimensions = [...new Set(affectedPlugins.flatMap((p) => dimsByPlugin[p] ?? []))];
  const deps = getPlugins().find((p) => p.id === primary.pluginId)?.dependencies ?? [];
  const confidence = Math.min(0.9, Math.round((0.4 + 0.1 * negatives.length) * 100) / 100);
  return {
    primaryCause: primary.detail,
    primaryPlugin: primary.pluginId,
    supportingCauses: negatives.slice(1).map((c) => c.detail),
    affectedPlugins,
    affectedDimensions,
    evidenceChain: negatives.map((c) => `${c.pluginId}: ${c.detail}`),
    dependencyChain: deps,
    confidence,
  };
}
