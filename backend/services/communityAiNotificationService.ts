import { supabase } from '../db/supabaseClient';
import { ownedDbTable } from '../db/writeOwner';

type NotificationEventType = 'approved' | 'executed' | 'failed' | 'high_risk_pending';

export const notifyCommunityAi = async (input: {
  tenant_id: string;
  organization_id: string;
  action_id?: string | null;
  event_type: NotificationEventType;
  message: string;
}) => {
  if (process.env.NODE_ENV !== 'test') {
    console.log('COMMUNITY_AI_NOTIFICATION', {
      event_type: input.event_type,
      action_id: input.action_id || null,
      tenant_id: input.tenant_id,
      organization_id: input.organization_id,
    });
  }

  const { error } = await ownedDbTable('community_ai_notifications').insert({
    tenant_id: input.tenant_id,
    organization_id: input.organization_id,
    action_id: input.action_id ?? null,
    event_type: input.event_type,
    message: input.message,
    is_read: false,
    created_at: new Date().toISOString(),
  });
  if (error) {
    console.warn('COMMUNITY_AI_NOTIFICATION_STORE_FAILED', error.message);
  }
};

/**
 * OPT-010 A3 (additive): bulk variant — ONE insert for N notifications instead
 * of N sequential inserts. Same per-entry log line, same row shape, same
 * ownedDbTable write seam, same warn-only error handling as notifyCommunityAi.
 */
export const notifyCommunityAiBulk = async (
  inputs: Array<{
    tenant_id: string;
    organization_id: string;
    action_id?: string | null;
    event_type: NotificationEventType;
    message: string;
  }>,
) => {
  if (inputs.length === 0) return;

  if (process.env.NODE_ENV !== 'test') {
    for (const input of inputs) {
      console.log('COMMUNITY_AI_NOTIFICATION', {
        event_type: input.event_type,
        action_id: input.action_id || null,
        tenant_id: input.tenant_id,
        organization_id: input.organization_id,
      });
    }
  }

  const nowIso = new Date().toISOString();
  const { error } = await ownedDbTable('community_ai_notifications').insert(
    inputs.map((input) => ({
      tenant_id: input.tenant_id,
      organization_id: input.organization_id,
      action_id: input.action_id ?? null,
      event_type: input.event_type,
      message: input.message,
      is_read: false,
      created_at: nowIso,
    })),
  );
  if (error) {
    console.warn('COMMUNITY_AI_NOTIFICATION_STORE_FAILED', error.message);
  }
};

export type { NotificationEventType };
