import type { NextApiRequest, NextApiResponse } from 'next';
import { recordWordPressPluginHeartbeat } from '../../../backend/services/wordpressPluginService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { registration_id, metadata } = req.body || {};
  if (!registration_id) return res.status(400).json({ error: 'registration_id is required' });
  await recordWordPressPluginHeartbeat({
    registrationId: String(registration_id),
    metadata: typeof metadata === 'object' && metadata !== null ? metadata : {},
  });
  return res.status(200).json({ ok: true });
}
