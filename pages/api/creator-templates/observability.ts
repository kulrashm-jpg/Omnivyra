import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess, resolveUserContext } from '../../../backend/services/userContextService';
import { getCreatorObservabilityReport } from '../../../backend/services/creator/creatorObservabilityService';
import { getUserTemplate, getUserTemplateCompanyId } from '../../../backend/services/creator/userTemplateService';
import { enqueueUserTemplatePreview } from '../../../backend/services/creator/userTemplatePreviewService';

/**
 * GET  /api/creator-templates/observability?company_id=  — full ops report
 * POST /api/creator-templates/observability  { action: 'retry_preview', template_id }
 *      — read-only operational retry (re-enqueues the EXISTING preview pipeline;
 *        idempotent, non-destructive).
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await resolveUserContext(req);
  if (!user?.userId) return res.status(401).json({ error: 'authentication required' });

  if (req.method === 'GET') {
    const companyId = String((req.query.company_id ?? user.defaultCompanyId) || '').trim();
    if (!companyId) return res.status(400).json({ error: 'company_id required' });
    const access = await enforceCompanyAccess({ req, res, companyId });
    if (!access) return;
    const report = await getCreatorObservabilityReport(companyId);
    return res.status(200).json({ report });
  }

  if (req.method === 'POST') {
    const body = (req.body || {}) as Record<string, unknown>;
    const companyId = String((body.company_id ?? user.defaultCompanyId) || '').trim();
    if (!companyId) return res.status(400).json({ error: 'company_id required' });
    const access = await enforceCompanyAccess({ req, res, companyId });
    if (!access) return;

    if (String(body.action) === 'retry_preview' && typeof body.template_id === 'string') {
      // The template must belong to the authorized company (no cross-tenant retry).
      const templateCompanyId = await getUserTemplateCompanyId(body.template_id);
      if (!templateCompanyId) return res.status(404).json({ error: 'template not found' });
      if (templateCompanyId !== companyId) return res.status(403).json({ error: 'cross-tenant retry denied' });
      const template = await getUserTemplate(body.template_id);
      if (!template) return res.status(404).json({ error: 'template not found' });
      void enqueueUserTemplatePreview({ template, companyId });
      return res.status(202).json({ ok: true, retried: body.template_id });
    }
    return res.status(400).json({ error: 'unsupported action' });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/creator-templates/observability' });
