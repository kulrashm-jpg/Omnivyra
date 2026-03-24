import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCompanyContext } from '../components/CompanyContext';
import Header from '../components/Header';
import { getAuthToken } from '../utils/getAuthToken';

type KeyValuePair = { key: string; value: string };

const toPairs = (record?: Record<string, any> | null): KeyValuePair[] => {
  if (!record || typeof record !== 'object') return [{ key: '', value: '' }];
  const entries = Object.entries(record);
  if (entries.length === 0) return [{ key: '', value: '' }];
  return entries.map(([key, value]) => ({ key, value: String(value) }));
};

const pairsToRecord = (pairs: KeyValuePair[]): Record<string, string> => {
  return pairs.reduce<Record<string, string>>((acc, pair) => {
    const key = pair.key.trim();
    if (!key) return acc;
    acc[key] = pair.value;
    return acc;
  }, {});
};

const buildPreviewUrl = (baseUrl: string, queryParams: Record<string, string>) => {
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

const buildPreviewHeaders = (
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
type ApiSource = {
  id: string;
  name: string;
  base_url: string;
  purpose: string;
  category?: string | null;
  company_id?: string | null;
  is_active: boolean;
  method?: string;
  auth_type: string;
  platform_type?: string;
  api_key_name?: string | null;
  api_key_env_name?: string | null;
  headers?: Record<string, string> | null;
  query_params?: Record<string, string> | null;
  is_preset?: boolean | null;
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

/** Classify API error for display (API key, quota, rate limit, etc.) */
function classifyApiError(
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

const API_META: Record<string, { icon: string; color: string }> = {
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
  'X (Twitter) Recent Search':        { icon: '🐦',  color: 'border-sky-200 bg-sky-50' },
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

type ExternalApiPreset = {
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

type ApiRequest = {
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

const emptyForm: Partial<ApiSource> = {
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
const TEST_SCENARIOS = [
  { id: 'trends', label: 'Trends', category: 'trends', geo: 'US' },
  { id: 'ai', label: 'AI Technology', category: 'AI technology', geo: 'US' },
  { id: 'marketing', label: 'Marketing', category: 'marketing', geo: 'US' },
] as const;

export default function ExternalApisPage() {
  const router = useRouter();
  const {
    selectedCompanyId,
    companies,
    isLoading: isCompanyLoading,
    isAuthenticated,
    userRole,
    hasPermission,
    setSelectedCompanyId,
  } = useCompanyContext();
  const [apis, setApis] = useState<ApiSource[]>([]);
  const [form, setForm] = useState<Partial<ApiSource>>(emptyForm);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [requests, setRequests] = useState<ApiRequest[]>([]);
  const [isLoadingRequests, setIsLoadingRequests] = useState(false);
  const [rejectionReasons, setRejectionReasons] = useState<Record<string, string>>({});
  const [presets, setPresets] = useState<ExternalApiPreset[]>([]);
  const [isLoadingPresets, setIsLoadingPresets] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<ExternalApiPreset | null>(null);
  const [selectedCatalogPreset, setSelectedCatalogPreset] = useState<string>('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [queryMode, setQueryMode] = useState<'pairs' | 'json'>('pairs');
  const [headerMode, setHeaderMode] = useState<'pairs' | 'json'>('pairs');
  const [queryPairs, setQueryPairs] = useState<KeyValuePair[]>(toPairs(form.query_params || {}));
  const [headerPairs, setHeaderPairs] = useState<KeyValuePair[]>(toPairs(form.headers || {}));
  const [queryJson, setQueryJson] = useState('{}');
  const [headerJson, setHeaderJson] = useState('{}');
  const [testResult, setTestResult] = useState<any>(null);
  const [testGeo, setTestGeo] = useState('US');
  const [selectedTestScenario, setSelectedTestScenario] = useState<string | null>(null);
  const [isSavingPreset, setIsSavingPreset] = useState(false);
  const [activeTab, setActiveTab] = useState<'trend' | 'social' | 'community' | 'others' | 'request-new' | 'queue' | 'usage'>('trend');
  const [runtime, setRuntime] = useState<any>(null);
  const [apiTestResults, setApiTestResults] = useState<Record<string, any>>({});
  const [hiddenPresetIds, setHiddenPresetIds] = useState<Set<string>>(new Set());
  const [showPresetModal, setShowPresetModal] = useState(false);
  const [presetSelection, setPresetSelection] = useState<Set<string>>(new Set());
  const [isSavingPresetSelection, setIsSavingPresetSelection] = useState(false);
  const [platformCompanies, setPlatformCompanies] = useState<Array<{ id: string; name: string }>>(
    []
  );
  const [platformCompanyId, setPlatformCompanyId] = useState('');
  const [isLoadingPlatformCompanies, setIsLoadingPlatformCompanies] = useState(false);
  const [lastHealthCheckAt, setLastHealthCheckAt] = useState<Date | null>(null);
  const [testAllRunning, setTestAllRunning] = useState(false);
  const [testAllSummary, setTestAllSummary] = useState<{ healthy: number; warning: number; failed: number } | null>(null);
  const [testConnectionLoadingId, setTestConnectionLoadingId] = useState<string | null>(null);
  const [expandedCardIds, setExpandedCardIds] = useState<Set<string>>(new Set());
  const [requestForm, setRequestForm] = useState({
    name: '',
    base_url: '',
    purpose: 'trends',
    category: '',
    method: 'GET' as 'GET' | 'POST',
    auth_type: 'none',
    api_key_env_name: '',
    description: '',
  });
  const [isSubmittingRequest, setIsSubmittingRequest] = useState(false);
  const isSuperAdmin = userRole === 'SUPER_ADMIN';
  const modeParam = Array.isArray(router.query?.mode)
    ? router.query?.mode[0]
    : router.query?.mode;
  // Use asPath fallback: router.query can be empty on first client render after navigation
  const isPlatformCatalogMode =
    modeParam === 'platform' || (router.asPath || '').includes('mode=platform');
  const isPlatformAdminView = isPlatformCatalogMode;
  const canManageExternalApis = isPlatformCatalogMode
    ? true
    : hasPermission('MANAGE_EXTERNAL_APIS');
  const [platformAccessDenied, setPlatformAccessDenied] = useState(false);
  const canManagePresets = canManageExternalApis;
  /** Run Test + Actions: show for Super Admin / platform admins. URL fallback for mode=platform when context is delayed. */
  const showRunTestAndActions =
    canManageExternalApis ||
    (typeof window !== 'undefined' && window.location.href.includes('mode=platform'));
  const companyContextId = isPlatformCatalogMode ? (platformCompanyId || null) : selectedCompanyId;

  const fetchWithAuth = async (input: RequestInfo, init?: RequestInit) => {
    const token = await getAuthToken();
    return fetch(input, {
      ...init,
      credentials: 'include',
      headers: {
        ...(init?.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  };

  const loadPlatformCompanies = async () => {
    if (!isPlatformCatalogMode) return;
    setIsLoadingPlatformCompanies(true);
    try {
      const response = await fetchWithAuth('/api/super-admin/companies');
      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        throw new Error(errorBody?.error || 'Failed to load companies');
      }
      const data = await response.json();
      const companies = (data.companies || []).map((company: any) => ({
        id: company.id,
        name: company.name || 'Unnamed company',
      }));
      setPlatformCompanies(companies);
      if (!selectedCompanyId && companies.length > 0 && !isPlatformCatalogMode) {
        setSelectedCompanyId(companies[0].id);
      }
    } catch (error) {
      console.error('Error loading platform companies:', error);
    } finally {
      setIsLoadingPlatformCompanies(false);
    }
  };

  const loadApis = async (skipCache = false) => {
    try {
      if (!companyContextId && !isPlatformCatalogMode) {
        console.warn('No company selected yet, skipping external API load');
        return;
      }
      setIsLoading(true);
      const url = companyContextId
        ? `/api/external-apis?companyId=${companyContextId}${skipCache ? '&skipCache=1' : ''}`
        : '/api/external-apis?scope=platform';
      console.log('DASHBOARD_API_CALL', url);
      const response = await fetchWithAuth(url);
      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        const errMsg = errorBody?.error || 'Failed to load APIs';
        if (response.status === 401) {
          setPlatformAccessDenied(true);
          if (!isPlatformCatalogMode) {
            setErrorMessage('Please sign in to access external APIs.');
          }
          return;
        }
        if (isPlatformCatalogMode && response.status === 403) {
          setPlatformAccessDenied(true);
        }
        setErrorMessage(errMsg);
        return;
      }
      const data = await response.json();
      setApis(data.apis || []);
      setRuntime(data.runtime || null);
      setLastHealthCheckAt(new Date());
    } catch (error) {
      console.error('Error loading APIs:', error);
      setErrorMessage('Failed to load API sources.');
    } finally {
      setIsLoading(false);
    }
  };

  const loadPresets = async () => {
    try {
      if (!companyContextId && !isPlatformCatalogMode) return;
      setIsLoadingPresets(true);
      const url = companyContextId
        ? `/api/external-apis/presets?companyId=${companyContextId}`
        : '/api/external-apis/presets?scope=platform';
      console.log('DASHBOARD_API_CALL', url);
      const response = await fetchWithAuth(url);
      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        if (response.status === 401) {
          setPlatformAccessDenied(true);
          if (!isPlatformCatalogMode) {
            setErrorMessage('Please sign in to access external APIs.');
          }
          return null;
        }
        if (isPlatformCatalogMode && response.status === 403) {
          setPlatformAccessDenied(true);
        }
        const msg = errorBody?.error === 'FORBIDDEN_ROLE'
          ? 'You don’t have permission to access external APIs for this company. Check your company role or ask an admin to enable access.'
          : (errorBody?.error || 'Failed to load presets');
        setErrorMessage(msg);
        return null;
      }
      const data = await response.json();
      setPresets(data.presets || []);
      setHiddenPresetIds(new Set(data.hidden_ids || []));
      return {
        presets: data.presets || [],
        hidden_ids: data.hidden_ids || [],
      };
    } catch (error) {
      console.error('Error loading presets:', error);
      setErrorMessage('Failed to load presets.');
      return null;
    } finally {
      setIsLoadingPresets(false);
    }
  };
  const openPresetModal = async () => {
    if (!companyContextId && isPlatformCatalogMode) {
      setErrorMessage('Select a company before assigning preset access.');
      return;
    }
    const fresh = presets.length === 0 ? await loadPresets() : null;
    const presetList = fresh?.presets ?? presets;
    const hiddenSet = new Set<string>(fresh?.hidden_ids ?? Array.from(hiddenPresetIds));
    const selected = new Set<string>();
    presetList.forEach((preset) => {
      if (!preset.id) return;
      if (!hiddenSet.has(preset.id)) {
        selected.add(preset.id);
      }
    });
    setPresetSelection(selected);
    setShowPresetModal(true);
  };

  const addPresetToCatalog = async (preset: ExternalApiPreset) => {
    try {
      resetMessages();
      const payload = {
        name: preset.name,
        base_url: preset.base_url,
        purpose: 'trends',
        category: preset.description || null,
        is_active: true,
        method: preset.method,
        auth_type: preset.auth_type,
        api_key_env_name: preset.api_key_env_name || null,
        headers: preset.headers || {},
        query_params: preset.query_params || {},
        is_preset: true,
        platform_type: 'social',
        supported_content_types: [],
        promotion_modes: [],
        required_metadata: {},
        posting_constraints: {},
        requires_admin: true,
      };
      const response = await fetchWithAuth('/api/external-apis?scope=platform', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        setErrorMessage(errorBody?.error || 'Failed to add preset to catalog');
        return;
      }
      setSuccessMessage('Preset added to global catalog.');
      setSelectedCatalogPreset('');
      await loadPresets();
      await loadApis();
    } catch (error) {
      console.error('Error adding preset to catalog:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Failed to add preset to catalog.');
    }
  };

  const togglePresetSelection = (presetId: string, checked: boolean) => {
    setPresetSelection((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(presetId);
      } else {
        next.delete(presetId);
      }
      return next;
    });
  };

  const savePresetSelection = async () => {
    if (!companyContextId) {
      setErrorMessage('Select a company before updating preset access.');
      return;
    }
    if (!canManagePresets) {
      setSuccessMessage('Configured by company admin.');
      return;
    }
    const selectable = presets.filter((preset) => preset.id);
    setIsSavingPresetSelection(true);
    resetMessages();
    try {
      if (selectable.length === 0) {
        setSuccessMessage(
          'No APIs in the catalog to update. Ask a platform admin to add global presets first, then you can select and configure them here.'
        );
        setShowPresetModal(false);
        await loadPresets();
        await loadApis();
        return;
      }
      const desiredIds = selectable.filter((p) => presetSelection.has(p.id)).map((p) => p.id);
      const response = await fetchWithAuth(`/api/external-apis/access?companyId=${encodeURIComponent(companyContextId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: companyContextId,
          company_default_api_ids: desiredIds,
          scope: 'company',
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setErrorMessage(data?.error || data?.detail || `Failed to save (${response.status})`);
        return;
      }
      setSuccessMessage('Preset selection saved.');
      setShowPresetModal(false);
      await loadPresets();
      await loadApis(true);
    } catch (error) {
      console.error('Error updating preset selection:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Failed to update preset selection.');
    } finally {
      setIsSavingPresetSelection(false);
    }
  };

  const loadRequests = async () => {
    try {
      setIsLoadingRequests(true);
      if (!companyContextId && !isPlatformCatalogMode) return;
      const url = companyContextId
        ? `/api/external-apis/requests?companyId=${companyContextId}`
        : '/api/external-apis/requests?scope=platform';
      console.log('DASHBOARD_API_CALL', url);
      const response = await fetchWithAuth(url);
      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        if (response.status === 401) {
          setPlatformAccessDenied(true);
          if (!isPlatformCatalogMode) {
            setErrorMessage('Please sign in to access external APIs.');
          }
          return;
        }
        if (isPlatformCatalogMode && response.status === 403) {
          setPlatformAccessDenied(true);
        }
        if (errorBody?.error === 'FORBIDDEN_ROLE') {
          setRequests([]);
          return;
        }
        setErrorMessage(errorBody?.error || 'Failed to load requests');
        return;
      }
      const data = await response.json();
      setRequests(data.requests || []);
    } catch (error) {
      console.error('Error loading requests:', error);
    } finally {
      setIsLoadingRequests(false);
    }
  };

  useEffect(() => {
    // Company mode: auto-select first company when none selected
    if (!isPlatformCatalogMode && isAuthenticated && companies.length > 0 && !selectedCompanyId) {
      setSelectedCompanyId(companies[0].company_id);
      return;
    }
  }, [isAuthenticated, companies, selectedCompanyId, isPlatformCatalogMode, setSelectedCompanyId]);

  useEffect(() => {
    // Platform catalog mode: allow loads for legacy super admin (cookie-only, no Supabase session)
    if (!isAuthenticated && !isPlatformCatalogMode) return;
    if (isPlatformCatalogMode && isPlatformAdminView) {
      loadPlatformCompanies();
    }
    loadApis();
    loadPresets();
    loadRequests();
  }, [isAuthenticated, selectedCompanyId, platformCompanyId, isPlatformCatalogMode, isPlatformAdminView]);

  useEffect(() => {
    if (!isPlatformCatalogMode && !companyContextId) return;
    const interval = setInterval(() => { loadApis(); }, 15 * 60 * 1000);
    return () => clearInterval(interval);
  }, [companyContextId, isPlatformCatalogMode]);

  useEffect(() => {
    setQueryPairs(toPairs(form.query_params || {}));
    setHeaderPairs(toPairs(form.headers || {}));
    setQueryJson(JSON.stringify(form.query_params || {}, null, 2));
    setHeaderJson(JSON.stringify(form.headers || {}, null, 2));
  }, [form.query_params, form.headers]);

  const resetMessages = () => {
    setErrorMessage(null);
    setSuccessMessage(null);
    setTestResult(null);
  };

  const findPresetByName = (name?: string | null) =>
    presets.find((preset) => preset.name.toLowerCase() === String(name || '').toLowerCase()) ||
    null;

  const applyPreset = (preset: ExternalApiPreset) => {
    resetMessages();
    setSelectedPreset(preset);
    setEditingPresetId(preset.id || null);
    setEditingId(null);
    setForm({
      ...emptyForm,
      name: preset.name,
      base_url: preset.base_url,
      method: preset.method,
      auth_type: preset.auth_type,
      api_key_env_name: preset.api_key_env_name || '',
      headers: preset.headers,
      query_params: preset.query_params as Record<string, string>,
      is_preset: true,
    });
  };

  const addBlankApi = () => {
    resetMessages();
    setSelectedPreset(null);
    setEditingId(null);
    setEditingPresetId(null);
    setForm(emptyForm);
  };

  const startEdit = (api: ApiSource) => {
    resetMessages();
    setEditingId(api.id);
    setEditingPresetId(null);
    setSelectedPreset(findPresetByName(api.name));
    setForm({
      ...emptyForm,
      ...api,
      api_key_env_name: api.api_key_env_name || api.api_key_name || '',
      headers: api.headers || {},
      query_params: api.query_params || {},
      is_preset: api.is_preset ?? false,
    });
  };

  const resolveEditorPayload = (): { ok: boolean; headers?: Record<string, string>; queryParams?: Record<string, string>; message?: string } => {
    let resolvedHeaders: Record<string, string> = {};
    let resolvedQuery: Record<string, string> = {};
    if (headerMode === 'json') {
      try {
        const parsed = JSON.parse(headerJson || '{}');
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          resolvedHeaders = parsed;
        } else {
          return { ok: false, message: 'Headers JSON must be an object.' };
        }
      } catch (error) {
        return { ok: false, message: 'Headers JSON is invalid.' };
      }
    } else {
      resolvedHeaders = pairsToRecord(headerPairs);
    }

    if (queryMode === 'json') {
      try {
        const parsed = JSON.parse(queryJson || '{}');
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          resolvedQuery = parsed;
        } else {
          return { ok: false, message: 'Query params JSON must be an object.' };
        }
      } catch (error) {
        return { ok: false, message: 'Query params JSON is invalid.' };
      }
    } else {
      resolvedQuery = pairsToRecord(queryPairs);
    }

    return { ok: true, headers: resolvedHeaders, queryParams: resolvedQuery };
  };

  const saveApi = async () => {
    try {
      resetMessages();
      const resolved = resolveEditorPayload();
      if (!resolved.ok) {
        setErrorMessage(resolved.message || 'Invalid headers/query params.');
        return;
      }
      setIsSaving(true);
      const payload = {
        ...form,
        headers: resolved.headers,
        query_params: resolved.queryParams,
        is_preset: form.is_preset ?? false,
      };
      if (!companyContextId && !isPlatformCatalogMode) {
        throw new Error('Select a company before saving an API.');
      }
      const url = editingId
        ? companyContextId
          ? `/api/external-apis/${editingId}?companyId=${companyContextId}`
          : `/api/external-apis/${editingId}?scope=platform`
        : companyContextId
          ? `/api/external-apis?companyId=${companyContextId}`
          : '/api/external-apis?scope=platform';
      console.log('DASHBOARD_API_CALL', url);
      const response = await fetchWithAuth(url, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        setErrorMessage(errorBody?.error || 'Failed to save API');
        return;
      }
      setForm(emptyForm);
      setSelectedPreset(null);
      setEditingId(null);
      setSuccessMessage(editingId ? 'API source updated.' : 'API source added.');
      await loadApis();
    } catch (error) {
      console.error('Error saving API:', error);
      setErrorMessage('Failed to save API source.');
    } finally {
      setIsSaving(false);
    }
  };

  const savePreset = async () => {
    try {
      resetMessages();
      const resolved = resolveEditorPayload();
      if (!resolved.ok) {
        setErrorMessage(resolved.message || 'Invalid headers/query params.');
        return;
      }
      setIsSavingPreset(true);
      const payload = {
        ...form,
        headers: resolved.headers,
        query_params: resolved.queryParams,
        is_preset: true,
      };
      if (!companyContextId && !isPlatformCatalogMode) {
        throw new Error('Select a company before saving a preset.');
      }
      const url = editingPresetId
        ? companyContextId
          ? `/api/external-apis/${editingPresetId}?companyId=${companyContextId}`
          : `/api/external-apis/${editingPresetId}?scope=platform`
        : companyContextId
          ? `/api/external-apis?companyId=${companyContextId}`
          : '/api/external-apis?scope=platform';
      console.log('DASHBOARD_API_CALL', url);
      const response = await fetchWithAuth(url, {
        method: editingPresetId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        setErrorMessage(errorBody?.error || 'Failed to save preset');
        return;
      }
      setSuccessMessage(editingPresetId ? 'Preset updated.' : 'Preset saved.');
      await loadPresets();
    } catch (error) {
      console.error('Error saving preset:', error);
      setErrorMessage('Failed to save preset.');
    } finally {
      setIsSavingPreset(false);
    }
  };

  const updateApi = async (api: ApiSource) => {
    try {
      resetMessages();
      const url = companyContextId
        ? `/api/external-apis/${api.id}?companyId=${companyContextId}`
        : `/api/external-apis/${api.id}?scope=platform`;
      console.log('DASHBOARD_API_CALL', url);
      const response = await fetchWithAuth(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(api),
      });
      if (!response.ok) throw new Error('Failed to update API');
      setSuccessMessage('API source updated.');
      await loadApis();
    } catch (error) {
      console.error('Error updating API:', error);
      setErrorMessage('Failed to update API source.');
    }
  };

  const deleteApi = async (id: string) => {
    try {
      resetMessages();
      if (!companyContextId && !isPlatformCatalogMode) {
        setErrorMessage('Select a company before deleting an API source.');
        return;
      }
      if (!confirm('Delete this API source? This will remove related health and usage records.')) {
        return;
      }
      const url = companyContextId
        ? `/api/external-apis/${id}?companyId=${companyContextId}`
        : `/api/external-apis/${id}?scope=platform`;
      console.log('DASHBOARD_API_CALL', url);
      const response = await fetchWithAuth(url, { method: 'DELETE' });
      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        throw new Error(errorBody?.error || 'Failed to delete API');
      }
      setSuccessMessage('API source deleted.');
      await loadApis();
    } catch (error) {
      console.error('Error deleting API:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Failed to delete API source.');
    }
  };

  const updateRequestStatus = async (id: string, status: 'approved' | 'rejected') => {
    try {
      resetMessages();
      const rejection_reason = status === 'rejected' ? rejectionReasons[id] : undefined;
      const url = companyContextId
        ? `/api/external-apis/requests/${id}?companyId=${companyContextId}`
        : `/api/external-apis/requests/${id}?scope=platform`;
      console.log('DASHBOARD_API_CALL', url);
      const response = await fetchWithAuth(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, rejection_reason }),
      });
      if (!response.ok) throw new Error('Failed to update request');
      setSuccessMessage(`Request ${status}.`);
      await loadRequests();
      if (status === 'approved') {
        await loadApis();
      }
    } catch (error) {
      console.error('Error updating request:', error);
      setErrorMessage('Failed to update request.');
    }
  };

  const submitNewApiRequest = async () => {
    if (!companyContextId) {
      setErrorMessage('Select a company first.');
      return;
    }
    const { name, base_url, purpose, category, method, auth_type, api_key_env_name } = requestForm;
    if (!name?.trim() || !base_url?.trim()) {
      setErrorMessage('Name and Base URL are required.');
      return;
    }
    const requiresKey = ['api_key', 'bearer', 'query', 'header'].includes(auth_type);
    if (requiresKey && !api_key_env_name?.trim()) {
      setErrorMessage('API key env var name is required for the selected auth type.');
      return;
    }
    try {
      resetMessages();
      setIsSubmittingRequest(true);
      const url = `/api/external-apis/requests?companyId=${encodeURIComponent(companyContextId)}`;
      const response = await fetchWithAuth(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: companyContextId,
          name: name.trim(),
          base_url: base_url.trim(),
          purpose: purpose || 'trends',
          category: category?.trim() || null,
          method: method || 'GET',
          auth_type: auth_type || 'none',
          api_key_env_name: api_key_env_name?.trim() || null,
          headers: {},
          query_params: {},
          platform_type: 'social',
          supported_content_types: [],
          promotion_modes: [],
          required_metadata: {},
          posting_constraints: {},
          is_active: true,
          requires_admin: true,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to submit request');
      }
      setSuccessMessage('Request submitted. Super Admin will review and approve or reject.');
      setRequestForm({
        name: '',
        base_url: '',
        purpose: 'trends',
        category: '',
        method: 'GET',
        auth_type: 'none',
        api_key_env_name: '',
        description: '',
      });
      await loadRequests();
      setActiveTab('queue');
    } catch (error) {
      console.error('Error submitting API request:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Failed to submit request.');
    } finally {
      setIsSubmittingRequest(false);
    }
  };

  const testFetch = async () => {
    try {
      resetMessages();
      if (!companyContextId && !isPlatformCatalogMode) {
        setErrorMessage('Select a company before testing an API.');
        return;
      }
      if (!form.base_url?.trim()) {
        setErrorMessage('Base URL is required. Enter a URL or load a preset.');
        return;
      }
      const resolved = resolveEditorPayload();
      if (!resolved.ok) {
        setErrorMessage(resolved.message || 'Invalid headers/query params.');
        return;
      }
      const payload = {
        ...form,
        base_url: form.base_url?.trim(),
        platform_type: form.platform_type || 'social',
        headers: resolved.headers,
        query_params: resolved.queryParams,
        category: form.category || '',
        geo: testGeo || 'US',
      };
      const url = companyContextId
        ? `/api/external-apis/test?companyId=${companyContextId}`
        : '/api/external-apis/test?scope=platform';
      console.log('DASHBOARD_API_CALL', url);
      const response = await fetchWithAuth(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        const msg = data?.error || 'Failed to test API';
        const missing = Array.isArray(data?.missing) ? data.missing : [];
        throw new Error(missing.length > 0 ? `${msg}: ${missing.join(', ')}` : msg);
      }
      setTestResult(data);
      setSuccessMessage('Test fetch completed.');
    } catch (error) {
      console.error('Error fetching trends:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Failed to test API.');
    }
  };

  const validateApi = async (id: string) => {
    try {
      resetMessages();
      const url = companyContextId
        ? `/api/external-apis/${id}/validate?companyId=${companyContextId}`
        : `/api/external-apis/${id}/validate?scope=platform`;
      console.log('DASHBOARD_API_CALL', url);
      const response = await fetchWithAuth(url);
      if (!response.ok) throw new Error('Failed to validate API');
      setSuccessMessage('API validation completed.');
      await loadApis();
    } catch (error) {
      console.error('Error validating API:', error);
      setErrorMessage('Failed to validate API.');
    }
  };

  const testConnectionApi = async (id: string) => {
    try {
      resetMessages();
      setTestConnectionLoadingId(id);
      const params = new URLSearchParams();
      if (companyContextId) params.set('companyId', companyContextId);
      else params.set('scope', 'platform');
      const url = `/api/external-apis/${id}/test-connection?${params.toString()}`;
      const response = await fetchWithAuth(url, { method: 'POST' });
      const data = await response.json();
      setApiTestResults((prev) => ({
        ...prev,
        [id]: { ...data, response: { ok: data.success }, tested_at: new Date().toISOString() },
      }));
      if (data.success) {
        setSuccessMessage(`Connection successful (${data.latency_ms ?? 0}ms)`);
      } else {
        setErrorMessage(data.message || 'Connection failed');
      }
      await loadApis();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Connection test failed');
      setApiTestResults((prev) => ({
        ...prev,
        [id]: { success: false, response: { ok: false }, message: (error as Error)?.message },
      }));
    } finally {
      setTestConnectionLoadingId(null);
    }
  };

  const testExistingApi = async (id: string, scenario?: { category: string; geo: string }) => {
    try {
      resetMessages();
      const params = new URLSearchParams();
      if (companyContextId) params.set('companyId', companyContextId);
      else params.set('scope', 'platform');
      if (scenario?.category) params.set('category', scenario.category);
      if (scenario?.geo) params.set('geo', scenario.geo);
      const url = `/api/external-apis/${id}/test?${params.toString()}`;
      console.log('DASHBOARD_API_CALL', url);
      const response = await fetchWithAuth(url);
      const data = await response.json();
      setTestResult(data);
      setApiTestResults((prev) => ({ ...prev, [id]: data }));
      if (!response.ok) {
        const msg = data?.error || 'Failed to test API';
        const missing = Array.isArray(data?.missing) ? data.missing : [];
        throw new Error(missing.length > 0 ? `${msg}: ${missing.join(', ')}` : msg);
      }
      setSuccessMessage('Test fetch completed.');
      await loadApis();
    } catch (error) {
      console.error('Error testing API:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Failed to test API.');
    }
  };

  const runAllTests = async () => {
    if (!apis.length || !canManageExternalApis) return;
    setTestAllRunning(true);
    setTestAllSummary(null);
    resetMessages();
    let healthy = 0;
    let warning = 0;
    let failed = 0;
    for (const api of apis) {
      try {
        const url = companyContextId
          ? `/api/external-apis/${api.id}/test?companyId=${companyContextId}`
          : `/api/external-apis/${api.id}/test?scope=platform`;
        const response = await fetchWithAuth(url);
        const data = await response.json();
        setApiTestResults((prev) => ({ ...prev, [api.id]: data }));
        const ok = response.ok && data?.response?.ok;
        if (ok) healthy += 1;
        else if (response.ok && !data?.response?.ok) warning += 1;
        else failed += 1;
      } catch {
        setApiTestResults((prev) => ({ ...prev, [api.id]: { response: { ok: false }, error: 'Request failed' } }));
        failed += 1;
      }
    }
    setTestAllSummary({ healthy, warning, failed });
    setLastHealthCheckAt(new Date());
    setTestAllRunning(false);
    setSuccessMessage(`Tests complete: ${healthy} healthy, ${warning} warning, ${failed} failed.`);
    await loadApis();
  };

  const authRequiresKey = (authType?: string | null) =>
    ['api_key', 'bearer', 'query', 'header'].includes(String(authType || 'none'));

  const getHealthBadge = (health?: ApiSource['health']) => {
    if (!health) return { label: 'Health: N/A', className: 'bg-gray-100 text-gray-700' };
    const combined = (health.freshness_score ?? 1) * (health.reliability_score ?? 1);
    if (combined >= 0.75) return { label: 'Health: Good', className: 'bg-green-100 text-green-700' };
    if (combined >= 0.4) return { label: 'Health: Fair', className: 'bg-yellow-100 text-yellow-700' };
    return { label: 'Health: Poor', className: 'bg-red-100 text-red-700' };
  };

  const LATENCY_WARNING_MS = 2000;

  const getHealthStatus = (api: ApiSource, lastTest?: { response?: { ok?: boolean }; latency_ms?: number }): 'healthy' | 'warning' | 'failed' => {
    const missingEnv = authRequiresKey(api.auth_type) && !(api.api_key_env_name || api.api_key_name);
    if (missingEnv) return 'failed';
    if (lastTest) {
      if (lastTest.response?.ok === false) return 'failed';
      if (lastTest.response?.ok === true) {
        if ((lastTest.latency_ms ?? 0) > LATENCY_WARNING_MS) return 'warning';
        return 'healthy';
      }
    }
    const lastStatus = api.health?.last_test_status;
    const lastLatency = api.health?.last_test_latency_ms ?? 0;
    if (lastStatus === 'FAILED') return 'failed';
    if (lastStatus === 'SUCCESS') {
      if (lastLatency > LATENCY_WARNING_MS) return 'warning';
      return 'healthy';
    }
    const fr = api.usage_summary?.failure_rate ?? 0;
    const reqCount = api.usage_summary?.request_count ?? 0;
    const combined = (api.health?.freshness_score ?? 1) * (api.health?.reliability_score ?? 1);
    if (reqCount >= 5 && fr > 0.1) return 'failed';
    if (reqCount >= 5 && fr >= 0.02 && fr <= 0.1) return 'warning';
    if (combined >= 0.75 && (reqCount < 5 || fr < 0.02)) return 'healthy';
    if (combined >= 0.4 || (reqCount < 5 && fr < 0.02)) return 'warning';
    return 'failed';
  };

  const healthCounts = (() => {
    let healthy = 0;
    let warning = 0;
    let failed = 0;
    apis.forEach((api) => {
      const s = getHealthStatus(api, apiTestResults[api.id]);
      if (s === 'healthy') healthy += 1;
      else if (s === 'warning') warning += 1;
      else failed += 1;
    });
    return { healthy, warning, failed };
  })();

  const formatPercent = (value?: number | null) => {
    if (typeof value !== 'number') return '—';
    return `${Math.round(value * 100)}%`;
  };

  const scaleHeight = (value: number, max: number, maxHeight = 60) => {
    if (max <= 0) return 4;
    return Math.max(4, Math.round((value / max) * maxHeight));
  };

  const HealthBadgeLegend = () => (
    <div className="text-[11px] text-gray-500 flex flex-wrap gap-3 items-center">
      <span className="flex items-center gap-1">
        <span className="w-2 h-2 rounded-full bg-green-400" />
        Healthy &lt; 2%
      </span>
      <span className="flex items-center gap-1">
        <span className="w-2 h-2 rounded-full bg-yellow-400" />
        Degraded 2–10%
      </span>
      <span className="flex items-center gap-1">
        <span className="w-2 h-2 rounded-full bg-red-400" />
        Unhealthy &gt; 10%
      </span>
    </div>
  );

  const parseJsonObject = (value: string): Record<string, string> | null => {
    try {
      const parsed = JSON.parse(value || '{}');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  };

  const previewQueryParamsRaw =
    queryMode === 'json' ? parseJsonObject(queryJson) || {} : pairsToRecord(queryPairs);
  const previewHeadersRaw =
    headerMode === 'json' ? parseJsonObject(headerJson) || {} : pairsToRecord(headerPairs);
  const previewQueryParams = { ...previewQueryParamsRaw };
  const apiKeyEnvName = form.api_key_env_name || form.api_key_name;
  if (form.auth_type === 'api_key' && apiKeyEnvName) {
    const hasPlaceholder = Object.values(previewQueryParams).some((value) => value.includes('{{'));
    if (!hasPlaceholder && !previewQueryParams.apiKey) {
      previewQueryParams.apiKey = `{{${apiKeyEnvName}}}`;
    }
  }
  const previewHeadersMerged = buildPreviewHeaders(
    form.auth_type || 'none',
    apiKeyEnvName,
    previewHeadersRaw
  );
  const previewUrl = buildPreviewUrl(form.base_url || '', previewQueryParams);

  /** Classify an API source into one of three categories based on name + base URL patterns. */
  const getApiSection = (api: ApiSource): 'trend' | 'social' | 'community' | 'others' => {
    const name = (api.name || '').toLowerCase();
    const url  = (api.base_url || '').toLowerCase();
    // LLMs, image generation, AI/ML APIs → Others
    if (url.includes('openai.com') || url.includes('anthropic.com') || url.includes('huggingface.co') ||
        url.includes('replicate.com') || url.includes('stability.ai') || url.includes('together.ai') ||
        url.includes('cohere.ai') || url.includes('groq.com') || url.includes('mistral.ai') ||
        url.includes('perplexity.ai') || url.includes('fireworks.ai') ||
        name.includes('openai') || name.includes('gpt') || name.includes('claude') ||
        name.includes('llm') || name.includes('image gen') || name.includes('dall-e') ||
        name.includes('stable diffusion') || name.includes('midjourney') || name.includes('gemini') ||
        name.includes('cohere') || name.includes('mistral') || name.includes('groq')) return 'others';
    // Social platform read APIs
    if (url.includes('twitter.com') || url.includes('api.twitter.com') || name.includes('twitter') || name.includes('x (twitter)')) return 'social';
    if (url.includes('linkedin.com') || name.includes('linkedin')) return 'social';
    if (url.includes('instagram.com') || name.includes('instagram')) return 'social';
    if (url.includes('graph.facebook.com') || url.includes('facebook.com') || name.includes('facebook')) return 'social';
    if (url.includes('tiktok.com') || name.includes('tiktok')) return 'social';
    if (url.includes('api.pinterest.com') || name.includes('pinterest')) return 'social';
    // Community platform APIs
    if (url.includes('reddit.com') || name.includes('reddit')) return 'community';
    if (url.includes('algolia.com') || name.includes('hacker news')) return 'community';
    if (url.includes('stackexchange.com') || url.includes('stackoverflow.com') || name.includes('stack overflow')) return 'community';
    if (url.includes('github.com') || name.includes('github')) return 'community';
    if (url.includes('discord.com') || name.includes('discord')) return 'community';
    if (url.includes('dev.to') || name.includes('dev.to')) return 'community';
    if (url.includes('medium.com') || name.includes('medium')) return 'community';
    // Everything else: trend/news discovery
    return 'trend';
  };

  const API_CATEGORY_TABS = ['trend', 'social', 'community', 'others'] as const;
  const isApiCategoryTab = (API_CATEGORY_TABS as readonly string[]).includes(activeTab);

  if (isCompanyLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <div className="p-6 text-gray-500">
          Loading company context...
        </div>
      </div>
    );
  }

  if (!companyContextId && !isPlatformCatalogMode) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <div className="max-w-5xl mx-auto p-6 space-y-4">
          <h1 className="text-2xl font-bold text-gray-900">External API Sources</h1>
          {companies.length > 0 ? (
            <div className="bg-white rounded-lg shadow p-6">
              <p className="text-sm text-gray-600 mb-4">Select a company to manage external APIs.</p>
              <select
                className="border rounded-lg px-3 py-2 text-sm bg-white cursor-pointer min-w-[240px]"
                value={selectedCompanyId}
                onChange={(e) => setSelectedCompanyId(e.target.value)}
              >
                <option value="">Choose company…</option>
                {companies.map((c) => (
                  <option key={c.company_id} value={c.company_id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="p-6 text-gray-500">
              No companies available. You need access to a company before managing external APIs.
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <Header />
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="bg-white rounded-lg shadow p-6">
          {isPlatformCatalogMode && (
            <div className="mb-3">
              <Link
                href="/super-admin"
                className="inline-flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-800 font-medium"
              >
                ← Back to Super Admin
              </Link>
            </div>
          )}
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-2xl font-bold text-gray-900">External API Sources</h1>
            {isPlatformCatalogMode && (
              <span className="text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-full px-2 py-1">
                Platform Catalog Mode
              </span>
            )}
          </div>
          <p className="text-sm text-gray-600">
            Manage external sources for trend and signal discovery.
          </p>
          <p className="text-xs text-gray-500 mt-1">
            Super admins manage the global catalog. Users should enable access on `/external-apis-access`.
          </p>
          {isPlatformCatalogMode && (
            <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
              <span className="text-gray-600">Company context (optional):</span>
              <select
                className="border rounded-lg px-3 py-2 text-sm"
                value={platformCompanyId}
                onChange={(e) => setPlatformCompanyId(e.target.value)}
              >
                <option value="">Global catalog (no company selected)</option>
                {platformCompanies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
              {isLoadingPlatformCompanies && (
                <span className="text-xs text-gray-500">Loading companies…</span>
              )}
            </div>
          )}
        </div>

        {!isPlatformAdminView && (
          <div className="text-xs text-gray-500">
            Global API sources are managed by Platform Admin.
          </div>
        )}

        {isPlatformCatalogMode && platformAccessDenied && (
          <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg p-3">
            <p className="font-medium">You are not authorized to manage the platform catalog.</p>
            <p className="mt-2 text-red-700">
              Super Admins must sign in at{' '}
              <Link
                href="/super-admin/login"
                className="font-semibold underline hover:text-red-900"
              >
                Super Admin Login
              </Link>{' '}
              first, then return here.
            </p>
          </div>
        )}

        {errorMessage && (
          <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg p-3">
            {errorMessage}
          </div>
        )}
        {successMessage && (
          <div className="bg-green-50 border border-green-200 text-green-800 text-sm rounded-lg p-3">
            {successMessage}
          </div>
        )}

        <div className="bg-white rounded-lg shadow p-2 flex gap-2 text-sm flex-wrap">
          {[
            { id: 'trend',      label: 'Trend APIs',           group: 'api' },
            { id: 'social',     label: 'Social Platform APIs', group: 'api' },
            { id: 'community',  label: 'Community APIs',       group: 'api' },
            { id: 'others',     label: 'Others',               group: 'api' },
            ...(!isPlatformAdminView ? [{ id: 'request-new', label: 'Request New', group: 'mgmt' }] : []),
            { id: 'queue',  label: 'Approval Queue',    group: 'mgmt' },
            { id: 'usage',  label: 'Usage Analytics',   group: 'mgmt' },
          ].map((tab, idx, arr) => {
            const prevGroup = idx > 0 ? arr[idx - 1].group : tab.group;
            const showDivider = idx > 0 && tab.group !== prevGroup;
            return (
              <React.Fragment key={tab.id}>
                {showDivider && <span className="self-stretch w-px bg-gray-200 mx-1" />}
                <button
                  onClick={() => setActiveTab(tab.id as typeof activeTab)}
                  className={`px-4 py-2 rounded-lg ${
                    activeTab === tab.id
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {tab.label}
                </button>
              </React.Fragment>
            );
          })}
        </div>

        {(isApiCategoryTab || activeTab === 'usage') && (
          <div className="bg-white rounded-lg shadow p-3">
            <HealthBadgeLegend />
          </div>
        )}

        {isApiCategoryTab && (
          <div className="bg-white rounded-lg shadow p-6">
          <div className="flex flex-col gap-4 mb-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                {isPlatformAdminView ? 'Global API Catalog' : 'Select Global Presets'}
              </h2>
              <p className="text-xs text-gray-500">
                {isPlatformAdminView
                  ? 'Configure which APIs are visible and active for company admins.'
                  : 'Company admins can select from global presets approved by the platform team.'}
              </p>
            </div>
            <div className="flex flex-wrap gap-3 items-center">
              {isPlatformAdminView ? (
                <>
                  <button
                    onClick={addBlankApi}
                    className="px-3 py-2 bg-gray-100 text-gray-900 rounded-lg text-sm"
                  >
                    Add Blank API
                  </button>
                  <select
                    className="border rounded-lg px-3 py-2 text-sm min-w-[220px] bg-white cursor-pointer"
                    value={selectedCatalogPreset}
                    onChange={(e) => setSelectedCatalogPreset(e.target.value)}
                  >
                    <option value="">
                      {isLoadingPresets
                        ? 'Loading presets…'
                        : presets.length > 0 && presets.filter((p) => !p.id).length === 0
                          ? 'All presets already in catalog'
                          : 'Add preset to catalog'}
                    </option>
                    {presets
                      .filter((preset) => !preset.id)
                      .map((preset) => (
                        <option key={preset.name} value={preset.name} title={preset.description}>
                          {preset.name} — {preset.description ? String(preset.description).slice(0, 40) + (String(preset.description).length > 40 ? '…' : '') : preset.name}
                        </option>
                      ))}
                  </select>
                  <button
                    onClick={() => {
                      const preset =
                        presets.find((item) => item.name === selectedCatalogPreset) ||
                        (selectedPreset && !selectedPreset.id ? selectedPreset : null);
                      if (preset) addPresetToCatalog(preset);
                    }}
                    disabled={!selectedCatalogPreset && !(selectedPreset && !selectedPreset.id)}
                    className="px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Add Preset
                  </button>
                  <select
                    className="border rounded-lg px-3 py-2 text-sm min-w-[220px] bg-white cursor-pointer"
                    value={presets.some((p) => p.name === selectedPreset?.name) ? selectedPreset?.name ?? '' : ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) return;
                      const preset = presets.find((item) => item.name === v);
                      if (preset) applyPreset(preset);
                    }}
                  >
                    <option value="">
                      {isLoadingPresets ? 'Loading…' : presets.length === 0 ? 'No presets loaded' : 'Load preset into editor'}
                    </option>
                    {presets.map((preset) => (
                      <option key={preset.name} value={preset.name} title={preset.description}>
                        {preset.name} — {preset.description ? String(preset.description).slice(0, 40) + (String(preset.description).length > 40 ? '…' : '') : preset.name}
                      </option>
                    ))}
                  </select>
                  {presets.length === 0 && !isLoadingPresets && (
                    <button
                      type="button"
                      onClick={() => loadPresets()}
                      className="text-sm text-indigo-600 hover:text-indigo-800"
                    >
                      Retry load
                    </button>
                  )}
                  {selectedPreset && (
                    <span className="text-xs text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-full px-2 py-1">
                      Loaded: {selectedPreset.name}
                    </span>
                  )}
                </>
              ) : (
                <button
                  onClick={openPresetModal}
                  className="px-3 py-2 bg-indigo-50 text-indigo-700 rounded-lg text-sm border border-indigo-100"
                  disabled={!canManagePresets}
                >
                  Select Global Presets
                </button>
              )}
            </div>
          </div>

          {isPlatformAdminView && (
            <>
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Configure API Source</h2>
              <div className="space-y-6">
            {selectedPreset && (
              <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-4 text-sm text-indigo-900">
                <div className="font-semibold">Preset: {selectedPreset.name}</div>
                <div className="text-xs text-indigo-800 mt-1">{selectedPreset.description}</div>
                {selectedPreset.api_key_env_name && (
                  <div className="text-xs text-indigo-700 mt-2">
                    Requires env var: {selectedPreset.api_key_env_name}
                  </div>
                )}
              </div>
            )}
            <div>
              <h3 className="text-sm font-semibold text-gray-800 mb-2">Basic Info</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <input
                  className="border rounded-lg px-3 py-2 text-sm"
                  placeholder="Name"
                  value={form.name || ''}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                />
                <input
                  className="border rounded-lg px-3 py-2 text-sm"
                  placeholder="Base URL"
                  value={form.base_url || ''}
                  onChange={(e) => setForm((prev) => ({ ...prev, base_url: e.target.value }))}
                />
                <input
                  className="border rounded-lg px-3 py-2 text-sm"
                  placeholder="Category (optional)"
                  value={form.category || ''}
                  onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}
                />
                <select
                  className="border rounded-lg px-3 py-2 text-sm"
                  value={form.purpose}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, purpose: e.target.value }))
                  }
                >
                  <option value="trends">Trends</option>
                  <option value="keywords">Keywords</option>
                  <option value="hashtags">Hashtags</option>
                  <option value="news">News</option>
                  <option value="demographics">Demographics</option>
                </select>
                <select
                  className="border rounded-lg px-3 py-2 text-sm"
                  value={form.method || 'GET'}
                  onChange={(e) => setForm((prev) => ({ ...prev, method: e.target.value }))}
                >
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                </select>
                <div className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={!!form.is_active}
                    onChange={(e) => setForm((prev) => ({ ...prev, is_active: e.target.checked }))}
                  />
                  Active
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-gray-800 mb-2">Auth</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <select
                  className="border rounded-lg px-3 py-2 text-sm"
                  value={form.auth_type || 'none'}
                  onChange={(e) => setForm((prev) => ({ ...prev, auth_type: e.target.value }))}
                >
                  <option value="none">No Auth</option>
                  <option value="api_key">API Key</option>
                  <option value="bearer">Bearer Token</option>
                  <option value="oauth">OAuth (future)</option>
                </select>
                <input
                  className="border rounded-lg px-3 py-2 text-sm"
                  placeholder="API Key Env Var Name (ex: YOUTUBE_API_KEY)"
                  type="password"
                  value={form.api_key_env_name || form.api_key_name || ''}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, api_key_env_name: e.target.value }))
                  }
                />
              </div>
              <p className="mt-2 text-xs text-gray-500">
                API secrets are never stored. Provide only the environment variable name.
              </p>
              {(form.api_key_env_name || form.api_key_name) && (
                <p className="mt-1 text-xs text-gray-600">
                  Requires env var: {form.api_key_env_name || form.api_key_name}
                </p>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-gray-800">Query Params</h3>
                <div className="flex gap-2 text-xs">
                  <button
                    onClick={() => setQueryMode('pairs')}
                    className={`px-2 py-1 rounded ${queryMode === 'pairs' ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'}`}
                  >
                    Key-Value
                  </button>
                  <button
                    onClick={() => setQueryMode('json')}
                    className={`px-2 py-1 rounded ${queryMode === 'json' ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'}`}
                  >
                    JSON
                  </button>
                </div>
              </div>
              <p className="text-xs text-gray-500 mb-2">
                Defaults for all users. Users can override these in their access settings.
              </p>
              {queryMode === 'pairs' ? (
                <div className="space-y-2">
                  {queryPairs.map((pair, index) => (
                    <div key={`${pair.key}-${index}`} className="grid grid-cols-1 md:grid-cols-5 gap-2">
                      <input
                        className="border rounded-lg px-3 py-2 text-sm md:col-span-2"
                        placeholder="key"
                        value={pair.key}
                        onChange={(e) => {
                          const next = [...queryPairs];
                          next[index] = { ...next[index], key: e.target.value };
                          setQueryPairs(next);
                        }}
                      />
                      <input
                        className="border rounded-lg px-3 py-2 text-sm md:col-span-2"
                        placeholder="value (supports {{ENV_NAME}})"
                        value={pair.value}
                        onChange={(e) => {
                          const next = [...queryPairs];
                          next[index] = { ...next[index], value: e.target.value };
                          setQueryPairs(next);
                        }}
                      />
                      <div className="flex items-center gap-2">
                        <button
                          className="text-xs text-red-600"
                          onClick={() => setQueryPairs(queryPairs.filter((_, idx) => idx !== index))}
                          disabled={queryPairs.length <= 1}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                  <button
                    className="text-xs text-indigo-600"
                    onClick={() => setQueryPairs([...queryPairs, { key: '', value: '' }])}
                  >
                    Add param
                  </button>
                </div>
              ) : (
                <textarea
                  className="border rounded-lg px-3 py-2 text-sm w-full h-32"
                  value={queryJson}
                  onChange={(e) => setQueryJson(e.target.value)}
                />
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-gray-800">Headers</h3>
                <div className="flex gap-2 text-xs">
                  <button
                    onClick={() => setHeaderMode('pairs')}
                    className={`px-2 py-1 rounded ${headerMode === 'pairs' ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'}`}
                  >
                    Key-Value
                  </button>
                  <button
                    onClick={() => setHeaderMode('json')}
                    className={`px-2 py-1 rounded ${headerMode === 'json' ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'}`}
                  >
                    JSON
                  </button>
                </div>
              </div>
              <p className="text-xs text-gray-500 mb-2">
                Defaults for all users. Users can override these in their access settings.
              </p>
              {headerMode === 'pairs' ? (
                <div className="space-y-2">
                  {headerPairs.map((pair, index) => (
                    <div key={`${pair.key}-${index}`} className="grid grid-cols-1 md:grid-cols-5 gap-2">
                      <input
                        className="border rounded-lg px-3 py-2 text-sm md:col-span-2"
                        placeholder="Header"
                        value={pair.key}
                        onChange={(e) => {
                          const next = [...headerPairs];
                          next[index] = { ...next[index], key: e.target.value };
                          setHeaderPairs(next);
                        }}
                      />
                      <input
                        className="border rounded-lg px-3 py-2 text-sm md:col-span-2"
                        placeholder="Value (supports {{ENV_NAME}})"
                        value={pair.value}
                        onChange={(e) => {
                          const next = [...headerPairs];
                          next[index] = { ...next[index], value: e.target.value };
                          setHeaderPairs(next);
                        }}
                      />
                      <div className="flex items-center gap-2">
                        <button
                          className="text-xs text-red-600"
                          onClick={() => setHeaderPairs(headerPairs.filter((_, idx) => idx !== index))}
                          disabled={headerPairs.length <= 1}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                  <button
                    className="text-xs text-indigo-600"
                    onClick={() => setHeaderPairs([...headerPairs, { key: '', value: '' }])}
                  >
                    Add header
                  </button>
                </div>
              ) : (
                <textarea
                  className="border rounded-lg px-3 py-2 text-sm w-full h-32"
                  value={headerJson}
                  onChange={(e) => setHeaderJson(e.target.value)}
                />
              )}
            </div>

            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-xs text-gray-700">
              <div className="font-semibold text-gray-800 mb-2">Sample Request Preview</div>
              <div className="space-y-1">
                <div>
                  <span className="font-semibold">Method:</span> {form.method || 'GET'}
                </div>
                <div>
                  <span className="font-semibold">URL:</span> {previewUrl || form.base_url || '—'}
                </div>
                <div>
                  <span className="font-semibold">Headers:</span>
                  <pre className="mt-1 bg-white rounded p-2 overflow-auto">
                    {JSON.stringify(previewHeadersMerged, null, 2)}
                  </pre>
                </div>
              </div>
            </div>

            {showRunTestAndActions && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-amber-900 mb-2">Test Parameters (Super Admin)</h3>
                <p className="text-xs text-amber-800 mb-3">
                  Choose a scenario or edit category/geo before Test Fetch.
                </p>
                <div className="flex flex-wrap gap-2 mb-3">
                  {TEST_SCENARIOS.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        setSelectedTestScenario(s.id);
                        setForm((prev) => ({ ...prev, category: s.category }));
                        setTestGeo(s.geo);
                      }}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                        selectedTestScenario === s.id
                          ? 'bg-amber-600 text-white'
                          : 'bg-white border border-amber-300 text-amber-800 hover:bg-amber-100'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-amber-900 mb-1">Category (editable)</label>
                    <input
                      className="w-full border border-amber-200 rounded-lg px-3 py-2 text-sm"
                      placeholder="e.g. trends, AI technology"
                      value={form.category || ''}
                      onChange={(e) => {
                        setForm((prev) => ({ ...prev, category: e.target.value }));
                        setSelectedTestScenario(null);
                      }}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-amber-900 mb-1">Geo (editable)</label>
                    <input
                      className="w-full border border-amber-200 rounded-lg px-3 py-2 text-sm"
                      placeholder="e.g. US, GB"
                      value={testGeo}
                      onChange={(e) => setTestGeo(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-3">
              <button
                onClick={saveApi}
                disabled={isSaving || isSavingPreset || !isPlatformAdminView}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm disabled:opacity-50"
              >
                {isSaving ? 'Saving...' : editingId ? 'Update API' : 'Add API'}
              </button>
              <button
                onClick={savePreset}
                disabled={isSaving || isSavingPreset || !isPlatformAdminView}
                className="px-4 py-2 bg-indigo-50 text-indigo-700 rounded-lg text-sm disabled:opacity-50 border border-indigo-100"
              >
                {isSavingPreset ? 'Saving Preset...' : editingPresetId ? 'Update Preset' : 'Save Preset'}
              </button>
              <button
                onClick={testFetch}
                className="px-4 py-2 bg-gray-100 text-gray-900 rounded-lg text-sm"
              >
                Test Fetch
              </button>
            </div>

            {testResult && (
              <div className="bg-white border rounded-lg p-4 text-sm">
                <div className="font-semibold text-gray-900 mb-2">Test Result</div>
                <pre className="text-xs text-gray-700 bg-gray-50 rounded p-3 overflow-auto">
                  {JSON.stringify(testResult, null, 2)}
                </pre>
              </div>
            )}
          </div>
            </>
          )}
        </div>
        )}

        {isApiCategoryTab && (() => {
          const TAB_META: Record<string, { label: string; description: string }> = {
            trend:     { label: 'Trend APIs',           description: 'News, search engines and trend discovery — YouTube, NewsAPI, SerpAPI, GDELT, Google Trends.' },
            social:    { label: 'Social Platform APIs', description: 'Read-only social media data APIs for signal discovery. OAuth posting connections are managed in Social Platforms.' },
            community: { label: 'Community APIs',       description: 'Developer & interest community signal sources — Reddit, Hacker News, Stack Overflow, GitHub.' },
            others:    { label: 'Others',               description: 'LLM providers, image generation, and other AI/ML APIs used across the platform.' },
          };
          const tabMeta = TAB_META[activeTab as string];
          const filteredApis = apis.filter((a) => getApiSection(a) === activeTab);

          const renderApiRow = (api: ApiSource) => {
            const testData = apiTestResults[api.id];
            const missingEnv = authRequiresKey(api.auth_type) && !(api.api_key_env_name || api.api_key_name);
            const isGlobalCatalog = isPlatformCatalogMode && !api.company_id;
            const status = getHealthStatus(api, apiTestResults[api.id]);
            const expanded = expandedCardIds.has(api.id);
            const limits = api.company_limits;
            const today = api.usage_today;
            const dailyExceeded = limits?.daily_limit != null && (today?.request_count ?? 0) >= limits.daily_limit;
            const signalExceeded = limits?.signal_limit != null && (today?.signals_generated ?? 0) >= limits.signal_limit;
            const limitExceeded = dailyExceeded || signalExceeded;
            const errorClass = classifyApiError(api.usage_summary?.last_error_code, api.usage_summary?.last_error_message);
            const meta = API_META[api.name] || { icon: '🌐', color: '' };
            const isTestingThis = testConnectionLoadingId === api.id;
            const statusDotColor = status === 'healthy' ? 'bg-green-500' : status === 'warning' ? 'bg-amber-500' : 'bg-red-500';

            return (
              <div key={api.id} className="px-6 py-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xl shrink-0">{meta.icon}</span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-gray-900 text-sm">{api.name}</span>
                        {api.is_active ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <span className={`w-1.5 h-1.5 rounded-full ${statusDotColor}`} /> Enabled
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500 border border-gray-200">
                            Disabled
                          </span>
                        )}
                        {isPlatformCatalogMode && isPlatformAdminView && isGlobalCatalog && (
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${api.is_preset ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' : 'bg-gray-100 text-gray-500 border border-gray-200'}`}>
                            {api.is_preset ? 'Visible to companies' : 'Hidden'}
                          </span>
                        )}
                        {errorClass === 'api_key' && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200" title={api.usage_summary?.last_error_message || ''}>API key issue</span>}
                        {errorClass === 'quota' && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">Quota exceeded</span>}
                        {errorClass === 'rate_limit' && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">Rate limited</span>}
                        {limitExceeded && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200">Limit exceeded</span>}
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5 font-mono truncate">{api.base_url}</div>
                      <div className="text-xs text-gray-400">{api.method || 'GET'} · {api.auth_type || 'none'}{api.api_key_env_name ? ` · env: ${api.api_key_env_name}` : ''}</div>
                      {missingEnv && <div className="text-xs text-red-500 mt-0.5">⚠ Missing env var for auth</div>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                    {testData && (testData.tested_at || testData.response) && (
                      testData.response?.ok
                        ? <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-emerald-50 border border-emerald-200 text-emerald-700">✓ Live · OK</span>
                        : <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-red-50 border border-red-200 text-red-700" title={`${testData.response?.status || ''} ${testData.response?.statusText || ''}`}>✗ Test failed</span>
                    )}
                    {showRunTestAndActions && (
                      <button type="button" onClick={() => testConnectionApi(api.id)} disabled={isTestingThis} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-500 text-xs font-medium hover:bg-gray-50 transition-colors disabled:opacity-50">
                        {isTestingThis ? '…' : '⚡'} {isTestingThis ? 'Testing…' : 'Test'}
                      </button>
                    )}
                    {canManageExternalApis && (
                      <button type="button" onClick={() => updateApi({ ...api, is_active: !api.is_active })} className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${api.is_active ? 'border-gray-200 bg-white text-gray-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200' : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}>
                        {api.is_active ? 'Disable' : 'Enable'}
                      </button>
                    )}
                    {isPlatformCatalogMode && isPlatformAdminView && !api.company_id && canManageExternalApis && (
                      <button type="button" onClick={() => updateApi({ ...api, is_preset: !api.is_preset })} className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${api.is_preset ? 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100' : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'}`}>
                        {api.is_preset ? 'Visible' : 'Show'}
                      </button>
                    )}
                    {canManageExternalApis && (
                      <button type="button" onClick={() => { setExpandedCardIds((prev) => { const next = new Set(prev); if (next.has(api.id)) { next.delete(api.id); setEditingId(null); setForm(emptyForm); } else { startEdit(api); next.add(api.id); } return next; }); }} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-500 text-xs font-medium hover:bg-gray-50 transition-colors">
                        {expanded ? 'Close' : 'Configure'}
                      </button>
                    )}
                    {canManageExternalApis && (
                      <button type="button" onClick={() => { if (confirm(`Delete ${api.name}?`)) deleteApi(api.id); }} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-red-100 text-red-500 text-xs font-medium hover:bg-red-50 transition-colors">
                        Delete
                      </button>
                    )}
                  </div>
                </div>
                {(api.usage_summary || api.enabled_user_count != null) && (
                  <div className="mt-1 ml-9 text-xs text-gray-400">
                    {api.enabled_user_count != null && `${api.enabled_user_count} users · `}
                    Failure rate: {formatPercent(api.usage_summary?.failure_rate)}
                    {api.usage_summary?.last_error_message && <span className="text-red-400"> · Last error: {api.usage_summary.last_error_message}</span>}
                  </div>
                )}
                {expanded && (
                  <div className="mt-3 ml-9 pt-3 border-t border-gray-100 space-y-3 max-w-lg">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        API Key Env Var Name
                        <span className="ml-1 font-normal text-gray-400">— set in .env, referenced by name only</span>
                      </label>
                      <input
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                        placeholder={`e.g. ${api.api_key_env_name || 'YOUTUBE_API_KEY'}`}
                        value={form.api_key_env_name || ''}
                        onChange={(e) => setForm((p) => ({ ...p, api_key_env_name: e.target.value }))}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <input type="checkbox" id={`active-${api.id}`} checked={!!form.is_active} onChange={(e) => setForm((p) => ({ ...p, is_active: e.target.checked }))} className="rounded border-gray-300" />
                      <label htmlFor={`active-${api.id}`} className="text-xs text-gray-700">Active (enabled for use)</label>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex gap-2">
                        <button type="button" onClick={() => { setExpandedCardIds((prev) => { const n = new Set(prev); n.delete(api.id); return n; }); setEditingId(null); setForm(emptyForm); }} className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 text-sm hover:bg-gray-50">Cancel</button>
                        <button type="button" onClick={saveApi} disabled={isSaving} className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">{isSaving ? 'Saving…' : 'Save'}</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          };

          return (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200">
              <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 rounded-t-lg flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">{tabMeta?.label ?? 'APIs'}</h3>
                  <p className="text-sm text-gray-500 mt-0.5">{tabMeta?.description}</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  {isPlatformAdminView && (
                    <>
                      <button type="button" onClick={addBlankApi} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-gray-700 text-sm hover:bg-gray-50 transition-colors">
                        + Add Blank
                      </button>
                      <select className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white min-w-[160px]" value={selectedCatalogPreset} onChange={(e) => setSelectedCatalogPreset(e.target.value)}>
                        <option value="">{isLoadingPresets ? 'Loading…' : 'Add from preset…'}</option>
                        {presets.filter((p) => !p.id).map((p) => (
                          <option key={p.name} value={p.name}>{p.name}</option>
                        ))}
                      </select>
                      {selectedCatalogPreset && (
                        <button type="button" onClick={() => { const p = presets.find((x) => x.name === selectedCatalogPreset); if (p) addPresetToCatalog(p); }} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm hover:bg-indigo-700 transition-colors">
                          Add
                        </button>
                      )}
                    </>
                  )}
                  {showRunTestAndActions && (
                    <button type="button" onClick={runAllTests} disabled={testAllRunning || filteredApis.length === 0} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                      {testAllRunning ? 'Running…' : '⚡ Test All'}
                    </button>
                  )}
                </div>
              </div>
              <div className="px-6 py-2.5 border-b border-gray-100 flex items-center justify-between text-xs text-gray-500 bg-gray-50/50">
                <span>
                  <strong className="text-green-600">{healthCounts.healthy} healthy</strong>
                  {' · '}
                  <strong className="text-amber-500">{healthCounts.warning} warning</strong>
                  {' · '}
                  <strong className="text-red-500">{healthCounts.failed} failed</strong>
                </span>
                <span>Last check: {lastHealthCheckAt ? (() => { const m = Math.floor((Date.now() - lastHealthCheckAt.getTime()) / 60000); return m < 1 ? 'just now' : `${m}m ago`; })() : '—'}</span>
              </div>
              {testAllSummary && (
                <div className="px-6 py-2.5 border-b border-gray-100 text-sm text-gray-700 bg-blue-50">
                  Test run complete — {testAllSummary.healthy} healthy · {testAllSummary.warning} warning · {testAllSummary.failed} failed
                </div>
              )}
              {healthCounts.failed > 0 && (
                <div className="px-6 py-2.5 border-b border-gray-100 text-sm text-red-700 bg-red-50">
                  ⚠ {healthCounts.failed} integration{healthCounts.failed > 1 ? 's' : ''} failing — campaign execution may be impacted.
                </div>
              )}
              {isLoading ? (
                <div className="px-6 py-8 text-sm text-gray-400">Loading…</div>
              ) : filteredApis.length === 0 ? (
                <div className="px-6 py-8 text-sm text-gray-400">
                  <p>No {tabMeta?.label ?? 'APIs'} configured yet.</p>
                  {isPlatformAdminView && <p className="text-xs mt-1 text-gray-400">Use "Add from preset…" or "+ Add Blank" above to add APIs to this category.</p>}
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {filteredApis.map(renderApiRow)}
                </div>
              )}
            </div>
          );
        })()}

        {activeTab === 'request-new' && (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Request New APIs</h2>
            <p className="text-sm text-gray-600 mb-4">
              Submit a request for a new external API to be added. Super Admin will review and approve or reject.
              Payment and commercial terms for the requested API are the responsibility of your company.
            </p>
            <div className="space-y-4 max-w-2xl">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                <input
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  placeholder="e.g. Twitter Trends API"
                  value={requestForm.name}
                  onChange={(e) => setRequestForm((p) => ({ ...p, name: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Base URL *</label>
                <input
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  placeholder="https://api.example.com/v1/trends"
                  value={requestForm.base_url}
                  onChange={(e) => setRequestForm((p) => ({ ...p, base_url: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Purpose</label>
                  <select
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    value={requestForm.purpose}
                    onChange={(e) => setRequestForm((p) => ({ ...p, purpose: e.target.value }))}
                  >
                    <option value="trends">Trends</option>
                    <option value="keywords">Keywords</option>
                    <option value="hashtags">Hashtags</option>
                    <option value="news">News</option>
                    <option value="demographics">Demographics</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Category (optional)</label>
                  <input
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    placeholder="e.g. social, analytics"
                    value={requestForm.category}
                    onChange={(e) => setRequestForm((p) => ({ ...p, category: e.target.value }))}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Method</label>
                  <select
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    value={requestForm.method}
                    onChange={(e) => setRequestForm((p) => ({ ...p, method: e.target.value as 'GET' | 'POST' }))}
                  >
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Auth type</label>
                  <select
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    value={requestForm.auth_type}
                    onChange={(e) => setRequestForm((p) => ({ ...p, auth_type: e.target.value }))}
                  >
                    <option value="none">None</option>
                    <option value="api_key">API Key</option>
                    <option value="bearer">Bearer</option>
                    <option value="query">Query param</option>
                    <option value="header">Header</option>
                  </select>
                </div>
              </div>
              {['api_key', 'bearer', 'query', 'header'].includes(requestForm.auth_type) && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">API key env var name *</label>
                  <input
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    placeholder="e.g. TWITTER_API_KEY"
                    value={requestForm.api_key_env_name}
                    onChange={(e) => setRequestForm((p) => ({ ...p, api_key_env_name: e.target.value }))}
                  />
                  <p className="text-xs text-gray-500 mt-1">Server-side env var name; key value is not stored.</p>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description / notes (optional)</label>
                <textarea
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm min-h-[80px]"
                  placeholder="Why your company needs this API, use case, etc."
                  value={requestForm.description}
                  onChange={(e) => setRequestForm((p) => ({ ...p, description: e.target.value }))}
                />
              </div>
              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={submitNewApiRequest}
                  disabled={isSubmittingRequest}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmittingRequest ? 'Submitting…' : 'Submit for approval'}
                </button>
                <span className="text-xs text-gray-500">
                  Request will appear in Approval Queue for Super Admin.
                </span>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'queue' && (
          <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">API Requests</h2>
          {isLoadingRequests ? (
            <div className="text-sm text-gray-500">Loading requests...</div>
          ) : (
            <div className="space-y-3">
              {requests.map((request) => (
                <div key={request.id} className="border rounded-lg p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-gray-900">{request.name}</div>
                      <div className="text-xs text-gray-500">{request.base_url}</div>
                      <div className="text-xs text-gray-400">
                        Status:{' '}
                        <span
                          className={`px-2 py-0.5 rounded-full text-[11px] ${
                            request.status === 'approved'
                              ? 'bg-green-100 text-green-700'
                              : request.status === 'rejected'
                              ? 'bg-red-100 text-red-700'
                              : 'bg-yellow-100 text-yellow-700'
                          }`}
                          title={request.status === 'approved' ? 'Approved' : request.status === 'rejected' ? 'Rejected' : 'Pending review'}
                        >
                          {request.status}
                        </span>{' '}
                        • {new Date(request.created_at).toLocaleDateString()}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {request.purpose ? `Purpose: ${request.purpose}` : 'Purpose: —'} •{' '}
                        {request.category ? `Category: ${request.category}` : 'Category: —'} •{' '}
                        {request.auth_type ? `Auth: ${request.auth_type}` : 'Auth: —'}
                      </div>
                      <div className="text-xs text-gray-500">
                        {request.api_key_env_name
                          ? `Env var: ${request.api_key_env_name}`
                          : 'Env var: —'}{' '}
                        • {request.created_by_user_id ? `User: ${request.created_by_user_id}` : 'User: —'}
                      </div>
                      {request.status === 'rejected' && request.rejection_reason && (
                        <div className="text-xs text-red-600 mt-1">
                          Rejection reason: {request.rejection_reason}
                        </div>
                      )}
                    </div>
                    {request.status === 'pending' && (
                      <div className="flex items-center gap-2">
                        <input
                          className="border rounded px-2 py-1 text-xs"
                          placeholder="Rejection reason"
                          value={rejectionReasons[request.id] || ''}
                          onChange={(e) =>
                            setRejectionReasons((prev) => ({
                              ...prev,
                              [request.id]: e.target.value,
                            }))
                          }
                        />
                        <button
                          onClick={() => updateRequestStatus(request.id, 'approved')}
                          disabled={!isSuperAdmin}
                          className="text-xs text-green-700 disabled:opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => updateRequestStatus(request.id, 'rejected')}
                          disabled={!isSuperAdmin}
                          className="text-xs text-red-600 disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {requests.length === 0 && (
                <div className="text-sm text-gray-500">No API requests yet.</div>
              )}
            </div>
          )}
        </div>
        )}

        {activeTab === 'usage' && (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Usage Analytics</h2>
            <div className="space-y-4">
              {apis.map((api) => {
                const summary = api.usage_summary;
                return (
                  <div key={api.id} className="border rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-semibold text-gray-900">{api.name}</div>
                        <div className="text-xs text-gray-500">{api.base_url}</div>
                      </div>
                      <div className="text-xs text-gray-500">
                        Enabled users: {api.enabled_user_count ?? 0}
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
                      <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                        <div className="text-gray-500">Requests (14d)</div>
                        <div className="text-lg font-semibold text-gray-900">
                          {summary?.request_count ?? 0}
                        </div>
                      </div>
                      <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                        <div className="text-gray-500">Failure rate</div>
                        <div className="text-lg font-semibold text-gray-900">
                          <span
                            title="Healthy < 2%, Degraded 2–10%, Unhealthy > 10%"
                          >
                            {formatPercent(summary?.failure_rate)}
                          </span>
                        </div>
                      </div>
                      <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                        <div className="text-gray-500">Successes</div>
                        <div className="text-lg font-semibold text-gray-900">
                          {summary?.success_count ?? 0}
                        </div>
                      </div>
                      <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                        <div className="text-gray-500">Failures</div>
                        <div className="text-lg font-semibold text-gray-900">
                          {summary?.failure_count ?? 0}
                        </div>
                      </div>
                    </div>
                    {(api.usage_by_company || []).length > 0 && (
                      <div className="mt-3 text-xs text-gray-700">
                        <div className="text-gray-500 mb-1">Usage by company</div>
                        <div className="space-y-2">
                          {api.usage_by_company?.map((entry) => (
                            <div key={entry.company_id} className="bg-gray-50 border rounded p-2">
                              <div className="font-semibold text-gray-800">
                                {entry.company_id} — {entry.request_count} calls
                              </div>
                              {(entry.by_feature || []).length > 0 && (
                                <div className="text-[11px] text-gray-600 mt-1">
                                  By feature:{' '}
                                  {entry.by_feature
                                    ?.map((feature) => `${feature.feature}: ${feature.request_count}`)
                                    .join(' • ')}
                                </div>
                              )}
                              {(entry.by_user || []).length > 0 && (
                                <div className="text-[11px] text-gray-600 mt-1">
                                  By user:{' '}
                                  {entry.by_user
                                    ?.map((user) => `${user.user_id}: ${user.request_count}`)
                                    .join(' • ')}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="mt-2 text-xs">
                      {summary?.last_success_at && (
                        <span className="text-green-700 mr-3">
                          Last success: {new Date(summary.last_success_at).toLocaleDateString()}
                        </span>
                      )}
                      {summary?.last_failure_at && (
                        <span className="text-red-600 mr-3">
                          Last failure: {new Date(summary.last_failure_at).toLocaleDateString()}
                        </span>
                      )}
                      {(summary?.last_error_message || summary?.last_error_code) && (
                        <span className="text-red-600">
                          Last error:{' '}
                          {summary?.last_error_code ? `[${summary.last_error_code}] ` : ''}
                          {summary?.last_error_message || '—'}
                        </span>
                      )}
                    </div>
                    <div className="mt-4">
                      <div className="text-xs text-gray-500 mb-2 flex items-center justify-between">
                        <span>Daily usage (14d)</span>
                        <div className="flex items-center gap-3 text-[10px] text-gray-500">
                          <span className="flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-blue-400" />
                            Requests
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-red-400" />
                            Failures
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-green-400" />
                            Success rate
                          </span>
                        </div>
                      </div>
                      <div className="text-[10px] text-gray-400 mb-2">
                        Requests per day (last 14 days)
                      </div>
                      <div className="grid grid-cols-7 gap-2 text-[10px] text-gray-500">
                        {(api.usage_daily || []).map((day) => {
                          const total = day.request_count || 0;
                          const failures = day.failure_count || 0;
                          const max = Math.max(
                            1,
                            ...(api.usage_daily || []).map((row) => row.request_count || 0)
                          );
                          const height = scaleHeight(total, max);
                          const failureHeight = scaleHeight(failures, max);
                          return (
                            <div key={day.usage_date} className="flex flex-col items-center gap-1">
                              <div className="flex items-end gap-1 h-[64px]">
                                <div
                                  className="w-3 bg-blue-200 rounded"
                                  style={{ height }}
                                  title={`Requests: ${total}`}
                                />
                                <div
                                  className="w-2 bg-red-200 rounded"
                                  style={{ height: failureHeight }}
                                  title={`Failures: ${failures}`}
                                />
                              </div>
                              <span>{String(day.usage_date).slice(5)}</span>
                            </div>
                          );
                        })}
                        {(!api.usage_daily || api.usage_daily.length === 0) && (
                          <div className="text-xs text-gray-500">No usage data yet.</div>
                        )}
                      </div>
                      {summary && summary.request_count > 0 && (
                        <div className="mt-3">
                          <div className="text-[10px] text-gray-500 mb-1">
                            Success rate {formatPercent(summary.success_count / summary.request_count)}
                          </div>
                          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-green-400"
                              style={{
                                width: `${Math.min(
                                  100,
                                  Math.round((summary.success_count / summary.request_count) * 100)
                                )}%`,
                              }}
                              title={`Success rate ${formatPercent(
                                summary.success_count / summary.request_count
                              )}`}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {apis.length === 0 && (
                <div className="text-sm text-gray-500">No APIs available.</div>
              )}
            </div>
          </div>
        )}
      </div>

      {showPresetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-3xl rounded-lg bg-white p-6 shadow-lg">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Select Global Presets</h3>
                <p className="text-xs text-gray-500">
                  Choose which global APIs this company can use. You can select none.
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Selected APIs will be available to your company's users.
                </p>
                {!canManagePresets && (
                  <p className="text-xs text-gray-500 mt-1">
                    Configured by company admin.
                  </p>
                )}
              </div>
              <button
                onClick={() => setShowPresetModal(false)}
                className="text-sm text-gray-600"
              >
                Close
              </button>
            </div>
              <div className="max-h-[60vh] overflow-auto space-y-2">
                {isLoadingPresets && (
                  <div className="text-sm text-gray-500">Loading presets...</div>
                )}
                {!isLoadingPresets && presets.length === 0 && (
                  <div className="text-sm text-gray-500">No presets available.</div>
                )}
                {!isLoadingPresets && presets.map((preset) => {
                const disabled = !preset.id;
                const checked = preset.id ? presetSelection.has(preset.id) : false;
                return (
                  <label
                    key={`${preset.name}-${preset.id || 'inline'}`}
                    className={`flex items-start gap-3 rounded-lg border p-3 text-sm ${
                      disabled ? 'bg-gray-50 text-gray-400' : 'bg-white text-gray-800'
                    }`}
                  >
                    <input
                      type="checkbox"
                      disabled={disabled || !canManageExternalApis}
                      checked={checked}
                      onChange={(e) => {
                        if (preset.id && canManageExternalApis) {
                          togglePresetSelection(preset.id, e.target.checked);
                        }
                      }}
                      className="mt-1"
                    />
                    <div>
                      <div className="font-semibold">{preset.name}</div>
                      <div className="text-xs text-gray-500">{preset.description}</div>
                      {!preset.id && (
                        <div className="text-xs text-gray-400 mt-1">
                          Ask a super admin to add this preset to the global catalog.
                        </div>
                      )}
                    </div>
                  </label>
                );
                })}
            </div>
            <div className="flex items-center justify-end gap-3 mt-4">
              <button
                onClick={() => setShowPresetModal(false)}
                className="px-4 py-2 text-sm text-gray-600"
              >
                Cancel
              </button>
              <button
                onClick={savePresetSelection}
                disabled={isSavingPresetSelection || !canManageExternalApis}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm disabled:opacity-50"
              >
                {isSavingPresetSelection ? 'Saving...' : 'Save Selection'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
