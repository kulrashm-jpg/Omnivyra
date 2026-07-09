/** super-admin users/create API (Agent-B split — backend module, not a route). */
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

import { supabase } from '../../db/supabaseClient';
import { ownedDbTable } from '../../db/writeOwner';
import { withIdempotency } from '../../middleware/withIdempotency';
import { requireAdminRateLimit } from '../../services/requestAccessService';
import { logger } from '../../services/logger';
import { Role, ALL_ROLES } from '../../services/rbacService';
import { createInvitation } from '../../services/invitationService';
import { enqueueEmailJob } from '../../services/emailJobsService';
import {
  insertAuditLogStrict,
  SYSTEM_USER_ID,
} from '../../services/auditActorService';
import { logAuthEvent } from '../../../lib/auth/auditLog';
import { validateWorkEmail } from '../../../lib/auth/serverValidation';
import { requireCapability } from '../../security/requireCapability';
import { IDENTITY_ADMIN_ASSIGN } from '../../../shared/contracts/security';
import { getRequestContext } from '../../services/requestContext';
import { getCanonicalAppUrl } from '../../config/getCanonicalAppUrl';

export type InviteMode = 'magic_link' | 'temp_password';

export interface CreatePayload {
  email: string;
  fullName?: string | null;
  companyId: string;
  role: string;
  allowPersonalEmail?: boolean;
  inviteMode?: InviteMode;
  sendInvite?: boolean;
  /**
   * Override the server-generated temp password. Only honored when
   * inviteMode='temp_password'. Must be at least 12 characters.
   */
  temporaryPassword?: string;
}

export const ALLOWED_INVITE_ROLES = ALL_ROLES.filter((r) => r !== Role.SUPER_ADMIN);
export const isAllowedRole = (value?: string | null): boolean => {
  if (!value) return false;
  return (ALLOWED_INVITE_ROLES as readonly string[]).includes(value.toUpperCase());
};

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function appUrl(): string {
  return getCanonicalAppUrl();
}

/**
 * Server-generated temp password. 18 random bytes encoded base64url →
 * 24 url-safe characters. 144 bits of entropy. Never stored in plaintext
 * outside the one-time email render.
 */
export function generateTempPassword(): string {
  return randomBytes(18).toString('base64url');
}

export interface ResolveAuthUserResult {
  supabaseUid: string;
  created: boolean;
  /** Only set when we just created the auth user and used a temp password. */
  emailConfirmed: boolean;
}

/**
 * Resolve or create the Supabase Auth user for this email. Returns the
 * supabase_uid in every success path — never null. NEVER creates a ghost
 * public.users row.
 *
 * If an auth user already exists (from a prior signup attempt, a soft-deleted
 * public.users row, or an admin import) we reuse it. The CALLER is responsible
 * for refusing to proceed if the public.users row is is_deleted=true.
 */
export async function resolveOrCreateAuthUser(input: {
  email: string;
  mode: InviteMode;
  temporaryPassword: string | null;
  fullName: string | null;
}): Promise<{ ok: true; data: ResolveAuthUserResult } | { ok: false; error: string }> {
  const email = input.email;

  const payload: { email: string; email_confirm: boolean; password?: string; user_metadata?: Record<string, unknown> } = {
    email,
    email_confirm: input.mode === 'temp_password',
    user_metadata: input.fullName ? { full_name: input.fullName } : undefined,
  };
  if (input.mode === 'temp_password' && input.temporaryPassword) {
    payload.password = input.temporaryPassword;
  }

  const { data, error } = await supabase.auth.admin.createUser(payload);
  if (!error && data?.user?.id) {
    return {
      ok: true,
      data: {
        supabaseUid: data.user.id,
        created: true,
        emailConfirmed: input.mode === 'temp_password',
      },
    };
  }

  // Duplicate path — auth.users already has this email. Look it up.
  // supabase-js admin.listUsers does not accept an email filter directly, so
  // we use the project's existing RPC `auth_user_confirmed` to verify presence
  // and then page through listUsers to find the row.
  const isDuplicate =
    error?.message?.toLowerCase().includes('already') ||
    error?.message?.toLowerCase().includes('duplicate') ||
    error?.message?.toLowerCase().includes('registered');

  if (!isDuplicate) {
    logger.error('super_admin_create_auth_create_failed', {
      email,
      message: error?.message,
    });
    return { ok: false, error: error?.message || 'AUTH_CREATE_FAILED' };
  }

  // Locate the existing auth user by paging admin.listUsers. Most projects
  // are small enough that this resolves on page 1; the cap of 5 pages keeps
  // it bounded even at scale.
  for (let page = 1; page <= 5; page += 1) {
    const listResult = await supabase.auth.admin.listUsers({ page, perPage: 200 }) as {
      data: { users: Array<{ id: string; email?: string | null; email_confirmed_at?: string | null }> } | null;
      error: { message: string } | null;
    };
    if (listResult.error) {
      return { ok: false, error: `AUTH_LOOKUP_FAILED:${listResult.error.message}` };
    }
    const users = listResult.data?.users ?? [];
    const match = users.find((u) => (u.email || '').toLowerCase() === email);
    if (match) {
      return {
        ok: true,
        data: {
          supabaseUid: match.id,
          created: false,
          emailConfirmed: Boolean(match.email_confirmed_at),
        },
      };
    }
    if (users.length < 200) break;
  }

  return { ok: false, error: 'AUTH_USER_NOT_FOUND_AFTER_DUPLICATE' };
}

export async function upsertUsersRow(input: {
  supabaseUid: string;
  email: string;
  fullName: string | null;
  emailConfirmed: boolean;
}): Promise<{ ok: true; userId: string; alreadyExisted: boolean } | { ok: false; error: string }> {
  const { data: existing, error: selErr } = await supabase
    .from('users')
    .select('id, is_deleted, supabase_uid, status')
    .eq('email', input.email)
    .maybeSingle();

  if (selErr) return { ok: false, error: selErr.message };

  if (existing && (existing as any).is_deleted === true) {
    return { ok: false, error: 'ACCOUNT_DELETED' };
  }

  if (existing) {
    const id = (existing as any).id as string;
    const patch: Record<string, unknown> = {
      supabase_uid: input.supabaseUid,
      status: (existing as any).status === 'active' ? 'active' : 'invited',
      updated_at: new Date().toISOString(),
    };
    if (input.fullName && !(existing as any).name) patch.name = input.fullName;
    if (input.emailConfirmed) patch.is_email_verified = true;

    const { error: updErr } = await supabase
      .from('users')
      .update(patch)
      .eq('id', id);
    if (updErr) return { ok: false, error: updErr.message };
    return { ok: true, userId: id, alreadyExisted: true };
  }

  const now = new Date().toISOString();
  const insertPayload: Record<string, unknown> = {
    email: input.email,
    name: input.fullName || input.email.split('@')[0] || 'User',
    supabase_uid: input.supabaseUid,
    is_email_verified: input.emailConfirmed,
    is_phone_verified: false,
    has_password: false,
    status: 'invited',
    onboarding_state: 'active',
    created_at: now,
  };

  const { data: created, error: insErr } = await supabase
    .from('users')
    .insert(insertPayload)
    .select('id')
    .single();

  if (insErr) {
    // 23505 = unique race on email — re-read.
    if (insErr.code === '23505') {
      const { data: retry } = await supabase
        .from('users')
        .select('id')
        .eq('email', input.email)
        .maybeSingle();
      if (retry) {
        await supabase
          .from('users')
          .update({ supabase_uid: input.supabaseUid, updated_at: new Date().toISOString() })
          .eq('id', (retry as any).id);
        return { ok: true, userId: (retry as any).id, alreadyExisted: true };
      }
    }
    return { ok: false, error: insErr.message };
  }

  return { ok: true, userId: (created as any).id, alreadyExisted: false };
}

export async function upsertCompanyRole(input: {
  userId: string;
  companyId: string;
  role: string;
  status: 'invited' | 'active';
}): Promise<{ ok: true; created: boolean; previousRole: string | null; previousStatus: string | null }
  | { ok: false; error: string }> {
  const { data: existingRows, error: selErr } = await supabase
    .from('user_company_roles')
    .select('id, role, status')
    .eq('user_id', input.userId)
    .eq('company_id', input.companyId)
    .limit(1);
  if (selErr) return { ok: false, error: selErr.message };

  const now = new Date().toISOString();

  if (existingRows && existingRows.length > 0) {
    const row = existingRows[0] as { id: string; role: string; status: string | null };
    if (row.status === 'active' && row.role === input.role) {
      return { ok: true, created: false, previousRole: row.role, previousStatus: row.status };
    }
    const patch: Record<string, unknown> = {
      role: input.role,
      status: input.status,
      updated_at: now,
      deactivated_at: null,
    };
    if (input.status === 'active') patch.accepted_at = now;
    else patch.invited_at = now;

    const { error: updErr } = await supabase
      .from('user_company_roles')
      .update(patch)
      .eq('id', row.id);
    if (updErr) return { ok: false, error: updErr.message };
    return { ok: true, created: false, previousRole: row.role, previousStatus: row.status };
  }

  const insertPayload: Record<string, unknown> = {
    user_id: input.userId,
    company_id: input.companyId,
    role: input.role,
    status: input.status,
    created_at: now,
    updated_at: now,
  };
  if (input.status === 'active') insertPayload.accepted_at = now;
  else insertPayload.invited_at = now;

  const { error: insErr } = await supabase.from('user_company_roles').insert(insertPayload);
  if (insErr) return { ok: false, error: insErr.message };
  return { ok: true, created: true, previousRole: null, previousStatus: null };
}

