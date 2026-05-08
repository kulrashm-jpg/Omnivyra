import { ownedDbTable } from '../db/writeOwner';
/**
 * auditActorService.ts
 *
 * Provides the SYSTEM_USER_ID sentinel + a small wrapper that enforces the
 * "actor_user_id MUST NOT be NULL" invariant for audit_logs writes.
 *
 * This is additive: existing call sites that insert audit_logs directly are
 * untouched. New code (and admin override paths in particular) should use
 * insertAuditLogStrict() so that every audit row carries a non-null actor.
 *
 * Why a sentinel UUID rather than a real user row:
 *   - Some audits are genuinely system-initiated (cron jobs, signup-intent
 *     bootstrap, post-deploy migrations). Forcing a real user would either
 *     impersonate a human or block the write.
 *   - A fixed UUID lets reports filter "actor = SYSTEM" cleanly and lets us
 *     add a row in users with this id later if we want FK enforcement.
 */

import { supabase } from '../db/supabaseClient';
import { logger } from './logger';

/**
 * Fixed UUID v4 used as the actor for system-initiated audit events.
 * Override at deploy time via env var if a different value is preferred.
 *
 * The all-zero UUID is intentional: it is unmistakable in dashboards and
 * cannot collide with a gen_random_uuid() value.
 */
export const SYSTEM_USER_ID: string =
  process.env.AUDIT_SYSTEM_USER_ID
  || '00000000-0000-0000-0000-000000000000';

export interface AuditLogStrictInput {
  /**
   * The user who initiated the action. Pass null/undefined explicitly only
   * for true system actions — the wrapper substitutes SYSTEM_USER_ID.
   */
  actorUserId: string | null | undefined;
  action: string;
  targetUserId?: string | null;
  companyId?: string | null;
  /**
   * Override metadata. The wrapper ALWAYS sets `override`, `override_reason`,
   * `input_domain`, `final_domain` keys — pass them in metadata if applicable.
   */
  metadata?: Record<string, unknown>;
}

/**
 * Insert into audit_logs with the non-null-actor invariant enforced and
 * the override-metadata schema standardized.
 *
 * Returns { ok: true } on success or { ok: false, error } on DB failure.
 * Never throws.
 */
export async function insertAuditLogStrict(input: AuditLogStrictInput): Promise<{
  ok: boolean;
  error?: string;
}> {
  const actor =
    input.actorUserId && String(input.actorUserId).length > 0
      ? input.actorUserId
      : SYSTEM_USER_ID;

  const meta = input.metadata ?? {};
  const stamped: Record<string, unknown> = {
    override:        Boolean((meta as any).override) || false,
    override_reason: ((meta as any).override_reason as string | null) ?? null,
    input_domain:    ((meta as any).input_domain as string | null)    ?? null,
    final_domain:    ((meta as any).final_domain as string | null)    ?? null,
    ...meta,
  };

  const { error } = await ownedDbTable('audit_logs').insert({
    actor_user_id:  actor,
    action:         input.action,
    target_user_id: input.targetUserId ?? null,
    company_id:     input.companyId    ?? null,
    metadata:       stamped,
    created_at:     new Date().toISOString(),
  });

  if (error) {
    logger.error('audit_log_strict_insert_failed', {
      action: input.action,
      actorUserId: actor,
      message: error.message,
    });
    return { ok: false, error: error.message };
  }

  return { ok: true };
}
