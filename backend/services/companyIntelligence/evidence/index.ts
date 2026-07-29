/**
 * COMPANY-UNDERSTANDING-IMPLEMENTATION-001 · U1 — Evidence Unification barrel.
 * Evidence adapters + evidence-derived canonical build + explainability + semantic delta. Shadow-only,
 * additive, deterministic; consumed by no production request path (only its tests / offline analysis).
 */
export * from './adapters';
export * from './buildFromEvidence';
export * from './delta';
