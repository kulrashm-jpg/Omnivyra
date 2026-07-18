import { createApiRoute as __createApiRoute } from '@/lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '@/backend/services/userContextService';
import { listVariants, upsertVariant } from '@/backend/services/content/contentService';
import { resolveCompanyId, firstQueryValue, respondServiceError } from '@/lib/content/contentApiHelpers';

/**
 * Canonical content per-platform variants endpoint (Wave 1, item 10).
 *
 *   GET  /api/content/:id/variants  → listVariants(contentId, companyId)   → 200 { variants }
 *   POST /api/content/:id/variants  body { platform, ...data }
 *     → upsertVariant(contentId, companyId, platform, data)               → 200 { variant }
 *
 * Company-scoped via enforceCompanyAccess. Variants hang off the canonical
 * content object by id; upsert is keyed by platform so it never forks a
 * disconnected copy. NEW route.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const id = firstQueryValue(req.query.id);
  if (!id) return res.status(400).json({ error: 'id required' });

  const companyId = resolveCompanyId(req);
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;
  const scopedCompanyId = companyId as string;

  if (req.method === 'GET') {
    try {
      const variants = await listVariants(id, scopedCompanyId);
      return res.status(200).json({ variants });
    } catch (error) {
      return respondServiceError(res, error, 'Failed to list variants');
    }
  }

  if (req.method === 'POST') {
    const body = (req.body && typeof req.body === 'object') ? req.body as Record<string, unknown> : {};
    const platform = typeof body.platform === 'string' ? body.platform.trim().toLowerCase() : '';
    if (!platform) return res.status(400).json({ error: 'platform required' });
    try {
      const { platform: _p, company_id: _c1, companyId: _c2, ...data } = body;
      const variant = await upsertVariant(id, scopedCompanyId, platform, data as never);
      return res.status(200).json({ variant });
    } catch (error) {
      return respondServiceError(res, error, 'Failed to upsert variant');
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}

export default __createApiRoute(handler, { route: '/api/content/:id/variants' });
