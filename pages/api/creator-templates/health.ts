import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext, enforceCompanyAccess, enforceCompanyAccessUniform, UNIFORM_NOT_FOUND } from '../../../backend/services/userContextService';
import { getTemplateHealth, getTemplateOperationalDashboard, isSystemTemplate } from '../../../backend/services/creator/templateHealthService';
import { getUserTemplateCompanyId } from '../../../backend/services/creator/userTemplateService';

/**
 * GET /api/creator-templates/health?id=<templateId>            — one template's health
 * GET /api/creator-templates/health?company_id=<id>            — operational dashboard
 *
 * Deterministic operational health only (lifecycle counters / version status /
 * fleet flags). Read-only; reuses the existing audit event store. No analytics.
 *
 * TENANT BOUNDARY (2026-11-12, 05 post-hoc review of #378, e9): a USER template's health is
 * answered only to a member of the template's OWNING company (derive-then-authorize, like
 * user/[id].ts). Foreign and unknown ids get the same byte-identical 404 (no existence oracle).
 * The dashboard's extra `ids` are filtered to the authorized company's own templates (plus
 * platform system templates) BEFORE any health is resolved.
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
    // System: catalog metadata, any authenticated tenant. User: authorize on the OWNING company.
    let scope = user.defaultCompanyId;
    if (!isSystemTemplate(id)) {
      const owner = await getUserTemplateCompanyId(id);
      if (!owner) return res.status(404).json(UNIFORM_NOT_FOUND);
      const allowed = await enforceCompanyAccessUniform({ req, res, companyId: owner });
      if (!allowed) return;
      scope = owner;
    }
    const health = await getTemplateHealth(id, scope);
    if (!health) return res.status(404).json(UNIFORM_NOT_FOUND);
    return res.status(200).json({ health });
  }

  const companyId = String((req.query.company_id ?? user.defaultCompanyId) || '').trim();
  if (!companyId) return res.status(200).json({ templates: [], system: { noUsage: [], repeatedFailures: [], failingValidation: [], deprecatedVersions: [], neverPublished: [], safeToArchive: [] } });
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  const requested = typeof req.query.ids === 'string' ? req.query.ids.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
  // The service scopes every id to this (authorized) company: another tenant's id is dropped
  // exactly like an unknown one, before any of its data is read.
  return res.status(200).json(await getTemplateOperationalDashboard({ companyId, templateIds: requested }));
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/creator-templates/health' });
