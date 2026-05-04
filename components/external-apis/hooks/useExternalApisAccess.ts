import { useState, useCallback, useMemo } from 'react';
import { getAuthToken } from '../../../utils/getAuthToken';

export type ApiSourceAccess = {
  id: string;
  name: string;
  base_url: string;
  purpose: string;
  category?: string | null;
  company_id?: string | null;
  auth_type: string;
  method?: string | null;
  is_active: boolean;
  is_preset?: boolean | null;
  is_global_preset?: boolean | null;
  api_key_env_name?: string | null;
  headers?: Record<string, any> | null;
  query_params?: Record<string, any> | null;
  user_access?: UserAccess | null;
  usage_summary?: UsageSummary | null;
  usage_daily?: UsageDaily[];
  usage_company?: { total_calls: number; success_count: number; failure_count: number } | null;
  company_limits?: { daily_limit: number | null; signal_limit: number | null } | null;
  usage_today?: { request_count: number; signals_generated: number };
  usage_by_feature?: Array<{ feature: string; request_count: number; success_count: number; failure_count: number }>;
  usage_by_user?: Array<{ user_id: string; request_count: number; success_count: number; failure_count: number }>;
};

export type UserAccess = {
  api_source_id: string;
  is_enabled: boolean;
  api_key_env_name?: string | null;
  headers_override?: Record<string, any> | null;
  query_params_override?: Record<string, any> | null;
  rate_limit_per_min?: number | null;
};

export type UsageSummary = {
  request_count: number;
  success_count: number;
  failure_count: number;
  last_used_at?: string | null;
  last_failure_at?: string | null;
  last_error_message?: string | null;
  last_error_at?: string | null;
  last_success_at?: string | null;
  last_error_code?: string | null;
};

export type UsageDaily = {
  usage_date: string;
  request_count: number;
  success_count: number;
  failure_count: number;
};

export type AccessDraft = {
  is_enabled: boolean;
  api_key_env_name: string;
  headers_override_json: string;
  query_params_override_json: string;
  rate_limit_per_min: string;
  error?: string | null;
  saving?: boolean;
};

export type AccessApiRequest = {
  id: string;
  name: string;
  base_url: string;
  status: string;
  created_at: string;
  rejection_reason?: string | null;
  company_id?: string | null;
};

function buildDrafts(sources: ApiSourceAccess[], defaultIds: Set<string>): Record<string, AccessDraft> {
  const next: Record<string, AccessDraft> = {};
  sources.forEach((source) => {
    const access = source.user_access;
    next[source.id] = {
      is_enabled: defaultIds.has(source.id),
      api_key_env_name: access?.api_key_env_name || '',
      headers_override_json: JSON.stringify(access?.headers_override || {}, null, 2),
      query_params_override_json: JSON.stringify(access?.query_params_override || {}, null, 2),
      rate_limit_per_min: access?.rate_limit_per_min ? String(access.rate_limit_per_min) : '',
      error: null,
      saving: false,
    };
  });
  return next;
}

export function useExternalApisAccess(selectedCompanyId: string | null | undefined) {
  const [apis, setApis] = useState<ApiSourceAccess[]>([]);
  const [drafts, setDrafts] = useState<Record<string, AccessDraft>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [requests, setRequests] = useState<AccessApiRequest[]>([]);
  const [canManageExternalApis, setCanManageExternalApis] = useState(false);
  const [globalPresets, setGlobalPresets] = useState<ApiSourceAccess[]>([]);
  const [companyDefaultApis, setCompanyDefaultApis] = useState<string[]>([]);

  const apiFetch = useCallback(async (input: RequestInfo, init?: RequestInit) => {
    const token = await getAuthToken();
    if (!token) throw new Error('Not authenticated');
    return fetch(input, {
      ...init,
      headers: { ...(init?.headers || {}), Authorization: `Bearer ${token}` },
    });
  }, []);

  const updateDraft = useCallback((id: string, updates: Partial<AccessDraft>) => {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...updates, error: updates.error !== undefined ? updates.error : null } }));
  }, []);

  const loadApis = useCallback(async () => {
    try {
      setIsLoading(true);
      if (!selectedCompanyId) { setApis([]); setDrafts({}); return; }
      const response = await apiFetch(`/api/external-apis/access?companyId=${encodeURIComponent(selectedCompanyId)}`);
      if (!response.ok) throw new Error('Failed to load APIs');
      const data = await response.json();
      const available = data.availableApis || data.apis || [];
      const defaults = Array.isArray(data.companyDefaultApis) ? data.companyDefaultApis : [];
      setApis(available);
      setCompanyDefaultApis(defaults);
      setDrafts(buildDrafts(available, new Set(defaults)));
      setCanManageExternalApis(!!data?.permissions?.canManageExternalApis);
      setGlobalPresets(data.global_presets || []);
    } catch {
      setSaveMessage('Failed to load external APIs.');
    } finally {
      setIsLoading(false);
    }
  }, [selectedCompanyId, apiFetch]);

  const loadRequests = useCallback(async () => {
    try {
      if (!selectedCompanyId) { setRequests([]); return; }
      const response = await apiFetch(`/api/external-apis/requests?companyId=${encodeURIComponent(selectedCompanyId)}`);
      if (!response.ok) { setRequests([]); return; }
      const data = await response.json();
      setRequests(data.requests || []);
    } catch {
      // ignore
    }
  }, [selectedCompanyId, apiFetch]);

  const todayKey = new Date().toISOString().slice(0, 10);

  const visibleApis = canManageExternalApis ? apis : apis.filter((api) => drafts[api.id]?.is_enabled);

  const activeCount = useMemo(() => apis.filter((api) => drafts[api.id]?.is_enabled).length, [apis, drafts]);

  const pendingRequestNames = useMemo(() => {
    const set = new Set<string>();
    requests.forEach((req) => {
      if (req.status === 'pending' || req.status === 'pending_admin_review') set.add(req.name.toLowerCase());
    });
    return set;
  }, [requests]);

  const usageTotals = useMemo(() => {
    let requestsToday = 0;
    let failuresToday = 0;
    visibleApis.forEach((api) => {
      const day = (api.usage_daily || []).find((row) => row.usage_date === todayKey);
      if (day) { requestsToday += day.request_count || 0; failuresToday += day.failure_count || 0; }
    });
    return { requestsToday, failuresToday };
  }, [visibleApis, todayKey]);

  return {
    apis, drafts, isLoading, saveMessage, setSaveMessage,
    requests, setRequests, canManageExternalApis,
    globalPresets, companyDefaultApis,
    visibleApis, activeCount, pendingRequestNames, usageTotals,
    apiFetch, updateDraft, loadApis, loadRequests,
  };
}
