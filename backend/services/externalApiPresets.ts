export type ExternalApiPreset = {
  name: string;
  description: string;
  base_url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  query_params: Record<string, string | number>;
  auth_type: 'none' | 'api_key' | 'bearer' | 'query' | 'header' | 'oauth';
  api_key_env_name?: string | null;
  example_response_type: 'json';
  is_preset: true;
  /** Groups presets in the UI: 'trend' = trend/news discovery, 'community' = community signal sources */
  section?: 'trend' | 'community';
};

export const externalApiPresets: ExternalApiPreset[] = [
  {
    name: 'YouTube Trends',
    section: 'trend',
    description: 'YouTube Data API search for trending videos.',
    base_url: 'https://www.googleapis.com/youtube/v3/search',
    method: 'GET',
    auth_type: 'query',
    api_key_env_name: 'YOUTUBE_API_KEY',
    headers: {
      Accept: 'application/json',
    },
    query_params: {
      part: 'snippet',
      type: 'video',
      order: 'viewCount',
      maxResults: 10,
      q: '{{category}}',
      regionCode: '{{geo}}',
      key: '{{YOUTUBE_API_KEY}}',
    },
    example_response_type: 'json',
    is_preset: true,
  },
  {
    name: 'YouTube Shorts Trends',
    section: 'trend',
    description: 'YouTube Data API search for trending Shorts.',
    base_url: 'https://www.googleapis.com/youtube/v3/search',
    method: 'GET',
    auth_type: 'query',
    api_key_env_name: 'YOUTUBE_API_KEY',
    headers: {
      Accept: 'application/json',
    },
    query_params: {
      part: 'snippet',
      type: 'video',
      videoDuration: 'short',
      order: 'viewCount',
      maxResults: 10,
      q: '{{category}}',
      regionCode: '{{geo}}',
      key: '{{YOUTUBE_API_KEY}}',
    },
    example_response_type: 'json',
    is_preset: true,
  },
  {
    name: 'NewsAPI Headlines',
    section: 'trend',
    description: 'NewsAPI top headlines for breaking topics.',
    base_url: 'https://newsapi.org/v2/top-headlines',
    method: 'GET',
    auth_type: 'query',
    api_key_env_name: 'NEWS_API_KEY',
    headers: {
      Accept: 'application/json',
    },
    query_params: {
      q: '{{category}}',
      country: '{{geo}}',
      pageSize: 10,
      apiKey: '{{NEWS_API_KEY}}',
    },
    example_response_type: 'json',
    is_preset: true,
  },
  {
    name: 'NewsAPI Everything',
    section: 'trend',
    description: 'NewsAPI full-text search for broader trend coverage.',
    base_url: 'https://newsapi.org/v2/everything',
    method: 'GET',
    auth_type: 'query',
    api_key_env_name: 'NEWS_API_KEY',
    headers: {
      Accept: 'application/json',
    },
    query_params: {
      q: '{{category}}',
      language: 'en',
      pageSize: 10,
      sortBy: 'publishedAt',
      apiKey: '{{NEWS_API_KEY}}',
    },
    example_response_type: 'json',
    is_preset: true,
  },
  {
    name: 'SerpAPI Google Trends',
    section: 'trend',
    description: 'SerpAPI Google Trends engine results.',
    base_url: 'https://serpapi.com/search',
    method: 'GET',
    auth_type: 'query',
    api_key_env_name: 'SERPAPI_KEY',
    headers: {
      Accept: 'application/json',
    },
    query_params: {
      engine: 'google_trends',
      q: '{{category}}',
      geo: '{{geo}}',
      api_key: '{{SERPAPI_KEY}}',
    },
    example_response_type: 'json',
    is_preset: true,
  },
  {
    name: 'SerpAPI Google News',
    section: 'trend',
    description: 'SerpAPI Google News engine results.',
    base_url: 'https://serpapi.com/search',
    method: 'GET',
    auth_type: 'query',
    api_key_env_name: 'SERPAPI_KEY',
    headers: {
      Accept: 'application/json',
    },
    query_params: {
      engine: 'google_news',
      q: '{{category}}',
      gl: '{{geo}}',
      hl: 'en',
      api_key: '{{SERPAPI_KEY}}',
    },
    example_response_type: 'json',
    is_preset: true,
  },
  {
    name: 'Reddit Search',
    section: 'community',
    description: 'Reddit API search across subreddits.',
    base_url: 'https://oauth.reddit.com/search',
    method: 'GET',
    auth_type: 'bearer',
    api_key_env_name: 'REDDIT_BEARER_TOKEN',
    headers: {
      Accept: 'application/json',
      'User-Agent': 'ViralityApp/1.0',
    },
    query_params: {
      q: '{{category}}',
      sort: 'hot',
      limit: 10,
    },
    example_response_type: 'json',
    is_preset: true,
  },
  {
    name: 'X (Twitter) Recent Search',
    section: 'community',
    description: 'X API v2 recent search results.',
    base_url: 'https://api.twitter.com/2/tweets/search/recent',
    method: 'GET',
    auth_type: 'bearer',
    api_key_env_name: 'TWITTER_BEARER_TOKEN',
    headers: {
      Accept: 'application/json',
    },
    query_params: {
      query: '{{category}}',
      max_results: 10,
      'tweet.fields': 'public_metrics,created_at,lang',
      sort_order: 'relevancy',
    },
    example_response_type: 'json',
    is_preset: true,
  },
  {
    name: 'GDELT Events',
    section: 'trend',
    description: 'GDELT 2.1 events feed for global trend signals.',
    base_url: 'https://api.gdeltproject.org/api/v2/events/search',
    method: 'GET',
    auth_type: 'none',
    headers: {
      Accept: 'application/json',
    },
    query_params: {
      query: '{{category}}',
      mode: 'ArtList',
      maxrecords: 10,
      format: 'json',
    },
    example_response_type: 'json',
    is_preset: true,
  },
  {
    name: 'Hacker News Trends',
    section: 'community',
    description: 'Algolia Hacker News search for trending topics.',
    base_url: 'https://hn.algolia.com/api/v1/search',
    method: 'GET',
    auth_type: 'none',
    headers: {
      Accept: 'application/json',
    },
    query_params: {
      query: '{{category}}',
      tags: 'story',
      hitsPerPage: 10,
    },
    example_response_type: 'json',
    is_preset: true,
  },
  {
    name: 'Stack Overflow Trends',
    section: 'community',
    description: 'Stack Exchange search for trending developer topics.',
    base_url: 'https://api.stackexchange.com/2.3/search/advanced',
    method: 'GET',
    auth_type: 'none',
    headers: {
      Accept: 'application/json',
    },
    query_params: {
      order: 'desc',
      sort: 'relevance',
      q: '{{category}}',
      site: 'stackoverflow',
      pagesize: 10,
    },
    example_response_type: 'json',
    is_preset: true,
  },
  {
    name: 'Google Trends (PyTrends Bridge)',
    section: 'trend',
    description: 'Use a proxy service to expose Google Trends data.',
    base_url: 'https://trends-proxy.yourdomain.com/trends',
    method: 'GET',
    auth_type: 'none',
    headers: {
      Accept: 'application/json',
    },
    query_params: {
      q: '{{category}}',
      geo: '{{geo}}',
      timeframe: 'now 7-d',
    },
    example_response_type: 'json',
    is_preset: true,
  },
];
