/**
 * POST /api/planner/generate-themes
 * Generates strategic themes for the Campaign Planner.
 * Reuses strategicThemeEngine.generateThemesForCampaignWeeks.
 * When trend_context.recommendation_id exists, fetches recommendation and uses trend_topic.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { generateRichThemesForCampaignWeeks } from '../../../backend/services/strategicThemeEngine';
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
    const { companyId, idea_spine, strategy_context, trend_context, duration_weeks, theme_source, alternatives } = req.body || {};
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

    // Resolve theme_source: 'ai' | 'trend' | 'both' (default: 'ai')
    const source: 'ai' | 'trend' | 'both' = theme_source === 'trend' ? 'trend' : theme_source === 'both' ? 'both' : 'ai';

    // Resolve trend topic
    let trendTopic: string | null = null;
    const trendCtx = trend_context as TrendContext | null | undefined;
    const rawTrendTopic = typeof trendCtx?.trend_topic === 'string' ? trendCtx.trend_topic.trim() : null;
    const recId = trendCtx?.recommendation_id;

    if (source !== 'ai') {
      if (recId && typeof recId === 'string' && recId.trim()) {
        const { data: rec, error } = await supabase
          .from('recommendation_snapshots')
          .select('trend_topic')
          .eq('id', recId.trim())
          .eq('company_id', companyId.trim())
          .maybeSingle();
        if (!error && rec && (rec as { trend_topic?: string }).trend_topic) {
          trendTopic = String((rec as { trend_topic: string }).trend_topic).trim() || null;
        }
      }
      if (!trendTopic && rawTrendTopic) trendTopic = rawTrendTopic;
    }

    // Resolve AI topic from idea_spine
    const spine = idea_spine as IdeaSpine | null | undefined;
    const aiTopic = [spine?.refined_title, spine?.title, spine?.refined_description, spine?.description]
      .filter((s) => typeof s === 'string' && String(s).trim())
      .map((s) => String(s).trim())[0] ?? null;

    // Build the generation topic based on source
    let genTopic: string | null = null;
    if (source === 'trend') {
      genTopic = trendTopic;
    } else if (source === 'both') {
      const parts = [trendTopic, aiTopic].filter(Boolean);
      genTopic = parts.length > 0 ? parts.join(' + ') : null;
    } else {
      genTopic = aiTopic;
    }

    if (!genTopic) {
      return res.status(400).json({
        error: source === 'trend'
          ? 'No trend context found. Select a trend recommendation first.'
          : 'Provide idea_spine (title/description) to generate themes.',
      });
    }

    // Return alternatives (1 or 2 sets) — each set is independently generated
    const numAlts = alternatives === 2 ? 2 : 1;
    if (numAlts === 2) {
      const [setA, setB] = await Promise.all([
        generateRichThemesForCampaignWeeks(genTopic, weeks),
        generateRichThemesForCampaignWeeks(genTopic, weeks),
      ]);
      return res.status(200).json({
        themes: setA,
        alternatives: [setA, setB],
      });
    }

    const themes = await generateRichThemesForCampaignWeeks(genTopic, weeks);
    return res.status(200).json({ themes });
  } catch (err: unknown) {
    console.error('[planner/generate-themes]', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to generate themes',
    });
  }
}

export default handler;
