import { NextApiRequest, NextApiResponse } from 'next';
import { evaluateViralityGate } from '../../../../../backend/services/viralityGateService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Campaign ID is required' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const gateResult = await evaluateViralityGate(id);
    return res.status(200).json(gateResult);
  } catch (error: any) {
    console.error('Error in virality gate API:', error);
    return res.status(500).json({ error: 'Failed to evaluate virality gate' });
  }
}
