/**
 * WAVE-1 — Outbound AI moderation (realizes AI-CONTRACT-000 §C6 post-generation).
 *
 * OMNI-AI-001 (HIGH): generated content and engagement replies were never scanned
 * before persist/publish; the existing moderation ran only on INBOUND signals.
 * This module reuses the existing deterministic moderation engine
 * (`moderation/moderationGateService.evaluateModeration`) — NO duplicate policy —
 * and adapts it to the outbound generation contract: it classifies output,
 * decides allow/block/human-review per a configurable policy, and returns an
 * auditable verdict. It never silently publishes unsafe output.
 */
import { evaluateModeration } from '../../moderation/moderationGateService';

export type ModerationEnforcement = 'off' | 'shadow' | 'enforce';

export interface OutboundModerationRequest {
  content: string;
  /** Surface label (e.g. 'writer.post', 'engagement.reply', 'creator.caption'). */
  surface: string;
  /** Platform bucket for the underlying engine (defaults to 'generic'). */
  platform?: string;
  /** Enforcement mode; default 'shadow' — classify + audit, never block, until an operator promotes it. */
  enforcement?: ModerationEnforcement;
  correlationId?: string;
}

export interface ModerationVerdict {
  allow: boolean;
  outcome: 'approve' | 'blocked' | 'review';
  categories: string[];
  requiresHumanReview: boolean;
  enforcement: ModerationEnforcement;
  auditId: string;
  correlationId?: string;
}

// Inbound-only reasons that must NOT block generated output (length is an
// inbound-signal concern; captions/CTAs are legitimately short/long).
const NON_OUTBOUND_REASONS = new Set(['content_too_short', 'content_too_long']);

let auditSeq = 0;
function nextAuditId(surface: string): string {
  auditSeq = (auditSeq + 1) % Number.MAX_SAFE_INTEGER;
  return `mod-${surface}-${auditSeq}`;
}

/**
 * Moderate generated output before persist/publish. Fail-closed in `enforce`:
 * an internal error blocks (safety errs on caution). In `shadow`/`off` it never
 * blocks, so it can be rolled out without regression, but always classifies +
 * audits.
 */
export async function moderateOutput(req: OutboundModerationRequest): Promise<ModerationVerdict> {
  const enforcement = req.enforcement ?? 'shadow';
  const auditId = nextAuditId(req.surface);
  try {
    const decision = await Promise.resolve(
      evaluateModeration({ content: req.content ?? '', platform: req.platform ?? 'generic' }),
    );
    const reasons = (decision.reasons ?? []).filter((r) => !NON_OUTBOUND_REASONS.has(r as string));
    const hardBlock = decision.outcome === 'blocked' && reasons.length > 0;
    const review = decision.outcome === 'requires_review' || decision.outcome === 'flagged';
    const requiresHumanReview = review || reasons.includes('pii' as never);

    // Decision by enforcement mode. In shadow/off we observe (allow) but still
    // classify + audit; in enforce, hard blocks and review-required items are held.
    let allow = true;
    let outcome: ModerationVerdict['outcome'] = 'approve';
    if (hardBlock) {
      outcome = 'blocked';
      allow = enforcement === 'enforce' ? false : true;
    } else if (requiresHumanReview) {
      outcome = 'review';
      allow = enforcement === 'enforce' ? false : true;
    }

    return {
      allow, outcome, categories: reasons as string[], requiresHumanReview,
      enforcement, auditId, correlationId: req.correlationId,
    };
  } catch (err) {
    // Fail-closed in enforce; fail-open (observed) otherwise.
    return {
      allow: enforcement !== 'enforce',
      outcome: enforcement === 'enforce' ? 'blocked' : 'approve',
      categories: ['moderation_error'],
      requiresHumanReview: false,
      enforcement, auditId, correlationId: req.correlationId,
    };
  }
}
