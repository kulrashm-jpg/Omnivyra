/**
 * Credit Admin Grant Service
 *
 * Manual extension of free credits by a super-admin. Distinct from
 * grantCredits() in consumptionAnalyticsService, which grants category='paid'
 * (simulated purchase). This service grants category='free' and writes an
 * audit row to credit_admin_grants.
 *
 * Guards:
 *   - Hard limit of 3 admin grants per organization per 24h. The 4th request
 *     is rejected with GRANT_LIMIT_EXCEEDED. A caller (e.g. an ops escalation
 *     tool) can bypass by passing { allowOverLimit: true }.
 *   - Expiry mirrors initial grants: default 14 days, overridable per-grant.
 *     Caller can pass expiryDays=0 for a no-expiry grant.
 *
 * Idempotency:
 *   - Caller-supplied clientKey (e.g. the request's Idempotency-Key header) is
 *     required and is absorbed by both the ledger
 *     (credit_transactions.idempotency_key) and the audit row
 *     (credit_admin_grants.idempotency_key UNIQUE).
 */

import { createServiceRoleMigrationProxy } from '../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { createCredit, makeIdempotencyKey } from './creditExecutionService';
import { logger } from './logger';

export const ADMIN_GRANT_REASON_TYPES = [
  'customer_support',
  'goodwill',
  'promotional',
  'beta_feedback',
  'compensation',
  'correction',
  'other',
] as const;
export type AdminGrantReasonType = typeof ADMIN_GRANT_REASON_TYPES[number];

export const DEFAULT_ADMIN_GRANT_EXPIRY_DAYS = 14;
export const ADMIN_GRANT_MAX_PER_DAY         = 3;

export interface AdminGrantOpts {
  organizationId: string;
  credits:        number;
  reason:         string;
  reasonType:     AdminGrantReasonType;
  actorUserId:    string;
  /** Grant expiry in days. Defaults to 14 (matches initial-grant expiry). Pass 0 for no expiry. */
  expiryDays?:    number;
  /** Caller-supplied uniqueness scope (e.g. Idempotency-Key header). Required. */
  clientKey:      string;
  /** Extra context for the audit row. */
  metadata?:      Record<string, unknown>;
  /** Bypass the 3-per-24h limit (escalation use only). */
  allowOverLimit?: boolean;
}

export type AdminGrantErrorCode =
  | 'MISSING_ORG'
  | 'MISSING_REASON'
  | 'INVALID_REASON_TYPE'
  | 'INVALID_CREDITS'
  | 'INVALID_EXPIRY'
  | 'GRANT_LIMIT_EXCEEDED'
  | 'LEDGER_FAILED';

export type AdminGrantResult =
  | {
      ok: true;
      credits: number;
      idempotencyKey: string;
      expiresAt: string | null;
    }
  | {
      ok: false;
      error: string;
      code: AdminGrantErrorCode;
    };

function isValidReasonType(v: unknown): v is AdminGrantReasonType {
  return typeof v === 'string'
    && (ADMIN_GRANT_REASON_TYPES as readonly string[]).includes(v);
}

async function countRecentGrants(orgId: string): Promise<number> {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from('credit_admin_grants')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .gt('created_at', since24h);
  if (error) {
    logger.warn('admin_grant_rate_count_failed', { orgId, message: error.message });
    // Fail-open on rate-count errors — the hard DB UNIQUE on idempotency_key
    // still prevents replay; only the per-org velocity guard is affected.
    return 0;
  }
  return count ?? 0;
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
  const expiresAt: string | null = expiryDays > 0
    ? new Date(Date.now() + expiryDays * 86400 * 1000).toISOString()
    : null;

  // ── Velocity guard: max 3 admin grants per org per 24h ──────────────────
  if (!opts.allowOverLimit) {
    const recent = await countRecentGrants(opts.organizationId);
    if (recent >= ADMIN_GRANT_MAX_PER_DAY) {
      logger.warn('admin_grant_limit_exceeded', {
        orgId: opts.organizationId,
        actor: opts.actorUserId,
        recentCount: recent,
        attemptedCredits: opts.credits,
        reasonType: opts.reasonType,
      });
      return {
        ok:    false,
        error: `Admin grant limit exceeded (${ADMIN_GRANT_MAX_PER_DAY} per 24h). Wait or pass allowOverLimit=true for escalation.`,
        code:  'GRANT_LIMIT_EXCEEDED',
      };
    }
  }

  if (!opts.clientKey || !opts.clientKey.trim()) {
    throw new Error('grantAdminCreditExtension: clientKey is required (route must pass Idempotency-Key header)');
  }
  const idempotencyKey = makeIdempotencyKey(
    opts.actorUserId,
    'admin_credit_extension',
    opts.organizationId,
    opts.clientKey,
  );

  // ── 1. Grant credits on the ledger (idempotent at the DB layer) ──────────
  try {
    await createCredit({
      orgId:          opts.organizationId,
      amount:         opts.credits,
      category:       'free',
      referenceType:  'admin_extension',
      referenceId:    opts.organizationId,
      note:           `Admin free-credit extension (${opts.reasonType}): ${opts.reason}`,
      performedBy:    opts.actorUserId,
      idempotencyKey,
    });
  } catch (err: any) {
    logger.error('admin_grant_ledger_failed', {
      orgId: opts.organizationId, actor: opts.actorUserId, message: err?.message,
    });
    return { ok: false, error: err?.message ?? 'Ledger grant failed', code: 'LEDGER_FAILED' };
  }

  // ── 2. Audit row — 23505 means a retry inside the same idempotency bucket ──
  const { error: auditErr } = await supabase.from('credit_admin_grants').insert({
    organization_id:    opts.organizationId,
    granted_by_user_id: opts.actorUserId,
    credits_granted:    opts.credits,
    reason:             opts.reason,
    reason_type:        opts.reasonType,
    expires_at:         expiresAt,
    idempotency_key:    idempotencyKey,
    metadata:           opts.metadata ?? {},
  });

  if (auditErr && (auditErr as any).code !== '23505') {
    logger.error('admin_grant_audit_failed', {
      orgId: opts.organizationId, message: auditErr.message,
    });
    // Ledger already granted — don't unwind. Caller sees success; the audit
    // row is recoverable via the ledger's credit_transactions log.
  }

  return { ok: true, credits: opts.credits, idempotencyKey, expiresAt };
}
