/**
 * Evidence Platform  (BETA-ARCH-001)
 *
 * The single canonical foundation every intelligence engine (current + future) uses to describe its
 * evidence: a canonical Evidence model, a maturity vocabulary, a provenance model, a confidence
 * CONTRACT (interface only — no calculation this phase), and a central engine registry.
 *
 * Nothing in this module performs scoring, confidence calculation, or I/O. Adopting it is purely
 * additive, optional metadata — engine calculations, scores, reports, and APIs are unchanged.
 */
export * from './evidenceMaturity';
export * from './confidenceContract';
export * from './provenance';
export * from './evidenceModel';
export * from './evidenceRegistry';
export * from './confidenceEngine';
export * from './decisionConfidence';
export * from './evidenceAwareConfidence';
export * from './websiteEvidenceAdapter';
// BETA-ENGINE-004: the External Evidence Provider Framework (architecture only).
export * from './providers';
export * from './validation';
export * from './correlation';
export * from './rootcause';
export * from './recommendation';
export * from './business';
export * from './explainability';
export * from './presentation';
export * from './ingestion';
export { registerAllEngines } from './engineRegistrations';
