import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getCampaignById } from '../../../backend/db/campaignStore';
import { v4 as uuidv4 } from 'uuid';
import { fromLegacyRefinements, fromStructuredPlan, blueprintWeeksToLegacyRefinements } from '../../../backend/services/campaignBlueprintAdapter';
import { saveCampaignBlueprintFromLegacy } from '../../../backend/db/campaignPlanStore';
import { syncCampaignVersionStage } from '../../../backend/db/campaignVersionStore';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    let { campaignId, startDate, aiContent, provider, companyId, durationWeeks: reqDurationWeeks, structuredPlan, weeks: reqWeeks } = req.body;
    const hasStructuredPlan = (Array.isArray(reqWeeks) && reqWeeks.length > 0) || (structuredPlan && Array.isArray(structuredPlan?.weeks) && structuredPlan.weeks.length > 0);
    const weeksFromPlan = reqWeeks ?? structuredPlan?.weeks ?? [];
    console.log('API Request body:', { campaignId, startDate, hasStructuredPlan, weeksCount: weeksFromPlan?.length, durationWeeks: reqDurationWeeks });

    if (!campaignId || !startDate) {
      return res.status(400).json({ error: 'campaignId and startDate are required' });
    }
    if (!hasStructuredPlan && !aiContent) {
      return res.status(400).json({ error: 'Either aiContent or structuredPlan.weeks is required' });
    }

    const startDateObj = new Date(startDate);
    
    // First check if campaign exists, if not create it
    console.log('Checking campaign existence with ID:', campaignId);
    
    // Check if campaignId is a valid UUID, if not generate a new one
    const isValidUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(campaignId);
    if (!isValidUUID) {
      console.log('Invalid UUID format, generating new UUID for campaign');
      campaignId = uuidv4();
    }
    
    let campaign = await getCampaignById(campaignId, '*');

    if (!campaign) {
      console.log('Campaign does not exist, creating new one');
      // Create the campaign with the provided campaignId
      const summary = (aiContent || JSON.stringify(structuredPlan?.weeks || []).slice(0, 200)) + '...';
      const { data: newCampaign, error: createError } = await supabase
        .from('campaigns')
        .insert({
          id: campaignId, // Use the provided campaign ID
          name: req.body.campaignName || 'New Campaign', // Use provided name or default
          description: summary,
          status: 'planning',
          current_stage: 'planning',
          timeframe: 'quarter',
          start_date: startDate,
          ai_generated_summary: aiContent || summary,
          user_id: '550e8400-e29b-41d4-a716-446655440000', // Default user
          thread_id: 'thread_' + Date.now(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select()
        .single();

      if (createError) {
        console.error('Error creating campaign:', createError);
        return res.status(500).json({ error: 'Failed to create campaign', details: createError });
      }
      
      campaign = newCampaign;
      console.log('Campaign created successfully:', campaign?.id);

      // Ensure campaign appears on dashboard: insert campaign_versions when companyId provided
      if (companyId && typeof companyId === 'string') {
        const { error: cvError } = await supabase.from('campaign_versions').insert({
          company_id: companyId,
          campaign_id: campaignId,
          campaign_snapshot: { campaign },
          status: 'planning',
          version: 1,
          created_at: new Date().toISOString(),
        });
        if (cvError) console.warn('campaign_versions insert failed:', cvError.message);
      }

      // Update campaignId to the actual database ID for the response
      campaignId = campaign.id;
    } else {
      // Update existing campaign
      console.log('Campaign exists, updating it');
      const { data: updatedCampaign, error: updateError } = await supabase
        .from('campaigns')
        .update({
          start_date: startDate,
          ai_generated_summary: aiContent,
          updated_at: new Date().toISOString()
        })
        .eq('id', campaignId)
        .select()
        .single();

      if (updateError) {
        console.error('Error updating campaign:', updateError);
        const msg = updateError.message || 'Unknown database error';
        const hint = updateError.code === '42703' ? 'Missing column - run migrations: ai_generated_summary, weekly_themes' : null;
        return res.status(500).json({
          error: 'Failed to update campaign',
          details: msg,
          hint,
          code: updateError.code,
        });
      }
      
      campaign = updatedCampaign;
      console.log('Campaign updated successfully:', campaign?.id);
    }

    // Resolve duration: request > campaign.duration_weeks > 12 (user/AI-selected duration takes precedence)
    const campaignDuration = (campaign as { duration_weeks?: number | null })?.duration_weeks;
    const durationWeeks = typeof reqDurationWeeks === 'number' && reqDurationWeeks >= 1 && reqDurationWeeks <= 52
      ? Math.floor(reqDurationWeeks)
      : (campaignDuration != null && campaignDuration >= 1 && campaignDuration <= 52 ? campaignDuration : 12);

    let blueprint;
    let weeklyThemes: { theme: string; focusArea: string; suggestions: string[] }[];

    if (hasStructuredPlan) {
      // Use finalized structured plan (topics, platform_content_breakdown, etc.) — preserves all details
      blueprint = fromStructuredPlan({ weeks: weeksFromPlan, campaign_id: campaignId });
      weeklyThemes = blueprint.weeks.map((w) => ({
        theme: w.phase_label || `Week ${w.week_number}`,
        focusArea: w.primary_objective || '',
        suggestions: w.topics_to_cover ?? [],
      }));
    } else {
      const themes = generateWeeklyThemes(aiContent || '', durationWeeks);
      weeklyThemes = themes.map((t) => ({
        theme: t.theme,
        focusArea: t.focusArea ?? (t as any).focus_area ?? '',
        suggestions: t.suggestions || [],
      }));
      const syntheticRefinements = themes.map((t, i) => ({
        week_number: i + 1,
        theme: t.theme,
        focus_area: (t as any).focus_area ?? t.theme,
        ai_suggestions: t.suggestions || [],
        content_plan: null,
      }));
      blueprint = fromLegacyRefinements(syntheticRefinements, campaignId);
    }

    await supabase
      .from('campaigns')
      .update({
        weekly_themes: weeklyThemes,
        current_stage: 'twelve_week_plan',
        duration_weeks: blueprint.duration_weeks || durationWeeks,
        updated_at: new Date().toISOString()
      })
      .eq('id', campaignId);
    void syncCampaignVersionStage(campaignId, 'twelve_week_plan', companyId).catch(() => {});

    await saveCampaignBlueprintFromLegacy({
      campaignId,
      blueprint,
      source: hasStructuredPlan ? 'structured-commit' : 'create-12week-plan',
    });
    console.warn('DEPRECATED: create-12week-plan now writes blueprint first; legacy weekly_content_refinements derived from blueprint');

    const derivedRefinements = blueprintWeeksToLegacyRefinements(blueprint.weeks, campaignId, {
      suggestions: (_, idx) => weeklyThemes[idx]?.suggestions ?? [],
    });

    let weeklyRefinements: any[] = [];
    try {
      console.warn('DEPRECATED: weekly_content_refinements write path triggered (create-12week-plan)');
      for (const row of derivedRefinements) {
        const { data: refinement, error: refinementError } = await supabase
          .from('weekly_content_refinements')
          .insert({
            campaign_id: row.campaign_id,
            week_number: row.week_number,
            theme: row.theme,
            focus_area: row.focus_area,
            ai_suggestions: row.ai_suggestions ?? [],
            refinement_status: row.refinement_status ?? 'ai_enhanced',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .select()
          .single();
        if (!refinementError && refinement) weeklyRefinements.push(refinement);
        else if (refinementError) console.log(`Week ${row.week_number} refinement error:`, refinementError);
      }
    } catch (error) {
      console.log('Weekly refinements table might not exist yet:', error);
    }

    const perfDurationWeeks = blueprint.duration_weeks || blueprint.weeks.length || durationWeeks;
    try {
      for (let week = 1; week <= perfDurationWeeks; week++) {
        const weekStartDate = new Date(startDateObj);
        weekStartDate.setDate(startDateObj.getDate() + (week - 1) * 7);
        
        const weekEndDate = new Date(weekStartDate);
        weekEndDate.setDate(weekStartDate.getDate() + 6);

        const { error: performanceError } = await supabase
          .from('campaign_performance')
          .insert({
            campaign_id: campaignId,
            performance_date: weekStartDate.toISOString().split('T')[0],
            total_reach: 1000, // Default targets
            total_engagement: 50,
            total_conversions: 10,
            platform_breakdown: {},
            content_type_breakdown: {},
            ai_suggestions_implemented: 0,
            improvement_score: 0.0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });

        if (performanceError) {
          console.log(`Week ${week} performance error:`, performanceError);
        }
      }
    } catch (error) {
      console.log('Campaign performance table might not exist yet:', error);
    }

    res.status(200).json({ 
      success: true, 
      message: 'Campaign plan created successfully',
      data: {
        campaignId,
        startDate,
        weeklyThemes,
        weeklyRefinements: weeklyRefinements.length
      }
    });

  } catch (error) {
    console.error('Error in create-12week-plan API:', error);
    res.status(500).json({ 
      error: 'Internal server error', 
      details: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
  }
}

function generateWeeklyThemes(aiContent: string, count: number = 12) {
  const base = [
    { theme: 'Foundation & Awareness', focusArea: 'Brand Introduction', suggestions: ['Company story', 'Team introduction', 'Value proposition'] },
    { theme: 'Problem-Solution Fit', focusArea: 'Pain Points', suggestions: ['Customer problems', 'Solution benefits', 'Case studies'] },
    { theme: 'Educational Authority', focusArea: 'Industry Expertise', suggestions: ['How-to guides', 'Industry insights', 'Best practices'] },
    { theme: 'Social Proof', focusArea: 'User Testimonials', suggestions: ['Customer stories', 'Success metrics', 'Reviews'] },
    { theme: 'Feature Deep-Dives', focusArea: 'Product Education', suggestions: ['Feature tutorials', 'Use cases', 'Comparisons'] },
    { theme: 'Community Building', focusArea: 'Engagement', suggestions: ['Interactive content', 'Polls', 'Q&A sessions'] },
    { theme: 'Thought Leadership', focusArea: 'Industry Trends', suggestions: ['Market analysis', 'Future predictions', 'Expert opinions'] },
    { theme: 'Behind-the-Scenes', focusArea: 'Company Culture', suggestions: ['Team activities', 'Office tours', 'Process insights'] },
    { theme: 'User-Generated Content', focusArea: 'Community Content', suggestions: ['User submissions', 'Contests', 'Showcases'] },
    { theme: 'Data & Insights', focusArea: 'Analytics', suggestions: ['Performance data', 'Industry stats', 'Research findings'] },
    { theme: 'Partnerships', focusArea: 'Collaborations', suggestions: ['Partner features', 'Joint content', 'Cross-promotion'] },
    { theme: 'Call-to-Action', focusArea: 'Conversion', suggestions: ['Trial offers', 'Limited promotions', 'Sign-up campaigns'] }
  ];
  const n = Math.max(1, Math.min(52, Math.floor(count)));
  if (n <= base.length) return base.slice(0, n);
  const result = [...base];
  for (let i = base.length; i < n; i++) {
    result.push({ theme: `Week ${i + 1} Focus`, focusArea: 'Content & Engagement', suggestions: ['Ongoing topics', 'Audience feedback', 'Performance optimization'] });
  }
  return result;
}

function generateWeeklyPlans(startDate: Date, aiContent: string, durationWeeks: number) {
  const plans = [];
  for (let week = 1; week <= durationWeeks; week++) {
    const weekStartDate = new Date(startDate);
    weekStartDate.setDate(startDate.getDate() + (week - 1) * 7);
    
    const weekEndDate = new Date(weekStartDate);
    weekEndDate.setDate(weekStartDate.getDate() + 6);

    plans.push({
      weekNumber: week,
      startDate: weekStartDate.toISOString().split('T')[0],
      endDate: weekEndDate.toISOString().split('T')[0],
      theme: `Week ${week} Theme`,
      contentItems: [
        { platform: 'linkedin', type: 'post', day: 'Monday' },
        { platform: 'instagram', type: 'story', day: 'Tuesday' },
        { platform: 'facebook', type: 'post', day: 'Wednesday' },
        { platform: 'twitter', type: 'thread', day: 'Thursday' },
        { platform: 'youtube', type: 'video', day: 'Friday' }
      ]
    });
  }

  return plans;
}
