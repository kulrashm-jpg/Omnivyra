import { NextApiRequest, NextApiResponse } from 'next';
import { validateExternalApiSource } from '../../../../backend/services/externalApiService';
import { Role } from '../../../../backend/services/rbacService';
import { withRBAC } from '../../../../backend/middleware/withRBAC';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'API ID is required' });
  }

  try {
    const health = await validateExternalApiSource(id);
    return res.status(200).json({
      ok: true,
      freshness_score: health?.freshness_score ?? 1,
      reliability_score: health?.reliability_score ?? 1,
    });
  } catch (error: any) {
    return res.status(500).json({
      error: 'Failed to validate API',
      detail: error?.message ?? String(error),
    });
  }
}

export default withRBAC(handler, [Role.SUPER_ADMIN]);
