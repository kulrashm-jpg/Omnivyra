import { createApiRoute as __createApiRoute } from '@/lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '@/backend/services/userContextService';
import { enforceContentWriteRole } from '@/backend/services/content/contentWriteAuthz';
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

  // SEC-91 W2-G (STEP 3AH-91, W2G-1) — writes require a content authoring role
  // (PERMISSIONS.CREATE_CAMPAIGN) in the company authorized above; VIEW_ONLY and
  // its aliases stay read-only. Reads are unchanged. See contentWriteAuthz.ts.
  if ((req.method === 'POST') && !(await enforceContentWriteRole({ req, res, companyId: scopedCompanyId }))) return;

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
