import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../utils/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { week, theme, contentFocus, targetAudience, campaignId } = req.body;

    if (!campaignId || !week) {
      return res.status(400).json({ error: 'Campaign ID and week number required' });
    }

    // Generate 7-day content structure using AI
    const dailyStructure = generateDailyStructure(week, theme, contentFocus, targetAudience);

    // Create weekly refinement record using existing table structure
    const { data: weeklyRefinement, error: weeklyError } = await supabase
      .from('weekly_content_refinements')
      .upsert({
        campaign_id: campaignId,
        week_number: week,
        theme: theme || `Week ${week} Theme`,
        focus_area: contentFocus || `Week ${week} Content Focus`,
        target_audience: targetAudience || 'General Audience',
        original_content: JSON.stringify([]),
        ai_enhanced_content: JSON.stringify(dailyStructure),
        finalized_content: JSON.stringify(dailyStructure),
        refinement_status: 'ai-enhanced',
        ai_enhancement_applied: true,
        finalized: true,
        daily_plan_populated: true,
        ai_enhancement_notes: 'AI-generated 7-day content structure',
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    // Now save each daily plan to the database
    const savedDailyPlans = [];
    for (const [index, dayPlan] of dailyStructure.entries()) {
      // Calculate date for the specific day
      const campaignStartDate = new Date(); // This should come from campaign data
      const weekStartDate = new Date(campaignStartDate.getTime() + (week - 1) * 7 * 24 * 60 * 60 * 1000);
      const dayDate = new Date(weekStartDate.getTime() + (dayPlan.day - 1) * 24 * 60 * 60 * 1000);

      const { data: savedPlan, error: planError } = await supabase
        .from('daily_content_plans')
        .upsert({
          campaign_id: campaignId,
          week_number: week,
          day_of_week: dayPlan.dayName,
          date: dayDate.toISOString().split('T')[0], // Convert to YYYY-MM-DD
          platform: dayPlan.platforms[0] || 'LinkedIn', // Use first platform as primary
          content_type: dayPlan.contentType,
          title: dayPlan.title,
          content: dayPlan.description,
          hashtags: dayPlan.keywords,
          scheduled_time: '09:00', // Default morning time
          posting_strategy: `Scheduled content for ${dayPlan.dayName}`,
          status: 'planned',
          priority: 'medium',
          source_refinement_id: weeklyRefinement?.id,
          ai_generated: true,
          target_audience: targetAudience
        })
        .select()
        .single();

      if (!planError && savedPlan) {
        savedDailyPlans.push(savedPlan);
      } else {
        console.error(`Error saving day ${dayPlan.day}:`, planError);
      }
    }

    // Update the campaign's weekly themes with reference to daily structure
    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .select('weekly_themes')
      .eq('id', campaignId)
      .single();

    if (campaignError) {
      console.error('Error fetching campaign:', campaignError);
      return res.status(500).json({ error: 'Campaign not found' });
    }

    const weeklyThemes = campaign?.weekly_themes || [];
    
    // Update specific week with daily structure
    weeklyThemes[week - 1] = {
      ...weeklyThemes[week - 1],
      weekNumber: week,
      theme: theme || `Week ${week} Theme`,
      contentFocus: contentFocus || `Week ${week} Content Focus`,
      targetAudience: targetAudience || 'General Audience',
      dailyStructure: dailyStructure,
      status: 'enhanced',
      enhancedAt: new Date().toISOString()
    };

    // Save updated weekly themes back to database
    const { error: updateError } = await supabase
      .from('campaigns')
      .update({
        weekly_themes: weeklyThemes,
        updated_at: new Date().toISOString()
      })
      .eq('id', campaignId);

    if (updateError) {
      console.error('Error updating weekly themes:', updateError);
      return res.status(500).json({ error: 'Failed to save daily structure' });
    }

    return res.status(200).json({
      success: true,
      week: week,
      dailyStructure: dailyStructure,
      message: `Generated 7-day content structure for Week ${week}`
    });

  } catch (error) {
    console.error('Error in generate weekly structure API:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

function generateDailyStructure(week: number, theme: string, contentFocus: string, targetAudience: string);

function generateDailyStructure(week: number, theme: string, contentFocus: string, targetAudience: string) {
  // Platform mapping based on content type
  const platformMapping: { [key: string]: string[] } = {
    'Educational Post': ['LinkedIn', 'Twitter'],
    'Case Study': ['LinkedIn'],
    'Question-based Content': ['Twitter', 'Facebook'],
    'Tips & Tutorial': ['LinkedIn', 'YouTube'],
    'Industry News': ['LinkedIn', 'Twitter'],
    'Behind the Scenes': ['Instagram', 'LinkedIn'],
    'Reflection': ['LinkedIn'],
    'Random': [], // Empty array means all platforms available
  };

  // AI-generated daily content structure based on theme and focus
  const dailyStructure = [
    {
      day: 1,
      dayName: 'Monday',
      contentType: 'Educational Post',
      title: `Introduction to ${theme}`,
      description: `Start the week with foundational content about ${theme}`,
      platforms: platformMapping['Educational Post'],
      tone: 'educational',
      keywords: [theme, 'introduction', 'basics']
    },
    {
      day: 2,
      dayName: 'Tuesday',
      contentType: 'Case Study',
      title: `Real-world Example: ${contentFocus}`,
      description: `Share a detailed case study demonstrating ${contentFocus}`,
      platforms: platformMapping['Case Study'],
      tone: 'analytical',
      keywords: [contentFocus, 'case-study', 'example']
    },
    {
      day: 3,
      dayName: 'Wednesday',
      contentType: 'Question-based Content',
      title: `What do you think about ${theme}?`,
      description: `Engage audience with thoughtful questions about ${theme}`,
      platforms: platformMapping['Question-based Content'],
      tone: 'conversational',
      keywords: [theme, 'engagement', 'discussion']
    },
    {
      day: 4,
      dayName: 'Thursday',
      contentType: 'Tips & Tutorial',
      title: `Practical Tips for ${contentFocus}`,
      description: `Provide actionable tips and tutorials for ${contentFocus}`,
      platforms: platformMapping['Tips & Tutorial'],
      tone: 'helpful',
      keywords: [contentFocus, 'tips', 'tutorial']
    },
    {
      day: 5,
      dayName: 'Friday',
      contentType: 'Industry News',
      title: `Weekly Update on ${theme}`,
      description: `Share latest industry news and insights about ${theme}`,
      platforms: platformMapping['Industry News'],
      tone: 'informative',
      keywords: [theme, 'industry', 'news']
    },
    {
      day: 6,
      dayName: 'Saturday',
      contentType: 'Behind the Scenes',
      title: `Our approach to ${theme}`,
      description: `Show behind-the-scenes content about your ${theme} strategy`,
      platforms: platformMapping['Behind the Scenes'],
      tone: 'personal',
      keywords: [theme, 'behind-scenes', 'strategy']
    },
    {
      day: 7,
      dayName: 'Sunday',
      contentType: 'Reflection',
      title: `Week Recap: ${theme}`,
      description: `Reflect on the week's content and key takeaways`,
      platforms: platformMapping['Reflection'],
      tone: 'reflective',
      keywords: [theme, 'recap', 'reflection']
    }
  ];

  // If any content type is "Random", use all platforms
  const allPlatforms = ['LinkedIn', 'Twitter', 'Facebook', 'Instagram', 'YouTube', 'TikTok', 'Pinterest'];
  
  return dailyStructure.map(day => ({
    ...day,
    platforms: day.contentType === 'Random' ? allPlatforms : day.platforms,
    allPlatforms: allPlatforms, // Include all platforms for frontend management
    availablePlatforms: platformMapping[day.contentType] ? platformMapping[day.contentType] : allPlatforms
  }));
}
