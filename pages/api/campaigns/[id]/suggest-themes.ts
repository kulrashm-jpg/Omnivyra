/**
 * POST /api/campaigns/[id]/suggest-themes
 * Returns strategic themes from the External API Intelligence pipeline (strategic_themes table).
 * Replaces legacy LLM-based theme generation; same response shape for Campaign Builder.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getStrategicThemesAsOpportunities } from '../../../../backend/services/strategicThemeEngine';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const id = req.query.id;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Campaign ID required' });
  }

  try {
    const companyId = req.body?.companyId as string | undefined;
    if (!companyId) {
      return res.status(400).json({ error: 'companyId required' });
    }

    const access = await enforceCompanyAccess({
      req,
      res,
      companyId,
      campaignId: id,
      requireCampaignId: true,
    });
    if (!access) return;

    const themes = await getStrategicThemesAsOpportunities({ companyId, limit: 20 });

    return res.status(200).json({
      themes: themes.map((t, i) => ({
        id: `theme-${i}-${(t.title ?? '').replace(/\s+/g, '-').toLowerCase() || i}`,
        title: t.title ?? 'Strategic theme',
        summary: t.summary ?? null,
        payload: t.payload ?? {},
      })),
    });
  } catch (err: any) {
    console.error('[suggest-themes]', err);
    return res.status(500).json({
      error: err?.message ?? 'Failed to suggest themes',
    });
  }
}

export default handler;
