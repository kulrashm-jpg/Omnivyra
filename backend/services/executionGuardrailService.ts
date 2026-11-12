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
  reason?: 'auto_disabled' | 'daily_platform_limit' | 'per_post_limit' | 'per_evaluation_limit' | 'guardrail_unreadable';
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
 * Actions that count against a limit: EXECUTED in the window, plus EXECUTING ones (claimed, in flight,
 * executed_at not yet set). CLASS-2 A19 (e9 sweep): only `executed` rows were counted, so a scheduler
 * and an auto-rule run (or two schedulers) each saw room and both sent - real replies past the
 * per-post / daily limit. Counting the in-flight claims closes all but the gap between this check and
 * the claim; closing that needs an atomic counter (a database function), listed as the follow-up.
 * Returns null when either count is unreadable: the caller then REFUSES (it used to allow).
 */
async function countAgainstLimit(build: (q: any) => any, executedSince: string | null): Promise<number | null> {
  let executed = build(supabase.from('community_ai_actions').select('id', { count: 'exact', head: true }))
    .eq('status', 'executed')
    .not('executed_at', 'is', null);
  if (executedSince) executed = executed.gte('executed_at', executedSince);
  const inFlight = build(supabase.from('community_ai_actions').select('id', { count: 'exact', head: true }))
    .eq('status', 'executing');
  const [done, flying] = await Promise.all([executed, inFlight]);
  if (done.error || flying.error || done.count == null || flying.count == null) return null;
  return done.count + flying.count;
}

/**
 * Check if an action is allowed by company guardrails.
 * If no guardrail row exists → allow (default open). An UNREADABLE guardrail or count refuses
 * (CLASS-2 A19: every read error used to answer `allowed: true`).
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
    console.warn('[executionGuardrail] guardrails unreadable; refusing (fail closed)', loadError.message);
    return { allowed: false, reason: 'guardrail_unreadable' };
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
    const count = await countAgainstLimit((q) => q.eq('organization_id', orgId).eq('platform', platform), startOfToday());
    if (count === null) return { allowed: false, reason: 'guardrail_unreadable' };
    if (count >= row.daily_platform_limit) {
      return { allowed: false, reason: 'daily_platform_limit' };
    }
  }

  if (
    (action.action_type || '').toString().toLowerCase() === 'reply' &&
    row.per_post_reply_limit != null
  ) {
    const count = await countAgainstLimit(
      (q) => q.eq('organization_id', orgId).eq('platform', platform).eq('target_id', action.target_id).eq('action_type', 'reply'),
      null,
    );
    if (count === null) return { allowed: false, reason: 'guardrail_unreadable' };
    if (count >= row.per_post_reply_limit) {
      return { allowed: false, reason: 'per_post_limit' };
    }
  }

  if (context.source === 'evaluation' && row.per_evaluation_limit != null) {
    const count = await countAgainstLimit((q) => q.eq('organization_id', orgId).eq('platform', platform), tenMinutesAgo());
    if (count === null) return { allowed: false, reason: 'guardrail_unreadable' };
    if (count >= row.per_evaluation_limit) {
      return { allowed: false, reason: 'per_evaluation_limit' };
    }
  }

  return { allowed: true };
}
