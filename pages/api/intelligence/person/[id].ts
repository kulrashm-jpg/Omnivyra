import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
import type { NextApiRequest, NextApiResponse } from 'next';

import {
  getPersonIntelligence,
  getPersonIntelligenceScope,
  PersonIntelligenceInvalidIdError,
  PersonIntelligenceNotFoundError,
} from '../../../../backend/services/personIntelligenceService';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';

function queryText(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return String(value[0] ?? '').trim();
  return String(value ?? '').trim();
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const personId = queryText(req.query.id);
  if (!personId) {
    return res.status(400).json({ error: 'person id required' });
  }

  try {
    const scope = await getPersonIntelligenceScope(personId);
    const access = await enforceCompanyAccess({
      req,
      res,
      companyId: scope.companyId,
      requireCampaignId: false,
    });
    if (!access) return;

    const intelligence = await getPersonIntelligence(scope.personId, scope.companyId);
    return res.status(200).json({
      success: true,
      company_id: scope.companyId,
      unified_person_id: scope.personId,
      ...intelligence,
    });
  } catch (error) {
    if (
      error instanceof PersonIntelligenceInvalidIdError ||
      error instanceof PersonIntelligenceNotFoundError
    ) {
      return res.status(error.statusCode).json({ error: error.message });
    }

    console.error('[intelligence/person]', error);
    return res.status(500).json({
      error: 'Failed to load person intelligence. Please try again.',
    });
  }
}

export default applyAuthGuard({
  requiresAuth: true,
})(handler);

