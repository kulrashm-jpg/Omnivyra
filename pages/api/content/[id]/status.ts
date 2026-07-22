import { createApiRoute as __createApiRoute } from '@/lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '@/backend/services/userContextService';
import { setLifecycleStatus } from '@/backend/services/content/contentService';
import { resolveCompanyId, firstQueryValue, respondServiceError } from '@/lib/content/contentApiHelpers';

/**
 * Canonical content lifecycle endpoint (Wave 1, item 10).
 *
 *   POST /api/content/:id/status  body { status }
 *     → setLifecycleStatus(id, companyId, status) → 200 { content }
 *
 * Company-scoped via enforceCompanyAccess. Transitions the lifecycle status
 * of the canonical content object by id (the service owns the set of valid
 * statuses / transitions). NEW route.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const id = firstQueryValue(req.query.id);
  if (!id) return res.status(400).json({ error: 'id required' });

  const companyId = resolveCompanyId(req);
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;
  const scopedCompanyId = companyId as string;

  if (req.method === 'POST') {
    const status = typeof req.body?.status === 'string' ? req.body.status.trim() : '';
    if (!status) return res.status(400).json({ error: 'status required' });
    try {
      const content = await setLifecycleStatus(id, scopedCompanyId, status as never);
      return res.status(200).json({ content });
    } catch (error) {
      return respondServiceError(res, error, 'Failed to set lifecycle status');
    }
  }

  res.setHeader('Allow', 'POST');
  return res.status(405).json({ error: 'Method not allowed' });
}

export default __createApiRoute(handler, { route: '/api/content/:id/status' });
