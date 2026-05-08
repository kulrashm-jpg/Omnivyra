/**
 * POST /api/admin/bootstrap-super-admin
 *
 * Establishes the canonical DB-backed SUPER_ADMIN authority. Two modes:
 *
 *   mode='promote' — an existing SUPER_ADMIN promotes another user.
 *     Body: { mode: 'promote', targetUserId: string, organizationId?: string }
 *     Auth: requireCapability(IDENTITY_ADMIN_ASSIGN) — phishing-resistant
 *           step-up + trusted device.
 *
 *   mode='bootstrap' — first SUPER_ADMIN, when NONE exists.
 *     Body: { mode: 'bootstrap', bootstrapToken: string, organizationId?: string }
 *     Auth: caller must be authenticated (Bearer/cookie via IdentityResolver),
 *           non-bridge, have a passkey enrolled, AND have an active
 *           phishing-resistant step-up session.
 *           bootstrapToken must equal env SUPER_ADMIN_BOOTSTRAP_TOKEN
 *           (timing-safe compare). The token is single-use by design:
 *           after a SUPER_ADMIN row exists, mode='bootstrap' is
 *           permanently disabled and cannot resurrect (the existence
 *           check is the lock).
 *
 * Hard-expiry: SUPER_ADMIN_BOOTSTRAP_TOKEN env var should be unset after
 * the first successful bootstrap. The route emits a deprecation warning
 * if the token env var is still present alongside an existing SUPER_ADMIN.
 *
 * Rules:
 *   - NEVER auto-promote silently — both modes are explicit operator actions.
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

const SUPER_ADMIN_ROLE = 'SUPER_ADMIN';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = parseBody(req);
  const mode = body.mode === 'promote' ? 'promote' : body.mode === 'bootstrap' ? 'bootstrap' : null;
  if (!mode) {
    return res.status(400).json({ error: 'mode must be "promote" or "bootstrap"' });
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
