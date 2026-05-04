import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
import { NextApiRequest, NextApiResponse } from 'next';
import { resolveCompanyAccess } from '../../../backend/services/contentArchitectService';
import {
  deleteAutomationSettings,
  getAutomationSettings,
  upsertAutomationSettings,
} from '../../../backend/services/marketPulseV2Service';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const companyId =
    (typeof req.query.companyId === 'string' ? req.query.companyId : '') ||
    (typeof req.body?.companyId === 'string' ? req.body.companyId : '');

  if (!companyId) {
    return res.status(400).json({ error: 'companyId is required' });
  }

  const access = await resolveCompanyAccess(req, res, companyId);
  if (!access) return;

  try {
    if (req.method === 'GET') {
      const settings = await getAutomationSettings(companyId);
      return res.status(200).json({ settings });
    }

    if (req.method === 'POST') {
      const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>;
      const settings = await upsertAutomationSettings(companyId, {
        is_active: Boolean(body.is_active),
        cadence: body.cadence === 'daily' ? 'daily' : 'daily',
        objective: typeof body.objective === 'string' ? body.objective : 'growth',
        categories: Array.isArray(body.categories) ? body.categories : [],
        region_scope: typeof body.region_scope === 'string' ? body.region_scope : 'profile_markets',
        custom_regions: Array.isArray(body.custom_regions) ? body.custom_regions : [],
        competitor_scope: typeof body.competitor_scope === 'string' ? body.competitor_scope : 'combined',
        custom_direction: typeof body.custom_direction === 'string' ? body.custom_direction : null,
        credit_acknowledged: Boolean(body.credit_acknowledged),
        warning_copy_version: typeof body.warning_copy_version === 'string' ? body.warning_copy_version : 'v1',
      });
      return res.status(200).json({ settings });
    }

    if (req.method === 'DELETE') {
      await deleteAutomationSettings(companyId);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message || 'Failed to manage Market Pulse automation' });
  }
}

export default applyAuthGuard({
  requiresAuth: true,
})(handler);

