/**
 * POST /api/admin/bootstrap-super-admin
 *
 * Establishes the canonical DB-backed SUPER_ADMIN authority. Three modes:
 *
 *   mode='promote' — an existing SUPER_ADMIN promotes another user.
 *     Body: { mode: 'promote', targetUserId: string, organizationId?: string }
 *     Auth: requireCapability(IDENTITY_ADMIN_ASSIGN) — phishing-resistant
 *           step-up + trusted device.
 *
 *   mode='bootstrap' — first SUPER_ADMIN, self-promote when NONE exists.
 *     Body: { mode: 'bootstrap', bootstrapToken: string, organizationId?: string }
 *     Auth: caller must be authenticated (Bearer/cookie via IdentityResolver),
 *           non-bridge, have a passkey enrolled, AND have an active
 *           phishing-resistant step-up session. Use this when an existing
 *           Supabase user already has a passkey + step-up.
 *
 *   mode='env-credential' — Phase 2 first-deploy bootstrap.
 *     Body: { mode: 'env-credential', bootstrapToken: string,
 *             username: string, password: string,
 *             targetUserId: string, organizationId?: string,
 *             mintCanonicalSession?: boolean }
 *     Auth: env SUPER_ADMIN_USERNAME/PASSWORD + SUPER_ADMIN_BOOTSTRAP_TOKEN.
 *           NO calling principal required — this is the path used at
 *           initial deployment when no canonical SUPER_ADMIN exists yet
 *           and the operator has only the env shared secret.
 *
 *           targetUserId MUST point to an EXISTING users row. This route
 *           never creates users — it only attaches the SUPER_ADMIN role
 *           to a chosen real account. After success the operator must:
 *             1. Set SUPER_ADMIN_PRIMARY_USER_ID env to the new user's id.
 *             2. Have the user log in via Supabase + enroll a passkey.
 *             3. Unset SUPER_ADMIN_BOOTSTRAP_TOKEN.
 *
 *           When mintCanonicalSession=true, ALSO mints an omnivyra_session
 *           cookie for the target user so a one-shot operator can
 *           immediately access /super-admin without bouncing through
 *           Supabase login. The cookie is bound to the target user, not
 *           the env identity.
 *
 * Hard-expiry: SUPER_ADMIN_BOOTSTRAP_TOKEN env var should be unset after
 * the first successful bootstrap. The route emits a deprecation warning
 * if the token env var is still present alongside an existing SUPER_ADMIN.
 *
 * Replay protection:
 *   - Single-use lock: after ANY SUPER_ADMIN row exists, all bootstrap-
 *     creating modes ('bootstrap', 'env-credential') return
 *     BOOTSTRAP_ALREADY_CONSUMED. The DB row is the lock.
 *   - Token compare is timing-safe.
 *   - Every attempt — success or failure — writes a capability_audit_log
 *     row (decision='super_admin_bootstrap_started' / '_completed' /
 *     '_denied') with IP + UA so attempts are observable.
 *   - In-memory rate limit on env-credential mode: 5 failures per minute
 *     per IP triggers a temporary 429.
 *
 * Rules:
 *   - NEVER auto-promote silently — every mode is an explicit operator action.
 *   - NEVER create users — env-credential mode requires a pre-existing users row.
 *   - Bridge principals (legacy super_admin_session cookie) cannot self-promote.
 *   - Capability-based assignment only — direct DB writes are gated by this route.
 *   - Audit linkage mandatory.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { timingSafeEqual } from 'crypto';
import { ownedDbTable } from '../../../backend/db/writeOwner';
import { logger } from '../../../backend/services/logger';
import { resolvePrincipal } from '../../../backend/security/IdentityResolver';
import { requireCapability } from '../../../backend/security/requireCapability';
import { evaluateStepUp } from '../../../backend/security/StepUpAuthorizationService';
import { getStepUpPolicy } from '../../../backend/security/stepup/StepUpPolicyRegistry';
import { logSecurityEvent } from '../../../backend/security/audit/SecurityAuditService';
import { IDENTITY_ADMIN_ASSIGN } from '../../../shared/contracts/security';
import {
  createSession,
  attachSessionCookie,
} from '../../../backend/security/SessionAuthorityService';
import { resetSuperAdminIdentityCache } from '../../../backend/security/startup/superAdminIdentityCheck';

const SUPER_ADMIN_ROLE = 'SUPER_ADMIN';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = parseBody(req);
  const rawMode = body.mode;
  const mode: 'promote' | 'bootstrap' | 'env-credential' | null =
    rawMode === 'promote'
      ? 'promote'
      : rawMode === 'bootstrap'
        ? 'bootstrap'
        : rawMode === 'env-credential'
          ? 'env-credential'
          : null;
  if (!mode) {
    return res.status(400).json({ error: 'mode must be "promote", "bootstrap", or "env-credential"' });
  }

  const ip = clientIp(req);
  const ua = userAgent(req);

  await logSecurityEvent({
    capability: IDENTITY_ADMIN_ASSIGN,
    decision: 'super_admin_bootstrap_started',
    reason: `mode=${mode}`,
    ip,
    userAgent: ua,
  });

  // ── Mode: promote (existing SUPER_ADMIN promoting another user) ─────────
  if (mode === 'promote') {
    const targetUserId = typeof body.targetUserId === 'string' ? body.targetUserId : null;
    if (!targetUserId) {
      await deny('targetUserId required', ip, ua);
      return res.status(400).json({ error: 'targetUserId required for mode=promote' });
    }
    const organizationId = typeof body.organizationId === 'string' ? body.organizationId : null;

    const guard = await requireCapability(req, res, {
      capability: IDENTITY_ADMIN_ASSIGN,
      reason: `super-admin promotes user ${targetUserId} to SUPER_ADMIN`,
      resourceId: targetUserId,
      organizationId: organizationId ?? undefined,
    });
    if (guard.ok !== true) return;

    const inserted = await assignSuperAdmin(targetUserId, organizationId);
    if (inserted.ok === false) {
      await deny(inserted.reason, ip, ua, guard.principal.userId, targetUserId);
      return res.status(inserted.status).json({ error: inserted.reason });
    }

    await logSecurityEvent({
      capability: IDENTITY_ADMIN_ASSIGN,
      decision: 'super_admin_bootstrap_completed',
      actorUserId: guard.principal.userId,
      actorSessionId: guard.principal.sessionId,
      principalUserId: targetUserId,
      resourceId: inserted.roleRowId,
      reason: `mode=promote organizationId=${inserted.organizationId}`,
      ip,
      userAgent: ua,
    });

    return res.status(201).json({
      ok: true,
      targetUserId,
      organizationId: inserted.organizationId,
      roleRowId: inserted.roleRowId,
    });
  }

  // ── Mode: env-credential (Phase 2, first-deploy operator bootstrap) ─────
  // Path used when the platform has never had a canonical SUPER_ADMIN and
  // the operator only has env credentials. Promotes an EXISTING users row
  // to SUPER_ADMIN. Single-use (DB existence check) + token-gated +
  // env-credential-gated + IP-rate-limited.
  if (mode === 'env-credential') {
    if (envCredentialRateLimited(ip)) {
      await deny('env_credential_rate_limited', ip, ua);
      return res.status(429).json({
        error: 'Too many env-credential bootstrap attempts. Try again in a minute.',
        code: 'BOOTSTRAP_RATE_LIMITED',
      });
    }

    const username = typeof body.username === 'string' ? body.username : null;
    const password = typeof body.password === 'string' ? body.password : null;
    const bootstrapTokenEnvMode = typeof body.bootstrapToken === 'string' ? body.bootstrapToken : null;
    const targetUserId = typeof body.targetUserId === 'string' ? body.targetUserId : null;
    const organizationId = typeof body.organizationId === 'string' ? body.organizationId : null;
    const mintCookie = body.mintCanonicalSession === true;

    if (!username || !password || !bootstrapTokenEnvMode || !targetUserId) {
      await deny('env_credential_missing_fields', ip, ua);
      return res.status(400).json({
        error: 'username, password, bootstrapToken, and targetUserId are required for mode=env-credential',
      });
    }

    // 1. Validate env credentials (must match login env values).
    const envUser = String(process.env.SUPER_ADMIN_USERNAME ?? '').trim();
    const envPass = String(process.env.SUPER_ADMIN_PASSWORD ?? '').trim();
    if (!envUser || !envPass) {
      await deny('env_credential_env_missing', ip, ua);
      return res.status(503).json({
        error: 'Bootstrap env credentials not configured',
        code: 'BOOTSTRAP_NOT_CONFIGURED',
      });
    }
    const userMatches = constantTimeStringEquals(username, envUser);
    const passMatches = constantTimeStringEquals(password, envPass);
    if (!(userMatches && passMatches)) {
      recordEnvCredentialFailure(ip);
      await deny('env_credential_invalid', ip, ua);
      return res.status(401).json({ error: 'Invalid env credentials', code: 'INVALID_CREDENTIALS' });
    }

    // 2. Validate bootstrap token (timing-safe).
    const envToken2 = process.env.SUPER_ADMIN_BOOTSTRAP_TOKEN;
    if (!envToken2 || envToken2.length < 32) {
      await deny('env_credential_token_env_missing', ip, ua);
      return res.status(503).json({ error: 'Bootstrap token not configured', code: 'BOOTSTRAP_NOT_CONFIGURED' });
    }
    if (!constantTimeStringEquals(bootstrapTokenEnvMode, envToken2)) {
      recordEnvCredentialFailure(ip);
      await deny('env_credential_token_mismatch', ip, ua);
      return res.status(401).json({ error: 'Invalid bootstrap token', code: 'BOOTSTRAP_TOKEN_INVALID' });
    }

    // 3. Single-use check: refuse if any SUPER_ADMIN already exists.
    const { count: existingCount2 } = await ownedDbTable('user_company_roles')
      .select('id', { count: 'exact', head: true })
      .eq('role', SUPER_ADMIN_ROLE)
      .eq('status', 'active');
    if ((existingCount2 ?? 0) > 0) {
      await deny('env_credential_already_consumed', ip, ua);
      return res.status(409).json({
        error: 'A SUPER_ADMIN already exists. Use mode=promote with a passkey-enrolled SUPER_ADMIN instead.',
        code: 'BOOTSTRAP_ALREADY_CONSUMED',
      });
    }

    // 4. Verify target user exists and is not soft-deleted. Never create users.
    const { data: targetRow } = await ownedDbTable('users')
      .select('id, supabase_uid, email, is_deleted')
      .eq('id', targetUserId)
      .maybeSingle();
    if (!targetRow) {
      await deny('env_credential_target_user_not_found', ip, ua, null, targetUserId);
      return res.status(404).json({
        error: 'targetUserId does not match any users row. Provision the user via Supabase first.',
        code: 'TARGET_USER_NOT_FOUND',
      });
    }
    const target = targetRow as { id: string; supabase_uid: string | null; email: string | null; is_deleted: boolean };
    if (target.is_deleted) {
      await deny('env_credential_target_user_deleted', ip, ua, null, targetUserId);
      return res.status(409).json({
        error: 'targetUserId points to a soft-deleted user.',
        code: 'TARGET_USER_DELETED',
      });
    }

    // 5. Promote — assignSuperAdmin is idempotent and binds to an org.
    const inserted = await assignSuperAdmin(target.id, organizationId);
    if (inserted.ok === false) {
      await deny(inserted.reason, ip, ua, null, target.id);
      return res.status(inserted.status).json({ error: inserted.reason });
    }

    // 6. Optional: mint canonical session for the target user so the
    //    operator can immediately access /super-admin in this browser.
    let canonicalSessionId: string | null = null;
    if (mintCookie) {
      try {
        const created = await createSession({
          userId: target.id,
          supabaseUid: target.supabase_uid ?? target.id,
          ip,
          userAgent: ua,
        });
        attachSessionCookie(res, created.cookieValue);
        canonicalSessionId = created.session.id;
      } catch (err) {
        logger.warn('env_credential_bootstrap_session_mint_failed', {
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 7. Reset the identity-check cache so the next /api/super-admin/login
    //    call picks up the new state immediately instead of waiting up to 60s.
    resetSuperAdminIdentityCache();

    await logSecurityEvent({
      capability: IDENTITY_ADMIN_ASSIGN,
      decision: 'super_admin_bootstrap_completed',
      actorUserId: null, // env credentials — no user actor
      actorSessionId: canonicalSessionId,
      principalUserId: target.id,
      principalSupabaseUid: target.supabase_uid,
      resourceId: inserted.roleRowId,
      reason: `mode=env-credential organizationId=${inserted.organizationId} canonicalSession=${canonicalSessionId !== null}`,
      ip,
      userAgent: ua,
      viaLegacyBridge: false,
    });

    if (process.env.SUPER_ADMIN_BOOTSTRAP_TOKEN) {
      logger.warn('super_admin_bootstrap_token_still_set_after_use', {
        message: 'Unset SUPER_ADMIN_BOOTSTRAP_TOKEN now that a DB-backed SUPER_ADMIN exists. Subsequent bootstrap calls will return BOOTSTRAP_ALREADY_CONSUMED, but rotating the token out is a defense-in-depth step.',
      });
    }

    return res.status(201).json({
      ok: true,
      bootstrappedUserId: target.id,
      organizationId: inserted.organizationId,
      roleRowId: inserted.roleRowId,
      canonicalSessionMinted: canonicalSessionId !== null,
      nextSteps: {
        setEnv: { name: 'SUPER_ADMIN_PRIMARY_USER_ID', value: target.id },
        action: 'Have the bootstrapped user log in via Supabase and enroll a passkey at /settings/security, then unset SUPER_ADMIN_BOOTSTRAP_TOKEN.',
      },
    });
  }

  // ── Mode: bootstrap (first SUPER_ADMIN, token-gated, self-promote) ──────
  const bootstrapToken = typeof body.bootstrapToken === 'string' ? body.bootstrapToken : null;
  if (!bootstrapToken) {
    await deny('bootstrapToken required', ip, ua);
    return res.status(400).json({ error: 'bootstrapToken required for mode=bootstrap' });
  }

  const envToken = process.env.SUPER_ADMIN_BOOTSTRAP_TOKEN;
  if (!envToken || envToken.length < 32) {
    await deny('bootstrap_token_env_missing_or_short', ip, ua);
    return res.status(503).json({ error: 'Bootstrap not configured', code: 'BOOTSTRAP_NOT_CONFIGURED' });
  }
  if (!constantTimeStringEquals(bootstrapToken, envToken)) {
    await deny('bootstrap_token_mismatch', ip, ua);
    return res.status(401).json({ error: 'Invalid bootstrap token', code: 'BOOTSTRAP_TOKEN_INVALID' });
  }

  // Verify NO existing SUPER_ADMIN — bootstrap mode is single-use by design.
  // user_company_roles uses status='active' + deactivated_at as its lifecycle
  // markers (no revoked_at column on this table).
  const { count: existingCount } = await ownedDbTable('user_company_roles')
    .select('id', { count: 'exact', head: true })
    .eq('role', SUPER_ADMIN_ROLE)
    .eq('status', 'active');
  if ((existingCount ?? 0) > 0) {
    await deny('bootstrap_already_consumed', ip, ua);
    return res.status(409).json({
      error: 'A SUPER_ADMIN already exists. Use mode=promote.',
      code: 'BOOTSTRAP_ALREADY_CONSUMED',
    });
  }

  // Resolve caller — must be authenticated, non-bridge, with a passkey + active step-up.
  const principalResult = await resolvePrincipal(req);
  if (principalResult.ok !== true) {
    await deny(`unauthenticated:${principalResult.reason}`, ip, ua);
    return res.status(401).json({ error: 'Authentication required', code: principalResult.reason });
  }
  const p = principalResult.principal;
  if (p.legacyCookieSuperAdmin) {
    await deny('bridge_principal_self_promote_blocked', ip, ua);
    return res.status(403).json({
      error: 'Bridge principals cannot bootstrap SUPER_ADMIN. Sign in with a Supabase user account.',
      code: 'BRIDGE_FACTOR_INSUFFICIENT',
    });
  }
  if (!p.sessionId) {
    await deny('no_auth_session', ip, ua, p.userId);
    return res.status(409).json({
      error: 'No DB-backed auth session. Sign in via the new flow first.',
      code: 'NO_AUTH_SESSION',
    });
  }

  // Mandatory passkey enrollment.
  if (!p.mfa.factors.includes('webauthn')) {
    await deny('passkey_not_enrolled', ip, ua, p.userId);
    return res.status(412).json({
      error: 'Bootstrap requires a passkey enrolled on the calling account. Enroll a passkey at /settings/security and try again.',
      code: 'PASSKEY_REQUIRED',
    });
  }

  // Mandatory phishing-resistant step-up against the IDENTITY_ADMIN_ASSIGN policy.
  const policy = getStepUpPolicy(IDENTITY_ADMIN_ASSIGN);
  if (!policy) {
    await deny('stepup_policy_missing', ip, ua, p.userId);
    return res.status(500).json({ error: 'Step-up policy not registered' });
  }
  const stepUpDecision = evaluateStepUp(p, policy);
  if (stepUpDecision.satisfied !== true) {
    await deny(`stepup_not_satisfied:${stepUpDecision.reason}`, ip, ua, p.userId);
    return res.status(401).json({
      error: 'Phishing-resistant step-up required',
      code: 'STEP_UP_REQUIRED',
      capability: IDENTITY_ADMIN_ASSIGN,
    });
  }

  // All preconditions satisfied — promote the caller.
  const organizationId = typeof body.organizationId === 'string' ? body.organizationId : null;
  const inserted = await assignSuperAdmin(p.userId, organizationId);
  if (inserted.ok === false) {
    await deny(inserted.reason, ip, ua, p.userId, p.userId);
    return res.status(inserted.status).json({ error: inserted.reason });
  }

  await logSecurityEvent({
    capability: IDENTITY_ADMIN_ASSIGN,
    decision: 'super_admin_bootstrap_completed',
    actorUserId: p.userId,
    actorSessionId: p.sessionId,
    principalUserId: p.userId,
    principalSupabaseUid: p.supabaseUid,
    resourceId: inserted.roleRowId,
    reason: `mode=bootstrap organizationId=${inserted.organizationId} self-promote`,
    mfaPhishingResistant: true,
    deviceTrusted: p.device.trusted,
    ip,
    userAgent: ua,
  });

  if (process.env.SUPER_ADMIN_BOOTSTRAP_TOKEN) {
    logger.warn('super_admin_bootstrap_token_still_set_after_use', {
      message: 'Unset SUPER_ADMIN_BOOTSTRAP_TOKEN now that a DB-backed SUPER_ADMIN exists. Subsequent bootstrap calls will return BOOTSTRAP_ALREADY_CONSUMED, but rotating the token out is a defense-in-depth step.',
    });
  }

  return res.status(201).json({
    ok: true,
    bootstrappedUserId: p.userId,
    organizationId: inserted.organizationId,
    roleRowId: inserted.roleRowId,
  });
}

// ── DB write: assign SUPER_ADMIN role ───────────────────────────────────────

interface AssignResult {
  ok: true;
  roleRowId: string;
  organizationId: string;
}
interface AssignFailure {
  ok: false;
  reason: string;
  status: number;
}

async function assignSuperAdmin(
  userId: string,
  organizationIdOverride: string | null,
): Promise<AssignResult | AssignFailure> {
  // Resolve the org to bind the role row to:
  //   1. organizationIdOverride (caller-provided) if set;
  //   2. otherwise the user's active_company_id;
  //   3. otherwise the most recent company_id from any user_company_roles row;
  //   4. otherwise reject — SUPER_ADMIN must bind to at least one org row.
  let organizationId: string | null = organizationIdOverride;

  if (!organizationId) {
    const { data: userRow } = await ownedDbTable('users')
      .select('active_company_id')
      .eq('id', userId)
      .maybeSingle();
    organizationId = (userRow as { active_company_id: string | null } | null)?.active_company_id ?? null;
  }

  if (!organizationId) {
    const { data: roleRow } = await ownedDbTable('user_company_roles')
      .select('company_id')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    organizationId = (roleRow as { company_id: string | null } | null)?.company_id ?? null;
  }

  if (!organizationId) {
    return { ok: false, reason: 'no_organization_to_bind', status: 412 };
  }

  // Upsert: if the user already has a role in this org, update it to SUPER_ADMIN
  // and re-activate; otherwise insert a fresh row. user_company_roles has no
  // revoked_at column — lifecycle is encoded by status + deactivated_at.
  const { data: existing } = await ownedDbTable('user_company_roles')
    .select('id, role, status, deactivated_at')
    .eq('user_id', userId)
    .eq('company_id', organizationId)
    .maybeSingle();

  if (existing) {
    const row = existing as { id: string; role: string; status: string; deactivated_at: string | null };
    if (row.role === SUPER_ADMIN_ROLE && row.status === 'active' && row.deactivated_at === null) {
      // Already SUPER_ADMIN — idempotent success.
      return { ok: true, roleRowId: row.id, organizationId };
    }
    const { error } = await ownedDbTable('user_company_roles')
      .update({
        role: SUPER_ADMIN_ROLE,
        status: 'active',
        deactivated_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id);
    if (error) return { ok: false, reason: `db_update_failed:${error.message}`, status: 500 };
    return { ok: true, roleRowId: row.id, organizationId };
  }

  const { data: inserted, error } = await ownedDbTable('user_company_roles')
    .insert({
      user_id: userId,
      company_id: organizationId,
      role: SUPER_ADMIN_ROLE,
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error || !inserted) return { ok: false, reason: `db_insert_failed:${error?.message ?? 'unknown'}`, status: 500 };

  return { ok: true, roleRowId: (inserted as { id: string }).id, organizationId };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function deny(
  reason: string,
  ip: string | null,
  ua: string | null,
  actorUserId?: string | null,
  principalUserId?: string | null,
): Promise<void> {
  await logSecurityEvent({
    capability: IDENTITY_ADMIN_ASSIGN,
    decision: 'super_admin_bootstrap_denied',
    reason,
    actorUserId: actorUserId ?? null,
    principalUserId: principalUserId ?? null,
    ip,
    userAgent: ua,
  });
}

function constantTimeStringEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) {
    // Length leak is acceptable for this surface — a token mismatch with
    // a different length is statistically uninteresting. Use a dummy
    // compare to keep timing roughly constant.
    timingSafeEqual(ab.length === 0 ? bb : ab.subarray(0, 1), bb.length === 0 ? ab : bb.subarray(0, 1));
    return false;
  }
  return timingSafeEqual(ab, bb);
}

function parseBody(req: NextApiRequest): Record<string, unknown> {
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body) as Record<string, unknown>; } catch { return {}; }
  }
  return (req.body ?? {}) as Record<string, unknown>;
}

function clientIp(req: NextApiRequest): string | null {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string') return xff.split(',')[0]?.trim() ?? null;
  return req.socket?.remoteAddress ?? null;
}

function userAgent(req: NextApiRequest): string | null {
  const ua = req.headers['user-agent'];
  return typeof ua === 'string' ? ua : null;
}

// ── env-credential rate limiting ────────────────────────────────────────────
// In-process counter: 5 failures per IP per 60-second window. The bootstrap
// surface is small enough that an in-process limiter is sufficient and
// avoids a Redis dependency. After Phase 2 ships, expect <1 call ever per
// deployment, so the bound is generous.

const ENV_CREDENTIAL_FAILURE_WINDOW_MS = 60_000;
const ENV_CREDENTIAL_FAILURE_LIMIT = 5;
const envCredentialFailures = new Map<string, number[]>();

function envCredentialRateLimited(ip: string | null): boolean {
  const key = ip ?? '<unknown>';
  const now = Date.now();
  const cutoff = now - ENV_CREDENTIAL_FAILURE_WINDOW_MS;
  const recent = (envCredentialFailures.get(key) ?? []).filter((t) => t > cutoff);
  envCredentialFailures.set(key, recent);
  return recent.length >= ENV_CREDENTIAL_FAILURE_LIMIT;
}

function recordEnvCredentialFailure(ip: string | null): void {
  const key = ip ?? '<unknown>';
  const now = Date.now();
  const cutoff = now - ENV_CREDENTIAL_FAILURE_WINDOW_MS;
  const recent = (envCredentialFailures.get(key) ?? []).filter((t) => t > cutoff);
  recent.push(now);
  envCredentialFailures.set(key, recent);
}

/** Test/CI hook: clear in-process rate-limit state. */
export function _resetEnvCredentialRateLimit(): void {
  envCredentialFailures.clear();
}
