/**
 * Evidence Governance  (BETA-ENGINE-008, Phase 5)
 *
 * Composes the validation engine + quality model + conflict resolver into ONE deterministic governance
 * pass, and produces the persistable governance metadata every Evidence record carries. The single
 * entrypoint the ingestion orchestrator calls before persistence.
 */
import type { Evidence } from '../evidenceModel';
import {
  validateEvidenceSet, VALIDATOR_VERSION, type EvidenceValidationReport, type ValidationContext, type ValidationReason,
} from './evidenceValidation';
import { assessEvidenceQuality, type EvidenceQualityAssessment } from './evidenceQuality';
import { detectConflicts, type ProviderEvidenceSet, type EvidenceConflict } from './evidenceConflict';

/** Persistable governance metadata (Phase 5). */
export interface EvidenceGovernance {
  validation: {
    status: 'validated' | 'flagged' | 'rejected';
    validatedCount: number;
    flaggedCount: number;
    rejectedCount: number;
    duplicateKeys: string[];
    reasons: ValidationReason[];
  };
  quality: EvidenceQualityAssessment;
  conflicts: EvidenceConflict[];
  conflictCount: number;
  validatedAt: string;
  validatorVersion: string;
}

export interface GovernanceResult {
  /** The subset of Evidence that may enter a decision sample (rejected rows removed). */
  valid: Evidence[];
  /** The full validation report (all rows, incl. rejected — for traceability). */
  validation: EvidenceValidationReport;
  governance: EvidenceGovernance;
}

export interface GovernanceContext extends ValidationContext {
  providerReliability?: number | null;
  /** Other providers' Evidence for the same subject, for cross-provider conflict detection. */
  peers?: ProviderEvidenceSet[];
  providerId?: string;
}

/**
 * Govern one provider's Evidence set: validate → detect conflicts (vs peers) → assess quality → build
 * governance metadata. Returns the validated subset (rejected rows removed) + the governance block.
 * Deterministic (timestamps injected). Never throws on bad Evidence — it records it.
 */
export function governEvidence(evidence: Evidence[], ctx: GovernanceContext): GovernanceResult {
  const validation = validateEvidenceSet(evidence, ctx);

  const selfSet: ProviderEvidenceSet = {
    providerId: ctx.providerId ?? 'self',
    providerReliability: ctx.providerReliability ?? null,
    evidence,
  };
  const conflictReport = detectConflicts([selfSet, ...(ctx.peers ?? [])]);

  const quality = assessEvidenceQuality({
    evidence,
    validation,
    providerReliability: ctx.providerReliability ?? null,
    conflictCount: conflictReport.conflictCount,
  });

  const setStatus: 'validated' | 'flagged' | 'rejected' =
    validation.rejectedCount > 0 && validation.validatedCount + validation.flaggedCount === 0
      ? 'rejected'
      : validation.flaggedCount > 0 || validation.rejectedCount > 0 || conflictReport.conflictCount > 0
        ? 'flagged'
        : 'validated';

  const governance: EvidenceGovernance = {
    validation: {
      status: setStatus,
      validatedCount: validation.validatedCount,
      flaggedCount: validation.flaggedCount,
      rejectedCount: validation.rejectedCount,
      duplicateKeys: validation.duplicateKeys,
      reasons: validation.reasons,
    },
    quality,
    conflicts: conflictReport.conflicts,
    conflictCount: conflictReport.conflictCount,
    validatedAt: ctx.nowIso,
    validatorVersion: VALIDATOR_VERSION,
  };

  return { valid: validation.valid, validation, governance };
}
