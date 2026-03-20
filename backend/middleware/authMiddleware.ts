/**
 * Centralised auth middleware for Next.js API routes.
 *
 * Replaces ad-hoc token checks spread across every endpoint.
 * Every function returns { user } on success or throws NextApiResponse-shaped errors
 * that the caller must respond with.
 *
 * Usage:
 *
 *   const { user } = await requireAuth(req, res);
 *   if (!user) return;   // response already sent
 *
 *   await requireCompanyAccess(user.id, companyId, res);
 *   if (res.writableEnded) return;
 *
 *   await requireSuperAdmin(req, res);
 *   if (res.writableEnded) return;
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient, type User } from '@supabase/supabase-js';
import { supabase } from '../db/supabaseClient';

// ── Supabase anon client factory ───────────────────────────────────────────────

function makeAnonClient(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

// ── 1. requireAuth ─────────────────────────────────────────────────────────────
/**
 * Validates the Bearer token in the Authorization header.
 * Returns the authenticated Supabase User or sends 401 and returns null.
 */
export async function requireAuth(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<{ user: User } | null> {
  const authHeader = req.headers.authorization ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

  if (!token) {
    res.status(401).json({ error: 'Authorization required' });
    return null;
  }

  const anonClient = makeAnonClient(token);
  const { data: { user }, error } = await anonClient.auth.getUser();

  if (error || !user) {
    res.status(401).json({ error: 'Invalid or expired session' });
    return null;
  }

  return { user };
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

  // SUPER_ADMIN in any company → full access (platform admin)
  const { data: superAdminRow } = await supabase
    .from('user_company_roles')
    .select('id')
    .eq('user_id', userId)
    .eq('role', 'SUPER_ADMIN')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (superAdminRow) return true;

  // Check membership in the specific company
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
 *
 * Accepts two paths (in priority order):
 *  1. Bearer JWT with `profiles.is_super_admin = true`
 *  2. `user_company_roles.role = 'SUPER_ADMIN'` for the authenticated user
 *
 * NOTE: The legacy `super_admin_session=1` cookie is intentionally NOT checked here.
 * That flow is being deprecated. Endpoints migrated to this middleware no longer
 * accept the unsigned cookie.
 *
 * Returns { user } on success, sends 401/403 and returns null otherwise.
 */
export async function requireSuperAdmin(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<{ user: User } | null> {
  const authResult = await requireAuth(req, res);
  if (!authResult) return null;

  const { user } = authResult;

  // Check profiles.is_super_admin
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_super_admin')
    .eq('id', user.id)
    .maybeSingle();

  if (profile?.is_super_admin) return { user };

  // Fallback: role-based check
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
 * Extracts the authenticated user.id from the Bearer token.
 * Returns null if no valid token — does NOT send a response.
 * Use for audit logging where identity is needed but auth is already checked.
 */
export async function resolveActorId(req: NextApiRequest): Promise<string | null> {
  const authHeader = req.headers.authorization ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  if (!token) return null;

  try {
    const anonClient = makeAnonClient(token);
    const { data: { user } } = await anonClient.auth.getUser();
    return user?.id ?? null;
  } catch {
    return null;
  }
}
