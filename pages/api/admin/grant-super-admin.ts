import { NextApiRequest, NextApiResponse } from 'next';
import { createServiceRoleMigrationProxy } from '../../../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { requireAdminScope } from '../../../backend/services/requestAccessService';
import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ctx = await requireAdminScope(req, res, 'users:super-admin-grant');
  if (!ctx) return;
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[ADMIN_SCOPE]', '/api/admin/grant-super-admin', 'users:super-admin-grant');
  }

  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ 
        error: 'Missing required field: userId' 
      });
    }

    const { data, error } = await supabase.rpc('grant_super_admin', {
      p_target_user_id: userId,
      p_granted_by: ctx.id,
      p_expires_at: null // No expiration
    });

    if (error) {
      console.error('Error granting super admin:', error);
      return res.status(500).json({ 
        error: 'Failed to grant super admin privileges',
        details: error.message 
      });
    }

    return res.status(200).json(data);

  } catch (error) {
    console.error('Error in grant-super-admin API:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

export default applyAuthGuard({
  requiresAuth: true,
  requiredRole: 'SUPER_ADMIN',
  allowSuperAdminOverride: true,
})(handler);
