import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getUnifiedCampaignBlueprint } from '../../../backend/services/campaignBlueprintService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { campaignId: campaignIdQuery, action } = req.query;
    const campaignId = Array.isArray(campaignIdQuery) ? campaignIdQuery[0] : campaignIdQuery;

    if (!campaignId || typeof campaignId !== 'string') {
      return res.status(400).json({ error: 'Campaign ID required' });
    }

    switch (action) {
      case 'get-overview':
        // Get campaign data — try campaigns table first, then campaign_versions snapshot (opportunity-promoted)
        let campaign: { id: string; name?: string; description?: string; status?: string; created_at?: string; weekly_themes?: unknown } | null = null;
        const { data: campaignRow, error: campaignError } = await supabase
          .from('campaigns')
          .select('id, name, description, status, created_at, weekly_themes, company_id, duration_weeks')
          .eq('id', campaignId)
          .maybeSingle();

        if (!campaignError && campaignRow) {
          campaign = campaignRow;
        }
        if (!campaign) {
          const { data: versionRow } = await supabase
            .from('campaign_versions')
            .select('campaign_snapshot')
            .eq('campaign_id', campaignId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          const snap = versionRow?.campaign_snapshot as { campaign?: { id?: string; name?: string; description?: string; status?: string; created_at?: string; weekly_themes?: unknown } } | undefined;
          if (snap?.campaign) {
            campaign = { id: campaignId, ...snap.campaign };
          }
        }
        if (!campaign) {
          const blueprint = await getUnifiedCampaignBlueprint(campaignId as string);
          if (blueprint?.weeks && blueprint.weeks.length > 0) {
            campaign = { id: campaignId, name: 'Your Campaign', status: 'planning', created_at: new Date().toISOString(), weekly_themes: null };
          } else {
            return res.status(404).json({
              success: false,
              error: 'Campaign not found',
            });
          }
        }

        // Blueprint (twelve_week_plan) is source of truth for committed plans — check first
        const blueprint = await getUnifiedCampaignBlueprint(campaignId as string);
        const { data: weeklyRefinements } = await supabase
          .from('weekly_content_refinements')
          .select('*')
          .eq('campaign_id', campaignId)
          .order('week_number');
        const campaignDuration = (campaign as { duration_weeks?: number | null })?.duration_weeks;
        const durationWeeks = blueprint?.duration_weeks ?? weeklyRefinements?.length ?? (campaignDuration != null && campaignDuration >= 1 && campaignDuration <= 52 ? campaignDuration : 12);

        // Create week plans: prefer blueprint (committed), then refinements
        let weekPlans: any[] = [];
        if (blueprint?.weeks && blueprint.weeks.length > 0) {
          weekPlans = blueprint.weeks.map((w) => ({
            id: `week-${w.week_number}`,
            week: w.week_number,
            status: 'ai-enhanced',
            theme: w.phase_label,
            contentFocus: w.primary_objective || w.phase_label,
            targetAudience: 'General Audience',
            keyMessaging: w.topics_to_cover?.join('; ') || 'AI-generated messaging',
            contentTypes: w.content_type_mix || ['post', 'video', 'story'],
            platformStrategy: 'Multi-platform',
            callToAction: 'Engage with content',
            successMetrics: { reach: 1000, engagement: 50, conversions: 10 },
            createdAt: new Date().toISOString(),
            refinementData: w,
            aiContent: w.topics_to_cover || [],
            dailyContent: {},
            platforms: w.platform_content_breakdown ? Object.keys(w.platform_content_breakdown) : (w.platform_allocation ? Object.keys(w.platform_allocation) : []),
            platform_allocation: w.platform_allocation || {},
            platform_content_breakdown: w.platform_content_breakdown || {},
            topics_to_cover: w.topics_to_cover || [],
            aiSuggestions: w.topics_to_cover || [],
            week_extras: w.week_extras ?? {}
          }));
        }
        if (weekPlans.length === 0) {
          weekPlans = weeklyRefinements?.map((refinement: any) => ({
            id: refinement.id,
            week: refinement.week_number,
            status: refinement.refinement_status || 'ai-enhanced',
            theme: refinement.theme || `Week ${refinement.week_number}`,
            contentFocus: refinement.focus_area || refinement.ai_suggestions?.join(', ') || 'AI Generated Content',
            targetAudience: refinement.target_audience || 'General Audience',
            keyMessaging: refinement.key_messaging || 'AI-generated messaging',
            contentTypes: refinement.content_types || ['post', 'video', 'story'],
            platformStrategy: refinement.platform_strategy || 'Multi-platform',
            callToAction: refinement.call_to_action || 'Engage with content',
            successMetrics: {
              reach: refinement.expected_reach || 1000,
              engagement: refinement.expected_engagement || 50,
              conversions: refinement.expected_conversions || 10
            },
            createdAt: refinement.created_at,
            refinementData: refinement,
            aiContent: refinement.ai_enhanced_content || refinement.original_content || refinement.ai_suggestions || [],
            dailyContent: refinement.daily_content_structure || {},
            platforms: refinement.platforms || ['linkedin', 'facebook', 'instagram', 'twitter', 'youtube'],
            aiSuggestions: refinement.ai_suggestions || []
          })) || [];
        }

        // Placeholder fallback only when neither blueprint nor refinements exist
        if (weekPlans.length === 0) {
          weekPlans = Array.from({ length: durationWeeks }, (_, index) => ({
            id: `week-${index + 1}`,
            week: index + 1,
            status: 'pending',
            theme: `Week ${index + 1}`,
            contentFocus: 'To be planned',
            targetAudience: 'General Audience',
            keyMessaging: 'Key messaging to be defined',
            contentTypes: ['post'],
            platformStrategy: 'Multi-platform',
            callToAction: 'Engage with content',
            successMetrics: { reach: 0, engagement: 0, conversions: 0 },
            createdAt: new Date().toISOString(),
            refinementData: null,
            aiContent: null,
            dailyContent: null,
            platforms: [],
            aiSuggestions: []
          }));
        }

        // Progress reflects actual work: skeleton-only = 15%, content plan (topics+platforms) = 50%
        const SCORE_SKELETON = 15;
        const SCORE_CONTENT_PLAN = 50;
        const getWeekScore = (p: any): number => {
          const hasTopics = Array.isArray(p.topics_to_cover) && p.topics_to_cover.length > 0;
          const hasBreakdown = p.platform_content_breakdown && typeof p.platform_content_breakdown === 'object'
            && Object.values(p.platform_content_breakdown).some((arr: any) => Array.isArray(arr) && arr.length > 0);
          const hasPlatforms = p.platform_allocation && typeof p.platform_allocation === 'object'
            && Object.keys(p.platform_allocation).length > 0;
          const hasContentPlan = (hasTopics || hasBreakdown) && hasPlatforms;
          return hasContentPlan ? SCORE_CONTENT_PLAN : SCORE_SKELETON;
        };
        const totalScore = weekPlans.reduce((sum: number, p: any) => sum + getWeekScore(p), 0);
        const maxScore = durationWeeks * 100; // 100 per week when fully done (content plan + daily); skeleton=15, content-only=50
        const progressPercentage = durationWeeks > 0 ? Math.min(100, Math.round((totalScore / maxScore) * 100)) : 0;
        const completedWeeks = weekPlans.filter((p: any) => getWeekScore(p) >= SCORE_CONTENT_PLAN).length;

        return res.status(200).json({
          overview: {
            totalWeeks: durationWeeks,
            completedWeeks: completedWeeks,
            progressPercentage,
            campaigns: [
              {
                id: campaign.id,
                name: campaign.name || 'Campaign ' + campaignId,
                userId: 'user-123',
                status: campaign.status || 'planning',
                progress: progressPercentage,
                createdAt: campaign.created_at || new Date().toISOString(),
                description: campaign.description,
                company_id: (campaign as { company_id?: string }).company_id
              }
            ],
            plans: weekPlans
          }
        });

      case 'get-weeks':
        // Get all weeks for the campaign
        const { data: weeks, error: weeksError } = await supabase
          .from('weekly_content_refinements')
      .select('*')
      .eq('campaign_id', campaignId)
          .order('week');

        if (weeksError) {
          return res.status(200).json({ weeks: [] });
        }

        return res.status(200).json({ weeks });

      default:
        return res.status(400).json({ error: 'Invalid action' });
    }

  } catch (error) {
    console.error('Error in hierarchical-navigation API:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
