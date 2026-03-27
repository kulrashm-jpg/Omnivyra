/**
 * Auth audit log — structured, fire-and-forget writes to auth_audit_logs.
 *
 * Rules:
 *   - Never throws. Audit failures are logged as warnings and never bubble up.
 *   - Uses a lazy singleton Supabase client (service role) so callers don't
 *     need to construct one.
 *   - All writes are non-blocking (awaited internally but the caller may
 *     fire-and-forget with `void logAuthEvent(...)` for hot paths).
 */

import { createClient } from '@supabase/supabase-js';
import { detectAnomaly } from '../anomaly/detectionEngine';

let _client: ReturnType<typeof createClient> | null = null;

function getAuditClient() {
  if (_client) return _client;
  _client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return _client;
}

export type AuthAuditEvent =
  | 'user_deleted'
  | 'role_changed'
  | 'ghost_session_detected'
  | 'unauthorized_access_attempt'
  | 'domain_validation_failed';

/**
 * Insert a row into auth_audit_logs.
 *
 * @param event       One of the AuthAuditEvent string literals.
 * @param opts.userId Internal Supabase users.id (nullable — may be unknown
 *                    when a ghost session has no matching DB row).
 * @param opts.firebaseUid  Firebase UID from the token (always available post-verify).
 * @param opts.metadata     Arbitrary JSON context for the event.
 */
// Mapping from audit event types to anomaly detection types.
// Only events that have a corresponding ANOMALY_CONFIGS entry are forwarded.
const AUDIT_TO_ANOMALY: Partial<Record<AuthAuditEvent, string>> = {
  ghost_session_detected:    'ghost_session_detected',
  unauthorized_access_attempt: 'unauthorized_access',
  domain_validation_failed:  'domain_validation_failed',
  user_deleted:              undefined, // operational — not an anomaly signal
  role_changed:              undefined,
};

export async function logAuthEvent(
  event: AuthAuditEvent,
  opts: {
    userId?:      string | null;
    firebaseUid?: string | null;
    metadata?:    Record<string, unknown>;
  } = {},
): Promise<void> {
  try {
    await getAuditClient().from('auth_audit_logs').insert({
      event,
      user_id:      opts.userId      ?? null,
      firebase_uid: opts.firebaseUid ?? null,
      metadata:     opts.metadata    ?? null,
    } as any);
  } catch (err) {
    // Audit failure must never block auth flows
    console.warn('[auditLog] insert failed:', (err as Error)?.message);
  }

  // Forward to anomaly detection engine (fire-and-forget, never throws)
  const anomalyType = AUDIT_TO_ANOMALY[event];
  if (anomalyType) {
    void detectAnomaly({
      type:      anomalyType,
      entityId:  opts.userId ?? opts.firebaseUid ?? undefined,
      metadata:  opts.metadata,
    });
  }
}
