/**
 * G-B209 — Graph Observability (pure summarizer; no global state, no live telemetry emission — keeps
 * Phase B additive). Metrics over the materialized graph: node/edge counts, owned vs reference nodes,
 * type usage, registry utilization, integrity failures.
 */

import type { MaterializedGraph, GraphMetrics, GraphIntegrityReport, NodeRegistry, EdgeRegistry } from './types';

export function graphMetrics(g: MaterializedGraph, integrity: GraphIntegrityReport, registries?: { nodes?: NodeRegistry; edges?: EdgeRegistry }): GraphMetrics {
  const nodeTypesUsed = new Set(g.nodes.map((n) => n.type)).size;
  const edgeTypesUsed = new Set(g.edges.map((e) => e.type)).size;
  const registeredNodeTypes = registries?.nodes?.all().length ?? 0;
  const registeredEdgeTypes = registries?.edges?.all().length ?? 0;
  return {
    nodeCount: g.nodes.length,
    edgeCount: g.edges.length,
    ownedNodes: g.nodes.filter((n) => n.owner !== null).length,
    referenceNodes: g.nodes.filter((n) => n.owner === null).length,
    nodeTypesUsed, edgeTypesUsed, registeredNodeTypes, registeredEdgeTypes,
    registryUtilizationNodes: registeredNodeTypes ? Number((nodeTypesUsed / registeredNodeTypes).toFixed(4)) : 0,
    registryUtilizationEdges: registeredEdgeTypes ? Number((edgeTypesUsed / registeredEdgeTypes).toFixed(4)) : 0,
    integrityFailures: integrity.issues.filter((i) => i.code !== 'orphan_node').length,
  };
}
