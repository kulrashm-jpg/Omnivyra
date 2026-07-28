/**
 * Canonical Company Understanding runtime (COMPANY-INTELLIGENCE-PROGRAM-002 / Phase B).
 * The 2nd canonical Understanding entity on the SHARED Product-Intelligence spine — one builder, one
 * evidence model (Facet), one reasoning contract, one scoring contract, one projection, one graph,
 * one persistence contract, a shadow runtime, and observability. Foundation only (no engines — those
 * are Phase C). Flag-dark, shadow-only, additive, deterministic. Adopts (not rebuilds) the certified
 * COMPANY-PROFILE-ONTOLOGY-001 domain design onto the shared contracts.
 */
export * from './types';
export * from './builder';
export * from './fromProfile';
export * from './projection';
export * from './graph';
export * from './persistence';
export * from './shadowRuntime';
export * from './metrics';
export { isCompanyUnderstandingEnabled, isCompanyProjectionAuthoritative } from './flags';
