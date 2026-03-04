/**
 * Execution Guardrail Service
 *
 * Company-scoped guardrails applied before executeAction in:
 * - evaluateAutoRules (source: 'evaluation')
 * - communityAiScheduler (source: 'scheduler')
 *
 * Does not apply to manual /api/community-ai/actions/execute.
 */

import { supabase } from '../db/supabaseClient';

export type GuardrailResult = {
  allowed: boolean;
  reason?: 'auto_disabled' | 'daily_platform_limit' | 'per_post_limit' | 'per_evaluation_limit';
};

export type CommunityAiAction = {
  id: string;
  company_id: string;
  tenant_id?: string;
  organization_id?: string;
  platform: string;
  action_type: string;
  target_id: string;
};

function startOfToday(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function tenMinutesAgo(): string {
  return new Date(Date.now() - 10 * 60 * 1000).toISOString();
}

/**
 * Check if an action is allowed by company guardrails.
 * If no guardrail row exists → allow (default open).
 */
export async function canExecuteAction(
  action: CommunityAiAction,
  context: { source: 'evaluation' | 'scheduler' }
): Promise<GuardrailResult> {
  const companyId = action.company_id;

  const { data: row, error: loadError } = await supabase
    .from('execution_guardrails')
    .select('auto_execution_enabled, daily_platform_limit, per_post_reply_limit, per_evaluation_limit')
    .eq('company_id', companyId)
    .maybeSingle();

  if (loadError) {
    console.warn('[executionGuardrail] load error', loadError.message);
    return { allowed: true };
  }

  if (!row) {
    return { allowed: true };
  }

  if (row.auto_execution_enabled === false) {
    return { allowed: false, reason: 'auto_disabled' };
  }

  const platform = (action.platform || '').toString().trim().toLowerCase();
  const orgId = action.organization_id ?? companyId;

  if (row.daily_platform_limit != null) {
    const startToday = startOfToday();
    const { count, error } = await supabase
      .from('community_ai_actions')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('platform', platform)
      .eq('status', 'executed')
      .not('executed_at', 'is', null)
      .gte('executed_at', startToday);

    if (!error && count != null && count >= row.daily_platform_limit) {
      return { allowed: false, reason: 'daily_platform_limit' };
    }
  }

  if (
    (action.action_type || '').toString().toLowerCase() === 'reply' &&
    row.per_post_reply_limit != null
  ) {
    const { count, error } = await supabase
      .from('community_ai_actions')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('platform', platform)
      .eq('target_id', action.target_id)
      .eq('action_type', 'reply')
      .eq('status', 'executed')
      .not('executed_at', 'is', null);

    if (!error && count != null && count >= row.per_post_reply_limit) {
      return { allowed: false, reason: 'per_post_limit' };
    }
  }

  if (context.source === 'evaluation' && row.per_evaluation_limit != null) {
    const windowStart = tenMinutesAgo();
    const { count, error } = await supabase
      .from('community_ai_actions')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('platform', platform)
      .eq('status', 'executed')
      .not('executed_at', 'is', null)
      .gte('executed_at', windowStart);

    if (!error && count != null && count >= row.per_evaluation_limit) {
      return { allowed: false, reason: 'per_evaluation_limit' };
    }
  }

  return { allowed: true };
}
