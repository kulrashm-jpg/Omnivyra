import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCompanyContext } from '../components/CompanyContext';
import { getAuthToken } from '../utils/getAuthToken';
import {
  ArrowLeft,
  BarChart3,
  Eye,
  Users,
  Activity,
  Key,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  XCircle,
  Search,
  Trash2,
  TrendingUp,
  FileText,
  DollarSign,
  Coins,
  Globe,
  Save,
  ChevronDown,
  ChevronUp,
  EyeOff,
  Copy,
  Check,
} from 'lucide-react';

interface DeletionAudit {
  id: string;
  user_id: string;
  user_name: string;
  user_role: string;
  action: string;
  table_name: string;
  record_id: string;
  reason: string;
  ip_address: string;
  created_at: string;
}

interface CompanyData {
  id: string;
  name: string;
  website: string;
  industry?: string | null;
  status: string;
  created_at: string;
}

interface AppUserData {
  user_id: string;
  email: string;
  company_id: string;
  company_name: string;
  role: string;
  status?: string | null;
  created_at: string;
}

type RbacPermissions = Record<string, string[]>;

interface PlatformAnalyticsRow {
  platform: string;
  total_posts: number;
  total_engagement: number;
  total_reach: number;
  avg_engagement_rate: number;
}

interface AnalyticsSummary {
  total_posts: number;
  total_engagement: number;
  total_reach: number;
  avg_engagement_rate: number;
  platforms: PlatformAnalyticsRow[];
}

interface CampaignHealthCompanyRow {
  company_id: string;
  total_campaigns: number;
  active_campaigns: number;
  reapproval_required: number;
}

interface CampaignHealthSummary {
  total_campaigns: number;
  active_campaigns: number;
  approved_strategies: number;
  proposed_strategies: number;
  reapproval_required_count: number;
  campaigns_by_company: CampaignHealthCompanyRow[];
}

const roleOptions = [
  { id: 'COMPANY_ADMIN', name: 'Company Admin' },
  { id: 'CONTENT_CREATOR', name: 'Content Creator' },
  { id: 'CONTENT_REVIEWER', name: 'Content Reviewer' },
  { id: 'CONTENT_PUBLISHER', name: 'Content Publisher' },
  { id: 'VIEW_ONLY', name: 'View Only' },
];

interface CommunityAiMetrics {
  total_actions: number;
  total_actions_executed: number;
  playbooks_count: number;
  auto_rules_count: number;
  actions_by_tenant: Array<{ tenant_id: string; total_actions: number }>;
}

interface CommunityAiPolicy {
  execution_enabled: boolean;
  auto_rules_enabled: boolean;
  require_human_approval: boolean;
  updated_at: string | null;
  updated_by: string | null;
}

export default function SuperAdminPanel() {
  const router = useRouter();
  const { userRole } = useCompanyContext();
  const isSuperAdmin = userRole === 'SUPER_ADMIN';
  const [isSuperAdminSession, setIsSuperAdminSession] = useState(false);
  const isSuperAdminRoute = router.pathname?.startsWith('/super-admin');
  const canShowExternalApisTab = isSuperAdminRoute || isSuperAdmin || isSuperAdminSession;
  useEffect(() => {
    if (canShowExternalApisTab) {
      console.debug('Super Admin External API tab visible', userRole);
    }
  }, [canShowExternalApisTab, userRole]);
  const [activeTab, setActiveTab] = useState('analytics');
  const [analyticsSubTab, setAnalyticsSubTab] = useState<'overview' | 'campaign-health'>('overview');
  const [companySubTab, setCompanySubTab] = useState<'users' | 'rbac'>('users');
  const [plansSubTab, setPlansSubTab] = useState<'plans' | 'consumption'>('plans');
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingAnalytics, setIsLoadingAnalytics] = useState(false);
  const [analyticsSummary, setAnalyticsSummary] = useState<AnalyticsSummary | null>(null);
  const [campaignHealth, setCampaignHealth] = useState<CampaignHealthSummary | null>(null);
  const [isLoadingCampaignHealth, setIsLoadingCampaignHealth] = useState(false);
  const [auditLogs, setAuditLogs] = useState<DeletionAudit[]>([]);
  const [companies, setCompanies] = useState<CompanyData[]>([]);
  const [appUsers, setAppUsers] = useState<AppUserData[]>([]);
  const [communityMetrics, setCommunityMetrics] = useState<CommunityAiMetrics | null>(null);
  const [communityPolicy, setCommunityPolicy] = useState<CommunityAiPolicy | null>(null);
  const [communityPolicyUpdatedBy, setCommunityPolicyUpdatedBy] = useState<string | null>(null);
  const [rbacRoles, setRbacRoles] = useState<string[]>([]);
  const [rbacPermissions, setRbacPermissions] = useState<RbacPermissions>({});
  const [rbacError, setRbacError] = useState<string | null>(null);
  const [rbacDraftPermissions, setRbacDraftPermissions] = useState<RbacPermissions>({});
  const [rbacDirty, setRbacDirty] = useState(false);
  const [rbacSaveError, setRbacSaveError] = useState<string | null>(null);
  const [rbacSaveSuccess, setRbacSaveSuccess] = useState<string | null>(null);
  const [isSavingRbac, setIsSavingRbac] = useState(false);
  const [newPermissionKey, setNewPermissionKey] = useState('');
  const [newPermissionRoles, setNewPermissionRoles] = useState<string[]>([]);
  const [isSavingPolicy, setIsSavingPolicy] = useState(false);
  const [showPolicyConfirm, setShowPolicyConfirm] = useState(false);
  const [pendingPolicy, setPendingPolicy] = useState<CommunityAiPolicy | null>(null);
  const [pendingPolicyLabel, setPendingPolicyLabel] = useState('');
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  // Social platform OAuth config state
  const OAUTH_PLATFORMS = [
    { platform_key: 'linkedin',  platform_label: 'LinkedIn',     configured: false, enabled: false, client_id_preview: '', has_client_secret: false, updated_at: null },
    { platform_key: 'twitter',   platform_label: 'X (Twitter)',  configured: false, enabled: false, client_id_preview: '', has_client_secret: false, updated_at: null },
    { platform_key: 'youtube',   platform_label: 'YouTube',      configured: false, enabled: false, client_id_preview: '', has_client_secret: false, updated_at: null },
    { platform_key: 'instagram', platform_label: 'Instagram',    configured: false, enabled: false, client_id_preview: '', has_client_secret: false, updated_at: null },
    { platform_key: 'facebook',  platform_label: 'Facebook',     configured: false, enabled: false, client_id_preview: '', has_client_secret: false, updated_at: null },
    { platform_key: 'tiktok',    platform_label: 'TikTok',       configured: false, enabled: false, client_id_preview: '', has_client_secret: false, updated_at: null },
    { platform_key: 'pinterest', platform_label: 'Pinterest',    configured: false, enabled: false, client_id_preview: '', has_client_secret: false, updated_at: null },
    { platform_key: 'reddit',    platform_label: 'Reddit',       configured: false, enabled: false, client_id_preview: '', has_client_secret: false, updated_at: null },
  ];
  const [socialPlatforms, setSocialPlatforms] = useState<any[]>(OAUTH_PLATFORMS);
  const [loadingSocialPlatforms, setLoadingSocialPlatforms] = useState(false);
  const [expandedPlatform, setExpandedPlatform] = useState<string | null>(null);
  const [oauthForm, setOauthForm] = useState<Record<string, { client_id: string; client_secret: string; enabled: boolean }>>(
    Object.fromEntries(OAUTH_PLATFORMS.map((p) => [p.platform_key, { client_id: '', client_secret: '', enabled: false }]))
  );
  const [savingOauth, setSavingOauth] = useState<string | null>(null);
  const [oauthSaveMsg, setOauthSaveMsg] = useState<{ platform: string; type: 'success' | 'error'; text: string } | null>(null);
  const [showSecretFor, setShowSecretFor] = useState<string | null>(null);
  const [copiedRedirectFor, setCopiedRedirectFor] = useState<string | null>(null);
  const [checkingPlatform, setCheckingPlatform] = useState<string | null>(null);
  const [platformCheckResults, setPlatformCheckResults] = useState<Record<string, { credentials_ok: boolean; token_ok: boolean | null; token_detail: string | null; checked_at: string } | null>>({});
  const [pricingPlans, setPricingPlans] = useState<Array<{ id: string; plan_key: string; name: string; description?: string | null; monthly_price?: number | null }>>([]);
  const [plansLimits, setPlansLimits] = useState<Record<string, Record<string, number | null>>>({});
  const [plansDraftLimits, setPlansDraftLimits] = useState<Record<string, Record<string, string>>>({});
  const [isSavingPlan, setIsSavingPlan] = useState<string | null>(null);
  const [plansSaveError, setPlansSaveError] = useState<string | null>(null);
  const [plansSaveSuccess, setPlansSaveSuccess] = useState<string | null>(null);
  const [externalApisHealth, setExternalApisHealth] = useState<{ healthy: number; warning: number; failed: number; status: string } | null>(null);
  const [apiSubTab, setApiSubTab] = useState<'social' | 'trend' | 'community' | 'llm' | 'image' | 'others'>('social');
  const [catalogApis, setCatalogApis] = useState<any[]>([]);
  const [loadingCatalogApis, setLoadingCatalogApis] = useState(false);
  const [expandedApiId, setExpandedApiId] = useState<string | null>(null);
  const [apiEnvForm, setApiEnvForm] = useState<Record<string, any>>({ api_key_env_name: '', is_active: true });
  const [savingApiEnv, setSavingApiEnv] = useState(false);
  const [checkingApiId, setCheckingApiId] = useState<string | null>(null);
  const [apiCheckResults, setApiCheckResults] = useState<Record<string, { ok: boolean; detail: string; checked_at: string }>>({});
  const [showCreateCompanyModal, setShowCreateCompanyModal] = useState(false);
  const [showCreateCompanyAdminModal, setShowCreateCompanyAdminModal] = useState(false);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [companySearch, setCompanySearch] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [showAllUsers, setShowAllUsers] = useState(true);
  const [companyForm, setCompanyForm] = useState({
    name: '',
    website: '',
    industry: '',
  });
  const [companyAdminForm, setCompanyAdminForm] = useState({
    email: '',
    companyId: '',
    role: 'COMPANY_ADMIN',
  });
  const fetchWithAuth = async (input: RequestInfo, init?: RequestInit) => {
    const token = await getAuthToken();
    return fetch(input, {
      ...init,
      credentials: 'include', // always send cookies (super_admin_session) alongside Bearer token
      headers: {
        ...(init?.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  };

  const loadSocialPlatforms = async () => {
    setLoadingSocialPlatforms(true);
    try {
      const r = await fetchWithAuth('/api/super-admin/platform-oauth-configs');
      if (r.ok) {
        const data = await r.json();
        const apiPlatforms: any[] = data.platforms || [];
        if (apiPlatforms.length > 0) {
          // Merge API-enriched status into our always-visible list
          setSocialPlatforms((prev) =>
            prev.map((p) => {
              const fromApi = apiPlatforms.find((a: any) => a.platform_key === p.platform_key);
              return fromApi ? { ...p, ...fromApi } : p;
            })
          );
          setOauthForm((prev) => {
            const next = { ...prev };
            for (const p of apiPlatforms) {
              // Default to enabled=true for platforms that already have credentials saved
              next[p.platform_key] = { client_id: p.client_id || '', client_secret: p.client_secret || '', enabled: p.configured ? (p.enabled ?? true) : true };
            }
            return next;
          });
        }
      }
    } catch (e) { console.error('Failed to load platform OAuth configs', e); }
    finally { setLoadingSocialPlatforms(false); }
  };

  const checkPlatformConfig = async (platformKey: string) => {
    setCheckingPlatform(platformKey);
    try {
      const r = await fetchWithAuth(`/api/social-accounts/verify-config?platform=${platformKey}`);
      if (r.ok) {
        const data = await r.json();
        setPlatformCheckResults((prev) => ({ ...prev, [platformKey]: data }));
      }
    } catch (e) {
      console.error('Check failed', e);
    } finally {
      setCheckingPlatform(null);
    }
  };

  const saveOauthConfig = async (platformKey: string) => {
    const form = oauthForm[platformKey];
    const alreadyConfigured = socialPlatforms.find((p) => p.platform_key === platformKey)?.configured ?? false;

    // If no client_id entered but credentials already exist, allow enabled-only toggle
    if (!form?.client_id && !alreadyConfigured) {
      setOauthSaveMsg({ platform: platformKey, type: 'error', text: 'Client ID is required' });
      return;
    }
    setSavingOauth(platformKey);
    setOauthSaveMsg(null);
    try {
      const body: Record<string, unknown> = { platform: platformKey, enabled: form.enabled };
      if (form.client_id) {
        body.client_id = form.client_id;
        body.client_secret = form.client_secret;
      }
      const r = await fetchWithAuth('/api/super-admin/platform-oauth-configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (r.ok) {
        setOauthSaveMsg({ platform: platformKey, type: 'success', text: 'Saved successfully' });
        loadSocialPlatforms();
        setExpandedPlatform(null);
      } else {
        const err = await r.json().catch(() => ({}));
        setOauthSaveMsg({ platform: platformKey, type: 'error', text: err.error || 'Failed to save' });
      }
    } catch (e: any) {
      setOauthSaveMsg({ platform: platformKey, type: 'error', text: e.message });
    } finally {
      setSavingOauth(null);
    }
  };

  useEffect(() => {
    loadSuperAdminData();
  }, []);

  const loadCatalogApis = async () => {
    setLoadingCatalogApis(true);
    try {
      const r = await fetchWithAuth('/api/external-apis?scope=platform');
      if (r.ok) { const d = await r.json(); setCatalogApis(d.apis || []); }
    } catch (e) { console.error('loadCatalogApis', e); }
    finally { setLoadingCatalogApis(false); }
  };

  const addApiToCatalog = async (known: { name: string; env_var: string | null; base_url: string; auth_type: string }) => {
    try {
      const r = await fetchWithAuth('/api/external-apis?scope=platform', {
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
    try {
      const r = await fetchWithAuth('/api/external-apis?scope=platform', {
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
      }
    } catch (e) { console.error('addAndExpand', e); }
    finally { setCheckingApiId(null); }
  };

  const saveApiEnvConfig = async (catalogEntry: any, known?: any) => {
    setSavingApiEnv(true);
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

      const r = await fetchWithAuth(`/api/external-apis/${catalogEntry.id}?scope=platform`, {
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
      if (r.ok) { setExpandedApiId(null); await loadCatalogApis(); }
    } catch (e) { console.error('saveApiEnvConfig', e); }
    finally { setSavingApiEnv(false); }
  };

  useEffect(() => {
    if (activeTab === 'social-platforms') {
      if (socialPlatforms.length === 0 && !loadingSocialPlatforms) loadSocialPlatforms();
      if (catalogApis.length === 0 && !loadingCatalogApis) loadCatalogApis();
    }
  }, [activeTab]);

  useEffect(() => {
    setRbacDraftPermissions(rbacPermissions || {});
    setRbacDirty(false);
  }, [rbacPermissions]);

  const loadSuperAdminData = async () => {
    setIsLoading(true);
    setIsLoadingAnalytics(true);
    setIsLoadingCampaignHealth(true);
    try {
      // Load audit logs
      const auditResponse = await fetchWithAuth('/api/admin/audit-logs');
      if (auditResponse.ok) {
        const auditData = await auditResponse.json();
        setAuditLogs(auditData.logs || []);
        setIsSuperAdminSession(true);
      }

      const analyticsResponse = await fetchWithAuth('/api/super-admin/analytics-summary');
      if (analyticsResponse.ok) {
        const analyticsData = await analyticsResponse.json();
        setAnalyticsSummary(analyticsData || null);
        setIsSuperAdminSession(true);
      } else {
        setAnalyticsSummary(null);
      }

      const healthResponse = await fetchWithAuth('/api/super-admin/campaign-health');
      if (healthResponse.ok) {
        const healthData = await healthResponse.json();
        setCampaignHealth(healthData || null);
        setIsSuperAdminSession(true);
      } else {
        setCampaignHealth(null);
      }

      // Load companies
      const companiesResponse = await fetchWithAuth('/api/super-admin/companies');
      if (companiesResponse.ok) {
        const companiesData = await companiesResponse.json();
        setCompanies(companiesData.companies || []);
        setIsSuperAdminSession(true);
      }

      // Load users
      const usersResponse = await fetchWithAuth('/api/super-admin/users');
      if (usersResponse.ok) {
        const usersData = await usersResponse.json();
        setAppUsers(usersData.users || []);
        setIsSuperAdminSession(true);
      }

      // Load Community-AI metrics
      const communityResponse = await fetchWithAuth('/api/super-admin/community-ai-metrics');
      if (communityResponse.ok) {
        const communityData = await communityResponse.json();
        setCommunityMetrics(communityData || null);
        setIsSuperAdminSession(true);
      }

      const policyResponse = await fetchWithAuth('/api/super-admin/community-ai-policy');
      if (policyResponse.ok) {
        const policyData = await policyResponse.json();
        setCommunityPolicy(policyData?.policy || null);
        setCommunityPolicyUpdatedBy(policyData?.updated_by_email || null);
        setIsSuperAdminSession(true);
      }

      const rbacResponse = await fetchWithAuth('/api/super-admin/rbac');
      if (rbacResponse.ok) {
        const rbacData = await rbacResponse.json();
        setRbacRoles(rbacData?.roles || []);
        setRbacPermissions(rbacData?.permissions || {});
        setRbacError(null);
        setIsSuperAdminSession(true);
      } else {
        let message = 'Failed to load RBAC configuration';
        try {
          const body = await rbacResponse.json();
          if (body?.error === 'NOT_AUTHORIZED' || body?.error === 'FORBIDDEN_ROLE') {
            message = 'Access denied. Please log in again from the Super Admin login page.';
          } else if (body?.message) {
            message = body.message;
          } else if (body?.error) {
            message = String(body.error);
          }
        } catch {
          if (rbacResponse.status === 403) {
            message = 'Access denied. Please log in again from the Super Admin login page.';
          }
        }
        setRbacError(message);
      }

      const healthRes = await fetchWithAuth('/api/external-apis/health-summary');
      if (healthRes.ok) {
        const healthData = await healthRes.json();
        setExternalApisHealth(healthData);
      } else {
        setExternalApisHealth(null);
      }

      const plansRes = await fetchWithAuth('/api/super-admin/plans/list');
      if (plansRes.ok) {
        const plansData = await plansRes.json();
        setPricingPlans(plansData.plans || []);
        setPlansLimits(plansData.limitsByPlan || {});
        const draft: Record<string, Record<string, string>> = {};
        for (const plan of plansData.plans || []) {
          const lims = plansData.limitsByPlan?.[plan.id] || {};
          draft[plan.id] = {
            llm_tokens: lims.llm_tokens != null ? String(lims.llm_tokens) : '',
            external_api_calls: lims.external_api_calls != null ? String(lims.external_api_calls) : '',
            automation_executions: lims.automation_executions != null ? String(lims.automation_executions) : '',
            max_campaign_duration_weeks: lims.max_campaign_duration_weeks != null ? String(lims.max_campaign_duration_weeks) : '',
          };
        }
        setPlansDraftLimits(draft);
      } else {
        setPricingPlans([]);
        setPlansLimits({});
        setPlansDraftLimits({});
      }
    } catch (error) {
      console.error('Error loading super admin data:', error);
      setAnalyticsSummary(null);
      setCampaignHealth(null);
    } finally {
      setIsLoading(false);
      setIsLoadingAnalytics(false);
      setIsLoadingCampaignHealth(false);
    }
  };

  const defaultPolicy: CommunityAiPolicy = {
    execution_enabled: true,
    auto_rules_enabled: true,
    require_human_approval: false,
    updated_at: null,
    updated_by: null,
  };

  const normalizePermissionKey = (value: string) =>
    value.trim().toUpperCase().replace(/\s+/g, '_');

  const togglePermissionRole = (permission: string, role: string) => {
    setRbacDraftPermissions((prev) => {
      const current = prev[permission] || [];
      const isAllRoles = current.includes('*');
      let nextRoles = current;
      if (role === '*') {
        nextRoles = isAllRoles ? [] : ['*'];
      } else {
        const cleaned = current.filter((entry) => entry !== '*');
        nextRoles = cleaned.includes(role)
          ? cleaned.filter((entry) => entry !== role)
          : [...cleaned, role];
      }
      return { ...prev, [permission]: nextRoles };
    });
    setRbacDirty(true);
  };

  const toggleNewPermissionRole = (role: string) => {
    setNewPermissionRoles((prev) => {
      const isAllRoles = prev.includes('*');
      if (role === '*') {
        return isAllRoles ? [] : ['*'];
      }
      const cleaned = prev.filter((entry) => entry !== '*');
      return cleaned.includes(role)
        ? cleaned.filter((entry) => entry !== role)
        : [...cleaned, role];
    });
  };

  const handleAddPermission = () => {
    const key = normalizePermissionKey(newPermissionKey);
    if (!key) {
      alert('Permission key is required.');
      return;
    }
    if (rbacDraftPermissions[key]) {
      alert('That permission already exists.');
      return;
    }
    setRbacDraftPermissions((prev) => ({
      ...prev,
      [key]: newPermissionRoles.length ? newPermissionRoles : [],
    }));
    setNewPermissionKey('');
    setNewPermissionRoles([]);
    setRbacDirty(true);
  };

  const handleRemovePermission = (permission: string) => {
    if (!confirm(`Delete permission ${permission}? This cannot be undone.`)) return;
    setRbacDraftPermissions((prev) => {
      const next = { ...prev };
      delete next[permission];
      return next;
    });
    setRbacDirty(true);
  };

  const handleResetRbac = () => {
    setRbacDraftPermissions(rbacPermissions || {});
    setRbacDirty(false);
    setRbacSaveError(null);
    setRbacSaveSuccess(null);
    setNewPermissionKey('');
    setNewPermissionRoles([]);
  };

  const handleSaveRbac = async () => {
    if (!rbacDirty) return;
    setIsSavingRbac(true);
    setRbacSaveError(null);
    setRbacSaveSuccess(null);
    try {
      const response = await fetchWithAuth('/api/super-admin/rbac', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roles: displayRoles,
          permissions: rbacDraftPermissions,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result?.error || 'Failed to update RBAC configuration');
      }
      setRbacRoles(result?.roles || displayRoles);
      setRbacPermissions(result?.permissions || rbacDraftPermissions);
      setRbacSaveSuccess('RBAC permissions updated.');
      setRbacDirty(false);
    } catch (error: any) {
      setRbacSaveError(error?.message || 'Failed to update RBAC configuration');
    } finally {
      setIsSavingRbac(false);
    }
  };

  const openPolicyConfirm = (key: keyof CommunityAiPolicy, label: string) => {
    const basePolicy = communityPolicy || defaultPolicy;
    const nextPolicy = { ...basePolicy, [key]: !basePolicy[key] };
    setPendingPolicy(nextPolicy);
    setPendingPolicyLabel(label);
    setShowPolicyConfirm(true);
  };

  const savePolicy = async () => {
    if (!pendingPolicy) return;
    setIsSavingPolicy(true);
    try {
      const response = await fetchWithAuth('/api/super-admin/community-ai-policy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          execution_enabled: pendingPolicy.execution_enabled,
          auto_rules_enabled: pendingPolicy.auto_rules_enabled,
          require_human_approval: pendingPolicy.require_human_approval,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result?.error || 'Failed to update policy');
      }
      setCommunityPolicy(result?.policy || null);
      setCommunityPolicyUpdatedBy(result?.updated_by_email || null);
      alert('Community-AI platform policy updated.');
    } catch (error: any) {
      console.error('Error updating platform policy:', error);
      alert(error?.message || 'Failed to update platform policy');
    } finally {
      setIsSavingPolicy(false);
      setShowPolicyConfirm(false);
      setPendingPolicy(null);
      setPendingPolicyLabel('');
    }
  };

  const setPlanDraftLimit = (planId: string, resourceKey: string, value: string) => {
    setPlansDraftLimits((prev) => ({
      ...prev,
      [planId]: {
        ...(prev[planId] || {}),
        [resourceKey]: value,
      },
    }));
    setPlansSaveError(null);
    setPlansSaveSuccess(null);
  };

  const handleSavePlanLimits = async (plan: { id: string; plan_key: string; name: string; description?: string | null; monthly_price?: number | null }) => {
    setIsSavingPlan(plan.id);
    setPlansSaveError(null);
    setPlansSaveSuccess(null);
    try {
      const draft = plansDraftLimits[plan.id] || {};
      const limits: Record<string, number | null> = {};
      for (const key of ['llm_tokens', 'external_api_calls', 'automation_executions', 'max_campaign_duration_weeks']) {
        const v = draft[key];
        if (v == null || String(v).trim() === '') {
          limits[key] = null;
        } else {
          const n = parseInt(String(v).trim(), 10);
          limits[key] = Number.isFinite(n) ? n : null;
        }
      }
      const response = await fetchWithAuth('/api/super-admin/plans/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan_key: plan.plan_key,
          name: plan.name,
          description: plan.description ?? null,
          monthly_price: plan.monthly_price ?? null,
          limits,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result?.error || 'Failed to update plan');
      }
      setPlansSaveSuccess(`${plan.name} limits updated.`);
      setPlansLimits((prev) => ({
        ...prev,
        [plan.id]: limits,
      }));
    } catch (error: unknown) {
      setPlansSaveError(error instanceof Error ? error.message : 'Failed to update plan');
    } finally {
      setIsSavingPlan(null);
    }
  };

  const handleCreateCompany = async () => {
    if (!companyForm.name.trim() || !companyForm.website.trim()) {
      alert('Company name and website are required');
      return;
    }
    setIsLoading(true);
    try {
      const response = await fetchWithAuth('/api/super-admin/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: companyForm.name,
          website: companyForm.website,
          industry: companyForm.industry,
        }),
      });
      if (response.ok) {
        setCompanyForm({ name: '', website: '', industry: '' });
        setShowCreateCompanyModal(false);
        loadSuperAdminData();
      } else {
        const result = await response.json();
        alert(result.error || 'Failed to create company');
      }
    } catch (error) {
      console.error('Error creating company:', error);
      alert('Failed to create company');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateCompanyAdmin = async () => {
    if (!companyAdminForm.email.trim() || !companyAdminForm.companyId) {
      alert('Email and company are required');
      return;
    }
    setIsLoading(true);
    try {
      const response = await fetchWithAuth('/api/super-admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: companyAdminForm.email,
          companyId: companyAdminForm.companyId,
          role: companyAdminForm.role,
        }),
      });
      if (response.ok) {
        setCompanyAdminForm({ email: '', companyId: '', role: 'COMPANY_ADMIN' });
        setShowCreateCompanyAdminModal(false);
        loadSuperAdminData();
      } else {
        const result = await response.json();
        alert(result.error || 'Failed to create company admin');
      }
    } catch (error) {
      console.error('Error creating company admin:', error);
      alert('Failed to create company admin');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCompanyStatusChange = async (companyId: string, nextStatus: 'active' | 'inactive') => {
    if (!confirm(`Are you sure you want to mark this company as ${nextStatus}?`)) {
      return;
    }
    setIsLoading(true);
    try {
      const response = await fetchWithAuth('/api/super-admin/companies', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, status: nextStatus }),
      });
      if (!response.ok) {
        const result = await response.json();
        alert(result.error || 'Failed to update company status');
        return;
      }
      await loadSuperAdminData();
    } catch (error) {
      console.error('Error updating company status:', error);
      alert('Failed to update company status');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteCompany = async (companyId: string) => {
    if (!confirm('Delete this company and all its user roles? This cannot be undone.')) {
      return;
    }
    setIsLoading(true);
    try {
      const response = await fetchWithAuth('/api/super-admin/companies', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId }),
      });
      if (!response.ok) {
        const result = await response.json();
        alert(result.error || 'Failed to delete company');
        return;
      }
      if (selectedCompanyId === companyId) {
        setSelectedCompanyId(null);
      }
      await loadSuperAdminData();
    } catch (error) {
      console.error('Error deleting company:', error);
      alert('Failed to delete company');
    } finally {
      setIsLoading(false);
    }
  };

  const handleUserStatusChange = async (
    userId: string,
    companyId: string,
    nextStatus: 'active' | 'inactive'
  ) => {
    if (!confirm(`Are you sure you want to mark this user as ${nextStatus}?`)) {
      return;
    }
    setIsLoading(true);
    try {
      const response = await fetchWithAuth('/api/super-admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, companyId, status: nextStatus }),
      });
      if (!response.ok) {
        const result = await response.json();
        const errorMsg = result.details || result.error || 'Failed to update user status';
        alert(`Error: ${errorMsg}`);
        return;
      }
      await loadSuperAdminData();
    } catch (error) {
      console.error('Error updating user status:', error);
      alert('Failed to update user status');
    } finally {
      setIsLoading(false);
    }
  };

  const handleUserRoleChange = async (userId: string, companyId: string, nextRole: string) => {
    if (!confirm(`Change this user's role to ${nextRole}?`)) {
      return;
    }
    setIsLoading(true);
    try {
      const response = await fetchWithAuth('/api/super-admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, companyId, role: nextRole }),
      });
      if (!response.ok) {
        const result = await response.json();
        const errorMsg = result.details || result.error || 'Failed to update user role';
        alert(`Error: ${errorMsg}`);
        return;
      }
      await loadSuperAdminData();
    } catch (error) {
      console.error('Error updating user role:', error);
      alert('Failed to update user role');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteUser = async (userId: string, companyId: string | null) => {
    console.log('Delete user attempt:', { userId, companyId });
    const confirmMsg = companyId
      ? 'Remove this user from the company? This cannot be undone.'
      : 'Permanently delete this unassigned user from the system? This cannot be undone.';
    if (!confirm(confirmMsg)) {
      return;
    }
    setIsLoading(true);
    try {
      const response = await fetchWithAuth('/api/super-admin/users', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, companyId }),
      });
      if (!response.ok) {
        const result = await response.json();
        const errorMsg = result.details || result.error || 'Failed to delete user';
        console.error('Delete error response:', result);
        alert(`Error: ${errorMsg}`);
        return;
      }
      await loadSuperAdminData();
    } catch (error) {
      console.error('Error deleting user:', error);
      alert('Failed to delete user. Please check the console for details.');
    } finally {
      setIsLoading(false);
    }
  };


  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-100 text-green-800';
      case 'pending': return 'bg-yellow-100 text-yellow-800';
      case 'suspended': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getActionColor = (action: string) => {
    switch (action) {
      case 'delete_campaign': return 'bg-red-100 text-red-800';
      case 'delete_weekly_plan': return 'bg-orange-100 text-orange-800';
      case 'grant_super_admin': return 'bg-blue-100 text-blue-800';
      case 'revoke_super_admin': return 'bg-purple-100 text-purple-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const normalizedCompanySearch = companySearch.trim().toLowerCase();
  const filteredCompanies = companies.filter((company) => {
    if (!normalizedCompanySearch) return true;
    const haystack = [
      company.name,
      company.website,
      company.industry || ''
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(normalizedCompanySearch);
  });

  const normalizedUserSearch = userSearch.trim().toLowerCase();
  // When a company is selected, always show that company's users; otherwise respect All Companies / Selected Company toggle
  const scopedUsers = selectedCompanyId
    ? appUsers.filter((user) => user.company_id === selectedCompanyId)
    : showAllUsers
      ? appUsers
      : [];
  const filteredUsers = scopedUsers.filter((user) => {
    if (!normalizedUserSearch) return true;
    const haystack = [
      user.email,
      user.company_name || '',
      user.company_id || '',
      user.role || '',
      user.status || ''
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(normalizedUserSearch);
  });

  const displayRoles =
    rbacRoles.length > 0
      ? rbacRoles
      : ['SUPER_ADMIN', ...roleOptions.map((option) => option.id)];
  const permissionEntries = Object.entries(rbacDraftPermissions || {});

  return (
    <div className="min-h-screen bg-gradient-to-br from-red-50 via-orange-50 to-yellow-50">
      {/* Header */}
      <div className="bg-white/80 backdrop-blur-sm border-b border-gray-200/50 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button 
                onClick={() => window.location.href = '/team-management'}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ArrowLeft className="h-5 w-5 text-gray-600" />
              </button>
              <div>
                <h1 className="text-3xl font-bold bg-gradient-to-r from-red-600 to-orange-600 bg-clip-text text-transparent flex items-center gap-3">
                  <BarChart3 className="h-8 w-8 text-red-600" />
                  Platform Analytics Console
                </h1>
                <p className="text-gray-600 mt-1">Realtime analytics and governance across all tenants</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button 
                onClick={loadSuperAdminData}
                disabled={isLoading}
                className="px-4 py-2 text-gray-600 hover:text-gray-900 font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
              <button
                onClick={async () => {
                  setIsLoggingOut(true);
                  await fetchWithAuth('/api/super-admin/logout', { method: 'POST' });
                  window.location.href = '/super-admin/login';
                }}
                disabled={isLoggingOut}
                className="px-4 py-2 bg-gray-900 text-white rounded-lg font-medium disabled:opacity-50"
              >
                {isLoggingOut ? 'Signing out...' : 'Logout'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Navigation Tabs */}
        <div className="flex space-x-1 bg-gray-100 rounded-lg p-1 mb-8">
          {[
            { id: 'analytics',     label: 'Analytics',        icon: BarChart3  },
            { id: 'company-users', label: 'Companies & Users', icon: Users      },
            { id: 'plans',         label: 'Pricing & Plans',   icon: DollarSign },
            { id: 'community-ai',  label: 'Engagement',        icon: Activity   },
            { id: 'audit',         label: 'Audit Logs',        icon: Eye        },
            { id: 'social-platforms', label: 'APIs',           icon: Globe      },
            { id: 'system-health', label: 'System Health',     icon: TrendingUp },
            { id: 'blog',          label: 'Blog',              icon: FileText   },
          ].map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  if (tab.id === 'blog') { router.push('/admin/blog'); return; }
                  if (tab.id === 'system-health') { router.push('/super-admin/system-health'); return; }
                  setActiveTab(tab.id);
                  if (tab.id === 'social-platforms') loadSocialPlatforms();
                }}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all duration-200 ${
                  activeTab === tab.id
                    ? 'bg-white text-red-600 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Tab Content */}
        {activeTab === 'analytics' && (
          <div className="space-y-6">
            {/* Analytics sub-tabs */}
            <div className="flex space-x-1 bg-gray-100 rounded-lg p-1 w-fit">
              {([{ id: 'overview', label: 'Overview' }, { id: 'campaign-health', label: 'Campaign Health' }] as const).map((sub) => (
                <button
                  key={sub.id}
                  onClick={() => setAnalyticsSubTab(sub.id)}
                  className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all duration-200 ${analyticsSubTab === sub.id ? 'bg-white text-red-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                >
                  {sub.label}
                </button>
              ))}
            </div>

            {analyticsSubTab === 'overview' && <><div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-blue-100 rounded-lg">
                    <BarChart3 className="h-6 w-6 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Total Posts</p>
                    <p className="text-2xl font-bold text-gray-900">
                      {isLoadingAnalytics ? '—' : (analyticsSummary?.total_posts ?? 0).toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-green-100 rounded-lg">
                    <Activity className="h-6 w-6 text-green-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Total Engagement</p>
                    <p className="text-2xl font-bold text-gray-900">
                      {isLoadingAnalytics ? '—' : (analyticsSummary?.total_engagement ?? 0).toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-orange-100 rounded-lg">
                    <Eye className="h-6 w-6 text-orange-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Total Reach</p>
                    <p className="text-2xl font-bold text-gray-900">
                      {isLoadingAnalytics ? '—' : (analyticsSummary?.total_reach ?? 0).toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-purple-100 rounded-lg">
                    <TrendingUp className="h-6 w-6 text-purple-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Avg Engagement Rate</p>
                    <p className="text-2xl font-bold text-gray-900">
                      {isLoadingAnalytics
                        ? '—'
                        : `${(analyticsSummary?.avg_engagement_rate ?? 0).toFixed(2)}%`}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {canShowExternalApisTab && (
              <button
                onClick={() => setActiveTab('social-platforms')}
                className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                  externalApisHealth?.status === 'healthy'
                    ? 'bg-green-50 border-green-200 text-green-800 hover:bg-green-100'
                    : externalApisHealth != null
                    ? 'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100'
                    : 'bg-slate-50 border-slate-200 text-slate-800 hover:bg-slate-100'
                }`}
              >
                <Key className="h-4 w-4" />
                {externalApisHealth != null
                  ? `External APIs: ${externalApisHealth.status === 'healthy' ? 'HEALTHY' : 'ATTENTION REQUIRED'}`
                  : 'API Configuration'}
              </button>
            )}

            <div className="bg-white rounded-lg shadow-sm border border-gray-200">
              <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 rounded-t-lg">
                <h3 className="text-lg font-semibold text-gray-900">Platform Performance</h3>
                <p className="text-sm text-gray-600 mt-1">
                  Aggregated engagement and reach across all published posts.
                </p>
              </div>
              <div className="overflow-x-auto">
                {isLoadingAnalytics ? (
                  <div className="px-6 py-8 text-sm text-gray-500">Loading analytics…</div>
                ) : analyticsSummary?.platforms?.length ? (
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Platform
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Posts
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Engagement
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Reach
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Avg Rate
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {analyticsSummary.platforms.map((row) => (
                        <tr key={row.platform} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 capitalize">
                            {row.platform}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                            {row.total_posts.toLocaleString()}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                            {row.total_engagement.toLocaleString()}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                            {row.total_reach.toLocaleString()}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                            {row.avg_engagement_rate.toFixed(2)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="px-6 py-8 text-sm text-gray-500">No analytics data available yet.</div>
                )}
              </div>
            </div>
            </>}

            {analyticsSubTab === 'campaign-health' && <>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-blue-100 rounded-lg">
                      <BarChart3 className="h-6 w-6 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Total Campaigns</p>
                      <p className="text-2xl font-bold text-gray-900">
                        {isLoadingCampaignHealth ? '—' : (campaignHealth?.total_campaigns ?? 0).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-green-100 rounded-lg">
                      <Activity className="h-6 w-6 text-green-600" />
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Active Campaigns</p>
                      <p className="text-2xl font-bold text-gray-900">
                        {isLoadingCampaignHealth ? '—' : (campaignHealth?.active_campaigns ?? 0).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-purple-100 rounded-lg">
                      <CheckCircle className="h-6 w-6 text-purple-600" />
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Approved Strategies</p>
                      <p className="text-2xl font-bold text-gray-900">
                        {isLoadingCampaignHealth ? '—' : (campaignHealth?.approved_strategies ?? 0).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-amber-100 rounded-lg">
                      <AlertCircle className="h-6 w-6 text-amber-600" />
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Pending Re-Approval</p>
                      <p className="text-2xl font-bold text-gray-900">
                        {isLoadingCampaignHealth ? '—' : (campaignHealth?.reapproval_required_count ?? 0).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow-sm border border-gray-200">
                <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 rounded-t-lg">
                  <h3 className="text-lg font-semibold text-gray-900">Campaigns by Company</h3>
                  <p className="text-sm text-gray-600 mt-1">
                    Strategy approval health across tenants.
                  </p>
                </div>
                <div className="overflow-x-auto">
                  {isLoadingCampaignHealth ? (
                    <div className="px-6 py-8 text-sm text-gray-500">Loading campaign health…</div>
                  ) : campaignHealth?.campaigns_by_company?.length ? (
                    <table className="w-full">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Company
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Campaign Count
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Active
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Re-Approval Required
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {campaignHealth.campaigns_by_company.map((row) => {
                          const companyName =
                            companies.find((company) => company.id === row.company_id)?.name ||
                            row.company_id;
                          return (
                            <tr key={row.company_id}>
                              <td className="px-6 py-4 text-sm text-gray-900">{companyName}</td>
                              <td className="px-6 py-4 text-sm text-gray-900">{row.total_campaigns}</td>
                              <td className="px-6 py-4 text-sm text-gray-900">{row.active_campaigns}</td>
                              <td className="px-6 py-4 text-sm text-gray-900">{row.reapproval_required}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <div className="px-6 py-8 text-sm text-gray-500">
                      No campaign health data available yet.
                    </div>
                  )}
                </div>
              </div>
            </>}
          </div>
        )}

        {activeTab === 'company-users' && (
          <div className="space-y-6">
            {/* Companies & Users sub-tabs */}
            <div className="flex space-x-1 bg-gray-100 rounded-lg p-1 w-fit">
              {([{ id: 'users', label: 'Companies & Users' }, { id: 'rbac', label: 'RBAC' }] as const).map((sub) => (
                <button
                  key={sub.id}
                  onClick={() => setCompanySubTab(sub.id)}
                  className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all duration-200 ${companySubTab === sub.id ? 'bg-white text-red-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                >
                  {sub.label}
                </button>
              ))}
            </div>

            {companySubTab === 'users' && <>
            <div className="bg-white rounded-lg shadow-sm border border-gray-200">
              <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 rounded-t-lg flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">
                    Companies <span className="text-sm text-gray-500">({filteredCompanies.length}/{companies.length})</span>
                  </h3>
                  <p className="text-xs text-gray-500">Select a company to manage its users.</p>
                </div>
                <div className="flex items-center gap-3">
                  {selectedCompanyId && (
                    <button
                      onClick={() => {
                        setSelectedCompanyId(null);
                        setShowAllUsers(true);
                      }}
                      className="text-xs text-gray-600 hover:text-gray-900"
                    >
                      Clear selection
                    </button>
                  )}
                  <div className="flex items-center gap-2 bg-white border border-gray-300 rounded-lg px-2 py-1">
                    <Search className="h-4 w-4 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Search companies..."
                      value={companySearch}
                      onChange={(e) => setCompanySearch(e.target.value)}
                      className="text-sm outline-none"
                    />
                  </div>
                  <button
                    onClick={() => setShowCreateCompanyModal(true)}
                    className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium"
                  >
                    Create Company
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Website</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Industry</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {filteredCompanies.map((company) => {
                      const isSelected = selectedCompanyId === company.id;
                      return (
                      <tr
                        key={company.id}
                        className={`hover:bg-gray-50 ${isSelected ? 'bg-red-50 border-l-4 border-l-red-600' : ''}`}
                      >
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          <button
                            onClick={() => {
                              setSelectedCompanyId(company.id);
                              setShowAllUsers(false);
                            }}
                            className={`text-left transition-colors ${isSelected ? 'text-red-700 font-semibold' : 'hover:text-red-600'}`}
                          >
                            {company.name}
                          </button>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                          {company.website}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                          {company.industry || '—'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(company.status)}`}>
                            {company.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {new Date(company.created_at).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => {
                                setSelectedCompanyId(company.id);
                                setShowAllUsers(false);
                              }}
                              className="text-blue-600 hover:text-blue-900 p-1 rounded hover:bg-blue-50"
                              title="Manage Users"
                            >
                              <Users className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() =>
                                handleCompanyStatusChange(
                                  company.id,
                                  company.status === 'active' ? 'inactive' : 'active'
                                )
                              }
                              className="text-yellow-600 hover:text-yellow-900 p-1 rounded hover:bg-yellow-50"
                              title={company.status === 'active' ? 'Make Inactive' : 'Make Active'}
                            >
                              {company.status === 'active' ? (
                                <XCircle className="h-4 w-4" />
                              ) : (
                                <CheckCircle className="h-4 w-4" />
                              )}
                            </button>
                            <button
                              onClick={() => handleDeleteCompany(company.id)}
                              className="text-red-600 hover:text-red-900 p-1 rounded hover:bg-red-50"
                              title="Delete Company"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-gray-200">
              <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 rounded-t-lg flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">
                    {selectedCompanyId
                      ? `Users for ${companies.find((company) => company.id === selectedCompanyId)?.name || 'Company'}`
                      : 'All Users'}
                  </h3>
                  <p className="text-xs text-gray-500">
                    {selectedCompanyId
                      ? 'Manage users for the selected company.'
                      : showAllUsers
                        ? 'Manage users across all companies. Select a company above to see only its users.'
                        : 'Select a company above to see its users.'}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 bg-white border border-gray-300 rounded-lg px-2 py-1">
                    <Search className="h-4 w-4 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Search users..."
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                      className="text-sm outline-none"
                    />
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <button
                      onClick={() => setShowAllUsers(true)}
                      className={`px-2 py-1 rounded ${showAllUsers ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 border border-gray-300'}`}
                    >
                      All Companies
                    </button>
                    <button
                      onClick={() => setShowAllUsers(false)}
                      disabled={!selectedCompanyId}
                      className={`px-2 py-1 rounded ${!showAllUsers ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 border border-gray-300'} disabled:opacity-50`}
                    >
                      Selected Company
                    </button>
                  </div>
                  <button
                    onClick={() => {
                      if (selectedCompanyId) {
                        setCompanyAdminForm((prev) => ({ ...prev, companyId: selectedCompanyId }));
                      }
                      setShowCreateCompanyAdminModal(true);
                    }}
                    disabled={!selectedCompanyId}
                    className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium"
                  >
                    Add User
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Company</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {filteredUsers.map((user) => (
                      <tr key={`${user.user_id}-${user.company_id}`} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {user.email}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                          {user.company_name || user.company_id}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                          <select
                            value={user.role}
                            onChange={(e) => handleUserRoleChange(user.user_id, user.company_id, e.target.value)}
                            className="border border-gray-300 rounded-lg px-2 py-1 text-sm"
                            disabled={isLoading}
                          >
                            {!roleOptions.some((option) => option.id === user.role) && (
                              <option value={user.role}>{user.role}</option>
                            )}
                            {roleOptions.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(user.status || 'active')}`}>
                            {user.status || 'active'}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {new Date(user.created_at).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() =>
                                handleUserStatusChange(
                                  user.user_id,
                                  user.company_id,
                                  (user.status || 'active') === 'active' ? 'inactive' : 'active'
                                )
                              }
                              disabled={!user.company_id}
                              className="text-yellow-600 hover:text-yellow-900 p-1 rounded hover:bg-yellow-50 disabled:opacity-50 disabled:cursor-not-allowed"
                              title={user.company_id ? ((user.status || 'active') === 'active' ? 'Make Inactive' : 'Make Active') : 'User must be assigned to a company'}
                            >
                              {(user.status || 'active') === 'active' ? (
                                <XCircle className="h-4 w-4" />
                              ) : (
                                <CheckCircle className="h-4 w-4" />
                              )}
                            </button>
                            <button
                              onClick={() => handleDeleteUser(user.user_id, user.company_id)}
                              className="text-red-600 hover:text-red-900 p-1 rounded hover:bg-red-50"
                              title={user.company_id ? 'Remove from company' : 'Delete unassigned user'}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filteredUsers.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-6 py-8 text-center text-sm text-gray-500">
                          No users match the current filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            </>}

            {companySubTab === 'rbac' && <>
              <div className="bg-white rounded-lg shadow-sm border border-gray-200">
                <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 rounded-t-lg">
                  <h3 className="text-lg font-semibold text-gray-900">RBAC Configuration</h3>
                  <p className="text-sm text-gray-600 mt-1">
                    Current role definitions and permission assignments for the platform.
                  </p>
                </div>
                <div className="p-6 space-y-4">
                  {rbacError && (
                    <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                      {rbacError}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-gray-900 mb-2">Roles</div>
                      <div className="flex flex-wrap gap-2">
                        {displayRoles.map((role) => (
                          <span
                            key={role}
                            className="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-800"
                          >
                            {role}
                          </span>
                        ))}
                      </div>
                      <div className="text-xs text-gray-500 mt-2">
                        Roles are system-defined. Use permissions below to control access.
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleSaveRbac}
                        disabled={!rbacDirty || isSavingRbac}
                        className="px-3 py-2 text-sm bg-gray-900 text-white rounded-lg disabled:opacity-50"
                      >
                        {isSavingRbac ? 'Saving...' : 'Save Changes'}
                      </button>
                      <button
                        onClick={handleResetRbac}
                        disabled={!rbacDirty || isSavingRbac}
                        className="px-3 py-2 text-sm border border-gray-300 text-gray-700 rounded-lg disabled:opacity-50"
                      >
                        Reset
                      </button>
                    </div>
                  </div>
                  {rbacSaveError && (
                    <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                      {rbacSaveError}
                    </div>
                  )}
                  {rbacSaveSuccess && (
                    <div className="rounded-md bg-green-50 border border-green-200 p-3 text-sm text-green-700">
                      {rbacSaveSuccess}
                    </div>
                  )}
                  <div className="rounded-md border border-gray-200 bg-gray-50 p-4 space-y-3">
                    <div className="text-sm font-medium text-gray-900">Add Permission</div>
                    <div className="flex flex-wrap items-end gap-3">
                      <div className="flex-1 min-w-[220px]">
                        <label className="block text-xs text-gray-600 mb-1">Permission key</label>
                        <input
                          type="text"
                          value={newPermissionKey}
                          onChange={(e) => setNewPermissionKey(e.target.value)}
                          placeholder="e.g. MANAGE_BILLING"
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                        />
                      </div>
                      <div className="flex flex-wrap gap-3">
                        <label className="flex items-center gap-2 text-xs text-gray-700">
                          <input
                            type="checkbox"
                            checked={newPermissionRoles.includes('*')}
                            onChange={() => toggleNewPermissionRole('*')}
                          />
                          All roles
                        </label>
                        {displayRoles.map((role) => (
                          <label key={role} className="flex items-center gap-2 text-xs text-gray-700">
                            <input
                              type="checkbox"
                              checked={newPermissionRoles.includes('*') || newPermissionRoles.includes(role)}
                              disabled={newPermissionRoles.includes('*')}
                              onChange={() => toggleNewPermissionRole(role)}
                            />
                            {role}
                          </label>
                        ))}
                      </div>
                      <button
                        onClick={handleAddPermission}
                        className="px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow-sm border border-gray-200">
                <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 rounded-t-lg">
                  <h3 className="text-lg font-semibold text-gray-900">Permissions Matrix</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Permission
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Allowed Roles
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {permissionEntries.map(([permission, roles]) => {
                        const isAllRoles = roles.includes('*');
                        return (
                          <tr key={permission} className="hover:bg-gray-50">
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                              {permission}
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-600">
                              <div className="flex flex-wrap gap-3">
                                <label className="flex items-center gap-2 text-xs text-gray-700">
                                  <input
                                    type="checkbox"
                                    checked={isAllRoles}
                                    onChange={() => togglePermissionRole(permission, '*')}
                                  />
                                  All roles
                                </label>
                                {displayRoles.map((role) => (
                                  <label
                                    key={`${permission}-${role}`}
                                    className="flex items-center gap-2 text-xs text-gray-700"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={isAllRoles || roles.includes(role)}
                                      disabled={isAllRoles}
                                      onChange={() => togglePermissionRole(permission, role)}
                                    />
                                    {role}
                                  </label>
                                ))}
                              </div>
                            </td>
                            <td className="px-6 py-4 text-sm">
                              <button
                                onClick={() => handleRemovePermission(permission)}
                                className="text-red-600 hover:text-red-900 text-xs font-medium"
                              >
                                Delete
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                      {permissionEntries.length === 0 && (
                        <tr>
                          <td colSpan={3} className="px-6 py-8 text-center text-sm text-gray-500">
                            No permissions available.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>}
          </div>
        )}

        {activeTab === 'plans' && (
          <div className="space-y-6">
            {/* Pricing & Plans sub-tabs */}
            <div className="flex space-x-1 bg-gray-100 rounded-lg p-1 w-fit">
              {([{ id: 'plans', label: 'Pricing & Plans' }, { id: 'consumption', label: 'Consumption' }] as const).map((sub) => (
                <button
                  key={sub.id}
                  onClick={() => setPlansSubTab(sub.id)}
                  className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all duration-200 ${plansSubTab === sub.id ? 'bg-white text-red-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                >
                  {sub.label}
                </button>
              ))}
            </div>

            {plansSubTab === 'plans' && <>
            <div className="bg-white rounded-lg shadow-sm border border-gray-200">
              <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 rounded-t-lg">
                <h3 className="text-lg font-semibold text-gray-900">Pricing & Plan Limits</h3>
                <p className="text-sm text-gray-600 mt-1">
                  Right-size plan limits including max campaign duration (weeks). Changes apply to all orgs on that plan.
                </p>
              </div>
              <div className="p-6 space-y-4">
                {plansSaveError && (
                  <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">{plansSaveError}</div>
                )}
                {plansSaveSuccess && (
                  <div className="rounded-md bg-green-50 border border-green-200 p-3 text-sm text-green-700">{plansSaveSuccess}</div>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium text-gray-700">Plan</th>
                        <th className="px-4 py-2 text-left font-medium text-gray-700">LLM Tokens</th>
                        <th className="px-4 py-2 text-left font-medium text-gray-700">Ext. API Calls</th>
                        <th className="px-4 py-2 text-left font-medium text-gray-700">Automation Exec.</th>
                        <th className="px-4 py-2 text-left font-medium text-gray-700">Max Duration (wks)</th>
                        <th className="px-4 py-2 text-left font-medium text-gray-700">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {pricingPlans.map((plan) => (
                        <tr key={plan.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <span className="font-medium text-gray-900">{plan.name}</span>
                            <span className="ml-2 text-gray-500">({plan.plan_key})</span>
                          </td>
                          <td className="px-4 py-3">
                            <input
                              type="number"
                              min={0}
                              value={plansDraftLimits[plan.id]?.llm_tokens ?? ''}
                              onChange={(e) => setPlanDraftLimit(plan.id, 'llm_tokens', e.target.value)}
                              placeholder="—"
                              className="w-28 border border-gray-300 rounded px-2 py-1 text-gray-900"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <input
                              type="number"
                              min={0}
                              value={plansDraftLimits[plan.id]?.external_api_calls ?? ''}
                              onChange={(e) => setPlanDraftLimit(plan.id, 'external_api_calls', e.target.value)}
                              placeholder="—"
                              className="w-28 border border-gray-300 rounded px-2 py-1 text-gray-900"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <input
                              type="number"
                              min={0}
                              value={plansDraftLimits[plan.id]?.automation_executions ?? ''}
                              onChange={(e) => setPlanDraftLimit(plan.id, 'automation_executions', e.target.value)}
                              placeholder="—"
                              className="w-28 border border-gray-300 rounded px-2 py-1 text-gray-900"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <input
                              type="number"
                              min={1}
                              max={12}
                              value={plansDraftLimits[plan.id]?.max_campaign_duration_weeks ?? ''}
                              onChange={(e) => setPlanDraftLimit(plan.id, 'max_campaign_duration_weeks', e.target.value)}
                              placeholder="4–12"
                              title="Max campaign duration in weeks (4–12)"
                              className="w-20 border border-gray-300 rounded px-2 py-1 text-gray-900"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <button
                              onClick={() => handleSavePlanLimits(plan)}
                              disabled={isSavingPlan === plan.id}
                              className="px-3 py-1.5 text-sm bg-gray-900 text-white rounded-lg disabled:opacity-50"
                            >
                              {isSavingPlan === plan.id ? 'Saving...' : 'Save'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {pricingPlans.length === 0 && (
                  <p className="text-sm text-gray-500 py-4">No plans found. Create plans via POST /api/super-admin/plans/create.</p>
                )}
              </div>
            </div>
            </>}

            {plansSubTab === 'consumption' && <>
              <div className="bg-white rounded-lg shadow-sm border border-gray-200">
                <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 rounded-t-lg">
                  <h3 className="text-lg font-semibold text-gray-900">Credit Consumption</h3>
                  <p className="text-sm text-gray-600 mt-1">
                    Monitor credit usage across organizations.
                  </p>
                </div>
                <div className="p-6">
                  <button
                    onClick={() => router.push('/super-admin/consumption')}
                    className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium"
                  >
                    Open Consumption Dashboard
                  </button>
                </div>
              </div>
            </>}
          </div>
        )}

        {activeTab === 'community-ai' && (
          <div className="space-y-6">
            {(communityPolicy?.execution_enabled ?? defaultPolicy.execution_enabled) === false && (
              <div className="rounded-md bg-yellow-50 border border-yellow-200 p-4">
                <div className="flex items-start gap-2">
                  <span>⚠️</span>
                  <div>
                    <p className="font-semibold text-yellow-800">
                      Engagement Center Execution Paused
                    </p>
                    <p className="text-sm text-yellow-700">
                      Engagement Center execution is currently paused at the platform level.
                      All tenants and all Engagement Center actions (manual, scheduled, and automated) are affected.
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="bg-white rounded-lg shadow-sm border border-gray-200">
              <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 rounded-t-lg">
                <h3 className="text-lg font-semibold text-gray-900">Global Platform Policy</h3>
                <p className="text-sm text-gray-600 mt-1">
                  This policy applies to ALL tenants and ALL Engagement Center actions.
                </p>
              </div>
              <div className="p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">Enable Engagement Center Execution</p>
                    <p className="text-xs text-gray-500">Global kill switch for all executions</p>
                  </div>
                  <button
                    onClick={() => openPolicyConfirm('execution_enabled', 'Enable Engagement Center Execution')}
                    disabled={isSavingPolicy}
                    className={`px-4 py-2 rounded-lg text-sm font-medium ${
                      (communityPolicy?.execution_enabled ?? defaultPolicy.execution_enabled)
                        ? 'bg-green-100 text-green-800'
                        : 'bg-red-100 text-red-800'
                    } disabled:opacity-50`}
                  >
                    {(communityPolicy?.execution_enabled ?? defaultPolicy.execution_enabled) ? 'Enabled' : 'Disabled'}
                  </button>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">Enable Auto-Rules</p>
                    <p className="text-xs text-gray-500">Global switch for auto-rule execution</p>
                  </div>
                  <button
                    onClick={() => openPolicyConfirm('auto_rules_enabled', 'Enable Auto-Rules')}
                    disabled={isSavingPolicy}
                    className={`px-4 py-2 rounded-lg text-sm font-medium ${
                      (communityPolicy?.auto_rules_enabled ?? defaultPolicy.auto_rules_enabled)
                        ? 'bg-green-100 text-green-800'
                        : 'bg-red-100 text-red-800'
                    } disabled:opacity-50`}
                  >
                    {(communityPolicy?.auto_rules_enabled ?? defaultPolicy.auto_rules_enabled) ? 'Enabled' : 'Disabled'}
                  </button>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">Require Human Approval for All Actions</p>
                    <p className="text-xs text-gray-500">Auto-execution will stop until approved</p>
                  </div>
                  <button
                    onClick={() => openPolicyConfirm('require_human_approval', 'Require Human Approval for All Actions')}
                    disabled={isSavingPolicy}
                    className={`px-4 py-2 rounded-lg text-sm font-medium ${
                      (communityPolicy?.require_human_approval ?? defaultPolicy.require_human_approval)
                        ? 'bg-yellow-100 text-yellow-800'
                        : 'bg-gray-100 text-gray-800'
                    } disabled:opacity-50`}
                  >
                    {(communityPolicy?.require_human_approval ?? defaultPolicy.require_human_approval)
                      ? 'Required'
                      : 'Not Required'}
                  </button>
                </div>

                <div className="text-xs text-gray-500 pt-2 border-t border-gray-100">
                  <div>Last updated: {communityPolicy?.updated_at ? new Date(communityPolicy.updated_at).toLocaleString() : '—'}</div>
                  <div>Updated by: {communityPolicyUpdatedBy || communityPolicy?.updated_by || '—'}</div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-gray-200">
              <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 rounded-t-lg">
                <h3 className="text-lg font-semibold text-gray-900">Engagement Center (Platform-level)</h3>
              </div>
              <div className="p-6 grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                  <p className="text-sm text-gray-600">Total Actions Executed</p>
                  <p className="text-2xl font-bold text-gray-900">{communityMetrics?.total_actions_executed ?? 0}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                  <p className="text-sm text-gray-600">Total Actions</p>
                  <p className="text-2xl font-bold text-gray-900">{communityMetrics?.total_actions ?? 0}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                  <p className="text-sm text-gray-600">Playbooks</p>
                  <p className="text-2xl font-bold text-gray-900">{communityMetrics?.playbooks_count ?? 0}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                  <p className="text-sm text-gray-600">Auto-Rules</p>
                  <p className="text-2xl font-bold text-gray-900">{communityMetrics?.auto_rules_count ?? 0}</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-gray-200">
              <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 rounded-t-lg">
                <h3 className="text-lg font-semibold text-gray-900">Actions per Tenant</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tenant</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {(communityMetrics?.actions_by_tenant || []).map((row) => (
                      <tr key={row.tenant_id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{row.tenant_id}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{row.total_actions}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'social-platforms' && (() => {
          const KNOWN_APIS: Record<string, Array<{ key: string; name: string; icon: string; env_var: string | null; auth_type: string; base_url: string; description: string; default_query_params?: Record<string, string>; default_headers?: Record<string, string>; optional_token?: boolean }>> = {
            trend: [
              { key: 'youtube',          name: 'YouTube Data API',        icon: '▶️',  env_var: 'YOUTUBE_API_KEY',   auth_type: 'query',  base_url: 'https://www.googleapis.com/youtube/v3/search',      description: 'Trending videos and Shorts' },
              { key: 'newsapi',          name: 'NewsAPI',                 icon: '📰',  env_var: 'NEWS_API_KEY',      auth_type: 'query',  base_url: 'https://newsapi.org/v2/top-headlines',             description: 'Top headlines + full-text search' },
              { key: 'serpapi',          name: 'SerpAPI',                 icon: '🔍',  env_var: 'SERPAPI_KEY',       auth_type: 'query',  base_url: 'https://serpapi.com/search',                       description: 'Google Trends + Google News results' },
              { key: 'searchapi',        name: 'SearchAPI',               icon: '🔎',  env_var: 'SEARCHAPI_KEY',     auth_type: 'query',  base_url: 'https://www.searchapi.io/api/v1/search',           description: 'Real-time Google search results' },
              { key: 'gdelt',            name: 'GDELT Events',            icon: '🌍',  env_var: null,                auth_type: 'none',   base_url: 'https://api.gdeltproject.org/api/v2/events/search', description: 'Global event data — no key needed' },
              { key: 'pytrends',         name: 'Google Trends (Proxy)',   icon: '📈',  env_var: null,                auth_type: 'none',   base_url: 'https://trends-proxy.yourdomain.com/trends',       description: 'Requires a self-hosted PyTrends bridge' },
            ],
            community: [
              { key: 'reddit',           name: 'Reddit Search',           icon: '🟠',  env_var: null,                auth_type: 'none',   base_url: 'https://www.reddit.com/search.json',               description: 'Public Reddit search — no key needed', default_query_params: { q: 'technology', limit: '10', sort: 'new', t: 'week' } },
              { key: 'hackernews',       name: 'Hacker News',             icon: '🔶',  env_var: null,                auth_type: 'none',   base_url: 'https://hn.algolia.com/api/v1/search',             description: 'Algolia HN search — no key needed',    default_query_params: { query: 'technology', tags: 'story', hitsPerPage: '10' } },
              { key: 'stackoverflow',    name: 'Stack Overflow',          icon: '📚',  env_var: null,                auth_type: 'none',   base_url: 'https://api.stackexchange.com/2.3/questions',      description: 'Developer Q&A trends — no key needed', default_query_params: { site: 'stackoverflow', pagesize: '10', order: 'desc', sort: 'activity', tagged: 'javascript' } },
              { key: 'github',           name: 'GitHub Search',           icon: '🐙',  env_var: 'GITHUB_TOKEN',      auth_type: 'bearer', base_url: 'https://api.github.com/search/repositories',      description: 'Trending repos — token optional (higher rate limit)', default_query_params: { q: 'trending', sort: 'stars', order: 'desc', per_page: '10' }, optional_token: true },
              { key: 'discord',          name: 'Discord',                 icon: '💬',  env_var: 'DISCORD_BOT_TOKEN', auth_type: 'bearer', base_url: 'https://discord.com/api/v10/gateway',             description: 'Bot token required — community server signals', default_query_params: {} },
            ],
            llm: [
              { key: 'openai',           name: 'OpenAI (GPT-4o)',         icon: '🤖',  env_var: 'OPENAI_API_KEY',    auth_type: 'bearer', base_url: 'https://api.openai.com/v1',                        description: 'GPT-4o, GPT-4, GPT-3.5 models' },
              { key: 'anthropic',        name: 'Anthropic Claude',        icon: '🧠',  env_var: 'ANTHROPIC_API_KEY', auth_type: 'api_key',base_url: 'https://api.anthropic.com/v1',                     description: 'Claude 3.5 Sonnet, Opus, Haiku' },
              { key: 'gemini',           name: 'Google Gemini',           icon: '✨',  env_var: 'GOOGLE_GEMINI_API_KEY', auth_type: 'query', base_url: 'https://generativelanguage.googleapis.com/v1', description: 'Gemini 1.5 Pro / Flash' },
              { key: 'groq',             name: 'Groq',                    icon: '⚡',  env_var: 'GROQ_API_KEY',      auth_type: 'bearer', base_url: 'https://api.groq.com/openai/v1',                   description: 'Ultra-fast inference — Llama, Mixtral' },
              { key: 'mistral',          name: 'Mistral AI',              icon: '🌊',  env_var: 'MISTRAL_API_KEY',   auth_type: 'bearer', base_url: 'https://api.mistral.ai/v1',                        description: 'Mistral Large, Mixtral models' },
              { key: 'cohere',           name: 'Cohere',                  icon: '🔗',  env_var: 'COHERE_API_KEY',    auth_type: 'bearer', base_url: 'https://api.cohere.ai/v1',                         description: 'Command R+ for RAG and generation' },
            ],
            image: [
              { key: 'dalle',            name: 'DALL-E (OpenAI)',         icon: '🖼️',  env_var: 'OPENAI_API_KEY',    auth_type: 'bearer', base_url: 'https://api.openai.com/v1/images/generations',     description: 'DALL-E 3 image generation' },
              { key: 'stability',        name: 'Stability AI',            icon: '🎨',  env_var: 'STABILITY_API_KEY', auth_type: 'bearer', base_url: 'https://api.stability.ai/v1',                      description: 'Stable Diffusion XL, SD3' },
              { key: 'replicate',        name: 'Replicate',               icon: '🔁',  env_var: 'REPLICATE_API_TOKEN', auth_type: 'bearer', base_url: 'https://api.replicate.com/v1',                  description: 'Flux, SDXL and any open model' },
              { key: 'fal',              name: 'fal.ai',                  icon: '⚡',  env_var: 'FAL_API_KEY',       auth_type: 'bearer', base_url: 'https://fal.run',                                  description: 'Fast Flux and image models' },
              { key: 'unsplash',         name: 'Unsplash',                icon: '📷',  env_var: 'UNSPLASH_ACCESS_KEY', auth_type: 'query', base_url: 'https://api.unsplash.com/photos', description: 'High-quality free stock photos', default_query_params: { client_id: '{{api_key}}', per_page: '3' } },
              { key: 'pixabay',          name: 'Pixabay',                 icon: '🌄',  env_var: 'PIXABAY_API_KEY',   auth_type: 'query',  base_url: 'https://pixabay.com/api/',         description: 'Free stock images, videos and music', default_query_params: { key: '{{api_key}}', q: 'nature', per_page: '3', image_type: 'photo' } },
              { key: 'pexels',           name: 'Pexels',                  icon: '🖼️',  env_var: 'PEXELS_API_KEY',    auth_type: 'none',   base_url: 'https://api.pexels.com/v1/search', description: 'Free stock photos and videos',       default_query_params: { query: 'nature', per_page: '1' }, default_headers: { Authorization: '{{api_key}}' } },
            ],
            others: [
              { key: 'serper',           name: 'Serper (Google Search)',  icon: '🔎',  env_var: 'SERPER_API_KEY',    auth_type: 'api_key',base_url: 'https://google.serper.dev/search',                 description: 'Google Search JSON API' },
              { key: 'browserless',      name: 'Browserless',             icon: '🌐',  env_var: 'BROWSERLESS_API_KEY', auth_type: 'api_key', base_url: 'https://chrome.browserless.io',              description: 'Headless Chrome for web scraping' },
              { key: 'apify',            name: 'Apify',                   icon: '🕷️',  env_var: 'APIFY_API_TOKEN',   auth_type: 'bearer', base_url: 'https://api.apify.com/v2',                         description: 'Web scraping and automation actors' },
              { key: 'perplexity',       name: 'Perplexity AI',           icon: '🧩',  env_var: 'PERPLEXITY_API_KEY', auth_type: 'bearer', base_url: 'https://api.perplexity.ai',                    description: 'AI-powered search and answers' },
            ],
          };

          const renderApiCategorySection = (categoryKey: 'trend' | 'community' | 'llm' | 'image' | 'others') => {
            const knownList = KNOWN_APIS[categoryKey] || [];
            return (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200">
                <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 rounded-t-lg flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">
                      {{ trend: 'Trend APIs', community: 'Community APIs', llm: 'LLM APIs', image: 'Image APIs', others: 'Other APIs' }[categoryKey]}
                    </h3>
                    <p className="text-sm text-gray-500 mt-0.5">
                      {{ trend: 'Configure API keys for news, search and trend discovery sources.', community: 'Configure API keys for developer and interest community sources.', llm: 'Configure API keys for large language model providers used across the platform.', image: 'Configure API keys for image generation providers.', others: 'Other API integrations — search, scraping, and AI tools.' }[categoryKey]}
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
                                    const r = await fetchWithAuth(`/api/external-apis/${catalogEntry.id}/test?scope=platform`);
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
                        {isExpanded && isInCatalog && (
                          <div className="mt-4 bg-gray-50 rounded-lg border border-gray-200 p-4 space-y-3">

                            {/* ── Trend APIs ── */}
                            {categoryKey === 'trend' && (<>
                              {known.auth_type !== 'none' && (
                                <div>
                                  <label className="block text-xs font-medium text-gray-700 mb-1">API Key Env Var <span className="font-normal text-gray-400">— variable name set in .env</span></label>
                                  <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono" placeholder={known.env_var || 'TREND_API_KEY'} value={apiEnvForm.api_key_env_name || ''} onChange={(e) => setApiEnvForm((p) => ({ ...p, api_key_env_name: e.target.value }))} />
                                </div>
                              )}
                              <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">Daily Call Quota <span className="font-normal text-gray-400">— max requests per day (0 = unlimited)</span></label>
                                <input type="number" min={0} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="1000" value={apiEnvForm.daily_quota ?? ''} onChange={(e) => setApiEnvForm((p) => ({ ...p, daily_quota: e.target.value === '' ? '' : Number(e.target.value) }))} />
                              </div>
                            </>)}

                            {/* ── Community APIs ── */}
                            {categoryKey === 'community' && (<>
                              {known.auth_type === 'none' && (
                                <div className="text-xs text-green-700 bg-green-50 rounded-lg px-3 py-2 border border-green-200">
                                  No API key required — publicly accessible. Just activate and it's ready to use.
                                </div>
                              )}
                              {known.key === 'github' && (
                                <div>
                                  <label className="block text-xs font-medium text-gray-700 mb-1">Personal Access Token <span className="font-normal text-gray-400">— optional, raises rate limit from 60 to 5,000 req/hr</span></label>
                                  <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono" placeholder="Paste token or GITHUB_TOKEN" value={apiEnvForm.api_key_env_name || ''} onChange={(e) => setApiEnvForm((p) => ({ ...p, api_key_env_name: e.target.value }))} />
                                </div>
                              )}
                              {known.key === 'discord' && (
                                <div>
                                  <label className="block text-xs font-medium text-gray-700 mb-1">Bot Token <span className="font-normal text-gray-400">— from Discord Developer Portal → Bot → Token</span></label>
                                  <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono" placeholder="Paste token or DISCORD_BOT_TOKEN" value={apiEnvForm.api_key_env_name || ''} onChange={(e) => setApiEnvForm((p) => ({ ...p, api_key_env_name: e.target.value }))} />
                                </div>
                              )}
                            </>)}

                            {/* ── LLM APIs ── */}
                            {categoryKey === 'llm' && (() => {
                              const LLM_MODELS: Record<string, string[]> = {
                                openai:    ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo'],
                                anthropic: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
                                gemini:    ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
                                groq:      ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
                                mistral:   ['mistral-large-latest', 'open-mixtral-8x22b', 'mistral-medium'],
                                cohere:    ['command-r-plus', 'command-r', 'command'],
                              };
                              const models = LLM_MODELS[known.key] || [];
                              return (<>
                                <div>
                                  <label className="block text-xs font-medium text-gray-700 mb-1">API Key Env Var <span className="font-normal text-gray-400">— variable name in .env</span></label>
                                  <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono" placeholder={known.env_var || 'LLM_API_KEY'} value={apiEnvForm.api_key_env_name || ''} onChange={(e) => setApiEnvForm((p) => ({ ...p, api_key_env_name: e.target.value }))} />
                                </div>
                                {models.length > 0 && (
                                  <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">Default Model</label>
                                    <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" value={apiEnvForm._config?.default_model || models[0]} onChange={(e) => setApiEnvForm((p) => ({ ...p, _config: { ...(p._config || {}), default_model: e.target.value } }))}>
                                      {models.map((m) => <option key={m} value={m}>{m}</option>)}
                                    </select>
                                  </div>
                                )}
                                <div className="grid grid-cols-2 gap-3">
                                  <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">Max Tokens</label>
                                    <input type="number" min={1} max={200000} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="2048" value={apiEnvForm._config?.max_tokens ?? ''} onChange={(e) => setApiEnvForm((p) => ({ ...p, _config: { ...(p._config || {}), max_tokens: e.target.value === '' ? undefined : Number(e.target.value) } }))} />
                                  </div>
                                  <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">Temperature <span className="font-normal text-gray-400">(0–2)</span></label>
                                    <input type="number" min={0} max={2} step={0.1} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="0.7" value={apiEnvForm._config?.temperature ?? ''} onChange={(e) => setApiEnvForm((p) => ({ ...p, _config: { ...(p._config || {}), temperature: e.target.value === '' ? undefined : Number(e.target.value) } }))} />
                                  </div>
                                </div>
                                {known.key === 'openai' && (
                                  <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">Organization ID Env Var <span className="font-normal text-gray-400">— optional, for org-scoped billing</span></label>
                                    <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono" placeholder="OPENAI_ORG_ID" value={apiEnvForm._config?.org_id_env || ''} onChange={(e) => setApiEnvForm((p) => ({ ...p, _config: { ...(p._config || {}), org_id_env: e.target.value } }))} />
                                  </div>
                                )}
                              </>);
                            })()}

                            {/* ── Image APIs ── */}
                            {categoryKey === 'image' && (() => {
                              const IMAGE_MODELS: Record<string, string[]> = {
                                dalle:     ['dall-e-3', 'dall-e-2'],
                                stability: ['stable-image-core', 'stable-diffusion-xl-1024-v1-0', 'sd3'],
                                replicate: [],
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
                            {categoryKey === 'others' && (<>
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

                            <div className="flex gap-2 pt-1">
                              <button onClick={() => setExpandedApiId(null)} className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 text-sm hover:bg-gray-50">Cancel</button>
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
          <div className="space-y-4">
            {/* Sub-tab bar */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 px-4 py-3 flex gap-1 flex-wrap">
              {([
                { id: 'social',    label: 'Social Platform APIs' },
                { id: 'trend',     label: 'Trend APIs' },
                { id: 'community', label: 'Community APIs' },
                { id: 'llm',       label: 'LLM APIs' },
                { id: 'image',     label: 'Image APIs' },
                { id: 'others',    label: 'Others' },
              ] as const).map((sub) => (
                <button
                  key={sub.id}
                  onClick={() => setApiSubTab(sub.id)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${apiSubTab === sub.id ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                  {sub.label}
                </button>
              ))}
            </div>

            {/* Social Platform APIs — existing OAuth section unchanged */}
            {apiSubTab === 'social' && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200">
              <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 rounded-t-lg flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Social Platform OAuth Credentials</h3>
                  <p className="text-sm text-gray-500 mt-0.5">Configure Client ID &amp; Secret for each platform. Company admins use these to connect their accounts.</p>
                </div>
                <button onClick={loadSocialPlatforms} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500" title="Refresh">
                  <RefreshCw className={`h-4 w-4 ${loadingSocialPlatforms ? 'animate-spin' : ''}`} />
                </button>
              </div>
              <div className="divide-y divide-gray-100">
                {socialPlatforms.map((p) => (
                  <div key={p.platform_key} className="px-6 py-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <Globe className="h-4 w-4 text-gray-400 shrink-0" />
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-gray-900 text-sm">{p.platform_label}</span>
                            {p.configured ? (
                              p.enabled ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200" title="Credentials saved and platform is enabled — users can connect their accounts">
                                  <CheckCircle className="h-3 w-3" /> Ready
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200" title="Credentials are saved but the platform is not enabled. Tick 'Enable this platform' and save.">
                                  <AlertCircle className="h-3 w-3" /> Saved · Not enabled
                                </span>
                              )
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500 border border-gray-200" title="No credentials entered yet">
                                <XCircle className="h-3 w-3" /> Not set up
                              </span>
                            )}
                          </div>
                          {p.configured && (
                            <div className="text-xs text-gray-400 mt-0.5">
                              Client ID: {p.client_id_preview} · Secret: {p.has_client_secret ? '••••••' : 'not set'}
                              {p.updated_at && ` · Updated ${new Date(p.updated_at).toLocaleDateString()}`}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {(() => {
                          const cr = platformCheckResults[p.platform_key];
                          if (!cr) return null;
                          if (!cr.credentials_ok) return (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-red-50 border border-red-200 text-red-700" title="Client ID / Secret not found — enter credentials and save">
                              <XCircle className="h-3 w-3" /> Credentials missing
                            </span>
                          );
                          if (cr.token_ok === false) return (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-red-50 border border-red-200 text-red-700" title={cr.token_detail ?? 'Token invalid or expired — reconnect the account'}>
                              <XCircle className="h-3 w-3" /> Token invalid — {cr.token_detail ?? 'reconnect account'}
                            </span>
                          );
                          if (cr.token_ok === true) return (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-emerald-50 border border-emerald-200 text-emerald-700" title={cr.token_detail ?? ''}>
                              <CheckCircle className="h-3 w-3" /> {cr.token_detail ?? 'Live · OK'}
                            </span>
                          );
                          // credentials_ok=true, token_ok=null — app credentials are valid, no connected account to live-test
                          const fromEnv = (cr as any).credentials_source === 'env';
                          return fromEnv ? (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-amber-50 border border-amber-200 text-amber-700" title="Credentials found in .env file only — not saved via Super Admin. Add them here to manage centrally.">
                              <AlertCircle className="h-3 w-3" /> Creds from .env only · Add to DB
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-emerald-50 border border-emerald-200 text-emerald-700" title="OAuth app credentials verified in DB. No user account connected yet — go to Social Platforms to connect one.">
                              <CheckCircle className="h-3 w-3" /> App credentials OK · No account connected yet
                            </span>
                          );
                        })()}
                        <button
                          onClick={() => checkPlatformConfig(p.platform_key)}
                          disabled={checkingPlatform === p.platform_key}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-gray-50 border border-gray-200 text-gray-600 text-xs font-medium hover:bg-gray-100 transition-colors disabled:opacity-50"
                          title="Verify credentials and token"
                        >
                          <RefreshCw className={`h-3.5 w-3.5 ${checkingPlatform === p.platform_key ? 'animate-spin' : ''}`} />
                          {checkingPlatform === p.platform_key ? 'Checking…' : 'Check'}
                        </button>
                        <button
                          onClick={() => setExpandedPlatform(expandedPlatform === p.platform_key ? null : p.platform_key)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-medium hover:bg-indigo-100 transition-colors shrink-0"
                        >
                          {expandedPlatform === p.platform_key ? <><ChevronUp className="h-3.5 w-3.5" /> Close</> : <><ChevronDown className="h-3.5 w-3.5" /> {p.configured ? 'Update' : 'Configure'}</>}
                        </button>
                      </div>
                    </div>

                    {expandedPlatform === p.platform_key && (
                      <div className="mt-4 bg-gray-50 rounded-lg border border-gray-200 p-4 space-y-3">
                        {/* Redirect URI — must be registered in the platform's developer console */}
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">
                            Redirect URI <span className="text-gray-400 font-normal">(register this exact URL in the platform developer console)</span>
                          </label>
                          {(() => {
                            // Prefer window.location.origin so the displayed URL always matches
                            // the domain the admin is actually on (avoids stale NEXT_PUBLIC_APP_URL).
                            const base = (typeof window !== 'undefined' ? window.location.origin : (process.env.NEXT_PUBLIC_APP_URL || '')).replace(/\/$/, '');
                            const uri = `${base}/api/auth/${p.platform_key}/callback`;
                            return (
                              <div className="flex items-center gap-2">
                                <input
                                  readOnly
                                  value={uri}
                                  className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-gray-600 font-mono cursor-text select-all"
                                  onFocus={(e) => e.target.select()}
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    navigator.clipboard.writeText(uri).then(() => {
                                      setCopiedRedirectFor(p.platform_key);
                                      setTimeout(() => setCopiedRedirectFor(null), 2000);
                                    });
                                  }}
                                  className="shrink-0 inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-gray-300 bg-white text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                                  title="Copy redirect URI"
                                >
                                  {copiedRedirectFor === p.platform_key ? (
                                    <><Check className="h-3.5 w-3.5 text-emerald-600" /> Copied</>
                                  ) : (
                                    <><Copy className="h-3.5 w-3.5" /> Copy</>
                                  )}
                                </button>
                              </div>
                            );
                          })()}
                          {!process.env.NEXT_PUBLIC_APP_URL && (
                            <p className="mt-1 text-xs text-amber-600">
                              Tip: set <code className="font-mono bg-amber-50 px-1 rounded">NEXT_PUBLIC_APP_URL</code> in your .env to lock this URL across environments.
                            </p>
                          )}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">Client ID *</label>
                            <input
                              type="text"
                              value={oauthForm[p.platform_key]?.client_id || ''}
                              onChange={(e) => setOauthForm((prev) => ({ ...prev, [p.platform_key]: { ...prev[p.platform_key], client_id: e.target.value } }))}
                              placeholder={p.configured ? 'Enter to replace…' : 'Paste Client ID…'}
                              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">Client Secret</label>
                            <div className="relative">
                              <input
                                type={showSecretFor === p.platform_key ? 'text' : 'password'}
                                value={oauthForm[p.platform_key]?.client_secret || ''}
                                onChange={(e) => setOauthForm((prev) => ({ ...prev, [p.platform_key]: { ...prev[p.platform_key], client_secret: e.target.value } }))}
                                placeholder="Paste Client Secret…"
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                              />
                              <button
                                type="button"
                                onClick={() => setShowSecretFor((prev) => prev === p.platform_key ? null : p.platform_key)}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                title={showSecretFor === p.platform_key ? 'Hide' : 'Show'}
                              >
                                {showSecretFor === p.platform_key ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                              </button>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id={`enabled-${p.platform_key}`}
                            checked={oauthForm[p.platform_key]?.enabled ?? false}
                            onChange={(e) => setOauthForm((prev) => ({ ...prev, [p.platform_key]: { ...prev[p.platform_key], enabled: e.target.checked } }))}
                            className="rounded border-gray-300"
                          />
                          <label htmlFor={`enabled-${p.platform_key}`} className="text-xs text-gray-700">Enable this platform (company admins can connect accounts)</label>
                        </div>
                        {oauthSaveMsg?.platform === p.platform_key && (
                          <div className={`text-xs px-3 py-2 rounded-lg ${oauthSaveMsg.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                            {oauthSaveMsg.text}
                          </div>
                        )}
                        <div className="flex justify-end">
                          <button
                            onClick={() => saveOauthConfig(p.platform_key)}
                            disabled={savingOauth === p.platform_key}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                          >
                            <Save className="h-3.5 w-3.5" />
                            {savingOauth === p.platform_key ? 'Saving…' : 'Save Credentials'}
                          </button>
                        </div>
                        <div className="text-xs text-gray-400 border-t border-gray-200 pt-2">
                          Credentials are encrypted with AES-256-GCM before storage. Only the first 6 characters of the Client ID are shown after saving.
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
            )}

            {/* Other API category sub-tabs */}
            {apiSubTab !== 'social' && renderApiCategorySection(apiSubTab)}
          </div>
          );
        })()}

        {activeTab === 'audit' && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 rounded-t-lg">
              <h3 className="text-lg font-semibold text-gray-900">Audit Logs</h3>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Target</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Reason</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">IP Address</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div>
                          <div className="text-sm font-medium text-gray-900">{log.user_name}</div>
                          <div className="text-sm text-gray-500">{log.user_role}</div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${getActionColor(log.action)}`}>
                          {log.action.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {log.table_name}: {log.record_id}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500 max-w-xs truncate">
                        {log.reason || 'No reason provided'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {log.ip_address}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(log.created_at).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {showCreateCompanyModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4">
            <div className="p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Create Company</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Company Name</label>
                  <input
                    type="text"
                    value={companyForm.name}
                    onChange={(e) => setCompanyForm((prev) => ({ ...prev, name: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    placeholder="Acme Inc."
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Website</label>
                  <input
                    type="text"
                    value={companyForm.website}
                    onChange={(e) => setCompanyForm((prev) => ({ ...prev, website: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    placeholder="acme.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Industry</label>
                  <input
                    type="text"
                    value={companyForm.industry}
                    onChange={(e) => setCompanyForm((prev) => ({ ...prev, industry: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    placeholder="SaaS"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => setShowCreateCompanyModal(false)}
                  className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateCompany}
                  disabled={isLoading}
                  className="px-4 py-2 bg-gray-900 text-white rounded-lg disabled:opacity-50"
                >
                  {isLoading ? 'Creating...' : 'Create Company'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showCreateCompanyAdminModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4">
            <div className="p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Add Company User</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
                  <input
                    type="email"
                    value={companyAdminForm.email}
                    onChange={(e) => setCompanyAdminForm((prev) => ({ ...prev, email: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    placeholder="admin@acme.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Company</label>
                  <select
                    value={companyAdminForm.companyId}
                    onChange={(e) => setCompanyAdminForm((prev) => ({ ...prev, companyId: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  >
                    <option value="">Select company</option>
                    {companies.map((company) => (
                      <option key={company.id} value={company.id}>
                        {company.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Role</label>
                  <select
                    value={companyAdminForm.role}
                    onChange={(e) => setCompanyAdminForm((prev) => ({ ...prev, role: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  >
                    {roleOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => setShowCreateCompanyAdminModal(false)}
                  className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateCompanyAdmin}
                  disabled={isLoading}
                  className="px-4 py-2 bg-gray-900 text-white rounded-lg disabled:opacity-50"
                >
                  {isLoading ? 'Creating...' : 'Create Admin'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showPolicyConfirm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4">
            <div className="p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Confirm Global Policy Change</h3>
              <p className="text-sm text-gray-600 mb-4">
                This will affect ALL tenants and ALL Engagement Center actions.
              </p>
              <div className="text-sm text-gray-700 mb-6">
                Toggle: <span className="font-medium">{pendingPolicyLabel}</span>
              </div>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => {
                    if (isSavingPolicy) return;
                    setShowPolicyConfirm(false);
                    setPendingPolicy(null);
                    setPendingPolicyLabel('');
                  }}
                  className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={savePolicy}
                  disabled={isSavingPolicy}
                  className="px-4 py-2 bg-gray-900 text-white rounded-lg disabled:opacity-50"
                >
                  {isSavingPolicy ? 'Saving...' : 'Confirm'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}






