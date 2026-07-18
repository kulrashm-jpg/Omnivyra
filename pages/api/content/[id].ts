import { createApiRoute as __createApiRoute } from '@/lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '@/backend/services/userContextService';
import { getContent, updateContent, setLifecycleStatus } from '@/backend/services/content/contentService';
import { resolveCompanyId, firstQueryValue, respondServiceError } from '@/lib/content/contentApiHelpers';

/**
 * Canonical content item endpoint (Wave 1, item 10).
 *
 *   GET    /api/content/:id  → getContent(id, companyId)                → 200 { content } | 404
 *   PATCH  /api/content/:id  → updateContent(id, companyId, patch, {revisionType}) → 200 { content }
 *   DELETE /api/content/:id  → setLifecycleStatus(id, companyId, 'archived')       → 200 { content }
 *
 * Company-scoped via enforceCompanyAccess. Every operation targets the
 * canonical content object by id — DELETE is a soft archive (lifecycle
 * transition), never a destructive removal of a disconnected copy. NEW route.
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
      const content = await getContent(id, scopedCompanyId);
      if (!content) return res.status(404).json({ error: 'Content not found' });
      return res.status(200).json({ content });
    } catch (error) {
      return respondServiceError(res, error, 'Failed to load content');
    }
  }

  if (req.method === 'PATCH') {
    try {
      const body = (req.body && typeof req.body === 'object') ? req.body as Record<string, unknown> : {};
      const { patch, revisionType, company_id: _c1, companyId: _c2, ...rest } = body;
      // Accept either an explicit { patch } envelope or loose top-level fields.
      const effectivePatch = (patch && typeof patch === 'object') ? patch as Record<string, unknown> : rest;
      const content = await updateContent(
        id,
        scopedCompanyId,
        effectivePatch as never,
        { revisionType: typeof revisionType === 'string' ? revisionType : undefined } as never,
      );
      return res.status(200).json({ content });
    } catch (error) {
      return respondServiceError(res, error, 'Failed to update content');
    }
  }

  if (req.method === 'DELETE') {
    try {
      const content = await setLifecycleStatus(id, scopedCompanyId, 'archived' as never);
      return res.status(200).json({ content });
    } catch (error) {
      return respondServiceError(res, error, 'Failed to archive content');
    }
  }

  res.setHeader('Allow', 'GET, PATCH, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}

export default __createApiRoute(handler, { route: '/api/content/:id' });
