import { randomUUID } from 'crypto';
import { supabase } from '../db/supabaseClient';
import { ownedDbTable } from '../db/writeOwner';

/**
 * ai_suggestions tracking — records when the UI shows an AI suggestion to
 * a user, then resolves that record when the user accepts or rejects the
 * suggestion. `execution_correlation_id` links the suggestion to the
 * downstream community_ai_actions lifecycle so intelligence can join
 * "suggestion shown" → "execution outcome" through a single id.
 *
 * Every helper is best-effort: failures are logged and return null rather
 * than throwing, so the tracker never blocks the user-facing flow.
 */

export type AiSuggestionInput = {
  organization_id: string;
  platform: string;
  action_type: string;
  target_id?: string | null;
  content?: string | null;
  model?: string | null;
  metadata?: Record<string, unknown> | null;
  /** Pre-existing correlation id (optional). If omitted, one is generated so
   *  callers can thread it into a subsequent executeAction call. */
  execution_correlation_id?: string | null;
};

export type AiSuggestionRecord = {
  id: string;
  execution_correlation_id: string;
};

/**
 * Record that a suggestion was shown to a user. Returns the suggestion row
 * id + the correlation id to feed into executeAction(correlation_id:...).
 */
export async function recordSuggestionShown(input: AiSuggestionInput): Promise<AiSuggestionRecord | null> {
  const correlationId = input.execution_correlation_id || randomUUID();
  try {
    const { data, error } = await ownedDbTable('ai_suggestions')
      .insert({
        organization_id: input.organization_id,
        platform: input.platform,
        action_type: input.action_type,
        target_id: input.target_id ?? null,
        content: input.content ?? null,
        model: input.model ?? null,
        metadata: input.metadata ?? null,
        execution_correlation_id: correlationId,
      })
      .select('id, execution_correlation_id')
      .single();
    if (error) {
      console.warn('[aiSuggestionTracking] shown insert failed:', error.message);
      return null;
    }
    return { id: data.id, execution_correlation_id: data.execution_correlation_id };
  } catch (err: any) {
    console.warn('[aiSuggestionTracking] shown exception:', err?.message || err);
    return null;
  }
}

/**
 * Mark a suggestion accepted. Idempotent: the unique (accepted_at XOR
 * rejected_at) CHECK allows at most one outcome per row; the UPDATE only
 * sets accepted_at when no outcome is already recorded.
 *
 * Accepts a lookup by {suggestion_id} OR by {correlation_id} so callers
 * without direct access to the suggestion row can resolve via the
 * execution correlation id they already carry.
 */
export async function recordSuggestionAccepted(input: {
  suggestion_id?: string;
  correlation_id?: string;
  action_id?: string | null;
}): Promise<boolean> {
  const now = new Date().toISOString();
  try {
    let q = ownedDbTable('ai_suggestions')
      .update({
        accepted_at: now,
        action_id: input.action_id ?? null,
        updated_at: now,
      })
      .is('accepted_at', null)
      .is('rejected_at', null);
    if (input.suggestion_id) {
      q = q.eq('id', input.suggestion_id);
    } else if (input.correlation_id) {
      q = q.eq('execution_correlation_id', input.correlation_id);
    } else {
      return false;
    }
    const { error } = await q;
    if (error) {
      console.warn('[aiSuggestionTracking] accept update failed:', error.message);
      return false;
    }
    return true;
  } catch (err: any) {
    console.warn('[aiSuggestionTracking] accept exception:', err?.message || err);
    return false;
  }
}

export async function recordSuggestionRejected(input: {
  suggestion_id?: string;
  correlation_id?: string;
  reason?: string;
}): Promise<boolean> {
  const now = new Date().toISOString();
  try {
    let q = ownedDbTable('ai_suggestions')
      .update({
        rejected_at: now,
        rejected_reason: input.reason ?? null,
        updated_at: now,
      })
      .is('accepted_at', null)
      .is('rejected_at', null);
    if (input.suggestion_id) {
      q = q.eq('id', input.suggestion_id);
    } else if (input.correlation_id) {
      q = q.eq('execution_correlation_id', input.correlation_id);
    } else {
      return false;
    }
    const { error } = await q;
    if (error) {
      console.warn('[aiSuggestionTracking] reject update failed:', error.message);
      return false;
    }
    return true;
  } catch (err: any) {
    console.warn('[aiSuggestionTracking] reject exception:', err?.message || err);
    return false;
  }
}
