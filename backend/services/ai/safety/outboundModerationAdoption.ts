/**
 * WAVE-1B-001 — Outbound-moderation adoption wrapper (composes the existing
 * §C6 post-gen primitive `moderateOutput` — NOT a new engine/policy). One copy of
 * the "resolve mode → moderate → observe" glue so every persistence boundary
 * invokes moderation identically (policy consistency; no duplicate policy engine).
 *
 * Reuses: moderateOutput (which reuses moderationGateService.evaluateModeration),
 * the rollout kit (off/shadow/enforce, default shadow), and the HARDEN-001
 * observability registry. Fail-safe.
 */
import { moderateOutput, type ModerationVerdict, type ModerationEnforcement } from './outboundModeration';
import { newReasoningId } from './promptSafetyAdoption';
import { defineRolloutFlag, resolveRolloutSync } from '../../../../lib/platform/rollout';
import { recordRawCounter, recordRawHistogram } from '../../../observability';

// One flag for the whole platform. Default OFF at the kit level → we map to SHADOW
// (classify + audit, never block) so adoption is backward-compatible by default.
// Operators promote to enforce via ROLLOUT_OUTBOUND_MODERATION_MODE=enforce.
const OUTBOUND_MODERATION_FLAG = defineRolloutFlag({
  key: 'outbound-moderation',
  description: 'WAVE-1B: canonical post-generation moderation before persistence (default shadow)',
  defaultMode: 'shadow',
});

/** Resolve enforcement: rollout off→off, shadow→shadow, enforce→enforce. Default shadow. */
export function resolveModerationMode(tenantId?: string): ModerationEnforcement {
  try {
    const mode = resolveRolloutSync(OUTBOUND_MODERATION_FLAG, tenantId ? { tenantId } : {}).mode;
    return mode === 'off' ? 'off' : mode === 'enforce' ? 'enforce' : 'shadow';
  } catch {
    return 'shadow';
  }
}

export interface ModerateBeforePersistCtx {
  surface: string;              // e.g. 'writer.post', 'engagement.reply'
  platform?: string;
  correlationId?: string;
  reasoningId?: string;
  tenantId?: string;
}

/**
 * Moderate a generated output before persistence/publishing. Returns the verdict;
 * the caller blocks persistence ONLY when `verdict.allow === false` (enforce +
 * unsafe). Shadow/off never block. Emits the full §X1 decision trace. Never throws.
 */
export async function moderateBeforePersist(content: string, ctx: ModerateBeforePersistCtx): Promise<ModerationVerdict> {
  const started = Date.now();
  const enforcement = resolveModerationMode(ctx.tenantId);
  const reasoningId = ctx.reasoningId ?? newReasoningId();
  let verdict: ModerationVerdict;
  try {
    verdict = await moderateOutput({
      content: content ?? '',
      surface: ctx.surface,
      platform: ctx.platform,
      enforcement,
      correlationId: ctx.correlationId,
    });
  } catch {
    // Fail-safe: only enforce blocks on error; shadow/off allow.
    verdict = {
      allow: enforcement !== 'enforce',
      outcome: enforcement === 'enforce' ? 'blocked' : 'approve',
      categories: ['moderation_error'],
      requiresHumanReview: false,
      enforcement, auditId: `mod-${ctx.surface}-err`, correlationId: ctx.correlationId,
    };
  }
  try {
    recordRawCounter('ai.outbound_moderation.decision', 1, {
      surface: ctx.surface,
      outcome: verdict.outcome,
      mode: verdict.enforcement,
      correlation: ctx.correlationId ?? 'na',
    });
    recordRawHistogram('ai.outbound_moderation.latency_ms', Math.max(0, Date.now() - started), { surface: ctx.surface });
    if (!verdict.allow) recordRawCounter('ai.outbound_moderation.blocked', 1, { surface: ctx.surface });
  } catch { /* observability is fail-safe */ }
  // reasoningId is carried for correlation with the produced artifact.
  (verdict as ModerationVerdict & { reasoningId?: string }).reasoningId = reasoningId;
  return verdict;
}
