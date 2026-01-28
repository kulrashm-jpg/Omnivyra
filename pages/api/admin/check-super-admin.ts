import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../utils/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get current user ID (you'll need to implement proper auth)
    const userId = 'current-user-id'; // Replace with actual user ID from auth

    // Check if user is super admin
    const { data, error } = await supabase.rpc('is_super_admin', {
      check_user_id: userId
    });

    if (error) {
      console.error('Error checking super admin status:', error);
      return res.status(500).json({ 
        error: 'Failed to check super admin status',
        details: error.message 
      });
    }

    return res.status(200).json({
      success: true,
      isSuperAdmin: data || false,
      userId: userId
    });

  } catch (error) {
    console.error('Error in check-super-admin API:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}






