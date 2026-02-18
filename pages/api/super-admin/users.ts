import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { isPlatformSuperAdmin } from '../../../backend/services/rbacService';
import { Role, ALL_ROLES } from '../../../backend/services/rbacService';

const requireSuperAdminAccess = async (
  req: NextApiRequest,
  res: NextApiResponse
): Promise<boolean> => {
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (!error && user?.id) {
    const isAdmin = await isPlatformSuperAdmin(user.id);
    if (!isAdmin) {
      res.status(403).json({ error: 'FORBIDDEN_ROLE' });
      return false;
    }
    return true;
  }
  const hasSession = req.cookies?.super_admin_session === '1';
  if (hasSession) {
    console.debug('SUPER_ADMIN_LEGACY_SESSION', { path: req.url });
    return true;
  }
  res.status(403).json({ error: 'NOT_AUTHORIZED' });
  return false;
};

const ensureAuthAdmin = () => {
  const admin = supabase.auth?.admin;
  if (!admin) {
    throw new Error('AUTH_ADMIN_UNAVAILABLE');
  }
  return admin;
};

const allowedRoles = ALL_ROLES.filter((role) => role !== Role.SUPER_ADMIN);
const isAllowedRole = (value?: string | null) => {
  if (!value) return false;
  return (allowedRoles as readonly string[]).includes(value.toUpperCase());
};

const getOrInviteUser = async (email: string) => {
  const admin = ensureAuthAdmin();
  const { data: invited, error: inviteError } = await admin.inviteUserByEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard`,
  });
  if (!inviteError && invited?.user) {
    return { user: invited.user, error: null };
  }
  if (inviteError?.message?.toLowerCase().includes('already')) {
    const { data: existing, error: existingError } = await (admin as any).listUsers({ email });
    if (existingError) {
      return { user: null, error: existingError.message };
    }
    const existingUser = existing?.users?.[0] || null;
    if (existingUser) {
      return { user: existingUser, error: null };
    }
  }
  return { user: null, error: inviteError?.message || 'FAILED_TO_INVITE_USER' };
};

const upsertUserCompanyRole = async (userId: string, companyId: string, role: string) => {
  const { data: existing } = await supabase
    .from('user_company_roles')
    .select('id, role, status')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .limit(1);

  if (existing && existing.length > 0) {
    const row = existing[0];
    if (row.role !== role) {
      const { error } = await supabase
        .from('user_company_roles')
        .update({ role, updated_at: new Date().toISOString() })
        .eq('id', row.id);
      if (error) {
        return { ok: false, error: error.message };
      }
    }
    return { ok: true };
  }

  const { error } = await supabase.from('user_company_roles').insert({
    user_id: userId,
    company_id: companyId,
    role,
    created_at: new Date().toISOString(),
    status: 'invited',
    invited_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
};

const insertAuditLog = async (input: {
  actorUserId: string | null;
  action: string;
  targetUserId?: string | null;
  companyId?: string | null;
  metadata?: Record<string, any>;
}) => {
  try {
    await supabase.from('audit_logs').insert({
      actor_user_id: input.actorUserId,
      action: input.action,
      target_user_id: input.targetUserId || null,
      company_id: input.companyId || null,
      metadata: input.metadata || null,
      created_at: new Date().toISOString(),
    });
  } catch (error) {
    console.warn('AUDIT_LOG_FAILED', error);
  }
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireSuperAdminAccess(req, res))) return;

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('user_company_roles')
      .select('user_id, role, company_id, status, created_at')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[super-admin/users] user_company_roles error:', error);
      return res.status(500).json({
        error: 'FAILED_TO_LIST_USERS',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }

    const rows = data || [];
    const userIds = Array.from(new Set(rows.map((row) => row.user_id).filter(Boolean)));
    const companyIds = Array.from(new Set(rows.map((row) => row.company_id).filter(Boolean)));

    const [usersResult, companiesResult, profilesResult] = await Promise.all([
      supabase.from('users').select('id, email, created_at'),
      companyIds.length > 0
        ? supabase.from('companies').select('id, name').in('id', companyIds)
        : Promise.resolve({ data: [], error: null }),
      companyIds.length > 0
        ? supabase.from('company_profiles').select('company_id, name').in('company_id', companyIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (usersResult.error) {
      return res.status(500).json({ error: 'FAILED_TO_LIST_USERS', details: usersResult.error.message });
    }
    if (companiesResult.error) {
      return res.status(500).json({ error: 'FAILED_TO_LIST_COMPANIES', details: companiesResult.error.message });
    }

    let authFallbackUsers: Array<{ id: string; email: string; created_at?: string | null }> = [];
    if ((!usersResult.data || usersResult.data.length === 0) && supabase.auth?.admin) {
      try {
        const { data: authUsers } = await supabase.auth.admin.listUsers();
        authFallbackUsers = (authUsers?.users || []).map((user) => ({
          id: user.id,
          email: user.email || '',
          created_at: user.created_at,
        }));
      } catch (authError) {
        console.warn('FAILED_TO_LOAD_AUTH_USERS', authError);
      }
    }

    const emailByUserId = [...(usersResult.data || []), ...authFallbackUsers].reduce<Record<string, string>>(
      (acc, user) => {
        acc[user.id] = user.email || '';
        return acc;
      },
      {}
    );
    const nameByCompanyId = (companiesResult.data || []).reduce<Record<string, string>>((acc, company) => {
      acc[company.id] = company.name || '';
      return acc;
    }, {});
    if (profilesResult.data) {
      profilesResult.data.forEach((profile) => {
        if (profile.company_id && !nameByCompanyId[profile.company_id]) {
          nameByCompanyId[profile.company_id] = profile.name || '';
        }
      });
    }

    const usersFromRoles = rows.map((row) => ({
      user_id: row.user_id,
      email: emailByUserId[row.user_id] || '',
      role: row.role,
      status: row.status || null,
      company_id: row.company_id,
      company_name: nameByCompanyId[row.company_id] || '',
      created_at: row.created_at,
    }));

    const roleUserIds = new Set(usersFromRoles.map((row) => row.user_id));
    const standaloneUsers = [...(usersResult.data || []), ...authFallbackUsers]
      .filter((user) => user.id && !roleUserIds.has(user.id))
      .map((user) => ({
        user_id: user.id,
        email: user.email || '',
        role: 'UNASSIGNED',
        status: null,
        company_id: null,
        company_name: '',
        created_at: user.created_at || null,
      }));

    const users = [...usersFromRoles, ...standaloneUsers].sort((a, b) =>
      String(b.created_at || '').localeCompare(String(a.created_at || ''))
    );

    return res.status(200).json({ users });
  }

  if (req.method === 'POST') {
    try {
      const { email, companyId, role } = req.body || {};
      console.log('[super-admin/users] request body', { email, companyId, role });
      if (!email || !companyId) {
        return res.status(400).json({ error: 'email and companyId are required' });
      }

      const normalizedEmail = String(email).trim().toLowerCase();
      const desiredRole = String(role || Role.COMPANY_ADMIN).toUpperCase();
      if (!isAllowedRole(desiredRole)) {
        return res.status(400).json({ error: 'ROLE_NOT_ALLOWED' });
      }

      const inviteResult = await getOrInviteUser(normalizedEmail);
      console.log('[super-admin/users] invite result', {
        userId: inviteResult.user?.id || null,
        email: inviteResult.user?.email || null,
        error: inviteResult.error,
      });
      if (inviteResult.error || !inviteResult.user) {
        return res.status(500).json({ error: inviteResult.error || 'FAILED_TO_INVITE_USER' });
      }

      const { error: userInsertError } = await supabase.from('users').upsert(
        {
          id: inviteResult.user.id,
          email: inviteResult.user.email || normalizedEmail,
          name: normalizedEmail.split('@')[0] || 'User',
          created_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      );
      console.log('[super-admin/users] users upsert', {
        userId: inviteResult.user.id,
        userInsertError,
      });
      if (userInsertError) {
        return res.status(500).json({ error: 'FAILED_TO_SAVE_USER', details: userInsertError.message });
      }

      const roleResult = await upsertUserCompanyRole(inviteResult.user.id, companyId, desiredRole);
      console.log('[super-admin/users] role upsert', {
        userId: inviteResult.user.id,
        companyId,
        role: desiredRole,
        error: roleResult.ok ? null : roleResult.error,
      });
      if (!roleResult.ok) {
        return res.status(500).json({ error: 'FAILED_TO_ASSIGN_ROLE', details: roleResult.error });
      }

      await insertAuditLog({
        actorUserId: null,
        action: 'SUPER_ADMIN_INVITE',
        targetUserId: inviteResult.user.id,
        companyId,
        metadata: { role: desiredRole },
      });

      return res.status(201).json({
        user: {
          id: inviteResult.user.id,
          email: inviteResult.user.email || normalizedEmail,
          company_id: companyId,
          role: desiredRole,
        },
      });
    } catch (error: any) {
      console.error('[super-admin/users] unexpected error', error);
      return res.status(500).json({
        error: 'INTERNAL_SERVER_ERROR',
        details: error?.message || String(error),
      });
    }
  }

  if (req.method === 'PATCH') {
    const { userId, companyId, status, role } = req.body || {};
    if (!userId || !companyId) {
      return res.status(400).json({ error: 'userId and companyId are required' });
    }
    if (!status && !role) {
      return res.status(400).json({ error: 'status or role is required' });
    }

    const updatePayload: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };
    let normalizedStatus: string | null = null;
    if (status) {
      normalizedStatus = String(status);
      if (!['active', 'inactive'].includes(normalizedStatus)) {
        return res.status(400).json({ error: 'INVALID_STATUS' });
      }
      updatePayload.status = normalizedStatus;
      if (normalizedStatus === 'inactive') {
        updatePayload.deactivated_at = new Date().toISOString();
      } else {
        updatePayload.deactivated_at = null;
      }
    }
    if (role) {
      const normalizedRole = String(role).toUpperCase();
      if (!isAllowedRole(normalizedRole)) {
        return res.status(400).json({ error: 'ROLE_NOT_ALLOWED' });
      }
      updatePayload.role = normalizedRole;
    }

    const { data, error } = await supabase
      .from('user_company_roles')
      .update(updatePayload)
      .eq('user_id', userId)
      .eq('company_id', companyId)
      .select('user_id, company_id, status, role')
      .single();

    if (error || !data) {
      return res.status(500).json({ error: 'FAILED_TO_UPDATE_USER' });
    }

    await insertAuditLog({
      actorUserId: null,
      action: 'SUPER_ADMIN_USER_UPDATE',
      targetUserId: userId,
      companyId,
      metadata: {
        ...(normalizedStatus ? { status: normalizedStatus } : {}),
        ...(updatePayload.role ? { role: updatePayload.role } : {}),
      },
    });

    return res.status(200).json({ user: data });
  }

  if (req.method === 'DELETE') {
    const { userId, companyId } = req.body || {};
    if (!userId || !companyId) {
      return res.status(400).json({ error: 'userId and companyId are required' });
    }

    const { error } = await supabase
      .from('user_company_roles')
      .delete()
      .eq('user_id', userId)
      .eq('company_id', companyId);

    if (error) {
      return res.status(500).json({ error: 'FAILED_TO_DELETE_USER' });
    }

    await insertAuditLog({
      actorUserId: null,
      action: 'SUPER_ADMIN_USER_DELETE',
      targetUserId: userId,
      companyId,
    });

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
