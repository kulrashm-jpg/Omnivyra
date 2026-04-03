
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
import { buildPlannerStrategicCard, type PlannerStrategicSourceMode } from '../../../lib/plannerStrategicCard';
import type { PlannerExecutionHandoff } from '../../../lib/plannerExecutionHandoff';
import type { IdeaSpine, StrategyContext } from '../../../components/planner/plannerSessionStore';

type TrendContext = {
  recommendation_id?: string | null;
  trend_topic?: string | null;
  [key: string]: unknown;
};

function toList(value: string | string[] | null | undefined): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  return String(value)
    .split(/[,;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { companyId, idea_spine, strategy_context, trend_context, duration_weeks, theme_source, alternatives, execution_handoff } = req.body || {};
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

    const handoff =
      execution_handoff && typeof execution_handoff === 'object' && !Array.isArray(execution_handoff)
        ? (execution_handoff as PlannerExecutionHandoff)
        : null;
    const effectiveIdeaSpine =
      idea_spine && typeof idea_spine === 'object' && !Array.isArray(idea_spine)
        ? (idea_spine as IdeaSpine)
        : handoff?.idea_spine ?? null;
    const effectiveStrategyContext =
      strategy_context && typeof strategy_context === 'object' && !Array.isArray(strategy_context)
        ? (strategy_context as StrategyContext)
        : (handoff?.strategy_context as StrategyContext | null | undefined) ?? null;

    const duration = Number(effectiveStrategyContext?.duration_weeks ?? duration_weeks ?? 4);
    const weeks = Math.max(1, Math.min(24, Math.round(duration)));

    // Resolve theme_source: 'ai' | 'trend' | 'both' (default: 'ai')
    const source: PlannerStrategicSourceMode =
      theme_source === 'trend'
        ? 'trend'
        : theme_source === 'both'
        ? 'both'
        : theme_source === 'blog'
        ? 'blog'
        : handoff?.strategic_card?.source_mode === 'trend' || handoff?.strategic_card?.source_mode === 'both' || handoff?.strategic_card?.source_mode === 'blog'
        ? handoff.strategic_card.source_mode
        : 'ai';

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
    const spine = effectiveIdeaSpine as IdeaSpine | null | undefined;
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

    const goal = typeof effectiveStrategyContext?.campaign_goal === 'string' ? effectiveStrategyContext.campaign_goal.trim() : null;
    const audience = toList(effectiveStrategyContext?.target_audience);
    const keyMessage = typeof effectiveStrategyContext?.key_message === 'string' ? effectiveStrategyContext.key_message.trim() : null;
    const aspects = Array.isArray(effectiveStrategyContext?.selected_aspects)
      ? effectiveStrategyContext.selected_aspects.map((value) => String(value || '').trim()).filter(Boolean)
      : [];
    const offerings = Array.isArray(effectiveStrategyContext?.selected_offerings)
      ? effectiveStrategyContext.selected_offerings.map((value) => String(value || '').trim()).filter(Boolean)
      : [];
    const enrichedTopic = [
      genTopic,
      goal ? `Goal: ${goal}` : null,
      audience.length > 0 ? `Audience: ${audience.join(', ')}` : null,
      keyMessage ? `Message: ${keyMessage}` : null,
      aspects.length > 0 ? `Strategic aspects: ${aspects.join(', ')}` : null,
      offerings.length > 0 ? `Offerings: ${offerings.join(', ')}` : null,
    ]
      .filter(Boolean)
      .join(' | ');

    // Return alternatives (1 or 2 sets) — each set is independently generated
    const numAlts = alternatives === 2 ? 2 : 1;
    if (numAlts === 2) {
      const [setA, setB] = await Promise.all([
        generateRichThemesForCampaignWeeks(enrichedTopic, weeks),
        generateRichThemesForCampaignWeeks(enrichedTopic, weeks),
      ]);
      return res.status(200).json({
        themes: setA,
        strategic_card: buildPlannerStrategicCard({
          sourceMode: source,
          ideaSpine: spine,
          strategyContext: effectiveStrategyContext,
          trendContext: trendCtx,
          themes: setA,
        }),
        alternatives: [setA, setB],
      });
    }

    const themes = await generateRichThemesForCampaignWeeks(enrichedTopic, weeks);
    return res.status(200).json({
      themes,
      strategic_card: buildPlannerStrategicCard({
        sourceMode: source,
        ideaSpine: spine,
        strategyContext: effectiveStrategyContext,
        trendContext: trendCtx,
        themes,
      }),
    });
  } catch (err: unknown) {
    console.error('[planner/generate-themes]', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to generate themes',
    });
  }
}
