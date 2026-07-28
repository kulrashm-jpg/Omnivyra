/**
 * Canonical Intelligence Graph (PRODUCT-INTELLIGENCE-GRAPH-PROGRAM-004 / Phase B).
 * A pure INFRASTRUCTURE substrate that aggregates the references-only edges every canonical
 * Understanding (Lead/Company/Offering/…) already emits, into one deterministic, traversable graph —
 * reusing the shared `GraphNodeRef`/`GraphEdge` primitives (no new foundational primitive) with OPEN
 * node/edge registries (additive; no shared-union edits). Owns NO business semantics; each entity
 * remains the sole owner. Flag-dark, shadow-only, additive — Programs 1–3 unchanged.
 */
export * from './types';
export * from './registry';
export * from './publisher';
export * from './materializer';
export * from './traversal';
export * from './query';
export * from './integrity';
export * from './observability';
export * from './runtime';
export { isIntelligenceGraphEnabled } from './flags';
