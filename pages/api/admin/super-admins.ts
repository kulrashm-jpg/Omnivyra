import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../utils/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get all super admins
    const { data: superAdmins, error } = await supabase
      .from('user_roles')
      .select(`
        user_id,
        role,
        granted_at,
        expires_at,
        is_active,
        users!inner(
          id,
          name,
          email,
          created_at,
          last_login
        )
      `)
      .eq('role', 'super_admin')
      .eq('is_active', true);

    if (error) {
      console.error('Error fetching super admins:', error);
      return res.status(500).json({ 
        error: 'Failed to fetch super admins',
        details: error.message 
      });
    }

    // Format the response
    const formattedAdmins = superAdmins.map(admin => ({
      id: admin.users.id,
      name: admin.users.name,
      email: admin.users.email,
      role: admin.role,
      status: 'active', // You can determine this based on last_login
      lastActive: admin.users.last_login ? 
        new Date(admin.users.last_login).toLocaleString() : 'Never',
      createdAt: admin.users.created_at,
      isSuperAdmin: true,
      grantedAt: admin.granted_at,
      expiresAt: admin.expires_at
    }));

    return res.status(200).json({
      success: true,
      admins: formattedAdmins
    });

  } catch (error) {
    console.error('Error in super-admins API:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}






