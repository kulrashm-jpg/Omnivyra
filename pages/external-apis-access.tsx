import React, { useEffect, useMemo, useState } from 'react';
import { useCompanyContext } from '../components/CompanyContext';

type ApiSource = {
  id: string;
  name: string;
  base_url: string;
  purpose: string;
  category?: string | null;
  auth_type: string;
  method?: string | null;
  is_active: boolean;
  api_key_env_name?: string | null;
  headers?: Record<string, any> | null;
  query_params?: Record<string, any> | null;
  user_access?: UserAccess | null;
  usage_summary?: UsageSummary | null;
  usage_daily?: UsageDaily[];
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
};

const emptyRequestForm = {
  name: '',
  base_url: '',
  purpose: 'trends',
  category: '',
  method: 'GET',
  auth_type: 'none',
  api_key_env_name: '',
  headers_json: '{}',
  query_params_json: '{}',
};

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

const formatPercent = (value: number) => `${Math.round(value * 100)}%`;

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

export default function ExternalApiAccessPage() {
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

  const buildDrafts = (sources: ApiSource[]) => {
    const next: Record<string, AccessDraft> = {};
    sources.forEach((source) => {
      const access = source.user_access;
      next[source.id] = {
        is_enabled: access?.is_enabled ?? false,
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
      const response = await fetch(
        `/api/external-apis/access?companyId=${encodeURIComponent(selectedCompanyId)}`
      );
      if (!response.ok) throw new Error('Failed to load APIs');
      const data = await response.json();
      setApis(data.apis || []);
      setDrafts(buildDrafts(data.apis || []));
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
      const response = await fetch(
        `/api/external-apis/requests?companyId=${encodeURIComponent(selectedCompanyId)}`
      );
      if (!response.ok) return;
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
      const response = await fetch(
        `/api/external-apis/requests?companyId=${encodeURIComponent(selectedCompanyId)}`,
        {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: requestForm.name,
          base_url: requestForm.base_url,
          purpose: requestForm.purpose,
          category: requestForm.category || null,
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

  const activeCount = useMemo(
    () => apis.filter((api) => drafts[api.id]?.is_enabled).length,
    [apis, drafts]
  );
  const todayKey = new Date().toISOString().slice(0, 10);
  const pendingRequestNames = useMemo(() => {
    const set = new Set<string>();
    requests.forEach((req) => {
      if (req.status === 'pending') {
        set.add(req.name.toLowerCase());
      }
    });
    return set;
  }, [requests]);
  const usageTotals = useMemo(() => {
    let requestsToday = 0;
    let failuresToday = 0;
    apis.forEach((api) => {
      const day = (api.usage_daily || []).find((row) => row.usage_date === todayKey);
      if (day) {
        requestsToday += day.request_count || 0;
        failuresToday += day.failure_count || 0;
      }
    });
    return { requestsToday, failuresToday };
  }, [apis, todayKey]);

  const selectedApi = apis.find((api) => api.id === selectedApiId) || null;
  const selectedDraft = selectedApi ? drafts[selectedApi.id] : null;

  if (isCompanyLoading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-6xl mx-auto text-sm text-gray-500">Loading company context...</div>
      </div>
    );
  }

  if (!selectedCompanyId) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-6xl mx-auto text-sm text-gray-500">
          Select a company to manage external API access.
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="bg-white rounded-lg shadow p-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">External API Access</h1>
          <p className="text-sm text-gray-600">
            Enable the APIs you want to use and provide your own environment variable names.
          </p>
          <p className="text-xs text-gray-500 mt-2">
            Secrets are never stored. Enter only the env var name (ex: YOUTUBE_API_KEY).
          </p>
        </div>

        <div className="bg-white rounded-lg shadow p-4 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <div className="text-xs text-gray-500">Total APIs</div>
            <div className="text-2xl font-semibold text-gray-900">{apis.length}</div>
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <div className="text-xs text-gray-500">Requests today</div>
            <div className="text-2xl font-semibold text-gray-900">
              {usageTotals.requestsToday}
            </div>
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <div className="text-xs text-gray-500">Failures today</div>
            <div className="text-2xl font-semibold text-gray-900">
              {usageTotals.failuresToday}
            </div>
          </div>
        </div>

        {saveMessage && (
          <div className="bg-indigo-50 border border-indigo-200 text-indigo-800 text-sm rounded-lg p-3">
            {saveMessage}
          </div>
        )}

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Available APIs</h2>
              <p className="text-xs text-gray-500">Enabled: {activeCount}</p>
            </div>
            <HealthBadgeLegend />
          </div>

          {isLoading ? (
            <div className="text-sm text-gray-500">Loading...</div>
          ) : (
            <div className="space-y-4">
              {apis.map((api) => {
                const draft = drafts[api.id];
                const usage = api.usage_summary;
                const isEnabled = draft?.is_enabled || false;
                const needsKey = requiresAuth(api.auth_type) && isEnabled && !draft?.api_key_env_name;
                const failureRate =
                  (usage?.failure_count ?? 0) / Math.max(1, usage?.request_count ?? 0);
                const isError =
                  (usage?.request_count ?? 0) >= 5 && failureRate > 0.1;
                const isDegraded =
                  (usage?.request_count ?? 0) >= 5 && failureRate >= 0.02 && failureRate <= 0.1;
                const healthTooltip = usage?.request_count
                  ? `Failure rate ${formatPercent(failureRate)} • Last error ${usage.last_error_message || '—'}`
                  : 'No usage data yet';
                const isPending = pendingRequestNames.has(api.name.toLowerCase());
                return (
                  <div key={api.id} className="border rounded-lg p-4">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <div className="font-semibold text-gray-900">{api.name}</div>
                          <span
                            className={`text-[11px] px-2 py-0.5 rounded-full ${
                              isEnabled
                                ? 'bg-green-100 text-green-700'
                                : 'bg-gray-100 text-gray-600'
                            }`}
                            title={isEnabled ? 'Enabled for your account' : 'Disabled for your account'}
                          >
                            {isEnabled ? 'Enabled' : 'Disabled'}
                          </span>
                          {isPending && (
                            <span
                              className="text-[11px] px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700"
                              title="Pending approval"
                            >
                              Pending
                            </span>
                          )}
                          {needsKey && (
                            <span
                              className="text-[11px] px-2 py-0.5 rounded-full bg-red-100 text-red-700"
                              title="API key env var name required"
                            >
                              Missing key
                            </span>
                          )}
                          {isError && (
                            <span
                              className="text-[11px] px-2 py-0.5 rounded-full bg-red-100 text-red-700"
                              title={healthTooltip}
                            >
                              Error
                            </span>
                          )}
                          {isDegraded && !isError && (
                            <span
                              className="text-[11px] px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700"
                              title={healthTooltip}
                            >
                              Degraded
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500">{api.base_url}</div>
                        <div className="text-xs text-gray-400">
                          {api.category || 'General'} • {api.method || 'GET'} •{' '}
                          {api.auth_type || 'none'}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <label className="flex items-center gap-2 text-gray-700">
                          <input
                            type="checkbox"
                            checked={isEnabled}
                            onChange={(e) => updateDraft(api.id, { is_enabled: e.target.checked })}
                          />
                          Enabled
                        </label>
                        <button
                          onClick={() => setSelectedApiId(api.id)}
                          className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg"
                        >
                          Configure
                        </button>
                        <button
                          onClick={() =>
                            setExpandedUsageId((prev) => (prev === api.id ? null : api.id))
                          }
                          className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg"
                        >
                          View Usage
                        </button>
                      </div>
                    </div>

                    {needsKey && (
                      <div className="text-xs text-red-600 mt-2">
                        API key env var name is required to enable this API.
                      </div>
                    )}

                    <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                      <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                        <div className="text-gray-500">Requests (14d)</div>
                        <div className="text-lg font-semibold text-gray-900">
                          {usage?.request_count ?? 0}
                        </div>
                      </div>
                      <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                        <div className="text-gray-500">Success rate</div>
                        <div className="text-lg font-semibold text-gray-900">
                          {usage && usage.request_count > 0
                            ? formatPercent(usage.success_count / usage.request_count)
                            : '—'}
                        </div>
                      </div>
                      <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                        <div className="text-gray-500">Last success</div>
                        <div className="text-sm text-green-700">
                          {usage?.last_success_at
                            ? new Date(usage.last_success_at).toLocaleDateString()
                            : '—'}
                        </div>
                      </div>
                    </div>

                    {usage && usage.request_count > 0 && (
                      <div className="text-xs text-gray-500 mt-2">
                        Failure rate:{' '}
                        <span
                          title="Healthy < 2%, Degraded 2–10%, Unhealthy > 10%"
                        >
                          {formatPercent(usage.failure_count / usage.request_count)}
                        </span>
                      </div>
                    )}

                    {(usage?.last_error_message || usage?.last_error_code) && (
                      <div className="text-xs text-red-600 mt-2">
                        Last error:{' '}
                        {usage.last_error_code ? `[${usage.last_error_code}] ` : ''}
                        {usage.last_error_message || '—'}
                        {usage.last_error_at
                          ? ` • ${new Date(usage.last_error_at).toLocaleDateString()}`
                          : ''}
                      </div>
                    )}
                    {usage?.last_failure_at && (
                      <div className="text-xs text-red-600 mt-1">
                        Last failure: {new Date(usage.last_failure_at).toLocaleDateString()}
                      </div>
                    )}

                    {expandedUsageId === api.id && (
                      <div className="mt-4 border-t pt-4">
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
                        {usage && usage.request_count > 0 && (
                          <div className="mt-3">
                            <div className="text-[10px] text-gray-500 mb-1">
                              Success rate {formatPercent(usage.success_count / usage.request_count)}
                            </div>
                            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-green-400"
                                style={{
                                  width: `${Math.min(
                                    100,
                                    Math.round((usage.success_count / usage.request_count) * 100)
                                  )}%`,
                                }}
                                title={`Success rate ${formatPercent(
                                  usage.success_count / usage.request_count
                                )}`}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {draft?.error && (
                      <div className="text-xs text-red-600 mt-3">{draft.error}</div>
                    )}
                  </div>
                );
              })}
              {apis.length === 0 && (
                <div className="text-sm text-gray-500">No APIs are currently available.</div>
              )}
            </div>
          )}
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Request a New API</h2>
          {requestMessage && (
            <div className="text-sm text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg p-3 mb-4">
              {requestMessage}
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <input
              className="border rounded-lg px-3 py-2"
              placeholder="API name"
              value={requestForm.name}
              onChange={(e) => setRequestForm((prev) => ({ ...prev, name: e.target.value }))}
            />
            <input
              className="border rounded-lg px-3 py-2"
              placeholder="Base URL"
              value={requestForm.base_url}
              onChange={(e) => setRequestForm((prev) => ({ ...prev, base_url: e.target.value }))}
            />
            <input
              className="border rounded-lg px-3 py-2"
              placeholder="Category"
              value={requestForm.category}
              onChange={(e) => setRequestForm((prev) => ({ ...prev, category: e.target.value }))}
            />
            <select
              className="border rounded-lg px-3 py-2"
              value={requestForm.purpose}
              onChange={(e) => setRequestForm((prev) => ({ ...prev, purpose: e.target.value }))}
            >
              <option value="trends">Trends</option>
              <option value="keywords">Keywords</option>
              <option value="hashtags">Hashtags</option>
              <option value="news">News</option>
              <option value="demographics">Demographics</option>
            </select>
            <select
              className="border rounded-lg px-3 py-2"
              value={requestForm.method}
              onChange={(e) => setRequestForm((prev) => ({ ...prev, method: e.target.value }))}
            >
              <option value="GET">GET</option>
              <option value="POST">POST</option>
            </select>
            <select
              className="border rounded-lg px-3 py-2"
              value={requestForm.auth_type}
              onChange={(e) => setRequestForm((prev) => ({ ...prev, auth_type: e.target.value }))}
            >
              <option value="none">No Auth</option>
              <option value="api_key">API Key</option>
              <option value="bearer">Bearer</option>
              <option value="query">Query Param</option>
              <option value="header">Header</option>
              <option value="oauth">OAuth (future)</option>
            </select>
            <input
              className="border rounded-lg px-3 py-2"
              placeholder="API key env var name (if needed)"
              value={requestForm.api_key_env_name}
              onChange={(e) =>
                setRequestForm((prev) => ({ ...prev, api_key_env_name: e.target.value }))
              }
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm mt-4">
            <div>
              <div className="text-xs text-gray-500 mb-1">Headers (JSON)</div>
              <textarea
                className="border rounded-lg px-3 py-2 w-full h-28 text-xs"
                value={requestForm.headers_json}
                onChange={(e) => setRequestForm((prev) => ({ ...prev, headers_json: e.target.value }))}
              />
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">Query params (JSON)</div>
              <textarea
                className="border rounded-lg px-3 py-2 w-full h-28 text-xs"
                value={requestForm.query_params_json}
                onChange={(e) =>
                  setRequestForm((prev) => ({ ...prev, query_params_json: e.target.value }))
                }
              />
            </div>
          </div>
          <div className="mt-4">
            <button
              onClick={submitRequest}
              disabled={isSubmittingRequest}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm disabled:opacity-50"
            >
              {isSubmittingRequest ? 'Submitting...' : 'Submit request'}
            </button>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Your Requests</h2>
          {requests.length === 0 ? (
            <div className="text-sm text-gray-500">No requests submitted yet.</div>
          ) : (
            <div className="space-y-3">
              {requests.map((request) => (
                <div key={request.id} className="border rounded-lg p-3 text-sm">
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
                    >
                      {request.status}
                    </span>{' '}
                    • {new Date(request.created_at).toLocaleDateString()}
                  </div>
                  {request.status === 'rejected' && request.rejection_reason && (
                    <div className="text-xs text-red-600 mt-1">
                      Reason: {request.rejection_reason}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {selectedApi && selectedDraft && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-lg w-full max-w-2xl p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-lg font-semibold text-gray-900">{selectedApi.name}</div>
                  <div className="text-xs text-gray-500">Configure your access settings</div>
                </div>
                <button
                  onClick={() => setSelectedApiId(null)}
                  className="text-sm text-gray-500 hover:text-gray-900"
                >
                  Close
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <input
                  className="border rounded-lg px-3 py-2"
                  placeholder="API Key Env Var Name"
                  value={selectedDraft.api_key_env_name || ''}
                  onChange={(e) =>
                    updateDraft(selectedApi.id, { api_key_env_name: e.target.value })
                  }
                />
                <input
                  className="border rounded-lg px-3 py-2"
                  placeholder="Custom rate limit per minute"
                  value={selectedDraft.rate_limit_per_min || ''}
                  onChange={(e) =>
                    updateDraft(selectedApi.id, { rate_limit_per_min: e.target.value })
                  }
                />
                <div>
                  <div className="text-xs text-gray-500 mb-1">Headers overrides (JSON)</div>
                  <textarea
                    className="border rounded-lg px-3 py-2 w-full h-32 text-xs"
                    value={selectedDraft.headers_override_json || '{}'}
                    onChange={(e) =>
                      updateDraft(selectedApi.id, { headers_override_json: e.target.value })
                    }
                  />
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-1">Query params overrides (JSON)</div>
                  <textarea
                    className="border rounded-lg px-3 py-2 w-full h-32 text-xs"
                    value={selectedDraft.query_params_override_json || '{}'}
                    onChange={(e) =>
                      updateDraft(selectedApi.id, { query_params_override_json: e.target.value })
                    }
                  />
                </div>
              </div>

              {selectedDraft.error && (
                <div className="text-xs text-red-600 mt-3">{selectedDraft.error}</div>
              )}

              <div className="mt-4 flex items-center justify-between">
                <div className="text-xs text-gray-500">
                  {requiresAuth(selectedApi.auth_type) &&
                  selectedDraft.is_enabled &&
                  !selectedDraft.api_key_env_name
                    ? 'API key env var name is required when enabled.'
                    : 'Secrets are never stored. Use env var names only.'}
                </div>
                <button
                  onClick={() => saveAccess(selectedApi)}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm"
                  disabled={selectedDraft.saving}
                >
                  {selectedDraft.saving ? 'Saving...' : 'Save settings'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
