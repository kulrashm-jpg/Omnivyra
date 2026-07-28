/**
 * Cross-Entity Intelligence rollout flag — DEFAULT OFF (shadow-only). Cross-entity reasoning is
 * computed on demand; the flag gates any wired consumer path so Programs 1–3 + the Phase-B graph
 * operate byte-identically when OFF (O(1) rollback).
 */
export function isCrossEntityIntelligenceEnabled(): boolean {
  return process.env.CROSS_ENTITY_INTELLIGENCE_ENABLED === 'true';
}
