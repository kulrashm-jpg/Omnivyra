/**
 * PI-LDB — the client-side view of the import contract.
 *
 * These interfaces MIRROR server types rather than importing them, because
 * everything here is bundled into the browser and the server definitions live
 * under `backend/services/**`. The mirrors are deliberately narrow: only the
 * fields the UI actually renders. A field the server adds that the UI does not
 * read needs no change here.
 *
 * The authorities, for anyone reconciling these:
 *   MappingProposal*  ← backend/services/leadMapping/mappingTypes.ts
 *   ImportOutcome     ← backend/services/leadIngestion/contracts.ts
 *
 * `LeadProjectionResult` is the one exception: it is IMPORTED, not mirrored,
 * because it lives in `lib/leadIntelligence` — pure, framework-free and already
 * bundled for the browser. Mirroring it would have put the definition of
 * "did this lead land" in two places, which is how the server and the screen
 * came to disagree about it in the first place.
 */

import type { LeadProjectionResult } from '@/lib/leadIntelligence/projectionResult';

/* ── mapping proposal (from /api/lead-ingestion/mapping-proposal) ──────────*/

export type MappingStatus =
  | 'approved_profile_match'
  | 'high_confidence_suggestion'
  | 'review_required'
  | 'unmapped'
  | 'validation_failed'
  | 'rejected_by_tenant';

export type AmbiguityReason =
  | 'polysemous_header'
  | 'entity_ambiguous'
  | 'competing_source_fields'
  | 'composite_field'
  | 'identity_critical'
  | 'schema_drift';

export interface AmbiguityOptionView {
  /** `null` is the first-class "ignore this column" answer. */
  target: string | null;
  label: string;
  rationale: string;
}

export interface AmbiguityQuestionView {
  reason: AmbiguityReason;
  question: string;
  options: AmbiguityOptionView[];
}

export interface MappingCandidateView {
  target: string;
  entity: 'contact' | 'company';
  score: number;
  evidence: string[];
  dataTypeCompatibility: 'compatible' | 'coercible' | 'incompatible' | 'unknown';
  transformation: string;
}

export interface FieldValidationSummaryView {
  samplesConsidered: number;
  samplesFailed: number;
  /** A rule name. Never a failing value. */
  failureKind: string;
}

export interface FieldMappingProposalView {
  sourceField: string;
  status: MappingStatus;
  candidate: MappingCandidateView | null;
  alternatives: MappingCandidateView[];
  ambiguity: AmbiguityQuestionView | null;
  reasoning: string;
  requiresTenantApproval: boolean;
  provenance: 'approved_profile' | 'new_suggestion' | 'deterministic' | 'refused';
  validation: FieldValidationSummaryView | null;
  model: { selfReportedConfidence: number | null; reasoning: string | null } | null;
}

export interface ProfileOutcomeView {
  profileId: string;
  version: number;
  state: 'applied' | 'drifted' | 'absent';
  addedHeaders: string[];
  removedHeaders: string[];
}

export interface DegradedFieldView {
  sourceField: string;
  /** A rule or parser name. Never a model transcript. */
  cause: string;
}

/** A destination as the review UI may offer it. Supplied BY THE SERVER. */
export interface AllowedTargetView {
  key: string;
  entity: 'contact' | 'company';
  label: string;
  description: string;
  dataType: string;
  /** False when the ingestion contract has no field for this destination. */
  submittable: boolean;
  /** Present when `submittable` is false. */
  blockedReason?: string;
}

export interface MappingProposalResponse {
  version: string;
  sourceSchemaFingerprint: string;
  proposals: FieldMappingProposalView[];
  requiresReview: boolean;
  profile: ProfileOutcomeView | null;
  /**
   * PI-LDB D: whether the tenant's saved mapping was LOADED, there was NONE
   * for this file layout, or the read was UNAVAILABLE. Optional for older
   * servers; a missing value is read as 'none'.
   */
  profileRead?: 'loaded' | 'none' | 'unavailable';
  degraded: DegradedFieldView[];
  /**
   * The closed destination list, served so the browser never has to hold its
   * own copy of the canonical vocabulary — and so it cannot offer a
   * destination the server would refuse.
   */
  allowedTargets: AllowedTargetView[];
  /**
   * Whether AI assistance actually contributed. False when the gateway was
   * unavailable and the mapping is deterministic only. The UI MUST NOT claim
   * AI-assisted mapping when this is false.
   */
  aiAssisted: boolean;
}

/* ── ingestion outcome (from /api/lead-ingestion/csv) ──────────────────────*/

export type IngestionRejection =
  | 'unsupported_source'
  | 'validation_failed'
  | 'normalization_failed'
  | 'provenance_failed'
  | 'identity_failed'
  | 'duplicate_detection_failed'
  | 'account_resolution_failed'
  | 'prospect_resolution_failed'
  | 'ingestion_disabled';

export interface ImportOutcome {
  externalId: string | null;
  ok: boolean;
  sourceRecordId?: string;
  personId?: string | null;
  accountId?: string | null;
  prospectId?: string | null;
  /**
   * Whether the prospect reached the store the Lead Database reads FIRST.
   * Fail-open by design, which is exactly why it must be surfaced: a prospect
   * can ingest successfully and still not appear on screen.
   */
  leadProjection?: LeadProjectionResult;
  provenanceOutcome?: 'created' | 'unchanged' | 'changed';
  canonicalApplied?: string[];
  canonicalWithheld?: Array<{ attribute: string; reason: string }>;
  duplicatesParked?: number;
  duplicatesAlreadyOpen?: number;
  rejection?: IngestionRejection;
  error?: string;
}

/** Plain-language labels for the contract's rejection reasons. */
export const REJECTION_LABELS: Readonly<Record<string, string>> = {
  unsupported_source: 'The import source was not recognised.',
  validation_failed: 'The row did not pass validation.',
  normalization_failed: 'The row could not be interpreted.',
  provenance_failed: 'The evidence for this row could not be recorded.',
  identity_failed: 'The person could not be identified.',
  duplicate_detection_failed: 'Duplicate checking could not be completed.',
  account_resolution_failed: 'The employer could not be resolved.',
  prospect_resolution_failed: 'The prospect record could not be resolved.',
  ingestion_disabled: 'Importing was switched off while this import was running.',
};
