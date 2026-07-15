import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET /api/usage/summary — authenticated read over the canonical usage authority
 * (CSA-001 §4). Reuses the existing auth + tenant guard (`withOrgAccess`) and the
 * ONE usage authority (`getUsageSummary`). Returns per-company usage aggregated
 * at daily/weekly/monthly granularity for a window.
 *
 * Query: ?org_id=<company>&from=<iso>&to=<iso>&granularity=daily|weekly|monthly
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withOrgAccess } from '../../../backend/middleware/withOrgAccess';
import { getUsageSummary, type UsageGranularity } from '../../../backend/services/usage/usageAuthorityService';

const GRANULARITIES: ReadonlySet<string> = new Set(['daily', 'weekly', 'monthly']);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const companyId = String(req.query.org_id ?? '').trim();
  if (!companyId) return res.status(400).json({ error: 'org_id required' });

  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const from = typeof req.query.from === 'string' && req.query.from ? req.query.from : defaultFrom;
  const to = typeof req.query.to === 'string' && req.query.to ? req.query.to : now.toISOString();
  const gRaw = String(req.query.granularity ?? 'daily');
  const granularity: UsageGranularity = (GRANULARITIES.has(gRaw) ? gRaw : 'daily') as UsageGranularity;

  const summary = await getUsageSummary(companyId, { from, to, granularity });

  res.setHeader('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');
  return res.status(200).json(summary);
}

export default __createApiRoute(withOrgAccess(handler), { route: '/api/usage/summary' });
