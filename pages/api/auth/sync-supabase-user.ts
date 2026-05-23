
/**
 * POST /api/auth/sync-supabase-user
 *
 * Called by /auth/callback immediately after Supabase OAuth / email auth.
 * Upserts the user's identity into public.users and sets supabase_uid.
 *
 * Auth: Supabase access token in Authorization: Bearer <token>
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { randomUUID } from 'crypto';
import { supabase } from '../../../backend/db/supabaseClient';
import { validateWorkEmail } from '../../../lib/auth/serverValidation';
import { extractAccessToken, validateAuthToken } from '../../../backend/services/authResolver';
import { logAuthEvent } from '../../../lib/auth/auditLog';
import { recordAnomalyEvent } from '../../../lib/auth/anomalyDetector';
import { logger } from '../../../backend/services/logger';
import { seedRequestContextFromRequest } from '../../../backend/services/requestContext';
import { extractDomain, isFreeEmailDomain } from '../../../backend/services/companyMatchService';
import { grantInitialFreeCredit } from '../../../backend/services/initialFreeCreditService';
import {
  sendCompanyAdminReferral,
  sendInboundSignupNoticeToAdmin,
} from '../../../backend/services/emailService';
import { resolveDomain } from '../../../backend/services/domainCanonicalService';
import { ensureSessionForUser } from '../../../backend/security/SessionAuthorityService';
import { logSecurityEvent } from '../../../backend/security/audit/SecurityAuditService';
import { saveDomainRecord } from '../../../backend/services/domainRecordService';
import { checkRateLimit, DOMAIN_RESOLUTION_LIMIT } from '../../../lib/auth/rateLimit';
import { logDomainUnverifiedUsageForCompany } from '../../../backend/services/domainVerificationService';
import { logDomainEvent } from '../../../backend/services/domainEventLogger';
import { issueMfaIntent, userHasVerifiedMfaFactor } from '../../../backend/security/MfaIntent';
import { SELF_REGISTERED_JOIN_SOURCE } from '../../../backend/services/companyMembershipIntegrityService';
import { sendAuthError } from '../../../backend/services/sendAuthError';
import { AUTH_ERROR_CODE } from '../../../shared/contracts/security/AuthErrorCodes';
import { incrementAuthMetric } from '../../../backend/services/authMetrics';

type BootstrapRejection = {
  code:
    | 'DOMAIN_NOT_CANONICAL'
    | 'DOMAIN_FORWARDING_NOT_ALLOWED'
    | 'DOMAIN_ALREADY_REGISTERED'
    | 'DOMAIN_RESOLUTION_FAILED';
  status: number;
  details: string;
  final_domain?: string;
  conflicting_company_id?: string;
};
type DomainVerificationCarryOut = {
  required: true;
  final_domain: string;
  token: string;
  methods: ['dns', 'http'];
};
type BootstrapResult =
  | { ok: true; domain_verification?: DomainVerificationCarryOut }
  | { ok: false; rejection: BootstrapRejection };

const SUPPORT_EMAIL = 'support@omnivyra.com';

type SuccessResponse = {
  ok: true;
  domain_verification?: {
    required: true;
    final_domain: string;
    token: string;
    methods: ['dns', 'http'];
  };
  /**
   * Set when the user has at least one verified MFA factor enrolled.
   * The auth_session is NOT minted in this branch — the client must
   * complete the MFA challenge via /api/auth/mfa-verify before any
   * authenticated request will succeed. The mfa_intent cookie carries
   * the bridge state and is consumed by mfa-verify.
   */
  mfa_required?: true;
  factors?: ReadonlyArray<'totp' | 'webauthn'>;
};
type ErrorResponse   = {
  error: string;
  code?: string;
  details?: string;
  final_domain?: string;
  conflicting_company_id?: string;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SuccessResponse | ErrorResponse>,
) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  seedRequestContextFromRequest(req);

  // ── 1. Verify Supabase token (Bearer header OR Supabase auth cookie) ─────
  // Accepts both transports so the route works for password sign-in (Bearer)
  // and cookie-only paths (page refresh, SSR). public.users is NOT required
  // here — this endpoint is what CREATES that row, so we validate the auth
  // identity only (auth.users.id + email).
  let supabaseUid: string;
  let email: string;
  const token = extractAccessToken(req);
  if (!token) {
    sendAuthError(res, AUTH_ERROR_CODE.INVALID_SESSION);
    return;
  }
  const identity = await validateAuthToken(token);
  if (!identity || !identity.email) {
    sendAuthError(res, AUTH_ERROR_CODE.INVALID_SESSION);
    return;
  }
  supabaseUid = identity.supabaseUid;
  email       = identity.email;
  seedRequestContextFromRequest(req, { userId: supabaseUid });

  // Extract client IP once — used to rate-limit domain canonical resolution.
  const clientIp = String(
    req.headers['x-forwarded-for']
    ?? (req.socket as any)?.remoteAddress
    ?? 'unknown',
  ).split(',')[0].trim();
  const requestUserAgent = (req.headers['user-agent'] as string | undefined) ?? null;
  const requestIp = clientIp && clientIp !== 'unknown' ? clientIp : null;

  // Mint or touch the canonical auth_session for the synced user. Fail-soft:
  // if SESSION_COOKIE_SECRET is missing or the migration hasn't been applied
  // yet, the existing Bearer-token flow continues to work without a cookie.
  const projectSession = async (userId: string): Promise<void> => {
    const result = await ensureSessionForUser(req, res, {
      userId,
      supabaseUid,
      ip: requestIp,
      userAgent: requestUserAgent,
    });
    if (result.minted && result.sessionId) {
      void logSecurityEvent({
        capability: 'mfa.view_factors',
        decision: 'auth_session_created',
        actorUserId: userId,
        actorSessionId: result.sessionId,
        principalUserId: userId,
        principalSupabaseUid: supabaseUid,
        reason: 'sync-supabase-user',
        ip: requestIp,
        userAgent: requestUserAgent,
      });
    }
  };

  // Single MFA gate: for any user with a verified TOTP / WebAuthn factor,
  // we MUST NOT mint an auth_session here. Instead we issue a short-lived,
  // HMAC-signed intent cookie and the caller (frontend) routes to
  // /auth/mfa, completes the challenge, and exchanges the intent for a
  // session via /api/auth/mfa-verify.
  //
  // Returns true when the caller should short-circuit with mfa_required.
  const gateOnMfa = async (
    userId: string,
  ): Promise<{ required: false } | { required: true; factors: ReadonlyArray<'totp' | 'webauthn'> }> => {
    let state: Awaited<ReturnType<typeof userHasVerifiedMfaFactor>>;
    try {
      state = await userHasVerifiedMfaFactor(userId);
    } catch (err) {
      // Fail-CLOSED on the MFA-detection path — if we can't determine
      // whether MFA is enrolled, we must NOT mint a session and let an
      // attacker who suppressed the read bypass MFA. Surface as 503 so
      // the client retries.
      logger.error('auth_sync_mfa_detection_failed', {
        userId,
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
    if (!state.hasMfa) return { required: false };
    issueMfaIntent(res, {
      userId,
      supabaseUid,
      email: normalizedEmail,
    });
    void logSecurityEvent({
      capability: 'mfa.view_factors',
      decision: 'mfa_login_challenge_issued',
      actorUserId: userId,
      principalUserId: userId,
      principalSupabaseUid: supabaseUid,
      reason: 'sync-supabase-user',
      ip: requestIp,
      userAgent: requestUserAgent,
    });
    const factors: Array<'totp' | 'webauthn'> = [];
    if (state.totpVerified) factors.push('totp');
    if (state.webauthnCount > 0) factors.push('webauthn');
    return { required: true, factors };
  };

  // ── 2. Work-email validation (skip for invited users — they may use any domain) ──
  // Don't block social logins with personal emails if they were explicitly invited.
  const isWorkEmail = (() => {
    try { validateWorkEmail(email); return true; } catch { return false; }
  })();

  // ── 3. Block soft-deleted accounts ───────────────────────────────────────
  const normalizedEmail = email.toLowerCase().trim();
  const { data: existingByUid } = await supabase
    .from('users')
    .select('id, is_deleted')
    .eq('supabase_uid', supabaseUid)
    .maybeSingle();

  if (existingByUid && (existingByUid as any).is_deleted) {
    recordAnomalyEvent('ghost_session_detected');
    void logAuthEvent('ghost_session_detected', {
      userId:     (existingByUid as any).id,
      metadata:   { reason: 'user_is_soft_deleted', endpoint: 'sync-supabase-user' },
    });
    sendAuthError(res, AUTH_ERROR_CODE.ACCOUNT_DELETED);
    return;
  }

  if (!existingByUid) {
    const { data: existingByEmail } = await supabase
      .from('users')
      .select('id, is_deleted')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (existingByEmail && (existingByEmail as any).is_deleted) {
      recordAnomalyEvent('ghost_session_detected');
      void logAuthEvent('ghost_session_detected', {
        userId:   (existingByEmail as any).id,
        metadata: { reason: 'email_is_soft_deleted', endpoint: 'sync-supabase-user' },
      });
      sendAuthError(res, AUTH_ERROR_CODE.ACCOUNT_DELETED);
      return;
    }
  }

  const now = new Date().toISOString();

  // Whether this Supabase auth user has a password set. True for password
  // signup (`supabase.auth.signUp`) and for anyone who has gone through
  // `/auth/set-password`. False for magic-link-only users.
  //
  // Fail-open to `false`: a missing function or transient RPC error must not
  // block account creation — an invited / magic-link user should still have
  // their public.users row synced, just with has_password=false.
  let hasPassword = false;
  try {
    const { data, error: rpcErr } = await supabase.rpc('auth_user_has_password', {
      p_user_id: supabaseUid,
    });
    if (rpcErr) {
      logger.warn('auth_sync_has_password_rpc_failed', {
        supabaseUid,
        message: rpcErr.message,
      });
    } else {
      hasPassword = data === true;
    }
  } catch (err) {
    logger.warn('auth_sync_has_password_rpc_threw', {
      supabaseUid,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // ── 4. Upsert by supabase_uid ────────────────────────────────────────────
  // First try: existing row already has supabase_uid (returning user)
  if (existingByUid) {
    const existingUserId = (existingByUid as { id: string }).id;
    await supabase
      .from('users')
      .update({ is_email_verified: true, last_sign_in_at: now, has_password: hasPassword })
      .eq('supabase_uid', supabaseUid);
    // Lifecycle transition: a status='invited' row that successfully completes
    // Supabase auth has, by definition, "completed first authenticated session"
    // (migration 20260638's stated trigger). Atomically flip to 'active' and
    // stamp activated_at — both predicated on status='invited' in the WHERE
    // clause, so:
    //   * the flip is idempotent across repeat logins (second call matches 0
    //     rows once the first completes),
    //   * activated_at is written exactly once per user,
    //   * 'suspended' and 'deleted' rows are never touched.
    // Wrapped in tryFlipInvitedToActive so a missing column on legacy schemas
    // (e.g. before 20260641) gracefully degrades — never 500s the sync.
    await tryFlipInvitedToActive({
      filterColumn: 'supabase_uid',
      filterValue:  supabaseUid,
      userId:       existingUserId,
    });
    // Best-effort credit-bookkeeping reconciliation. grantInitialFreeCredit
    // self-heals: if the wallet already has the grant but the claim or stamp
    // is missing, it repairs them without re-granting. If the org already
    // has a clean claim row, it returns 'already_claimed' as a no-op.
    void reconcileInitialFreeCreditForUser(existingUserId, normalizedEmail);
    const gate = await gateOnMfa(existingUserId);
    if (gate.required) {
      return res.status(200).json({ ok: true, mfa_required: true, factors: gate.factors });
    }
    await projectSession(existingUserId);
    return res.status(200).json({ ok: true });
  }

  // Second try: row exists by email (invited user or Firebase-migrated user) —
  // stamp supabase_uid on it so future lookups use the faster UID path.
  const { data: byEmail } = await supabase
    .from('users')
    .select('id, supabase_uid, active_company_id')
    .eq('email', normalizedEmail)
    .maybeSingle();

  if (byEmail) {
    // Restore active_company_id from existing role if missing (stateful login)
    const updatePayload: Record<string, unknown> = {
      supabase_uid:      supabaseUid,
      is_email_verified: true,
      last_sign_in_at:   now,
      has_password:      hasPassword,
    };
    if (!(byEmail as any).active_company_id) {
      const { data: roleRow } = await supabase
        .from('user_company_roles')
        .select('company_id')
        .eq('user_id', (byEmail as any).id)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();
      if (roleRow) updatePayload.active_company_id = (roleRow as any).company_id;
    }
    await supabase.from('users').update(updatePayload).eq('id', (byEmail as any).id);
    const existingUserIdByEmail = (byEmail as { id: string }).id;
    // Lifecycle transition — see by-uid branch above for rationale.
    await tryFlipInvitedToActive({
      filterColumn: 'id',
      filterValue:  existingUserIdByEmail,
      userId:       existingUserIdByEmail,
    });
    // Same reconciliation as the by-uid branch: heal any drift between the
    // wallet, claim row, and company stamp on every login. Best-effort.
    void reconcileInitialFreeCreditForUser(existingUserIdByEmail, normalizedEmail);
    const gateEmail = await gateOnMfa(existingUserIdByEmail);
    if (gateEmail.required) {
      return res.status(200).json({ ok: true, mfa_required: true, factors: gateEmail.factors });
    }
    await projectSession(existingUserIdByEmail);
    return res.status(200).json({ ok: true });
  }

  // Third: brand-new user — INSERT with id returned in the same round-trip.
  // Pre-Phase-2.B-G this issued INSERT + a separate SELECT to read back the
  // id; the round-trip is now collapsed. If supabase-js returns no row
  // (extremely rare; would indicate a server-side INSERT-without-RETURNING
  // bug), we fall back to the by-uid lookup so projectSession can still mint
  // the canonical auth_session.
  const { data: inserted, error: insertError } = await supabase
    .from('users')
    .insert({
      supabase_uid:      supabaseUid,
      email:             normalizedEmail,
      is_email_verified: true,
      last_sign_in_at:   now,
      has_password:      hasPassword,
    })
    .select('id')
    .maybeSingle();

  if (insertError) {
    logger.error('auth_sync_insert_failed', { email: normalizedEmail, message: insertError.message });
    sendAuthError(res, AUTH_ERROR_CODE.PROFILE_LOAD_FAILED, {
      errorOverride: 'Failed to sync user to database',
    });
    return;
  }

  let freshlyInsertedUserId: string | null = (inserted as { id?: string } | null)?.id ?? null;

  if (!freshlyInsertedUserId) {
    // INSERT succeeded but returned no row — defensive fallback to a single
    // by-uid read. Should never fire in practice.
    try {
      const { data: insertedUser } = await supabase
        .from('users')
        .select('id')
        .eq('supabase_uid', supabaseUid)
        .maybeSingle();
      if (insertedUser) freshlyInsertedUserId = (insertedUser as { id: string }).id;
    } catch (err) {
      logger.warn('auth_sync_post_insert_lookup_failed', {
        email: normalizedEmail,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (freshlyInsertedUserId) {
    await projectSession(freshlyInsertedUserId);
  }
  return res.status(200).json({ ok: true });
}

/**
 * Atomic, idempotent invited → active lifecycle transition.
 *
 * Issues `UPDATE users SET status='active', activated_at=NOW() WHERE
 * <filter> AND status='invited'`. The `status='invited'` predicate is the
 * idempotency guard — once the row flips, subsequent calls match zero rows
 * and the update is a no-op (no overwritten timestamps, no duplicate events).
 *
 * Error-tolerant by design:
 *   - missing `status` column → logged as schema_fallback, sync continues
 *   - missing `activated_at` column → retried without the timestamp so
 *     environments that have 20260638 applied but not 20260641 still
 *     flip the status
 *   - any other DB error → logged but never thrown
 *
 * Returns true when a row was actually flipped (for telemetry / tests).
 *
 * Exported for test coverage — the production call sites above are the
 * only non-test consumers.
 */
export async function tryFlipInvitedToActive(input: {
  filterColumn: 'supabase_uid' | 'id';
  filterValue:  string;
  userId:       string;
}): Promise<boolean> {
  const baseFilter = supabase
    .from('users')
    .update({ status: 'active', activated_at: new Date().toISOString() })
    .eq(input.filterColumn, input.filterValue)
    .eq('status', 'invited')
    .select('id');

  try {
    const { data, error } = await baseFilter;
    if (!error) {
      const flipped = Array.isArray(data) && data.length > 0;
      if (flipped) {
        logger.info('invited_user_activated', {
          userId: input.userId,
          mode:   'with_activated_at',
        });
        incrementAuthMetric('auth.lifecycle.invited_to_active', { mode: 'with_activated_at' });
      } else {
        incrementAuthMetric('auth.lifecycle.invited_flip_noop', {});
      }
      return flipped;
    }

    const msg = (error.message ?? '').toLowerCase();
    const missingActivatedAt = msg.includes("could not find the 'activated_at' column");
    const missingStatus = msg.includes("could not find the 'status' column");

    if (missingStatus) {
      logger.warn('auth_schema_fallback', {
        area: 'auth',
        type: 'schema_fallback',
        resolver: 'auth_sync.invited_to_active',
        missingColumns: ['status'],
        rawMessage: error.message,
      });
      return false;
    }

    if (missingActivatedAt) {
      logger.warn('auth_schema_fallback', {
        area: 'auth',
        type: 'schema_fallback',
        resolver: 'auth_sync.invited_to_active',
        missingColumns: ['activated_at'],
        rawMessage: error.message,
      });
      const retry = await supabase
        .from('users')
        .update({ status: 'active' })
        .eq(input.filterColumn, input.filterValue)
        .eq('status', 'invited')
        .select('id');
      if (retry.error) {
        logger.warn('auth_sync_status_flip_failed', {
          userId:  input.userId,
          message: retry.error.message,
        });
        incrementAuthMetric('auth.lifecycle.invited_flip_failed', { reason: 'retry_failed' });
        return false;
      }
      const retryFlipped = Array.isArray(retry.data) && retry.data.length > 0;
      if (retryFlipped) {
        logger.info('invited_user_activated', {
          userId: input.userId,
          mode:   'status_only',
        });
        incrementAuthMetric('auth.lifecycle.invited_to_active', { mode: 'status_only' });
      } else {
        incrementAuthMetric('auth.lifecycle.invited_flip_noop', {});
      }
      return retryFlipped;
    }

    logger.warn('auth_sync_status_flip_failed', {
      userId:  input.userId,
      message: error.message,
    });
    return false;
  } catch (err) {
    logger.warn('auth_sync_status_flip_threw', {
      userId:  input.userId,
      message: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Best-effort reconcile of the initial free-credit bookkeeping for an
 * existing user logging in. Resolves the user's active company from
 * user_company_roles (status='active') and re-invokes grantInitialFreeCredit,
 * which self-heals any drift between:
 *   1. credit_transactions ledger row
 *   2. organization_credits wallet balances
 *   3. free_credit_claims audit row
 *   4. companies.free_credit_granted_at stamp
 *
 * Call this fire-and-forget from any login path — it never throws and never
 * blocks the response. If the user has no active company role yet (e.g.
 * fresh signup before bootstrap), it's a no-op.
 */
async function reconcileInitialFreeCreditForUser(
  userId: string,
  email: string,
): Promise<void> {
  try {
    const { data: roleRow } = await supabase
      .from('user_company_roles')
      .select('company_id')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const companyId = (roleRow as { company_id?: string } | null)?.company_id;
    if (!companyId) return;

    const emailDomain = extractDomain(email) ?? null;
    await grantInitialFreeCredit({
      orgId:       companyId,
      userId,
      emailDomain,
    });
  } catch (err) {
    logger.warn('auth_sync_credit_reconcile_failed', {
      userId,
      email,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Auto-creates a company + COMPANY_ADMIN role for a self-serve signup the
 * first time their email is verified. The company name comes from the
 * signup_intents row written by /api/auth/signup.
 *
 * Idempotent — if the user already has any active company role, or there
 * is no pending intent with a company name, this is a no-op. Errors are
 * logged but never thrown: failing to bootstrap must not break the
 * sync-supabase-user response, since the user can still complete onboarding
 * manually via /onboarding/company.
 */
async function bootstrapCompanyFromSignupIntent(input: {
  userId: string;
  email: string;
  clientIp?: string;
}): Promise<BootstrapResult> {
  logger.warn('auth_sync_signup_intent_company_bootstrap_disabled', {
    userId: input.userId,
    email: input.email,
  });
  return { ok: true };

  try {
    // Skip if user already has any active role — invited users or
    // returning users already belong to a company.
    const { data: existingRole } = await supabase
      .from('user_company_roles')
      .select('id')
      .eq('user_id', input.userId)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();
    if (existingRole) return { ok: true };

    // Skip if there's a pending invitation for this email — invited users
    // must not be subjected to canonical-domain enforcement (an invited gmail
    // user is legitimate; the inviting admin already vouched for them).
    const { data: pendingInvite } = await supabase
      .from('invitations')
      .select('id')
      .eq('email', input.email)
      .is('accepted_at', null)
      .is('revoked_at', null)
      .limit(1)
      .maybeSingle();
    if (pendingInvite) return { ok: true };

    // Pull the company name from the signup_intents row that was written
    // by /api/auth/signup before the email was sent.
    const { data: intentRow } = await supabase
      .from('signup_intents')
      .select('id, intent_data')
      .eq('email', input.email)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const intentData = (intentRow as { intent_data?: Record<string, unknown> } | null)?.intent_data ?? null;
    const rawCompanyName = intentData ? String((intentData as Record<string, unknown>).company_name ?? '').trim() : '';
    if (!rawCompanyName) return { ok: true };

    // Skip free-email domains for self-create — those users must join an
    // existing org via invite (matches setup-company's existing rule).
    const emailDomain = extractDomain(input.email) ?? '';
    if (!emailDomain || isFreeEmailDomain(emailDomain)) return { ok: true };

    // If a company already owns this email domain, the verified user
    // CANNOT auto-create a duplicate company and is NOT attached as
    // COMPANY_ADMIN. Instead we email both parties — the user gets the
    // existing admin's contact details, and the admin is notified that a
    // new verified person from their domain tried to sign up. The user
    // can then be invited normally (or use /onboarding/company's request-
    // access path).
    const { data: existingCompany } = await supabase
      .from('companies')
      .select('id, name')
      .eq('admin_email_domain', emailDomain)
      .maybeSingle();

    const now = new Date().toISOString();

    if (existingCompany) {
      const claimedCompanyId = (existingCompany as { id: string; name?: string | null }).id;
      const claimedCompanyName = (existingCompany as { name?: string | null }).name ?? rawCompanyName;
      await notifyAdminAndProspectOfClaimedDomain({
        prospectUserId: input.userId,
        prospectEmail: input.email,
        emailDomain,
        companyId: claimedCompanyId,
        companyName: claimedCompanyName,
        nowIso: now,
      });
      // Skip company / role creation. The user has no user_company_roles
      // membership — verify-email and post-login-route will route them
      // through onboarding so they can request access to the existing
      // company once the admin invites them.
      return { ok: true };
    }

    // ── Canonical-domain enforcement (USER flow only) ─────────────────────
    // resolveDomain follows HTTP redirects to determine the canonical host.
    // We reject when:
    //   - input_domain != final_domain  → DOMAIN_NOT_CANONICAL
    //   - is_forwarding === true        → DOMAIN_FORWARDING_NOT_ALLOWED
    //   - final_domain already maps to another company → DOMAIN_ALREADY_REGISTERED
    //   - resolveDomain reports resolution_failed/blocked → DOMAIN_RESOLUTION_FAILED
    // SUPER_ADMIN flow uses pages/api/super-admin/users.ts and is NOT affected.

    // Rate-limit per client IP — caps the SSRF probing surface AND the
    // outbound HTTP cost a single IP can incur.
    if (input.clientIp) {
      const rl = await checkRateLimit(input.clientIp, DOMAIN_RESOLUTION_LIMIT);
      if (!rl.allowed) {
        logger.warn('domain_resolution_rate_limited', {
          email: input.email,
          ip: input.clientIp,
        });
        return {
          ok: false,
          rejection: {
            code: 'DOMAIN_RESOLUTION_FAILED',
            status: 429,
            details: 'Too many domain verification attempts. Please try again later.',
          },
        };
      }
    }

    let resolution;
    try {
      resolution = await resolveDomain(emailDomain);
    } catch (err) {
      // resolveDomain shouldn't throw, but defend against future changes.
      // Treat any throw as fail-closed: surface DOMAIN_RESOLUTION_FAILED.
      logger.warn('auth_sync_resolve_domain_threw', {
        email: input.email,
        emailDomain,
        message: err instanceof Error ? err.message : String(err),
      });
      void logDomainEvent({
        event_type:   'DOMAIN_RESOLUTION_FAILED',
        company_id:   null,
        final_domain: emailDomain,
        user_id:      input.userId,
        metadata:     { reason: 'threw', message: err instanceof Error ? err.message : String(err) },
      });
      return {
        ok: false,
        rejection: {
          code: 'DOMAIN_RESOLUTION_FAILED',
          status: 503,
          details: 'Unable to verify domain. Please try again.',
        },
      };
    }

    // Fail-closed: any DNS / timeout / fetch error surfaces as a hard reject.
    if (resolution.resolution_failed) {
      logger.warn('auth_sync_resolution_failed_rejected', {
        email: input.email,
        emailDomain,
      });
      void logDomainEvent({
        event_type:   'DOMAIN_RESOLUTION_FAILED',
        company_id:   null,
        final_domain: emailDomain,
        user_id:      input.userId,
        metadata:     { reason: 'fail_closed' },
      });
      return {
        ok: false,
        rejection: {
          code: 'DOMAIN_RESOLUTION_FAILED',
          status: 503,
          details: 'Unable to verify domain. Please try again.',
        },
      };
    }

    // SSRF gate tripped — reject as failed so the user can't probe internal hosts.
    if (resolution.resolution_blocked) {
      logger.warn('auth_sync_resolution_blocked_rejected', {
        email: input.email,
        emailDomain,
      });
      void logDomainEvent({
        event_type:   'DOMAIN_RESOLUTION_BLOCKED',
        company_id:   null,
        final_domain: emailDomain,
        user_id:      input.userId,
        metadata:     { reason: 'ssrf_or_rebind' },
      });
      return {
        ok: false,
        rejection: {
          code: 'DOMAIN_RESOLUTION_FAILED',
          status: 503,
          details: 'Unable to verify domain. Please try again.',
        },
      };
    }

    if (resolution.input_domain !== resolution.final_domain) {
      logger.warn('auth_sync_canonical_rejected', {
        email: input.email,
        input_domain: resolution.input_domain,
        final_domain: resolution.final_domain,
        is_forwarding: resolution.is_forwarding,
      });
      void logDomainEvent({
        event_type:   'DOMAIN_NOT_CANONICAL',
        company_id:   null, // no company exists yet at the canonical-reject point
        final_domain: resolution.final_domain,
        user_id:      input.userId,
        metadata:     {
          input_domain:  resolution.input_domain,
          is_forwarding: resolution.is_forwarding,
        },
      });
      return {
        ok: false,
        rejection: {
          code: 'DOMAIN_NOT_CANONICAL',
          status: 400,
          details:
            `This domain forwards to ${resolution.final_domain}. ` +
            `Please register using the primary domain.`,
          final_domain: resolution.final_domain,
        },
      };
    }
    if (resolution.is_forwarding) {
      logger.warn('auth_sync_forwarding_rejected', {
        email: input.email,
        input_domain: resolution.input_domain,
        final_domain: resolution.final_domain,
      });
      void logDomainEvent({
        event_type:   'DOMAIN_FORWARDING_BLOCKED',
        company_id:   null,
        final_domain: resolution.final_domain,
        user_id:      input.userId,
        metadata:     { input_domain: resolution.input_domain },
      });
      return {
        ok: false,
        rejection: {
          code: 'DOMAIN_FORWARDING_NOT_ALLOWED',
          status: 400,
          details:
            'Forwarding-only domains cannot be used to register. ' +
            'Please use the primary corporate domain.',
          final_domain: resolution.final_domain,
        },
      };
    }

    // Duplicate check on the canonical (final) domain. Reads final_domain
    // only — every row has final_domain populated by the canonical-foundation
    // migration backfill, and legacy `domain` is deprecated.
    const { data: canonicalConflictRows } = await supabase
      .from('company_domains')
      .select('id, company_id, final_domain')
      .eq('final_domain', resolution.final_domain);
    if (canonicalConflictRows && canonicalConflictRows.length > 0) {
      const conflict = canonicalConflictRows[0] as any;
      logger.warn('auth_sync_canonical_duplicate_rejected', {
        email: input.email,
        final_domain: resolution.final_domain,
        conflicting_company_id: conflict.company_id,
      });
      void logDomainEvent({
        event_type:   'DOMAIN_ALREADY_REGISTERED',
        company_id:   conflict.company_id,
        final_domain: resolution.final_domain,
        user_id:      input.userId,
        metadata:     { input_domain: resolution.input_domain },
      });
      return {
        ok: false,
        rejection: {
          code: 'DOMAIN_ALREADY_REGISTERED',
          status: 409,
          details:
            `The domain ${resolution.final_domain} is already registered.`,
          final_domain: resolution.final_domain,
          conflicting_company_id: conflict.company_id,
        },
      };
    }

    let companyId = randomUUID();
    const { error: companyErr } = await supabase.from('companies').insert({
      id:                 companyId,
      name:               rawCompanyName,
      website:            null,
      admin_email_domain: emailDomain,
      domain_claimed_at:  now,
      status:             'active',
      created_at:         now,
    });
    if (companyErr) {
      // Race: another concurrent request created this domain — re-read.
      if (companyErr.code === '23505') {
        const { data: raceWinner } = await supabase
          .from('companies')
          .select('id, name')
          .eq('admin_email_domain', emailDomain)
          .maybeSingle();
        if (!raceWinner) {
          logger.warn('auth_sync_bootstrap_company_race_unresolved', { email: input.email, message: companyErr.message });
          return { ok: true };
        }
        // The race winner is now the canonical company — treat this as a
        // claimed-domain branch and email both parties instead of stamping
        // ourselves as admin.
        await notifyAdminAndProspectOfClaimedDomain({
          prospectUserId: input.userId,
          prospectEmail: input.email,
          emailDomain,
          companyId: (raceWinner as { id: string }).id,
          companyName: (raceWinner as { name?: string | null }).name ?? rawCompanyName,
          nowIso: now,
        });
        return { ok: true };
      }
      logger.warn('auth_sync_bootstrap_company_insert_failed', { email: input.email, message: companyErr.message });
      return { ok: true };
    }

    // Persist the canonical domain through the central writer. saveDomainRecord
    // owns: input/final domain split, redirect chain, override-reason
    // invariant, and the canonical-conflict probe. We pass
    // verification_status='pending' (not 'verified') because the email
    // domain's MX has been validated upstream but the company itself has not
    // proven ownership yet.
    const domainSave = await saveDomainRecord({
      company_id:          companyId,
      input_domain:        resolution.input_domain,
      final_domain:        resolution.final_domain,
      redirect_chain:      resolution.redirect_chain,
      is_forwarding:       resolution.is_forwarding,
      verification_status: 'pending',
      created_via:         'user',
      is_primary:          true,
    });
    if (!domainSave.ok) {
      // Non-fatal — the company row exists. The user can still proceed; the
      // domain just isn't canonically tracked yet. A follow-up reconciliation
      // job will retry. We DO log loudly so dashboards surface drift.
      logger.warn('auth_sync_save_domain_record_failed', {
        email: input.email,
        company_id: companyId,
        input_domain: resolution.input_domain,
        final_domain: resolution.final_domain,
        error: domainSave.error,
      });
    }

    // Soft-enforcement signal — log that this newly-bootstrapped company has
    // an unverified domain. Status is always 'pending' at this point (the row
    // we just wrote with verification_status: 'pending').
    void logDomainUnverifiedUsageForCompany({
      company_id: companyId,
      operation:  'auth_sync_company_bootstrap',
      metadata:   { user_id: input.userId, source: SELF_REGISTERED_JOIN_SOURCE },
    });

    // Insert user_company_roles (idempotent on duplicate user/company pair).
    const { error: roleErr } = await supabase.from('user_company_roles').insert({
      user_id:     input.userId,
      company_id:  companyId,
      role:        'COMPANY_ADMIN',
      status:      'active',
      join_source: SELF_REGISTERED_JOIN_SOURCE,
      created_at:  now,
      updated_at:  now,
      accepted_at: now,
    });
    if (roleErr && roleErr.code !== '23505') {
      logger.warn('auth_sync_bootstrap_role_insert_failed', { email: input.email, message: roleErr.message });
      return { ok: true };
    }

    // Stamp the user row so post-login-route routes them past the
    // /onboarding/company step. Profile fields (name etc.) are still
    // collected at /onboarding/profile.
    //
    // Canonical authority: user_company_roles.role (already inserted above)
    // and users.active_company_id. users.role / users.company_id are
    // deprecated and no longer written.
    await supabase
      .from('users')
      .update({
        active_company_id: companyId,
        onboarding_state:  'company_complete',
        updated_at:        now,
      })
      .eq('id', input.userId);

    // Grant the one-time initial free credit (50 by default, configurable
    // via free_credit_config). The shared service is idempotent — if a
    // concurrent call already credited this org the second call is a no-op.
    await grantInitialFreeCredit({
      orgId: companyId,
      userId: input.userId,
      emailDomain,
    });

    // Mark the intent as completed so verify-email's update is a no-op.
    if (intentRow) {
      await supabase
        .from('signup_intents')
        .update({ status: 'completed', completed_at: now })
        .eq('id', (intentRow as { id: string }).id);
    }
    // Surface the raw verification token to the caller IF saveDomainRecord
    // generated one. It's the only chance the server has to expose it — the
    // DB stores HMAC(token), not the raw value.
    if (domainSave.ok && domainSave.verification_token) {
      return {
        ok: true,
        domain_verification: {
          required:     true,
          final_domain: resolution.final_domain,
          token:        domainSave.verification_token,
          methods:      ['dns', 'http'],
        },
      };
    }
    return { ok: true };
  } catch (err) {
    logger.warn('auth_sync_bootstrap_threw', {
      email: input.email,
      message: err instanceof Error ? err.message : String(err),
    });
    return { ok: true };
  }
}

/**
 * Fires when a freshly-verified user's email domain is already claimed by
 * an existing company. We:
 *   1) Email the prospect with the existing admin's contact details so
 *      they know who to ask for access (replaces the old signup-time mail).
 *   2) Email the admin so they know a real, verified person from their
 *      domain just tried to sign up.
 * Both emails are deduped per (prospect, company) via signup_referrals so
 * repeat verifies / bouncing email links don't keep notifying the admin.
 */
async function notifyAdminAndProspectOfClaimedDomain(input: {
  prospectUserId: string;
  prospectEmail: string;
  emailDomain: string;
  companyId: string;
  companyName: string | null;
  nowIso: string;
}): Promise<void> {
  // Find an active COMPANY_ADMIN of the claimed company.
  const { data: adminRoleRow } = await supabase
    .from('user_company_roles')
    .select('user_id, created_at')
    .eq('company_id', input.companyId)
    .eq('status', 'active')
    .eq('role', 'COMPANY_ADMIN')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  const adminUserId = (adminRoleRow as { user_id?: string } | null)?.user_id ?? null;
  const { data: adminUser } = adminUserId
    ? await supabase.from('users').select('name, email').eq('id', adminUserId).maybeSingle()
    : { data: null };
  const adminEmail = (adminUser as { email?: string } | null)?.email ?? null;
  const adminName = (adminUser as { name?: string | null } | null)?.name ?? null;

  // Dedupe via signup_referrals — one row per (prospect email). Tracks
  // separately whether each of the two emails has already gone out.
  const { data: existingReferral } = await supabase
    .from('signup_referrals')
    .select('id, admin_email_sent_at, attempt_count')
    .eq('email', input.prospectEmail)
    .maybeSingle();

  let shouldSendProspectEmail = false;
  let referralId: string | null = (existingReferral as { id?: string } | null)?.id ?? null;

  if (!existingReferral) {
    const { data: inserted, error: insertErr } = await supabase
      .from('signup_referrals')
      .insert({
        email:            input.prospectEmail,
        domain:           input.emailDomain,
        company_id:       input.companyId,
        admin_user_id:    adminUserId,
        first_attempt_at: input.nowIso,
        last_attempt_at:  input.nowIso,
        attempt_count:    1,
      })
      .select('id')
      .maybeSingle();
    if (insertErr) {
      logger.warn('auth_sync_referral_insert_failed', {
        email:   input.prospectEmail,
        message: insertErr.message,
      });
    } else {
      shouldSendProspectEmail = true;
      referralId = (inserted as { id?: string } | null)?.id ?? null;
    }
  } else {
    await supabase
      .from('signup_referrals')
      .update({
        last_attempt_at: input.nowIso,
        attempt_count:   ((existingReferral as { attempt_count?: number }).attempt_count ?? 1) + 1,
      })
      .eq('id', (existingReferral as { id: string }).id);
    shouldSendProspectEmail = !(existingReferral as { admin_email_sent_at?: string | null }).admin_email_sent_at;
  }

  // 1) Prospect email — admin contact details (deduped via admin_email_sent_at).
  if (shouldSendProspectEmail) {
    try {
      await sendCompanyAdminReferral(
        input.prospectEmail,
        {
          admin:        adminEmail ? { name: adminName, email: adminEmail } : null,
          companyName:  input.companyName,
          supportEmail: SUPPORT_EMAIL,
        },
        `company-referral:${input.prospectEmail}`,
      );
      if (referralId) {
        await supabase
          .from('signup_referrals')
          .update({ admin_email_sent_at: input.nowIso })
          .eq('id', referralId);
      }
    } catch (err) {
      logger.warn('auth_sync_prospect_email_send_failed', {
        email:   input.prospectEmail,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 2) Admin notification — best-effort; idempotent via Supabase email
  //    enqueue idempotency key so repeat verifies don't double-send.
  if (adminEmail) {
    try {
      await sendInboundSignupNoticeToAdmin(
        adminEmail,
        {
          prospectEmail: input.prospectEmail,
          companyName:   input.companyName,
          supportEmail:  SUPPORT_EMAIL,
        },
        `inbound-signup-notice:${input.companyId}:${input.prospectEmail}`,
      );
    } catch (err) {
      logger.warn('auth_sync_admin_notice_send_failed', {
        adminEmail,
        prospectEmail: input.prospectEmail,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
