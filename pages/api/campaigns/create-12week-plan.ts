import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../utils/supabaseClient';
import { v4 as uuidv4 } from 'uuid';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    let { campaignId, startDate, aiContent, provider } = req.body;
    console.log('API Request body:', { campaignId, startDate, aiContent: aiContent?.substring(0, 100) + '...', provider });

    if (!campaignId || !startDate || !aiContent) {
      console.error('Missing required fields:', { campaignId: !!campaignId, startDate: !!startDate, aiContent: !!aiContent });
      return res.status(400).json({ error: 'Missing required fields' });
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
    
    let { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .select('*')
      .eq('id', campaignId)
      .single();

    if (campaignError) {
      console.log('Campaign does not exist, creating new one:', campaignError.message);
      // Create the campaign with the provided campaignId
      const { data: newCampaign, error: createError } = await supabase
        .from('campaigns')
        .insert({
          id: campaignId, // Use the provided campaign ID
          name: req.body.campaignName || 'New Campaign', // Use provided name or default
          description: aiContent.substring(0, 200) + '...',
          status: 'planning',
          current_stage: 'planning',
          timeframe: 'quarter',
          start_date: startDate,
          ai_generated_summary: aiContent,
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
        return res.status(500).json({ error: 'Failed to update campaign', details: updateError });
      }
      
      campaign = updatedCampaign;
      console.log('Campaign updated successfully:', campaign?.id);
    }

    // Generate 12-week themes and content
    const weeklyThemes = generateWeeklyThemes(aiContent);
    const weeklyPlans = generateWeeklyPlans(startDateObj, aiContent);

    // Update campaign with weekly themes
    await supabase
      .from('campaigns')
      .update({
        weekly_themes: weeklyThemes,
        updated_at: new Date().toISOString()
      })
      .eq('id', campaignId);

    // Create weekly content refinements (if table exists)
    const weeklyRefinements = [];
    try {
      for (let week = 1; week <= 12; week++) {
        const weekStartDate = new Date(startDateObj);
        weekStartDate.setDate(startDateObj.getDate() + (week - 1) * 7);
        
        const weekEndDate = new Date(weekStartDate);
        weekEndDate.setDate(weekStartDate.getDate() + 6);

        const { data: refinement, error: refinementError } = await supabase
          .from('weekly_content_refinements')
          .insert({
            campaign_id: campaignId,
            week_number: week,
            theme: weeklyThemes[week - 1]?.theme || `Week ${week} Theme`,
            focus_area: weeklyThemes[week - 1]?.focusArea || `Week ${week} Focus`,
            ai_suggestions: weeklyThemes[week - 1]?.suggestions || [],
            refinement_status: 'ai_enhanced',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .select()
          .single();

        if (!refinementError && refinement) {
          weeklyRefinements.push(refinement);
        } else if (refinementError) {
          console.log(`Week ${week} refinement error:`, refinementError);
        }
      }
    } catch (error) {
      console.log('Weekly refinements table might not exist yet:', error);
    }

    // Create campaign performance records for each week (if table exists)
    try {
      for (let week = 1; week <= 12; week++) {
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
      message: '12-week plan created successfully',
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

function generateWeeklyThemes(aiContent: string) {
  // Extract themes from AI content or generate default themes
  const themes = [
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

  return themes;
}

function generateWeeklyPlans(startDate: Date, aiContent: string) {
  const plans = [];
  
  for (let week = 1; week <= 12; week++) {
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
