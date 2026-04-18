import type { getCacheStats } from '../redisExternalApiCache';

/** Valid category values for external_api_sources. */
export const VALID_API_CATEGORIES = ['trend', 'community', 'image', 'others'] as const;
export type ApiCategory = typeof VALID_API_CATEGORIES[number];

export type ExternalApiSource = {
  id: string;
  name: string;
  base_url: string;
  purpose: string;
  /** One of: trend | community | image | others | null */
  category?: ApiCategory | string | null;
  company_id?: string | null;
  is_active: boolean;
  /** SuperAdmin global kill-switch — false skips this source in all execution flows. */
  is_enabled_global?: boolean | null;
  /** Required true for category='others' sources to appear in execution flows. */
  is_whitelisted?: boolean | null;
  method?: string | null;
  auth_type: string;
  api_key_name?: string | null;
  api_key_env_name?: string | null;
  /** Encrypted OAuth Client ID - never expose to client */
  oauth_client_id_encrypted?: string | null;
  /** Encrypted OAuth Client Secret - never expose to client */
  oauth_client_secret_encrypted?: string | null;
  headers?: Record<string, any> | null;
  query_params?: Record<string, any> | null;
  is_preset?: boolean | null;
  retry_count?: number | null;
  timeout_ms?: number | null;
  rate_limit_per_min?: number | null;
  platform_type?: string;
  supported_content_types?: string[];
  promotion_modes?: string[];
  required_metadata?: Record<string, any>;
  posting_constraints?: Record<string, any>;
  requires_admin?: boolean;
  created_at: string;
};

export type ExternalApiUserAccess = {
  id: string;
  api_source_id: string;
  user_id: string;
  api_key_env_name?: string | null;
  headers_override?: Record<string, any> | null;
  query_params_override?: Record<string, any> | null;
  rate_limit_per_min?: number | null;
  created_at?: string;
  updated_at?: string;
};

export type ExternalApiAccessConfig = ExternalApiSource & {
  user_access?: ExternalApiUserAccess | null;
};

export type ExternalApiHealth = {
  api_source_id: string;
  freshness_score: number;
  reliability_score: number;
};

export type PlatformConfig = ExternalApiSource & {
  health?: ExternalApiHealth | null;
};

export type PlatformStrategy = {
  platform_type: string;
  supported_content_types: string[];
  supported_promotion_modes: string[];
  required_metadata: string[];
  is_active: boolean;
  health_score: number;
  category?: string | null;
  name?: string;
};

export type ExternalApiFetchResult = {
  source: ExternalApiSource;
  payload: any;
  health?: { freshness_score: number; reliability_score: number } | null;
  health_score?: number | null;
  cache_hit: boolean;
  missing_env?: string[];
};

export type ExternalApiFetchSummary = {
  results: ExternalApiFetchResult[];
  missing_env_placeholders: string[];
  cache_stats: ReturnType<typeof getCacheStats>;
  rate_limited_sources: string[];
  signal_confidence_summary: { average: number; min: number; max: number } | null;
};

export type TrendSignal = {
  topic: string;
  source: string;
  geo?: string;
  velocity?: number;
  sentiment?: number;
  volume?: number;
  signal_confidence?: number;
  trend_source_health?: {
    freshness_score: number;
    reliability_score: number;
  };
  omnivyra?: {
    decision_id?: string;
    confidence?: number;
    placeholders?: string[];
    explanation?: string;
    contract_version?: string;
    partial?: boolean;
  };
};

export type ExternalApiRequestDetails = {
  url: string;
  maskedUrl: string;
  method: string;
  headers: Record<string, string>;
  maskedHeaders: Record<string, string>;
  queryParams: Record<string, string>;
};

export type AccountAttemptOutcome =
  | 'success'
  | 'rate_limited'
  | 'failed'
  | 'missing_env'
  | 'client_error'
  | 'skipped';

export type AccountLoopResult = {
  success: boolean;
  payload: any | null;
  accountId: string | null;
  exhausted: boolean;
  clientError: boolean;
  missingEnv: string[];
  health: { freshness_score: number; reliability_score: number } | null;
  healthScore: number | null;
};

export type FetchSingleSourceResult = {
  results: Array<{
    source: ExternalApiSource;
    payload: any;
    health?: { freshness_score: number; reliability_score: number } | null;
  }>;
  queryHash?: string | null;
  queryContext?: {
    topic?: string | null;
    competitor?: string | null;
    product?: string | null;
    region?: string | null;
    keyword?: string | null;
  } | null;
};
