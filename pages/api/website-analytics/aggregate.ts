import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';
import { aggregateWebsiteAnalytics } from '../../../backend/services/websiteAnalyticsService';

function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  // ROUTE-AUTH-001: fail CLOSED. The check used to run only when the secret was
  // configured, so an unset secret meant anyone could trigger the aggregation.
  const expected = process.env.ANALYTICS_WORKER_SECRET;
  if (!expected) return res.status(503).json({ error: 'Worker secret not configured' });
  const provided = typeof req.headers['x-worker-secret'] === 'string' ? req.headers['x-worker-secret'] : '';
  if (!provided || !secretMatches(provided, expected)) return res.status(401).json({ error: 'Invalid worker secret' });
  const result = await aggregateWebsiteAnalytics({
    websiteId: typeof req.body?.website_id === 'string' ? req.body.website_id : undefined,
    day: typeof req.body?.day === 'string' ? req.body.day : undefined,
  });
  return res.status(200).json(result);
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/website-analytics/aggregate' });
