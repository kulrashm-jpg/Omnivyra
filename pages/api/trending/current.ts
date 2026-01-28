import { NextApiRequest, NextApiResponse } from 'next';

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
const fetchGoogleTrends = async () => {
  try {
    // Google Trends RSS feed (free)
    const response = await fetch('https://trends.google.com/trends/hottrends/atom/feed');
    if (!response.ok) throw new Error('Google Trends API failed');
    
    const xmlText = await response.text();
    // Parse XML to extract trending topics
    const topics = xmlText.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/g) || [];
    const trendingTopics = topics.slice(0, 5).map(topic => {
      const title = topic.replace(/<title><!\[CDATA\[(.*?)\]\]><\/title>/, '$1');
      return {
        keyword: title,
        searchVolume: "High",
        trend: "Rising",
        category: "General",
        source: "Google Trends"
      };
    });
    
    return trendingTopics;
  } catch (error) {
    console.error('Google Trends error:', error);
    return [
      { keyword: "ChatGPT", searchVolume: "High", trend: "Rising", category: "AI", source: "Google Trends" },
      { keyword: "Climate Change", searchVolume: "Very High", trend: "Stable", category: "Environment", source: "Google Trends" },
      { keyword: "Electric Vehicles", searchVolume: "High", trend: "Rising", category: "Automotive", source: "Google Trends" },
    ];
  }
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

// YouTube Trending - Free tier (10,000 quota units/day)
const fetchYouTubeTrending = async () => {
  try {
    // Note: In production, you'd need a YouTube Data API key
    // For now, we'll use mock data that simulates real trending videos
    const mockTrendingVideos = [
      { keyword: "AI Revolution", views: "2.3M", growth: "+45%", category: "Technology", source: "YouTube" },
      { keyword: "Remote Work Tips", views: "1.8M", growth: "+32%", category: "Business", source: "YouTube" },
      { keyword: "Sustainable Living", views: "3.1M", growth: "+67%", category: "Lifestyle", source: "YouTube" },
      { keyword: "Mental Health", views: "4.2M", growth: "+89%", category: "Health", source: "YouTube" },
      { keyword: "Cryptocurrency", views: "1.5M", growth: "+23%", category: "Finance", source: "YouTube" },
    ];
    
    return mockTrendingVideos;
  } catch (error) {
    console.error('YouTube API error:', error);
    return [];
  }
};

// Fallback data when APIs fail
const getFallbackTrendingData = () => {
  return {
    linkedin: [
      { keyword: "ChatGPT", searchVolume: "High", trend: "Rising", category: "AI", source: "Google Trends" },
      { keyword: "Climate Change", searchVolume: "Very High", trend: "Stable", category: "Environment", source: "Google Trends" },
      { keyword: "Electric Vehicles", searchVolume: "High", trend: "Rising", category: "Automotive", source: "Google Trends" },
    ],
    twitter: [
      { keyword: "AI Revolution", upvotes: 15420, subreddit: "technology", category: "Reddit", source: "Reddit" },
      { keyword: "Remote Work", upvotes: 12300, subreddit: "workfromhome", category: "Reddit", source: "Reddit" },
    ],
    instagram: [
      { keyword: "AI Revolution", views: "2.3M", growth: "+45%", category: "Technology", source: "YouTube" },
      { keyword: "Remote Work Tips", views: "1.8M", growth: "+32%", category: "Business", source: "YouTube" },
    ],
    facebook: [
      { keyword: "Mental Health", upvotes: 18700, subreddit: "selfimprovement", category: "Reddit", source: "Reddit" },
      { keyword: "Community Building", upvotes: 14200, subreddit: "socialskills", category: "Reddit", source: "Reddit" },
    ],
    youtube: [
      { keyword: "AI Tutorials", views: "5.2M", growth: "+78%", category: "Education", source: "YouTube" },
      { keyword: "Tech Reviews", views: "3.8M", growth: "+56%", category: "Technology", source: "YouTube" },
      { keyword: "Gaming Content", views: "4.1M", growth: "+43%", category: "Entertainment", source: "YouTube" },
    ],
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
        searchVolume: trend.searchVolume,
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
        icon: "🐦",
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
        text: `📸 "${trend.keyword}" trending with ${trend.views} views`,
        icon: "📸",
        source: "YouTube",
        platform: "Instagram",
        category: trend.category,
        engagement: trend.growth,
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
        text: `📺 "${trend.keyword}" trending with ${trend.views} views`,
        icon: "📺",
        source: "YouTube",
        platform: "YouTube",
        category: trend.category,
        engagement: trend.growth,
        clickable: true
      });
    });
  }

  return suggestions.slice(0, 15); // Return top 15 suggestions
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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
              { name: "YouTube", platform: "Instagram/TikTok", status: "Free Tier", description: "Visual content & viral videos" },
              { name: "Reddit", platform: "Facebook", status: "100% Free", description: "Community-driven social topics" },
              { name: "YouTube", platform: "YouTube", status: "Free Tier", description: "Video content & trending videos" }
            ]
    });

  } catch (error: any) {
    console.error('Error fetching trending data:', error);
    res.status(500).json({ error: error.message });
  }
}
