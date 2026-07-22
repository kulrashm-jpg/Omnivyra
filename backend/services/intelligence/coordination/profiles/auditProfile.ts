/**
 * Audit Profile (WS-2D Phase 7) — governance/diagnostics over registered
 * communications. Composes `getHistory` + `getGraph` + `getGaps`. No new traversal.
 */
import type { QueryProfile, ProfileDeps } from './queryProfileFramework';
import { must } from './queryProfileFramework';
import { toSummary, type CommunicationSummary } from './profileModels';
import { COMMUNICATION_LIFECYCLE } from '../registration/registrationContracts';
import type { CommunicationGap } from '../intelligence/communicationIntelligenceContracts';

export type AuditProfileRequest = Record<string, never>;

export interface AuditProfileData {
  missingSemanticRoots: string[];                              // roots referenced by artifacts but not registered
  brokenLineage: { id: string; parentArtifactId: string }[];  // parent id not resolvable
  orphanArtifacts: CommunicationSummary[];                     // no registered root AND no resolvable parent
  nonCanonicalLifecycle: { id: string; state: string }[];     // publicationStatus outside the canonical lifecycle
  duplicateIdempotencyKeys: { idempotencyKey: string; ids: string[] }[]; // should be impossible (unique index)
  staleCommunications: CommunicationGap[];
  graphAnomalies: string[];                                    // edges referencing a missing node
}

const uniq = <T>(xs: T[]): T[] => Array.from(new Set(xs));
const CANONICAL = new Set<string>(COMMUNICATION_LIFECYCLE);

export const auditProfile: QueryProfile<AuditProfileRequest, AuditProfileData> = {
  type: 'audit',
  async run(deps: ProfileDeps, companyId) {
    const all = must(await deps.intel.getHistory(companyId, {}));
    const graph = must(await deps.intel.getGraph(companyId));
    const gaps = must(await deps.intel.getGaps(companyId));

    const rootNodeIds = new Set(graph.nodes.filter((n) => n.kind === 'semantic_root').map((n) => n.id));
    const idSet = new Set(all.map((r) => r.id));
    const nodeIds = new Set(graph.nodes.map((n) => n.id));

    const missingSemanticRoots = uniq(all.map((r) => r.semanticRootId).filter((rid) => !rootNodeIds.has(rid)));
    const brokenLineage = all
      .filter((r) => r.parentArtifactId && !idSet.has(r.parentArtifactId))
      .map((r) => ({ id: r.id, parentArtifactId: r.parentArtifactId as string }));
    const orphanArtifacts = all
      .filter((r) => !rootNodeIds.has(r.semanticRootId) && (!r.parentArtifactId || !idSet.has(r.parentArtifactId)))
      .map(toSummary);
    const nonCanonicalLifecycle = all
      .filter((r) => !CANONICAL.has(r.publicationStatus))
      .map((r) => ({ id: r.id, state: r.publicationStatus }));

    const byKey = new Map<string, string[]>();
    for (const r of all) {
      if (!r.idempotencyKey) continue;
      const list = byKey.get(r.idempotencyKey) ?? [];
      list.push(r.id);
      byKey.set(r.idempotencyKey, list);
    }
    const duplicateIdempotencyKeys = Array.from(byKey.entries())
      .filter(([, ids]) => ids.length > 1)
      .map(([idempotencyKey, ids]) => ({ idempotencyKey, ids }));

    const graphAnomalies = graph.edges
      .filter((e) => !nodeIds.has(e.from) || !nodeIds.has(e.to))
      .map((e) => `${e.from} -${e.kind}-> ${e.to}`);

    return {
      missingSemanticRoots,
      brokenLineage,
      orphanArtifacts,
      nonCanonicalLifecycle,
      duplicateIdempotencyKeys,
      staleCommunications: gaps.filter((g) => g.kind === 'stale'),
      graphAnomalies,
    };
  },
  resultCount: (d) => d.missingSemanticRoots.length + d.brokenLineage.length + d.orphanArtifacts.length
    + d.nonCanonicalLifecycle.length + d.duplicateIdempotencyKeys.length + d.staleCommunications.length + d.graphAnomalies.length,
};
