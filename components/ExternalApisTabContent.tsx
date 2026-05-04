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

export default function ExternalApisTabContent({ d }: { d: ExternalApisState }) {
  const {
    activeTab, setActiveTab, apis, setApis, form, setForm,
    editingId, setEditingId, isSaving, isLoading, errorMessage, setErrorMessage,
    successMessage, setSuccessMessage, expandedCardIds, setExpandedCardIds,
    accountsByApiId, accountsLoadingId,
    apiFetch, loadApis, loadAccounts, saveApi, deleteApi, startEdit, addBlankApi,
    testConnectionApi, testConnectionLoadingId, testResult,
    testGeo, setTestGeo, testExistingApi, testFetch,
    testAllRunning, testAllSummary, runAllTests,
    apiTestResults, setApiTestResults, selectedTestScenario, setSelectedTestScenario,
    healthCounts, lastHealthCheckAt, getApiSection, getHealthBadge, getHealthStatus,
    HealthBadgeLegend, formatPercent, showRunTestAndActions,
    isApiCategoryTab, API_CATEGORY_TABS,
    headerMode, setHeaderMode, headerJson, setHeaderJson, headerPairs, setHeaderPairs,
    queryMode, setQueryMode, queryJson, setQueryJson, queryPairs, setQueryPairs,
    previewUrl, previewHeadersRaw, previewHeadersMerged, previewQueryParams, previewQueryParamsRaw,
    resolveEditorPayload, parseJsonObject,
    scaleHeight, dragSourceId, setDragSourceId, dragOverId, setDragOverId,
    handleAccountDragStart, handleAccountDragOver, handleAccountDrop,
    openAddAccountModal, openEditAccountModal, deleteAccount, toggleAccountActive,
    isPlatformAdminView, canManageExternalApis, selectedCompanyId, companyContextId,
    presets, presetSelection, hiddenPresetIds, editingPresetId, setEditingPresetId,
    selectedCatalogPreset, setSelectedCatalogPreset, selectedPreset, setSelectedPreset,
    isSavingPreset, savePreset, addPresetToCatalog, findPresetByName, applyPreset,
    platformCompanies, platformCompanyId, setPlatformCompanyId,
    loadPlatformCompanies, isLoadingPlatformCompanies, platformAccessDenied,
    rejectionReasons, setRejectionReasons, updateRequestStatus,
    requests, isLoadingRequests, loadRequests, requestForm, setRequestForm,
    isSubmittingRequest, submitNewApiRequest, resetMessages,
    validateApi, updateApi, apiKeyEnvName,
    runtime, setRuntime,
    isLoadingPresets, loadPresets, openPresetModal, canManagePresets,
    isPlatformCatalogMode, authRequiresKey, isSuperAdmin,
  } = d;

  return (
    <>
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
            const apiAccounts = accountsByApiId[api.id] ?? null; // null = not yet loaded
            const hasAccounts = apiAccounts !== null && apiAccounts.length > 0;
            const isMultiAccount = (api.account_count ?? 0) > 1 || (apiAccounts !== null && apiAccounts.length > 1);
            const isLoadingAccounts = accountsLoadingId === api.id;

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
                        {isSuperAdmin && isMultiAccount && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-violet-50 text-violet-700 border border-violet-200">
                            ⚡ Multi-Account ({api.account_count ?? apiAccounts?.length ?? 0})
                          </span>
                        )}
                        {isSuperAdmin && apiAccounts !== null && apiAccounts.length > 0 && apiAccounts.every((a) => !a.is_active || (a.rate_limit_per_day != null && a.current_usage_day >= a.rate_limit_per_day)) && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200" title="All accounts are inactive or have hit their daily rate limit">
                            ⚠ All Exhausted
                          </span>
                        )}
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
                      <button type="button" onClick={() => {
                        setExpandedCardIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(api.id)) {
                            next.delete(api.id);
                            setEditingId(null);
                            setForm(emptyForm);
                          } else {
                            startEdit(api);
                            next.add(api.id);
                            // Load accounts when expanding if SuperAdmin
                            if (isSuperAdmin && accountsByApiId[api.id] === undefined) {
                              loadAccounts(api.id);
                            }
                          }
                          return next;
                        });
                      }} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-500 text-xs font-medium hover:bg-gray-50 transition-colors">
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
                  <div className="mt-3 ml-9 pt-3 border-t border-gray-100 space-y-4">
                    {/* ── Accounts Section (SuperAdmin only) ──────────────────── */}
                    {isSuperAdmin && (
                      <div className="max-w-2xl">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Accounts</span>
                          <button
                            type="button"
                            onClick={() => openAddAccountModal(api)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-indigo-300 text-indigo-600 text-xs font-medium hover:bg-indigo-50 transition-colors"
                          >
                            + Add Account
                          </button>
                        </div>
                        {isLoadingAccounts ? (
                          <div className="text-xs text-gray-400 py-2">Loading accounts…</div>
                        ) : apiAccounts !== null && apiAccounts.length > 0 ? (
                          <div className="border border-gray-200 rounded-lg overflow-hidden divide-y divide-gray-100">
                            {(() => {
                              const mostRecentId = apiAccounts.reduce<ProviderAccount | null>((best, a) => {
                                if (!best) return a;
                                if (!a.last_used_at) return best;
                                if (!best.last_used_at) return a;
                                return a.last_used_at > best.last_used_at ? a : best;
                              }, null)?.id ?? null;
                              return apiAccounts.map((acct) => {
                                const outcomeColor = acct.last_outcome === 'success' ? 'text-green-600' : acct.last_outcome === 'failure' ? 'text-red-500' : 'text-gray-400';
                                const healthColor = acct.health_score == null ? 'text-gray-400' : acct.health_score >= 0.8 ? 'text-green-600' : acct.health_score >= 0.5 ? 'text-amber-500' : 'text-red-500';
                                const isCurrentlyActive = acct.id === mostRecentId && !!acct.last_used_at;
                                const usagePct = (acct.rate_limit_per_day != null && acct.rate_limit_per_day > 0)
                                  ? Math.min(100, Math.round((acct.current_usage_day ?? 0) / acct.rate_limit_per_day * 100))
                                  : null;
                                const usageBarColor = usagePct == null ? '' : usagePct >= 90 ? 'bg-red-500' : usagePct >= 70 ? 'bg-amber-400' : 'bg-green-500';
                                const isDragOver = dragOverId === acct.id && dragSourceId !== acct.id;
                                return (
                                  <div
                                    key={acct.id}
                                    draggable
                                    onDragStart={() => handleAccountDragStart(acct.id)}
                                    onDragOver={(e) => handleAccountDragOver(e, acct.id)}
                                    onDrop={(e) => handleAccountDrop(e, acct.id, api.id)}
                                    onDragEnd={() => { setDragSourceId(null); setDragOverId(null); }}
                                    className={`px-3 py-2.5 flex flex-col gap-1 text-xs transition-colors ${isDragOver ? 'bg-indigo-50 border-t-2 border-indigo-300' : isCurrentlyActive ? 'bg-emerald-50' : 'bg-white hover:bg-gray-50'} ${dragSourceId === acct.id ? 'opacity-50' : ''}`}
                                  >
                                    <div className="flex items-center gap-3">
                                      <span className="text-gray-300 cursor-grab active:cursor-grabbing flex-shrink-0 select-none" title="Drag to reorder">⠿</span>
                                      <div className="flex items-center gap-1.5 min-w-[100px] flex-shrink-0">
                                        <span className="font-medium text-gray-800 truncate">{acct.account_name}</span>
                                        {isCurrentlyActive && <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-emerald-100 text-emerald-700 border border-emerald-200 flex-shrink-0">● Active</span>}
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => toggleAccountActive(api.id, acct)}
                                        className={`flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-colors ${acct.is_active ? 'bg-green-50 border-green-200 text-green-700 hover:bg-green-100' : 'bg-gray-100 border-gray-200 text-gray-500 hover:bg-gray-200'}`}
                                      >
                                        {acct.is_active ? 'Active' : 'Inactive'}
                                      </button>
                                      <span className="text-gray-400 flex-shrink-0">
                                        <span title="Requests/min">{acct.current_usage_min ?? 0}/min</span>
                                        <span className="mx-1">·</span>
                                        <span title="Requests/day">{acct.current_usage_day ?? 0}/day</span>
                                      </span>
                                      {acct.last_outcome && (
                                        <span className={`flex-shrink-0 ${outcomeColor}`} title={`Last outcome: ${acct.last_outcome}`}>
                                          {acct.last_outcome === 'success' ? '✓' : '✗'} {acct.last_outcome}
                                        </span>
                                      )}
                                      {acct.last_used_at && (
                                        <span className="text-gray-400 flex-shrink-0 truncate" title={acct.last_used_at}>
                                          {(() => { const d = new Date(acct.last_used_at!); const m = Math.floor((Date.now() - d.getTime()) / 60000); return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.floor(m/60)}h ago` : `${Math.floor(m/1440)}d ago`; })()}
                                        </span>
                                      )}
                                      {acct.health_score != null && (
                                        <span className={`flex-shrink-0 font-medium ${healthColor}`} title="Health score">
                                          ♥ {Math.round(acct.health_score * 100)}%
                                        </span>
                                      )}
                                      <div className="ml-auto flex items-center gap-1 flex-shrink-0">
                                        <button type="button" onClick={() => openEditAccountModal(api, acct)} className="p-1 text-gray-400 hover:text-indigo-600 transition-colors" title="Edit account">✎</button>
                                        <button type="button" onClick={() => deleteAccount(api.id, acct.id, acct.account_name)} className="p-1 text-gray-400 hover:text-red-500 transition-colors" title="Delete account">✕</button>
                                      </div>
                                    </div>
                                    {usagePct != null && (
                                      <div className="ml-5 flex items-center gap-2">
                                        <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                          <div className={`h-full rounded-full transition-all ${usageBarColor}`} style={{ width: `${usagePct}%` }} />
                                        </div>
                                        <span className="text-gray-400 text-[10px] flex-shrink-0">{usagePct}% of {acct.rate_limit_per_day}/day</span>
                                      </div>
                                    )}
                                  </div>
                                );
                              });
                            })()}
                          </div>
                        ) : (
                          <div className="text-xs text-gray-400 py-2 border border-dashed border-gray-200 rounded-lg text-center">
                            No accounts configured — using legacy env key below.
                          </div>
                        )}
                      </div>
                    )}
                    {/* ── Legacy API Key field (hidden when accounts exist) ─── */}
                    {!hasAccounts && (
                      <div className="max-w-lg">
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
                    )}
                    {/* ── Active toggle + Save/Cancel ─────────────────────────── */}
                    <div className="max-w-lg space-y-3">
                      <div className="flex items-center gap-2">
                        <input type="checkbox" id={`active-${api.id}`} checked={!!form.is_active} onChange={(e) => setForm((p) => ({ ...p, is_active: e.target.checked }))} className="rounded border-gray-300" />
                        <label htmlFor={`active-${api.id}`} className="text-xs text-gray-700">Active (enabled for use)</label>
                      </div>
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
    </>
  );
}
