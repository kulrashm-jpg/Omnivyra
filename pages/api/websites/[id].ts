import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../backend/services/rbacService';
import { assertWebsiteCompanyAccess, updateWebsite, type UpdateWebsiteInput } from '../../../backend/services/websiteService';

/**
 * GET/PATCH/PUT /api/websites/[id] — read + update a single website.
 *
 * Completes editable website settings by reusing `websites.settings` and the existing
 * website service (no new settings table, no parallel config). PATCH merges into the
 * existing settings (tracking config, allowed_tracking_domains, allow_unverified_
 * ingestion, branding, lead-capture options, webhook config all live under `settings`).
 * Same auth pattern as the other website routes (enforceCompanyAccess +
 * assertWebsiteCompanyAccess); writes are role-gated to COMPANY_ADMIN/SUPER_ADMIN.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const companyId =
    typeof req.query.company_id === 'string' ? req.query.company_id :
    typeof req.body?.company_id === 'string' ? req.body.company_id : null;
  const websiteId = typeof req.query.id === 'string' ? req.query.id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });
  if (!websiteId) return res.status(400).json({ error: 'website id is required' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  let website;
  try {
    website = await assertWebsiteCompanyAccess(companyId, websiteId);
  } catch {
    return res.status(404).json({ error: 'Website not found or inaccessible' });
  }

  if (req.method === 'GET') {
    return res.status(200).json({ website });
  }

  if (req.method === 'PATCH' || req.method === 'PUT') {
    const roleGate = await enforceRole({ req, res, companyId, allowedRoles: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN] });
    if (!roleGate) return;

    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
    const updates: UpdateWebsiteInput = {};
    if (typeof body.name === 'string') updates.name = body.name.trim();
    if (typeof body.canonical_url === 'string') updates.canonicalUrl = body.canonical_url;
    if (typeof body.cms_provider === 'string' || body.cms_provider === null) updates.cmsProvider = body.cms_provider as string | null;
    // Settings + metadata are MERGED (PATCH semantics) into the existing object.
    if (isObj(body.settings)) updates.settings = { ...(website.settings || {}), ...body.settings };
    if (isObj(body.metadata)) updates.metadata = { ...(website.metadata || {}), ...body.metadata };

    try {
      const updated = await updateWebsite(websiteId, companyId, updates);
      return res.status(200).json({ website: updated });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update website' });
    }
  }

  res.setHeader('Allow', 'GET, PATCH, PUT');
  return res.status(405).json({ error: 'Method not allowed' });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/websites/:id' });
