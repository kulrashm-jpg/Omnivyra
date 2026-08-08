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
export { projectContact } from './projection';
export { contactEdge, buildContactGraph, neighbours } from './graph';
export { toShadowRecord, toLegacyFields, type LegacyContactFields } from './persistence';
export { isContactUnderstandingEnabled, isContactProjectionAuthoritative } from './flags';
