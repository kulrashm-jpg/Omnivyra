import { useState, useCallback } from 'react';
import { apiFetch } from '../../../lib/apiFetch';

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
    by_feature?: Array<{ feature: string; request_count: number; success_count: number; failure_count: number }>;
    by_user?: Array<{ user_id: string; request_count: number; success_count: number; failure_count: number }>;
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
  usage_daily?: Array<{ usage_date: string; request_count: number; success_count: number; failure_count: number }>;
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

export function useExternalApis(
  companyContextId: string | null,
  isPlatformCatalogMode: boolean,
) {
  const [apis, setApis] = useState<ApiSource[]>([]);
  const [runtime, setRuntime] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [presets, setPresets] = useState<ExternalApiPreset[]>([]);
  const [isLoadingPresets, setIsLoadingPresets] = useState(false);
  const [hiddenPresetIds, setHiddenPresetIds] = useState<Set<string>>(new Set());
  const [requests, setRequests] = useState<ApiRequest[]>([]);
  const [isLoadingRequests, setIsLoadingRequests] = useState(false);
  const [platformAccessDenied, setPlatformAccessDenied] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const fetchWithAuth = useCallback(async (input: RequestInfo, init?: RequestInit) => {
    // Delegate to canonical apiFetch wrapper (attaches Bearer + credentials).
    const url = typeof input === 'string' ? input : input.url;
    return apiFetch(url, init);
  }, []);

  const resetMessages = useCallback(() => {
    setErrorMessage(null);
    setSuccessMessage(null);
  }, []);

  const loadApis = useCallback(async (skipCache = false) => {
    try {
      if (!companyContextId && !isPlatformCatalogMode) return;
      setIsLoading(true);
      const url = companyContextId
        ? `/api/external-apis?companyId=${companyContextId}${skipCache ? '&skipCache=1' : ''}`
        : '/api/external-apis?scope=platform';
      const response = await fetchWithAuth(url);
      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        if (response.status === 401) { setPlatformAccessDenied(true); return; }
        if (isPlatformCatalogMode && response.status === 403) setPlatformAccessDenied(true);
        setErrorMessage(errorBody?.error || 'Failed to load APIs');
        return;
      }
      const data = await response.json();
      setApis(data.apis || []);
      setRuntime(data.runtime || null);
    } catch {
      setErrorMessage('Failed to load API sources.');
    } finally {
      setIsLoading(false);
    }
  }, [companyContextId, isPlatformCatalogMode, fetchWithAuth]);

  const loadPresets = useCallback(async () => {
    try {
      if (!companyContextId && !isPlatformCatalogMode) return null;
      setIsLoadingPresets(true);
      const url = companyContextId
        ? `/api/external-apis/presets?companyId=${companyContextId}`
        : '/api/external-apis/presets?scope=platform';
      const response = await fetchWithAuth(url);
      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        if (response.status === 401) { setPlatformAccessDenied(true); return null; }
        if (isPlatformCatalogMode && response.status === 403) setPlatformAccessDenied(true);
        setErrorMessage(errorBody?.error || 'Failed to load presets');
        return null;
      }
      const data = await response.json();
      setPresets(data.presets || []);
      setHiddenPresetIds(new Set(data.hidden_ids || []));
      return { presets: data.presets || [], hidden_ids: data.hidden_ids || [] };
    } catch {
      setErrorMessage('Failed to load presets.');
      return null;
    } finally {
      setIsLoadingPresets(false);
    }
  }, [companyContextId, isPlatformCatalogMode, fetchWithAuth]);

  const loadRequests = useCallback(async () => {
    try {
      setIsLoadingRequests(true);
      if (!companyContextId && !isPlatformCatalogMode) return;
      const url = companyContextId
        ? `/api/external-apis/requests?companyId=${companyContextId}`
        : '/api/external-apis/requests?scope=platform';
      const response = await fetchWithAuth(url);
      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        if (response.status === 401) { setPlatformAccessDenied(true); return; }
        if (isPlatformCatalogMode && response.status === 403) setPlatformAccessDenied(true);
        if (errorBody?.error === 'FORBIDDEN_ROLE') { setRequests([]); return; }
        setErrorMessage(errorBody?.error || 'Failed to load requests');
        return;
      }
      const data = await response.json();
      setRequests(data.requests || []);
    } catch {
      // silently ignore
    } finally {
      setIsLoadingRequests(false);
    }
  }, [companyContextId, isPlatformCatalogMode, fetchWithAuth]);

  return {
    apis, setApis, runtime, isLoading, presets, isLoadingPresets, hiddenPresetIds,
    requests, isLoadingRequests, platformAccessDenied, setPlatformAccessDenied,
    errorMessage, setErrorMessage, successMessage, setSuccessMessage,
    fetchWithAuth, resetMessages, loadApis, loadPresets, loadRequests,
  };
}
