/**
 * WS-1b (OMNIVYRA-PMO-001 · PMO-ADR-06) — SEMANTIC CONTINUITY GUARD.
 *
 * The deterministic enforcement + validation primitives that make the Semantic
 * Root a LIVING runtime concept: every generation stage must have RECEIVED the
 * Semantic Root (valid grouping id + communication intent) and PRESERVED the
 * parent's lineage before it produces output. This module is the ONE place that
 * decides whether continuity holds.
 *
 * DESIGN
 *  - Pure + deterministic. NO I/O, NO AI, NO clock, NO random. Same inputs ⇒ same
 *    verdict, so the enforcement is reproducible and testable.
 *  - Enforcement is FLAG-GATED by the CALLER (the runtime only invokes the assert
 *    primitives when `isSemanticRootEnabled()` is ON). With the flag OFF the
 *    runtime never calls in here, so behavior is byte-identical to pre-WS-1b.
 *  - THROWING primitives (`assertValidSemanticRoot`, `assertStageContinuity`) are
 *    for the PRE-generation boundary (fail-closed): a missing/invalid root or a
 *    broken parent link is surfaced as a typed `SemanticContinuityError`.
 *  - NON-throwing primitives (`checkArtifactInheritsRoot`,
 *    `assertVariantsPreserveIntent`) are for the POST-generation, fail-open stages
 *    (visual bridge, variants): a break is REPORTED to the caller (which records
 *    it in `failures`/metrics) but never destroys an already-produced generation.
 *  - CRITICAL: nothing here EVER mints or substitutes a fresh Semantic Root. A
 *    missing root is a failure to be surfaced, not a gap to be papered over —
 *    silent regeneration is the exact continuity break WS-1b exists to prevent.
 */

import type { CommunicationIntent } from '../../../platform/intelligence';
import { isSemanticRootId } from '../../../platform/intelligence';
import type { SemanticRoot } from './contracts';

/** The ordered generation stages continuity is enforced across. */
export type SemanticStage =
  | 'content_brief'
  | 'generated_text'
  | 'visual_brief'
  | 'image_prompt_spec'
  | 'platform_adaptation'
  | 'publishable_asset';

/**
 * The typed, deterministic failure a continuity violation surfaces. Carries the
 * stage + reason so a caller (or a test) can assert exactly WHERE and WHY
 * continuity broke. Distinct `name`/`code` so callers can narrow it out of a
 * generic error.
 */
export class SemanticContinuityError extends Error {
  readonly code = 'SEMANTIC_CONTINUITY_VIOLATION' as const;
  readonly stage: SemanticStage;
  readonly reason: string;
  constructor(stage: SemanticStage, reason: string) {
    super(`[semantic-continuity] ${stage}: ${reason}`);
    this.name = 'SemanticContinuityError';
    this.stage = stage;
    this.reason = reason;
  }
}

/** True iff `err` is a continuity violation (safe cross-realm narrowing). */
export function isSemanticContinuityError(err: unknown): err is SemanticContinuityError {
  return (
    err instanceof SemanticContinuityError ||
    (typeof err === 'object' &&
      err !== null &&
      (err as { code?: unknown }).code === 'SEMANTIC_CONTINUITY_VIOLATION')
  );
}

/**
 * A Semantic Root is WELL-FORMED iff it carries a canonical grouping id AND a
 * communication intent — the two invariants every downstream stage inherits.
 */
export function isValidSemanticRoot(
  root: SemanticRoot | undefined | null,
): root is SemanticRoot {
  return (
    !!root &&
    isSemanticRootId(root.semanticRootId) &&
    typeof root.communicationIntent === 'string' &&
    root.communicationIntent.length > 0
  );
}

/**
 * FAIL-CLOSED enforcement. Assert the root a stage received is well-formed;
 * throw a deterministic `SemanticContinuityError` otherwise. NEVER mints a fresh
 * root — a missing root is surfaced, not repaired.
 */
export function assertValidSemanticRoot(
  root: SemanticRoot | undefined | null,
  stage: SemanticStage,
): asserts root is SemanticRoot {
  if (!root) {
    throw new SemanticContinuityError(
      stage,
      'missing Semantic Root (enforcement will not mint a fresh one)',
    );
  }
  if (!isSemanticRootId(root.semanticRootId)) {
    throw new SemanticContinuityError(
      stage,
      `invalid semanticRootId '${String((root as SemanticRoot).semanticRootId)}'`,
    );
  }
  if (!root.communicationIntent) {
    throw new SemanticContinuityError(stage, 'missing communicationIntent');
  }
}

/** The lineage a stage claims to have descended from. */
export interface StageContinuityInput {
  readonly root: SemanticRoot | undefined | null;
  /** The parent artifact's semanticRootId (the lineage link). */
  readonly parentSemanticRootId?: string | null;
  /** The communication intent the parent carried. */
  readonly parentCommunicationIntent?: CommunicationIntent | null;
}

/**
 * FAIL-CLOSED stage enforcement. Before a stage produces output, assert it (a)
 * received a valid root and (b) the parent lineage/intent it descends from
 * MATCHES that root. Throws deterministically on any break; returns the (proven
 * valid) root on success. Never mints a fresh root.
 */
export function assertStageContinuity(
  stage: SemanticStage,
  input: StageContinuityInput,
): SemanticRoot {
  assertValidSemanticRoot(input.root, stage);
  const root = input.root;
  if (
    input.parentSemanticRootId != null &&
    input.parentSemanticRootId !== root.semanticRootId
  ) {
    throw new SemanticContinuityError(
      stage,
      `parent lineage '${input.parentSemanticRootId}' != root '${root.semanticRootId}'`,
    );
  }
  if (
    input.parentCommunicationIntent != null &&
    input.parentCommunicationIntent !== root.communicationIntent
  ) {
    throw new SemanticContinuityError(
      stage,
      `parent intent '${input.parentCommunicationIntent}' != root intent '${root.communicationIntent}'`,
    );
  }
  return root;
}

/** The outcome of a non-throwing continuity check. */
export interface ContinuityCheck {
  readonly ok: boolean;
  readonly reason?: string;
}

/**
 * FAIL-OPEN (observable) check. Assert a DERIVED artifact inherited the root's
 * grouping id. Returns a verdict rather than throwing so a post-generation caller
 * can record the break in `failures`/metrics without destroying the generation.
 */
export function checkArtifactInheritsRoot(
  root: SemanticRoot,
  artifact: { readonly semanticRootId?: string } | undefined | null,
  stage: SemanticStage,
): ContinuityCheck {
  if (!artifact) return { ok: false, reason: `${stage}: artifact missing` };
  if (artifact.semanticRootId !== root.semanticRootId) {
    return {
      ok: false,
      reason: `${stage}: '${String(artifact.semanticRootId)}' != '${root.semanticRootId}'`,
    };
  }
  return { ok: true };
}

/** The identity stamp every platform adaptation must carry (presentation-neutral). */
export interface SemanticVariantStamp {
  semantic_root_id: string;
  communication_intent: CommunicationIntent;
}

/**
 * Stamp a platform variant with the root's identity WITHOUT touching its
 * presentation. The external variant builder is intent-agnostic, so the runtime
 * carries the Semantic Root onto each adaptation here: only the identity fields
 * are added; every existing field (the platform-specific copy) is preserved.
 */
export function stampVariantSemanticIdentity<T extends object>(
  variant: T,
  root: SemanticRoot,
): T & SemanticVariantStamp {
  return {
    ...variant,
    semantic_root_id: root.semanticRootId,
    communication_intent: root.communicationIntent,
  };
}

/** The verdict of the deterministic variant-preservation check. */
export interface VariantPreservationResult {
  readonly ok: boolean;
  /** Indices of variants that dropped or diverged from the root identity. */
  readonly violations: number[];
}

/**
 * DETERMINISTIC preservation check across platform adaptations: EVERY variant
 * must carry the SAME semanticRootId + communicationIntent as the root (only
 * presentation may differ). Returns the offending indices; the caller decides
 * whether to record (post-generation, fail-open) or reject.
 */
export function assertVariantsPreserveIntent(
  root: SemanticRoot,
  variants: ReadonlyArray<unknown>,
): VariantPreservationResult {
  const violations: number[] = [];
  variants.forEach((raw, i) => {
    const v = raw as Partial<SemanticVariantStamp> | null | undefined;
    if (
      !v ||
      v.semantic_root_id !== root.semanticRootId ||
      v.communication_intent !== root.communicationIntent
    ) {
      violations.push(i);
    }
  });
  return { ok: violations.length === 0, violations };
}
