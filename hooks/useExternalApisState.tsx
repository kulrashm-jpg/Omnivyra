import { fetchWithAuth } from '../components/community-ai/fetchWithAuth';
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useCompanyContext } from '../components/CompanyContext';
import { getAuthToken } from '../utils/getAuthToken';
import {
  type KeyValuePair,
  type ProviderAccount,
  type ApiSource,
  type ExternalApiPreset,
  type ApiRequest,
  toPairs,
  pairsToRecord,
  buildPreviewUrl,
  buildPreviewHeaders,
  classifyApiError,
  API_META,
  emptyForm,
  TEST_SCENARIOS,
} from '../pages/external-apis.types';

export function useExternalApisState() {
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
  // ── Provider accounts state ──────────────────────────────────────────────
  const [accountsByApiId, setAccountsByApiId] = useState<Record<string, ProviderAccount[]>>({});
  const [accountsLoadingId, setAccountsLoadingId] = useState<string | null>(null);
  const [accountModal, setAccountModal] = useState<{
    apiId: string;
    apiName: string;
    authType: string;
    mode: 'add' | 'edit';
    account?: ProviderAccount;
  } | null>(null);
  const [accountForm, setAccountForm] = useState({
    account_name: '',
    api_key_env_name: '',
    api_key_value: '',
    oauth_client_id: '',
    oauth_client_secret: '',
    rate_limit_per_min: '',
    rate_limit_per_day: '',
    priority: '1',
    is_active: true,
  });
  const [isSavingAccount, setIsSavingAccount] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [dragSourceId, setDragSourceId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
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
    showLoadingState, showNoCompanyState,
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

  // ── Provider account CRUD ────────────────────────────────────────────────

  const loadAccounts = async (apiId: string) => {
    setAccountsLoadingId(apiId);
    try {
      const res = await fetchWithAuth(`/api/provider-accounts?api_source_id=${apiId}`);
      if (!res.ok) return;
      const data = await res.json();
      setAccountsByApiId((prev) => ({ ...prev, [apiId]: data.accounts || [] }));
    } catch {
      // non-critical — fail silently
    } finally {
      setAccountsLoadingId(null);
    }
  };

  const openAddAccountModal = (api: ApiSource) => {
    setAccountError(null);
    setAccountForm({
      account_name: '',
      api_key_env_name: '',
      api_key_value: '',
      oauth_client_id: '',
      oauth_client_secret: '',
      rate_limit_per_min: '',
      rate_limit_per_day: '',
      priority: String((accountsByApiId[api.id]?.length ?? 0) + 1),
      is_active: true,
    });
    setAccountModal({ apiId: api.id, apiName: api.name, authType: api.auth_type, mode: 'add' });
  };

  const openEditAccountModal = (api: ApiSource, account: ProviderAccount) => {
    setAccountError(null);
    setAccountForm({
      account_name: account.account_name,
      api_key_env_name: '',
      api_key_value: '',
      oauth_client_id: '',
      oauth_client_secret: '',
      rate_limit_per_min: account.rate_limit_per_min != null ? String(account.rate_limit_per_min) : '',
      rate_limit_per_day: account.rate_limit_per_day != null ? String(account.rate_limit_per_day) : '',
      priority: String(account.priority),
      is_active: account.is_active,
    });
    setAccountModal({ apiId: api.id, apiName: api.name, authType: api.auth_type, mode: 'edit', account });
  };

  const saveAccount = async () => {
    if (!accountModal) return;
    if (!accountForm.account_name.trim()) {
      setAccountError('Account name is required.');
      return;
    }
    setIsSavingAccount(true);
    setAccountError(null);
    try {
      const credentials: Record<string, string> = {};
      if (accountForm.api_key_env_name.trim()) credentials.api_key_env_name = accountForm.api_key_env_name.trim();
      if (accountForm.api_key_value.trim()) credentials.api_key_value = accountForm.api_key_value.trim();
      if (accountForm.oauth_client_id.trim()) credentials.oauth_client_id = accountForm.oauth_client_id.trim();
      if (accountForm.oauth_client_secret.trim()) credentials.oauth_client_secret = accountForm.oauth_client_secret.trim();

      const body: Record<string, unknown> = {
        account_name: accountForm.account_name.trim(),
        credentials,
        priority: Number(accountForm.priority) || 1,
        is_active: accountForm.is_active,
        ...(accountForm.rate_limit_per_min ? { rate_limit_per_min: Number(accountForm.rate_limit_per_min) } : { rate_limit_per_min: null }),
        ...(accountForm.rate_limit_per_day ? { rate_limit_per_day: Number(accountForm.rate_limit_per_day) } : { rate_limit_per_day: null }),
      };

      let res: Response;
      if (accountModal.mode === 'add') {
        res = await fetchWithAuth('/api/provider-accounts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, api_source_id: accountModal.apiId }),
        });
      } else {
        res = await fetchWithAuth(`/api/provider-accounts/${accountModal.account!.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to save account');
      }

      setAccountModal(null);
      await loadAccounts(accountModal.apiId);
      await loadApis(); // refresh account_count badge
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : 'Failed to save account');
    } finally {
      setIsSavingAccount(false);
    }
  };

  const deleteAccount = async (apiId: string, accountId: string, accountName: string) => {
    if (!confirm(`Delete account "${accountName}"? This cannot be undone.`)) return;
    try {
      const res = await fetchWithAuth(`/api/provider-accounts/${accountId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete account');
      await loadAccounts(apiId);
      await loadApis();
    } catch {
      setErrorMessage('Failed to delete account.');
    }
  };

  const toggleAccountActive = async (apiId: string, account: ProviderAccount) => {
    // Optimistic update
    setAccountsByApiId((prev) => ({
      ...prev,
      [apiId]: (prev[apiId] ?? []).map((a) => a.id === account.id ? { ...a, is_active: !account.is_active } : a),
    }));
    try {
      const res = await fetchWithAuth(`/api/provider-accounts/${account.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !account.is_active }),
      });
      if (!res.ok) throw new Error('Failed to update account');
    } catch {
      // Revert on failure
      setAccountsByApiId((prev) => ({
        ...prev,
        [apiId]: (prev[apiId] ?? []).map((a) => a.id === account.id ? { ...a, is_active: account.is_active } : a),
      }));
      setErrorMessage('Failed to toggle account status.');
    }
  };

  const handleAccountDragStart = (id: string) => { setDragSourceId(id); };
  const handleAccountDragOver = (e: React.DragEvent, id: string) => { e.preventDefault(); setDragOverId(id); };
  const handleAccountDrop = async (e: React.DragEvent, targetId: string, apiId: string) => {
    e.preventDefault();
    setDragOverId(null);
    if (!dragSourceId || dragSourceId === targetId) { setDragSourceId(null); return; }
    const accounts = accountsByApiId[apiId] ?? [];
    const srcIdx = accounts.findIndex((a) => a.id === dragSourceId);
    const tgtIdx = accounts.findIndex((a) => a.id === targetId);
    setDragSourceId(null);
    if (srcIdx === -1 || tgtIdx === -1) return;
    const reordered = [...accounts];
    const [moved] = reordered.splice(srcIdx, 1);
    reordered.splice(tgtIdx, 0, moved);
    const updated = reordered.map((a, i) => ({ ...a, priority: i + 1 }));
    setAccountsByApiId((prev) => ({ ...prev, [apiId]: updated }));
    for (const acct of updated) {
      await fetchWithAuth(`/api/provider-accounts/${acct.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ priority: acct.priority }) }).catch(() => {});
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

  const showLoadingState = isCompanyLoading;
  const showNoCompanyState = !isCompanyLoading && !companyContextId && !isPlatformCatalogMode;



  return {
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
    fetchWithAuth,
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
    isSuperAdmin,
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
  };
}
