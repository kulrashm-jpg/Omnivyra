import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../utils/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ 
        error: 'Missing required field: userId' 
      });
    }

    // Get current user ID (you'll need to implement proper auth)
    const currentUserId = 'current-user-id'; // Replace with actual user ID from auth

    // Call the grant super admin function
    const { data, error } = await supabase.rpc('grant_super_admin', {
      p_target_user_id: userId,
      p_granted_by: currentUserId,
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






