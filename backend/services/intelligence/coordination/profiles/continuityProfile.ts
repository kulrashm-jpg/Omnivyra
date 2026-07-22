/**
 * Continuity Profile (WS-2D Phase 3) — semantic continuity for a company.
 * Composes `getContinuityReport` + `getGraph` + `getHistory`; adds a deterministic
 * continuity score. No new traversal.
 */
import type { QueryProfile, ProfileDeps } from './queryProfileFramework';
import { must } from './queryProfileFramework';
import { toSummary, type CommunicationSummary } from './profileModels';
import type {
  SemanticCluster,
  RepeatedIntent,
  CommunicationGap,
} from '../intelligence/communicationIntelligenceContracts';

export type ContinuityProfileRequest = Record<string, never>;

export interface LineageSummaryEntry {
  semanticRootId: string;
  artifactCount: number;
  platforms: string[];
  lifecycleStates: string[];
  campaignIds: string[];
}

export interface ContinuityProfileData {
  totalCommunications: number;
  semanticRoots: string[];
  clusters: SemanticCluster[];
  repeatedIntents: RepeatedIntent[];
  gaps: CommunicationGap[];
  orphanCommunications: CommunicationSummary[];
  lineageSummary: LineageSummaryEntry[];
  /** 0..1 — 0.6·published-root ratio + 0.4·(1 − gap-root ratio). */
  continuityScore: number;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export const continuityProfile: QueryProfile<ContinuityProfileRequest, ContinuityProfileData> = {
  type: 'continuity',
  async run(deps: ProfileDeps, companyId) {
    const report = must(await deps.intel.getContinuityReport(companyId));
    const graph = must(await deps.intel.getGraph(companyId));
    const history = must(await deps.intel.getHistory(companyId, {}));

    const rootNodeIds = new Set(graph.nodes.filter((n) => n.kind === 'semantic_root').map((n) => n.id));
    const orphanCommunications = history.filter((r) => !rootNodeIds.has(r.semanticRootId)).map(toSummary);

    const lineageSummary: LineageSummaryEntry[] = report.clusters.map((c) => ({
      semanticRootId: c.semanticRootId,
      artifactCount: c.size,
      platforms: c.platforms,
      lifecycleStates: c.lifecycleStates,
      campaignIds: c.campaignIds,
    }));

    const rootCount = report.clusters.length;
    const publishedRoots = report.clusters.filter((c) => c.lifecycleStates.includes('published')).length;
    const gapRoots = new Set(report.gaps.map((g) => g.semanticRootId)).size;
    const continuityScore = rootCount === 0
      ? 1
      : clamp01((publishedRoots / rootCount) * 0.6 + (1 - gapRoots / rootCount) * 0.4);

    return {
      totalCommunications: report.totalCommunications,
      semanticRoots: report.clusters.map((c) => c.semanticRootId),
      clusters: report.clusters,
      repeatedIntents: report.repeatedIntents,
      gaps: report.gaps,
      orphanCommunications,
      lineageSummary,
      continuityScore,
    };
  },
  resultCount: (d) => d.clusters.length,
};
