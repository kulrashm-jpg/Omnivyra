import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { getUserRole, isSuperAdmin, Role } from '../../../../backend/services/rbacService';

const ensureCompanyAdminAccess = async (
  req: NextApiRequest,
  res: NextApiResponse,
  companyId: string
): Promise<{ userId: string } | null> => {
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (error || !user) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return null;
  }

  const superAdmin = await isSuperAdmin(user.id);
  if (superAdmin) {
    return { userId: user.id };
  }

  const { role, error: roleError } = await getUserRole(user.id, companyId);
  if (roleError || !role) {
    res.status(403).json({ error: 'FORBIDDEN_ROLE' });
    return null;
  }
  if (role !== Role.ADMIN) {
    res.status(403).json({ error: 'NOT_AUTHORIZED' });
    return null;
  }
  return { userId: user.id };
};

const sendInvite = async (email: string) => {
  const admin = supabase.auth?.admin;
  if (!admin) {
    throw new Error('AUTH_ADMIN_UNAVAILABLE');
  }
  const { data: inviteData, error: inviteError } = await admin.inviteUserByEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard`,
  });
  if (inviteError) {
    throw new Error(inviteError.message);
  }
  return inviteData?.user || null;
};

const findExistingUserByEmail = async (email: string) => {
  const admin = supabase.auth?.admin;
  if (!admin) {
    throw new Error('AUTH_ADMIN_UNAVAILABLE');
  }
  const { data: existingUsers, error } = await admin.listUsers();
  if (error) {
    throw new Error(error.message);
  }
  return existingUsers?.users?.find((user) => user.email?.toLowerCase() === email.toLowerCase()) || null;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, companyId } = req.body || {};
  if (!email || !companyId) {
    return res.status(400).json({ error: 'email and companyId are required' });
  }

  const access = await ensureCompanyAdminAccess(req, res, companyId);
  if (!access) return;

  const normalizedEmail = String(email).trim().toLowerCase();

  try {
    const existingUser = await findExistingUserByEmail(normalizedEmail);
    let userId = existingUser?.id || null;
    let role = 'CONTENT_CREATOR';

    if (userId) {
      const { data: existingRoleRows } = await supabase
        .from('user_company_roles')
        .select('role')
        .eq('user_id', userId)
        .eq('company_id', companyId)
        .limit(1);
      if (existingRoleRows && existingRoleRows.length > 0) {
        role = existingRoleRows[0].role || role;
      }

      await supabase.from('user_company_roles').delete().eq('user_id', userId).eq('company_id', companyId);
    }

    const invitedUser = await sendInvite(normalizedEmail);
    if (invitedUser?.id) {
      userId = invitedUser.id;
    }

    if (!userId) {
      return res.status(400).json({ error: 'FAILED_TO_INVITE_USER' });
    }

    await supabase.from('user_company_roles').insert({
      user_id: userId,
      company_id: companyId,
      role,
      status: 'invited',
      created_at: new Date().toISOString(),
    });

    return res.status(200).json({ success: true });
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || 'FAILED_TO_REINVITE_USER' });
  }
}
