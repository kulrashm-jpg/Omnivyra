
/**
 * Executive Campaign Health API — read-only projection layer.
 * Consolidates engagement, comments, stability, strategist acceptance, and alerts.
 * No mutations, no schema changes, no changes to distribution or evaluation logic.
 *
 * Growth Intelligence Phase-1 integration
 * Adds read-only growth_score derived from existing platform data
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { requireCampaignAccess } from '../../../backend/services/campaignAccessService';
import { computeDistributionStability } from '../../../lib/intelligence/distributionStability';
import { buildStrategicMemoryProfile } from '../../../lib/intelligence/strategicMemory';
import type { StrategistAction } from '../../../lib/intelligence/strategicMemory';
import { getDecisionReportView } from '../../../backend/services/decisionReportService';
import { runInApiReadContext } from '../../../backend/services/intelligenceExecutionContext';

export interface CampaignHealthSummary {
  campaign_id: string;
  engagement_trend_percent: number | null;
  reach_trend_percent: number | null;
  total_engagement_last_7_days: number;
  total_engagement_previous_7_days: number;
  total_comments_last_7_days: number;
  total_comments_previous_7_days: number;
  stability_level: 'STABLE' | 'MODERATE' | 'VOLATILE';
  volatility_score: number;
  strategist_acceptance_rate: number | null;
  auto_distribution_ratio: number | null;
  slot_optimization_applied_count: number;
  performance_health: 'GROWING' | 'STABLE' | 'DECLINING';
  alerts: string[];
  ai_spend_last_30_days: {
    total_tokens: number;
    total_cost: number;
    llm_calls: number;
  };
  ai_budget: {
    budget_amount: number | null;
    used_last_30_days: number;
    percent_used: number | null;
    status: 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'NOT_CONFIGURED';
  };
  /** Growth Intelligence Phase-1: read-only score from existing platform data. Null if service unavailable. */
  growth_score?: number | null;
}

const ALL_ACTIONS: StrategistAction[] = ['IMPROVE_CTA', 'IMPROVE_HOOK', 'ADD_DISCOVERABILITY'];

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function trendPercent(current: number, previous: number): number | null {
  if (previous === 0 && current > 0) return 100;
  if (previous === 0 && current === 0) return 0;
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

function classifyHealth(engagement_trend_percent: number | null): 'GROWING' | 'STABLE' | 'DECLINING' {
  if (engagement_trend_percent == null) return 'STABLE';
  if (engagement_trend_percent > 10) return 'GROWING';
  if (engagement_trend_percent < -10) return 'DECLINING';
  return 'STABLE';
}

function buildAlerts(summary: {
  engagement_trend_percent: number | null;
  total_comments_last_7_days: number;
  stability_level: string;
  strategist_acceptance_rate: number | null;
  auto_distribution_ratio: number | null;
}): string[] {
  const out: string[] = [];
  if (summary.engagement_trend_percent != null && summary.engagement_trend_percent < -15) {
    out.push('Engagement has declined compared to the previous week.');
  }
  if (summary.total_comments_last_7_days === 0) {
    out.push('No new comments were received in the last 7 days.');
  }
  if (summary.stability_level === 'VOLATILE') {
    out.push('Posting strategy has been volatile across recent weeks.');
  }
  if (summary.strategist_acceptance_rate != null && summary.strategist_acceptance_rate < 0.3) {
    out.push('Few suggested improvements have been applied recently.');
  }
  if (summary.auto_distribution_ratio != null && summary.auto_distribution_ratio > 0.9) {
    out.push('Distribution is almost entirely auto-selected; consider setting a strategy.');
  }
  return out;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const campaignId = typeof req.query.campaignId === 'string' ? req.query.campaignId.trim() : '';
    if (!campaignId) {
      return res.status(400).json({ error: 'campaignId query required' });
    }

    const access = await requireCampaignAccess(req, res, campaignId);
    if (!access) return;

    const cid = access.campaignId;

    const now = new Date();
    const today = toDateString(now);
    const last7Start = new Date(now);
    last7Start.setDate(last7Start.getDate() - 6);
    const last7StartStr = toDateString(last7Start);
    const prev7End = new Date(now);
    prev7End.setDate(prev7End.getDate() - 7);
    const prev7EndStr = toDateString(prev7End);
    const prev7Start = new Date(now);
    prev7Start.setDate(prev7Start.getDate() - 13);
    const prev7StartStr = toDateString(prev7Start);

    let total_engagement_last_7_days = 0;
    let total_engagement_previous_7_days = 0;
    let total_reach_last_7_days = 0;
    let total_reach_previous_7_days = 0;
    let engagement_trend_percent: number | null = null;
    let reach_trend_percent: number | null = null;

    try {
      const { data: metricsRows, error: metricsErr } = await supabase
        .from('campaign_performance_metrics')
        .select('date, reach, likes, comments, shares')
        .eq('campaign_id', cid)
        .gte('date', prev7StartStr)
        .lte('date', today);

      if (!metricsErr && Array.isArray(metricsRows) && metricsRows.length > 0) {
        for (const row of metricsRows) {
          const d = String(row?.date ?? '');
          const engagement = Number(row?.likes ?? 0) + Number(row?.comments ?? 0) + Number(row?.shares ?? 0);
          const reach = Number(row?.reach ?? 0);
          if (d >= last7StartStr && d <= today) {
            total_engagement_last_7_days += engagement;
            total_reach_last_7_days += reach;
          } else if (d >= prev7StartStr && d <= prev7EndStr) {
            total_engagement_previous_7_days += engagement;
            total_reach_previous_7_days += reach;
          }
        }
        engagement_trend_percent = trendPercent(total_engagement_last_7_days, total_engagement_previous_7_days);
        reach_trend_percent = trendPercent(total_reach_last_7_days, total_reach_previous_7_days);
      }
    } catch (_) {
      // table missing or query failed: keep zeros and nulls
    }

    if (engagement_trend_percent == null && (total_engagement_last_7_days > 0 || total_engagement_previous_7_days > 0)) {
      engagement_trend_percent = trendPercent(total_engagement_last_7_days, total_engagement_previous_7_days);
    }

    try {
      const { data: perfRows, error: perfErr } = await supabase
        .from('campaign_performance')
        .select('performance_date, total_reach, total_engagement')
        .eq('campaign_id', cid)
        .gte('performance_date', prev7StartStr)
        .lte('performance_date', today);

      if (
        (engagement_trend_percent == null || reach_trend_percent == null) &&
        !perfErr &&
        Array.isArray(perfRows) &&
        perfRows.length > 0
      ) {
        let engLast = 0;
        let engPrev = 0;
        let reachLast = 0;
        let reachPrev = 0;
        for (const row of perfRows) {
          const d = String(row?.performance_date ?? '');
          const eng = Number(row?.total_engagement ?? 0);
          const reach = Number(row?.total_reach ?? 0);
          if (d >= last7StartStr && d <= today) {
            engLast += eng;
            reachLast += reach;
          } else if (d >= prev7StartStr && d <= prev7EndStr) {
            engPrev += eng;
            reachPrev += reach;
          }
        }
        if (engagement_trend_percent == null) {
          total_engagement_last_7_days = engLast;
          total_engagement_previous_7_days = engPrev;
          engagement_trend_percent = trendPercent(engLast, engPrev);
        }
        if (reach_trend_percent == null) {
          total_reach_last_7_days = reachLast;
          total_reach_previous_7_days = reachPrev;
          reach_trend_percent = trendPercent(reachLast, reachPrev);
        }
      }
    } catch (_) {
      // table missing or query failed
    }

    let total_comments_last_7_days = 0;
    let total_comments_previous_7_days = 0;

    try {
      const { data: postIds, error: postsErr } = await supabase
        .from('scheduled_posts')
        .select('id')
        .eq('campaign_id', cid);

      if (!postsErr && Array.isArray(postIds) && postIds.length > 0) {
        const ids = postIds.map((p: any) => p.id).filter(Boolean);
        if (ids.length > 0) {
          const last7StartTs = last7Start.toISOString();
          const last7EndTs = new Date(today + 'T23:59:59.999Z').toISOString();
          const prev7StartTs = new Date(prev7StartStr + 'T00:00:00.000Z').toISOString();
          const prev7EndTs = new Date(prev7EndStr + 'T23:59:59.999Z').toISOString();

          const { data: commentsRows, error: commentsErr } = await supabase
            .from('post_comments')
            .select('created_at')
            .in('scheduled_post_id', ids);

          if (!commentsErr && Array.isArray(commentsRows)) {
            for (const c of commentsRows) {
              const t = c?.created_at ? new Date(c.created_at).toISOString() : '';
              if (t >= last7StartTs && t <= last7EndTs) total_comments_last_7_days += 1;
              else if (t >= prev7StartTs && t <= prev7EndTs) total_comments_previous_7_days += 1;
            }
          }
        }
      }
    } catch (_) {
      // table missing or query failed
    }

    let stability_level: 'STABLE' | 'MODERATE' | 'VOLATILE' = 'STABLE';
    let volatility_score = 0;

    try {
      const { data: decisionRows, error: decErr } = await supabase
        .from('campaign_distribution_decisions')
        .select('week_number, resolved_strategy')
        .eq('campaign_id', cid)
        .order('week_number', { ascending: true });

      if (!decErr && Array.isArray(decisionRows) && decisionRows.length >= 2) {
        const decisions = decisionRows.map((r: any) => ({
          week_number: Number(r?.week_number ?? 0),
          resolved_strategy: String(r?.resolved_strategy ?? '').trim(),
        }));
        const stability = computeDistributionStability(decisions);
        stability_level = stability.stability_level;
        volatility_score = stability.volatility_score;
      }
    } catch (_) {
      // keep STABLE, 0
    }

    let strategist_acceptance_rate: number | null = null;

    try {
      const { data: memoryRows, error: memErr } = await supabase
        .from('campaign_strategic_memory')
        .select('action, accepted, created_at')
        .eq('campaign_id', cid);

      if (!memErr && Array.isArray(memoryRows) && memoryRows.length > 0) {
        const events = memoryRows.map((r: any) => ({
          campaign_id: cid,
          execution_id: '',
          platform: undefined as string | undefined,
          action: (r?.action ?? '') as StrategistAction,
          accepted: Boolean(r?.accepted),
          timestamp: r?.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
        }));
        const profile = buildStrategicMemoryProfile(events);
        const rates = ALL_ACTIONS.map((a) => profile.action_acceptance_rate[a] ?? 0).filter(Number.isFinite);
        if (rates.length > 0) {
          strategist_acceptance_rate = Math.round((rates.reduce((s, v) => s + v, 0) / rates.length) * 1000) / 1000;
        }
      }
    } catch (_) {
      // keep null
    }

    let auto_distribution_ratio: number | null = null;
    let slot_optimization_applied_count = 0;

    try {
      const { data: decRows, error: decErr2 } = await supabase
        .from('campaign_distribution_decisions')
        .select('auto_detected, slot_optimization_applied')
        .eq('campaign_id', cid);

      if (!decErr2 && Array.isArray(decRows)) {
        const total = decRows.length;
        const autoCount = decRows.filter((r: any) => r?.auto_detected === true).length;
        slot_optimization_applied_count = decRows.filter((r: any) => r?.slot_optimization_applied === true).length;
        if (total > 0) {
          auto_distribution_ratio = Math.round((autoCount / total) * 1000) / 1000;
        }
      }
    } catch (_) {
      // keep null and 0
    }

    const performance_health = classifyHealth(engagement_trend_percent);

    let ai_spend_last_30_days = { total_tokens: 0, total_cost: 0, llm_calls: 0 };
    try {
      const since30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data: usageRows, error: usageErr } = await supabase
        .from('usage_events')
        .select('total_tokens, total_cost')
        .eq('source_type', 'llm')
        .eq('campaign_id', cid)
        .gte('created_at', since30d);

      if (!usageErr && Array.isArray(usageRows) && usageRows.length > 0) {
        let total_tokens = 0;
        let total_cost = 0;
        for (const row of usageRows) {
          total_tokens += Number(row?.total_tokens ?? 0) || 0;
          total_cost += Number(row?.total_cost ?? 0) || 0;
        }
        ai_spend_last_30_days = {
          total_tokens,
          total_cost,
          llm_calls: usageRows.length,
        };
      }
    } catch (_) {
      // table missing or query failed → keep zeros
    }

    let ai_budget: CampaignHealthSummary['ai_budget'] = {
      budget_amount: null,
      used_last_30_days: ai_spend_last_30_days.total_cost,
      percent_used: null,
      status: 'NOT_CONFIGURED',
    };
    try {
      const { data: campaignRow, error: campaignErr } = await supabase
        .from('campaigns')
        .select('ai_budget_monthly')
        .eq('id', cid)
        .maybeSingle();

      if (campaignErr || !campaignRow) {
        // campaign not found → keep NOT_CONFIGURED
      } else {
        const budgetAmount = campaignRow.ai_budget_monthly != null ? Number(campaignRow.ai_budget_monthly) : null;
        if (budgetAmount == null || !Number.isFinite(budgetAmount) || budgetAmount <= 0) {
          ai_budget = {
            budget_amount: null,
            used_last_30_days: ai_spend_last_30_days.total_cost,
            percent_used: null,
            status: 'NOT_CONFIGURED',
          };
        } else {
          const used = ai_spend_last_30_days.total_cost;
          const percentUsed = Math.round((used / budgetAmount) * 10000) / 100;
          let status: 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'NOT_CONFIGURED' = 'HEALTHY';
          if (percentUsed >= 90) status = 'CRITICAL';
          else if (percentUsed >= 70) status = 'WARNING';
          ai_budget = {
            budget_amount: budgetAmount,
            used_last_30_days: used,
            percent_used: percentUsed,
            status,
          };
        }
      }
    } catch (_) {
      // keep NOT_CONFIGURED
    }

    const summary: CampaignHealthSummary = {
      campaign_id: cid,
      engagement_trend_percent,
      reach_trend_percent,
      total_engagement_last_7_days,
      total_engagement_previous_7_days,
      total_comments_last_7_days,
      total_comments_previous_7_days,
      stability_level,
      volatility_score,
      strategist_acceptance_rate,
      auto_distribution_ratio,
      slot_optimization_applied_count,
      performance_health,
      alerts: buildAlerts({
        engagement_trend_percent,
        total_comments_last_7_days,
        stability_level,
        strategist_acceptance_rate,
        auto_distribution_ratio,
      }),
      ai_spend_last_30_days,
      ai_budget,
    };

    try {
      const growthView = await runInApiReadContext('executiveCampaignHealthApi', async () =>
        getDecisionReportView({
          companyId: access.companyId,
          reportTier: 'growth',
          entityType: 'campaign',
          entityId: cid,
          sourceService: 'growthIntelligenceService',
        })
      );
      summary.growth_score = growthView.decisions[0]?.priority_score ?? null;
    } catch (err) {
      console.warn('Growth intelligence unavailable', err);
      summary.growth_score = null;
    }

    if (process.env.NODE_ENV === 'development') {
      console.log('[CampaignHealth]', summary);
    }

    return res.status(200).json(summary);
  } catch (err) {
    console.error('[CampaignHealth]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
