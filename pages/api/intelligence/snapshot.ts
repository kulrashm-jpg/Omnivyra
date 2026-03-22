/**
 * GET /api/intelligence/snapshot?companyId=xxx
 *
 * Aggregates the full marketing intelligence picture for a company:
 *   - system_snapshot    — portfolio health, trend, action distribution
 *   - campaign_status    — per-campaign evaluation + decision state
 *   - content_performance— top / bottom performing campaigns by score
 *   - strategic_intelligence — cross-campaign pattern memory
 *   - campaign_dna       — aggregate profile: goals, topics, stability
 *   - audience_response  — metric-level performance rankings
 *   - strategic_memory   — historical pattern summary + past decisions
 *   - next_actions       — prioritised action queue across campaigns
 *
 * Available to: COMPANY_ADMIN and above.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { withRBAC } from '../../../backend/middleware/withRBAC';
import { Role } from '../../../backend/services/rbacService';
import { recognizePatterns, type CampaignRecord } from '../../../backend/lib/campaigns/patternRecognitionEngine';

// ── Helpers ───────────────────────────────────────────────────────────────────

function clusterKey(topic: string): string {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 2)
    .join(' ') || topic.toLowerCase().slice(0, 20);
}

function getQueryStr(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (Array.isArray(v) && v[0]) return String(v[0]).trim();
  return '';
}

const METRIC_LABELS: Record<string, string> = {
  total_reach:     'Audience reach',
  engagement_rate: 'Engagement rate',
  avg_likes:       'Organic resonance',
  total_comments:  'Conversation depth',
  total_clicks:    'Click-through intent',
};

// ── Empty snapshot ────────────────────────────────────────────────────────────

function emptySnapshot(companyId: string, days = 30) {
  return {
    company_id: companyId,
    generated_at: new Date().toISOString(),
    time_range_days: days,
    system_snapshot: {
      total_campaigns: 0, evaluated_campaigns: 0, avg_score: 0,
      health: 'weak' as const, trend_signal: null as string | null,
      top_action: null, action_distribution: { continue: 0, optimize: 0, pivot: 0 },
      status_distribution: { exceeded: 0, met: 0, underperformed: 0 },
      campaigns_ready_to_scale: 0,
    },
    campaign_status:          [],
    content_performance:      { top: [] as any[], bottom: [] as any[], all: [] as any[] },
    strategic_intelligence:   { patterns: [], dominant_topic_cluster: null, best_performing_goal: null, campaigns_analyzed: 0, portfolio_avg_score: 0 },
    campaign_dna:             { goal_distribution: {}, dominant_goal: null, topic_clusters: [], dominant_topic_cluster: null, dominant_action: null, stability_distribution: { stable: 0, sensitive: 0, volatile: 0 } },
    audience_response:        { metric_rankings: [], strongest_metric: null, weakest_metric: null, engagement_trend: null as string | null },
    strategic_memory:         { patterns: [], dominant_topic_cluster: null, best_performing_goal: null, campaigns_analyzed: 0, portfolio_avg_score: 0, decision_summary: { continue: 0, optimize: 0, pivot: 0 } },
    next_actions:             [],
  };
}

// ── Handler ───────────────────────────────────────────────────────────────────

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = getQueryStr(req.query.companyId);
  if (!companyId) {
    return res.status(400).json({ error: 'companyId required' });
  }

  // Time-range filter (default 30 days, clamped 7–365)
  const daysRaw = parseInt(getQueryStr(req.query.days), 10);
  const days    = Number.isFinite(daysRaw) ? Math.max(7, Math.min(365, daysRaw)) : 30;
  const cutoff  = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // ── 1. All campaign IDs for this company ─────────────────────────────────
  const { data: versionRows } = await supabase
    .from('campaign_versions')
    .select('campaign_id')
    .eq('company_id', companyId);

  const campaignIds = [...new Set((versionRows ?? []).map((r: any) => r.campaign_id as string))];

  if (campaignIds.length === 0) {
    return res.status(200).json(emptySnapshot(companyId, days));
  }

  // ── 2. Campaign metadata ─────────────────────────────────────────────────
  const { data: campaigns } = await supabase
    .from('campaigns')
    .select('id, name, goal_type, topic_seed')
    .in('id', campaignIds);

  const campMeta = new Map<string, { name: string; goal_type: string | null; topic_seed: string | null }>();
  for (const c of campaigns ?? []) {
    campMeta.set(c.id, { name: c.name ?? '', goal_type: c.goal_type ?? null, topic_seed: c.topic_seed ?? null });
  }

  // ── 3. Performance records (company-scoped, within time window) ─────────
  const { data: allPerfs } = await supabase
    .from('campaign_performance')
    .select(`
      campaign_id, evaluation_status, evaluation_score, metric_breakdown,
      recommended_action, next_topic, stability_signal, decision_confidence_level,
      confidence_level, recorded_at
    `)
    .eq('company_id', companyId)
    .not('evaluation_status', 'is', null)
    .gte('recorded_at', cutoff)
    .order('recorded_at', { ascending: false })
    .limit(60);

  // Latest record per campaign
  const latestPerf = new Map<string, any>();
  for (const p of allPerfs ?? []) {
    if (!latestPerf.has(p.campaign_id)) latestPerf.set(p.campaign_id, p);
  }

  // All perfs for history (decision_summary)
  const decisionHistory = { continue: 0, optimize: 0, pivot: 0 };
  for (const p of allPerfs ?? []) {
    const a = p.recommended_action as keyof typeof decisionHistory;
    if (a && a in decisionHistory) decisionHistory[a]++;
  }

  // ── 4. Pattern recognition ───────────────────────────────────────────────
  const records: CampaignRecord[] = [];
  for (const [cid, p] of latestPerf) {
    const meta = campMeta.get(cid);
    records.push({
      campaign_id:       cid,
      campaign_name:     meta?.name ?? 'Campaign',
      topic:             meta?.topic_seed ?? null,
      goal_type:         meta?.goal_type ?? null,
      evaluation_status: p.evaluation_status,
      evaluation_score:  p.evaluation_score != null ? Number(p.evaluation_score) : null,
      recorded_at:       p.recorded_at,
    });
  }

  const patternMemory = recognizePatterns(records);

  // ── 5. System snapshot ───────────────────────────────────────────────────
  const evalRecords  = records.filter((r) => r.evaluation_score != null);
  const allScores    = evalRecords.map((r) => r.evaluation_score!);
  const avgScore     = allScores.length > 0
    ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length)
    : 0;

  const statusDist = { exceeded: 0, met: 0, underperformed: 0 };
  for (const r of records) {
    if (r.evaluation_status && r.evaluation_status in statusDist) {
      statusDist[r.evaluation_status as keyof typeof statusDist]++;
    }
  }

  const actionDist = { continue: 0, optimize: 0, pivot: 0 };
  for (const p of latestPerf.values()) {
    const a = p.recommended_action as keyof typeof actionDist;
    if (a && a in actionDist) actionDist[a]++;
  }

  const topAction = (Object.entries(actionDist).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null) as string | null;
  const health: 'strong' | 'moderate' | 'weak' = avgScore >= 70 ? 'strong' : avgScore >= 50 ? 'moderate' : 'weak';

  const momentumPattern = patternMemory.patterns.find((p) => p.type === 'momentum');
  const trendSignal: string | null = momentumPattern
    ? (momentumPattern.pattern.toLowerCase().includes('upward') ? 'improving' : 'declining')
    : (allScores.length >= 2 ? 'stable' : null);

  const systemSnapshot = {
    total_campaigns:          campaignIds.length,
    evaluated_campaigns:      evalRecords.length,
    avg_score:                avgScore,
    health,
    trend_signal:             trendSignal,
    top_action:               topAction,
    action_distribution:      actionDist,
    status_distribution:      statusDist,
    campaigns_ready_to_scale: statusDist.exceeded,
  };

  // ── 6. Campaign status ───────────────────────────────────────────────────
  const campaignStatus = campaignIds.map((cid) => {
    const meta = campMeta.get(cid);
    const perf = latestPerf.get(cid);
    return {
      id:                        cid,
      name:                      meta?.name ?? 'Campaign',
      goal_type:                 meta?.goal_type ?? null,
      topic_seed:                meta?.topic_seed ?? null,
      evaluation_status:         perf?.evaluation_status ?? null,
      evaluation_score:          perf?.evaluation_score != null ? Number(perf.evaluation_score) : null,
      recommended_action:        perf?.recommended_action ?? null,
      stability_signal:          perf?.stability_signal ?? null,
      decision_confidence_level: perf?.decision_confidence_level ?? null,
      data_confidence_level:     perf?.confidence_level ?? null,
      next_topic:                perf?.next_topic ?? null,
      recorded_at:               perf?.recorded_at ?? null,
    };
  }).sort((a, b) => {
    if (a.evaluation_score == null) return 1;
    if (b.evaluation_score == null) return -1;
    return b.evaluation_score - a.evaluation_score;
  });

  // ── 7. Content performance ───────────────────────────────────────────────
  const evaluated = campaignStatus.filter((c) => c.evaluation_score != null);
  const bySorce   = [...evaluated].sort((a, b) => (b.evaluation_score ?? 0) - (a.evaluation_score ?? 0));
  const contentPerformance = {
    top:    bySorce.slice(0, 3),
    bottom: bySorce.length > 3 ? [...bySorce].reverse().slice(0, 3) : [],
    all:    bySorce,
  };

  // ── 8. Campaign DNA ──────────────────────────────────────────────────────
  const goalDist: Record<string, number> = {};
  const topicClusterMap = new Map<string, number[]>();
  const stabilityDist = { stable: 0, sensitive: 0, volatile: 0 };

  for (const cid of campaignIds) {
    const meta = campMeta.get(cid);
    const perf = latestPerf.get(cid);

    if (meta?.goal_type) {
      goalDist[meta.goal_type] = (goalDist[meta.goal_type] ?? 0) + 1;
    }
    if (meta?.topic_seed && perf?.evaluation_score != null) {
      const key = clusterKey(meta.topic_seed);
      if (!topicClusterMap.has(key)) topicClusterMap.set(key, []);
      topicClusterMap.get(key)!.push(Number(perf.evaluation_score));
    }
    if (perf?.stability_signal && perf.stability_signal in stabilityDist) {
      stabilityDist[perf.stability_signal as keyof typeof stabilityDist]++;
    }
  }

  const topicClusters = [...topicClusterMap.entries()]
    .map(([cluster, scores]) => ({
      cluster,
      count:     scores.length,
      avg_score: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
    }))
    .sort((a, b) => b.avg_score - a.avg_score)
    .slice(0, 5);

  const dominantGoal = Object.entries(goalDist).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const campaignDna = {
    goal_distribution:      goalDist,
    dominant_goal:          dominantGoal,
    topic_clusters:         topicClusters,
    dominant_topic_cluster: patternMemory.dominant_topic_cluster,
    dominant_action:        topAction,
    stability_distribution: stabilityDist,
  };

  // ── 9. Audience response ─────────────────────────────────────────────────
  const metricRatios = new Map<string, number[]>();
  for (const p of latestPerf.values()) {
    const breakdown = Array.isArray(p.metric_breakdown) ? p.metric_breakdown : [];
    for (const entry of breakdown) {
      if (entry.metric && entry.ratio != null) {
        if (!metricRatios.has(entry.metric)) metricRatios.set(entry.metric, []);
        metricRatios.get(entry.metric)!.push(Number(entry.ratio));
      }
    }
  }

  const metricRankings = [...metricRatios.entries()]
    .map(([metric, ratios]) => ({
      metric,
      label:             METRIC_LABELS[metric] ?? metric.replace(/_/g, ' '),
      avg_ratio:         Math.round((ratios.reduce((a, b) => a + b, 0) / ratios.length) * 100) / 100,
      avg_pct_of_target: Math.round((ratios.reduce((a, b) => a + b, 0) / ratios.length) * 100),
      campaigns_tracked: ratios.length,
    }))
    .sort((a, b) => b.avg_ratio - a.avg_ratio);

  const audienceResponse = {
    metric_rankings:  metricRankings,
    strongest_metric: metricRankings[0]?.label ?? null,
    weakest_metric:   metricRankings[metricRankings.length - 1]?.label ?? null,
    engagement_trend: trendSignal,
  };

  // ── 10. Strategic memory ─────────────────────────────────────────────────
  const strategicMemory = {
    patterns:               patternMemory.patterns,
    dominant_topic_cluster: patternMemory.dominant_topic_cluster,
    best_performing_goal:   patternMemory.best_performing_goal,
    campaigns_analyzed:     patternMemory.campaigns_analyzed,
    portfolio_avg_score:    patternMemory.portfolio_avg_score,
    decision_summary:       decisionHistory,
  };

  // ── 11. Next actions (prioritised) ───────────────────────────────────────
  const nextActions = campaignStatus
    .filter((c) => c.recommended_action)
    .map((c) => {
      const priority: 'high' | 'medium' | 'low' =
        c.recommended_action === 'pivot'    ? 'high'   :
        c.recommended_action === 'optimize' ? 'medium' : 'low';
      return {
        campaign_id:               c.id,
        campaign_name:             c.name,
        action:                    c.recommended_action as 'continue' | 'optimize' | 'pivot',
        next_topic:                c.next_topic,
        decision_confidence_level: c.decision_confidence_level,
        stability_signal:          c.stability_signal,
        evaluation_score:          c.evaluation_score,
        priority,
      };
    })
    .sort((a, b) => {
      const ord = { high: 0, medium: 1, low: 2 };
      return ord[a.priority] - ord[b.priority];
    });

  return res.status(200).json({
    company_id:             companyId,
    generated_at:           new Date().toISOString(),
    time_range_days:        days,
    system_snapshot:        systemSnapshot,
    campaign_status:        campaignStatus,
    content_performance:    contentPerformance,
    strategic_intelligence: strategicMemory,
    campaign_dna:           campaignDna,
    audience_response:      audienceResponse,
    strategic_memory:       strategicMemory,
    next_actions:           nextActions,
  });
}

export default withRBAC(handler, [Role.SUPER_ADMIN, Role.ADMIN, Role.COMPANY_ADMIN]);
