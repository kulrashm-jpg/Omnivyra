/**
 * Creator Rendering — Phase-8 moderation contracts (PURE TYPES).
 * ──────────────────────────────────────────────────────────────────────────
 * R0 foundation only. Fail-closed by contract: the SAFE default is
 * `blocked`. A moderation result is only `allowed` when a gate
 * explicitly produces that decision — absence/uncertainty NEVER means
 * allowed (mirrors the Step-13 fail-closed validator philosophy).
 */

/** Where in the pipeline the gate ran. */
export type RenderModerationStage = 'pre_render' | 'post_render';

/** Decision. `needs_review` routes to the approval workflow (Step-14
 *  Phase-5) — it is NOT an allow. */
export type RenderModerationDecision = 'allowed' | 'blocked' | 'needs_review';

export type RenderModerationSeverity =
  | 'none'
  | 'low'
  | 'medium'
  | 'high'
  | 'critical';

/** Canonical reason codes (extensible; stable identifiers for audit). */
export type RenderModerationReason =
  | 'unsafe_prompt'
  | 'unsafe_output'
  | 'brand_safety'
  | 'pii_detected'
  | 'lookalike_or_impersonation'
  | 'policy_violation'
  | 'text_like_asset_not_renderable'
  | 'classifier_unavailable'      // fail-closed → blocked
  | 'provider_flagged'
  | 'manual_reject';

export interface RenderModerationFinding {
  reason: RenderModerationReason;
  severity: RenderModerationSeverity;
  /** Free-form, audit-only; never reaches scheduler/workspace contracts. */
  detail?: string;
}

/** Immutable moderation result (one gate run). Serialization-safe. */
export interface RenderModerationResult {
  stage: RenderModerationStage;
  decision: RenderModerationDecision;
  findings: ReadonlyArray<RenderModerationFinding>;
  /** Hash of the exact unit moderated (RenderSpec hash pre-render, or
   *  output content hash post-render) — ties the decision to evidence. */
  moderated_subject_hash: string;
  /** Classifier/policy bundle identifier for reproducibility. */
  policy_version: string;
}

/** The fail-closed default. Any code path that cannot obtain an explicit
 *  gate decision MUST treat the subject as blocked. */
export const FAIL_CLOSED_MODERATION: Readonly<RenderModerationResult> =
  Object.freeze({
    stage: 'pre_render',
    decision: 'blocked',
    findings: Object.freeze([
      Object.freeze({
        reason: 'classifier_unavailable',
        severity: 'critical',
        detail: 'No explicit moderation decision — fail closed.',
      }),
    ]),
    moderated_subject_hash: '',
    policy_version: 'fail-closed',
  }) as RenderModerationResult;

/** Pure helper: only an explicit `allowed` permits progression. */
export function isModerationPassable(r: RenderModerationResult | null | undefined): boolean {
  return !!r && r.decision === 'allowed';
}
