import { supabase } from '../db/supabaseClient';

type ActionEventType =
  | 'approved'
  | 'executed'
  | 'failed'
  | 'skipped'
  | 'scheduled'
  | 'auto_executed'
  | 'skipped_due_to_platform_policy';

export const logCommunityAiActionEvent = async (input: {
  action_id: string;
  tenant_id: string;
  organization_id: string;
  event_type: ActionEventType;
  event_payload?: any;
}) => {
  const payload = {
    action_id: input.action_id,
    tenant_id: input.tenant_id,
    organization_id: input.organization_id,
    event_type: input.event_type,
    event_payload: input.event_payload ?? null,
    created_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('community_ai_action_logs').insert(payload);
  if (error) {
    console.warn('COMMUNITY_AI_ACTION_LOG_FAILED', error.message);
  }
};

export type { ActionEventType };
