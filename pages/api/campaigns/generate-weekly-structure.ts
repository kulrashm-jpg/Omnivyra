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

    // Fetch campaign for theme context
    const { data: campaignData } = await supabase
      .from('campaigns')
      .select('name, description')
      .eq('id', campaignId)
      .maybeSingle();
    const campaignTheme = campaignData?.description || campaignData?.name || '';

    // Generate 7-day content structure with rich fields
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

    // Remove existing daily plans for this week before inserting (avoid duplicates on re-generate)
    await supabase
      .from('daily_content_plans')
      .delete()
      .eq('campaign_id', campaignId)
      .eq('week_number', week);

    // Now save each daily plan to the database — one row per platform when multiple platforms
    const savedDailyPlans = [];
    const weekTheme = theme || `Week ${week} Theme`;
    for (const [index, dayPlan] of dailyStructure.entries()) {
      const campaignStartDate = new Date();
      const weekStartDate = new Date(campaignStartDate.getTime() + (week - 1) * 7 * 24 * 60 * 60 * 1000);
      const dayDate = new Date(weekStartDate.getTime() + (dayPlan.day - 1) * 24 * 60 * 60 * 1000);
      const platforms = Array.isArray(dayPlan.platforms) && dayPlan.platforms.length > 0
        ? dayPlan.platforms
        : ['LinkedIn'];

      for (const platform of platforms) {
        const platformKey = typeof platform === 'string' ? platform.toLowerCase() : 'linkedin';
        const row = {
          campaign_id: campaignId,
          week_number: week,
          day_of_week: dayPlan.dayName,
          date: dayDate.toISOString().split('T')[0],
          platform: platformKey,
          content_type: dayPlan.contentType,
          title: dayPlan.title,
          content: dayPlan.description || '',
          topic: dayPlan.topic ?? dayPlan.title,
          intro_objective: dayPlan.introObjective,
          objective: dayPlan.objective,
          summary: dayPlan.description,
          key_points: Array.isArray(dayPlan.keyPoints) ? dayPlan.keyPoints : null,
          cta: dayPlan.cta,
          brand_voice: dayPlan.brandVoice ?? dayPlan.tone,
          theme_linkage: dayPlan.themeLinkage,
          format_notes: dayPlan.formatNotes,
          week_theme: weekTheme,
          campaign_theme: campaignTheme,
          hashtags: dayPlan.keywords || [],
          scheduled_time: '09:00',
          posting_strategy: `Scheduled content for ${dayPlan.dayName}`,
          status: 'planned',
          priority: 'medium',
          source_refinement_id: weeklyRefinement?.id,
          ai_generated: true,
          target_audience: targetAudience
        };
        const { data: savedPlan, error: planError } = await supabase
          .from('daily_content_plans')
          .insert(row)
          .select()
          .single();

        if (!planError && savedPlan) {
          savedDailyPlans.push(savedPlan);
        } else {
          console.error(`Error saving ${dayPlan.dayName} ${platformKey}:`, planError);
        }
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

  // Content-creation ready: topic, intro, subject brief (ideas aligned to daily + weekly), message, tone
  const dailyStructure = [
    {
      day: 1,
      dayName: 'Monday',
      contentType: 'Educational Post',
      title: `Introduction to ${theme}`,
      description: `Foundational content about ${theme} aligned to ${contentFocus}`,
      topic: theme,
      introObjective: `Open by naming the core tension or need your audience feels (e.g. "Most professionals struggle to X...") — then show why ${theme} is the answer. Set the stage for the week.`,
      objective: `Establish authority on ${theme}; signal that this week delivers on ${contentFocus}. Drive saves and follows.`,
      keyPoints: [
        `Define ${theme} in one clear sentence`,
        `Why it matters for ${targetAudience || 'your audience'}`,
        `What they'll gain from this week's content`,
        `Preview: how each day builds on this`
      ],
      cta: 'Follow for daily insights this week',
      themeLinkage: `Day 1 of week — introduces ${theme}; sets up ${contentFocus}.`,
      formatNotes: 'LinkedIn: 800–1200 chars, carousel-friendly. Twitter: thread or single post.',
      platforms: platformMapping['Educational Post'],
      tone: 'educational',
      keywords: []
    },
    {
      day: 2,
      dayName: 'Tuesday',
      contentType: 'Case Study',
      title: `Real-world example: ${contentFocus}`,
      description: `Case study that demonstrates ${contentFocus} in action`,
      topic: contentFocus,
      introObjective: `Start with the result or transformation (e.g. "Within 4 weeks, they achieved...") — then unpack how.`,
      objective: `Build credibility through proof; show ${theme} works. Encourage shares and comments.`,
      keyPoints: [
        `The challenge or situation (1–2 sentences)`,
        `The approach tied to ${theme}`,
        `Specific outcome and metrics`,
        `One key lesson for the reader`
      ],
      cta: 'Share your own experience in the comments',
      themeLinkage: `Day 2 — reinforces ${theme} with real-world proof; advances ${contentFocus}.`,
      formatNotes: 'LinkedIn article or long-form post',
      platforms: platformMapping['Case Study'],
      tone: 'analytical',
      keywords: []
    },
    {
      day: 3,
      dayName: 'Wednesday',
      contentType: 'Question-based Content',
      title: `What do you think about ${theme}?`,
      description: `Engage with questions that surface how your audience relates to ${theme}`,
      topic: theme,
      introObjective: `Open with one provocative or honest question (e.g. "What's the one thing blocking you from...?") — invite curiosity.`,
      objective: `Drive comments; surface pain points and perspectives; deepen the ${contentFocus} narrative.`,
      keyPoints: [
        `Primary question tied to ${theme}`,
        `2–3 short follow-up prompts`,
        `Why their input matters (community, learning)`,
        `Link back to what you're covering this week`
      ],
      cta: 'Drop your answer below',
      themeLinkage: `Day 3 — crowdsources perspectives; keeps ${theme} and ${contentFocus} conversational.`,
      formatNotes: 'Short post, poll, or carousel with questions',
      platforms: platformMapping['Question-based Content'],
      tone: 'conversational',
      keywords: []
    },
    {
      day: 4,
      dayName: 'Thursday',
      contentType: 'Tips & Tutorial',
      title: `Practical tips for ${contentFocus}`,
      description: `Actionable how-to content that delivers on ${theme}`,
      topic: contentFocus,
      introObjective: `Promise the takeaway upfront (e.g. "Here are 3 steps to...") — then deliver clearly.`,
      objective: `Increase saves and shares; position as the go-to resource for ${theme}.`,
      keyPoints: [
        `3–5 concrete, actionable steps`,
        `Common mistakes to avoid`,
        `One quick win they can try today`,
        `How this ties to ${theme}`
      ],
      cta: 'Save this for later',
      themeLinkage: `Day 4 — delivers practical value; advances ${contentFocus} and ${theme}.`,
      formatNotes: 'Carousel or list post; video for tutorials',
      platforms: platformMapping['Tips & Tutorial'],
      tone: 'helpful',
      keywords: []
    },
    {
      day: 5,
      dayName: 'Friday',
      contentType: 'Industry News',
      title: `Weekly Update on ${theme}`,
      description: `Share latest industry news and insights about ${theme}`,
      topic: theme,
      introObjective: `Lead with the headline or trend (e.g. "New data shows...") — then tie it to why it matters for ${contentFocus}.`,
      objective: `Position as informed thought leader on ${theme}; spark discussion on trends.`,
      keyPoints: [
        `One key trend or development`,
        `Your perspective and how it relates to ${theme}`,
        `Implications for ${targetAudience || 'your audience'}`,
        `Link to ${contentFocus}`
      ],
      cta: "What's your take?",
      themeLinkage: `Day 5 — connects ${theme} to broader context; advances ${contentFocus}.`,
      formatNotes: 'News-style post with commentary',
      platforms: platformMapping['Industry News'],
      tone: 'informative',
      keywords: []
    },
    {
      day: 6,
      dayName: 'Saturday',
      contentType: 'Behind the Scenes',
      title: `Our approach to ${theme}`,
      description: `Show behind-the-scenes content about your ${theme} strategy`,
      topic: theme,
      introObjective: `Invite the audience in (e.g. "Here's how we actually...") — show the process, not just the outcome.`,
      objective: `Build connection; humanize the brand; reinforce ${contentFocus} with authenticity.`,
      keyPoints: [
        `What you're working on (tied to ${theme})`, `How you approach it`,
        `One lesson or insight for the reader`,
        `Preview or teaser for next week`],
      cta: 'Follow for more behind-the-scenes',
      themeLinkage: `Day 6 — adds personal angle; keeps ${theme} and ${contentFocus} real.`,
      formatNotes: 'Stories, short video, or photo carousel',
      platforms: platformMapping['Behind the Scenes'],
      tone: 'personal',
      keywords: []
    },
    {
      day: 7,
      dayName: 'Sunday',
      contentType: 'Reflection',
      title: `Week Recap: ${theme}`,
      description: `Reflect on the week's content and key takeaways`,
      topic: theme,
      introObjective: `Summarize the week in one sentence (e.g. "This week we covered...") — then highlight what mattered most.`,
      objective: `Reinforce key messages; close the loop on ${contentFocus}; set up next week.`,
      keyPoints: [
        `3 key takeaways from the week`,
        `What resonated most (invite reflection)`,
        `One call-back to Day 1`,
        `Preview: what's coming next week`
      ],
      cta: 'What was your biggest takeaway?',
      themeLinkage: `Day 7 — closes loop; ties all content back to ${theme} and ${contentFocus}.`,
      formatNotes: 'Reflection post or short video',
      platforms: platformMapping['Reflection'],
      tone: 'reflective',
      keywords: []
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
