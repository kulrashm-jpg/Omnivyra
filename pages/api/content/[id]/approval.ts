import { createApiRoute as __createApiRoute } from '@/lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '@/backend/services/userContextService';
import { getContent } from '@/backend/services/content/contentService';
import { resolveCompanyId, firstQueryValue, respondServiceError } from '@/lib/content/contentApiHelpers';
import * as approvalService from '@/backend/services/content/approvalService';

/**
 * Canonical content Approval endpoint (Writer Wave 4).
 *
 *   GET  /api/content/:id/approval → approvalService.getApprovalHistory(id, companyId)
 *                                    → 200 { history }
 *   POST /api/content/:id/approval  body { toStatus, note? }
 *     → approvalService.advanceApproval({ contentId, companyId, toStatus, note })
 *     → 200 { approval }
 *
 * Company-scoped via enforceCompanyAccess, and tenant-isolated by loading the
 * canonical content row with getContent(id, companyId). NEW route — additive,
 * backward-compatible.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const id = firstQueryValue(req.query.id);
  if (!id) return res.status(400).json({ error: 'id required' });

  const companyId = resolveCompanyId(req);
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;
  const scopedCompanyId = companyId as string;

  // Tenant isolation: prove the content belongs to the caller's company.
  const content = await getContent(id, scopedCompanyId);
  if (!content) return res.status(404).json({ error: 'Content not found' });

  if (req.method === 'GET') {
    try {
      const history = await approvalService.getApprovalHistory(id, scopedCompanyId);
      return res.status(200).json({ history });
    } catch (error) {
      return respondServiceError(res, error, 'Failed to load approval history');
    }
  }

  if (req.method === 'POST') {
    const body = (req.body && typeof req.body === 'object') ? req.body as Record<string, unknown> : {};
    const toStatus = typeof body.toStatus === 'string' ? body.toStatus.trim() : '';
    const note = typeof body.note === 'string' ? body.note : undefined;
    if (!toStatus) return res.status(400).json({ error: 'toStatus required' });

    try {
      // `toStatus` is a raw string here; the service validates the transition at
      // runtime and returns { ok:false } for an invalid target, so the cast is
      // safe (mirrors the Wave-1 status endpoint's `status as never`).
      const approval = await approvalService.advanceApproval({
        contentId: id,
        companyId: scopedCompanyId,
        toStatus: toStatus as never,
        note,
      });
      return res.status(200).json({ approval });
    } catch (error) {
      return respondServiceError(res, error, 'Failed to advance approval');
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}

export default __createApiRoute(handler, { route: '/api/content/:id/approval' });
