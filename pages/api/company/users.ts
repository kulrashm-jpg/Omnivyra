import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { getUserRole, hasPermission, isSuperAdmin, Role } from '../../../backend/services/rbacService';

const mapAppRoleToRbac = (role: string): Role | null => {
  const normalized = role.toUpperCase();
  if (normalized === 'COMPANY_ADMIN') return Role.COMPANY_ADMIN;
  if (normalized === 'USER') return Role.CONTENT_CREATOR;
  return null;
};

const ensureCompanyAccess = async (
  req: NextApiRequest,
  res: NextApiResponse,
  companyId: string
): Promise<{ userId: string; role: Role | null } | null> => {
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (error || !user) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return null;
  }

  const superAdmin = await isSuperAdmin(user.id);
  if (superAdmin) {
    return { userId: user.id, role: Role.SUPER_ADMIN };
  }

  const { role, error: roleError } = await getUserRole(user.id, companyId);
  if (roleError) {
    res.status(403).json({ error: 'FORBIDDEN_ROLE' });
    return null;
  }
  if (!role) {
    res.status(403).json({ error: 'FORBIDDEN_ROLE' });
    return null;
  }

  return { userId: user.id, role };
};

const ensureCompanyAdminAccess = async (
  req: NextApiRequest,
  res: NextApiResponse,
  companyId: string
): Promise<{ userId: string; role: Role } | null> => {
  const access = await ensureCompanyAccess(req, res, companyId);
  if (!access) return null;
  if (access.role === Role.SUPER_ADMIN) {
    return { userId: access.userId, role: Role.SUPER_ADMIN };
  }
  if (!access.role || !(await hasPermission(access.role, 'CREATE_USER'))) {
    try {
      await supabase.from('audit_logs').insert({
        actor_user_id: access.userId,
        action: 'PERMISSION_DENIED',
        company_id: companyId,
        metadata: { action: 'CREATE_USER' },
        created_at: new Date().toISOString(),
      });
    } catch (error) {
      console.warn('AUDIT_LOG_FAILED', error);
    }
    res.status(403).json({ error: 'PERMISSION_DENIED' });
    return null;
  }
  return { userId: access.userId, role: access.role };
};

const ensureAuthAdmin = () => {
  const admin = supabase.auth?.admin;
  if (!admin) {
    throw new Error('AUTH_ADMIN_UNAVAILABLE');
  }
  return admin;
};

const findExistingUserByEmail = async (email: string) => {
  const admin = ensureAuthAdmin();
  if (typeof (admin as any).getUserByEmail === 'function') {
    const { data, error } = await (admin as any).getUserByEmail(email);
    if (error) {
      throw new Error(error.message);
    }
    if (data?.user) {
      return data.user;
    }
  }
  const { data: users, error } = await admin.listUsers();
  if (error) {
    throw new Error(error.message);
  }
  return users?.users?.find((user: { email?: string }) => user.email?.toLowerCase() === email.toLowerCase()) || null;
};

const normalizeInviteRole = (role: string) => {
  const upper = role.toUpperCase();
  if (upper === 'ADMIN') return Role.COMPANY_ADMIN;
  if (upper === 'CONTENT_MANAGER') return Role.CONTENT_CREATOR;
  if (upper === 'CONTENT_PLANNER') return Role.CONTENT_CREATOR;
  if (upper === 'CONTENT_ENGAGER') return Role.VIEW_ONLY;
  if (upper === 'VIEWER') return Role.VIEW_ONLY;
  return upper;
};

const upsertUserCompanyRole = async (
  userId: string,
  companyId: string,
  role: string,
  name?: string | null
) => {
  const { data: existing, error: existingError } = await supabase
    .from('user_company_roles')
    .select('id, role')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .limit(1);

  if (existingError) {
    return { error: existingError.message };
  }

  if (existing && existing.length > 0) {
    const row = existing[0];
    const updates: Record<string, any> = {
      role,
      status: 'invited',
      invited_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (name) {
      updates.name = name;
    }
    if (row.role !== role) {
      updates.role = role;
    }
    const { error } = await supabase.from('user_company_roles').update(updates).eq('id', row.id);
    if (error) {
      return { error: error.message };
    }
    return { error: null };
  }

  const { error } = await supabase.from('user_company_roles').insert({
    user_id: userId,
    company_id: companyId,
    role,
    created_at: new Date().toISOString(),
    status: 'invited',
    invited_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    name: name || null,
  });
  if (error) {
    return { error: error.message };
  }
  return { error: null };
};

const insertAuditLog = async (input: {
  actorUserId: string;
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

const addExistingUserToCompany = async (input: {
  userId: string;
  companyId: string;
  role: string;
  name: string;
  actorUserId: string;
}) => {
  const { error: upsertError } = await upsertUserCompanyRole(
    input.userId,
    input.companyId,
    input.role,
    input.name
  );
  if (upsertError) {
    return { error: 'FAILED_TO_ASSIGN_ROLE', details: upsertError };
  }
  const { error: activateError } = await supabase
    .from('user_company_roles')
    .update({
      status: 'active',
      accepted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      name: input.name || null,
    })
    .eq('user_id', input.userId)
    .eq('company_id', input.companyId);
  if (activateError) {
    return { error: 'FAILED_TO_ACTIVATE_USER', details: activateError.message };
  }
  await insertAuditLog({
    actorUserId: input.actorUserId,
    action: 'ADD_EXISTING_USER',
    targetUserId: input.userId,
    companyId: input.companyId,
  });
  return { error: null };
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const companyId =
    (req.query.companyId as string | undefined) ||
    (req.body?.companyId as string | undefined);

  if (!companyId) {
    return res.status(400).json({ error: 'companyId required' });
  }

  if (req.method === 'GET') {
    const access = await ensureCompanyAccess(req, res, companyId);
    if (!access) return;

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const { data, error } = await supabase
      .from('user_company_roles')
      .select(
        `
          user_id,
          role,
          status,
          invited_at,
          accepted_at,
          name,
          created_at
        `
      )
      .eq('company_id', companyId)
      ;

    if (error) {
      console.warn('FAILED_TO_LIST_USERS', error.message);
      return res.status(500).json({ error: 'FAILED_TO_LIST_USERS', details: error.message });
    }

    const admin = ensureAuthAdmin();
    const userIds = (data || [])
      .map((row: any) => row.user_id)
      .filter(Boolean);
    const emailById = new Map<string, string>();
    if (userIds.length > 0) {
      if (typeof (admin as any).getUserById === 'function') {
        await Promise.all(
          userIds.map(async (id: string) => {
            const { data: userData, error: userError } = await (admin as any).getUserById(id);
            if (!userError && userData?.user?.email) {
              emailById.set(id, userData.user.email);
            }
          })
        );
      } else {
        const { data: userList, error: listError } = await admin.listUsers();
        if (!listError && userList?.users?.length) {
          userList.users.forEach((user: { id?: string; email?: string }) => {
            if (user?.id && user.email) {
              emailById.set(user.id, user.email);
            }
          });
        }
      }
    }

    const users = (data || []).map((row: any) => {
      const email = emailById.get(row.user_id) || '';
      return {
        user_id: row.user_id,
        email,
        role: row.role,
        status: row.status || 'active',
        invited_at: row.invited_at,
        accepted_at: row.accepted_at,
        name: row.name || (email ? email.split('@')[0] : ''),
        created_at: row.created_at,
      };
    });

    return res.status(200).json({ users });
  }

  if (req.method === 'POST') {
    const access = await ensureCompanyAdminAccess(req, res, companyId);
    if (!access) return;
    const { email, role, name } = req.body || {};
    if (!email || !role) {
      return res.status(400).json({ error: 'email and role are required' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const desiredRole = normalizeInviteRole(String(role));
    const displayName = name ? String(name).trim() : '';
    const allowedRoles = [
      Role.COMPANY_ADMIN,
      Role.CONTENT_CREATOR,
      Role.CONTENT_REVIEWER,
      Role.CONTENT_PUBLISHER,
      Role.VIEW_ONLY,
    ];
    if (!(allowedRoles as readonly string[]).includes(desiredRole)) {
      return res.status(400).json({ error: 'ROLE_NOT_ALLOWED' });
    }

    try {
      const existingUser = await findExistingUserByEmail(normalizedEmail);
      if (existingUser && !existingUser.email_confirmed_at) {
        const { error } = await supabase.auth.admin.inviteUserByEmail(normalizedEmail, {
          redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard`,
        });
        if (error?.status === 429) {
          return res.status(200).json({
            message: 'Invite already sent recently. Please wait before retrying.',
          });
        }
        if (error) {
          if (error.message?.toLowerCase().includes('expired')) {
            await supabase
              .from('user_company_roles')
              .update({ status: 'expired', updated_at: new Date().toISOString() })
              .eq('user_id', existingUser.id)
              .eq('company_id', companyId);
          }
          await insertAuditLog({
            actorUserId: access.userId,
            action: 'INVITE_FAILED',
            targetUserId: existingUser.id,
            companyId,
            metadata: { error: error.message, status: error.status, code: error.code },
          });
          return res.status(400).json({ error: error.message });
        }
        const { error: roleUpdateError } = await supabase
          .from('user_company_roles')
          .update({
            status: 'invited',
            invited_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            name: displayName || null,
          })
          .eq('user_id', existingUser.id)
          .eq('company_id', companyId);
        if (roleUpdateError) {
          return res.status(500).json({ error: 'FAILED_TO_UPDATE_INVITE', details: roleUpdateError.message });
        }
        await insertAuditLog({
          actorUserId: access.userId,
          action: 'INVITE_USER',
          targetUserId: existingUser.id,
          companyId,
          metadata: { reinvite: true },
        });
        return res.status(200).json({ message: 'Reinvite sent' });
      }
      if (existingUser && existingUser.email_confirmed_at) {
        const result = await addExistingUserToCompany({
          userId: existingUser.id,
          companyId,
          role: desiredRole,
          name: displayName,
          actorUserId: access.userId,
        });
        if (result.error) {
          return res.status(500).json(result);
        }
        return res.status(200).json({ message: 'User already registered. Added to team.' });
      }

      const { data, error } = await supabase.auth.admin.inviteUserByEmail(normalizedEmail, {
        redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard`,
      });

      if (error?.status === 429) {
        return res.status(200).json({
          message: 'Invite already sent recently. Please wait before retrying.',
        });
      }
      if (error) {
        const message = error.message?.toLowerCase() || '';
        const alreadyRegistered =
          message.includes('already been registered') ||
          message.includes('already registered') ||
          error.code === 'email_exists';
        if (alreadyRegistered) {
          const confirmedUser = await findExistingUserByEmail(normalizedEmail);
          if (confirmedUser?.id) {
            const result = await addExistingUserToCompany({
              userId: confirmedUser.id,
              companyId,
              role: desiredRole,
              name: displayName,
              actorUserId: access.userId,
            });
            if (result.error) {
              return res.status(500).json(result);
            }
            return res.status(200).json({ message: 'User already registered. Added to team.' });
          }
        }
        await insertAuditLog({
          actorUserId: access.userId,
          action: 'INVITE_FAILED',
          companyId,
          metadata: { error: error.message, status: error.status, code: error.code },
        });
        return res.status(400).json({ error: error.message });
      }

      let invitedUserId = data?.user?.id;
      if (!invitedUserId) {
        const newlyFound = await findExistingUserByEmail(normalizedEmail);
        invitedUserId = newlyFound?.id || null;
      }
      if (invitedUserId) {
        const { error: upsertError } = await upsertUserCompanyRole(
          invitedUserId,
          companyId,
          desiredRole,
          displayName
        );
        if (upsertError) {
          return res.status(500).json({ error: 'FAILED_TO_ASSIGN_ROLE', details: upsertError });
        }
        await insertAuditLog({
          actorUserId: access.userId,
          action: 'INVITE_USER',
          targetUserId: invitedUserId,
          companyId,
        });
      }

      return res.status(201).json({ success: true });
    } catch (error: any) {
      await insertAuditLog({
        actorUserId: access.userId,
        action: 'INVITE_FAILED',
        companyId,
        metadata: { error: error?.message || 'FAILED_TO_INVITE_USER' },
      });
      return res.status(400).json({ error: error?.message || 'FAILED_TO_INVITE_USER' });
    }
  }

  if (req.method === 'PUT') {
    const access = await ensureCompanyAdminAccess(req, res, companyId);
    if (!access) return;
    const { userId, role, status } = req.body || {};
    if (!userId || !role) {
      return res.status(400).json({ error: 'userId and role are required' });
    }
    const desiredRole = normalizeInviteRole(String(role));
    const allowedRoles = [
      Role.COMPANY_ADMIN,
      Role.CONTENT_CREATOR,
      Role.CONTENT_REVIEWER,
      Role.CONTENT_PUBLISHER,
      Role.VIEW_ONLY,
    ];
    if (!(allowedRoles as readonly string[]).includes(desiredRole)) {
      return res.status(400).json({ error: 'ROLE_NOT_ALLOWED' });
    }

    if (!(await hasPermission(access.role, 'ASSIGN_ROLE'))) {
      await insertAuditLog({
        actorUserId: access.userId,
        action: 'PERMISSION_DENIED',
        targetUserId: userId,
        companyId,
        metadata: { action: 'ASSIGN_ROLE' },
      });
      return res.status(403).json({ error: 'PERMISSION_DENIED' });
    }

    const updates: Record<string, any> = {
      role: desiredRole,
      updated_at: new Date().toISOString(),
    };
    if (status) {
      updates.status = status;
      if (status === 'inactive' || status === 'deactivated') {
        updates.deactivated_at = new Date().toISOString();
      }
      if (status === 'active') {
        updates.accepted_at = new Date().toISOString();
      }
    }

    const { error } = await supabase
      .from('user_company_roles')
      .update(updates)
      .eq('user_id', userId)
      .eq('company_id', companyId);

    if (error) {
      return res.status(500).json({ error: 'FAILED_TO_UPDATE_ROLE', details: error.message });
    }

    await insertAuditLog({
      actorUserId: access.userId,
      action: status === 'inactive' ? 'DEACTIVATE_USER' : 'UPDATE_USER_ROLE',
      targetUserId: userId,
      companyId,
      metadata: { role: desiredRole, status: status || null },
    });

    return res.status(200).json({ success: true });
  }

  if (req.method === 'DELETE') {
    const access = await ensureCompanyAdminAccess(req, res, companyId);
    if (!access) return;
    const { userId } = req.body || {};
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    if (!(await hasPermission(access.role, 'ASSIGN_ROLE'))) {
      await insertAuditLog({
        actorUserId: access.userId,
        action: 'PERMISSION_DENIED',
        targetUserId: userId,
        companyId,
        metadata: { action: 'REMOVE_USER' },
      });
      return res.status(403).json({ error: 'PERMISSION_DENIED' });
    }

    const { error } = await supabase
      .from('user_company_roles')
      .delete()
      .eq('user_id', userId)
      .eq('company_id', companyId);

    if (error) {
      return res.status(500).json({ error: 'FAILED_TO_REMOVE_USER', details: error.message });
    }

    await insertAuditLog({
      actorUserId: access.userId,
      action: 'REMOVE_USER',
      targetUserId: userId,
      companyId,
    });

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
