/**
 * Intelligence Graph rollout flag — DEFAULT OFF (shadow-only). The graph is materialized on demand;
 * the flag gates any wired consumer path so Programs 1–3 operate byte-identically when OFF (O(1)
 * rollback).
 */
export function isIntelligenceGraphEnabled(): boolean {
  return process.env.INTELLIGENCE_GRAPH_ENABLED === 'true';
}
