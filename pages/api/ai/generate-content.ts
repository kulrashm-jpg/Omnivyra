import { NextApiRequest, NextApiResponse } from 'next';
import { refineLanguageOutput } from '@/backend/services/languageRefinementService';

async function refineFields(obj: unknown): Promise<unknown> {
  if (obj == null) return obj;
  if (typeof obj === 'number' || typeof obj === 'boolean') return obj;

  if (typeof obj === 'string') {
    if (!obj.trim()) return obj;
    const r = await refineLanguageOutput({ content: obj, card_type: 'general' });
    return (r.refined as string) || obj;
  }

  if (Array.isArray(obj)) {
    return Promise.all(obj.map((item) => refineFields(item)));
  }

  if (typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      out[key] = await refineFields(value);
    }
    return out;
  }

  return obj;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { type, context, provider = 'demo', campaignId } = req.body;

    if (!type || !context) {
      return res.status(400).json({ error: 'Type and context are required' });
    }
    
    let content;
    
    switch (type) {
      case 'content_pillars':
        content = await generateContentPillars(context, provider);
        break;
      case 'weekly_plan':
        content = await generateWeeklyPlan(context, provider);
        break;
      case 'daily_plan':
        content = await generateDailyPlan(context, provider);
        break;
      case 'platform_strategy':
        content = await generatePlatformStrategy(context, provider);
        break;
      case 'hashtag_strategy':
        content = await generateHashtagStrategy(context, provider);
        break;
      case 'content_optimization':
        content = await optimizeContent(context, provider);
        break;
      default:
        return res.status(400).json({ error: 'Invalid content type' });
    }

    const refinedContent = content != null ? await refineFields(content) : content;

    res.status(200).json({
      success: true,
      content: refinedContent,
      provider,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error in generate-content API:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

async function generateContentPillars(context: any, provider: string) {
  const { objective, targetAudience, keyPlatforms } = context;

  if (provider === 'demo') {
    // Demo AI - Simulated response for testing
    return {
      pillars: [
        {
          id: 'pillar-1',
          name: 'Music Showcases',
          description: 'Featured tracks, albums, and playlists to highlight the music catalog',
          percentage: 40,
          contentTypes: ['post', 'video', 'story', 'reel'],
          platforms: ['instagram', 'tiktok', 'youtube'],
          hashtagCategories: ['music', 'newmusic', 'indie'],
          visualStyle: {
            colors: ['#1DB954', '#191414', '#FFFFFF'],
            fonts: ['Montserrat', 'Helvetica'],
            templates: ['music-showcase', 'album-cover', 'track-highlight']
          }
        },
        {
          id: 'pillar-2',
          name: 'Behind-the-Scenes',
          description: 'Creative process, studio sessions, and artist life content',
          percentage: 25,
          contentTypes: ['story', 'video', 'post'],
          platforms: ['instagram', 'youtube'],
          hashtagCategories: ['behindthescenes', 'studio', 'creative'],
          visualStyle: {
            colors: ['#FF6B6B', '#4ECDC4', '#45B7D1'],
            fonts: ['Open Sans', 'Roboto'],
            templates: ['studio-tour', 'process-video', 'artist-life']
          }
        },
        {
          id: 'pillar-3',
          name: 'Fan Engagement',
          description: 'User-generated content, testimonials, and community features',
          percentage: 20,
          contentTypes: ['post', 'story', 'reel'],
          platforms: ['instagram', 'tiktok', 'facebook'],
          hashtagCategories: ['fancontent', 'testimonial', 'community'],
          visualStyle: {
            colors: ['#FFD93D', '#6BCF7F', '#4D96FF'],
            fonts: ['Poppins', 'Inter'],
            templates: ['fan-feature', 'testimonial-card', 'community-spotlight']
          }
        },
        {
          id: 'pillar-4',
          name: 'Educational',
          description: 'Music tips, industry insights, and tutorials',
          percentage: 10,
          contentTypes: ['post', 'video', 'article'],
          platforms: ['linkedin', 'youtube', 'instagram'],
          hashtagCategories: ['musictips', 'industry', 'tutorial'],
          visualStyle: {
            colors: ['#8B5CF6', '#06B6D4', '#10B981'],
            fonts: ['Source Sans Pro', 'Lato'],
            templates: ['tip-card', 'tutorial-video', 'insight-post']
          }
        },
        {
          id: 'pillar-5',
          name: 'Promotional',
          description: 'Links, calls-to-action, and conversion-focused content',
          percentage: 5,
          contentTypes: ['post', 'story'],
          platforms: ['instagram', 'facebook', 'twitter'],
          hashtagCategories: ['promotion', 'linkinbio', 'cta'],
          visualStyle: {
            colors: ['#EF4444', '#F59E0B', '#8B5CF6'],
            fonts: ['Bebas Neue', 'Impact'],
            templates: ['cta-banner', 'promo-card', 'link-post']
          }
        }
      ],
      totalPercentage: 100,
      recommendations: [
        'Focus on Music Showcases as your primary pillar (40%) to drive discovery',
        'Use Behind-the-Scenes content to build authentic connections',
        'Encourage Fan Engagement through UGC campaigns and features',
        'Balance promotional content to avoid appearing too sales-focused'
      ]
    };
  }

  // Real AI providers would be implemented here
  if (provider === 'gpt-4') {
    // OpenAI GPT-4 implementation
    return await generateWithGPT4('content_pillars', context);
  }

  if (provider === 'claude') {
    // Anthropic Claude implementation
    return await generateWithClaude('content_pillars', context);
  }

  return { error: 'Invalid provider' };
}

async function generateWeeklyPlan(context: any, provider: string) {
  const { weekNumber, campaignStrategy, previousWeeks } = context;

  if (provider === 'demo') {
    const phases = [
      { name: 'Foundation & Discovery', weeks: [1, 2, 3], description: 'Build initial awareness and establish brand presence' },
      { name: 'Growth & Momentum', weeks: [4, 5, 6], description: 'Expand reach through viral content and collaborations' },
      { name: 'Consolidation & Amplification', weeks: [7, 8, 9], description: 'Strengthen community and drive conversions' },
      { name: 'Sustain & Scale', weeks: [10, 11, 12], description: 'Maintain momentum and plan for future growth' }
    ];

    const currentPhase = phases.find(p => p.weeks.includes(weekNumber));
    
    const weeklyThemes = {
      1: { theme: 'Brand Introduction & Music Catalog Showcase', focus: 'Introduce the brand, showcase top tracks' },
      2: { theme: 'Artist Story & Music Journey', focus: 'Artist background, musical influences, creative process' },
      3: { theme: 'Fan Engagement Launch', focus: 'User-generated content, fan testimonials, playlist creation' },
      4: { theme: 'Viral Music Challenges', focus: 'Create shareable, trend-based content with music' },
      5: { theme: 'Collaborations & Features', focus: 'Collaborate with micro-influencers and music creators' },
      6: { theme: 'Live Sessions & Community Building', focus: 'Real-time engagement, Q&A sessions, live performances' },
      7: { theme: 'Exclusive Content Drops', focus: 'Release exclusive tracks, behind-the-scenes footage' },
      8: { theme: 'Fan Appreciation & Testimonials', focus: 'Showcase fan support, share testimonials, celebrate milestones' },
      9: { theme: 'Music Playlist Takeover', focus: 'Get featured on popular playlists, create themed playlists' },
      10: { theme: 'Community Spotlight Series', focus: 'Highlight superfans, share community stories' },
      11: { theme: 'Year-End Recap & Celebration', focus: 'Recap campaign success, share achievements, thank supporters' },
      12: { theme: 'Future Vision & Call-to-Action', focus: 'Tease upcoming projects, encourage newsletter signups, build anticipation' }
    };

    const weekData = weeklyThemes[weekNumber as keyof typeof weeklyThemes];

      return {
      phase: currentPhase?.name || 'Foundation',
      theme: weekData?.theme || `Week ${weekNumber} Theme`,
      focusArea: weekData?.focus || `Week ${weekNumber} Focus`,
      keyMessaging: `This week focuses on ${weekData?.focus?.toLowerCase() || 'strategic content planning'}. We'll engage our target audience through ${['authentic storytelling', 'community building', 'exclusive content', 'collaborative efforts'][weekNumber % 4]}.`,
      contentTypes: ['post', 'story', 'video', 'reel'],
      platformStrategy: [
        { platform: 'instagram', posts: 4, stories: 7, reels: 3 },
        { platform: 'tiktok', videos: 6 },
        { platform: 'youtube', videos: 2, shorts: 4 },
        { platform: 'twitter', tweets: 10, threads: 2 },
        { platform: 'facebook', posts: 3, stories: 4 }
      ],
      callToAction: weekNumber <= 3 ? 'Follow for more music discovery' : 
                   weekNumber <= 6 ? 'Join our community challenge' :
                   weekNumber <= 9 ? 'Share your story with us' : 'Stay tuned for what\'s next',
      targetMetrics: {
        impressions: Math.floor(5000 + (weekNumber * 500)),
        engagements: Math.floor(300 + (weekNumber * 30)),
        conversions: Math.floor(50 + (weekNumber * 5)),
        ugcSubmissions: Math.floor(25 + (weekNumber * 2))
      },
      contentGuidelines: `Focus on ${weekData?.focus?.toLowerCase() || 'strategic content'}. Maintain consistent brand voice and visual identity. Use platform-specific best practices for optimal engagement.`,
      hashtagSuggestions: [
        '#DrishiqMusic',
        '#NewMusic',
        '#IndieMusic',
        '#MusicDiscovery',
        '#BehindTheScenes',
        '#FanContent',
        '#MusicCommunity'
      ]
    };
  }

  // Real AI providers would be implemented here
  if (provider === 'gpt-4') {
    return await generateWithGPT4('weekly_plan', context);
  }

  if (provider === 'claude') {
    return await generateWithClaude('weekly_plan', context);
  }

  return { error: 'Invalid provider' };
}

async function generateDailyPlan(context: any, provider: string) {
  const { weekNumber, dayOfWeek, weeklyPlan, campaignStrategy } = context;

  if (provider === 'demo') {
    const dayContent = {
      Monday: { platform: 'instagram', type: 'post', focus: 'Motivational Monday music' },
      Tuesday: { platform: 'tiktok', type: 'video', focus: 'Trending Tuesday content' },
      Wednesday: { platform: 'instagram', type: 'story', focus: 'Behind-the-scenes Wednesday' },
      Thursday: { platform: 'twitter', type: 'thread', focus: 'Thoughtful Thursday insights' },
      Friday: { platform: 'youtube', type: 'video', focus: 'Feature Friday spotlight' },
      Saturday: { platform: 'instagram', type: 'reel', focus: 'Weekend vibes content' },
      Sunday: { platform: 'facebook', type: 'post', focus: 'Sunday reflection and community' }
    };

    const dayData = dayContent[dayOfWeek as keyof typeof dayContent];

    return {
      platform: dayData?.platform || 'instagram',
      contentType: dayData?.type || 'post',
      title: `${dayOfWeek} ${weeklyPlan?.theme || 'Content'}`,
      content: `Today we're focusing on ${dayData?.focus || 'engaging content'}. ${weeklyPlan?.keyMessaging || 'Join us for another day of music discovery and community building.'}`,
      description: `A ${dayData?.type || 'post'} for ${dayOfWeek} focusing on ${dayData?.focus || 'community engagement'}`,
      mediaRequirements: {
        type: dayData?.type === 'video' ? 'video' : 'image',
        dimensions: dayData?.platform === 'instagram' ? '1080x1080' : 
                   dayData?.platform === 'tiktok' ? '1080x1920' : '1920x1080',
        aspectRatio: dayData?.platform === 'tiktok' ? '9:16' : '1:1'
      },
      hashtags: [
        '#DrishiqMusic',
        `#${dayOfWeek}`,
        '#MusicDiscovery',
        '#Community',
        '#NewMusic'
      ],
      callToAction: weeklyPlan?.callToAction || 'Follow for more music content',
      optimalTime: dayData?.platform === 'instagram' ? '09:00' : 
                   dayData?.platform === 'tiktok' ? '18:00' : '12:00',
      targetMetrics: {
        impressions: Math.floor(1000 + (weekNumber * 100)),
        engagements: Math.floor(50 + (weekNumber * 5)),
        clicks: Math.floor(10 + weekNumber)
      }
    };
  }

  // Real AI providers would be implemented here
  if (provider === 'gpt-4') {
    return await generateWithGPT4('daily_plan', context);
  }

  if (provider === 'claude') {
    return await generateWithClaude('daily_plan', context);
  }

  return { error: 'Invalid provider' };
}

async function generatePlatformStrategy(context: any, provider: string) {
  if (provider === 'demo') {
    return {
    instagram: {
        contentFrequency: { posts: 4, stories: 7, reels: 3 },
        optimalPostingTimes: {
          Monday: ['09:00', '18:00'],
          Tuesday: ['09:00', '18:00'],
          Wednesday: ['09:00', '18:00'],
          Thursday: ['09:00', '18:00'],
          Friday: ['09:00', '18:00'],
          Saturday: ['10:00', '19:00'],
          Sunday: ['10:00', '19:00']
        },
        contentTypes: ['post', 'story', 'reel', 'igtv'],
        characterLimits: { posts: 2200, stories: 100 },
        targetMetrics: { impressions: 15000, engagements: 1000, followers: 500 }
      },
      tiktok: {
        contentFrequency: { videos: 6 },
        optimalPostingTimes: {
          Monday: ['18:00', '21:00'],
          Tuesday: ['18:00', '21:00'],
          Wednesday: ['18:00', '21:00'],
          Thursday: ['18:00', '21:00'],
          Friday: ['18:00', '21:00'],
          Saturday: ['19:00', '22:00'],
          Sunday: ['19:00', '22:00']
        },
        contentTypes: ['video', 'live'],
        characterLimits: { videos: 300 },
        targetMetrics: { impressions: 25000, engagements: 2000, followers: 800 }
    },
    youtube: {
        contentFrequency: { videos: 2, shorts: 4 },
        optimalPostingTimes: {
          Monday: ['14:00'],
          Tuesday: ['14:00'],
          Wednesday: ['14:00'],
          Thursday: ['14:00'],
          Friday: ['14:00'],
          Saturday: ['15:00'],
          Sunday: ['15:00']
        },
        contentTypes: ['video', 'short', 'live'],
        characterLimits: { videos: 5000 },
        targetMetrics: { impressions: 10000, engagements: 500, followers: 200 }
      }
    };
  }

  return { error: 'Invalid provider' };
}

async function generateHashtagStrategy(context: any, provider: string) {
  if (provider === 'demo') {
    return {
      branded: ['#DrishiqMusic', '#DrishiqVibes', '#DrishiqCommunity'],
      industry: ['#IndieMusic', '#NewMusic', '#MusicDiscovery', '#EmergingArtist'],
      trending: ['#MusicTok', '#NewMusicFriday', '#IndieMusic', '#MusicLovers'],
      platformSpecific: {
        instagram: ['#Music', '#NewMusic', '#Indie', '#MusicDiscovery'],
        tiktok: ['#MusicTok', '#NewMusic', '#IndieMusic', '#MusicLovers'],
        youtube: ['#NewMusic', '#IndieMusic', '#MusicReview', '#MusicDiscovery']
      }
    };
  }

  return { error: 'Invalid provider' };
}

async function optimizeContent(context: any, provider: string) {
  if (provider === 'demo') {
  return {
      optimizedContent: context.content + ' [AI Enhanced]',
      suggestions: [
        'Add more emotional connection to the content',
        'Include a clear call-to-action',
        'Use more engaging visual elements',
        'Consider adding user-generated content elements'
      ],
      hashtagSuggestions: ['#Music', '#NewMusic', '#Community'],
      postingTimeRecommendation: '09:00 AM',
      engagementPrediction: 'High'
    };
  }

  return { error: 'Invalid provider' };
}

// Placeholder functions for real AI providers
async function generateWithGPT4(type: string, context: any) {
  // Implementation for OpenAI GPT-4
  return { error: 'GPT-4 implementation coming soon' };
}

async function generateWithClaude(type: string, context: any) {
  // Implementation for Anthropic Claude
  return { error: 'Claude implementation coming soon' };
}