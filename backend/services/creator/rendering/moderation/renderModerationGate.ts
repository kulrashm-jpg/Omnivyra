/**
 * Render moderation gate — Step-R3 (deterministic, fail-closed).
 * ──────────────────────────────────────────────────────────────────────────
 * Pre-render (on RenderSpec text surface) + post-render (on output ref)
 * gates. PURE + deterministic — a conservative built-in ruleset, NOT a
 * silent allow. A clean subject yields an explicit `allowed`; a banned
 * pattern yields `blocked`; anything the gate cannot positively clear
 * (empty subject, missing hash) yields the FAIL-CLOSED default.
 *
 * A richer external classifier is a later phase; until then this gate is
 * the real enforcement and never weakens to "allow on uncertainty".
 */

import type {
  RenderSpec,
  RenderOutputRef,
  RenderModerationResult,
  RenderModerationFinding,
} from '../contracts';
import { FAIL_CLOSED_MODERATION } from '../contracts';

const POLICY_VERSION = 'r3-builtin-1';

// Conservative banned-intent patterns (illustrative, deterministic).
const BANNED = [
  /\bnsfw\b/i, /\bnude|nudity|porn|sexual\b/i,
  /\bgore|graphic violence|beheading\b/i,
  /\bweapon schematic|build a bomb|explosive device\b/i,
  /\bself[-\s]?harm|suicide method\b/i,
  /\bhate(ful)? (slur|speech)\b/i,
  /\bdeepfake|impersonat(e|ion) of (a )?(real|public) person\b/i,
];

function scan(text: string): RenderModerationFinding[] {
  const findings: RenderModerationFinding[] = [];
  for (const re of BANNED) {
    if (re.test(text)) {
      findings.push({ reason: 'unsafe_prompt', severity: 'high', detail: re.source });
    }
  }
  return findings;
}

export function preRenderModeration(
  spec: RenderSpec,
  subjectHash: string,
): RenderModerationResult {
  const text = (spec?.moderation_context?.moderated_text ?? []).join(' \n ').trim();
  if (!spec || !subjectHash) return { ...FAIL_CLOSED_MODERATION };
  if (spec.moderation_context?.is_text_like === true) {
    return {
      stage: 'pre_render', decision: 'blocked',
      findings: [{ reason: 'text_like_asset_not_renderable', severity: 'critical' }],
      moderated_subject_hash: subjectHash, policy_version: POLICY_VERSION,
    };
  }
  if (!text) {
    // Cannot positively clear an empty subject → fail closed.
    return { ...FAIL_CLOSED_MODERATION, moderated_subject_hash: subjectHash };
  }
  const findings = scan(text);
  return {
    stage: 'pre_render',
    decision: findings.length === 0 ? 'allowed' : 'blocked',
    findings,
    moderated_subject_hash: subjectHash,
    policy_version: POLICY_VERSION,
  };
}

export function postRenderModeration(
  output: RenderOutputRef | null | undefined,
  /** The pre-render decision is carried so the post gate can never be
   *  more permissive than the pre gate (monotonic safety). */
  preDecision: RenderModerationResult,
): RenderModerationResult {
  if (!output || !output.content_sha256) {
    return { ...FAIL_CLOSED_MODERATION, stage: 'post_render' };
  }
  if (preDecision.decision !== 'allowed') {
    return {
      stage: 'post_render', decision: 'blocked',
      findings: [{ reason: 'unsafe_output', severity: 'high', detail: 'pre-render was not allowed' }],
      moderated_subject_hash: output.content_sha256, policy_version: POLICY_VERSION,
    };
  }
  // No external image classifier in R3: we conservatively pass an output
  // whose pre-render text was explicitly cleared AND which is content-
  // addressed (hash present). This is documented; richer post-image
  // classification is a later phase.
  return {
    stage: 'post_render', decision: 'allowed', findings: [],
    moderated_subject_hash: output.content_sha256, policy_version: POLICY_VERSION,
  };
}
