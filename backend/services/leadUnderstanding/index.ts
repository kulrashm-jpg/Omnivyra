/**
 * Canonical Lead Understanding platform (LEAD-INTELLIGENCE-PROGRAM-001 / Phase B).
 * One ontology of facets, one evidence model, one scoring contract, one reasoning contract, one
 * projection, one graph, first-class contradictions, one persistence contract, a shadow runtime,
 * and observability. Foundation only — flag-dark, shadow-only, additive, deterministic. No engine
 * algorithms (Phase C). Barrel re-export.
 */

export * from './types';
export * from './facets';
export * from './evidence';
export * from './scoring';
export * from './reasoning';
export * from './contradiction';
export * from './projection';
export * from './graph';
export * from './persistence';
export * from './shadowRuntime';
export * from './metrics';
export { isLeadUnderstandingEnabled, isLeadProjectionAuthoritative } from './flags';
