import { supabase } from '../db/supabaseClient';
import { getRequestContext } from './requestContext';
import { ownedDbTable } from '../db/writeOwner';

export async function recordAdminAudit(input: {
  actorUserId: string;
  action: string;
  targetType: string;
  targetId?: string | null;
  metadata?: Record<string, unknown> | null;
  idempotencyKey?: string | null;
}): Promise<void> {
  const ctx = getRequestContext();
  const { error } = await ownedDbTable('super_admin_audit_logs').insert({
    actor_user_id: input.actorUserId,
    action: input.action,
    target_type: input.targetType,
    target_id: input.targetId ?? null,
    metadata: {
      ...(input.metadata ?? {}),
      request_id: ctx.requestId ?? null,
      correlation_id: ctx.correlationId ?? null,
    },
    idempotency_key: input.idempotencyKey ?? ctx.idempotencyKey ?? null,
    created_at: new Date().toISOString(),
  });

  if (error) {
    throw new Error(`ADMIN_AUDIT_FAILED:${error.message}`);
  }
}
