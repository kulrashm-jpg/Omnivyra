/**
 * Phase C — Advanced Company Intelligence engines. Every engine is a deterministic evidence
 * contributor into the Phase B canonical Company contracts; the assembly pipeline is the sole owner.
 */
export * from './engineTypes';
export { runTechnology } from './technology';
export { runProduct } from './product';
export { runGrowth } from './growth';
export { runExecutive } from './executive';
export { runCustomerPartner } from './customerPartner';
export { runFinancial } from './financial';
export { runCompetitive } from './competitive';
export { runRisk } from './risk';
export { runCrossEngine } from './crossEngine';
export { assembleCompanyUnderstanding, type CompanyAssemblyResult } from './assembly';
export { validateCompanyShadowBatch, type CompanyShadowReport, type CompanyShadowValidation } from './shadowValidation';
