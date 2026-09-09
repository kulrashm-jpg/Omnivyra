import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
// D4 - the source-boundary contract for the one Google Trends feed this route reads.
import {
  fetchHotTrendsFeed,
  googleTrendsTopic,
  googleTrendsUnavailable,
  parseHotTrendsFeed,
} from '../../../backend/services/trends/googleTrendsContract';
// D5 - the source-boundary contract for the YouTube trending signal this route
// has no sanctioned way to acquire.
import {
  youTubeTrendingUnavailable,
  youTubeTrendsAcquisition,
} from '../../../backend/services/trends/youtubeTrendsContract';
import type { YouTubeTrendingObservation } from '../../../backend/services/trends/youtubeTrendsContract';

// One Specialized Source Per Platform Type for Best Results
const getTrendingData = async () => {
  try {
    // 1. Google Trends → LinkedIn (Professional & Business Topics)
    const linkedinTrends = await fetchGoogleTrends();
    
    // 2. Reddit → Twitter (Real-time Discussions & Viral Topics)
    const twitterTrends = await fetchRedditTrending();
    
    // 3. YouTube → Instagram/TikTok (Visual Content & Viral Videos)
    const instagramTrends = await fetchYouTubeTrending();
    
    // 4. Reddit → Facebook (Community-driven Social Topics)
    const facebookTrends = await fetchRedditTrending();
    
    // 5. YouTube → YouTube (Video Content & Trending Videos)
    const youtubeTrends = await fetchYouTubeTrending();

    return {
      linkedin: linkedinTrends,
      twitter: twitterTrends,
      instagram: instagramTrends,
      facebook: facebookTrends,
      youtube: youtubeTrends,
      lastUpdated: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error fetching trending data:', error);
    // Return fallback data if APIs fail
    return getFallbackTrendingData();
  }
};

// Google Trends - Free, no API key needed
//
// D4 — this used to return `searchVolume: "High"`, `trend: "Rising"` and
// `category: "General"` for every topic. Only `keyword` came from the feed; the
// other three were hardcoded literals stamped with a real provider's name, and
// the UI rendered "High search volume" from them. The failure path was worse
// still: three invented topics attributed to Google Trends.
//
// The feed establishes one thing — that a term is on Google's currently-trending
// list. That is what is returned now, through the contract that says so.
const fetchGoogleTrends = async () => {
  const xmlText = await fetchHotTrendsFeed();
  if (xmlText === null) {
    console.error('Google Trends error: hot-trends feed could not be read');
    // Honest silence. Manufacturing topics under a provider's name is a larger
    // falsehood than a mislabelled measurement, and the consumer already renders
    // nothing for an empty list.
    return googleTrendsUnavailable();
  }
  return parseHotTrendsFeed(xmlText).slice(0, 5).map(googleTrendsTopic);
};


// Reddit Trending - Free, no auth needed
const fetchRedditTrending = async () => {
  try {
    // Reddit's trending subreddits (free)
    const response = await fetch('https://www.reddit.com/r/popular.json?limit=5');
    if (!response.ok) throw new Error('Reddit API failed');
    
    const data = await response.json();
    const trendingPosts = data.data.children.slice(0, 5).map(post => ({
      keyword: post.data.title,
      upvotes: post.data.ups,
      subreddit: post.data.subreddit,
      category: "Reddit",
      source: "Reddit"
    }));
    
    return trendingPosts;
  } catch (error) {
    console.error('Reddit API error:', error);
    return [
      { keyword: "AI Revolution", upvotes: 15420, subreddit: "technology", category: "Reddit", source: "Reddit" },
      { keyword: "Remote Work", upvotes: 12300, subreddit: "workfromhome", category: "Reddit", source: "Reddit" },
    ];
  }
};

// GitHub Trending - Free, no auth needed
const fetchGitHubTrending = async () => {
  try {
    // GitHub trending repositories (free)
    const response = await fetch('https://api.github.com/search/repositories?q=created:>2024-01-01&sort=stars&order=desc&per_page=5');
    if (!response.ok) throw new Error('GitHub API failed');
    
    const data = await response.json();
    const trendingRepos = data.items.map(repo => ({
      keyword: repo.name,
      stars: repo.stargazers_count,
      language: repo.language,
      category: "Development",
      source: "GitHub"
    }));
    
    return trendingRepos;
  } catch (error) {
    console.error('GitHub API error:', error);
    return [
      { keyword: "AI Framework", stars: 15420, language: "Python", category: "Development", source: "GitHub" },
      { keyword: "Web3 Tool", stars: 12300, language: "JavaScript", category: "Development", source: "GitHub" },
    ];
  }
};

// YouTube Trending
//
// D5 — this used to return five hardcoded videos with invented `views`
// ("2.3M"…"4.2M") and invented `growth` ("+45%"…"+89%"), every one stamped
// `source: "YouTube"`. The `try` block held nothing but that literal array, so
// no request was ever made and the `catch` under it was unreachable. Its own
// comment admitted the rows were mock data; nothing downstream did.
//
// The architecture was audited before anything was written here: the YouTube
// adapters are per-account OAuth publishers, the "YouTube Trends" entry in
// externalApiPresets is a super-admin preset for the external-API executor and
// not a provider this route may call, and YOUTUBE_API_KEY is registered neither
// in config/env.schema.ts nor in PROVIDER_CREDENTIALS. There is no sanctioned
// path, so nothing is claimed — see youtubeTrendsContract for the full record.
const fetchYouTubeTrending = async (): Promise<YouTubeTrendingObservation[]> => {
  const acquisition = youTubeTrendsAcquisition();
  if (!acquisition.available) {
    console.error('YouTube trending error:', acquisition.reason);
    // Honest silence. Manufacturing videos, view counts and growth rates under a
    // provider's name is a larger falsehood than a mislabelled measurement, and
    // the consumer already renders nothing for an empty list.
    return youTubeTrendingUnavailable();
  }
  // Reachable only once the contract declares supported evidence, which requires
  // a credential, a registered provider and a real endpoint. Writing an
  // acquisition body before those exist is exactly how the mock array was born.
  return youTubeTrendingUnavailable();
};

// Fallback data when APIs fail
const getFallbackTrendingData = () => {
  return {
    // D4 - these three topics were invented and attributed to Google Trends.
    // Nothing was ever observed here, so nothing is claimed.
    linkedin: googleTrendsUnavailable(),
    twitter: [
      { keyword: "AI Revolution", upvotes: 15420, subreddit: "technology", category: "Reddit", source: "Reddit" },
      { keyword: "Remote Work", upvotes: 12300, subreddit: "workfromhome", category: "Reddit", source: "Reddit" },
    ],
    // D5 - two invented videos with invented view counts and growth rates,
    // attributed to YouTube. Nothing was ever observed here, so nothing is claimed.
    instagram: youTubeTrendingUnavailable(),
    facebook: [
      { keyword: "Mental Health", upvotes: 18700, subreddit: "selfimprovement", category: "Reddit", source: "Reddit" },
      { keyword: "Community Building", upvotes: 14200, subreddit: "socialskills", category: "Reddit", source: "Reddit" },
    ],
    // D5 - three more invented videos under the same provider name.
    youtube: youTubeTrendingUnavailable(),
    lastUpdated: new Date().toISOString()
  };
};

// Generate AI suggestions based on trending data and connected platforms
const generateAISuggestions = (trendingData, connectedPlatforms = ['linkedin', 'twitter', 'instagram', 'facebook', 'youtube']) => {
  const suggestions = [];
  
  // LinkedIn suggestions (Google Trends) - only if LinkedIn is connected
  if (connectedPlatforms.includes('linkedin')) {
    trendingData.linkedin?.forEach(trend => {
      suggestions.push({
        type: "linkedin_trend",
        text: `🔍 "${trend.keyword}" trending for professionals`,
        icon: "💼",
        source: "Google Trends",
        platform: "LinkedIn",
        category: trend.category,
        // D4 - was `searchVolume: trend.searchVolume`, which carried the hardcoded
        // "High" into the suggestion. The feed supports the trending signal only.
        trend: trend.trend,
        searchVolumeState: trend.search_volume_state,
        clickable: true
      });
    });
  }

  // Twitter suggestions (Reddit) - only if Twitter is connected
  if (connectedPlatforms.includes('twitter')) {
    trendingData.twitter?.forEach(trend => {
      suggestions.push({
        type: "twitter_trend",
        text: `🔥 "${trend.keyword}" viral on r/${trend.subreddit}`,
        icon: "𝕏",
        source: "Reddit",
        platform: "Twitter",
        category: "Community",
        upvotes: trend.upvotes,
        clickable: true
      });
    });
  }

  // Instagram suggestions (YouTube) - only if Instagram is connected
  if (connectedPlatforms.includes('instagram')) {
    trendingData.instagram?.forEach(trend => {
      suggestions.push({
        type: "instagram_trend",
        // D5 - was `trending with ${trend.views} views`, which carried an invented
        // view count into the suggestion text. Membership of a trending list is
        // the only thing such a row could ever establish.
        text: `📸 "${trend.keyword}" trending on YouTube`,
        icon: "📸",
        source: "YouTube",
        platform: "Instagram",
        category: trend.category,
        // D5 - was `engagement: trend.growth`, an invented "+45%". No YouTube
        // surface publishes a growth rate, so only the state travels.
        viewsState: trend.views_state,
        growthState: trend.growth_state,
        clickable: true
      });
    });
  }

  // Facebook suggestions (Reddit) - only if Facebook is connected
  if (connectedPlatforms.includes('facebook')) {
    trendingData.facebook?.forEach(trend => {
      suggestions.push({
        type: "facebook_trend",
        text: `👥 "${trend.keyword}" popular in communities`,
        icon: "👥",
        source: "Reddit",
        platform: "Facebook",
        category: "Social",
        upvotes: trend.upvotes,
        clickable: true
      });
    });
  }

  // YouTube suggestions (YouTube) - only if YouTube is connected
  if (connectedPlatforms.includes('youtube')) {
    trendingData.youtube?.forEach(trend => {
      suggestions.push({
        type: "youtube_trend",
        // D5 - same invented view count, same removal.
        text: `📺 "${trend.keyword}" trending on YouTube`,
        icon: "📺",
        source: "YouTube",
        platform: "YouTube",
        category: trend.category,
        viewsState: trend.views_state,
        growthState: trend.growth_state,
        clickable: true
      });
    });
  }

  return suggestions.slice(0, 15); // Return top 15 suggestions
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
          // Get connected accounts to personalize suggestions
          const { platforms } = req.query;
          const connectedPlatforms = platforms ? platforms.toString().split(',') : ['linkedin', 'twitter', 'instagram', 'facebook', 'youtube'];

    const trendingData = await getTrendingData();
    const aiSuggestions = generateAISuggestions(trendingData, connectedPlatforms);

    res.status(200).json({
      trending: trendingData,
      suggestions: aiSuggestions,
      connectedPlatforms: connectedPlatforms,
      timestamp: new Date().toISOString(),
            sources: [
              { name: "Google Trends", platform: "LinkedIn", status: "100% Free", description: "Professional & business trends" },
              { name: "Reddit", platform: "Twitter", status: "100% Free", description: "Real-time discussions & viral topics" },
              // D5 - "Free Tier" advertised a live YouTube integration to the
              // customer. There is none: no credential, no registered provider,
              // no endpoint. The status now says so.
              { name: "YouTube", platform: "Instagram/TikTok", status: "Unavailable", description: "No sanctioned YouTube trending source is configured" },
              { name: "Reddit", platform: "Facebook", status: "100% Free", description: "Community-driven social topics" },
              { name: "YouTube", platform: "YouTube", status: "Unavailable", description: "No sanctioned YouTube trending source is configured" }
            ]
    });

  } catch (error: any) {
    console.error('Error fetching trending data:', error);
    res.status(500).json({ error: error.message });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/trending/current' });
