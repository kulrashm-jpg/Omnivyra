import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext, enforceCompanyAccess, enforceCompanyAccessUniform, UNIFORM_NOT_FOUND } from '../../../backend/services/userContextService';
import { getTemplateHealth, getTemplateOperationalDashboard } from '../../../backend/services/creator/templateHealthService';
import { getUserTemplateCompanyId, getUserTemplateForCompany } from '../../../backend/services/creator/userTemplateService';
import { getTemplateById } from '../../../lib/creator-templates';

/**
 * A PLATFORM (system) template: catalog metadata every tenant may read. NOT "any id the registry
 * resolves" - the registry also serves runtime-registered USER templates, which are tenant data.
 */
function isSystemTemplateId(id: string): boolean {
  return getTemplateById(id)?.ownership === 'system';
}

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
    if (!isSystemTemplateId(id)) {
      const owner = await getUserTemplateCompanyId(id);
      if (!owner) return res.status(404).json(UNIFORM_NOT_FOUND);
      const allowed = await enforceCompanyAccessUniform({ req, res, companyId: owner });
      if (!allowed) return;
    }
    return res.status(200).json({ health: await getTemplateHealth(id) });
  }

  const companyId = String((req.query.company_id ?? user.defaultCompanyId) || '').trim();
  if (!companyId) return res.status(200).json({ templates: [], system: { noUsage: [], repeatedFailures: [], failingValidation: [], deprecatedVersions: [], neverPublished: [], safeToArchive: [] } });
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  const requested = typeof req.query.ids === 'string' ? req.query.ids.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
  // Only this company's own templates (or platform system templates) - another tenant's id is
  // dropped exactly like an unknown one, before any health is resolved.
  let extra: string[] | undefined;
  if (requested) {
    const keep = await Promise.all([...new Set(requested)].map(async (tid) =>
      (isSystemTemplateId(tid) || (await getUserTemplateForCompany(tid, companyId))) ? tid : null));
    extra = keep.filter((x): x is string => x !== null);
    if (extra.length === 0) {
      return res.status(200).json({ templates: [], system: { noUsage: [], repeatedFailures: [], failingValidation: [], deprecatedVersions: [], neverPublished: [], safeToArchive: [] } });
    }
  }
  return res.status(200).json(await getTemplateOperationalDashboard({ companyId, templateIds: extra }));
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/creator-templates/health' });
