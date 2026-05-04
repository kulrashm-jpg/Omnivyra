import React, { useEffect, useMemo, useState } from 'react';
import { useCompanyContext } from '../components/CompanyContext';
import { getAuthToken } from '../utils/getAuthToken';
import { apiFetch } from '@/lib/apiFetch';
import { classifyApiError } from '../pages/external-apis.types';

type ApiSource = {
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
  usage_company?: {
    total_calls: number;
    success_count: number;
    failure_count: number;
  } | null;
  company_limits?: { daily_limit: number | null; signal_limit: number | null } | null;
  usage_today?: { request_count: number; signals_generated: number };
  usage_by_feature?: Array<{
    feature: string;
    request_count: number;
    success_count: number;
    failure_count: number;
  }>;
  usage_by_user?: Array<{
    user_id: string;
    request_count: number;
    success_count: number;
    failure_count: number;
  }>;
};

type UserAccess = {
  api_source_id: string;
  is_enabled: boolean;
  api_key_env_name?: string | null;
  headers_override?: Record<string, any> | null;
  query_params_override?: Record<string, any> | null;
  rate_limit_per_min?: number | null;
};

type UsageSummary = {
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

type UsageDaily = {
  usage_date: string;
  request_count: number;
  success_count: number;
  failure_count: number;
};

type AccessDraft = {
  is_enabled: boolean;
  api_key_env_name: string;
  headers_override_json: string;
  query_params_override_json: string;
  rate_limit_per_min: string;
  error?: string | null;
  saving?: boolean;
};

type ApiRequest = {
  id: string;
  name: string;
  base_url: string;
  status: string;
  created_at: string;
  rejection_reason?: string | null;
  company_id?: string | null;
};

const PURPOSE_OPTIONS = [
  'trend_campaign_detection',
  'market_pulse_signals',
  'competitor_intelligence',
  'market_news',
  'influencer_signals',
  'technology_signals',
  'keyword_intelligence',
] as const;

const POLLING_OPTIONS = ['realtime', '2h', '6h', 'daily', 'weekly'] as const;
const PRIORITY_OPTIONS = ['HIGH', 'MEDIUM', 'LOW'] as const;

const emptyRequestForm = {
  name: '',
  base_url: '',
  purpose: 'trends',
  category: '',
  provider: '',
  connection_type: 'REST',
  documentation_url: '',
  sample_response: '',
  method: 'GET',
  auth_type: 'none',
  api_key_env_name: '',
  headers_json: '{}',
  query_params_json: '{}',
};

type TabId = 'presets' | 'request' | 'approval' | 'usage';

const FILTER_FIELD_KEYS = [
  'keywords',
  'topics',
  'competitors',
  'industries',
  'companies',
  'influencers',
  'technologies',
  'geography',
] as const;

type CompanyConfigState = {
  purposes: string[];
  include_filters: Record<string, string[]>;
  exclude_filters: Record<string, string[]>;
  polling_frequency: string;
  daily_limit: string;
  signal_limit: string;
  priority: string;
  saving: boolean;
  error: string | null;
};

function emptyFilterRecord(): Record<string, string[]> {
  return FILTER_FIELD_KEYS.reduce<Record<string, string[]>>((acc, k) => {
    acc[k] = [];
    return acc;
  }, {});
}

function filtersFromPayload(obj: unknown): Record<string, string[]> {
  const out = emptyFilterRecord();
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
  const rec = obj as Record<string, unknown>;
  for (const key of FILTER_FIELD_KEYS) {
    const val = rec[key];
    if (Array.isArray(val)) {
      out[key] = val.map((v) => String(v).trim()).filter(Boolean);
    }
  }
  return out;
}

const parseJsonObject = (value: string) => {
  try {
    const parsed = JSON.parse(value || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ok: true, value: parsed };
    }
    return { ok: false, error: 'Must be a JSON object.' };
  } catch {
    return { ok: false, error: 'Invalid JSON.' };
  }
};

const requiresAuth = (authType?: string | null) =>
  ['api_key', 'bearer', 'query', 'header'].includes(String(authType || 'none'));

/** Classify API error for display (API key, quota, rate limit, etc.) */

const formatPercent = (value: number) => `${Math.round(value * 100)}%`;

const scaleHeight = (value: number, max: number, maxHeight = 60) => {
  if (max <= 0) return 4;
  return Math.max(4, Math.round((value / max) * maxHeight));
};

function FilterTagRow({
  label,
  values,
  onAdd,
  onRemove,
}: {
  label: string;
  values: string[];
  onAdd: (value: string) => void;
  onRemove: (index: number) => void;
}) {
  const [input, setInput] = useState('');
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] text-gray-500 w-20 shrink-0 capitalize">{label}</span>
      <div className="flex flex-wrap gap-1">
        {values.map((v, i) => (
          <span
            key={`${v}-${i}`}
            className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 text-[11px]"
          >
            {v}
            <button
              type="button"
              onClick={() => onRemove(i)}
              className="hover:bg-indigo-200 rounded-full p-0.5"
              aria-label={`Remove ${v}`}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <input
        type="text"
        className="border rounded px-2 py-0.5 text-xs w-28"
        placeholder="Add..."
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            const v = input.trim();
            if (v) {
              onAdd(v);
              setInput('');
            }
          }
        }}
      />
      <button
        type="button"
        onClick={() => {
          const v = input.trim();
          if (v) {
            onAdd(v);
            setInput('');
          }
        }}
        className="text-[11px] text-indigo-600 hover:underline"
      >
        Add
      </button>
    </div>
  );
}

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


export function useExtApisAccess() {
  const { selectedCompanyId, isLoading: isCompanyLoading } = useCompanyContext();
  const [apis, setApis] = useState<ApiSource[]>([]);
  const [drafts, setDrafts] = useState<Record<string, AccessDraft>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [requestForm, setRequestForm] = useState({ ...emptyRequestForm });
  const [requestMessage, setRequestMessage] = useState<string | null>(null);
  const [requests, setRequests] = useState<ApiRequest[]>([]);
  const [isSubmittingRequest, setIsSubmittingRequest] = useState(false);
  const [selectedApiId, setSelectedApiId] = useState<string | null>(null);
  const [expandedUsageId, setExpandedUsageId] = useState<string | null>(null);
  const [canManageExternalApis, setCanManageExternalApis] = useState(false);
  const [globalPresets, setGlobalPresets] = useState<ApiSource[]>([]);
  const [companyDefaultApis, setCompanyDefaultApis] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<TabId>('presets');
  const [configModalApiId, setConfigModalApiId] = useState<string | null>(null);
  const [companyConfig, setCompanyConfig] = useState<CompanyConfigState>({
    purposes: [],
    include_filters: emptyFilterRecord(),
    exclude_filters: emptyFilterRecord(),
    polling_frequency: 'daily',
    daily_limit: '',
    signal_limit: '',
    priority: 'MEDIUM',
    saving: false,
    error: null,
  });
  const [allowedPolling, setAllowedPolling] = useState<string[]>([]);
  const [approvalActionId, setApprovalActionId] = useState<string | null>(null);


  const buildDrafts = (sources: ApiSource[], defaultIds: Set<string>) => {
    const next: Record<string, AccessDraft> = {};
    sources.forEach((source) => {
      const access = source.user_access;
      const isDefaultEnabled = defaultIds.has(source.id);
      next[source.id] = {
        is_enabled: isDefaultEnabled,
        api_key_env_name: access?.api_key_env_name || '',
        headers_override_json: JSON.stringify(access?.headers_override || {}, null, 2),
        query_params_override_json: JSON.stringify(access?.query_params_override || {}, null, 2),
        rate_limit_per_min: access?.rate_limit_per_min ? String(access.rate_limit_per_min) : '',
        error: null,
        saving: false,
      };
    });
    return next;
  };

  const loadApis = async () => {
    try {
      setIsLoading(true);
      if (!selectedCompanyId) {
        setApis([]);
        setDrafts({});
        return;
      }
      const response = await apiFetch(
        `/api/external-apis/access?companyId=${encodeURIComponent(selectedCompanyId)}`
      );
      if (!response.ok) throw new Error('Failed to load APIs');
      const data = await response.json();
      const available = data.availableApis || data.apis || [];
      const defaults = Array.isArray(data.companyDefaultApis) ? data.companyDefaultApis : [];
      setApis(available);
      setCompanyDefaultApis(defaults);
      setDrafts(buildDrafts(available, new Set(defaults)));
      setCanManageExternalApis(!!data?.permissions?.canManageExternalApis);
      setGlobalPresets(data.global_presets || []);
    } catch (error) {
      setSaveMessage('Failed to load external APIs.');
    } finally {
      setIsLoading(false);
    }
  };

  const loadRequests = async () => {
    try {
      if (!selectedCompanyId) {
        setRequests([]);
        return;
      }
      const response = await apiFetch(
        `/api/external-apis/requests?companyId=${encodeURIComponent(selectedCompanyId)}`
      );
      if (!response.ok) {
        setRequests([]);
        return;
      }
      const data = await response.json();
      setRequests(data.requests || []);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadApis();
    loadRequests();
  }, [selectedCompanyId]);

  useEffect(() => {
    if (!configModalApiId || !selectedCompanyId) {
      return;
    }
    const load = async () => {
      try {
        const res = await apiFetch(
          `/api/external-apis/company-config?companyId=${encodeURIComponent(selectedCompanyId)}&api_source_id=${encodeURIComponent(configModalApiId)}`
        );
        if (!res.ok) {
          setCompanyConfig((c) => ({ ...c, error: 'Failed to load config' }));
          return;
        }
        const data = await res.json();
        const config = data.config;
        const allowed = data.allowed_polling || POLLING_OPTIONS;
        setAllowedPolling(Array.isArray(allowed) ? allowed : []);
        if (config) {
          setCompanyConfig({
            purposes: Array.isArray(config.purposes) ? config.purposes : [],
            include_filters: filtersFromPayload(config.include_filters),
            exclude_filters: filtersFromPayload(config.exclude_filters),
            polling_frequency: config.polling_frequency || 'daily',
            daily_limit: config.daily_limit != null ? String(config.daily_limit) : '',
            signal_limit: config.signal_limit != null ? String(config.signal_limit) : '',
            priority: config.priority || 'MEDIUM',
            saving: false,
            error: null,
          });
        } else {
          setCompanyConfig((c) => ({
            ...c,
            purposes: [],
            include_filters: emptyFilterRecord(),
            exclude_filters: emptyFilterRecord(),
            polling_frequency: allowed?.[0] || 'daily',
            daily_limit: '',
            signal_limit: '',
            priority: 'MEDIUM',
            error: null,
          }));
        }
      } catch {
        setCompanyConfig((c) => ({ ...c, error: 'Failed to load config' }));
      }
    };
    load();
  }, [configModalApiId, selectedCompanyId]);

  const updateDraft = (id: string, updates: Partial<AccessDraft>) => {
    setDrafts((prev) => ({
      ...prev,
      [id]: { ...prev[id], ...updates, error: null },
    }));
  };

  const saveAccess = async (source: ApiSource) => {
    const draft = drafts[source.id];
    if (!draft) return;
    if (requiresAuth(source.auth_type) && draft.is_enabled && !draft.api_key_env_name) {
      updateDraft(source.id, {
        error: 'API key env var name is required for this API.',
      });
      return;
    }
    const headersResult = parseJsonObject(draft.headers_override_json);
    const queryResult = parseJsonObject(draft.query_params_override_json);
    if (!headersResult.ok || !queryResult.ok) {
      updateDraft(source.id, {
        error: headersResult.error || queryResult.error || 'Invalid JSON.',
      });
      return;
    }

    setSaveMessage(null);
    updateDraft(source.id, { saving: true });
    try {
      if (!selectedCompanyId) {
        updateDraft(source.id, { error: 'Select a company to manage access.' });
        return;
      }
      const response = await fetch(
        `/api/external-apis/access?companyId=${encodeURIComponent(selectedCompanyId)}`,
        {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_source_id: source.id,
          is_enabled: draft.is_enabled,
          api_key_env_name: draft.api_key_env_name || null,
          headers_override: headersResult.value,
          query_params_override: queryResult.value,
          rate_limit_per_min: draft.rate_limit_per_min
            ? Number(draft.rate_limit_per_min)
            : null,
          scope: 'company',
          companyId: selectedCompanyId,
        }),
      });
      if (!response.ok) {
        throw new Error('Failed to save');
      }
      setSaveMessage(`Saved access for ${source.name}.`);
      await loadApis();
    } catch (error) {
      updateDraft(source.id, { error: 'Failed to save access.' });
    } finally {
      updateDraft(source.id, { saving: false });
    }
  };

  const saveCompanyConfig = async () => {
    if (!configModalApiId || !selectedCompanyId) return;
    const includeFilters: Record<string, string[]> = { ...companyConfig.include_filters };
    const excludeFilters: Record<string, string[]> = { ...companyConfig.exclude_filters };
    setCompanyConfig((c) => ({ ...c, saving: true, error: null }));
    try {
      const res = await apiFetch(
        `/api/external-apis/company-config?companyId=${encodeURIComponent(selectedCompanyId)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            companyId: selectedCompanyId,
            api_source_id: configModalApiId,
            enabled: true,
            purposes: companyConfig.purposes,
            include_filters: includeFilters as Record<string, unknown>,
            exclude_filters: excludeFilters as Record<string, unknown>,
            polling_frequency: companyConfig.polling_frequency || null,
            daily_limit: companyConfig.daily_limit ? parseInt(companyConfig.daily_limit, 10) : null,
            signal_limit: companyConfig.signal_limit ? parseInt(companyConfig.signal_limit, 10) : null,
            priority: companyConfig.priority || null,
          }),
        }
      );
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err?.error || 'Failed to save config');
      }
      const preset = globalPresets.find((p) => p.id === configModalApiId);
      const draft = preset ? drafts[configModalApiId] : null;
      await apiFetch(
        `/api/external-apis/access?companyId=${encodeURIComponent(selectedCompanyId)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            companyId: selectedCompanyId,
            api_source_id: configModalApiId,
            is_enabled: true,
            scope: 'company',
            api_key_env_name: draft?.api_key_env_name || null,
            headers_override: (() => {
              try {
                return draft?.headers_override_json ? JSON.parse(draft.headers_override_json) : {};
              } catch {
                return {};
              }
            })(),
            query_params_override: (() => {
              try {
                return draft?.query_params_override_json ? JSON.parse(draft.query_params_override_json) : {};
              } catch {
                return {};
              }
            })(),
            rate_limit_per_min: draft?.rate_limit_per_min ? Number(draft.rate_limit_per_min) : null,
          }),
        }
      );
      setConfigModalApiId(null);
      setSaveMessage('Configuration saved.');
      await loadApis();
    } catch (e: any) {
      setCompanyConfig((c) => ({ ...c, error: e?.message || 'Failed to save', saving: false }));
      return;
    }
    setCompanyConfig((c) => ({ ...c, saving: false }));
  };

  const runApprovalAction = async (requestId: string, action: string, rejectionReason?: string) => {
    setApprovalActionId(requestId);
    try {
      const res = await apiFetch(
        `/api/external-apis/requests/${requestId}?companyId=${encodeURIComponent(selectedCompanyId!)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, rejection_reason: rejectionReason }),
        }
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data?.error || 'Failed to update');
      }
      await loadRequests();
    } catch (e: any) {
      setRequestMessage(e?.message || 'Action failed');
    } finally {
      setApprovalActionId(null);
    }
  };

  const submitRequest = async () => {
    setRequestMessage(null);
    const headersResult = parseJsonObject(requestForm.headers_json);
    const queryResult = parseJsonObject(requestForm.query_params_json);
    if (!headersResult.ok || !queryResult.ok) {
      setRequestMessage(headersResult.error || queryResult.error || 'Invalid JSON.');
      return;
    }

    setIsSubmittingRequest(true);
    try {
      if (!selectedCompanyId) {
        setRequestMessage('Select a company to submit a request.');
        return;
      }
      const response = await apiFetch(
        `/api/external-apis/requests?companyId=${encodeURIComponent(selectedCompanyId)}`,
        {
        method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: requestForm.name,
          base_url: requestForm.base_url,
          purpose: requestForm.purpose,
          category: requestForm.category || null,
          provider: requestForm.provider || null,
          connection_type: requestForm.connection_type || null,
          documentation_url: requestForm.documentation_url || null,
          sample_response: requestForm.sample_response || null,
          method: requestForm.method,
          auth_type: requestForm.auth_type,
          api_key_env_name: requestForm.api_key_env_name || null,
          headers: headersResult.value,
          query_params: queryResult.value,
          companyId: selectedCompanyId,
        }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data?.error || 'Failed to submit request');
      }
      setRequestForm({ ...emptyRequestForm });
      setRequestMessage('Request submitted for review.');
      await loadRequests();
    } catch (error: any) {
      setRequestMessage(error?.message || 'Failed to submit request.');
    } finally {
      setIsSubmittingRequest(false);
    }
  };

  const visibleApis = canManageExternalApis
    ? apis
    : apis.filter((api) => drafts[api.id]?.is_enabled);
  const activeCount = useMemo(
    () => apis.filter((api) => drafts[api.id]?.is_enabled).length,
    [apis, drafts]
  );
  const todayKey = new Date().toISOString().slice(0, 10);
  const pendingRequestNames = useMemo(() => {
    const set = new Set<string>();
    requests.forEach((req) => {
      if (req.status === 'pending' || req.status === 'pending_admin_review') {
        set.add(req.name.toLowerCase());
      }
    });
    return set;
  }, [requests]);
  const usageTotals = useMemo(() => {
    let requestsToday = 0;
    let failuresToday = 0;
    visibleApis.forEach((api) => {
      const day = (api.usage_daily || []).find((row) => row.usage_date === todayKey);
      if (day) {
        requestsToday += day.request_count || 0;
        failuresToday += day.failure_count || 0;
      }
    });
    return { requestsToday, failuresToday };
  }, [visibleApis, todayKey]);

  const isReadOnly = !canManageExternalApis;

  const selectedApi = canManageExternalApis
    ? apis.find((api) => api.id === selectedApiId) || null
    : null;
  const selectedDraft = selectedApi ? drafts[selectedApi.id] : null;

  const _ef1 = isCompanyLoading;

  const _ef2 = !selectedCompanyId;


  return {
    _ef1,
    _ef2,
    activeCount,
    activeTab,
    allowedPolling,
    apis,
    approvalActionId,
    buildDrafts,
    canManageExternalApis,
    companyConfig,
    companyDefaultApis,
    configModalApiId,
    drafts,
    expandedUsageId,
    apiFetch,
    globalPresets,
    isLoading,
    isReadOnly,
    isSubmittingRequest,
    loadApis,
    loadRequests,
    pendingRequestNames,
    requestForm,
    requestMessage,
    requests,
    runApprovalAction,
    saveAccess,
    saveCompanyConfig,
    saveMessage,
    selectedApi,
    selectedApiId,
    selectedCompanyId,
    selectedDraft,
    setActiveTab,
    setAllowedPolling,
    setApis,
    setApprovalActionId,
    setCanManageExternalApis,
    setCompanyConfig,
    setCompanyDefaultApis,
    setConfigModalApiId,
    setDrafts,
    setExpandedUsageId,
    setGlobalPresets,
    setIsLoading,
    setIsSubmittingRequest,
    setRequestForm,
    setRequestMessage,
    setRequests,
    setSaveMessage,
    setSelectedApiId,
    submitRequest,
    todayKey,
    updateDraft,
    usageTotals,
    visibleApis,
  };
}
