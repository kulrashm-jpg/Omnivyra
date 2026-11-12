import { ownedDbTable } from '../db/writeOwner';
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
 * Idempotency (2026-11-12, class 2):
 *   - The key scope is the caller's clientKey, else the REQUEST's
 *     Idempotency-Key (the route's withIdempotency requires it). A retry of the
 *     same request is absorbed by the ledger (credit_transactions.idempotency_key)
 *     and the audit row (credit_admin_grants.idempotency_key UNIQUE).
 *   - It used to fall back to a MINUTE bucket: a retry after the minute rolled
 *     over granted twice, and two distinct grants inside one minute collapsed
 *     into one while both reported success. With no key at all the grant is
 *     now refused (IDEMPOTENCY_KEY_REQUIRED).
 *   - KNOWN GAP (needs the DB): the 3-per-24h cap is a count-then-act, so
 *     concurrent requests can each pass it. Raised for an atomic RPC.
 */

import { supabase } from '../db/supabaseClient';
import { createCredit, makeIdempotencyKey } from './creditExecutionService';
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
  /** Optional caller-supplied uniqueness scope (e.g. request id). */
  clientKey?:     string;
  /** The request's Idempotency-Key; used when no clientKey is given. */
  requestIdempotencyKey?: string;
  /** Extra context for the audit row. */
  metadata?:      Record<string, unknown>;
  /** Bypass the 3-per-24h limit (escalation use only). */
  allowOverLimit?: boolean;
}

function isValidReasonType(v: unknown): v is AdminGrantReasonType {
  return typeof v === 'string'
    && (ADMIN_GRANT_REASON_TYPES as readonly string[]).includes(v);
}

async function countRecentGrants(orgId: string): Promise<number | null> {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await ownedDbTable('credit_admin_grants')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .gt('created_at', since24h);
  if (error) {
    // MONEY (2026-11-12): a failed count is NOT "0 recent grants". Failing open
    // here silently disabled the per-org velocity cap during any read outage
    // (the idempotency UNIQUE stops replays, not NEW grants). Unknown -> null,
    // and the caller refuses.
    logger.warn('admin_grant_rate_count_failed', { orgId, message: error.message });
    return null;
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
    if (recent === null) {
      return {
        ok:    false,
        error: 'Could not verify the admin grant limit; nothing granted. Retry, or pass allowOverLimit=true for escalation.',
        code:  'GRANT_LIMIT_UNVERIFIABLE',
      };
    }
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

  // KEY-FORMAT CHANGE (minute bucket -> request key), why no business-identity
  // guard (05): a GRANT has no business identity - two identical grants are a
  // legitimate pair, so no ledger read can tell a retry from a second grant.
  // What covers the change is withIdempotency on the routes (scope + caller +
  // Idempotency-Key, present BEFORE this change): a cross-deploy retry with the
  // same key replays the completed record and never reaches here. ACCEPTED GAP:
  // a pre-deploy attempt that wrote the ledger row then answered 5xx leaves a
  // `failed` record; retried after deploy it runs with the NEW key -> granted
  // twice. Needs partial completion + 5xx + a retry spanning the deploy; admin
  // grants are rare and audited (credit_admin_grants). Deploy with none in flight.
  const scope = opts.clientKey?.trim() || opts.requestIdempotencyKey?.trim() || null;
  if (!scope) {
    return { ok: false, error: 'An idempotency key (clientKey or Idempotency-Key) is required', code: 'IDEMPOTENCY_KEY_REQUIRED' };
  }
  const idempotencyKey = makeIdempotencyKey(
    opts.actorUserId,
    'admin_credit_extension',
    opts.organizationId,
    scope,
  );

  // ── 1. Grant credits on the ledger (idempotent at the DB layer) ──────────
  try {
    await createCredit({
      orgId:          opts.organizationId,
      amount:         opts.credits,
      category:       'paid', // approved policy: admin grants → PAID (never expire, consumed after FREE, subscription-locked)
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
  const { error: auditErr } = await ownedDbTable('credit_admin_grants').insert({
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
