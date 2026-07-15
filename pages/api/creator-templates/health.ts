import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext, enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getTemplateHealth, getTemplateOperationalDashboard } from '../../../backend/services/creator/templateHealthService';

/**
 * GET /api/creator-templates/health?id=<templateId>            — one template's health
 * GET /api/creator-templates/health?company_id=<id>            — operational dashboard
 *
 * Deterministic operational health only (lifecycle counters / version status /
 * fleet flags). Read-only; reuses the existing audit event store. No analytics.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const user = await resolveUserContext(req);
  if (!user?.userId) return res.status(401).json({ error: 'authentication required' });

  const id = typeof req.query.id === 'string' ? req.query.id.trim() : '';
  if (id) {
    return res.status(200).json({ health: await getTemplateHealth(id) });
  }

  const companyId = String((req.query.company_id ?? user.defaultCompanyId) || '').trim();
  if (!companyId) return res.status(200).json({ templates: [], system: { noUsage: [], repeatedFailures: [], failingValidation: [], deprecatedVersions: [], neverPublished: [], safeToArchive: [] } });
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  const extra = typeof req.query.ids === 'string' ? req.query.ids.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
  return res.status(200).json(await getTemplateOperationalDashboard({ companyId, templateIds: extra }));
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/creator-templates/health' });
