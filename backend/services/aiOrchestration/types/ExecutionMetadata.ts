/**
 * ExecutionMetadata.ts — the Execution Metadata CONTRACT (AI-ORCH 2B.1B).
 *
 * The complete, provider-agnostic metadata attached to a RESOLVED execution — the
 * single object a future phase stamps onto a call so it is explainable,
 * deterministic, auditable, reproducible, and versioned.
 *
 * CONTRACT ONLY. Every field is OPTIONAL. This file declares a type; it:
 *   - populates NOTHING,
 *   - persists NOTHING,
 *   - is imported by NOTHING in 2B.1B (dormant).
 * A later phase (the resolver / observability) will populate values of this type
 * and write them to usage_events; nothing here runs or changes behavior.
 *
 * The four explainability axes (see the 2B.1B architecture doc):
 *   Reason      → WHY   (ai_resolution_reason_codes)
 *   Decision    → WHAT  (ai_resolution_decision_codes)
 *   Trace       → HOW   (ResolutionTrace)
 *   Fingerprint → EXACTLY WHAT CONFIG (config_fingerprint + separated versions)
 */
import type { ResolutionTrace, ResolutionSource } from './ResolutionTrace';

export interface ExecutionMetadata {
  // ── Profile identity ──────────────────────────────────────────────────────
  /** ai_execution_profiles.id */
  executionProfileId?: string;
  /** ai_execution_profiles.key (e.g. 'BALANCED') */
  executionProfileKey?: string;
  /** ai_execution_profile_versions.version */
  profileVersion?: number;

  // ── Configuration fingerprint (separated versioning — 2B.1B) ──────────────
  /** ai_execution_profile_versions.config_fingerprint (e.g. 'sha256:v1:<hex>') */
  configFingerprint?: string;
  /** ai_execution_profile_versions.execution_schema_version */
  executionSchemaVersion?: number;
  /** ai_execution_profile_versions.canonicalization_version */
  canonicalizationVersion?: number;
  /** ai_execution_profile_versions.fingerprint_algorithm (e.g. 'sha256') */
  fingerprintAlgorithm?: string;
  /** Legacy combined tag (ai_execution_profile_versions.fingerprint_algo, e.g. 'sha256:v1'). */
  fingerprintAlgoLegacy?: string;

  // ── Explainability ────────────────────────────────────────────────────────
  /** WHERE it came from (usage_events.resolution_source). */
  resolutionSource?: ResolutionSource;
  /** WHAT was decided — an ai_resolution_decision_codes.code. */
  resolutionDecisionCode?: string;
  /** WHY — an ai_resolution_reason_codes.code. */
  resolutionReasonCode?: string;
  /** Reason category (ai_resolution_reason_codes.category). */
  resolutionReasonCategory?: string;
  /** Free-form detail for message-template placeholders / context. */
  resolutionDetail?: Record<string, unknown>;
  /** HOW — the ordered resolution trace (future). */
  resolutionTrace?: ResolutionTrace;

  // ── Timing (optional) ─────────────────────────────────────────────────────
  /** ISO timestamp of when the execution was resolved/run. */
  executionTimestamp?: string;
}
