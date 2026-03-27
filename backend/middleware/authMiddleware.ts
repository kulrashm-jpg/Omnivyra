/**
 * Centralised auth middleware for Next.js API routes.
 *
 * ALL authentication is via Supabase JWT tokens (verified by supabase.auth.getUser).
 *
 * Usage:
 *
 *   const { user } = await requireAuth(req, res);
 *   if (!user) return;   // 401 already sent
 *
 *   await requireCompanyAccess(user.id, companyId, res);
 *   if (res.writableEnded) return;
 *
 *   await requireSuperAdmin(req, res);
 *   if (res.writableEnded) return;
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../db/supabaseClient';
import { verifySupabaseAuthHeader } from '../../lib/auth/serverValidation';

// ── Resolved auth identity ────────────────────────────────────────────────────

export interface AuthUser {
  /** Internal users.id (UUID from our DB) */
  id: string;
  /** Supabase auth UUID (kept as firebaseUid for interface compatibility) */
  firebaseUid: string;
  email: string;
}

// ── 1. requireAuth ─────────────────────────────────────────────────────────────

/**
 * Validates the Supabase Bearer token in the Authorization header.
 * Resolves the internal users.id from supabase_uid (falls back to email).
 * Returns the authenticated user or sends 401 and returns null.
 */
export async function requireAuth(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<{ user: AuthUser } | null> {
  let supabaseUid: string;
  let email: string;

  try {
    const verified = await verifySupabaseAuthHeader(req.headers.authorization);
    supabaseUid = verified.id;
    email = verified.email;
  } catch {
    res.status(401).json({ error: 'Authorization required' });
    return null;
  }

  // Resolve internal DB user id — try supabase_uid first, fall back to email
  let userRow: { id: string; email: string } | null = null;
  const { data: byUid } = await supabase
    .from('users')
    .select('id, email')
    .eq('supabase_uid', supabaseUid)
    .maybeSingle();
  if (byUid) {
    userRow = byUid as { id: string; email: string };
  } else {
    const { data: byEmail } = await supabase
      .from('users')
      .select('id, email')
      .eq('email', email)
      .maybeSingle();
    if (byEmail) {
      userRow = byEmail as { id: string; email: string };
      // Back-fill supabase_uid
      await supabase.from('users').update({ supabase_uid: supabaseUid }).eq('id', userRow.id);
    }
  }

  if (!userRow) {
    res.status(401).json({ error: 'User not found — please complete sign-in' });
    return null;
  }

  return {
    user: {
      id: userRow.id,
      firebaseUid: supabaseUid, // kept for interface compatibility
      email: userRow.email ?? email,
    },
  };
}

// ── 2. requireCompanyAccess ────────────────────────────────────────────────────

/**
 * Verifies the authenticated user has an active role in the given company.
 * SUPER_ADMIN role bypasses the company membership check.
 *
 * Returns true on success, sends 403 and returns false otherwise.
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

  // SUPER_ADMIN in any company → full platform access
  const { data: superAdminRow } = await supabase
    .from('user_company_roles')
    .select('id')
    .eq('user_id', userId)
    .eq('role', 'SUPER_ADMIN')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (superAdminRow) return true;

  const { data: membership } = await supabase
    .from('user_company_roles')
    .select('id, role')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (!membership) {
    res.status(403).json({ error: 'Access denied — you are not a member of this company' });
    return false;
  }

  return true;
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
 * Extracts the authenticated internal user.id from the Bearer token.
 * Returns null if no valid token — does NOT send a response.
 */
export async function resolveActorId(req: NextApiRequest): Promise<string | null> {
  try {
    const verified = await verifySupabaseAuthHeader(req.headers.authorization);
    const { data: byUid } = await supabase
      .from('users')
      .select('id')
      .eq('supabase_uid', verified.id)
      .maybeSingle();
    if (byUid) return (byUid as any).id;
    const { data: byEmail } = await supabase
      .from('users')
      .select('id')
      .eq('email', verified.email)
      .maybeSingle();
    return (byEmail as any)?.id ?? null;
  } catch {
    return null;
  }
}
