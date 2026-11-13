/**
 * Credit Admin Grant Service
 *
 * Manual credit extension by a super-admin (category 'paid' on the ledger, an audit row in credit_admin_grants).
 *
 * M5 (e1, e9-approved BLOCKING money 2026-11-13; migration 20270217000017): the grant is ONE database transaction,
 * public.admin_grant_credits - a per-org advisory lock, the rolling 24h count, the ledger credit and the audit row
 * together. The former count-then-act sequence let concurrent grants all pass, turned a failed count into 0 (fail-open),
 * credited the ledger BEFORE the counted audit row (and swallowed the audit failure, so the cap under-counted forever),
 * and keyed idempotency on a MINUTE BUCKET (two grants in one minute collapsed; a retry across a minute granted twice).
 *
 * Guards:
 *   - At most ADMIN_GRANT_MAX_PER_DAY grants per organization in any rolling 24h; the next is GRANT_LIMIT_EXCEEDED.
 *     allowOverLimit (super-admin escalation) bypasses it - recorded on the audit row and logged at WARN.
 *   - clientKey is REQUIRED: one key per grant REQUEST (the route passes the request's Idempotency-Key). A replay of the
 *     same key returns the same grant; the same key for a different org/amount is refused (GRANT_KEY_REUSED).
 *   - Expiry mirrors initial grants: default 14 days, 0 = no expiry.
 * No fallback: if the function is missing the grant fails closed (GRANT_UNAVAILABLE), never the old path.
 */

import { supabase } from '../db/supabaseClient';
import { logger } from './logger';
import {
  ADMIN_GRANT_MAX_PER_DAY,
  ADMIN_GRANT_REASON_TYPES,
  DEFAULT_ADMIN_GRANT_EXPIRY_DAYS,
  type AdminGrantReasonType,
  type AdminGrantResult,
} from './creditAdminGrantContract';

export {
  ADMIN_GRANT_MAX_PER_DAY,
  ADMIN_GRANT_REASON_TYPES,
  DEFAULT_ADMIN_GRANT_EXPIRY_DAYS,
};
export type { AdminGrantReasonType, AdminGrantResult };

export interface AdminGrantOpts {
  organizationId: string;
  credits:        number;
  reason:         string;
  reasonType:     AdminGrantReasonType;
  actorUserId:    string;
  /** Grant expiry in days. Defaults to 14 (matches initial-grant expiry). Pass 0 for no expiry. */
  expiryDays?:    number;
  /** REQUIRED (M5): one key per grant request - the route passes the request's Idempotency-Key. */
  clientKey?:     string;
  /** Extra context for the audit row. */
  metadata?:      Record<string, unknown>;
  /** Bypass the 3-per-24h limit (escalation use only). */
  allowOverLimit?: boolean;
}

function isValidReasonType(v: unknown): v is AdminGrantReasonType {
  return typeof v === 'string'
    && (ADMIN_GRANT_REASON_TYPES as readonly string[]).includes(v);
}

export async function grantAdminCreditExtension(opts: AdminGrantOpts): Promise<AdminGrantResult> {
  if (!opts.organizationId) return { ok: false, error: 'organizationId required', code: 'MISSING_ORG' };
  if (!opts.reason?.trim()) return { ok: false, error: 'reason required',         code: 'MISSING_REASON' };
  if (!isValidReasonType(opts.reasonType)) {
    return {
      ok:    false,
      error: `reasonType must be one of: ${ADMIN_GRANT_REASON_TYPES.join(', ')}`,
      code:  'INVALID_REASON_TYPE',
    };
  }
  if (!Number.isInteger(opts.credits) || opts.credits <= 0) {
    return { ok: false, error: 'credits must be a positive integer', code: 'INVALID_CREDITS' };
  }
  const expiryDays = opts.expiryDays ?? DEFAULT_ADMIN_GRANT_EXPIRY_DAYS;
  if (!Number.isFinite(expiryDays) || expiryDays < 0) {
    return { ok: false, error: 'expiryDays must be >= 0', code: 'INVALID_EXPIRY' };
  }
  const clientKey = typeof opts.clientKey === 'string' ? opts.clientKey.trim() : '';
  if (!clientKey) {
    return { ok: false, error: 'clientKey (one key per grant request) is required', code: 'MISSING_CLIENT_KEY' };
  }
  const expiresAt: string | null = expiryDays > 0
    ? new Date(Date.now() + expiryDays * 86400 * 1000).toISOString()
    : null;

  const { data, error } = await supabase.rpc('admin_grant_credits', {
    p_org_id:           opts.organizationId,
    p_actor_user_id:    opts.actorUserId,
    p_credits:          opts.credits,
    p_reason:           opts.reason.trim(),
    p_reason_type:      opts.reasonType,
    p_expires_at:       expiresAt,
    p_client_key:       clientKey,
    p_max_per_24h:      ADMIN_GRANT_MAX_PER_DAY,
    p_allow_over_limit: opts.allowOverLimit === true,
    p_metadata:         opts.metadata ?? {},
  });

  if (error) {
    const message = String((error as { message?: string }).message ?? '');
    const code = (error as { code?: string }).code;
    if (message.includes('GRANT_LIMIT_EXCEEDED')) {
      logger.warn('admin_grant_limit_exceeded', { orgId: opts.organizationId, actor: opts.actorUserId, attemptedCredits: opts.credits });
      return {
        ok:    false,
        error: `Admin grant limit exceeded (${ADMIN_GRANT_MAX_PER_DAY} per 24h). Wait or pass allowOverLimit=true for escalation.`,
        code:  'GRANT_LIMIT_EXCEEDED',
      };
    }
    if (message.includes('ADMIN_GRANT_KEY_REUSED')) {
      return { ok: false, error: 'This request key was already used for a different grant', code: 'GRANT_KEY_REUSED' };
    }
    if (code === 'PGRST202' || code === '42883') {
      logger.error('admin_grant_function_missing', { orgId: opts.organizationId, message });
      return { ok: false, error: 'Admin credit grants are temporarily unavailable', code: 'GRANT_UNAVAILABLE' };
    }
    // Any other failure rolled back the WHOLE grant (ledger + audit are one transaction): nothing was granted.
    logger.error('admin_grant_failed', { orgId: opts.organizationId, actor: opts.actorUserId, message });
    return { ok: false, error: message || 'Admin grant failed', code: 'LEDGER_FAILED' };
  }

  const row = (data ?? {}) as { idempotency_key?: string; expires_at?: string | null; replayed?: boolean; over_limit?: boolean };
  if (!row.idempotency_key) {
    logger.error('admin_grant_no_result', { orgId: opts.organizationId });
    return { ok: false, error: 'Admin grant returned no result', code: 'LEDGER_FAILED' };
  }
  if (row.over_limit) {
    logger.warn('admin_grant_over_limit_override', {
      orgId: opts.organizationId, actor: opts.actorUserId, credits: opts.credits, reasonType: opts.reasonType,
    });
  }
  return { ok: true, credits: opts.credits, idempotencyKey: row.idempotency_key, expiresAt: row.expires_at ?? expiresAt };
}
