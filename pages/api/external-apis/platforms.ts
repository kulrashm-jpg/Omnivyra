import { NextApiRequest, NextApiResponse } from 'next';
import { getPlatformStrategies } from '../../../backend/services/externalApiService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const strategies = await getPlatformStrategies();
    const grouped = strategies.reduce((acc: Record<string, any[]>, item: any) => {
      const key = item.platform_type || 'unknown';
      if (!acc[key]) acc[key] = [];
      acc[key].push(item);
      return acc;
    }, {});
    return res.status(200).json({ platforms: grouped });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to load platform configs' });
  }
}
