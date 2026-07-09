/** useExternalApisTabController — state/handlers of ExternalApisTabContent, verbatim. */
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

export function useExternalApisTabController({ d }: { d: ExternalApisState }) {
  const {
    activeTab, setActiveTab, apis, setApis, form, setForm,
    editingId, setEditingId, isSaving, isLoading, errorMessage, setErrorMessage,
    successMessage, setSuccessMessage, expandedCardIds, setExpandedCardIds,
    accountsByApiId, accountsLoadingId,
    fetchWithAuth, loadApis, loadAccounts, saveApi, deleteApi, startEdit, addBlankApi,
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

  return {
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
  };
}
