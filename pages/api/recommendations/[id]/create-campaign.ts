import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { runCampaignAiPlan } from '../../../../backend/services/campaignAiOrchestrator';
import { Role } from '../../../../backend/services/rbacService';
import { withRBAC } from '../../../../backend/middleware/withRBAC';

type RecommendationSnapshot = {
  id: string;
  company_id: string;
  trend_topic: string;
  category?: string | null;
  audience?: any;
  geo?: any;
  platforms?: any;
  promotion_mode?: string | null;
};

const buildRecommendationContext = (
  snapshot: RecommendationSnapshot,
  decisionState?: string | null,
  teamOpinionSummary?: any,
  opportunityAnalysis?: any
) => {
  const context = {
    trend_topic: snapshot.trend_topic,
    category: snapshot.category ?? null,
    audience: snapshot.audience ?? null,
    geo: snapshot.geo ?? null,
    platforms: snapshot.platforms ?? null,
    promotion_mode: snapshot.promotion_mode ?? null,
    confidence: (snapshot as any)?.confidence ?? null,
    success_projection: (snapshot as any)?.success_projection ?? null,
    final_score: (snapshot as any)?.final_score ?? null,
    scores: (snapshot as any)?.scores ?? null,
    explanation: (snapshot as any)?.explanation ?? null,
    effort_score: (snapshot as any)?.effort_score ?? null,
    snapshot_hash: (snapshot as any)?.snapshot_hash ?? null,
    refresh_source: (snapshot as any)?.refresh_source ?? null,
    refreshed_at: (snapshot as any)?.refreshed_at ?? null,
    decision_state: decisionState ?? null,
    team_opinion_summary: teamOpinionSummary ?? null,
    opportunity_analysis: opportunityAnalysis ?? null,
  };
  console.debug('Recommendation enrichment context attached');
  return JSON.stringify(context, null, 2);
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Recommendation ID is required' });
  }

  try {
    const { durationWeeks } = req.body || {};

    const { data: recommendation, error: recError } = await supabase
      .from('recommendation_snapshots')
      .select('*')
      .eq('id', id)
      .single();

    if (recError || !recommendation) {
      return res.status(404).json({ error: 'Recommendation not found' });
    }

    const { data: decisionRow } = await supabase
      .from('audit_logs')
      .select('metadata')
      .eq('action', 'RECOMMENDATION_STATE_CHANGED')
      .eq('company_id', recommendation.company_id)
      .eq('metadata->>recommendation_id', recommendation.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const decisionState = decisionRow?.metadata?.state ? String(decisionRow.metadata.state) : null;

    const { data: opinionLogs } = await supabase
      .from('audit_logs')
      .select('actor_user_id, created_at, metadata')
      .eq('action', 'RECOMMENDATION_STATE_CHANGED')
      .eq('company_id', recommendation.company_id)
      .eq('metadata->>recommendation_id', recommendation.id)
      .order('created_at', { ascending: false });

    const summarySets = {
      shortlisted: new Set<string>(),
      discarded: new Set<string>(),
      active: new Set<string>(),
    };
    let lastAdminDecision: { state: string; actor_user_id: string | null; created_at: string | null } | null =
      null;
    (opinionLogs || []).forEach((log: any) => {
      const state = log?.metadata?.state ? String(log.metadata.state) : 'active';
      const actorUserId = log.actor_user_id ? String(log.actor_user_id) : null;
      const actorRole = log?.metadata?.actor_role ? String(log.metadata.actor_role) : null;
      if (actorUserId) {
        if (state === 'shortlisted') summarySets.shortlisted.add(actorUserId);
        if (state === 'discarded') summarySets.discarded.add(actorUserId);
        if (state === 'active') summarySets.active.add(actorUserId);
      }
      if (!lastAdminDecision && actorRole === Role.COMPANY_ADMIN) {
        lastAdminDecision = {
          state,
          actor_user_id: actorUserId ?? null,
          created_at: log.created_at ?? null,
        };
      }
    });
    const teamOpinionSummary = {
      shortlisted_count: summarySets.shortlisted.size,
      discarded_count: summarySets.discarded.size,
      active_count: summarySets.active.size,
      last_admin_decision: lastAdminDecision,
    };

    const { data: opportunityRow } = await supabase
      .from('audit_logs')
      .select('metadata')
      .eq('action', 'RECOMMENDATION_OPPORTUNITY_ANALYSIS')
      .eq('company_id', recommendation.company_id)
      .eq('metadata->>recommendation_id', recommendation.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const opportunityAnalysis = opportunityRow?.metadata?.opportunity_analysis ?? null;

    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .insert({
        name: `Trend: ${recommendation.trend_topic}`,
        description: `Auto-generated from recommendation ${recommendation.id}`,
        status: 'draft',
        current_stage: 'planning',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select('*')
      .single();

    if (campaignError || !campaign) {
      return res.status(500).json({ error: 'Failed to create campaign' });
    }

    const message =
      'Generate a 12-week content mix proposal based on this recommendation.\n' +
      'Use the provided context to propose: platforms, content types (video/blog/post/etc.), weekly frequency, and reuse opportunities across platforms.\n' +
      'Base the proposal on: confidence, final_score, company_profile (if present in context), and platforms.\n' +
      'After proposing, ask for confirmation one field at a time. For each field, provide two suggested options and accept user-provided alternatives.\n' +
      buildRecommendationContext(
        recommendation as RecommendationSnapshot,
        decisionState,
        teamOpinionSummary,
        opportunityAnalysis
      );

    const planResult = await runCampaignAiPlan({
      campaignId: campaign.id,
      mode: 'generate_plan',
      message,
      durationWeeks: typeof durationWeeks === 'number' ? durationWeeks : undefined,
    });

    const { error: linkError } = await supabase
      .from('recommendation_snapshots')
      .update({ campaign_id: campaign.id })
      .eq('id', recommendation.id);

    if (linkError) {
      console.warn('Failed to link recommendation to campaign', linkError.message);
    }

    try {
      const actorUserId = (req as any)?.rbac?.userId ?? null;
      await supabase.from('audit_logs').insert({
        action: 'RECOMMENDATION_CONVERTED_TO_CAMPAIGN',
        actor_user_id: actorUserId,
        company_id: recommendation.company_id,
        metadata: {
          recommendation_id: recommendation.id,
          campaign_id: campaign.id,
          snapshot_hash: recommendation.snapshot_hash ?? null,
        },
        created_at: new Date().toISOString(),
      });
    } catch (error) {
      console.warn('AUDIT_LOG_FAILED', error);
    }

    return res.status(200).json({
      campaign_id: campaign.id,
      snapshot_hash: planResult.snapshot_hash,
      omnivyre_decision: planResult.omnivyre_decision,
    });
  } catch (error: any) {
    console.error('Error creating campaign from recommendation:', error);
    return res.status(500).json({ error: 'Failed to create campaign from recommendation' });
  }
}

export default withRBAC(handler, [Role.SUPER_ADMIN, Role.ADMIN]);
