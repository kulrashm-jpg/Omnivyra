/**
 * Shared types and constants for SuperAdminPanel.
 */

export interface DeletionAudit {
  id: string;
  user_id: string;
  user_name: string;
  user_role: string;
  action: string;
  table_name: string;
  record_id: string;
  reason: string;
  ip_address: string;
  created_at: string;
}

export interface CompanyData {
  id: string;
  name: string;
  website: string;
  industry?: string | null;
  status: string;
  created_at: string;
}

export interface AppUserData {
  user_id: string;
  email: string;
  company_id: string;
  company_name: string;
  role: string;
  status?: string | null;
  created_at: string;
}

export type RbacPermissions = Record<string, string[]>;

export interface PlatformAnalyticsRow {
  platform: string;
  total_posts: number;
  total_engagement: number;
  total_reach: number;
  avg_engagement_rate: number;
}

export interface AnalyticsSummary {
  total_posts: number;
  total_engagement: number;
  total_reach: number;
  avg_engagement_rate: number;
  platforms: PlatformAnalyticsRow[];
}

export interface CampaignHealthCompanyRow {
  company_id: string;
  total_campaigns: number;
  active_campaigns: number;
  reapproval_required: number;
}

export interface CampaignHealthSummary {
  total_campaigns: number;
  active_campaigns: number;
  approved_strategies: number;
  proposed_strategies: number;
  reapproval_required_count: number;
  campaigns_by_company: CampaignHealthCompanyRow[];
}

export interface CommunityAiMetrics {
  total_actions: number;
  total_actions_executed: number;
  playbooks_count: number;
  auto_rules_count: number;
  actions_by_tenant: Array<{ tenant_id: string; total_actions: number }>;
}

export interface CommunityAiPolicy {
  execution_enabled: boolean;
  auto_rules_enabled: boolean;
  require_human_approval: boolean;
  updated_at: string | null;
  updated_by: string | null;
}

export const roleOptions = [
  { id: 'COMPANY_ADMIN', name: 'Company Admin' },
  { id: 'CONTENT_CREATOR', name: 'Content Creator' },
  { id: 'CONTENT_REVIEWER', name: 'Content Reviewer' },
  { id: 'CONTENT_PUBLISHER', name: 'Content Publisher' },
  { id: 'VIEW_ONLY', name: 'View Only' },
];

export type OAuthPlatformEntry = {
  platform_key: string;
  platform_label: string;
  configured: boolean;
  enabled: boolean;
  client_id_preview: string;
  has_client_secret: boolean;
  updated_at: null;
};

export const OAUTH_PLATFORMS: OAuthPlatformEntry[] = [
  { platform_key: 'linkedin',  platform_label: 'LinkedIn',           configured: false, enabled: false, client_id_preview: '', has_client_secret: false, updated_at: null },
  { platform_key: 'x',         platform_label: 'X',                  configured: false, enabled: false, client_id_preview: '', has_client_secret: false, updated_at: null },
  { platform_key: 'youtube',   platform_label: 'YouTube',            configured: false, enabled: false, client_id_preview: '', has_client_secret: false, updated_at: null },
  { platform_key: 'facebook',  platform_label: 'Meta (Facebook · Instagram · WhatsApp)', configured: false, enabled: false, client_id_preview: '', has_client_secret: false, updated_at: null },
  { platform_key: 'tiktok',    platform_label: 'TikTok',             configured: false, enabled: false, client_id_preview: '', has_client_secret: false, updated_at: null },
  { platform_key: 'pinterest', platform_label: 'Pinterest',          configured: false, enabled: false, client_id_preview: '', has_client_secret: false, updated_at: null },
  { platform_key: 'reddit',    platform_label: 'Reddit',             configured: false, enabled: false, client_id_preview: '', has_client_secret: false, updated_at: null },
];

export type KnownApiEntry = {
  key: string;
  name: string;
  icon: string;
  env_var: string | null;
  auth_type: string;
  base_url: string;
  description: string;
  default_query_params?: Record<string, string>;
  default_headers?: Record<string, string>;
  optional_token?: boolean;
};

export const KNOWN_APIS: Record<string, KnownApiEntry[]> = {
  trend: [
    { key: 'youtube',    name: 'YouTube Data API',        icon: '▶️',  env_var: 'YOUTUBE_API_KEY',   auth_type: 'query',  base_url: 'https://www.googleapis.com/youtube/v3/search',      description: 'Trending videos and Shorts' },
    { key: 'newsapi',    name: 'NewsAPI',                 icon: '📰',  env_var: 'NEWS_API_KEY',      auth_type: 'query',  base_url: 'https://newsapi.org/v2/top-headlines',             description: 'Top headlines + full-text search' },
    { key: 'serpapi',    name: 'SerpAPI',                 icon: '🔍',  env_var: 'SERPAPI_KEY',       auth_type: 'query',  base_url: 'https://serpapi.com/search',                       description: 'Google Trends + Google News results' },
    { key: 'searchapi',  name: 'SearchAPI',               icon: '🔎',  env_var: 'SEARCHAPI_KEY',     auth_type: 'query',  base_url: 'https://www.searchapi.io/api/v1/search',           description: 'Real-time Google search results' },
    { key: 'gdelt',      name: 'GDELT Events',            icon: '🌍',  env_var: null,                auth_type: 'none',   base_url: 'https://api.gdeltproject.org/api/v2/events/search', description: 'Global event data — no key needed' },
    { key: 'pytrends',   name: 'Google Trends (Proxy)',   icon: '📈',  env_var: null,                auth_type: 'none',   base_url: 'https://trends-proxy.yourdomain.com/trends',       description: 'Requires a self-hosted PyTrends bridge' },
  ],
  community: [
    { key: 'reddit',       name: 'Reddit Search',   icon: '🟠',  env_var: null,                auth_type: 'none',   base_url: 'https://www.reddit.com/search.json',               description: 'Public Reddit search — no key needed', default_query_params: { q: 'technology', limit: '10', sort: 'new', t: 'week' } },
    { key: 'hackernews',   name: 'Hacker News',     icon: '🔶',  env_var: null,                auth_type: 'none',   base_url: 'https://hn.algolia.com/api/v1/search',             description: 'Algolia HN search — no key needed',    default_query_params: { query: 'technology', tags: 'story', hitsPerPage: '10' } },
    { key: 'stackoverflow',name: 'Stack Overflow',  icon: '📚',  env_var: null,                auth_type: 'none',   base_url: 'https://api.stackexchange.com/2.3/questions',      description: 'Developer Q&A trends — no key needed', default_query_params: { site: 'stackoverflow', pagesize: '10', order: 'desc', sort: 'activity', tagged: 'javascript' } },
    { key: 'github',       name: 'GitHub Search',   icon: '🐙',  env_var: 'GITHUB_TOKEN',      auth_type: 'bearer', base_url: 'https://api.github.com/search/repositories',      description: 'Trending repos — token optional (higher rate limit)', default_query_params: { q: 'trending', sort: 'stars', order: 'desc', per_page: '10' }, optional_token: true },
    { key: 'discord',      name: 'Discord',         icon: '💬',  env_var: 'DISCORD_BOT_TOKEN', auth_type: 'bearer', base_url: 'https://discord.com/api/v10/gateway',             description: 'Bot token required — community server signals', default_query_params: {} },
  ],
  llm: [
    { key: 'openai',    name: 'OpenAI (GPT-4o)',    icon: '🤖',  env_var: 'OPENAI_API_KEY',        auth_type: 'bearer',   base_url: 'https://api.openai.com/v1/models',                               description: 'GPT-4o, GPT-4, GPT-3.5 models' },
    { key: 'anthropic', name: 'Anthropic Claude',   icon: '🧠',  env_var: 'ANTHROPIC_API_KEY',     auth_type: 'api_key',  base_url: 'https://api.anthropic.com/v1/models',                           description: 'Claude 3.5 Sonnet, Opus, Haiku', default_headers: { 'anthropic-version': '2023-06-01' } },
    { key: 'gemini',    name: 'Google Gemini',       icon: '✨',  env_var: 'GOOGLE_GEMINI_API_KEY', auth_type: 'query',    base_url: 'https://generativelanguage.googleapis.com/v1beta/models',       description: 'Gemini 1.5 Pro / Flash' },
    { key: 'groq',      name: 'Groq',               icon: '⚡',  env_var: 'GROQ_API_KEY',          auth_type: 'bearer',   base_url: 'https://api.groq.com/openai/v1/models',                         description: 'Ultra-fast inference — Llama, Mixtral' },
    { key: 'mistral',   name: 'Mistral AI',         icon: '🌊',  env_var: 'MISTRAL_API_KEY',       auth_type: 'bearer',   base_url: 'https://api.mistral.ai/v1/models',                              description: 'Mistral Large, Mixtral models' },
    { key: 'cohere',    name: 'Cohere',             icon: '🔗',  env_var: 'COHERE_API_KEY',        auth_type: 'bearer',   base_url: 'https://api.cohere.ai/v2/models',                               description: 'Command R+ for RAG and generation' },
  ],
  image: [
    { key: 'dalle',     name: 'DALL-E (OpenAI)',    icon: '🖼️',  env_var: 'OPENAI_API_KEY',      auth_type: 'bearer', base_url: 'https://api.openai.com/v1/models',              description: 'DALL-E 3 image generation — shares OPENAI_API_KEY' },
    { key: 'stability', name: 'Stability AI',       icon: '🎨',  env_var: 'STABILITY_API_KEY',   auth_type: 'bearer', base_url: 'https://api.stability.ai/v1/engines/list',      description: 'Stable Diffusion XL, SD3' },
    { key: 'replicate', name: 'Replicate',          icon: '🔁',  env_var: 'REPLICATE_API_TOKEN', auth_type: 'bearer', base_url: 'https://api.replicate.com/v1/collections',     description: 'Flux, SDXL and any open model' },
    { key: 'fal',       name: 'fal.ai',             icon: '⚡',  env_var: 'FAL_API_KEY',         auth_type: 'api_key',base_url: 'https://rest.alpha.fal.ai/v1/models',           description: 'Fast Flux and image models', default_headers: { 'Authorization': 'Key {{api_key}}' } },
    { key: 'unsplash',  name: 'Unsplash',           icon: '📷',  env_var: 'UNSPLASH_ACCESS_KEY', auth_type: 'query',  base_url: 'https://api.unsplash.com/photos',               description: 'High-quality free stock photos', default_query_params: { client_id: '{{api_key}}', per_page: '3' } },
    { key: 'pixabay',   name: 'Pixabay',            icon: '🌄',  env_var: 'PIXABAY_API_KEY',     auth_type: 'query',  base_url: 'https://pixabay.com/api/',                      description: 'Free stock images, videos and music', default_query_params: { key: '{{api_key}}', q: 'nature', per_page: '3', image_type: 'photo' } },
    { key: 'pexels',    name: 'Pexels',             icon: '🖼️',  env_var: 'PEXELS_API_KEY',      auth_type: 'api_key',base_url: 'https://api.pexels.com/v1/search',              description: 'Free stock photos and videos', default_query_params: { query: 'nature', per_page: '1' }, default_headers: { Authorization: '{{api_key}}' } },
  ],
  others: [
    { key: 'serper',       name: 'Serper (Google Search)',  icon: '🔎',  env_var: 'SERPER_API_KEY',      auth_type: 'api_key',base_url: 'https://google.serper.dev/search',              description: 'Google Search JSON API (POST-based — key validation only)' },
    { key: 'browserless',  name: 'Browserless',             icon: '🌐',  env_var: 'BROWSERLESS_API_KEY', auth_type: 'api_key',base_url: 'https://chrome.browserless.io/json/version',   description: 'Headless Chrome for web scraping' },
    { key: 'apify',        name: 'Apify',                   icon: '🕷️',  env_var: 'APIFY_API_TOKEN',     auth_type: 'bearer', base_url: 'https://api.apify.com/v2/users/me',             description: 'Web scraping and automation actors' },
    { key: 'perplexity',   name: 'Perplexity AI',           icon: '🧩',  env_var: 'PERPLEXITY_API_KEY',  auth_type: 'bearer', base_url: 'https://api.perplexity.ai/models',              description: 'AI-powered search and answers' },
  ],
};
export default function SuperAdminTypesPage() {
  return null;
}
