/**
 * Phase 5 — Realtime readiness contracts.
 *
 * Typed event payloads for incremental feed / graph / cluster updates.
 * No transport (no websockets, no SSE, no Supabase Realtime binding).
 * This file ONLY publishes the contract that a future transport layer
 * will subscribe to.
 *
 * Callers use `publishFeedProjection(event)` — a thin wrapper around the
 * existing in-process pub/sub from Phase 0.
 */

import type { OpportunityType } from '../types/opportunityFeed';
import type { GraphEdgeType, GraphNodeType } from '../types/opportunityGraph';

export type FeedProjectionEventType =
  | 'feed_projection.opportunity_added'
  | 'feed_projection.opportunity_updated'
  | 'feed_projection.cluster_added'
  | 'feed_projection.cluster_updated'
  | 'feed_projection.graph_node_added'
  | 'feed_projection.graph_edge_added'
  | 'feed_projection.alert_raised';

export type OpportunityAddedProjection = {
  type: 'feed_projection.opportunity_added';
  organization_id: string;
  opportunity_feed_item_id: string;
  opportunity_type: OpportunityType;
  cluster_id: string | null;
  occurred_at: string;
};

export type ClusterAddedProjection = {
  type: 'feed_projection.cluster_added';
  organization_id: string;
  cluster_id: string;
  opportunity_type: OpportunityType;
  occurred_at: string;
};

export type GraphNodeAddedProjection = {
  type: 'feed_projection.graph_node_added';
  organization_id: string;
  graph_node_id: string;
  node_type: GraphNodeType;
  occurred_at: string;
};

export type GraphEdgeAddedProjection = {
  type: 'feed_projection.graph_edge_added';
  organization_id: string;
  graph_edge_id: string;
  edge_type: GraphEdgeType;
  occurred_at: string;
};

export type AlertRaisedProjection = {
  type: 'feed_projection.alert_raised';
  organization_id: string;
  alert_id: string;
  alert_type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  occurred_at: string;
};

export type FeedProjectionEvent =
  | OpportunityAddedProjection
  | ClusterAddedProjection
  | GraphNodeAddedProjection
  | GraphEdgeAddedProjection
  | AlertRaisedProjection;

type Subscriber = (event: FeedProjectionEvent) => void | Promise<void>;
const subscribers = new Map<FeedProjectionEventType, Set<Subscriber>>();

export function subscribeToFeedProjection<T extends FeedProjectionEventType>(
  type: T,
  handler: Subscriber,
): () => void {
  const existing = subscribers.get(type) ?? new Set<Subscriber>();
  existing.add(handler);
  subscribers.set(type, existing);
  return () => existing.delete(handler);
}

export async function publishFeedProjection(event: FeedProjectionEvent): Promise<void> {
  const handlers = subscribers.get(event.type);
  if (!handlers || handlers.size === 0) return;
  for (const handler of handlers) {
    try {
      await handler(event);
    } catch (err: any) {
      console.warn('[feedProjectionContracts] subscriber threw', { type: event.type, error: err?.message });
    }
  }
}
