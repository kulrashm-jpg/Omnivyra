import type { NextApiRequest, NextApiResponse } from 'next';
import { rotateWordPressPluginToken } from '../../../backend/services/wordpressPluginService';

function bearer(req: NextApiRequest): string {
  const header = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const token = bearer(req) || String(req.body?.access_token || '');
  if (!token) return res.status(401).json({ error: 'Plugin bearer token is required' });
  const result = await rotateWordPressPluginToken({ accessToken: token });
  if (!result.accepted) return res.status(401).json({ error: 'Invalid plugin token' });
  return res.status(200).json(result);
}
