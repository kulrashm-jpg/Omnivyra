/** ExternalApisSectionsB — verbatim JSX slice of ExternalApisTabContent (babel-verified). */
import React from 'react';
import Link from 'next/link';
import type { useExternalApisState } from '../hooks/useExternalApisState';
import {
  type KeyValuePair,
  type ProviderAccount,
  type ApiSource,
  toPairs,
  pairsToRecord,
  buildPreviewUrl,
  buildPreviewHeaders,
  classifyApiError,
  API_META,
  emptyForm,
  TEST_SCENARIOS,
} from '../pages/external-apis.types';

type ExternalApisState = ReturnType<typeof useExternalApisState>;

import { useExternalApisTabController } from './ExternalApisTabController';

export default function ExternalApisSectionsB({ f }: { f: ReturnType<typeof useExternalApisTabController> }) {
  const {
    d,
    API_CATEGORY_TABS, HealthBadgeLegend, accountsByApiId, accountsLoadingId, activeTab, addBlankApi, addPresetToCatalog,
    apiKeyEnvName, apiTestResults, apis, applyPreset, authRequiresKey, canManageExternalApis, canManagePresets, companyContextId,
    deleteAccount, deleteApi, dragOverId, dragSourceId, editingId, editingPresetId, errorMessage, expandedCardIds, fetchWithAuth,
    findPresetByName, form, formatPercent, getApiSection, getHealthBadge, getHealthStatus, handleAccountDragOver,
    handleAccountDragStart, handleAccountDrop, headerJson, headerMode, headerPairs, healthCounts, hiddenPresetIds, isApiCategoryTab,
    isLoading, isLoadingPlatformCompanies, isLoadingPresets, isLoadingRequests, isPlatformAdminView, isPlatformCatalogMode, isSaving,
    isSavingPreset, isSubmittingRequest, isSuperAdmin, lastHealthCheckAt, loadAccounts, loadApis, loadPlatformCompanies, loadPresets,
    loadRequests, openAddAccountModal, openEditAccountModal, openPresetModal, parseJsonObject, platformAccessDenied,
    platformCompanies, platformCompanyId, presetSelection, presets, previewHeadersMerged, previewHeadersRaw, previewQueryParams,
    previewQueryParamsRaw, previewUrl, queryJson, queryMode, queryPairs, rejectionReasons, requestForm, requests, resetMessages,
    resolveEditorPayload, runAllTests, runtime, saveApi, savePreset, scaleHeight, selectedCatalogPreset, selectedCompanyId,
    selectedPreset, selectedTestScenario, setActiveTab, setApiTestResults, setApis, setDragOverId, setDragSourceId, setEditingId,
    setEditingPresetId, setErrorMessage, setExpandedCardIds, setForm, setHeaderJson, setHeaderMode, setHeaderPairs,
    setPlatformCompanyId, setQueryJson, setQueryMode, setQueryPairs, setRejectionReasons, setRequestForm, setRuntime,
    setSelectedCatalogPreset, setSelectedPreset, setSelectedTestScenario, setSuccessMessage, setTestGeo, showRunTestAndActions,
    startEdit, submitNewApiRequest, successMessage, testAllRunning, testAllSummary, testConnectionApi, testConnectionLoadingId,
    testExistingApi, testFetch, testGeo, testResult, toggleAccountActive, updateApi, updateRequestStatus, validateApi
  } = f;
  return (
    <>
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
    </>
  );
}
