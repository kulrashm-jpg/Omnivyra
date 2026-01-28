import { NextApiRequest, NextApiResponse } from 'next';
import { fetchTrendsFromApis } from '../../../backend/services/externalApiService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const geo = typeof req.query.geo === 'string' ? req.query.geo : undefined;
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const trends = await fetchTrendsFromApis(geo, category, { recordHealth: true, minReliability: 0.3 });
    return res.status(200).json({ trends });
  } catch (error: any) {
    console.error('Error fetching trends:', error);
    return res.status(500).json({ error: 'Failed to fetch trend signals' });
  }
}
