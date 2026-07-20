/**
 * Semantic Profile (WS-2D Phase 5) — semantic-root-centric intelligence.
 * Everything derives from the existing graph: `getLineage` (root + artifacts +
 * scoped graph) + centralized `graphNavigation` (ancestors/descendants/lineageTree)
 * + `getSemanticClusters` + `getRepeatedIntents`. No new traversal.
 */
import type { QueryProfile, ProfileDeps } from './queryProfileFramework';
import { must } from './queryProfileFramework';
import { toSummary, type CommunicationSummary } from './profileModels';
import { ancestorsOf, descendantsOf, lineageTree, type LineageTreeNode } from '../intelligence/graphNavigation';
import type { SemanticRoot } from '../semanticContinuityContracts';
import type { SemanticCluster, RepeatedIntent } from '../intelligence/communicationIntelligenceContracts';

export interface SemanticProfileRequest {
  semanticRootId: string;
  /** Node to compute ancestors/descendants for; defaults to the root. */
  focusNodeId?: string;
}

export interface SemanticProfileData {
  semanticRootId: string;
  root: SemanticRoot | null;
  artifacts: CommunicationSummary[];
  focusNodeId: string;
  ancestorIds: string[];
  descendantIds: string[];
  cluster: SemanticCluster | null;
  duplicateHistory: RepeatedIntent | null;
  lineageTree: LineageTreeNode | null;
}

export const semanticProfile: QueryProfile<SemanticProfileRequest, SemanticProfileData> = {
  type: 'semantic',
  async run(deps: ProfileDeps, companyId, req) {
    const lineage = must(await deps.intel.getLineage(companyId, req.semanticRootId));
    const graph = lineage.graph;
    const focusNodeId = req.focusNodeId ?? req.semanticRootId;

    const clusters = must(await deps.intel.getSemanticClusters(companyId));
    const repeats = must(await deps.intel.getRepeatedIntents(companyId));

    return {
      semanticRootId: req.semanticRootId,
      root: lineage.root,
      artifacts: lineage.artifacts.map(toSummary),
      focusNodeId,
      ancestorIds: ancestorsOf(graph, focusNodeId).map((n) => n.id),
      descendantIds: descendantsOf(graph, focusNodeId).map((n) => n.id),
      cluster: clusters.find((c) => c.semanticRootId === req.semanticRootId) ?? null,
      duplicateHistory: repeats.find((r) => r.semanticRootId === req.semanticRootId) ?? null,
      lineageTree: lineageTree(graph, req.semanticRootId),
    };
  },
  resultCount: (d) => d.artifacts.length,
};
