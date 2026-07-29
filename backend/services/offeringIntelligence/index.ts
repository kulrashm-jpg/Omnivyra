/**
 * Canonical Offering Understanding runtime (OFFERING-INTELLIGENCE-PROGRAM-003 / Phase B).
 * The 3rd canonical Understanding entity on the SHARED Product-Intelligence spine — one builder, one
 * evidence model (Facet), one reasoning contract, one scoring contract, one projection, one graph,
 * one persistence contract, a shadow runtime, and observability. Foundation only (no engines — Phase
 * C). Flag-dark, shadow-only, additive, deterministic. Adopts (not rebuilds) the certified-shadow
 * OFFERING-UNDERSTANDING-001 domain design onto the shared contracts. Offering is the sole owner of
 * offering semantics; all other domains reference it.
 */
export * from './types';
export * from './builder';
export * from './fromSeed';
export * from './projection';
export * from './graph';
export * from './persistence';
export * from './shadowRuntime';
export * from './metrics';
export { isOfferingUnderstandingEnabled, isOfferingProjectionAuthoritative } from './flags';
