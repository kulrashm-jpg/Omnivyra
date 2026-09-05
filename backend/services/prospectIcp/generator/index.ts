/**
 * A1 — AI ICP Generator. Public surface.
 *
 * Company Profile → evidence → model reasoning → frozen criteria + frozen
 * proposal → `createIcpVersion`. Produces a PROPOSAL only; it cannot ratify.
 *
 * The frozen contracts it builds against are owned elsewhere and are not
 * re-exported here: import `IcpCriterion`, `IcpProposal` and friends from
 * `backend/services/prospectIcp` as every other consumer does.
 */

export {
  generateIcpProposal,
  defaultGenerateIcpPorts,
  ICP_GENERATOR_OPERATION,
  ICP_GENERATOR_VERSION,
} from './generate';
export type {
  GenerateIcpInput, GenerateIcpPorts, GenerateIcpResult, GenerationFailureReason,
} from './generate';

export { extractProfileEvidence, hasSufficientEvidence, PROFILE_EVIDENCE_FIELDS, BUYER_SIGNAL_FIELDS } from './evidence';
export type { ProfileEvidence, ProfileEvidenceField } from './evidence';

export {
  buildSystemPrompt, buildUserPrompt,
  ICP_PROMPT_TEMPLATE_NAME, ICP_PROMPT_TEMPLATE_VERSION,
  PROPOSABLE_PERSON_ATTRIBUTES, UNREPRESENTABLE_CONCEPTS,
} from './prompt';
export type { UnrepresentableConcept } from './prompt';

export { translateModelOutput, TITLE_UNION_CRITERION_ID, DEPARTMENT_CRITERION_ID } from './translate';
export type { TranslationContext, TranslationResult, TranslationDiagnostics } from './translate';
