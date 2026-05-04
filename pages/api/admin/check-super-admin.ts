import { NextApiRequest, NextApiResponse } from 'next';
import { requireAdminScope } from '../../../backend/services/requestAccessService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const ctx = await requireAdminScope(req, res, 'users:list-external');
    if (!ctx) return;

    return res.status(200).json({
      success: true,
      isSuperAdmin: true,
      userId: ctx.id,
    });

  } catch (error) {
    console.error('Error in check-super-admin API:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}
