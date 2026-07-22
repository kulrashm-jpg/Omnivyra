import { createApiRoute as __createApiRoute } from '@/lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '@/backend/services/userContextService';
import { listRevisions, getRevision } from '@/backend/services/content/contentService';
import { resolveCompanyId, firstQueryValue, respondServiceError } from '@/lib/content/contentApiHelpers';

/**
 * Canonical content revision history endpoint (Wave 1, item 10).
 *
 *   GET /api/content/:id/revisions             → listRevisions(contentId, companyId)      → 200 { revisions }
 *   GET /api/content/:id/revisions?revision=N  → getRevision(contentId, companyId, N)     → 200 { revision } | 404
 *
 * Company-scoped via enforceCompanyAccess. Read-only history of the canonical
 * content object by id. NEW route.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const id = firstQueryValue(req.query.id);
  if (!id) return res.status(400).json({ error: 'id required' });

  const companyId = resolveCompanyId(req);
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;
  const scopedCompanyId = companyId as string;

  if (req.method === 'GET') {
    const revisionRaw = firstQueryValue(req.query.revision as string | string[] | undefined);
    if (revisionRaw !== undefined && revisionRaw !== '') {
      const revision = Number(revisionRaw);
      if (!Number.isFinite(revision)) {
        return res.status(400).json({ error: 'revision must be a number' });
      }
      try {
        const found = await getRevision(id, scopedCompanyId, revision);
        if (!found) return res.status(404).json({ error: 'Revision not found' });
        return res.status(200).json({ revision: found });
      } catch (error) {
        return respondServiceError(res, error, 'Failed to load revision');
      }
    }
    try {
      const revisions = await listRevisions(id, scopedCompanyId);
      return res.status(200).json({ revisions });
    } catch (error) {
      return respondServiceError(res, error, 'Failed to list revisions');
    }
  }

  res.setHeader('Allow', 'GET');
  return res.status(405).json({ error: 'Method not allowed' });
}

export default __createApiRoute(handler, { route: '/api/content/:id/revisions' });
