/** Route shell — super-admin users/create API (Agent-B split: helpers/types in ../../../../backend/apiHandlers/superAdmin/usersCreateShared). */
/**
 * POST /api/super-admin/users/create
 *
 * Phase 2.A — canonical backend user-creation endpoint.
 *
 * Replaces the stub-row pattern in pages/api/super-admin/users.ts (POST) by:
 *   1. Validating capability + step-up via requireCapability(IDENTITY_ADMIN_ASSIGN).
 *      The capability is policy-marked phishing-resistant + trusted-device
 *      (StepUpPolicyRegistry.ts → PHISHING_RESISTANT_TRUSTED_TENMIN).
 *   2. Creating the Supabase Auth user via supabase.auth.admin.createUser —
 *      ensures supabase_uid is populated immediately. NEVER creates ghost rows.
 *   3. Inserting / updating the public.users row with the new lifecycle
 *      `status` column (introduced in 20260638_user_status_lifecycle.sql).
 *   4. Inserting the user_company_roles row.
 *   5. Creating an invitations row (magic_link mode) and/or sending the temp
 *      password email (temp_password mode).
 *   6. Writing a canonical audit row via insertAuditLogStrict.
 *
 * Modes:
 *   inviteMode='magic_link'  — Supabase Auth user with email_confirm=false.
 *                              User receives a magic-link via the existing
 *                              invitations flow (token → /auth/accept-invite
 *                              → signInWithOtp). users.status='invited'
 *                              flips to 'active' on accept-invite consumption.
 *
 *   inviteMode='temp_password' — Supabase Auth user with a server-generated
 *                                password and email_confirm=true. The user
 *                                can sign in immediately; has_password=false
 *                                forces /auth/set-password on first login
 *                                (post-login-route enforces this).
 *                                The temp password is rendered in the email
 *                                ONCE and never persisted anywhere else.
 *
 * Non-work emails:
 *   allowPersonalEmail=true bypasses validateWorkEmail. The flag must be
 *   passed explicitly per request; there is no implicit bypass.
 *
 * Idempotency: required via Idempotency-Key header (withIdempotency wrapper).
 */

import { randomBytes } from 'crypto';
import type { NextApiRequest, NextApiResponse } from 'next';

import { supabase } from '../../../../backend/db/supabaseClient';
import { ownedDbTable } from '../../../../backend/db/writeOwner';
import { withIdempotency } from '../../../../backend/middleware/withIdempotency';
import { requireAdminRateLimit } from '../../../../backend/services/requestAccessService';
import { logger } from '../../../../backend/services/logger';
import { Role, ALL_ROLES } from '../../../../backend/services/rbacService';
import { createInvitation } from '../../../../backend/services/invitationService';
import { enqueueEmailJob } from '../../../../backend/services/emailJobsService';
import {
  insertAuditLogStrict,
  SYSTEM_USER_ID,
} from '../../../../backend/services/auditActorService';
import { logAuthEvent } from '../../../../lib/auth/auditLog';
import { validateWorkEmail } from '../../../../lib/auth/serverValidation';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { IDENTITY_ADMIN_ASSIGN } from '../../../../shared/contracts/security';
import { getRequestContext } from '../../../../backend/services/requestContext';
import { getCanonicalAppUrl } from '../../../../backend/config/getCanonicalAppUrl';

import { ALLOWED_INVITE_ROLES, CreatePayload, EMAIL_RE, InviteMode, ResolveAuthUserResult, appUrl, generateTempPassword, isAllowedRole, resolveOrCreateAuthUser, upsertCompanyRole, upsertUsersRow } from '../../../../backend/apiHandlers/superAdmin/usersCreateShared';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Rate limit ────────────────────────────────────────────────────────────
  if (!(await requireAdminRateLimit(req, res, 'rl:super-admin:users:create', 10, 60))) return;

  // ── Parse + shallow-validate payload (no DB writes yet) ───────────────────
  const body = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {}) as CreatePayload;
  const email = String(body.email || '').trim().toLowerCase();
  const fullName = body.fullName ? String(body.fullName).trim() : null;
  const companyId = String(body.companyId || '').trim();
  const role = String(body.role || '').trim().toUpperCase();
  const allowPersonalEmail = body.allowPersonalEmail === true;
  const inviteMode: InviteMode = body.inviteMode === 'temp_password' ? 'temp_password' : 'magic_link';
  const shouldSendInvite = body.sendInvite !== false;

  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'INVALID_EMAIL', details: 'email is required and must be well-formed' });
  }
  if (!companyId) {
    return res.status(400).json({ error: 'MISSING_COMPANY_ID', details: 'companyId is required' });
  }
  if (!isAllowedRole(role)) {
    return res.status(400).json({ error: 'ROLE_NOT_ALLOWED', allowed: ALLOWED_INVITE_ROLES });
  }

  // ── Work-email gate (opt-in bypass) ───────────────────────────────────────
  // The public signup route at pages/api/auth/signup.ts hard-gates personal
  // domains. Backend-admin paths can bypass when allowPersonalEmail=true is
  // passed explicitly. The bypass is itself audited (see audit row below).
  if (!allowPersonalEmail) {
    try {
      validateWorkEmail(email);
    } catch (err: any) {
      return res.status(400).json({
        error: 'PERSONAL_EMAIL_BLOCKED',
        details: err?.message ?? 'Personal email domains are not allowed by default. Set allowPersonalEmail=true to override.',
        code: 'PERSONAL_EMAIL',
      });
    }
  }

  // ── Capability + step-up gate ─────────────────────────────────────────────
  // IDENTITY_ADMIN_ASSIGN is policy-marked phishing-resistant + trusted-device
  // (StepUpPolicyRegistry). Bridge principals cannot satisfy this gate.
  const guard = await requireCapability(req, res, {
    capability: IDENTITY_ADMIN_ASSIGN,
    reason: `super-admin creates user ${email} in company ${companyId} (mode=${inviteMode}, personal=${allowPersonalEmail})`,
    organizationId: companyId,
    resourceId: email,
  });
  if (guard.ok !== true) return;
  const actorUserId = guard.principal.userId || SYSTEM_USER_ID;

  // ── Company existence check ───────────────────────────────────────────────
  const { data: companyRow, error: companyErr } = await supabase
    .from('companies')
    .select('id, name')
    .eq('id', companyId)
    .maybeSingle();
  if (companyErr) {
    return res.status(500).json({ error: 'FAILED_TO_VALIDATE_COMPANY', details: companyErr.message });
  }
  if (!companyRow) {
    return res.status(404).json({
      error: 'COMPANY_NOT_FOUND',
      details: `Company ${companyId} does not exist. Create the company before assigning users.`,
    });
  }
  const companyName = (companyRow as any).name || null;

  // ── Temp password generation (server-side only) ───────────────────────────
  let temporaryPassword: string | null = null;
  if (inviteMode === 'temp_password') {
    const overrideRaw = typeof body.temporaryPassword === 'string' ? body.temporaryPassword : '';
    if (overrideRaw.length > 0) {
      if (overrideRaw.length < 12) {
        return res.status(400).json({
          error: 'TEMP_PASSWORD_TOO_SHORT',
          details: 'temporaryPassword must be at least 12 characters when provided',
        });
      }
      temporaryPassword = overrideRaw;
    } else {
      temporaryPassword = generateTempPassword();
    }
  }

  // ── Resolve or create the Supabase Auth user ──────────────────────────────
  const authResult = await resolveOrCreateAuthUser({
    email,
    mode: inviteMode,
    temporaryPassword,
    fullName,
  });
  if (authResult.ok !== true) {
    logger.error('super_admin_create_auth_resolve_failed', { email, error: authResult.error });
    return res.status(502).json({ error: 'AUTH_PROVISION_FAILED', details: authResult.error });
  }
  const { supabaseUid, created: authCreated, emailConfirmed } = authResult.data;

  // ── Upsert public.users row (linked to supabase_uid; no ghosts) ───────────
  const usersResult = await upsertUsersRow({
    supabaseUid,
    email,
    fullName,
    emailConfirmed,
  });
  if (usersResult.ok !== true) {
    if (usersResult.error === 'ACCOUNT_DELETED') {
      return res.status(403).json({ error: 'ACCOUNT_DELETED', code: 'AUTH_001' });
    }
    logger.error('super_admin_create_users_upsert_failed', { email, error: usersResult.error });
    return res.status(500).json({ error: 'FAILED_TO_SAVE_USER', details: usersResult.error });
  }
  const userId = usersResult.userId;

  // ── Upsert role membership ────────────────────────────────────────────────
  // temp_password: role active immediately — user can sign in right away.
  // magic_link:    role invited until the user accepts (flipped by
  //                pages/api/auth/accept-invite.ts on token consumption).
  const roleStatus: 'invited' | 'active' = inviteMode === 'temp_password' ? 'active' : 'invited';
  const roleResult = await upsertCompanyRole({
    userId,
    companyId,
    role,
    status: roleStatus,
  });
  if (roleResult.ok !== true) {
    logger.error('super_admin_create_role_upsert_failed', { email, error: roleResult.error });
    return res.status(500).json({ error: 'FAILED_TO_ASSIGN_ROLE', details: roleResult.error });
  }

  // ── temp_password mode: also flip users.status to 'active' (they can log
  //    in now). magic_link mode keeps users.status='invited' until the
  //    invitation is consumed.
  if (inviteMode === 'temp_password') {
    await supabase
      .from('users')
      .update({ status: 'active', updated_at: new Date().toISOString() })
      .eq('id', userId);
  }

  // ── Invitation + ASYNC email delivery (Phase 2.A.1) ──────────────────────
  // Identity provisioning is synchronous; email send is enqueued only. The
  // cron worker at /api/cron/email-jobs drains the queue, calls the Edge
  // Function, and writes delivery audit events.
  //
  // Temp passwords are encrypted-at-rest inside the queued payload via
  // AES-256-GCM (emailJobsService.encryptSensitiveField). The plaintext
  // never lands in any log, audit row, or response body.
  const requestIdempotencyKey = getRequestContext().idempotencyKey ?? null;
  const correlationId = requestIdempotencyKey ?? `super_admin_create:${userId}:${Date.now()}`;

  let invitationId: string | null = null;
  let queuedJobId: string | null = null;
  let queueError: string | null = null;

  if (inviteMode === 'magic_link') {
    try {
      const invitation = await createInvitation({
        email,
        companyId,
        role,
        invitedBy: actorUserId,
        idempotencyKey: requestIdempotencyKey ?? undefined,
      });
      invitationId = invitation.id;

      if (shouldSendInvite) {
        try {
          const enqueued = await enqueueEmailJob({
            templateKey: 'team_invite_magic_link',
            recipientEmail: email,
            invitationId: invitation.id,
            correlationId,
            idempotencyKey: requestIdempotencyKey
              ? `${requestIdempotencyKey}:email:magic_link`
              : undefined,
            payload: {
              recipientEmail: email,
              recipientName: fullName,
              companyName,
              role,
              inviteUrl: invitation.inviteLink,
              invitationId: invitation.id,
              correlationId,
            },
          });
          queuedJobId = enqueued.jobId;
        } catch (err: any) {
          queueError = err?.message || String(err);
          logger.warn('super_admin_create_enqueue_magic_link_failed', { email, message: queueError });
        }
      }
    } catch (err: any) {
      logger.error('super_admin_create_invitation_failed', { email, message: err?.message });
      return res.status(500).json({ error: 'FAILED_TO_CREATE_INVITATION', details: err?.message ?? String(err) });
    }
  } else if (inviteMode === 'temp_password' && temporaryPassword) {
    if (shouldSendInvite) {
      try {
        const enqueued = await enqueueEmailJob({
          templateKey: 'team_invite_credentials',
          recipientEmail: email,
          invitationId: null,
          correlationId,
          idempotencyKey: requestIdempotencyKey
            ? `${requestIdempotencyKey}:email:credentials`
            : undefined,
          payload: {
            recipientEmail: email,
            recipientName: fullName,
            companyName,
            role,
            loginUrl: `${appUrl()}/login?email=${encodeURIComponent(email)}`,
            temporaryPassword, // encrypted in-transit-to-queue by emailJobsService
            invitationId: null,
            correlationId,
          },
        });
        queuedJobId = enqueued.jobId;
      } catch (err: any) {
        queueError = err?.message || String(err);
        logger.warn('super_admin_create_enqueue_credentials_failed', { email, message: queueError });
      }
    }
  }

  // ── Audit (canonical, non-null actor, full before/after) ──────────────────
  // NEVER log the temporary password. We log whether it was generated +
  // enqueued for delivery, not the value.
  await insertAuditLogStrict({
    actorUserId,
    action: 'SUPER_ADMIN_USER_CREATE',
    targetUserId: userId,
    companyId,
    metadata: {
      capability: IDENTITY_ADMIN_ASSIGN,
      mode: inviteMode,
      allow_personal_email: allowPersonalEmail,
      auth_user_created: authCreated,
      users_row_existed: usersResult.alreadyExisted,
      role_assignment: {
        role,
        status: roleStatus,
        previous_role: roleResult.created ? null : roleResult.previousRole,
        previous_status: roleResult.created ? null : roleResult.previousStatus,
      },
      invitation_id: invitationId,
      delivery: {
        status: queuedJobId ? 'queued' : (shouldSendInvite ? 'enqueue_failed' : 'not_requested'),
        job_id: queuedJobId,
        queue_error: queueError,
        correlation_id: correlationId,
      },
      temp_password_issued: inviteMode === 'temp_password',
      timestamp: new Date().toISOString(),
    },
  });

  // Fire-and-forget secondary audit-trail signals (never blocks the request).
  void logAuthEvent('role_changed', {
    userId,
    metadata: {
      new_role: role,
      company_id: companyId,
      changed_by: 'super_admin_create',
      invite_mode: inviteMode,
    },
  });

  // ── Response — never echoes the temp password ─────────────────────────────
  return res.status(201).json({
    user: {
      id: userId,
      email,
      supabase_uid: supabaseUid,
      status: inviteMode === 'temp_password' ? 'active' : 'invited',
      company_id: companyId,
      role,
    },
    invitation: {
      mode: inviteMode,
      id: invitationId,
    },
    delivery: {
      status: queuedJobId ? 'queued' : (shouldSendInvite ? 'enqueue_failed' : 'not_requested'),
      job_id: queuedJobId,
      correlation_id: correlationId,
      queue_error: queueError,
    },
  });
}

export default withIdempotency(handler, {
  scope: 'super-admin-users-create',
  methods: ['POST'],
});
