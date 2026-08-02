import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { setPrivateCache, CACHE_TTL } from '../../../lib/platform/httpCache';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess, resolveUserContext } from '../../../backend/services/userContextService';
import { getLeadStats } from '../../../backend/services/leadIntelligence/leadIntelligenceReadService';
import type { CanonicalLeadSource } from '../../../lib/leadIntelligence';

/**
 * GET /api/lead-intelligence/stats — repository-owned aggregation for the Overview
 * (total / by-source / by-status / intent bands / identity / campaign coverage).
 * No consumer-side aggregation. Additive; tenant-scoped.
 */
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed' }); }
  const user = await resolveUserContext(req);
  if (!user?.userId) return res.status(401).json({ error: 'authentication required' });
  const companyId = String(req.query.company_id || '').trim();
  if (!companyId) return res.status(400).json({ error: 'company_id required' });
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  const q = req.query;
  const sourceParam = str(q.source);
  const stats = await getLeadStats({
    companyId,
    search: str(q.q),
    filters: {
      source: sourceParam ? (sourceParam.split(',').filter(Boolean) as CanonicalLeadSource[]) : undefined,
      campaign: str(q.campaign),
      content: str(q.content),
      status: str(q.status),
      owner: str(q.owner),
      dateFrom: str(q.from),
      dateTo: str(q.to),
      buyingIntentMin: q.intent_min != null && !Number.isNaN(Number(q.intent_min)) ? Number(q.intent_min) : undefined,
      interest: str(q.interest),
    },
  });
  // OPT-002: P3 private, STANDARD (60 s). TTL-only invalidation — lead ops
  // mutate via /operations (different URI); no consumer refetches stats after.
  setPrivateCache(res, CACHE_TTL.STANDARD);
  return res.status(200).json(stats);
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/lead-intelligence/stats' });
