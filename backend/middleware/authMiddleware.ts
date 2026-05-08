/**
 * Centralised auth middleware for Next.js API routes.
 *
 * ALL authentication is via Supabase JWT tokens (Bearer or session cookie).
 * The actual token validation + UID-backfill + soft-delete enforcement is
 * implemented in backend/services/authResolver.ts. This file is the
 * response-shaping layer that maps resolver outcomes to HTTP responses.
 *
 * Usage:
 *
 *   const auth = await requireAuth(req, res);
 *   if (!auth) return;   // 401 already sent
 *
 *   const ok = await requireCompanyAccess(auth.user.id, companyId, res);
 *   if (!ok) return;
 *
 *   const sa = await requireSuperAdmin(req, res);
 *   if (!sa) return;
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../db/supabaseClient';
import { resolveAuthenticatedUser } from '../services/authResolver';
import { assertTenantAccess } from '../security/TenantGuard';

// ── Resolved auth identity ────────────────────────────────────────────────────

export interface AuthUser {
  /** Internal users.id (UUID from our DB). */
  id: string;
  /** Supabase auth UUID (auth.users.id). Mirrors users.supabase_uid. */
  supabaseUid: string;
  email: string;
}

// ── 1. requireAuth ─────────────────────────────────────────────────────────────

/**
 * Validates the Supabase token in the Authorization header (or session cookie)
 * via the canonical resolveAuthenticatedUser, then maps the result to either
 * an authenticated user or a 401/403 response.
 *
 * Returns the authenticated user or sends 401/403 and returns null.
 */
export async function requireAuth(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<{ user: AuthUser } | null> {
  const result = await resolveAuthenticatedUser(req);

  if (result.error === 'ACCOUNT_DELETED') {
    res.status(403).json({ error: 'Account has been deactivated.', code: 'ACCOUNT_DELETED' });
    return null;
  }
  if (result.error === 'USER_NOT_FOUND') {
    res.status(401).json({ error: 'User not found — please complete sign-in' });
    return null;
  }
  if (result.error !== null) {
    res.status(401).json({ error: 'Authorization required' });
    return null;
  }

  return {
    user: {
      id: result.user.id,
      supabaseUid: result.user.supabaseUid,
      email: result.user.email,
    },
  };
}

// ── 2. requireCompanyAccess ────────────────────────────────────────────────────

/**
 * Verifies the authenticated user has an active role in the given company.
 * Platform super-admins bypass the membership check.
 *
 * SHIM: delegates to `TenantGuard.assertTenantAccess` so soft-deleted orgs
 * and stale memberships are centrally rejected. The signature (and the
 * 400/403 response shape) is preserved for existing callers.
 */
export async function requireCompanyAccess(
  userId: string,
  companyId: string | undefined,
  res: NextApiResponse,
): Promise<boolean> {
  if (!companyId) {
    res.status(400).json({ error: 'company_id is required' });
    return false;
  }
  const result = await assertTenantAccess({ userId, organizationId: companyId });
  if (result.ok === true) return true;
  if (result.reason === 'ORG_NOT_FOUND') {
    res.status(404).json({ error: 'Company not found' });
    return false;
  }
  res.status(403).json({ error: 'Access denied — you are not a member of this company' });
  return false;
}

// ── 3. requireSuperAdmin ───────────────────────────────────────────────────────

/**
 * Verifies the caller is a platform super-admin.
 * Checks user_company_roles.role = 'SUPER_ADMIN' for the authenticated user.
 *
 * Returns { user } on success, sends 401/403 and returns null otherwise.
 */
export async function requireSuperAdmin(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<{ user: AuthUser } | null> {
  const authResult = await requireAuth(req, res);
  if (!authResult) return null;

  const { user } = authResult;

  const { data: roleRow } = await supabase
    .from('user_company_roles')
    .select('id')
    .eq('user_id', user.id)
    .eq('role', 'SUPER_ADMIN')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (roleRow) return { user };

  res.status(403).json({ error: 'Forbidden — super-admin access required' });
  return null;
}

// ── 4. resolveActorId ──────────────────────────────────────────────────────────

/**
 * Extracts the authenticated internal user.id from the Bearer token / cookie.
 * Returns null if no valid token — does NOT send a response.
 *
 * Thin wrapper over the canonical resolver, kept for non-throwing call sites.
 */
export async function resolveActorId(req: NextApiRequest): Promise<string | null> {
  const result = await resolveAuthenticatedUser(req);
  return result.error === null ? result.user.id : null;
}
