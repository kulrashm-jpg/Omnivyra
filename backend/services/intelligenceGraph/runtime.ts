/**
 * G-B201 — Canonical Graph Runtime (pure orchestrator; owns no business semantics). Ties publication
 * → materialization → integrity → metrics into a single deterministic lifecycle, and produces
 * immutable snapshots. Flag-gated for any consumer path (default OFF). Reads Programs 1–3's
 * understandings unchanged; writes nothing back.
 */

import type { PublishableUnderstanding, GraphContribution, MaterializedGraph, GraphIntegrityReport, GraphMetrics, NodeRegistry, EdgeRegistry } from './types';
import { publishAll } from './publisher';
import { materializeGraph } from './materializer';
import { checkIntegrity } from './integrity';
import { graphMetrics } from './observability';
import { createNodeRegistry, createEdgeRegistry } from './registry';
import { isIntelligenceGraphEnabled } from './flags';

export interface GraphSnapshot {
  graph: MaterializedGraph;
  contributions: GraphContribution[];
  integrity: GraphIntegrityReport;
  metrics: GraphMetrics;
  builtAt: string;
}

export interface GraphRuntimeOptions { nodes?: NodeRegistry; edges?: EdgeRegistry; }

/**
 * Materialize a snapshot from a set of canonical Understandings (deterministic; `builtAt` passed in).
 * Registries default to the canonical seeds; new entities pass extended registries (additive).
 */
export function materializeSnapshot(understandings: PublishableUnderstanding[], builtAt: string, opts: GraphRuntimeOptions = {}): GraphSnapshot {
  const registries = { nodes: opts.nodes ?? createNodeRegistry(), edges: opts.edges ?? createEdgeRegistry() };
  const contributions = publishAll(understandings);
  const graph = materializeGraph(contributions, builtAt);
  const integrity = checkIntegrity(graph, registries);
  const metrics = graphMetrics(graph, integrity, registries);
  return { graph, contributions, integrity, metrics, builtAt };
}

/** Flag-gated entry (default OFF ⇒ null; shadow-only). */
export function computeGraphSnapshot(understandings: PublishableUnderstanding[], builtAt: string, opts: GraphRuntimeOptions = {}): GraphSnapshot | null {
  if (!isIntelligenceGraphEnabled()) return null;
  return materializeSnapshot(understandings, builtAt, opts);
}
