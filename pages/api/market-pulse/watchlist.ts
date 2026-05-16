import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveCompanyAccess } from '../../../backend/services/contentArchitectService';
import {
  getMarketPulseExecutiveExperience,
  saveMarketPulseWatchlistItem,
} from '../../../backend/services/marketPulseExecutiveExperienceService';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>;
  const companyId = (req.query.companyId as string | undefined) || (body.companyId as string | undefined);
  if (!companyId) return res.status(400).json({ error: 'companyId is required' });

  const access = await resolveCompanyAccess(req, res, companyId);
  if (!access) return;

  if (req.method === 'GET') {
    const experience = await getMarketPulseExecutiveExperience(companyId, 'executive');
    return res.status(200).json({ watchlists: experience.watchlists });
  }

  if (req.method === 'POST') {
    const normalizedRole = String(access.role ?? '').toUpperCase();
    if (!['SUPER_ADMIN', 'CONTENT_ARCHITECT', 'CAMPAIGN_ARCHITECT', 'COMPANY_ADMIN', 'ADMIN'].includes(normalizedRole)) {
      return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
    }
    const watchlistType = String(body.watchlistType || body.watchlist_type || '').trim();
    const watchlistValue = String(body.watchlistValue || body.watchlist_value || '').trim();
    if (!watchlistType || !watchlistValue) {
      return res.status(400).json({ error: 'watchlistType and watchlistValue are required' });
    }
    const item = await saveMarketPulseWatchlistItem({
      companyId,
      watchlistType,
      watchlistValue,
      priorityLevel: typeof body.priorityLevel === 'string' ? body.priorityLevel : typeof body.priority_level === 'string' ? body.priority_level : 'normal',
      muted: Boolean(body.muted),
      actorUserId: UUID_RE.test(access.userId) ? access.userId : null,
    });
    return res.status(200).json({ item });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
