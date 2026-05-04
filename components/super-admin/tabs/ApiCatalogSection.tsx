import { apiFetch } from '@/lib/apiFetch';
import React, { useState, useEffect } from 'react';
import { getAuthToken } from '@/utils/getAuthToken';
import { KNOWN_APIS } from '@/pages/super-admin.types';
import {
  RefreshCw,
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

type ProviderAccount = {
  id: string; api_source_id: string; account_name: string; priority: number;
  is_active: boolean; rate_limit_per_min: number | null; rate_limit_per_day: number | null;
  current_usage_min: number; current_usage_day: number;
  last_reset_at: string; created_at: string;
  last_used_at?: string | null; last_outcome?: string | null; health_score?: number | null;
};

interface ApiCatalogSectionProps {
  categoryKey: 'trend' | 'community' | 'llm' | 'image' | 'others';
}

export default function ApiCatalogSection({ categoryKey }: ApiCatalogSectionProps) {

  const [catalogApis, setCatalogApis] = useState<any[]>([]);
  const [loadingCatalogApis, setLoadingCatalogApis] = useState(false);
  const [expandedApiId, setExpandedApiId] = useState<string | null>(null);
  const [apiEnvForm, setApiEnvForm] = useState<Record<string, any>>({ api_key_env_name: '', is_active: true });
  const [savingApiEnv, setSavingApiEnv] = useState(false);
  const [apiEnvSaveError, setApiEnvSaveError] = useState<string | null>(null);
  // ── Provider accounts ──────────────────────────────────────────────────────
  const [accountsByApiId, setAccountsByApiId] = useState<Record<string, ProviderAccount[]>>({});
  const [accountsLoadingId, setAccountsLoadingId] = useState<string | null>(null);
  const [accountModal, setAccountModal] = useState<{ apiId: string; apiName: string; authType: string; mode: 'add' | 'edit'; account?: ProviderAccount } | null>(null);
  const [accountForm, setAccountForm] = useState({ account_name: '', api_key_env_name: '', api_key_value: '', oauth_client_id: '', oauth_client_secret: '', rate_limit_per_min: '', rate_limit_per_day: '', priority: '1', is_active: true });
  const [isSavingAccount, setIsSavingAccount] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [dragSourceId, setDragSourceId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [checkingApiId, setCheckingApiId] = useState<string | null>(null);
  const [apiCheckResults, setApiCheckResults] = useState<Record<string, { ok: boolean; detail: string; checked_at: string }>>({});

  // Canonical base_urls for known APIs — used to auto-fix stale entries in DB.
  // These must be valid GET endpoints so the Check button works correctly.
  const CANONICAL_BASE_URLS: Record<string, string> = {
    // LLM
    'OpenAI (GPT-4o)':         'https://api.openai.com/v1/models',
    'Anthropic Claude':        'https://api.anthropic.com/v1/models',
    'Google Gemini':           'https://generativelanguage.googleapis.com/v1beta/models',
    'Groq':                    'https://api.groq.com/openai/v1/models',
    'Mistral AI':              'https://api.mistral.ai/v1/models',
    'Cohere':                  'https://api.cohere.ai/v2/models',
    // Image
    'DALL-E (OpenAI)':         'https://api.openai.com/v1/models',
    'Stability AI':            'https://api.stability.ai/v1/engines/list',
    'Replicate':               'https://api.replicate.com/v1/collections',
    'fal.ai':                  'https://rest.alpha.fal.ai/v1/models',
    // Others
    'Apify':                   'https://api.apify.com/v2/users/me',
    'Browserless':             'https://chrome.browserless.io/json/version',
    'Perplexity AI':           'https://api.perplexity.ai/models',
  };

  const loadCatalogApis = async () => {
    setLoadingCatalogApis(true);
    try {
      const r = await apiFetch('/api/external-apis?scope=platform');
      if (!r.ok) return;
      const d = await r.json();
      const apis: any[] = d.apis || [];
      setCatalogApis(apis);

      // Auto-fix any stored entries whose base_url is outdated (e.g. /v1 → /v1/models)
      for (const api of apis) {
        const canonical = CANONICAL_BASE_URLS[api.name];
        if (canonical && api.base_url !== canonical) {
          apiFetch(`/api/external-apis/${api.id}?scope=platform`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: api.name, base_url: canonical }),
          }).then((pr) => {
            if (pr.ok) setCatalogApis((prev) => prev.map((a) => a.id === api.id ? { ...a, base_url: canonical } : a));
          }).catch(() => {});
        }
      }
    } catch (e) { console.error('loadCatalogApis', e); }
    finally { setLoadingCatalogApis(false); }
  };

  const addApiToCatalog = async (known: { name: string; env_var: string | null; base_url: string; auth_type: string }) => {
    try {
      const r = await apiFetch('/api/external-apis?scope=platform', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: known.name, base_url: known.base_url, auth_type: known.auth_type, api_key_env_name: known.env_var, is_active: true, is_preset: true, purpose: 'trends' }),
      });
      if (r.ok) await loadCatalogApis();
    } catch (e) { console.error('addApiToCatalog', e); }
  };

  // Add to catalog + immediately open the configure form — no separate "+ Add" step
  const addAndExpand = async (known: { key: string; name: string; env_var: string | null; base_url: string; auth_type: string; default_query_params?: Record<string, string>; default_headers?: Record<string, string>; optional_token?: boolean }) => {
    setCheckingApiId(known.key);
    setApiEnvSaveError(null);
    try {
      const r = await apiFetch('/api/external-apis?scope=platform', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: known.name, base_url: known.base_url, auth_type: known.auth_type, api_key_env_name: known.env_var, is_active: true, is_preset: true, purpose: 'trends', query_params: known.default_query_params || {}, headers: known.default_headers || {} }),
      });
      if (r.ok) {
        const d = await r.json();
        const newEntry = d.api || d;
        setCatalogApis((prev) => [...prev, newEntry]);
        setExpandedApiId(known.key);
        setApiEnvForm({ api_key_env_name: known.env_var || '', is_active: true, base_url: known.base_url, daily_quota: '', _client_id_env: '', _client_secret_env: '', _config: {} });
      } else {
        const body = await r.json().catch(() => ({}));
        setApiEnvSaveError(body?.error || body?.detail || `Failed to add API (${r.status}) — are you logged in as super admin?`);
      }
    } catch (e) {
      console.error('addAndExpand', e);
      setApiEnvSaveError(e instanceof Error ? e.message : 'Failed to add API');
    }
    finally { setCheckingApiId(null); }
  };

  const saveApiEnvConfig = async (catalogEntry: any, known?: any) => {
    setSavingApiEnv(true);
    setApiEnvSaveError(null);
    try {
      // Embed _config (model/temperature/etc.) into query_params JSONB
      const { _config: _existingConfig, ...restQP } = catalogEntry.query_params || {};
      const newConfig = apiEnvForm._config;
      // Canonical query_params from KNOWN_APIS take precedence (fixes Pixabay key param, Pexels endpoint)
      const canonicalQP = known?.default_query_params || {};
      const mergedQP = { ...restQP, ...canonicalQP, ...(newConfig && Object.keys(newConfig).length > 0 ? { _config: newConfig } : {}) };

      // Canonical headers from KNOWN_APIS (fixes Pexels auth — no "Bearer " prefix)
      const canonicalHeaders = known?.default_headers || {};
      const mergedHeaders: Record<string, any> = { ...(catalogEntry.headers || {}), ...canonicalHeaders };
      if (apiEnvForm._client_id_env != null)     mergedHeaders._client_id_env     = apiEnvForm._client_id_env;
      if (apiEnvForm._client_secret_env != null)  mergedHeaders._client_secret_env  = apiEnvForm._client_secret_env;

      const resolvedApiKeyEnvName = apiEnvForm.api_key_env_name?.trim() || null;
      // For optional-token APIs (e.g. GitHub): if no token provided, use auth_type 'none' so Check doesn't fail
      const canonicalAuthType = known?.auth_type ?? catalogEntry.auth_type ?? 'none';
      const effectiveAuthType = (known?.optional_token && !resolvedApiKeyEnvName) ? 'none' : canonicalAuthType;

      const r = await apiFetch(`/api/external-apis/${catalogEntry.id}?scope=platform`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:              catalogEntry.name,
          base_url:          known?.base_url ?? apiEnvForm.base_url ?? catalogEntry.base_url,
          platform_type:     catalogEntry.platform_type ?? 'social',
          method:            catalogEntry.method ?? 'GET',
          auth_type:         effectiveAuthType,
          api_key_name:      catalogEntry.api_key_name ?? null,
          api_key_env_name:  resolvedApiKeyEnvName,
          headers:           mergedHeaders,
          query_params:      mergedQP,
          is_active:         apiEnvForm.is_active,
          is_preset:         catalogEntry.is_preset ?? true,
          rate_limit_per_min: apiEnvForm.daily_quota != null ? Number(apiEnvForm.daily_quota) : (catalogEntry.rate_limit_per_min ?? 60),
        }),
      });
      if (r.ok) {
        setExpandedApiId(null);
        await loadCatalogApis();
      } else {
        const body = await r.json().catch(() => ({}));
        setApiEnvSaveError(body?.error || body?.detail || `Save failed (${r.status})`);
      }
    } catch (e) {
      console.error('saveApiEnvConfig', e);
      setApiEnvSaveError(e instanceof Error ? e.message : 'Save failed');
    }
    finally { setSavingApiEnv(false); }
  };

  // ── Provider account CRUD ────────────────────────────────────────────────
  const loadAccounts = async (apiId: string) => {
    setAccountsLoadingId(apiId);
    try {
      const res = await apiFetch(`/api/provider-accounts?api_source_id=${apiId}`);
      if (!res.ok) return;
      const data = await res.json();
      setAccountsByApiId((prev) => ({ ...prev, [apiId]: data.accounts || [] }));
    } catch { /* non-critical */ } finally { setAccountsLoadingId(null); }
  };

  const openAddAccountModal = (apiId: string, apiName: string, authType: string) => {
    setAccountError(null);
    setAccountForm({ account_name: '', api_key_env_name: '', api_key_value: '', oauth_client_id: '', oauth_client_secret: '', rate_limit_per_min: '', rate_limit_per_day: '', priority: String((accountsByApiId[apiId]?.length ?? 0) + 1), is_active: true });
    setAccountModal({ apiId, apiName, authType, mode: 'add' });
  };

  const openEditAccountModal = (acct: any, apiId: string, apiName: string, authType: string) => {
    setAccountError(null);
    setAccountForm({ account_name: acct.account_name, api_key_env_name: '', api_key_value: '', oauth_client_id: '', oauth_client_secret: '', rate_limit_per_min: acct.rate_limit_per_min != null ? String(acct.rate_limit_per_min) : '', rate_limit_per_day: acct.rate_limit_per_day != null ? String(acct.rate_limit_per_day) : '', priority: String(acct.priority), is_active: acct.is_active });
    setAccountModal({ apiId, apiName, authType, mode: 'edit', account: acct });
  };

  const saveAccount = async () => {
    if (!accountModal) return;
    if (!accountForm.account_name.trim()) { setAccountError('Account name is required.'); return; }
    setIsSavingAccount(true); setAccountError(null);
    try {
      const credentials: Record<string, string> = {};
      if (accountForm.api_key_env_name.trim()) credentials.api_key_env_name = accountForm.api_key_env_name.trim();
      if (accountForm.api_key_value.trim()) credentials.api_key_value = accountForm.api_key_value.trim();
      if (accountForm.oauth_client_id.trim()) credentials.oauth_client_id = accountForm.oauth_client_id.trim();
      if (accountForm.oauth_client_secret.trim()) credentials.oauth_client_secret = accountForm.oauth_client_secret.trim();
      const body: Record<string, unknown> = { account_name: accountForm.account_name.trim(), credentials, priority: Number(accountForm.priority) || 1, is_active: accountForm.is_active, rate_limit_per_min: accountForm.rate_limit_per_min ? Number(accountForm.rate_limit_per_min) : null, rate_limit_per_day: accountForm.rate_limit_per_day ? Number(accountForm.rate_limit_per_day) : null };
      const res = accountModal.mode === 'add'
        ? await apiFetch('/api/provider-accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, api_source_id: accountModal.apiId }) })
        : await apiFetch(`/api/provider-accounts/${accountModal.account!.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Failed to save'); }
      setAccountModal(null);
      await loadAccounts(accountModal.apiId);
    } catch (err) { setAccountError(err instanceof Error ? err.message : 'Failed to save account'); }
    finally { setIsSavingAccount(false); }
  };

  const deleteAccount = async (accountId: string, apiId: string, accountName: string) => {
    if (!confirm(`Delete account "${accountName}"? This cannot be undone.`)) return;
    try {
      const res = await apiFetch(`/api/provider-accounts/${accountId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      await loadAccounts(apiId);
    } catch { setApiEnvSaveError('Failed to delete account.'); }
  };

  const toggleAccountActive = async (acct: any, apiId: string) => {
    // Optimistic update
    setAccountsByApiId((prev) => ({
      ...prev,
      [apiId]: (prev[apiId] ?? []).map((a: any) => a.id === acct.id ? { ...a, is_active: !acct.is_active } : a),
    }));
    try {
      const res = await apiFetch(`/api/provider-accounts/${acct.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_active: !acct.is_active }) });
      if (!res.ok) throw new Error('Failed to update');
    } catch {
      // Revert on failure
      setAccountsByApiId((prev) => ({
        ...prev,
        [apiId]: (prev[apiId] ?? []).map((a: any) => a.id === acct.id ? { ...a, is_active: acct.is_active } : a),
      }));
      setApiEnvSaveError('Failed to toggle account.');
    }
  };

  const handleAccountDragStart = (id: string) => { setDragSourceId(id); };
  const handleAccountDragOver = (e: React.DragEvent, id: string) => { e.preventDefault(); setDragOverId(id); };
  const handleAccountDrop = async (e: React.DragEvent, targetId: string, apiId: string) => {
    e.preventDefault();
    setDragOverId(null);
    if (!dragSourceId || dragSourceId === targetId) { setDragSourceId(null); return; }
    const accounts = accountsByApiId[apiId] ?? [];
    const srcIdx = accounts.findIndex((a: any) => a.id === dragSourceId);
    const tgtIdx = accounts.findIndex((a: any) => a.id === targetId);
    setDragSourceId(null);
    if (srcIdx === -1 || tgtIdx === -1) return;
    const reordered = [...accounts];
    const [moved] = reordered.splice(srcIdx, 1);
    reordered.splice(tgtIdx, 0, moved);
    const updated = reordered.map((a: any, i: number) => ({ ...a, priority: i + 1 }));
    setAccountsByApiId((prev) => ({ ...prev, [apiId]: updated }));
    for (const acct of updated) {
      await apiFetch(`/api/provider-accounts/${acct.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ priority: acct.priority }) }).catch(() => {});
    }
  };

  useEffect(() => {
    if (catalogApis.length === 0 && !loadingCatalogApis) loadCatalogApis();
  }, []);

  const renderApiCategorySection = (catKey: 'trend' | 'community' | 'llm' | 'image' | 'others') => {
    const knownList = KNOWN_APIS[catKey] || [];
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 rounded-t-lg flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              {{ trend: 'Trend APIs', community: 'Community APIs', llm: 'LLM APIs', image: 'Image APIs', others: 'Other APIs' }[catKey]}
            </h3>
            <p className="text-sm text-gray-500 mt-0.5">
              {{ trend: 'Configure API keys for news, search and trend discovery sources.', community: 'Configure API keys for developer and interest community sources.', llm: 'Configure API keys for large language model providers used across the platform.', image: 'Configure API keys for image generation providers.', others: 'Other API integrations — search, scraping, and AI tools.' }[catKey]}
            </p>
          </div>
          <button onClick={loadCatalogApis} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500" title="Refresh">
            <RefreshCw className={`h-4 w-4 ${loadingCatalogApis ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <div className="divide-y divide-gray-100">
          {knownList.map((known) => {
            const catalogEntry = catalogApis.find((a: any) => a.name === known.name);
            const isInCatalog = !!catalogEntry;
            const isEnabled = catalogEntry?.is_active ?? false;
            const configuredEnvVar = catalogEntry?.api_key_env_name || known.env_var;
            const isExpanded = expandedApiId === known.key;
            const checkResult = apiCheckResults[known.key];
            // Health: prefer real-time check result, fall back to stored health record
            const lastTestStatus = checkResult?.ok !== undefined
              ? (checkResult.ok ? 'ok' : 'error')
              : (catalogEntry?.health?.last_test_status ?? null);
            const everTested = checkResult?.checked_at || catalogEntry?.health?.last_test_at;
            return (
              <div key={known.key} className="px-6 py-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xl shrink-0">{known.icon}</span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-gray-900 text-sm">{known.name}</span>
                        {isInCatalog ? (() => {
                          if (!isEnabled) return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500 border border-gray-200" title="Added but marked inactive — toggle Active and save to enable">Inactive</span>;
                          if (lastTestStatus === 'ok') return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200" title={everTested ? `Last tested ${new Date(everTested).toLocaleString()}` : ''}><CheckCircle className="h-3 w-3" /> Active · Verified</span>;
                          if (lastTestStatus === 'error') return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200" title="Last check failed — verify your API key"><XCircle className="h-3 w-3" /> Key invalid</span>;
                          // active, never tested
                          return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200" title="API key saved and active. Click Check to verify it works."><CheckCircle className="h-3 w-3" /> Active · Not tested yet</span>;
                        })() : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500 border border-gray-200" title="Click Configure to add this API"><XCircle className="h-3 w-3" /> Not configured</span>
                        )}
                        {catalogEntry?.id && (() => {
                          const accts = accountsByApiId[catalogEntry.id];
                          if (!accts || accts.length === 0) return null;
                          const isExhausted = accts.every((a: any) => !a.is_active || (a.rate_limit_per_day != null && a.current_usage_day >= a.rate_limit_per_day));
                          return (<>
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-violet-50 text-violet-700 border border-violet-200">⚡ {accts.length} account{accts.length > 1 ? 's' : ''}</span>
                            {isExhausted && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200" title="All accounts are inactive or have hit their daily rate limit">⚠ All Exhausted</span>}
                          </>);
                        })()}
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">{known.description}</div>
                      {isInCatalog && configuredEnvVar && (
                        <div className="text-xs text-gray-400 mt-0.5 font-mono">env: {configuredEnvVar}</div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {/* Check result pill */}
                    {checkResult && (
                      checkResult.ok
                        ? <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-emerald-50 border border-emerald-200 text-emerald-700" title={checkResult.detail}><CheckCircle className="h-3 w-3" /> {checkResult.detail || 'Live · OK'}</span>
                        : <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-red-50 border border-red-200 text-red-700" title={checkResult.detail}><XCircle className="h-3 w-3" /> {checkResult.detail || 'Check failed'}</span>
                    )}
                    {isInCatalog && (
                      <button
                        onClick={async () => {
                          setCheckingApiId(known.key);
                          try {
                            const r = await apiFetch(`/api/external-apis/${catalogEntry.id}/test?scope=platform`);
                            const d = await r.json().catch(() => ({}));
                            const detail = d.detail || d.error || (r.ok ? `Connection OK${d.response?.status ? ` (${d.response.status})` : ''}` : `Check failed${d.response?.status ? ` — HTTP ${d.response.status}` : ''}`);
                            setApiCheckResults((prev) => ({ ...prev, [known.key]: { ok: r.ok && d.response?.ok !== false, detail, checked_at: new Date().toISOString() } }));
                          } catch { setApiCheckResults((prev) => ({ ...prev, [known.key]: { ok: false, detail: 'Request failed', checked_at: new Date().toISOString() } })); }
                          finally { setCheckingApiId(null); }
                        }}
                        disabled={checkingApiId === known.key}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-gray-50 border border-gray-200 text-gray-600 text-xs font-medium hover:bg-gray-100 transition-colors disabled:opacity-50"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${checkingApiId === known.key ? 'animate-spin' : ''}`} />
                        {checkingApiId === known.key ? 'Checking…' : 'Check'}
                      </button>
                    )}
                    <button
                      onClick={() => {
                        if (isInCatalog) {
                          setExpandedApiId(isExpanded ? null : known.key);
                          if (!isExpanded) {
                            const existingConfig = catalogEntry?.query_params?._config || {};
                            setApiEnvForm({
                              api_key_env_name:    configuredEnvVar || '',
                              is_active:           isEnabled,
                              base_url:            catalogEntry?.base_url || known.base_url,
                              daily_quota:         catalogEntry?.rate_limit_per_min ?? '',
                              _client_id_env:      catalogEntry?.headers?._client_id_env || '',
                              _client_secret_env:  catalogEntry?.headers?._client_secret_env || '',
                              _config:             existingConfig,
                            });
                            if (catalogEntry?.id && accountsByApiId[catalogEntry.id] === undefined) {
                              loadAccounts(catalogEntry.id);
                            }
                          }
                        } else {
                          addAndExpand(known);
                        }
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-medium hover:bg-indigo-100 transition-colors shrink-0"
                    >
                      {isExpanded
                        ? <><ChevronUp className="h-3.5 w-3.5" /> Close</>
                        : <><ChevronDown className="h-3.5 w-3.5" /> {(isInCatalog && configuredEnvVar) ? 'Update' : 'Configure'}</>}
                    </button>
                  </div>
                </div>

                {/* ── Expanded config form ── */}
                {isExpanded && isInCatalog && (
                  <div className="mt-4 bg-gray-50 rounded-lg border border-gray-200 p-4 space-y-3">

                    {/* ── Accounts Section ── */}
                    {catalogEntry?.id && (() => {
                      const apiAccounts = accountsByApiId[catalogEntry.id] ?? null;
                      const hasAccounts = apiAccounts !== null && apiAccounts.length > 0;
                      const isLoadingAccounts = accountsLoadingId === catalogEntry.id;
                      return (
                        <div className="space-y-3 pb-3 border-b border-gray-200">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Accounts</span>
                            <button type="button" onClick={() => openAddAccountModal(catalogEntry.id, known.name, known.auth_type || 'api_key')} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-indigo-300 text-indigo-600 text-xs font-medium hover:bg-indigo-50 transition-colors">+ Add Account</button>
                          </div>
                          {isLoadingAccounts ? (
                            <div className="text-xs text-gray-400 py-1">Loading accounts…</div>
                          ) : hasAccounts ? (
                            <div className="border border-gray-200 rounded-lg overflow-hidden divide-y divide-gray-100 bg-white">
                              {(() => {
                                const mostRecentId = (apiAccounts ?? []).reduce((best: any, a: any) => {
                                  if (!best) return a;
                                  if (!a.last_used_at) return best;
                                  if (!best.last_used_at) return a;
                                  return a.last_used_at > best.last_used_at ? a : best;
                                }, null as any)?.id ?? null;
                                return (apiAccounts ?? []).map((acct: any) => {
                                  const outcomeColor = acct.last_outcome === 'success' ? 'text-green-600' : acct.last_outcome === 'failure' ? 'text-red-500' : 'text-gray-400';
                                  const healthColor = acct.health_score == null ? 'text-gray-400' : acct.health_score >= 0.8 ? 'text-green-600' : acct.health_score >= 0.5 ? 'text-amber-500' : 'text-red-500';
                                  const isCurrentlyActive = acct.id === mostRecentId && acct.last_used_at;
                                  const usagePct = (acct.rate_limit_per_day != null && acct.rate_limit_per_day > 0)
                                    ? Math.min(100, Math.round((acct.current_usage_day ?? 0) / acct.rate_limit_per_day * 100))
                                    : null;
                                  const usageBarColor = usagePct == null ? '' : usagePct >= 90 ? 'bg-red-500' : usagePct >= 70 ? 'bg-amber-400' : 'bg-green-500';
                                  const isDragOver = dragOverId === acct.id && dragSourceId !== acct.id;
                                  return (
                                    <div
                                      key={acct.id}
                                      draggable
                                      onDragStart={() => setDragSourceId(acct.id)}
                                      onDragOver={(e) => { e.preventDefault(); setDragOverId(acct.id); }}
                                      onDrop={(e) => handleAccountDrop(e, acct.id, catalogEntry.id)}
                                      onDragEnd={() => { setDragSourceId(null); setDragOverId(null); }}
                                      className={`px-3 py-2.5 flex flex-col gap-1 text-xs transition-colors ${isDragOver ? 'bg-indigo-50 border-t-2 border-indigo-300' : isCurrentlyActive ? 'bg-emerald-50' : 'bg-white hover:bg-gray-50'} ${dragSourceId === acct.id ? 'opacity-50' : ''}`}
                                    >
                                      <div className="flex items-center gap-3">
                                        <span className="text-gray-300 cursor-grab active:cursor-grabbing flex-shrink-0 select-none" title="Drag to reorder">⠿</span>
                                        <div className="flex items-center gap-1.5 min-w-[100px] flex-shrink-0">
                                          <span className="font-medium text-gray-800 truncate">{acct.account_name}</span>
                                          {isCurrentlyActive && <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-emerald-100 text-emerald-700 border border-emerald-200 flex-shrink-0">● Active</span>}
                                        </div>
                                        <button type="button" onClick={() => toggleAccountActive(acct, catalogEntry.id)} className={`flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-colors ${acct.is_active ? 'bg-green-50 border-green-200 text-green-700 hover:bg-green-100' : 'bg-gray-100 border-gray-200 text-gray-500 hover:bg-gray-200'}`}>{acct.is_active ? 'Active' : 'Inactive'}</button>
                                        <span className="text-gray-400 flex-shrink-0">
                                          <span title="Requests/min">{acct.current_usage_min ?? 0}/min</span>
                                          <span className="mx-1">·</span>
                                          <span title="Requests/day">{acct.current_usage_day ?? 0}/day</span>
                                        </span>
                                        {acct.last_outcome && <span className={`flex-shrink-0 ${outcomeColor}`} title={`Last: ${acct.last_outcome}`}>{acct.last_outcome === 'success' ? '✓' : '✗'} {acct.last_outcome}</span>}
                                        {acct.last_used_at && <span className="text-gray-400 flex-shrink-0 truncate">{(() => { const d = new Date(acct.last_used_at!); const m = Math.floor((Date.now() - d.getTime()) / 60000); return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.floor(m/60)}h ago` : `${Math.floor(m/1440)}d ago`; })()}</span>}
                                        {acct.health_score != null && <span className={`flex-shrink-0 font-medium ${healthColor}`} title="Health score">♥ {Math.round(acct.health_score * 100)}%</span>}
                                        <div className="ml-auto flex items-center gap-1 flex-shrink-0">
                                          <button type="button" onClick={() => openEditAccountModal(acct, catalogEntry.id, known.name, known.auth_type || 'api_key')} className="p-1 text-gray-400 hover:text-indigo-600 transition-colors" title="Edit account">✎</button>
                                          <button type="button" onClick={() => deleteAccount(acct.id, catalogEntry.id, acct.account_name)} className="p-1 text-gray-400 hover:text-red-500 transition-colors" title="Delete account">✕</button>
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
                            <div className="text-xs text-gray-400 py-1.5 border border-dashed border-gray-200 rounded-lg text-center">No accounts yet.</div>
                          )}
                        </div>
                      );
                    })()}

                    {/* ── API Key / Env var (only when no accounts) ── */}
                    {!(accountsByApiId[catalogEntry?.id]?.length > 0) && (
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          API Key Env Var Name
                          <span className="ml-1 font-normal text-gray-400">— set in .env, referenced by name only</span>
                        </label>
                        <input
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
                          placeholder={`e.g. ${known.env_var || 'API_KEY'}`}
                          value={apiEnvForm.api_key_env_name || ''}
                          onChange={(e) => setApiEnvForm((p) => ({ ...p, api_key_env_name: e.target.value }))}
                        />
                      </div>
                    )}

                    {/* ── Trend-specific config ── */}
                    {catKey === 'trend' && (<>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">API Key Env Var <span className="font-normal text-gray-400">— variable name in .env</span></label>
                        <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono" placeholder={known.env_var || 'API_KEY'} value={apiEnvForm.api_key_env_name || ''} onChange={(e) => setApiEnvForm((p) => ({ ...p, api_key_env_name: e.target.value }))} />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Daily Quota <span className="font-normal text-gray-400">— max requests/day (leave blank for unlimited)</span></label>
                        <input type="number" min="0" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="e.g. 100" value={apiEnvForm.daily_quota ?? ''} onChange={(e) => setApiEnvForm((p) => ({ ...p, daily_quota: e.target.value }))} />
                      </div>
                    </>)}

                    {/* ── Community-specific config ── */}
                    {catKey === 'community' && (<>
                      {(known.auth_type === 'none') ? (
                        <div className="text-xs text-gray-500 bg-gray-100 rounded-lg px-3 py-2">No API key needed — this API is publicly accessible.</div>
                      ) : known.key === 'github' ? (
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">GitHub Token <span className="font-normal text-gray-400">— optional, increases rate limit</span></label>
                          <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono" placeholder="GITHUB_TOKEN" value={apiEnvForm.api_key_env_name || ''} onChange={(e) => setApiEnvForm((p) => ({ ...p, api_key_env_name: e.target.value }))} />
                        </div>
                      ) : known.key === 'discord' ? (
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Discord Bot Token <span className="font-normal text-gray-400">— env var name</span></label>
                          <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono" placeholder="DISCORD_BOT_TOKEN" value={apiEnvForm.api_key_env_name || ''} onChange={(e) => setApiEnvForm((p) => ({ ...p, api_key_env_name: e.target.value }))} />
                        </div>
                      ) : null}
                    </>)}

                    {/* ── LLM-specific config ── */}
                    {catKey === 'llm' && (<>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">API Key Env Var <span className="font-normal text-gray-400">— variable name in .env</span></label>
                        <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono" placeholder={known.env_var || 'API_KEY'} value={apiEnvForm.api_key_env_name || ''} onChange={(e) => setApiEnvForm((p) => ({ ...p, api_key_env_name: e.target.value }))} />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Default Model</label>
                        <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="e.g. gpt-4o" value={apiEnvForm._config?.default_model || ''} onChange={(e) => setApiEnvForm((p) => ({ ...p, _config: { ...(p._config || {}), default_model: e.target.value } }))} />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Max Tokens</label>
                          <input type="number" min="1" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="4096" value={apiEnvForm._config?.max_tokens || ''} onChange={(e) => setApiEnvForm((p) => ({ ...p, _config: { ...(p._config || {}), max_tokens: e.target.value } }))} />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Temperature</label>
                          <input type="number" min="0" max="2" step="0.1" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="0.7" value={apiEnvForm._config?.temperature ?? ''} onChange={(e) => setApiEnvForm((p) => ({ ...p, _config: { ...(p._config || {}), temperature: e.target.value } }))} />
                        </div>
                      </div>
                    </>)}

                    {/* ── Image-specific config ── */}
                    {catKey === 'image' && (() => {
                      const IMAGE_MODELS: Record<string, string[]> = {
                        dalle:     ['dall-e-3', 'dall-e-2'],
                        stability: ['stable-diffusion-xl-1024-v1-0', 'stable-diffusion-xl-beta-v2-2-2'],
                        replicate: ['stability-ai/sdxl:c221b2b8ef527988fb59bf24a8b97c4561f1c671f73bd389f866bfbe27c5e1b4'],
                        fal:       ['fal-ai/flux/schnell', 'fal-ai/flux/dev', 'fal-ai/stable-diffusion-xl'],
                      };
                      const IMAGE_SIZES = ['1024x1024', '1792x1024', '1024x1792', '512x512', '256x256'];
                      const models = IMAGE_MODELS[known.key] || [];
                      return (<>
                        {known.key === 'unsplash' ? (<>
                          <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">Access Key <span className="font-normal text-gray-400">— paste the key directly or enter env var name</span></label>
                            <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono" placeholder="Paste key or UNSPLASH_ACCESS_KEY" value={apiEnvForm.api_key_env_name || ''} onChange={(e) => setApiEnvForm((p) => ({ ...p, api_key_env_name: e.target.value, _client_id_env: e.target.value }))} />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">Secret Key <span className="font-normal text-gray-400">— paste the key directly or enter env var name</span></label>
                            <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono" placeholder="Paste key or UNSPLASH_SECRET_KEY" value={apiEnvForm._client_secret_env || ''} onChange={(e) => setApiEnvForm((p) => ({ ...p, _client_secret_env: e.target.value }))} />
                          </div>
                        </>) : (
                          <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">API Key <span className="font-normal text-gray-400">— paste the key directly or enter env var name</span></label>
                            <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono" placeholder={`Paste key or ${known.env_var || 'API_KEY'}`} value={apiEnvForm.api_key_env_name || ''} onChange={(e) => setApiEnvForm((p) => ({ ...p, api_key_env_name: e.target.value }))} />
                          </div>
                        )}
                        {/* Model / size — not applicable to stock photo APIs */}
                        {!['unsplash', 'pixabay', 'pexels'].includes(known.key) && (<>
                          {models.length > 0 ? (
                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">Default Model</label>
                              <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" value={apiEnvForm._config?.default_model || models[0]} onChange={(e) => setApiEnvForm((p) => ({ ...p, _config: { ...(p._config || {}), default_model: e.target.value } }))}>
                                {models.map((m) => <option key={m} value={m}>{m}</option>)}
                              </select>
                            </div>
                          ) : (
                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">Default Model / Version</label>
                              <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="e.g. stable-diffusion-xl-base-1.0" value={apiEnvForm._config?.default_model || ''} onChange={(e) => setApiEnvForm((p) => ({ ...p, _config: { ...(p._config || {}), default_model: e.target.value } }))} />
                            </div>
                          )}
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">Default Size</label>
                              <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" value={apiEnvForm._config?.default_size || '1024x1024'} onChange={(e) => setApiEnvForm((p) => ({ ...p, _config: { ...(p._config || {}), default_size: e.target.value } }))}>
                                {IMAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
                              </select>
                            </div>
                            {known.key === 'dalle' && (
                              <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">Quality</label>
                                <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" value={apiEnvForm._config?.quality || 'standard'} onChange={(e) => setApiEnvForm((p) => ({ ...p, _config: { ...(p._config || {}), quality: e.target.value } }))}>
                                  <option value="standard">Standard</option>
                                  <option value="hd">HD</option>
                                </select>
                              </div>
                            )}
                          </div>
                        </>)}
                      </>);
                    })()}

                    {/* ── Others ── */}
                    {catKey === 'others' && (<>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">API Key Env Var <span className="font-normal text-gray-400">— variable name in .env</span></label>
                        <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono" placeholder={known.env_var || 'API_KEY'} value={apiEnvForm.api_key_env_name || ''} onChange={(e) => setApiEnvForm((p) => ({ ...p, api_key_env_name: e.target.value }))} />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Base URL <span className="font-normal text-gray-400">— override endpoint if needed</span></label>
                        <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono" placeholder={known.base_url} value={apiEnvForm.base_url || ''} onChange={(e) => setApiEnvForm((p) => ({ ...p, base_url: e.target.value }))} />
                      </div>
                    </>)}

                    {/* Active toggle — always shown */}
                    <div className="flex items-center gap-2">
                      <input type="checkbox" id={`active-${known.key}`} checked={!!apiEnvForm.is_active} onChange={(e) => setApiEnvForm((p) => ({ ...p, is_active: e.target.checked }))} className="rounded border-gray-300" />
                      <label htmlFor={`active-${known.key}`} className="text-xs text-gray-700">Active (available for use across the platform)</label>
                    </div>

                    {apiEnvSaveError && (
                      <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{apiEnvSaveError}</div>
                    )}
                    <div className="flex gap-2 pt-1">
                      <button onClick={() => { setExpandedApiId(null); setApiEnvSaveError(null); }} className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 text-sm hover:bg-gray-50">Cancel</button>
                      <button onClick={() => saveApiEnvConfig(catalogEntry, known)} disabled={savingApiEnv} className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">{savingApiEnv ? 'Saving…' : 'Save'}</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <>
      {apiEnvSaveError && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-6 py-4 flex items-center justify-between">
          <span className="text-sm text-red-700">{apiEnvSaveError}</span>
          <button onClick={() => setApiEnvSaveError(null)} className="ml-4 text-red-400 hover:text-red-600 text-lg font-bold">×</button>
        </div>
      )}
      {renderApiCategorySection(categoryKey)}
      {accountModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-gray-900">{accountModal.mode === 'add' ? 'Add Account' : 'Edit Account'}</h3>
                <p className="text-xs text-gray-500 mt-0.5">{accountModal.apiName}</p>
              </div>
              <button type="button" onClick={() => setAccountModal(null)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
            </div>
            <div className="px-6 py-4 space-y-4">
              {accountError && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{accountError}</div>}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Account Name *</label>
                <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="e.g. Primary Account, Account #2" value={accountForm.account_name} onChange={(e) => setAccountForm((p) => ({ ...p, account_name: e.target.value }))} />
              </div>
              {(accountModal.authType === 'bearer' || accountModal.authType === 'api_key' || accountModal.authType === 'query' || accountModal.authType === 'query_param') && (<>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">API Key Env Var Name <span className="font-normal text-gray-400">— name of .env variable</span></label>
                  <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono" placeholder="e.g. YOUTUBE_API_KEY_2" value={accountForm.api_key_env_name} onChange={(e) => setAccountForm((p) => ({ ...p, api_key_env_name: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">API Key Value <span className="font-normal text-gray-400">— stored encrypted</span></label>
                  <input type="password" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder={accountModal.mode === 'edit' ? '(unchanged)' : 'Enter API key'} value={accountForm.api_key_value} onChange={(e) => setAccountForm((p) => ({ ...p, api_key_value: e.target.value }))} />
                </div>
              </>)}
              {accountModal.authType === 'oauth2' && (<>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">OAuth Client ID</label>
                  <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono" placeholder="OAuth2 Client ID" value={accountForm.oauth_client_id} onChange={(e) => setAccountForm((p) => ({ ...p, oauth_client_id: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">OAuth Client Secret</label>
                  <input type="password" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder={accountModal.mode === 'edit' ? '(unchanged)' : 'Client Secret'} value={accountForm.oauth_client_secret} onChange={(e) => setAccountForm((p) => ({ ...p, oauth_client_secret: e.target.value }))} />
                </div>
              </>)}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Priority</label>
                  <input type="number" min="1" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="1" value={accountForm.priority} onChange={(e) => setAccountForm((p) => ({ ...p, priority: e.target.value }))} />
                  <p className="text-[10px] text-gray-400 mt-1">Lower = tried first</p>
                </div>
                <div className="flex items-center gap-2 pt-5">
                  <input type="checkbox" id="sa-acct-active" checked={accountForm.is_active} onChange={(e) => setAccountForm((p) => ({ ...p, is_active: e.target.checked }))} className="rounded border-gray-300" />
                  <label htmlFor="sa-acct-active" className="text-xs text-gray-700">Active</label>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Rate Limit / min</label>
                  <input type="number" min="0" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="e.g. 60" value={accountForm.rate_limit_per_min} onChange={(e) => setAccountForm((p) => ({ ...p, rate_limit_per_min: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Rate Limit / day</label>
                  <input type="number" min="0" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="e.g. 10000" value={accountForm.rate_limit_per_day} onChange={(e) => setAccountForm((p) => ({ ...p, rate_limit_per_day: e.target.value }))} />
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-3">
              <button type="button" onClick={() => setAccountModal(null)} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
              <button type="button" onClick={saveAccount} disabled={isSavingAccount} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
                {isSavingAccount ? 'Saving…' : accountModal.mode === 'add' ? 'Add Account' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
