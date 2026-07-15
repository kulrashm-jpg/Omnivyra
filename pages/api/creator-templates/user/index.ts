import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess, resolveUserContext } from '../../../../backend/services/userContextService';
import { listUserTemplates, createUserTemplate } from '../../../../backend/services/creator/userTemplateService';
import { filterUserTemplates, type OrganizationFilter } from '../../../../lib/creator-templates/userTemplate';
import { familyForCreatorType } from '../../../../lib/creator-templates';

/**
 * GET  /api/creator-templates/user?company_id=&family=&scope=&status=  — list user templates
 * POST /api/creator-templates/user  — create (from system/user template or blank)
 *
 * User templates reuse the canonical model; the gallery merges them with system
 * templates. Best-effort: an unapplied table yields an empty list (no break).
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await resolveUserContext(req);
  if (!user?.userId) return res.status(401).json({ error: 'authentication required' });

  if (req.method === 'GET') {
    const companyId = String((req.query.company_id ?? user.defaultCompanyId) || '').trim();
    if (!companyId) return res.status(200).json({ templates: [] });
    const access = await enforceCompanyAccess({ req, res, companyId });
    if (!access) return;
    const family = familyForCreatorType(typeof req.query.family === 'string' ? req.query.family : '') ?? undefined;
    const templates = await listUserTemplates({ companyId, family });
    const f: OrganizationFilter = {
      scope: (req.query.scope as OrganizationFilter['scope']) ?? 'all',
      status: (req.query.status as OrganizationFilter['status']) ?? 'all',
      ownerUserId: typeof req.query.owner === 'string' ? req.query.owner : undefined,
      includeArchived: req.query.includeArchived === '1',
    };
    return res.status(200).json({ templates: filterUserTemplates(templates, f) });
  }

  if (req.method === 'POST') {
    const body = (req.body || {}) as Record<string, unknown>;
    const companyId = String((body.company_id ?? user.defaultCompanyId) || '').trim();
    if (!companyId) return res.status(400).json({ error: 'company_id required' });
    const access = await enforceCompanyAccess({ req, res, companyId });
    if (!access) return;
    const family = familyForCreatorType(typeof body.family === 'string' ? body.family : '');
    if (!family) return res.status(400).json({ error: 'family must be image | carousel | infographic' });
    const created = await createUserTemplate({
      companyId,
      ownerUserId: user.userId,
      family,
      sourceTemplateId: typeof body.source_template_id === 'string' ? body.source_template_id : null,
      name: typeof body.name === 'string' ? body.name : undefined,
      teamId: typeof body.team_id === 'string' ? body.team_id : null,
    });
    if (!created) return res.status(503).json({ error: 'Could not create template (user template storage unavailable).' });
    return res.status(201).json({ template: created });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/creator-templates/user' });
