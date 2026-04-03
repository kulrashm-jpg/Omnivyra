/**
 * Company Intelligence Keywords API
 * Phase-3: Company Intelligence Configuration
 * GET, POST, PUT, PATCH for company_intelligence_keywords
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { withRBAC } from '../../../../backend/middleware/withRBAC';
import { Role } from '../../../../backend/services/rbacService';
import { requireCompanyContext } from '../../../../backend/services/companyContextGuardService';
import {
  getCompanyKeywords,
  createKeyword,
  updateKeyword,
  setKeywordEnabled,
  PLAN_LIMIT_EXCEEDED,
} from '../../../../backend/services/companyIntelligenceConfigService';

const ALLOWED_ROLES = [
  Role.COMPANY_ADMIN,
  Role.ADMIN,
  Role.SUPER_ADMIN,
  Role.CONTENT_CREATOR,
  Role.CONTENT_PLANNER,
];

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const companyId = (req.query.companyId as string) || (req.body?.companyId as string);
  if (!companyId) {
    return res.status(400).json({ error: 'companyId required' });
  }

  try {
    const companyContext = await requireCompanyContext({ req, res, companyId: companyId.trim() });
    if (!companyContext) return;

    switch (req.method) {
      case 'GET': {
        const keywords = await getCompanyKeywords(companyContext.companyId);
        return res.status(200).json({ keywords });
      }
      case 'POST': {
        const body = req.body as { keyword: string };
        if (!body?.keyword?.trim()) {
          return res.status(400).json({ error: 'keyword is required' });
        }
        const keyword = await createKeyword(companyContext.companyId, body.keyword);
        return res.status(201).json({ keyword });
      }
      case 'PUT': {
        const { id, keyword } = req.body as { id: string; keyword: string };
        if (!id || !keyword?.trim()) {
          return res.status(400).json({ error: 'id and keyword are required' });
        }
        const updated = await updateKeyword(id, keyword);
        return res.status(200).json({ keyword: updated });
      }
      case 'PATCH': {
        const { id, enabled } = req.body as { id: string; enabled: boolean };
        if (!id || typeof enabled !== 'boolean') {
          return res.status(400).json({ error: 'id and enabled (boolean) are required' });
        }
        const updated = await setKeywordEnabled(id, enabled);
        return res.status(200).json({ keyword: updated });
      }
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (err) {
    const message = (err as Error)?.message ?? '';
    if (message === PLAN_LIMIT_EXCEEDED) {
      return res.status(403).json({ error: PLAN_LIMIT_EXCEEDED });
    }
    return res.status(500).json({ error: message || 'Internal server error' });
  }
}

export default withRBAC(handler, ALLOWED_ROLES);
