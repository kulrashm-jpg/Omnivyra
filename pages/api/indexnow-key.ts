import { createApiRoute as __createApiRoute } from '../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { getCanonicalAppUrl } from '../../backend/config/getCanonicalAppUrl';
import { indexNowKeyFile, readIndexNowConfig } from '../../backend/services/indexNow/indexNow';

// IndexNow key file: /<key>.txt is rewritten here (next.config.js). Answers with the key only when the
// requested name IS the configured INDEXNOW_API_KEY and INDEXNOW_PUBLISH_KEY_FILE=true; otherwise 404.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).end();
  const requested = Array.isArray(req.query.key) ? req.query.key[0] : req.query.key;
  const file = indexNowKeyFile(requested, readIndexNowConfig(getCanonicalAppUrl()));
  if (file.status !== 200) return res.status(404).end();
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  return res.status(200).send(file.body);
}

export default __createApiRoute(handler, {
  route: '/api/indexnow-key',
  policy: {
    v: 1,
    category: 'public',
    justification:
      'Purpose: IndexNow ownership verification file, fetched by search engines at /<key>.txt. Exposure: the IndexNow key itself, which the protocol requires to be public, and only when the request names that exact key; any other name is 404. Rationale: the protocol verifies site ownership by fetching this file. Contract: Search Engine Content.',
  },
});
