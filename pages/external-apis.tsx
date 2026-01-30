import React, { useEffect, useState } from 'react';

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
  is_active: boolean;
  method?: string;
  auth_type: string;
  api_key_name?: string | null;
  api_key_env_name?: string | null;
  headers?: Record<string, string> | null;
  query_params?: Record<string, string> | null;
  is_preset?: boolean | null;
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
  } | null;
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

export default function ExternalApisPage() {
  const [apis, setApis] = useState<ApiSource[]>([]);
  const [form, setForm] = useState<Partial<ApiSource>>(emptyForm);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [requests, setRequests] = useState<ApiRequest[]>([]);
  const [isLoadingRequests, setIsLoadingRequests] = useState(false);
  const [rejectionReasons, setRejectionReasons] = useState<Record<string, string>>({});
  const [presets, setPresets] = useState<ExternalApiPreset[]>([]);
  const [selectedPreset, setSelectedPreset] = useState<ExternalApiPreset | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [queryMode, setQueryMode] = useState<'pairs' | 'json'>('pairs');
  const [headerMode, setHeaderMode] = useState<'pairs' | 'json'>('pairs');
  const [queryPairs, setQueryPairs] = useState<KeyValuePair[]>(toPairs(form.query_params || {}));
  const [headerPairs, setHeaderPairs] = useState<KeyValuePair[]>(toPairs(form.headers || {}));
  const [queryJson, setQueryJson] = useState('{}');
  const [headerJson, setHeaderJson] = useState('{}');
  const [testResult, setTestResult] = useState<any>(null);
  const [isSavingPreset, setIsSavingPreset] = useState(false);
  const [activeTab, setActiveTab] = useState<'global' | 'queue' | 'usage'>('global');

  const loadApis = async () => {
    try {
      setIsLoading(true);
      const response = await fetch('/api/external-apis');
      if (!response.ok) throw new Error('Failed to load APIs');
      const data = await response.json();
      setApis(data.apis || []);
    } catch (error) {
      console.error('Error loading APIs:', error);
      setErrorMessage('Failed to load API sources.');
    } finally {
      setIsLoading(false);
    }
  };

  const loadPresets = async () => {
    try {
      const response = await fetch('/api/external-apis/presets');
      if (!response.ok) throw new Error('Failed to load presets');
      const data = await response.json();
      setPresets(data.presets || []);
    } catch (error) {
      console.error('Error loading presets:', error);
    }
  };

  const loadRequests = async () => {
    try {
      setIsLoadingRequests(true);
      const response = await fetch('/api/external-apis/requests');
      if (!response.ok) throw new Error('Failed to load requests');
      const data = await response.json();
      setRequests(data.requests || []);
    } catch (error) {
      console.error('Error loading requests:', error);
    } finally {
      setIsLoadingRequests(false);
    }
  };

  useEffect(() => {
    loadApis();
    loadPresets();
    loadRequests();
    const loadAdminStatus = async () => {
      try {
        const response = await fetch('/api/admin/check-super-admin');
        if (!response.ok) return;
        const data = await response.json();
        setIsAdmin(!!data?.isSuperAdmin);
      } catch (error) {
        console.warn('Unable to load admin status');
      }
    };
    loadAdminStatus();
  }, []);

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
      const response = await fetch(
        editingId ? `/api/external-apis/${editingId}` : '/api/external-apis',
        {
          method: editingId ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );
      if (!response.ok) throw new Error('Failed to save API');
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
      const response = await fetch(
        editingPresetId ? `/api/external-apis/${editingPresetId}` : '/api/external-apis',
        {
          method: editingPresetId ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );
      if (!response.ok) throw new Error('Failed to save preset');
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
      const response = await fetch(`/api/external-apis/${api.id}`, {
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
      const response = await fetch(`/api/external-apis/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Failed to delete API');
      setSuccessMessage('API source deleted.');
      await loadApis();
    } catch (error) {
      console.error('Error deleting API:', error);
      setErrorMessage('Failed to delete API source.');
    }
  };

  const updateRequestStatus = async (id: string, status: 'approved' | 'rejected') => {
    try {
      resetMessages();
      const rejection_reason = status === 'rejected' ? rejectionReasons[id] : undefined;
      const response = await fetch(`/api/external-apis/requests/${id}`, {
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

  const testFetch = async () => {
    try {
      resetMessages();
      const resolved = resolveEditorPayload();
      if (!resolved.ok) {
        setErrorMessage(resolved.message || 'Invalid headers/query params.');
        return;
      }
      const payload = {
        ...form,
        headers: resolved.headers,
        query_params: resolved.queryParams,
      };
      const response = await fetch('/api/external-apis/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to test API');
      }
      setTestResult(data);
      setSuccessMessage('Test fetch completed.');
    } catch (error) {
      console.error('Error fetching trends:', error);
      setErrorMessage('Failed to test API.');
    }
  };

  const validateApi = async (id: string) => {
    try {
      resetMessages();
      const response = await fetch(`/api/external-apis/${id}/validate`);
      if (!response.ok) throw new Error('Failed to validate API');
      setSuccessMessage('API validation completed.');
      await loadApis();
    } catch (error) {
      console.error('Error validating API:', error);
      setErrorMessage('Failed to validate API.');
    }
  };

  const testExistingApi = async (id: string) => {
    try {
      resetMessages();
      const response = await fetch(`/api/external-apis/${id}/test`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to test API');
      }
      setTestResult(data);
      setSuccessMessage('Test fetch completed.');
    } catch (error) {
      console.error('Error testing API:', error);
      setErrorMessage('Failed to test API.');
    }
  };

  const getHealthBadge = (health?: ApiSource['health']) => {
    if (!health) return { label: 'Health: N/A', className: 'bg-gray-100 text-gray-700' };
    const combined = (health.freshness_score ?? 1) * (health.reliability_score ?? 1);
    if (combined >= 0.75) return { label: 'Health: Good', className: 'bg-green-100 text-green-700' };
    if (combined >= 0.4) return { label: 'Health: Fair', className: 'bg-yellow-100 text-yellow-700' };
    return { label: 'Health: Poor', className: 'bg-red-100 text-red-700' };
  };

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

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="bg-white rounded-lg shadow p-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">External API Sources</h1>
          <p className="text-sm text-gray-600">
            Manage external sources for trend and signal discovery.
          </p>
          <p className="text-xs text-gray-500 mt-1">
            Super admins manage the global catalog. Users should enable access on `/external-apis-access`.
          </p>
        </div>

        {!isAdmin && (
          <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 text-sm rounded-lg p-3">
            Read-only mode: only super admins can edit the global catalog.
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

        <div className="bg-white rounded-lg shadow p-2 flex gap-2 text-sm">
          {[
            { id: 'global', label: 'Global APIs' },
            { id: 'queue', label: 'Approval Queue' },
            { id: 'usage', label: 'Usage Analytics' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`px-4 py-2 rounded-lg ${
                activeTab === tab.id
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {(activeTab === 'global' || activeTab === 'usage') && (
          <div className="bg-white rounded-lg shadow p-3">
            <HealthBadgeLegend />
          </div>
        )}

        {activeTab === 'global' && (
          <div className="bg-white rounded-lg shadow p-6">
          <div className="flex flex-col gap-4 mb-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Add External API</h2>
              <p className="text-xs text-gray-500">
                Start with a blank configuration or load a preset and customize it.
              </p>
            </div>
            <div className="flex flex-wrap gap-3 items-center">
              <button
                onClick={addBlankApi}
                className="px-3 py-2 bg-gray-100 text-gray-900 rounded-lg text-sm"
              >
                Add Blank API
              </button>
              <select
                className="border rounded-lg px-3 py-2 text-sm"
                value=""
                onChange={(e) => {
                  const preset = presets.find((item) => item.name === e.target.value);
                  if (preset) {
                    applyPreset(preset);
                  }
                }}
              >
                <option value="" disabled>
                  Add from Preset
                </option>
                {presets.map((preset) => (
                  <option key={preset.name} value={preset.name}>
                    {preset.name}
                  </option>
                ))}
              </select>
              {selectedPreset && (
                <span className="text-xs text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-full px-2 py-1">
                  Preset loaded
                </span>
              )}
            </div>
          </div>

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

            <div className="flex flex-wrap gap-3">
              <button
                onClick={saveApi}
                disabled={isSaving || isSavingPreset || !isAdmin}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm disabled:opacity-50"
              >
                {isSaving ? 'Saving...' : editingId ? 'Update API' : 'Add API'}
              </button>
              <button
                onClick={savePreset}
                disabled={isSaving || isSavingPreset || !isAdmin}
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
        </div>
        )}

        {activeTab === 'global' && (
          <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Configured APIs</h2>
          {isLoading ? (
            <div className="text-sm text-gray-500">Loading...</div>
          ) : (
            <div className="space-y-4">
              {apis.map((api) => (
                <div key={api.id} className="border rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-gray-900 flex items-center gap-2">
                        <span>{api.name}</span>
                        <span
                          className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full ${
                            api.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                          }`}
                          title={api.is_active ? 'Enabled globally' : 'Disabled globally'}
                        >
                          {api.is_active ? 'Enabled' : 'Disabled'}
                        </span>
                        {(api.usage_summary?.failure_rate ?? 0) > 0.1 &&
                          (api.usage_summary?.request_count ?? 0) >= 5 && (
                            <span
                              className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-red-100 text-red-700"
                              title={`Unhealthy • Failure rate ${formatPercent(
                                api.usage_summary?.failure_rate
                              )} • Last error ${api.usage_summary?.last_error_message || '—'}`}
                            >
                              Error
                            </span>
                          )}
                        {(api.usage_summary?.failure_rate ?? 0) >= 0.02 &&
                          (api.usage_summary?.failure_rate ?? 0) <= 0.1 &&
                          (api.usage_summary?.request_count ?? 0) >= 5 && (
                            <span
                              className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700"
                              title={`Degraded • Failure rate ${formatPercent(
                                api.usage_summary?.failure_rate
                              )} • Last error ${api.usage_summary?.last_error_message || '—'}`}
                            >
                              Degraded
                            </span>
                          )}
                        {api.is_preset && (
                          <span className="text-[10px] uppercase tracking-wide bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">
                            Preset
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500">{api.base_url}</div>
                      {(api.api_key_env_name || api.api_key_name) && api.auth_type !== 'none' && (
                        <div
                          className="text-xs text-gray-400"
                          title={`Uses env var: ${api.api_key_env_name || api.api_key_name}`}
                        >
                          Uses env var: {api.api_key_env_name || api.api_key_name}
                        </div>
                      )}
                      {api.is_preset && findPresetByName(api.name)?.description && (
                        <div className="text-xs text-gray-400">
                          {findPresetByName(api.name)?.description}
                        </div>
                      )}
                      <div className="text-xs text-gray-400 mt-1">
                        Enabled users: {api.enabled_user_count ?? 0} • Failure rate:{' '}
                        <span
                          title="Healthy < 2%, Degraded 2–10%, Unhealthy > 10%"
                        >
                          {formatPercent(api.usage_summary?.failure_rate)}
                        </span>
                      </div>
                      {(api.usage_summary?.last_error_message || api.usage_summary?.last_error_code) && (
                        <div className="text-xs text-red-600 mt-1">
                          Last error:{' '}
                          {api.usage_summary?.last_error_code
                            ? `[${api.usage_summary.last_error_code}] `
                            : ''}
                          {api.usage_summary?.last_error_message || '—'}
                          {api.usage_summary?.last_failure_at
                            ? ` • ${new Date(api.usage_summary.last_failure_at).toLocaleDateString()}`
                            : ''}
                        </div>
                      )}
                      {api.usage_summary?.last_success_at && (
                        <div className="text-xs text-green-700 mt-1">
                          Last success: {new Date(api.usage_summary.last_success_at).toLocaleDateString()}
                        </div>
                      )}
                    </div>
                    <div className="text-xs text-gray-500">
                      {api.purpose} • {api.method || 'GET'} • {api.auth_type || 'none'}
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-3">
                    <label className="text-xs text-gray-600 flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={api.is_active}
                        disabled={!isAdmin}
                        onChange={(e) => updateApi({ ...api, is_active: e.target.checked })}
                      />
                      Enabled
                    </label>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${getHealthBadge(
                        api.health
                      ).className}`}
                      title="Based on freshness & reliability of data source"
                    >
                      {getHealthBadge(api.health).label}
                    </span>
                    <button
                      onClick={() => startEdit(api)}
                      className="text-xs text-gray-700"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => validateApi(api.id)}
                      className="text-xs text-indigo-600"
                    >
                      Validate API
                    </button>
                    <button
                      onClick={() => testExistingApi(api.id)}
                      className="text-xs text-gray-700"
                    >
                      Test API
                    </button>
                    <button
                      onClick={() => deleteApi(api.id)}
                      disabled={!isAdmin}
                      className="text-xs text-red-600 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
              {apis.length === 0 && (
                <div className="text-sm text-gray-500">No API sources configured.</div>
              )}
            </div>
          )}
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
                          disabled={!isAdmin}
                          className="text-xs text-green-700 disabled:opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => updateRequestStatus(request.id, 'rejected')}
                          disabled={!isAdmin}
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
    </div>
  );
}
