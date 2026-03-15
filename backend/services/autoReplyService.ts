/**
 * Auto Reply Service
 * Eligibility checks and auto-reply execution.
 * All rules must be satisfied before auto reply triggers.
 */

import { supabase } from '../db/supabaseClient';
import { resolveResponsePolicy } from './responsePolicyEngine';
import { orchestrateResponse } from './responseOrchestrator';
import { getControls } from './engagementGovernanceService';

const CONFIDENCE_THRESHOLD = 0.85;

export type EligibilityResult = {
  eligible: boolean;
  reason?: string;
};

/**
 * Check if a message is eligible for auto reply.
 * Rules (all required): pattern exists, intent confidence > threshold, user enabled auto reply.
 */
export async function isEligible(threadId: string, messageId: string): Promise<EligibilityResult> {
  const { data: message, error: msgErr } = await supabase
    .from('engagement_messages')
    .select('id, thread_id, content, platform')
    .eq('id', messageId)
    .eq('thread_id', threadId)
    .maybeSingle();

  if (msgErr || !message) {
    return { eligible: false, reason: 'Message not found or thread mismatch' };
  }

  const { data: thread, error: threadErr } = await supabase
    .from('engagement_threads')
    .select('organization_id')
    .eq('id', threadId)
    .maybeSingle();

  if (threadErr || !thread) {
    return { eligible: false, reason: 'Thread not found' };
  }

  const organizationId = (thread as { organization_id: string }).organization_id;
  if (!organizationId) {
    return { eligible: false, reason: 'Thread has no organization' };
  }

  const controls = await getControls(organizationId);
  if (!controls.auto_reply_enabled) {
    return { eligible: false, reason: 'Auto reply is disabled for this organization' };
  }

  const { data: intel } = await supabase
    .from('engagement_message_intelligence')
    .select('intent, sentiment, confidence_score')
    .eq('message_id', messageId)
    .maybeSingle();

  const confidence = Number((intel as { confidence_score?: number })?.confidence_score ?? 0);
  if (confidence < CONFIDENCE_THRESHOLD) {
    return { eligible: false, reason: `Intent confidence ${confidence} below threshold ${CONFIDENCE_THRESHOLD}` };
  }

  const intent = (intel as { intent?: string })?.intent ?? null;
  const sentiment = (intel as { sentiment?: string })?.sentiment ?? null;
  const platform = (message.platform ?? 'linkedin').toString();

  const policy = await resolveResponsePolicy({
    message_id: messageId,
    organization_id: organizationId,
    platform,
    intent,
    sentiment,
    author_name: null,
    thread_context: null,
  });

  if (!policy) {
    return { eligible: false, reason: 'No matching response pattern/rule found' };
  }

  if (!policy.auto_reply) {
    return { eligible: false, reason: 'Auto reply not enabled for this rule' };
  }

  return { eligible: true };
}

export type AttemptResult = {
  ok: boolean;
  executed?: boolean;
  error?: string;
};

/**
 * Attempt auto reply for a message.
 * Re-checks eligibility before executing.
 */
export async function attemptAutoReply(threadId: string, messageId: string): Promise<AttemptResult> {
  const eligibility = await isEligible(threadId, messageId);
  if (!eligibility.eligible) {
    return { ok: false, error: eligibility.reason ?? 'Not eligible for auto reply' };
  }

  const { data: message, error: msgErr } = await supabase
    .from('engagement_messages')
    .select('id, thread_id, content, platform')
    .eq('id', messageId)
    .maybeSingle();

  if (msgErr || !message) {
    return { ok: false, error: 'Message not found' };
  }

  const { data: thread } = await supabase
    .from('engagement_threads')
    .select('organization_id')
    .eq('id', threadId)
    .maybeSingle();

  if (!thread) {
    return { ok: false, error: 'Thread not found' };
  }

  const { data: intel } = await supabase
    .from('engagement_message_intelligence')
    .select('intent, sentiment')
    .eq('message_id', messageId)
    .maybeSingle();

  const organizationId = (thread as { organization_id: string }).organization_id;
  const intent = (intel as { intent?: string })?.intent ?? null;
  const sentiment = (intel as { sentiment?: string })?.sentiment ?? null;
  const platform = (message.platform ?? 'linkedin').toString();

  const result = await orchestrateResponse({
    message_id: messageId,
    thread_id: message.thread_id,
    organization_id: organizationId,
    platform,
    intent,
    sentiment,
    original_message: (message.content ?? '').toString(),
    author_name: null,
    thread_context: null,
    execute: true,
  });

  if (!result.ok) {
    return { ok: false, error: result.error ?? 'Orchestration failed' };
  }

  return {
    ok: true,
    executed: result.executed ?? false,
  };
}
