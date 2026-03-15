/**
 * Response Orchestrator
 * End-to-end flow: intent -> policy -> generate -> format -> execute/suggest.
 */

import { supabase } from '../db/supabaseClient';
import { resolveResponsePolicy } from './responsePolicyEngine';
import { generateResponse } from './responseGenerationService';
import { formatForPlatform } from './platformResponseFormatter';
import { checkResponseSafety } from './responseSafetyGuard';
import { executeAction } from './communityAiActionExecutor';
import { listPlaybooks } from './playbooks/playbookService';

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
  /** When true, execute via communityAiActionExecutor when auto_reply and safe */
  execute?: boolean;
};

export type OrchestrateResult = {
  ok: boolean;
  suggested_text?: string;
  executed?: boolean;
  requires_human_review?: boolean;
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

  if (!input.execute || !policy.auto_reply) {
    return {
      ok: true,
      suggested_text: formatted,
      executed: false,
    };
  }

  const { data: message } = await supabase
    .from('engagement_messages')
    .select('id, thread_id, platform_message_id')
    .eq('id', input.message_id)
    .maybeSingle();

  if (!message) {
    return { ok: true, suggested_text: formatted, executed: false };
  }

  const playbooks = (await listPlaybooks(input.organization_id, input.organization_id)).filter(
    (p: { status?: string }) => p.status === 'active'
  );
  const playbookId = playbooks[0]?.id ?? null;

  if (!playbookId) {
    return {
      ok: true,
      suggested_text: formatted,
      executed: false,
      reason: 'No active playbook; suggestion only',
    };
  }

  const { v4: uuidv4 } = await import('uuid');
  const result = await executeAction(
    {
      id: uuidv4(),
      tenant_id: input.organization_id,
      organization_id: input.organization_id,
      platform: input.platform,
      action_type: 'reply',
      target_id: message.platform_message_id ?? input.message_id,
      suggested_text: formatted,
      playbook_id: playbookId,
      execution_mode: 'manual',
    },
    true,
    { source: 'manual' }
  );

  return {
    ok: result.ok,
    suggested_text: formatted,
    executed: result.ok && result.status === 'executed',
    error: result.ok ? undefined : (result.error as string),
  };
}
