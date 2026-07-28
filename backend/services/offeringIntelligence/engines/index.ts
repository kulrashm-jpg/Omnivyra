/**
 * Phase C — Analyst-Grade Offering Intelligence engines. Every engine is a deterministic evidence
 * contributor into the Phase B canonical Offering contracts; the assembly pipeline is the sole owner.
 * Layer 1 intrinsic (what the offering IS) + Layer 2 market (how it is perceived/adopted).
 */
export * from './engineTypes';
export { runFeature, runPricing, runPackaging, runPositioning } from './intrinsic1';
export { runIntegration, runCompliance, runCategoryCapability } from './intrinsic2';
export { runMarketFit, runPersona, runAdoption, runLifecycle, runCompetitive } from './market';
export { runCrossEngine } from './crossEngine';
export { assembleOfferingUnderstanding, type OfferingAssemblyResult } from './assembly';
export { validateOfferingShadowBatch, type OfferingShadowReport, type OfferingShadowValidation } from './shadowValidation';
