/**
 * POST /api/planner/generate-themes
 * Generates strategic themes for the Campaign Planner.
 * Reuses strategicThemeEngine.generateThemesForCampaignWeeks.
 * When trend_context.recommendation_id exists, fetches recommendation and uses trend_topic.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { generateThemesForCampaignWeeks } from '../../../backend/services/strategicThemeEngine';
import { supabase } from '../../../backend/db/supabaseClient';

type IdeaSpine = {
  title?: string | null;
  refined_title?: string | null;
  description?: string | null;
  refined_description?: string | null;
};

type StrategyContext = {
  duration_weeks?: number;
};

type TrendContext = {
  recommendation_id?: string | null;
  trend_topic?: string | null;
  [key: string]: unknown;
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { companyId, idea_spine, strategy_context, trend_context, duration_weeks } = req.body || {};
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

    const duration = Number(strategy_context?.duration_weeks ?? duration_weeks ?? 6);
    const weeks = Math.max(1, Math.min(24, Math.round(duration)));

    let themes: string[] = [];

    const trendCtx = trend_context as TrendContext | null | undefined;
    const recId = trendCtx?.recommendation_id;

    if (recId && typeof recId === 'string' && recId.trim()) {
      const { data: rec, error } = await supabase
        .from('recommendation_snapshots')
        .select('trend_topic')
        .eq('id', recId.trim())
        .eq('company_id', companyId.trim())
        .maybeSingle();

      if (!error && rec && (rec as { trend_topic?: string }).trend_topic) {
        const topic = String((rec as { trend_topic: string }).trend_topic).trim();
        if (topic) {
          themes = await generateThemesForCampaignWeeks(topic, weeks);
        }
      }
    }

    if (themes.length === 0) {
      const spine = idea_spine as IdeaSpine | null | undefined;
      const topic = [
        spine?.refined_title,
        spine?.title,
        spine?.refined_description,
        spine?.description,
      ]
        .filter((s) => typeof s === 'string' && String(s).trim())
        .map((s) => String(s).trim())[0];

      if (!topic) {
        return res.status(400).json({
          error: 'Provide idea_spine (title/description) or trend_context.recommendation_id with valid recommendation.',
        });
      }

      themes = await generateThemesForCampaignWeeks(topic, weeks);
    }

    const themesStructured = themes.map((title, i) => ({ week: i + 1, title }));
    return res.status(200).json({ themes: themesStructured });
  } catch (err: unknown) {
    console.error('[planner/generate-themes]', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to generate themes',
    });
  }
}

export default handler;
