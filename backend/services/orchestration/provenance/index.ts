/**
 * Execution Provenance (Phase-2 Step-16). Import surface.
 */
export {
  getExecutionProvenance,
  getCampaignProvenanceSummary,
  executionProvenanceService,
} from './executionProvenance';
export {
  buildAuthoritativeProvenance,
  deriveProvenanceFromContent,
  normalizeMode,
} from './provenanceMapper';
export { provenanceDiagnostics } from './provenanceDiagnostics';
export {
  ORCHESTRATION_VERSION,
  PROVENANCE_KEY,
} from './provenanceTypes';
export type {
  ExecutionProvenance,
  CampaignProvenanceSummary,
  ProvenanceGenerationSource,
  ProvenanceGenerationStage,
} from './provenanceTypes';
