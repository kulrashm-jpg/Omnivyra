/** ExternalApisTabContent — thin composition. */
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
import ExternalApisSectionsA from './ExternalApisSectionsA';
import ExternalApisSectionsB from './ExternalApisSectionsB';

export default function ExternalApisTabContent({ d }: { d: ExternalApisState }) {
  const f = useExternalApisTabController({ d });
  const {
    d: _d,
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
        {(isApiCategoryTab || activeTab === 'usage') && (
          isPlatformCatalogMode ? (
            <div className="bg-white rounded-lg shadow p-3">
              <HealthBadgeLegend />
            </div>
          ) : (
            // UI step 7c: reference material, collapsed by default in company mode.
            <details className="bg-white rounded-lg shadow p-3">
              <summary className="cursor-pointer text-sm font-medium text-gray-700">What do the health badges mean?</summary>
              <div className="mt-2"><HealthBadgeLegend /></div>
            </details>
          )
        )}

      <ExternalApisSectionsA f={f} />
      <ExternalApisSectionsB f={f} />
    </>
  );
}
