/**
 * POST /api/planner/suggest-campaigns
 * Returns campaign suggestions based on Opportunity Radar signals.
 * Each suggestion includes topic, themes, and suggested campaign title.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getOpportunityRadarItems } from '../../../backend/services/opportunityRadarService';
import { generateThemesForCampaignWeeks } from '../../../backend/services/strategicThemeEngine';

const MIN_SCORE = 0.6;
const DEFAULT_DURATION_WEEKS = 6;
const MAX_SUGGESTIONS = 10;

type Suggestion = {
  id: string;
  topic: string;
  opportunity_score: number | null;
  suggested_campaign_title: string;
  suggested_duration: number;
  themes: { week: number; title: string }[];
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { companyId } = req.body || {};
    if (!companyId || typeof companyId !== 'string') {
      return res.status(400).json({ error: 'companyId is required' });
    }

    const access = await enforceCompanyAccess({
      req,
      res,
      companyId: companyId.trim(),
      requireCampaignId: false,
    });
    if (!access) return;

    const organizationId = companyId.trim();
    const items = await getOpportunityRadarItems(organizationId, {
      limit: MAX_SUGGESTIONS * 2,
    });

    const filtered = items.filter((item) => {
      const score = item.opportunity_score ?? item.confidence_score ?? 0;
      return score >= MIN_SCORE;
    });

    const suggestions: Suggestion[] = [];

    for (const item of filtered.slice(0, MAX_SUGGESTIONS)) {
      const topic = (item.title || '').trim();
      if (!topic) continue;

      let themeStrings: string[] = [];
      try {
        themeStrings = await generateThemesForCampaignWeeks(topic, DEFAULT_DURATION_WEEKS);
      } catch (err) {
        console.warn('[planner/suggest-campaigns] theme generation failed for', topic, err);
      }

      const themes = themeStrings.map((title, i) => ({
        week: i + 1,
        title,
      }));

      const suggested_campaign_title =
        topic.toLowerCase().includes('campaign')
          ? `${topic} for marketing teams`
          : `${topic} campaign`;

      suggestions.push({
        id: item.id,
        topic,
        opportunity_score: item.opportunity_score ?? item.confidence_score ?? null,
        suggested_campaign_title,
        suggested_duration: DEFAULT_DURATION_WEEKS,
        themes,
      });
    }

    return res.status(200).json({ suggestions });
  } catch (err: unknown) {
    console.error('[planner/suggest-campaigns]', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to fetch suggestions',
    });
  }
}

export default handler;
