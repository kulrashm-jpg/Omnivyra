import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../utils/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { isSuperAdmin } from '../../../backend/services/rbacService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const superAdmin = await isSuperAdmin(user.id);
  if (!superAdmin) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ 
        error: 'Missing required field: userId' 
      });
    }

    // Revoke super admin role by setting is_active to false
    const { data, error } = await supabase
      .from('user_roles')
      .update({ 
        is_active: false,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId)
      .eq('role', 'super_admin');

    if (error) {
      console.error('Error revoking super admin:', error);
      return res.status(500).json({ 
        error: 'Failed to revoke super admin privileges',
        details: error.message 
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Super admin privileges revoked successfully',
      user_id: userId,
      revoked_at: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error in revoke-super-admin API:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}






