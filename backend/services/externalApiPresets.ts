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
};

export const externalApiPresets: ExternalApiPreset[] = [
  {
    name: 'YouTube Trends',
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
    name: 'NewsAPI Headlines',
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
    name: 'SerpAPI Google Trends',
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
    name: 'Reddit Search',
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
];
