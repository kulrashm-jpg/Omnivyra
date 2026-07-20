/**
 * Communication Graph projector (OMNI-COORD-002 Phase 6) — PURE, metadata only.
 *
 * Projects already-stored registry metadata (SemanticRoots + artifact-node
 * CommunicationRecords) into a nodes+edges view. It is a deterministic pure
 * function: no I/O, no clock, no persistence, NO graph database. It merely reads
 * the lineage fields each artifact already exposes and renders the relationships.
 */
import type { ArtifactType, CommunicationRecord } from './coordinationContracts';
import type {
  SemanticRoot,
  CommunicationGraph,
  GraphNode,
  GraphNodeKind,
  GraphEdge,
} from './semanticContinuityContracts';

/** Map an artifact type to its coarse graph-node kind. */
export function nodeKindForArtifact(type: ArtifactType | undefined): GraphNodeKind {
  switch (type) {
    case 'semantic_root': return 'semantic_root';
    case 'visual_brief':
    case 'image':
    case 'image_text': return 'visual';
    case 'engagement': return 'engagement';
    case 'analytics': return 'analytics';
    case 'content_brief':
    case 'post':
    case 'platform_adaptation':
    case 'published_asset':
    default: return 'content';
  }
}

const campaignNodeId = (campaignId: string): string => `campaign:${campaignId}`;

/**
 * Build a communication graph for a company (optionally scoped to one root).
 * Deterministic ordering: roots first, then artifacts in input order; edges in
 * discovery order. Edges are de-duplicated on (from,to,kind).
 */
export function buildCommunicationGraph(input: {
  companyId: string;
  roots: SemanticRoot[];
  artifacts: CommunicationRecord[];
  semanticRootId?: string;
}): CommunicationGraph {
  const { companyId, semanticRootId } = input;
  const roots = semanticRootId ? input.roots.filter((r) => r.id === semanticRootId) : input.roots;
  const artifacts = semanticRootId
    ? input.artifacts.filter((a) => a.semanticRootId === semanticRootId)
    : input.artifacts;

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const seenNodes = new Set<string>();
  const seenEdges = new Set<string>();

  const addNode = (n: GraphNode): void => {
    if (seenNodes.has(n.id)) return;
    seenNodes.add(n.id);
    nodes.push(n);
  };
  const addEdge = (e: GraphEdge): void => {
    const key = `${e.from}→${e.to}:${e.kind}`;
    if (seenEdges.has(key)) return;
    seenEdges.add(key);
    edges.push(e);
  };

  // Root nodes.
  for (const r of roots) {
    addNode({ id: r.id, kind: 'semantic_root', artifactType: 'semantic_root', semanticRootId: r.id, label: r.topic });
  }

  // Artifact nodes + their lineage edges.
  for (const a of artifacts) {
    addNode({
      id: a.id,
      kind: nodeKindForArtifact(a.artifactType),
      artifactType: a.artifactType,
      semanticRootId: a.semanticRootId,
      label: a.topic,
      ref: a.contentRef ?? null,
    });

    // Campaign membership (campaign nodes are synthesized from campaignId).
    if (a.campaignId) {
      addNode({ id: campaignNodeId(a.campaignId), kind: 'campaign', semanticRootId: a.semanticRootId, label: a.campaignId });
      addEdge({ from: a.id, to: campaignNodeId(a.campaignId), kind: 'belongs_to' });
    }

    // Every artifact belongs to its semantic root.
    addEdge({ from: a.id, to: a.semanticRootId, kind: 'belongs_to' });

    // Typed relationship to the direct predecessor (or to the root as origin).
    const predecessor = a.parentArtifactId ?? a.semanticRootId;
    const typedKind =
      a.artifactType === 'platform_adaptation' ? 'adapts'
      : a.artifactType === 'engagement' ? 'responds_to'
      : a.artifactType === 'analytics' ? 'measures'
      : 'derives_from';
    addEdge({ from: a.id, to: predecessor, kind: typedKind });

    // Additional multi-source provenance.
    for (const src of a.derivedFrom ?? []) {
      addEdge({ from: a.id, to: src, kind: 'derives_from' });
    }
  }

  return { companyId, semanticRootId, nodes, edges };
}
