import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../utils/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { data, error } = await supabase
      .from('user_company_roles')
      .select('user_id, role, company_id, created_at')
      .eq('role', 'SUPER_ADMIN');

    if (error) {
      console.error('Error fetching super admins:', error);
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      success: true,
      admins: data || [],
    });
  } catch (error) {
    console.error('Error in super-admins API:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}






