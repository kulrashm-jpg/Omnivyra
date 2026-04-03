
/**
 * POST /api/engagement/patterns
 * Create a response pattern (structure only, not fixed text).
 * Body: pattern_category, pattern_structure
 *
 * GET /api/engagement/patterns
 * List response patterns for organization.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext, enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole } from '../../../backend/services/rbacService';
import { COMMUNITY_AI_CAPABILITIES } from '../../../backend/services/rbac/communityAiCapabilities';
import { createPattern, listPatterns } from '../../../backend/services/responsePatternService';

type PostBody = {
  pattern_category?: string;
  pattern_structure?: { blocks?: Array<{ type: string; label: string; required?: boolean }> };
  organization_id?: string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const rawOrg = req.method === 'POST'
      ? (req.body as PostBody)?.organization_id
      : (req.query.organization_id ?? req.query.organizationId);
    const organizationId = (Array.isArray(rawOrg) ? rawOrg[0] : rawOrg) ?? user?.defaultCompanyId ?? '';

    if (!organizationId) {
      return res.status(400).json({ error: 'organization_id required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
    if (!access) return;

    if (req.method === 'GET') {
      const patterns = await listPatterns(organizationId);
      return res.status(200).json({ patterns });
    }

    const roleGate = await enforceRole({
      req,
      res,
      companyId: organizationId,
      allowedRoles: [...COMMUNITY_AI_CAPABILITIES.EXECUTE_ACTIONS],
    });
    if (!roleGate) return;

    const body = (req.body || {}) as PostBody;
    const patternCategory = body.pattern_category?.trim();
    const patternStructure = body.pattern_structure ?? { blocks: [] };

    if (!patternCategory) {
      return res.status(400).json({ error: 'pattern_category required' });
    }

    const id = await createPattern(organizationId, patternCategory, patternStructure);
    if (!id) {
      return res.status(500).json({ error: 'Failed to create pattern' });
    }
    return res.status(200).json({ success: true, id });
  } catch (err) {
    const msg = (err as Error)?.message ?? 'Failed';
    console.error('[engagement/patterns]', msg);
    return res.status(500).json({ error: msg });
  }
}
