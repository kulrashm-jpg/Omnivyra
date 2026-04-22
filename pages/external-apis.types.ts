/**
 * Shared types, constants, and pure utilities for ExternalApisPage.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type KeyValuePair = { key: string; value: string };

export type ProviderAccount = {
  id: string;
  api_source_id: string;
  account_name: string;
  priority: number;
  is_active: boolean;
  rate_limit_per_min: number | null;
  rate_limit_per_day: number | null;
  current_usage_min: number;
  current_usage_day: number;
  last_reset_at: string;
  created_at: string;
  // joined from usage/health
  last_used_at?: string | null;
  last_outcome?: string | null;
  health_score?: number | null;
};

export type ApiSource = {
  id: string;
  name: string;
  base_url: string;
  purpose: string;
  category?: string | null;
  company_id?: string | null;
  is_active: boolean;
  is_enabled_global?: boolean | null;
  is_whitelisted?: boolean | null;
  method?: string;
  auth_type: string;
  platform_type?: string;
  api_key_name?: string | null;
  api_key_env_name?: string | null;
  headers?: Record<string, string> | null;
  query_params?: Record<string, string> | null;
  is_preset?: boolean | null;
  account_count?: number;
  active_account_count?: number;
  enabled_companies?: string[];
  usage_by_company?: Array<{
    company_id: string;
    request_count: number;
    success_count: number;
    failure_count: number;
    by_feature?: Array<{
      feature: string;
      request_count: number;
      success_count: number;
      failure_count: number;
    }>;
    by_user?: Array<{
      user_id: string;
      request_count: number;
      success_count: number;
      failure_count: number;
    }>;
  }>;
  enabled_user_count?: number;
  usage_summary?: {
    request_count: number;
    success_count: number;
    failure_count: number;
    last_used_at?: string | null;
    last_failure_at?: string | null;
    last_error_message?: string | null;
    last_error_at?: string | null;
    last_success_at?: string | null;
    last_error_code?: string | null;
    failure_rate?: number;
  } | null;
  usage_daily?: Array<{
    usage_date: string;
    request_count: number;
    success_count: number;
    failure_count: number;
  }>;
  health?: {
    freshness_score?: number;
    reliability_score?: number;
    last_test_status?: string | null;
    last_test_at?: string | null;
    last_test_latency_ms?: number | null;
  } | null;
  company_limits?: { daily_limit: number | null; signal_limit: number | null } | null;
  usage_today?: { request_count: number; signals_generated: number } | null;
};

export type ExternalApiPreset = {
  id?: string;
  name: string;
  description: string;
  base_url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  query_params: Record<string, string | number>;
  auth_type: string;
  api_key_env_name?: string | null;
  example_response_type: 'json';
  is_preset: true;
};

export type ApiRequest = {
  id: string;
  name: string;
  base_url: string;
  status: string;
  created_at: string;
  created_by_user_id?: string | null;
  purpose?: string | null;
  category?: string | null;
  auth_type?: string | null;
  api_key_env_name?: string | null;
  rejection_reason?: string | null;
};

// ── Utility functions ─────────────────────────────────────────────────────────

export const toPairs = (record?: Record<string, any> | null): KeyValuePair[] => {
  if (!record || typeof record !== 'object') return [{ key: '', value: '' }];
  const entries = Object.entries(record);
  if (entries.length === 0) return [{ key: '', value: '' }];
  return entries.map(([key, value]) => ({ key, value: String(value) }));
};

export const pairsToRecord = (pairs: KeyValuePair[]): Record<string, string> => {
  return pairs.reduce<Record<string, string>>((acc, pair) => {
    const key = pair.key.trim();
    if (!key) return acc;
    acc[key] = pair.value;
    return acc;
  }, {});
};

export const buildPreviewUrl = (baseUrl: string, queryParams: Record<string, string>) => {
  try {
    const url = new URL(baseUrl || 'https://example.com');
    Object.entries(queryParams).forEach(([key, value]) => {
      if (value === '') return;
      url.searchParams.set(key, value);
    });
    return baseUrl ? url.toString() : '';
  } catch {
    return baseUrl || '';
  }
};

export const buildPreviewHeaders = (
  authType: string,
  apiKeyEnvName?: string | null,
  headers?: Record<string, string>
) => {
  const merged = { ...(headers || {}) };
  if (authType === 'bearer' && apiKeyEnvName && !merged.Authorization) {
    merged.Authorization = `Bearer {{${apiKeyEnvName}}}`;
  }
  return merged;
};

/** Classify API error for display (API key, quota, rate limit, etc.) */
export function classifyApiError(
  code?: string | null,
  message?: string | null
): 'api_key' | 'quota' | 'rate_limit' | null {
  const c = String(code || '').toLowerCase();
  const m = String(message || '').toLowerCase();
  if (c === '401' || m.includes('unauthorized') || (m.includes('invalid') && (m.includes('key') || m.includes('api')))) return 'api_key';
  if (c === '403' || m.includes('forbidden') || m.includes('access denied')) return 'api_key';
  if (c === '429' || m.includes('rate limit') || m.includes('too many requests')) return 'rate_limit';
  if (m.includes('quota') || m.includes('limit exceeded') || m.includes('exceeded')) return 'quota';
  return null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const API_META: Record<string, { icon: string; color: string }> = {
  // Trend
  'YouTube Trends':                   { icon: '▶️',  color: 'border-red-200 bg-red-50' },
  'YouTube Shorts Trends':            { icon: '▶️',  color: 'border-red-200 bg-red-50' },
  'NewsAPI Headlines':                { icon: '📰',  color: 'border-blue-200 bg-blue-50' },
  'NewsAPI Everything':               { icon: '📰',  color: 'border-blue-200 bg-blue-50' },
  'SerpAPI Google Trends':            { icon: '🔍',  color: 'border-emerald-200 bg-emerald-50' },
  'SerpAPI Google News':              { icon: '🔍',  color: 'border-emerald-200 bg-emerald-50' },
  'GDELT Events':                     { icon: '🌍',  color: 'border-teal-200 bg-teal-50' },
  'Google Trends (PyTrends Bridge)':  { icon: '📈',  color: 'border-green-200 bg-green-50' },
  // Social
  'X (Twitter) Recent Search':        { icon: '𝕏',  color: 'border-gray-200 bg-gray-50' },
  // Community
  'Reddit Search':                    { icon: '🟠',  color: 'border-orange-200 bg-orange-50' },
  'Hacker News Trends':               { icon: '🔶',  color: 'border-orange-200 bg-orange-50' },
  'Stack Overflow Trends':            { icon: '📚',  color: 'border-amber-200 bg-amber-50' },
  // Others — LLMs & image APIs
  'OpenAI GPT':                       { icon: '🤖',  color: 'border-violet-200 bg-violet-50' },
  'Anthropic Claude':                 { icon: '🧠',  color: 'border-purple-200 bg-purple-50' },
  'Google Gemini':                    { icon: '✨',  color: 'border-blue-200 bg-blue-50' },
  'Mistral AI':                       { icon: '🌊',  color: 'border-indigo-200 bg-indigo-50' },
  'Groq':                             { icon: '⚡',  color: 'border-yellow-200 bg-yellow-50' },
  'Cohere':                           { icon: '🔗',  color: 'border-teal-200 bg-teal-50' },
  'HuggingFace':                      { icon: '🤗',  color: 'border-amber-200 bg-amber-50' },
  'Replicate':                        { icon: '🔁',  color: 'border-gray-200 bg-gray-50' },
  'Stability AI':                     { icon: '🎨',  color: 'border-rose-200 bg-rose-50' },
  'DALL-E':                           { icon: '🖼️',  color: 'border-pink-200 bg-pink-50' },
  'Midjourney':                       { icon: '🎭',  color: 'border-fuchsia-200 bg-fuchsia-50' },
};

export const emptyForm: Partial<ApiSource> = {
  name: '',
  base_url: '',
  purpose: 'trends',
  category: '',
  is_active: true,
  method: 'GET',
  auth_type: 'none',
  api_key_name: '',
  api_key_env_name: '',
  headers: {},
  query_params: {},
  is_preset: false,
};

/** Test scenarios for Super Admin API testing — 2–3 preset category/geo combos. */
export const TEST_SCENARIOS = [
  { id: 'trends', label: 'Trends', category: 'trends', geo: 'US' },
  { id: 'ai', label: 'AI Technology', category: 'AI technology', geo: 'US' },
  { id: 'marketing', label: 'Marketing', category: 'marketing', geo: 'US' },
] as const;
export default function ExternalApisTypesPage() {
  return null;
}
