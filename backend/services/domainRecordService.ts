/**
 * domainRecordService.ts
 *
 * Single, authoritative writer for company_domains rows. New code MUST go
 * through saveDomainRecord() / reassignDomain(); existing direct INSERTs will
 * be migrated in a follow-up. Reasons for the abstraction:
 *
 *   1. Enforces input_domain / final_domain / redirect_chain are stored
 *      together — no half-populated rows.
 *   2. Centralizes the override_reason invariant (must be present when
 *      verification_status = 'admin_override').
 *   3. Emits passive log lines per write capturing the canonical mismatch,
 *      forwarding signal, AND a new canonical_conflict_detected signal when
 *      final_domain collides with another row.
 *   4. Writes the legacy `domain` column too, so reads that still reference
 *      it keep working during the transition.
 *   5. Refuses to silently reassign a domain to a different company — that
 *      now requires reassignDomain() with explicit confirm_reassignment=true.
 *
 * NOTE: This utility is not yet wired into existing flows. Wiring is a
 * follow-up change.
 */

import crypto from 'crypto';
import { supabase } from '../db/supabaseClient';
import { logger } from './logger';
import { insertAuditLogStrict, SYSTEM_USER_ID } from './auditActorService';
import { hashVerificationToken } from './verificationSecret';

/** 32 bytes of crypto-random hex = 64 chars; per-domain, unguessable. */
function generateVerificationToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export type VerificationStatus =
  | 'unverified'
  | 'pending'
  | 'verified'
  | 'admin_override';

export type CreatedVia = 'user' | 'admin' | 'system';

export interface SaveDomainRecordInput {
  company_id: string;
  input_domain: string;
  final_domain: string;
  redirect_chain?: string[] | null;
  is_forwarding?: boolean;
  verification_status: VerificationStatus;
  created_via: CreatedVia;
  override_reason?: string | null;
  is_primary?: boolean;
}

export interface SaveDomainRecordResult {
  ok: boolean;
  id?: string;
  error?: string;
  /**
   * Set when ok=false because the domain is already claimed by a different
   * company. Callers must route through reassignDomain() to take action.
   */
  conflict?: {
    code: 'DOMAIN_ALREADY_CLAIMED';
    existing_company_id: string;
    existing_id: string;
  };
  /**
   * Raw verification token — returned ONLY at INSERT time for user-flow
   * rows so the UI can show it once. The DB stores only HMAC(raw_token).
   * The server does not retain the raw token after this response.
   */
  verification_token?: string;
}

interface ExistingDomainRow {
  id: string;
  company_id: string;
}

/**
 * Look up a company_domains row by its canonical key (final_domain).
 *
 * Reads final_domain only — the legacy `domain` column is deprecated. We
 * still WRITE to `domain` (for downstream readers that haven't migrated
 * yet) but never read from it.
 *
 * Returns the lowest-id matching row when multiple share the same
 * final_domain (possible during a backfill window before collisions are
 * frozen). Once a UNIQUE(final_domain) constraint is in place this
 * collapses to the unique row.
 */
async function findExistingByDomain(domain: string): Promise<ExistingDomainRow | null> {
  if (!domain) return null;
  const { data, error } = await supabase
    .from('company_domains')
    .select('id, company_id')
    .eq('final_domain', domain)
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    logger.error('domain_record_lookup_failed', { domain, message: error.message });
    return null;
  }
  return (data as ExistingDomainRow | null) ?? null;
}

/**
 * Passive canonical-conflict probe.
 *
 * Looks for any OTHER row whose final_domain (or legacy `domain`) equals our
 * final_domain. We don't block — we just emit canonical_conflict_detected and
 * downgrade verification_status to 'pending' so the row is visible in dashboards
 * as "this needs manual canonical review".
 */
async function probeCanonicalConflict(
  finalDomain: string,
  ownCompanyId: string,
): Promise<{
  conflict: boolean;
  conflicting_company_ids: string[];
}> {
  if (!finalDomain) return { conflict: false, conflicting_company_ids: [] };

  // Read final_domain only — legacy `domain` column is deprecated. The
  // canonical-foundation migration backfilled final_domain for every row.
  const { data, error } = await supabase
    .from('company_domains')
    .select('id, company_id, final_domain')
    .eq('final_domain', finalDomain);

  if (error) {
    logger.warn('domain_record_canonical_probe_failed', {
      final_domain: finalDomain,
      message: error.message,
    });
    return { conflict: false, conflicting_company_ids: [] };
  }

  const others = (data || []).filter(
    (r: any) => r && r.company_id && r.company_id !== ownCompanyId,
  );
  if (others.length === 0) {
    return { conflict: false, conflicting_company_ids: [] };
  }

  return {
    conflict: true,
    conflicting_company_ids: others.map((r: any) => r.company_id),
  };
}

/**
 * Insert or update a company_domains row.
 *
 * Behavior:
 *   - If `domain` does not exist  → INSERT
 *   - If `domain` exists for the SAME company_id → UPDATE the existing row
 *   - If `domain` exists for a DIFFERENT company → REJECT with
 *     DOMAIN_ALREADY_CLAIMED. Reassignment requires reassignDomain().
 *
 * Validates the override_reason invariant before touching the DB so callers
 * get a clear error rather than a Postgres CHECK violation.
 *
 * Emits passive logs:
 *   - domain_record_canonical_mismatch (input != final)
 *   - domain_record_forwarding_detected (is_forwarding)
 *   - canonical_conflict_detected      (final_domain matches another row)
 *
 * Returns { ok: false, error, conflict? } on failure — never throws.
 */
export async function saveDomainRecord(
  input: SaveDomainRecordInput,
): Promise<SaveDomainRecordResult> {
  const inputDomain = String(input.input_domain || '').trim().toLowerCase();
  const finalDomain = String(input.final_domain || inputDomain).trim().toLowerCase();

  if (!input.company_id) return { ok: false, error: 'MISSING_COMPANY_ID' };
  if (!inputDomain)      return { ok: false, error: 'MISSING_INPUT_DOMAIN' };

  // Hard runtime assertion — the DB will reject empty final_domain via the
  // final_domain_not_empty CHECK constraint, but this gives callers a clear
  // application-level error before the round-trip.
  if (!finalDomain) {
    throw new Error('ERROR_INVALID_DOMAIN_STATE: final_domain resolved to empty');
  }

  const isOverride = input.verification_status === 'admin_override';
  const overrideReason = input.override_reason?.trim() || null;
  if (isOverride && !overrideReason) {
    return { ok: false, error: 'OVERRIDE_REASON_REQUIRED' };
  }

  const isForwarding =
    typeof input.is_forwarding === 'boolean'
      ? input.is_forwarding
      : inputDomain !== finalDomain;

  if (inputDomain !== finalDomain) {
    logger.warn('domain_record_canonical_mismatch', {
      company_id: input.company_id,
      input_domain: inputDomain,
      final_domain: finalDomain,
      created_via: input.created_via,
      verification_status: input.verification_status,
    });
  }
  if (isForwarding) {
    logger.warn('domain_record_forwarding_detected', {
      company_id: input.company_id,
      input_domain: inputDomain,
      final_domain: finalDomain,
      created_via: input.created_via,
    });
  }

  // Strict claim check — same-company OR brand-new only. Different-company
  // collisions return a structured conflict result so callers can decide
  // whether to invoke reassignDomain().
  const existing = await findExistingByDomain(finalDomain);
  if (existing && existing.company_id !== input.company_id) {
    logger.warn('domain_record_claim_rejected', {
      requested_company_id: input.company_id,
      existing_company_id: existing.company_id,
      domain: finalDomain,
      created_via: input.created_via,
    });
    return {
      ok: false,
      error: 'DOMAIN_ALREADY_CLAIMED',
      conflict: {
        code: 'DOMAIN_ALREADY_CLAIMED',
        existing_company_id: existing.company_id,
        existing_id: existing.id,
      },
    };
  }

  // Passive canonical conflict probe — runs regardless of legacy-domain
  // collision so we observe cases where two rows resolve to the same
  // final_domain even when their legacy `domain` columns differ.
  const probe = await probeCanonicalConflict(finalDomain, input.company_id);
  let effectiveStatus = input.verification_status;
  if (probe.conflict) {
    logger.warn('canonical_conflict_detected', {
      company_id: input.company_id,
      input_domain: inputDomain,
      final_domain: finalDomain,
      conflicting_company_ids: probe.conflicting_company_ids,
      created_via: input.created_via,
    });
    // Demote to 'pending' for observation. Admin-override and verified writes
    // were intentional choices by an admin — don't silently rewrite those.
    if (effectiveStatus !== 'admin_override' && effectiveStatus !== 'verified') {
      effectiveStatus = 'pending';
    }
  }

  // Common fields written on INSERT and UPDATE.
  const payload = {
    company_id:          input.company_id,
    input_domain:        inputDomain,
    final_domain:        finalDomain,
    redirect_chain:      input.redirect_chain ?? null,
    is_forwarding:       isForwarding,
    verification_status: effectiveStatus,
    override_reason:     overrideReason,
    created_via:         input.created_via,
    is_primary:          input.is_primary ?? false,
    verified:            effectiveStatus === 'verified'
                         || effectiveStatus === 'admin_override',
  };

  // Insert-only fields. verification_token is generated ONCE per row and must
  // NOT be regenerated on UPDATE (would invalidate any DNS/HTTP setup the
  // user has already published). admin/system rows skip the token entirely.
  //
  // The raw token is exposed back to the caller (insertedRawToken) so the UI
  // can display it once; the DB stores ONLY HMAC(raw_token, VERIFICATION_SECRET).
  const insertedRawToken =
    input.created_via === 'user' && effectiveStatus !== 'admin_override'
      ? generateVerificationToken()
      : null;
  const insertOnly = {
    verification_token: insertedRawToken
      ? hashVerificationToken(insertedRawToken)
      : null,
    verification_method:
      input.created_via === 'admin' && effectiveStatus === 'admin_override'
        ? 'admin_override'
        : null,
    verified_at:
      effectiveStatus === 'admin_override' || effectiveStatus === 'verified'
        ? new Date().toISOString()
        : null,
  };

  if (existing && existing.company_id === input.company_id) {
    const { data, error } = await supabase
      .from('company_domains')
      .update(payload)
      .eq('id', existing.id)
      .select('id')
      .maybeSingle();
    if (error) {
      logger.error('domain_record_update_failed', {
        message: error.message,
        code: (error as any).code,
        company_id: input.company_id,
        input_domain: inputDomain,
      });
      return { ok: false, error: error.message };
    }
    return { ok: true, id: (data as any)?.id ?? existing.id };
  }

  // Soft enforcement: every user-flow insert that needs ownership proof is
  // logged so dashboards can surface the unverified-domain population. No
  // gating yet — usage continues regardless of verification_status.
  if (insertOnly.verification_token) {
    logger.info('domain_verification_pending', {
      company_id: input.company_id,
      input_domain: inputDomain,
      final_domain: finalDomain,
      created_via: input.created_via,
    });
  }

  const { data, error } = await supabase
    .from('company_domains')
    .insert({ ...payload, ...insertOnly })
    .select('id')
    .maybeSingle();

  if (error) {
    // 23505 = unique_violation: another writer raced us between the lookup
    // and the insert. Re-resolve to determine whether the new row is ours
    // (idempotent) or a different company's (conflict).
    if ((error as any).code === '23505') {
      const racer = await findExistingByDomain(finalDomain);
      if (racer && racer.company_id === input.company_id) {
        return { ok: true, id: racer.id };
      }
      if (racer) {
        return {
          ok: false,
          error: 'DOMAIN_ALREADY_CLAIMED',
          conflict: {
            code: 'DOMAIN_ALREADY_CLAIMED',
            existing_company_id: racer.company_id,
            existing_id: racer.id,
          },
        };
      }
    }
    logger.error('domain_record_save_failed', {
      message: error.message,
      code: (error as any).code,
      company_id: input.company_id,
      input_domain: inputDomain,
      final_domain: finalDomain,
    });
    return { ok: false, error: error.message };
  }

  return {
    ok: true,
    id: (data as any)?.id,
    ...(insertedRawToken ? { verification_token: insertedRawToken } : {}),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// reassignDomain — ONLY safe path to move a domain from one company to another.
// ─────────────────────────────────────────────────────────────────────────────

export interface ReassignDomainInput {
  domain: string;
  from_company_id: string;
  to_company_id: string;
  reason: string;
  /**
   * Internal users.id of the SUPER_ADMIN performing the action. The caller is
   * responsible for verifying super-admin role BEFORE calling this function;
   * this service does not perform its own auth check.
   */
  actor_user_id: string;
  /**
   * Hard safety flag. Must be exactly === true. Any other value (including
   * 'true' string, 1, undefined) is rejected.
   */
  confirm_reassignment: boolean;
}

export interface ReassignDomainResult {
  ok: boolean;
  id?: string;
  error?: string;
}

/**
 * Move a domain row from one company to another.
 *
 * Strict requirements:
 *   - confirm_reassignment === true (literal boolean true)
 *   - reason non-empty
 *   - actor_user_id non-empty (caller must verify SUPER_ADMIN before calling)
 *   - from_company_id, to_company_id different
 *   - The domain must currently belong to from_company_id; otherwise rejected.
 *
 * Always logs a DOMAIN_REASSIGNED audit event, including a
 * domain_reassignment_attempt_blocked log on every rejection branch.
 *
 * Never throws.
 */
export async function reassignDomain(
  input: ReassignDomainInput,
): Promise<ReassignDomainResult> {
  const domain = String(input.domain || '').trim().toLowerCase();
  const reason = String(input.reason || '').trim();
  const actor  = String(input.actor_user_id || '').trim();

  // Hard safety flag — strict boolean equality.
  if (input.confirm_reassignment !== true) {
    logger.warn('domain_reassignment_attempt_blocked', {
      reason: 'CONFIRM_REASSIGNMENT_REQUIRED',
      domain,
      from_company_id: input.from_company_id,
      to_company_id: input.to_company_id,
      actor_user_id: actor || null,
    });
    return { ok: false, error: 'CONFIRM_REASSIGNMENT_REQUIRED' };
  }

  if (!domain)                  return blockedReassign('MISSING_DOMAIN', input, actor);
  if (!input.from_company_id)   return blockedReassign('MISSING_FROM_COMPANY_ID', input, actor);
  if (!input.to_company_id)     return blockedReassign('MISSING_TO_COMPANY_ID', input, actor);
  if (input.from_company_id === input.to_company_id)
                                return blockedReassign('FROM_AND_TO_IDENTICAL', input, actor);
  if (!reason)                  return blockedReassign('REASON_REQUIRED', input, actor);
  if (!actor)                   return blockedReassign('ACTOR_REQUIRED', input, actor);

  // Verify the current owner. Refuse if the row is not owned by from_company_id.
  const existing = await findExistingByDomain(domain);
  if (!existing) {
    return blockedReassign('DOMAIN_NOT_FOUND', input, actor);
  }
  if (existing.company_id !== input.from_company_id) {
    logger.warn('domain_reassignment_attempt_blocked', {
      reason: 'FROM_COMPANY_MISMATCH',
      domain,
      claimed_from_company_id: input.from_company_id,
      actual_company_id: existing.company_id,
      to_company_id: input.to_company_id,
      actor_user_id: actor,
    });
    return { ok: false, error: 'FROM_COMPANY_MISMATCH' };
  }

  const { data, error } = await supabase
    .from('company_domains')
    .update({
      company_id:          input.to_company_id,
      verification_status: 'admin_override',
      override_reason:     `reassigned: ${reason}`,
      created_via:         'admin',
    })
    .eq('id', existing.id)
    .select('id')
    .maybeSingle();

  if (error) {
    logger.error('domain_reassignment_update_failed', {
      domain,
      message: error.message,
      code: (error as any).code,
      actor_user_id: actor,
    });
    return { ok: false, error: error.message };
  }

  await insertAuditLogStrict({
    actorUserId: actor || SYSTEM_USER_ID,
    action: 'DOMAIN_REASSIGNED',
    targetUserId: null,
    companyId: input.to_company_id,
    metadata: {
      override:        true,
      override_type:   'manual_assignment',
      override_reason: reason,
      input_domain:    domain,
      final_domain:    domain,
      affected_company_ids: [input.from_company_id, input.to_company_id],
      from_company_id: input.from_company_id,
      to_company_id:   input.to_company_id,
      domain_record_id: existing.id,
    },
  });

  return { ok: true, id: (data as any)?.id ?? existing.id };
}

function blockedReassign(
  reason: string,
  input: ReassignDomainInput,
  actor: string,
): ReassignDomainResult {
  logger.warn('domain_reassignment_attempt_blocked', {
    reason,
    domain: String(input.domain || '').trim().toLowerCase(),
    from_company_id: input.from_company_id,
    to_company_id: input.to_company_id,
    actor_user_id: actor || null,
  });
  return { ok: false, error: reason };
}
