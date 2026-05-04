/**
 * Auth audit log: structured, fire-and-forget writes to auth_audit_logs.
 *
 * Rules:
 *   - Never throws. Audit failures are logged as warnings and never bubble up.
 *   - Uses the controlled service-role wrapper.
 *   - All writes are non-blocking when callers use `void logAuthEvent(...)`.
 */

import { runWithServiceRole } from '@/backend/db/supabaseClient';
import { detectAnomaly } from '../anomaly/detectionEngine';

export type AuthAuditEvent =
  | 'user_deleted'
  | 'role_changed'
  | 'ghost_session_detected'
  | 'unauthorized_access_attempt'
  | 'domain_validation_failed';

const AUDIT_TO_ANOMALY: Partial<Record<AuthAuditEvent, string>> = {
  ghost_session_detected:      'ghost_session_detected',
  unauthorized_access_attempt: 'unauthorized_access',
  domain_validation_failed:    'domain_validation_failed',
  user_deleted:                undefined,
  role_changed:                undefined,
};

export async function logAuthEvent(
  event: AuthAuditEvent,
  opts: {
    userId?: string | null;
    supabaseUid?: string | null;
    metadata?: Record<string, unknown>;
  } = {},
): Promise<void> {
  try {
    await runWithServiceRole(
      'Write auth audit event',
      (client) => client.from('auth_audit_logs').insert({
        event,
        user_id:      opts.userId ?? null,
        supabase_uid: opts.supabaseUid ?? null,
        metadata:     opts.metadata ?? null,
      } as any),
    );
  } catch (err) {
    console.warn('[auditLog] insert failed:', (err as Error)?.message);
  }

  const anomalyType = AUDIT_TO_ANOMALY[event];
  if (anomalyType) {
    void detectAnomaly({
      type:     anomalyType,
      entityId: opts.userId ?? opts.supabaseUid ?? undefined,
      metadata: opts.metadata,
    });
  }
}
