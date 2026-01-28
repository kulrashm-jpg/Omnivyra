import { NextApiRequest, NextApiResponse } from 'next';
import { assessVirality } from '../../../../../backend/services/viralityAdvisorService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Campaign ID is required' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const assessment = await assessVirality(id);
    return res.status(200).json(assessment);
  } catch (error: any) {
    console.error('Error in virality assess API:', error);
    return res.status(500).json({ error: 'Failed to assess virality' });
  }
}
