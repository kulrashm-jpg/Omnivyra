/**
 * Response Orchestrator
 * End-to-end flow: intent -> policy -> generate -> format -> suggest.
 *
 * GENERATION NEVER EXECUTES (owner ruling, Outreach foundation, Agent C).
 * Engagement Intelligence generates and does not send. This module returns a
 * suggestion and has no path to any platform: it imports no executor, reads no
 * playbook and writes no action row. It used to take a caller-supplied
 * `execute` flag and, when a `response_rules.auto_reply` rule matched and an
 * active playbook existed, call `communityAiActionExecutor.executeAction`
 * directly — around the audited automation gate (automationService) entirely.
 * The executor's D-01 refusal of ad-hoc actions already stopped that call from
 * reaching a platform; the call itself is now gone.
 *
 * A matched `auto_reply` rule is reported as `auto_reply_rule_matched` and
 * changes nothing else. Autonomous response (Mode 3) is governed by ONE switch:
 * automation_config via `automation/automationService.shouldAutoExecute`, and even
 * an allowed decision must still pass the executor's own D-01 approval, L-3
 * recheck and single-execution claim. See automation/automationService.ts.
 */

import { resolveResponsePolicy } from './responsePolicyEngine';
import { generateResponse } from './responseGenerationService';
import { formatForPlatform } from './platformResponseFormatter';
import { checkResponseSafety } from './responseSafetyGuard';

export type OrchestrateInput = {
  message_id: string;
  thread_id?: string | null;
  organization_id: string;
  platform: string;
  intent?: string | null;
  sentiment?: string | null;
  author_name?: string | null;
  thread_context?: string | null;
  original_message: string;
};

export type OrchestrateResult = {
  ok: boolean;
  suggested_text?: string;
  /** Always false: generation never sends. Kept so existing response shapes stay stable. */
  executed?: false;
  requires_human_review?: boolean;
  /** True when a response_rules row with auto_reply matched. Informational only. */
  auto_reply_rule_matched?: boolean;
  reason?: string;
  error?: string;
};

export async function orchestrateResponse(
  input: OrchestrateInput
): Promise<OrchestrateResult> {
  const safety = checkResponseSafety({
    intent: input.intent,
    sentiment: input.sentiment,
  });

  if (safety.requires_human_review) {
    return {
      ok: true,
      suggested_text: undefined,
      executed: false,
      requires_human_review: true,
      reason: safety.reason,
    };
  }

  const policy = await resolveResponsePolicy({
    message_id: input.message_id,
    organization_id: input.organization_id,
    platform: input.platform,
    intent: input.intent,
    sentiment: input.sentiment,
    author_name: input.author_name,
    thread_context: input.thread_context,
  });

  if (!policy) {
    return {
      ok: false,
      error: 'No matching response rule found',
    };
  }

  const genResult = await generateResponse({
    message_id: input.message_id,
    thread_id: input.thread_id ?? undefined,
    organization_id: input.organization_id,
    platform: input.platform,
    intent: input.intent ?? undefined,
    original_message: input.original_message,
    author_name: input.author_name ?? undefined,
    thread_context: input.thread_context ?? undefined,
    template_structure: policy.template_structure,
    tone: policy.tone,
    emoji_policy: policy.emoji_policy,
  });

  if (genResult.error || !genResult.text) {
    return {
      ok: false,
      error: genResult.error ?? 'Generation failed',
    };
  }

  const formatted = formatForPlatform(genResult.text, input.platform, {
    emojiPolicy: policy.emoji_policy,
  });

  return {
    ok: true,
    suggested_text: formatted,
    executed: false,
    auto_reply_rule_matched: policy.auto_reply === true,
    ...(policy.auto_reply === true
      ? { reason: 'Suggestion only: response generation never sends' }
      : {}),
  };
}
