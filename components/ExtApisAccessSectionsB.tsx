/** ExtApisAccessSectionsB — verbatim JSX slice of ExtApisAccessView (babel-verified). */
import React, { useEffect, useMemo, useState } from 'react';
import { useCompanyContext } from './CompanyContext';
import { getAuthToken } from '../utils/getAuthToken';
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

import type { useExtApisAccess } from '../hooks/useExtApisAccess';
import { useExtApisAccessViewController } from './ExtApisAccessViewController';

export default function ExtApisAccessSectionsB({ f }: { f: ReturnType<typeof useExtApisAccessViewController> }) {
  const {
    d,
    _ef1, _ef2, activeCount, activeTab, allowedPolling, apis, approvalActionId, buildDrafts, canManageExternalApis, companyConfig,
    companyDefaultApis, configModalApiId, drafts, expandedUsageId, fetchWithAuth, globalPresets, isLoading, isReadOnly,
    isSubmittingRequest, loadApis, loadRequests, pendingRequestNames, requestForm, requestMessage, requests, runApprovalAction,
    saveAccess, saveCompanyConfig, saveMessage, selectedApi, selectedApiId, selectedCompanyId, selectedDraft, setActiveTab,
    setAllowedPolling, setApis, setApprovalActionId, setCanManageExternalApis, setCompanyConfig, setCompanyDefaultApis,
    setConfigModalApiId, setDrafts, setExpandedUsageId, setGlobalPresets, setIsLoading, setIsSubmittingRequest, setRequestForm,
    setRequestMessage, setRequests, setSaveMessage, setSelectedApiId, submitRequest, todayKey, updateDraft, usageTotals, visibleApis
  } = f;
  return (
    <>
        {activeTab === 'request' && (
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
              placeholder="Provider"
              value={requestForm.provider}
              onChange={(e) => setRequestForm((prev) => ({ ...prev, provider: e.target.value }))}
            />
            <input
              className="border rounded-lg px-3 py-2"
              placeholder="Base URL"
              value={requestForm.base_url}
              onChange={(e) => setRequestForm((prev) => ({ ...prev, base_url: e.target.value }))}
            />
            <input
              className="border rounded-lg px-3 py-2"
              placeholder="API Category"
              value={requestForm.category}
              onChange={(e) => setRequestForm((prev) => ({ ...prev, category: e.target.value }))}
            />
            <select
              className="border rounded-lg px-3 py-2"
              value={requestForm.connection_type}
              onChange={(e) => setRequestForm((prev) => ({ ...prev, connection_type: e.target.value }))}
            >
              <option value="REST">REST</option>
              <option value="Webhook">Webhook</option>
              <option value="RSS">RSS</option>
            </select>
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
            <input
              className="border rounded-lg px-3 py-2 md:col-span-2"
              placeholder="Documentation URL"
              value={requestForm.documentation_url}
              onChange={(e) => setRequestForm((prev) => ({ ...prev, documentation_url: e.target.value }))}
            />
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
            <div className="md:col-span-2">
              <div className="text-xs text-gray-500 mb-1">Sample API response (optional)</div>
              <textarea
                className="border rounded-lg px-3 py-2 w-full h-24 text-xs"
                value={requestForm.sample_response}
                onChange={(e) =>
                  setRequestForm((prev) => ({ ...prev, sample_response: e.target.value }))
                }
                placeholder="Paste a sample JSON or text response"
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
        )}

        {activeTab === 'approval' && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Approval Queue</h2>
          {requests.length === 0 ? (
            <div className="text-sm text-gray-500">No requests in the queue.</div>
          ) : (
            <div className="space-y-3">
              {requests.map((request) => {
                const statusClass =
                  request.status === 'approved'
                    ? 'bg-green-100 text-green-700'
                    : request.status === 'rejected'
                    ? 'bg-red-100 text-red-700'
                    : request.status === 'sent_to_super_admin' || request.status === 'approved_by_admin'
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-yellow-100 text-yellow-700';
                const canAct =
                  canManageExternalApis &&
                  ['pending_admin_review', 'pending', 'approved_by_admin', 'sent_to_super_admin'].includes(
                    request.status
                  );
                const isPendingAdmin = ['pending_admin_review', 'pending'].includes(request.status);
                const isApprovedByAdmin = request.status === 'approved_by_admin';
                const isSentToSuper = request.status === 'sent_to_super_admin';
                return (
                  <div key={request.id} className="border rounded-lg p-3 text-sm">
                    <div className="font-semibold text-gray-900">{request.name}</div>
                    <div className="text-xs text-gray-500">{request.base_url}</div>
                    <div className="text-xs text-gray-400 mt-1">
                      Status:{' '}
                      <span className={`px-2 py-0.5 rounded-full text-[11px] ${statusClass}`}>
                        {request.status.replace(/_/g, ' ')}
                      </span>{' '}
                      • {new Date(request.created_at).toLocaleDateString()}
                    </div>
                    {request.status === 'rejected' && request.rejection_reason && (
                      <div className="text-xs text-red-600 mt-1">
                        Reason: {request.rejection_reason}
                      </div>
                    )}
                    {canAct && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {isPendingAdmin && (
                          <>
                            <button
                              onClick={() => runApprovalAction(request.id, 'approve_by_admin')}
                              disabled={approvalActionId === request.id}
                              className="px-2 py-1 bg-green-600 text-white rounded text-xs disabled:opacity-50"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => runApprovalAction(request.id, 'send_to_super_admin')}
                              disabled={approvalActionId === request.id}
                              className="px-2 py-1 bg-blue-600 text-white rounded text-xs disabled:opacity-50"
                            >
                              Send to Super Admin
                            </button>
                          </>
                        )}
                        {(isPendingAdmin || isApprovedByAdmin || isSentToSuper) && (
                          <button
                            onClick={() =>
                              runApprovalAction(
                                request.id,
                                'reject',
                                window.prompt('Rejection reason (optional):') || undefined
                              )
                            }
                            disabled={approvalActionId === request.id}
                            className="px-2 py-1 bg-red-600 text-white rounded text-xs disabled:opacity-50"
                          >
                            Reject
                          </button>
                        )}
                        {isSentToSuper && (
                          <span className="text-xs text-gray-500">
                            Waiting for Super Admin to approve or reject.
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        )}

        {activeTab === 'usage' && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Usage Analytics</h2>
          <p className="text-sm text-gray-500 mb-4">
            Total API requests, success/failure counts, and usage over time per API.
          </p>
          {visibleApis.length === 0 ? (
            <div className="text-sm text-gray-500">No APIs configured. Enable APIs in Global Preset APIs.</div>
          ) : (
            <div className="space-y-4">
              {visibleApis.map((api) => {
                const usage = api.usage_summary;
                const total = usage?.request_count ?? 0;
                const success = usage?.success_count ?? 0;
                const failed = usage?.failure_count ?? 0;
                const rate = total > 0 ? success / total : 0;
                return (
                  <div key={api.id} className="border rounded-lg p-4">
                    <div className="font-semibold text-gray-900">{api.name}</div>
                    <div className="text-xs text-gray-500">{api.base_url}</div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 text-sm">
                      <div className="bg-gray-50 rounded p-2">
                        <div className="text-gray-500 text-xs">Total requests</div>
                        <div className="font-semibold">{total}</div>
                      </div>
                      <div className="bg-green-50 rounded p-2">
                        <div className="text-gray-500 text-xs">Success</div>
                        <div className="font-semibold text-green-700">{success}</div>
                      </div>
                      <div className="bg-red-50 rounded p-2">
                        <div className="text-gray-500 text-xs">Failed</div>
                        <div className="font-semibold text-red-700">{failed}</div>
                      </div>
                      <div className="bg-gray-50 rounded p-2">
                        <div className="text-gray-500 text-xs">Success rate</div>
                        <div className="font-semibold">{formatPercent(rate)}</div>
                      </div>
                    </div>
                    {(api.usage_daily || []).length > 0 && (
                      <div className="mt-3">
                        <div className="text-xs text-gray-500 mb-1">Usage over time (last 14 days)</div>
                        <div className="flex flex-wrap gap-2">
                          {(api.usage_daily || []).map((day) => (
                            <div
                              key={day.usage_date}
                              className="text-xs bg-gray-100 rounded px-2 py-1"
                              title={`${day.request_count} requests, ${day.failure_count} failures`}
                            >
                              {String(day.usage_date).slice(5)}: {day.request_count}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        )}

        {configModalApiId && (() => {
          const preset = globalPresets.find((p) => p.id === configModalApiId) || apis.find((a) => a.id === configModalApiId);
          if (!preset) return null;
          return (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg shadow-lg w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="text-lg font-semibold text-gray-900">{preset.name}</div>
                    <div className="text-xs text-gray-500">Company API configuration (purpose, filters, polling, limits)</div>
                  </div>
                  <button
                    onClick={() => setConfigModalApiId(null)}
                    className="text-sm text-gray-500 hover:text-gray-900"
                  >
                    Close
                  </button>
                </div>
                <div className="space-y-4 text-sm">
                  <div>
                    <div className="text-xs text-gray-500 mb-1">Purpose (multi-select)</div>
                    <div className="flex flex-wrap gap-2">
                      {PURPOSE_OPTIONS.map((p) => (
                        <label key={p} className="flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={companyConfig.purposes.includes(p)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setCompanyConfig((c) => ({ ...c, purposes: [...c.purposes, p] }));
                              } else {
                                setCompanyConfig((c) => ({ ...c, purposes: c.purposes.filter((x) => x !== p) }));
                              }
                            }}
                          />
                          <span className="text-xs">{p.replace(/_/g, ' ')}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="md:col-span-2">
                    <div className="text-xs font-medium text-gray-700 mb-2">Include filters</div>
                    <p className="text-[10px] text-gray-400 mb-2">Signals matching these will be prioritized.</p>
                    <div className="space-y-2">
                      {FILTER_FIELD_KEYS.map((key) => (
                        <FilterTagRow
                          key={`include-${key}`}
                          label={key.replace(/_/g, ' ')}
                          values={companyConfig.include_filters[key] || []}
                          onAdd={(v) =>
                            setCompanyConfig((c) => ({
                              ...c,
                              include_filters: {
                                ...c.include_filters,
                                [key]: [...(c.include_filters[key] || []), v].filter(Boolean),
                              },
                            }))
                          }
                          onRemove={(idx) =>
                            setCompanyConfig((c) => ({
                              ...c,
                              include_filters: {
                                ...c.include_filters,
                                [key]: (c.include_filters[key] || []).filter((_, i) => i !== idx),
                              },
                            }))
                          }
                        />
                      ))}
                    </div>
                  </div>
                  <div className="md:col-span-2">
                    <div className="text-xs font-medium text-gray-700 mb-2">Exclude filters</div>
                    <p className="text-[10px] text-gray-400 mb-2">Signals matching these will be ignored.</p>
                    <div className="space-y-2">
                      {FILTER_FIELD_KEYS.map((key) => (
                        <FilterTagRow
                          key={`exclude-${key}`}
                          label={key.replace(/_/g, ' ')}
                          values={companyConfig.exclude_filters[key] || []}
                          onAdd={(v) =>
                            setCompanyConfig((c) => ({
                              ...c,
                              exclude_filters: {
                                ...c.exclude_filters,
                                [key]: [...(c.exclude_filters[key] || []), v].filter(Boolean),
                              },
                            }))
                          }
                          onRemove={(idx) =>
                            setCompanyConfig((c) => ({
                              ...c,
                              exclude_filters: {
                                ...c.exclude_filters,
                                [key]: (c.exclude_filters[key] || []).filter((_, i) => i !== idx),
                              },
                            }))
                          }
                        />
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 mb-1">Polling frequency</div>
                    <select
                      className="border rounded-lg px-3 py-2 w-full"
                      value={companyConfig.polling_frequency}
                      onChange={(e) => setCompanyConfig((c) => ({ ...c, polling_frequency: e.target.value }))}
                    >
                      {(allowedPolling.length ? allowedPolling : POLLING_OPTIONS).map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                    <p className="text-[10px] text-gray-400 mt-0.5">Allowed options depend on your plan.</p>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-xs text-gray-500 mb-1">Daily limit (optional)</div>
                      <input
                        type="number"
                        className="border rounded-lg px-3 py-2 w-full"
                        value={companyConfig.daily_limit}
                        onChange={(e) => setCompanyConfig((c) => ({ ...c, daily_limit: e.target.value }))}
                        placeholder="e.g. 100"
                      />
                    </div>
                    <div>
                      <div className="text-xs text-gray-500 mb-1">Signal limit (optional)</div>
                      <input
                        type="number"
                        className="border rounded-lg px-3 py-2 w-full"
                        value={companyConfig.signal_limit}
                        onChange={(e) => setCompanyConfig((c) => ({ ...c, signal_limit: e.target.value }))}
                        placeholder="e.g. 500"
                      />
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 mb-1">Priority</div>
                    <select
                      className="border rounded-lg px-3 py-2 w-full"
                      value={companyConfig.priority}
                      onChange={(e) => setCompanyConfig((c) => ({ ...c, priority: e.target.value }))}
                    >
                      {PRIORITY_OPTIONS.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  </div>
                  {companyConfig.error && (
                    <div className="text-xs text-red-600">{companyConfig.error}</div>
                  )}
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setConfigModalApiId(null)}
                      className="px-3 py-2 border rounded-lg text-gray-700"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={saveCompanyConfig}
                      disabled={companyConfig.saving}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-lg disabled:opacity-50"
                    >
                      {companyConfig.saving ? 'Saving...' : 'Save configuration'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {selectedApi && selectedDraft && canManageExternalApis && (
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
                  disabled={isReadOnly}
                />
                <input
                  className="border rounded-lg px-3 py-2"
                  placeholder="Custom rate limit per minute"
                  value={selectedDraft.rate_limit_per_min || ''}
                  onChange={(e) =>
                    updateDraft(selectedApi.id, { rate_limit_per_min: e.target.value })
                  }
                  disabled={isReadOnly}
                />
                <div>
                  <div className="text-xs text-gray-500 mb-1">Headers overrides (JSON)</div>
                  <textarea
                    className="border rounded-lg px-3 py-2 w-full h-32 text-xs"
                    value={selectedDraft.headers_override_json || '{}'}
                    onChange={(e) =>
                      updateDraft(selectedApi.id, { headers_override_json: e.target.value })
                    }
                    disabled={isReadOnly}
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
                    disabled={isReadOnly}
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
                  disabled={selectedDraft.saving || isReadOnly}
                >
                  {selectedDraft.saving ? 'Saving...' : 'Save settings'}
                </button>
              </div>
            </div>
          </div>
        )}
    </>
  );
}
