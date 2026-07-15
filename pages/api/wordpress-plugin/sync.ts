import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { syncWordPressPluginEvent } from '../../../backend/services/wordpressPluginService';

function bearer(req: NextApiRequest): string {
  const header = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const token = bearer(req) || String(req.body?.access_token || '');
  const { event_type, payload, idempotency_key } = req.body || {};
  if (!token) return res.status(401).json({ error: 'Plugin bearer token is required' });
  if (!event_type) return res.status(400).json({ error: 'event_type is required' });
  const result = await syncWordPressPluginEvent({
    accessToken: token,
    eventType: String(event_type),
    payload: typeof payload === 'object' && payload !== null ? payload : {},
    idempotencyKey: typeof idempotency_key === 'string' ? idempotency_key : null,
    nonce: typeof req.headers['x-omnivera-nonce'] === 'string' ? req.headers['x-omnivera-nonce'] : null,
    timestamp: typeof req.headers['x-omnivera-timestamp'] === 'string' ? req.headers['x-omnivera-timestamp'] : null,
  });
  if (!result.accepted) return res.status(401).json({ error: 'Invalid plugin token' });
  return res.status(202).json(result);
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/wordpress-plugin/sync' });
