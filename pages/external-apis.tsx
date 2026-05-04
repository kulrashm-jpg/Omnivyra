import React from 'react';
import Link from 'next/link';
import { useExternalApisState } from '../hooks/useExternalApisState';
import { AccountModal, PresetModal } from './external-apis-modals';
import ExternalApisTabContent from '../components/ExternalApisTabContent';
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
} from './external-apis.types';

export default function ExternalApisPage() {
  const d = useExternalApisState();
  const {
    API_CATEGORY_TABS,
    HealthBadgeLegend,
    LATENCY_WARNING_MS,
    accountError,
    accountForm,
    accountModal,
    accountsByApiId,
    accountsLoadingId,
    activeTab,
    addBlankApi,
    addPresetToCatalog,
    apiKeyEnvName,
    apiTestResults,
    apis,
    applyPreset,
    authRequiresKey,
    canManageExternalApis,
    canManagePresets,
    companies,
    companyContextId,
    deleteAccount,
    deleteApi,
    dragOverId,
    dragSourceId,
    editingId,
    editingPresetId,
    errorMessage,
    expandedCardIds,
    apiFetch,
    findPresetByName,
    form,
    formatPercent,
    getApiSection,
    getHealthBadge,
    getHealthStatus,
    handleAccountDragOver,
    handleAccountDragStart,
    handleAccountDrop,
    hasPermission,
    headerJson,
    headerMode,
    headerPairs,
    healthCounts,
    hiddenPresetIds,
    isApiCategoryTab,
    isCompanyLoading,
    isLoading,
    isLoadingPlatformCompanies,
    isLoadingPresets,
    isLoadingRequests,
    isPlatformAdminView,
    isPlatformCatalogMode,
    isSaving,
    isSavingAccount,
    isSavingPreset,
    isSavingPresetSelection,
    isSubmittingRequest,
    lastHealthCheckAt,
    loadAccounts,
    loadApis,
    loadPlatformCompanies,
    loadPresets,
    loadRequests,
    modeParam,
    openAddAccountModal,
    openEditAccountModal,
    openPresetModal,
    parseJsonObject,
    platformAccessDenied,
    platformCompanies,
    platformCompanyId,
    presetSelection,
    presets,
    previewHeadersMerged,
    previewHeadersRaw,
    previewQueryParams,
    previewQueryParamsRaw,
    previewUrl,
    queryJson,
    queryMode,
    queryPairs,
    rejectionReasons,
    requestForm,
    requests,
    resetMessages,
    resolveEditorPayload,
    router,
    runAllTests,
    runtime,
    saveAccount,
    saveApi,
    savePreset,
    savePresetSelection,
    scaleHeight,
    selectedCatalogPreset,
    selectedCompanyId,
    selectedPreset,
    selectedTestScenario,
    setAccountError,
    setAccountForm,
    setAccountModal,
    setAccountsByApiId,
    setAccountsLoadingId,
    setActiveTab,
    setApiTestResults,
    setApis,
    setDragOverId,
    setDragSourceId,
    setEditingId,
    setEditingPresetId,
    setErrorMessage,
    setExpandedCardIds,
    setForm,
    setHeaderJson,
    setHeaderMode,
    setHeaderPairs,
    setHiddenPresetIds,
    setIsLoading,
    setIsLoadingPlatformCompanies,
    setIsLoadingPresets,
    setIsLoadingRequests,
    setIsSaving,
    setIsSavingAccount,
    setIsSavingPreset,
    setIsSavingPresetSelection,
    setIsSubmittingRequest,
    setLastHealthCheckAt,
    setPlatformAccessDenied,
    setPlatformCompanies,
    setPlatformCompanyId,
    setPresetSelection,
    setPresets,
    setQueryJson,
    setQueryMode,
    setQueryPairs,
    setRejectionReasons,
    setRequestForm,
    setRequests,
    setRuntime,
    setSelectedCatalogPreset,
    setSelectedCompanyId,
    setSelectedPreset,
    setSelectedTestScenario,
    setShowPresetModal,
    setSuccessMessage,
    setTestAllRunning,
    setTestAllSummary,
    setTestConnectionLoadingId,
    setTestGeo,
    setTestResult,
    showLoadingState,
    showNoCompanyState,
    showPresetModal,
    showRunTestAndActions,
    startEdit,
    submitNewApiRequest,
    successMessage,
    testAllRunning,
    testAllSummary,
    testConnectionApi,
    testConnectionLoadingId,
    testExistingApi,
    testFetch,
    testGeo,
    testResult,
    toggleAccountActive,
    togglePresetSelection,
    updateApi,
    updateRequestStatus,
    userRole,
    validateApi,
  } = d;

  return (
    <div className="min-h-screen bg-gray-50 p-6">
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

        <ExternalApisTabContent d={d} />
      </div>

      <AccountModal
        accountModal={accountModal}
        onClose={() => setAccountModal(null)}
        accountForm={accountForm}
        setAccountForm={setAccountForm}
        accountError={accountError}
        isSavingAccount={isSavingAccount}
        onSave={saveAccount}
      />

      <PresetModal
        open={showPresetModal}
        onClose={() => setShowPresetModal(false)}
        canManagePresets={canManagePresets}
        canManageExternalApis={canManageExternalApis}
        isLoadingPresets={isLoadingPresets}
        presets={presets}
        presetSelection={presetSelection}
        togglePresetSelection={togglePresetSelection}
        savePresetSelection={savePresetSelection}
        isSavingPresetSelection={isSavingPresetSelection}
      />
    </div>
  );
}
