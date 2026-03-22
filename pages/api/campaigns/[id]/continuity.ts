/**
 * GET /api/campaigns/[id]/continuity
 *
 * Returns the full strategic continuity picture for a campaign:
 *   - previous_result  — evaluation of the latest recorded performance
 *   - decision         — next action (continue / optimize / pivot) + confidence
 *   - pattern_memory   — patterns recognised across the company's campaign portfolio
 *   - timeline         — campaign journey: completed → current → suggested
 *   - suggested_blog   — blog to read before building the next campaign
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { withRBAC } from '../../../../backend/middleware/withRBAC';
import { Role } from '../../../../backend/services/rbacService';
import { decideNextAction } from '../../../../backend/lib/campaigns/continuityDecisionEngine';
import { recognizePatterns, type CampaignRecord } from '../../../../backend/lib/campaigns/patternRecognitionEngine';
import {
  buildTopicGraph,
  getCampaignTopicMap,
  upsertCampaignTopicMap,
  getBlogsForTopic,
} from '../../../../backend/services/campaignKnowledgeGraphService';

// ── Timeline step type ────────────────────────────────────────────────────────

interface JourneyStep {
  campaign_id:   string;
  campaign_name: string;
  topic:         string | null;
  goal_type:     string | null;
  status:        'exceeded' | 'met' | 'underperformed' | null;
  score:         number | null;
  stage:         'completed' | 'current' | 'suggested';
}

// ── Handler ───────────────────────────────────────────────────────────────────

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Campaign ID required' });
  }

  // ── 1. Load campaign + resolve company_id ─────────────────────────────────
  const [campaignRes, versionRes] = await Promise.all([
    supabase
      .from('campaigns')
      .select('id, name, goal_type, topic_seed, source_blog_id')
      .eq('id', id)
      .maybeSingle(),
    supabase
      .from('campaign_versions')
      .select('company_id, campaign_snapshot')
      .eq('campaign_id', id)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const campaign = campaignRes.data;
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  const companyId = versionRes.data?.company_id ?? null;

  // Derive post count from daily_plan for effort signal
  const snapshot = versionRes.data?.campaign_snapshot as any;
  const postCount: number | null = Array.isArray(snapshot?.daily_plan)
    ? (snapshot.daily_plan as any[]).length
    : null;

  // ── 2. Latest performance snapshot ────────────────────────────────────────
  const { data: perf } = await supabase
    .from('campaign_performance')
    .select('evaluation_status, evaluation_score, evaluation_summary, metric_breakdown, confidence_level, confidence_reason, next_topic, suggested_blog_id, suggested_blog_type')
    .eq('campaign_id', id)
    .order('recorded_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!perf || !perf.evaluation_status) {
    return res.status(200).json({
      has_data:       false,
      previous_result: null,
      decision:       null,
      pattern_memory: { patterns: [], dominant_topic_cluster: null, best_performing_goal: null, campaigns_analyzed: 0, portfolio_avg_score: 0 },
      timeline:       [{ campaign_id: id, campaign_name: campaign.name ?? 'This campaign', topic: campaign.topic_seed ?? null, goal_type: campaign.goal_type ?? null, status: null, score: null, stage: 'current' }],
      current_topic:  campaign.topic_seed ?? null,
      suggested_blog: null,
    });
  }

  // ── 3. Topic context (cached or freshly built) ────────────────────────────
  const currentTopic = campaign.topic_seed ?? 'content marketing';

  let topicMap = await getCampaignTopicMap(id);
  if (!topicMap || topicMap.related_topics.length === 0) {
    const graph = await buildTopicGraph(currentTopic);
    if (companyId) {
      await upsertCampaignTopicMap(id, companyId, currentTopic, graph).catch(() => {});
    }
    topicMap = { topic: graph.current_topic, related_topics: graph.related_topics, blog_ids: graph.related_blog_ids };
  }

  // ── 4. Decision engine ────────────────────────────────────────────────────
  const evaluationResult = {
    status:           perf.evaluation_status as 'exceeded' | 'met' | 'underperformed',
    score:            Number(perf.evaluation_score) || 50,
    summary:          perf.evaluation_summary ?? '',
    metric_breakdown: (perf.metric_breakdown ?? []) as any[],
    // confidence is loaded from the stored performance record (set during POST /performance)
    confidence: {
      level:  (perf as any).confidence_level  ?? 'low',
      score:  0,
      reason: (perf as any).confidence_reason ?? 'confidence not yet computed',
    },
  };

  const decision = decideNextAction(evaluationResult, {
    current_topic:    currentTopic,
    related_topics:   topicMap.related_topics,
    related_blog_ids: topicMap.blog_ids,
    goal_type:        (campaign.goal_type as any) ?? 'awareness',
  });

  // ── 5. Multi-campaign pattern memory ──────────────────────────────────────
  let patternMemory = { patterns: [] as any[], dominant_topic_cluster: null as string | null, best_performing_goal: null as string | null, campaigns_analyzed: 0, portfolio_avg_score: 0 };

  if (companyId) {
    // Fetch last 15 performance records for this company
    const { data: historyPerf } = await supabase
      .from('campaign_performance')
      .select('campaign_id, evaluation_status, evaluation_score, recorded_at')
      .eq('company_id', companyId)
      .not('evaluation_status', 'is', null)
      .order('recorded_at', { ascending: false })
      .limit(15);

    if (historyPerf && historyPerf.length > 0) {
      // Join with campaigns to get names, topics, goal_types
      const campIds = [...new Set((historyPerf as any[]).map((p) => p.campaign_id as string))];
      const { data: histCampaigns } = await supabase
        .from('campaigns')
        .select('id, name, goal_type, topic_seed')
        .in('id', campIds);

      const campMeta = new Map<string, { name: string; goal_type: string | null; topic_seed: string | null }>();
      for (const c of histCampaigns ?? []) {
        campMeta.set(c.id, { name: c.name ?? '', goal_type: c.goal_type ?? null, topic_seed: c.topic_seed ?? null });
      }

      // Deduplicate: one record per campaign (most recent)
      const seen = new Set<string>();
      const records: CampaignRecord[] = [];
      for (const p of historyPerf as any[]) {
        if (seen.has(p.campaign_id)) continue;
        seen.add(p.campaign_id);
        const meta = campMeta.get(p.campaign_id);
        records.push({
          campaign_id:       p.campaign_id,
          campaign_name:     meta?.name ?? 'Campaign',
          topic:             meta?.topic_seed ?? null,
          goal_type:         meta?.goal_type ?? null,
          evaluation_status: p.evaluation_status,
          evaluation_score:  p.evaluation_score != null ? Number(p.evaluation_score) : null,
          recorded_at:       p.recorded_at,
        });
      }

      patternMemory = recognizePatterns(records);
    }
  }

  // ── 6. Strategic timeline ─────────────────────────────────────────────────
  const timeline: JourneyStep[] = [];

  if (companyId) {
    // Fetch recent completed campaigns (excluding current)
    const { data: recentPerf } = await supabase
      .from('campaign_performance')
      .select('campaign_id, evaluation_status, evaluation_score, recorded_at')
      .eq('company_id', companyId)
      .not('evaluation_status', 'is', null)
      .neq('campaign_id', id)
      .order('recorded_at', { ascending: false })
      .limit(3);

    if (recentPerf && recentPerf.length > 0) {
      const prevIds = (recentPerf as any[]).map((p) => p.campaign_id as string);
      const { data: prevCampaigns } = await supabase
        .from('campaigns')
        .select('id, name, goal_type, topic_seed')
        .in('id', prevIds);

      const prevMeta = new Map<string, typeof prevCampaigns extends (infer T)[] | null ? T : never>();
      for (const c of prevCampaigns ?? []) prevMeta.set(c.id, c);

      // Show last 2 completed (chronological order)
      const deduped: any[] = [];
      const seenPrev = new Set<string>();
      for (const p of recentPerf as any[]) {
        if (!seenPrev.has(p.campaign_id)) { seenPrev.add(p.campaign_id); deduped.push(p); }
      }

      for (const p of deduped.slice(0, 2).reverse()) {
        const meta = prevMeta.get(p.campaign_id);
        timeline.push({
          campaign_id:   p.campaign_id,
          campaign_name: (meta as any)?.name ?? 'Previous Campaign',
          topic:         (meta as any)?.topic_seed ?? null,
          goal_type:     (meta as any)?.goal_type ?? null,
          status:        p.evaluation_status,
          score:         p.evaluation_score != null ? Number(p.evaluation_score) : null,
          stage:         'completed',
        });
      }
    }
  }

  // Current campaign
  timeline.push({
    campaign_id:   id,
    campaign_name: campaign.name ?? 'This Campaign',
    topic:         currentTopic,
    goal_type:     campaign.goal_type ?? null,
    status:        evaluationResult.status,
    score:         evaluationResult.score,
    stage:         'current',
  });

  // Suggested next
  timeline.push({
    campaign_id:   'suggested',
    campaign_name: `Next: ${decision.next_topic || 'Campaign'}`,
    topic:         decision.next_topic || null,
    goal_type:     decision.suggested_goal_type,
    status:        null,
    score:         null,
    stage:         'suggested',
  });

  // ── 7. Suggested blog ─────────────────────────────────────────────────────
  let suggestedBlog: { id: string; title: string; slug: string } | null = null;

  if (decision.suggested_blog_id) {
    // Resolve from correct table based on stored type discriminator
    const blogType = (perf as any).suggested_blog_type ?? 'public';
    const blogTable = blogType === 'company' ? 'blogs' : 'public_blogs';
    const statusFilter = blogType === 'company'
      ? { status: 'published' }
      : { status: 'published' };

    const { data: blog } = await supabase
      .from(blogTable)
      .select('id, title, slug')
      .eq('id', decision.suggested_blog_id)
      .eq('status', statusFilter.status)
      .maybeSingle();
    suggestedBlog = blog ?? null;
  }
  if (!suggestedBlog && decision.next_topic) {
    const topicBlogs = await getBlogsForTopic(decision.next_topic, 1);
    if (topicBlogs.length > 0) {
      suggestedBlog = { id: topicBlogs[0].id, title: topicBlogs[0].title, slug: topicBlogs[0].slug };
    }
  }

  // ── 8. Effort vs Impact signal ────────────────────────────────────────────
  type EffortLevel = 'high' | 'medium' | 'low';
  type OutcomeLevel = 'high' | 'medium' | 'low';
  type EffortSignalKey =
    | 'leverage' | 'high_performance' | 'inefficiency' | 'underpowered'
    | 'moderate_return' | 'strong_return' | 'efficient_baseline' | 'baseline';

  interface EffortSignal {
    effort_level:  EffortLevel | null;
    outcome_level: OutcomeLevel;
    signal:        EffortSignalKey | null;
    label:         string;
    description:   string;
  }

  function classifyEffortSignal(posts: number | null, score: number): EffortSignal {
    const outcome: OutcomeLevel = score >= 70 ? 'high' : score >= 50 ? 'medium' : 'low';

    if (posts === null) {
      return {
        effort_level: null,
        outcome_level: outcome,
        signal: null,
        label: outcome === 'high' ? 'Strong outcome' : outcome === 'medium' ? 'Moderate outcome' : 'Weak outcome',
        description: outcome === 'high'
          ? 'Campaign delivered strong results.'
          : outcome === 'medium'
          ? 'Campaign results were moderate — there is room to improve.'
          : 'Campaign underdelivered on its targets.',
      };
    }

    const effort: EffortLevel = posts >= 8 ? 'high' : posts >= 4 ? 'medium' : 'low';

    const SIGNAL_MAP: Record<EffortLevel, Record<OutcomeLevel, {
      signal: EffortSignalKey; label: string; description: string;
    }>> = {
      high: {
        high:   { signal: 'high_performance',  label: 'High-effort, high-return',       description: `${posts} posts delivered strong results — efficient execution. Maintain or scale this rhythm.` },
        medium: { signal: 'moderate_return',   label: 'High effort, moderate return',   description: `${posts} posts produced moderate results. Consider focusing on fewer, higher-quality posts.` },
        low:    { signal: 'inefficiency',      label: 'High effort, low return',        description: `${posts} posts underdelivered. The strategy needs rethinking — effort isn't the issue, direction is.` },
      },
      medium: {
        high:   { signal: 'strong_return',     label: 'Efficient — strong return',      description: `${posts} posts delivered high performance. Good signal-to-effort ratio.` },
        medium: { signal: 'baseline',          label: 'Baseline performance',           description: `${posts} posts, moderate results. A consistent baseline — incremental improvements will compound.` },
        low:    { signal: 'underpowered',      label: 'Underpowered campaign',          description: `${posts} posts weren't enough to gain traction. Either increase volume or concentrate effort.` },
      },
      low: {
        high:   { signal: 'leverage',          label: 'Leverage opportunity',           description: `Only ${posts} posts drove high performance — this topic is a leverage point. Scale it.` },
        medium: { signal: 'efficient_baseline',label: 'Lean and efficient',             description: `${posts} posts produced decent results — solid efficiency. Consider testing higher frequency.` },
        low:    { signal: 'underpowered',      label: 'Underpowered campaign',          description: `${posts} posts with weak results. More volume or a stronger angle is needed.` },
      },
    };

    const entry = SIGNAL_MAP[effort][outcome];
    return { effort_level: effort, outcome_level: outcome, ...entry };
  }

  const effortSignal = classifyEffortSignal(postCount, evaluationResult.score);

  // ── 9. Persist decision ───────────────────────────────────────────────────
  await supabase
    .from('campaign_performance')
    .update({
      recommended_action:         decision.action,
      next_topic:                 decision.next_topic,
      next_topic_reason:          decision.reason,
      suggested_blog_id:          suggestedBlog?.id ?? null,
      decision_confidence_level:  decision.decision_confidence.level,
      decision_confidence_reason: decision.decision_confidence.reason,
      stability_signal:           decision.stability.signal,
      stability_message:          decision.stability.message,
      trade_off_gained:           decision.trade_off?.gained ?? null,
      trade_off_sacrificed:       decision.trade_off?.sacrificed ?? null,
      trade_off_summary:          decision.trade_off?.summary ?? null,
      alternative_topic:          decision.alternative_path?.next_topic ?? null,
      alternative_goal_type:      decision.alternative_path?.suggested_goal_type ?? null,
      alternative_rationale:      decision.alternative_path?.rationale ?? null,
      counterfactual_insight:     decision.counterfactual ?? null,
      effort_level:               effortSignal.effort_level ?? null,
      effort_signal:              effortSignal.signal ?? null,
    })
    .eq('campaign_id', id)
    .order('recorded_at', { ascending: false })
    .limit(1);

  return res.status(200).json({
    has_data: true,
    previous_result: {
      status:     evaluationResult.status,
      score:      evaluationResult.score,
      summary:    evaluationResult.summary,
      confidence: evaluationResult.confidence,
    },
    decision,
    effort_signal: effortSignal,
    pattern_memory: patternMemory,
    timeline,
    current_topic:  currentTopic,
    suggested_blog: suggestedBlog,
  });
}

export default withRBAC(handler, [Role.SUPER_ADMIN, Role.ADMIN, Role.COMPANY_ADMIN]);
