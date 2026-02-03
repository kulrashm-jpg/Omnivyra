import { supabase } from '../db/supabaseClient';
import { executeAction } from './communityAiActionExecutor';
import { logCommunityAiActionEvent } from './communityAiActionLogService';
import { notifyCommunityAi } from './communityAiNotificationService';

type SchedulerResult = {
  processed: number;
  executed: number;
  failed: number;
};

export const runCommunityAiScheduler = async (now = new Date()): Promise<SchedulerResult> => {
  const cutoff = now.toISOString();
  const { data: actions, error } = await supabase
    .from('community_ai_actions')
    .select('*')
    .eq('status', 'scheduled')
    .lte('scheduled_at', cutoff);

  if (error || !actions) {
    console.warn('COMMUNITY_AI_SCHEDULER_LOAD_FAILED', error?.message);
    return { processed: 0, executed: 0, failed: 0 };
  }

  let executed = 0;
  let failed = 0;

  for (const action of actions) {
    if (!action.tenant_id || !action.organization_id) {
      failed += 1;
      await supabase
        .from('community_ai_actions')
        .update({ status: 'failed', updated_at: new Date().toISOString() })
        .eq('id', action.id);
      await logCommunityAiActionEvent({
        action_id: action.id,
        tenant_id: action.tenant_id || 'unknown',
        organization_id: action.organization_id || 'unknown',
        event_type: 'failed',
        event_payload: { error: 'TENANT_SCOPE_MISSING' },
      });
      continue;
    }

    const result = await executeAction(action, true, { notify: false });
    const nextStatus = result.ok ? 'executed' : 'failed';
    if (result.ok) executed += 1;
    else failed += 1;

    await supabase
      .from('community_ai_actions')
      .update({
        status: nextStatus,
        execution_result: result,
        updated_at: new Date().toISOString(),
      })
      .eq('id', action.id);

    await logCommunityAiActionEvent({
      action_id: action.id,
      tenant_id: action.tenant_id,
      organization_id: action.organization_id,
      event_type: nextStatus === 'executed' ? 'executed' : 'failed',
      event_payload: result,
    });

    await notifyCommunityAi({
      tenant_id: action.tenant_id,
      organization_id: action.organization_id,
      action_id: action.id,
      event_type: nextStatus === 'executed' ? 'executed' : 'failed',
      message: `Scheduled action ${nextStatus} on ${action.platform}`,
    });
  }

  return { processed: actions.length, executed, failed };
};
