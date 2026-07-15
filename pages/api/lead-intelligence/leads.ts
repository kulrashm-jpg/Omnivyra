import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess, resolveUserContext } from '../../../backend/services/userContextService';
import { searchLeads } from '../../../backend/services/leadIntelligence/leadIntelligenceReadService';
import type { CanonicalLeadSource } from '../../../lib/leadIntelligence';

/**
 * GET /api/lead-intelligence/leads — the unified, paginated, filtered, searched lead
 * read. Reads ONLY through the repository read service (durable ∪ legacy via
 * projections); no fragmented-source queries here. Additive: existing lead APIs are
 * untouched. Tenant-scoped via enforceCompanyAccess.
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
  const result = await searchLeads({
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
    page: { limit: Number(q.limit ?? 50), offset: Number(q.offset ?? 0) },
    sort: { by: q.sort === 'intent' ? 'intent' : 'occurredAt', order: q.order === 'asc' ? 'asc' : 'desc' },
  });
  return res.status(200).json(result);
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/lead-intelligence/leads' });
