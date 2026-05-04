import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
import type { NextApiRequest, NextApiResponse } from 'next';

import { getPendingInputs } from '../../../backend/services/intelligenceQueryService';
import { enforceCompanyAccess, resolveUserContext } from '../../../backend/services/userContextService';

function queryText(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return String(value[0] ?? '').trim();
  return String(value ?? '').trim();
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const companyId =
      queryText(req.query.companyId) ||
      queryText(req.query.company_id) ||
      queryText(req.query.organization_id) ||
      user.defaultCompanyId;

    if (!companyId) {
      return res.status(400).json({ error: 'companyId required' });
    }

    const access = await enforceCompanyAccess({
      req,
      res,
      companyId,
      requireCampaignId: false,
    });
    if (!access) return;

    const result = await getPendingInputs(companyId);
    return res.status(200).json({
      success: true,
      company_id: companyId,
      ...result,
    });
  } catch (error) {
    console.error('[intelligence/pending-inputs]', error);
    return res.status(500).json({
      error: 'Failed to load pending intelligence inputs. Please try again.',
    });
  }
}

export default applyAuthGuard({
  requiresAuth: true,
})(handler);

