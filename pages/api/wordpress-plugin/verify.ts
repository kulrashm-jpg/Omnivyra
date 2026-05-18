import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyWordPressPlugin } from '../../../backend/services/wordpressPluginService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { registration_id, nonce } = req.body || {};
  if (!registration_id || !nonce) return res.status(400).json({ error: 'registration_id and nonce are required' });
  const verified = await verifyWordPressPlugin({ registrationId: String(registration_id), nonce: String(nonce) });
  return res.status(200).json({ verified });
}
