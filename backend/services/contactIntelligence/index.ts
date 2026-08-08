/**
 * Contact Intelligence (CONTACT-INTELLIGENCE-PROGRAM-009 / Phase 1).
 *
 * The 8th canonical Understanding entity — OWNS ONLY the canonical understanding of a PLATFORM PERSON
 * (identity / profile / affiliation / channels / engagement / reachability / attribution / evidence
 * summary) on the SHARED spine. It REUSES Facet/EvidenceRef/ReasoningTrace/detectEvidenceContradictions/
 * scoring/graph (no new primitive or inference framework), derives chronology from evidence
 * (`observedAt`), and PUBLISHES references-only edges into the Program-4 graph — contact is its only
 * owned node; NO reasoning edges. Descriptive, never predictive. Abstains when evidence is insufficient.
 *
 * TENANT-SCOPED identity (`{ companyId, contactId }`) per the frozen WS-5E decision: `unified_persons`
 * is the Canonical Person, `contacts` is the Canonical Platform Person, `engagement_authors` is a
 * projection. Contact is SUBORDINATE to `unified_persons` and references it via
 * `identity.unifiedPersonId`.
 *
 * Flag-dark, shadow-only, additive — Programs 1–8 unchanged (one additive union widening for the
 * `contact` node + the `contact_of`/`works_at` edges, following the precedent every prior program set).
 * Phase 1 ships the canonical domain ONLY: no producer, no engines, no persistence writer, no runtime
 * wiring, no API, no queue, no worker, no schema change.
 */
export * from './types';
export { buildContactUnderstanding, CONTACT_MODEL_VERSION, type BuildContactInput } from './builder';
// Phase 2 — evidence assembly (pure; no I/O, no producer, no writer, no runtime consumer).
export {
  contactFromEvidence, resolveContactId,
  type ContactEvidenceInput, type AdoptedContact,
  type ContactIdentityInput, type ContactProfileInput, type ContactAffiliationInput,
  type ContactChannelObservation, type ContactInteractionObservation,
} from './fromEvidence';
export { assembleContactUnderstanding, type AssembledContact } from './assembly';
export { projectContact } from './projection';
// Phase 3 — internal shadow runtime (flag-dark; returns null when OFF; writes nothing).
export {
  computeContactUnderstandingShadow, compareToRaw,
  type ContactShadowBundle, type ContactShadowComparison, type ContactFieldDivergence,
} from './shadowRuntime';
// Phase 4 — production producer + store-agnostic persistence seam (dormant; bound to no store).
export {
  produceCanonicalContact, collectContactEvidence, writeInputsFromContactRow, CONTACT_PRODUCER,
  type ContactWriteInputs, type ContactRowLike, type CanonicalContactRecord, type CanonicalContactResult,
} from './production/canonicalContactProducer';
export {
  runContactShadowPersist, decideContactPersistence, applyCanonicalContactOnly, extractSemanticContactIdentity,
  type ContactShadowPersistDeps, type ContactShadowPersistResult, type ContactEvolutionReason,
  type ContactPersistenceDecision,
} from './production/contactShadowPersistence';
// Phase 5 — adoption readiness. Frozen contract, readiness assessment, and THE production facade
// Platform consumes. Nothing here activates anything; every function is a pure assessment.
export {
  CONTACT_CANONICAL_CONTRACT, CONTACT_CONTRACT_VERSION, CONTACT_PUBLISHED_EDGE_TYPES,
  CONTACT_GOVERNANCE_RULES, CONTACT_MIGRATION_PROHIBITIONS,
  validateContactContract, type ContactContractConformance,
} from './contract';
export {
  assessContactConsumerReadiness, assessContactCapabilityReadiness,
  validateContactActivation, checkContactRuntimeCompatibility,
  CONTACT_DOWNSTREAM_CONSUMERS, CONTACT_CAPABILITIES,
  type ContactConsumerReadiness, type ContactCapabilityReadiness, type ContactCapabilityRow,
  type ContactActivationValidation, type ContactActivationBlocker, type ContactActivationProbe,
  type ContactRuntimeCompatibility, type ContactDownstreamConsumer, type ContactCapability,
} from './readiness';
export {
  createContactProductionFacade, runContactProductionParity,
  type ContactProductionFacade, type ContactProducerPort, type ContactConsumerPort,
  type ContactRuntimeDeps, type ContactParityCase, type ContactParityRow, type ContactParityReport,
} from './production/facade';
export { contactEdge, buildContactGraph, neighbours } from './graph';
export { toShadowRecord, toLegacyFields, type LegacyContactFields } from './persistence';
export { isContactUnderstandingEnabled, isContactProjectionAuthoritative } from './flags';
