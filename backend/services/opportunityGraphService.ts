/**
 * Phase 5 — Unified opportunity graph projection.
 *
 * Deterministic, bounded projection over Phase 3/4 data. One row per
 * (org, node_type, external_id) and (org, source_node_id, target_node_id,
 * edge_type) thanks to DB-level UNIQUE constraints. Calls are idempotent —
 * re-running the projection for the same signal produces no duplicates.
 *
 * Hard guarantees:
 *   • NEVER traverses; only writes edges from the inputs the caller supplies.
 *   • NEVER creates a node without a valid external_id (or a stable
 *     literal id like a competitor name).
 *   • NEVER follows generated edges to discover more — strictly a flat
 *     projection.
 *   • Tenant-scoped: every read AND every write starts with organization_id.
 *
 * Called from the signal pipeline AFTER opportunity_feed_items has been
 * persisted; never blocks the pipeline on failure (best-effort).
 */

import { ownedDbTable } from '../db/writeOwner';
import type { GraphEdgeType, GraphNode, GraphNodeType } from '../types/opportunityGraph';
import type { OpportunityFeedItem } from '../types/opportunityFeed';

// Bounded edge fan-out: per signal, we create at most this many edges of
// each type. Acts as a final defensive cap on top of the deterministic
// matchers below.
const MAX_KEYWORD_EDGES_PER_SIGNAL = 5;
const MAX_COMPETITOR_EDGES_PER_SIGNAL = 3;

type NodeUpsertInput = {
  node_type: GraphNodeType;
  external_id: string | null;
  display_name: string;
  metadata?: Record<string, unknown>;
};

async function upsertNode(
  organizationId: string,
  input: NodeUpsertInput,
): Promise<GraphNode | null> {
  // The unique constraint allows external_id NULL in principle, but Phase 5
  // refuses null external_ids so we always have an idempotent key.
  if (!input.external_id) return null;
  const payload = {
    organization_id: organizationId,
    node_type: input.node_type,
    external_id: input.external_id,
    display_name: input.display_name,
    metadata: input.metadata ?? {},
  };

  // SELECT-then-INSERT-on-miss for explicit idempotency. Postgres UNIQUE
  // catches races at 23505 and we re-read.
  const { data: existing } = await ownedDbTable('opportunity_graph_nodes')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('node_type', input.node_type)
    .eq('external_id', input.external_id)
    .maybeSingle();
  if (existing) return existing as GraphNode;

  const { data, error } = await ownedDbTable('opportunity_graph_nodes')
    .insert(payload)
    .select('*')
    .single();
  if (error) {
    if (error.code === '23505') {
      const { data: raced } = await ownedDbTable('opportunity_graph_nodes')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('node_type', input.node_type)
        .eq('external_id', input.external_id)
        .maybeSingle();
      return (raced as GraphNode | null) ?? null;
    }
    throw new Error(`graph_node_insert_failed:${error.message}`);
  }
  return data as GraphNode;
}

async function upsertEdge(
  organizationId: string,
  sourceNodeId: string,
  targetNodeId: string,
  edgeType: GraphEdgeType,
  confidence: number,
  metadata?: Record<string, unknown>,
): Promise<void> {
  if (sourceNodeId === targetNodeId) return; // CHECK constraint protects too
  const payload = {
    organization_id: organizationId,
    source_node_id: sourceNodeId,
    target_node_id: targetNodeId,
    edge_type: edgeType,
    confidence_score: Math.max(0, Math.min(1, confidence)),
    metadata: metadata ?? {},
  };
  const { error } = await ownedDbTable('opportunity_graph_edges').insert(payload);
  if (error && error.code !== '23505') {
    throw new Error(`graph_edge_insert_failed:${error.message}`);
  }
}

export type ProjectOpportunityInput = {
  organizationId: string;
  opportunity: OpportunityFeedItem;
  /** Competitor names known for this org — supplied by caller (no scraping). */
  knownCompetitors?: string[];
};

export type ProjectionResult = {
  nodes_upserted: number;
  edges_upserted: number;
  opportunity_node_id: string | null;
};

/**
 * Project a single opportunity into the graph. Idempotent on the
 * (org, opportunity-id) pair.
 */
export async function projectOpportunityIntoGraph(
  input: ProjectOpportunityInput,
): Promise<ProjectionResult> {
  const opp = input.opportunity;
  let nodesUpserted = 0;
  let edgesUpserted = 0;

  // ----- opportunity node -----
  const oppNode = await upsertNode(input.organizationId, {
    node_type: 'opportunity',
    external_id: opp.id,
    display_name: opp.detected_reason.slice(0, 120),
    metadata: {
      opportunity_type: opp.opportunity_type,
      opportunity_score: opp.opportunity_score,
      confidence_score: opp.confidence_score,
    },
  });
  if (!oppNode) {
    return { nodes_upserted: 0, edges_upserted: 0, opportunity_node_id: null };
  }
  nodesUpserted += 1;

  // ----- signal node + belongs_to -----
  const signalNode = await upsertNode(input.organizationId, {
    node_type: 'signal',
    external_id: opp.signal_id,
    display_name: `signal:${opp.signal_id.slice(0, 8)}`,
    metadata: { platform: opp.platform },
  });
  if (signalNode) {
    nodesUpserted += 1;
    await upsertEdge(input.organizationId, oppNode.id, signalNode.id, 'related_to', 1.0);
    edgesUpserted += 1;
  }

  // ----- cluster node + belongs_to_cluster -----
  if (opp.cluster_id) {
    const clusterNode = await upsertNode(input.organizationId, {
      node_type: 'cluster',
      external_id: opp.cluster_id,
      display_name: `cluster:${opp.cluster_id.slice(0, 8)}`,
      metadata: { opportunity_type: opp.opportunity_type },
    });
    if (clusterNode) {
      nodesUpserted += 1;
      await upsertEdge(input.organizationId, oppNode.id, clusterNode.id, 'belongs_to_cluster', 1.0);
      edgesUpserted += 1;
    }
  }

  // ----- source node + from_source -----
  if (opp.source_identifier) {
    const srcExternal = `${opp.platform}:${opp.source_identifier}`;
    const srcNode = await upsertNode(input.organizationId, {
      node_type: 'source',
      external_id: srcExternal,
      display_name: `${opp.platform} · ${opp.source_identifier}`,
      metadata: { platform: opp.platform, source_identifier: opp.source_identifier },
    });
    if (srcNode) {
      nodesUpserted += 1;
      await upsertEdge(input.organizationId, oppNode.id, srcNode.id, 'from_source', 1.0);
      edgesUpserted += 1;
    }
  }

  // ----- author node + authored_by -----
  const authorHandle =
    typeof (opp.author_metadata as { author_handle?: string | null })?.author_handle === 'string'
      ? (opp.author_metadata as { author_handle: string }).author_handle
      : null;
  if (authorHandle) {
    const authorExternal = `${opp.platform}:${authorHandle.toLowerCase()}`;
    const authorNode = await upsertNode(input.organizationId, {
      node_type: 'author',
      external_id: authorExternal,
      display_name: `${opp.platform}:${authorHandle}`,
      metadata: { platform: opp.platform, handle: authorHandle },
    });
    if (authorNode) {
      nodesUpserted += 1;
      await upsertEdge(input.organizationId, oppNode.id, authorNode.id, 'authored_by', 1.0);
      edgesUpserted += 1;
    }
  }

  // ----- execution node + produced_by_execution -----
  if (opp.listening_execution_id) {
    const execNode = await upsertNode(input.organizationId, {
      node_type: 'execution',
      external_id: opp.listening_execution_id,
      display_name: `execution:${opp.listening_execution_id.slice(0, 8)}`,
      metadata: { platform: opp.platform },
    });
    if (execNode) {
      nodesUpserted += 1;
      await upsertEdge(input.organizationId, oppNode.id, execNode.id, 'produced_by_execution', 1.0);
      edgesUpserted += 1;
    }
  }

  // ----- keyword nodes + matches_keyword (bounded) -----
  const keywords = Array.isArray(opp.matched_keywords) ? opp.matched_keywords : [];
  for (const kw of keywords.slice(0, MAX_KEYWORD_EDGES_PER_SIGNAL)) {
    const normalised = kw.trim().toLowerCase().slice(0, 64);
    if (!normalised) continue;
    const kwNode = await upsertNode(input.organizationId, {
      node_type: 'keyword',
      external_id: `kw:${normalised}`,
      display_name: normalised,
      metadata: {},
    });
    if (kwNode) {
      nodesUpserted += 1;
      await upsertEdge(input.organizationId, oppNode.id, kwNode.id, 'matches_keyword', 0.8);
      edgesUpserted += 1;
    }
  }

  // ----- competitor edges (only from user-supplied list, bounded) -----
  const competitors = (input.knownCompetitors ?? []).slice(0, MAX_COMPETITOR_EDGES_PER_SIGNAL);
  const lowerContent = (opp.detected_reason + ' ' + opp.matched_keywords.join(' ')).toLowerCase();
  // Phase 5 does NOT scan opp.source_context.content for competitors; the
  // signal pipeline already had access to that text. The trigger is matched
  // when the user-supplied competitor name appears in the detected reason
  // or the matched keywords (which already passed moderation).
  for (const competitor of competitors) {
    const normCompetitor = competitor.trim().toLowerCase();
    if (!normCompetitor) continue;
    if (!lowerContent.includes(normCompetitor)) continue;
    const compNode = await upsertNode(input.organizationId, {
      node_type: 'competitor',
      external_id: `competitor:${normCompetitor}`,
      display_name: competitor.trim(),
      metadata: {},
    });
    if (compNode) {
      nodesUpserted += 1;
      await upsertEdge(input.organizationId, oppNode.id, compNode.id, 'mentions_competitor', 0.7);
      edgesUpserted += 1;
    }
  }

  return {
    nodes_upserted: nodesUpserted,
    edges_upserted: edgesUpserted,
    opportunity_node_id: oppNode.id,
  };
}

/**
 * Reader. Returns nodes + edges scoped to an opportunity (one-hop view).
 * Bounded by the natural fan-out of `projectOpportunityIntoGraph` — never
 * walks deeper than 1 hop and never returns more than 50 nodes per query.
 */
export async function getOpportunityGraphForOpportunity(
  organizationId: string,
  opportunityId: string,
): Promise<{ nodes: GraphNode[]; edges: Array<{ source_node_id: string; target_node_id: string; edge_type: string; confidence_score: number }> }> {
  const { data: oppNode } = await ownedDbTable('opportunity_graph_nodes')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('node_type', 'opportunity')
    .eq('external_id', opportunityId)
    .maybeSingle();
  if (!oppNode) return { nodes: [], edges: [] };

  const root = oppNode as GraphNode;
  const { data: edgeRows } = await ownedDbTable('opportunity_graph_edges')
    .select('source_node_id, target_node_id, edge_type, confidence_score')
    .eq('organization_id', organizationId)
    .or(`source_node_id.eq.${root.id},target_node_id.eq.${root.id}`)
    .limit(50);
  const edges = (edgeRows ?? []) as Array<{
    source_node_id: string;
    target_node_id: string;
    edge_type: string;
    confidence_score: number;
  }>;

  const neighborIds = new Set<string>();
  for (const e of edges) {
    if (e.source_node_id !== root.id) neighborIds.add(e.source_node_id);
    if (e.target_node_id !== root.id) neighborIds.add(e.target_node_id);
  }

  let neighbors: GraphNode[] = [];
  if (neighborIds.size > 0) {
    const { data } = await ownedDbTable('opportunity_graph_nodes')
      .select('*')
      .eq('organization_id', organizationId)
      .in('id', Array.from(neighborIds));
    neighbors = (data as GraphNode[]) ?? [];
  }

  return { nodes: [root, ...neighbors], edges };
}

export async function listGraphNodeCountsByType(
  organizationId: string,
): Promise<Record<string, number>> {
  const { data } = await ownedDbTable('opportunity_graph_nodes')
    .select('node_type')
    .eq('organization_id', organizationId);
  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as Array<{ node_type: string }>) {
    counts[row.node_type] = (counts[row.node_type] ?? 0) + 1;
  }
  return counts;
}
