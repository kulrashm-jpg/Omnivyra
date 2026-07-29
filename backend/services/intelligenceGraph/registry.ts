/**
 * G-B202/B203 — Canonical Node + Edge Registries (OPEN, additive). Replaces the fixed node/edge
 * unions with an extensible registration model: a future entity registers its node/edge types
 * additively (no shared-union edit, no entity redesign). Deterministic (sorted enumeration), pure
 * (per-instance state), backward-compatible (the existing entity types are pre-seeded). The registry
 * validates that published types are registered; it owns no semantics.
 */

import type { NodeRegistry, EdgeRegistry, NodeTypeDefinition, EdgeTypeDefinition } from './types';

// Pre-seeded from the shipped GraphNodeType/GraphEdgeType (Programs 1–3) — backward compatibility.
export const CANONICAL_NODE_TYPES: string[] = [
  'lead', 'company', 'offering', 'competitor', 'campaign', 'content', 'signal', 'opportunity', 'team',
  'organization', 'executive', 'customer', 'partner', 'product', 'technology', 'market', 'feature',
  'pricing_plan', 'persona', 'industry', 'integration',
];
export const CANONICAL_EDGE_TYPES: string[] = [
  'belongs_to', 'engaged_with', 'influences', 'reports_to', 'competes_with', 'targets',
  'converted_from', 'references', 'member_of', 'has_feature', 'priced_as', 'serves_persona',
];

export function createNodeRegistry(seed: string[] = CANONICAL_NODE_TYPES): NodeRegistry {
  const map = new Map<string, NodeTypeDefinition>();
  for (const t of seed) map.set(t, { type: t });
  return {
    register(def) { if (!def.type || !def.type.trim()) throw new Error('node type required'); if (!map.has(def.type)) map.set(def.type, def); }, // additive; re-register is a no-op (backward-compatible)
    has: (type) => map.has(type),
    get: (type) => map.get(type) ?? null,
    all: () => [...map.values()].sort((a, b) => a.type.localeCompare(b.type)),
  };
}

export function createEdgeRegistry(seed: string[] = CANONICAL_EDGE_TYPES): EdgeRegistry {
  const map = new Map<string, EdgeTypeDefinition>();
  for (const t of seed) map.set(t, { type: t, directed: true, cardinality: 'many' });
  return {
    register(def) { if (!def.type || !def.type.trim()) throw new Error('edge type required'); if (!map.has(def.type)) map.set(def.type, { directed: true, cardinality: 'many', ...def }); },
    has: (type) => map.has(type),
    get: (type) => map.get(type) ?? null,
    all: () => [...map.values()].sort((a, b) => a.type.localeCompare(b.type)),
  };
}
