import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCompanyContext } from '../components/CompanyContext';
import { getAuthToken } from '../utils/getAuthToken';
import { parseJsonResponse } from '../lib/utils/safeFetchJson';
import CostAccountingDashboard from '../components/super-admin/CostAccountingDashboard';
import ActivityCostBreakdown from '../components/super-admin/ActivityCostBreakdown';
import {
  ArrowLeft,
  BarChart3,
  Eye,
  Users,
  Activity,
  Key,
  RefreshCw,
  DollarSign,
  Coins,
  Globe,
  FileText,
  Shield,
} from 'lucide-react';
import {
  type DeletionAudit,
  type CompanyData,
  type AnalyticsSummary,
  type CampaignHealthSummary,
  type CommunityAiMetrics,
  type CommunityAiPolicy,
  OAUTH_PLATFORMS,
  KNOWN_APIS,
} from './super-admin.types';
import ApisPlatformsTab from '../components/super-admin/tabs/ApisPlatformsTab';
import CompanyUsersTab from '../components/super-admin/tabs/CompanyUsersTab';
import AnalyticsTab from '../components/super-admin/tabs/AnalyticsTab';
import PlansTab from '../components/super-admin/tabs/PlansTab';
import CommunityAiTab from '../components/super-admin/tabs/CommunityAiTab';
import SecurityTab from '../components/super-admin/tabs/SecurityTab';
import MonetizationOpsTab from '../components/super-admin/tabs/MonetizationOpsTab';
import { fetchWithAuth } from '../components/community-ai/fetchWithAuth';
import { classifyAuthFailure, isRecoverableAuthFailure } from '../lib/security/superAdminAuthFailure';

export default function SuperAdminPanel() {
  const router = useRouter();
  const { userRole } = useCompanyContext();
  const isSuperAdmin = userRole === 'SUPER_ADMIN';
  const [isSuperAdminSession, setIsSuperAdminSession] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const isSuperAdminRoute = router.pathname?.startsWith('/super-admin');
  const canShowExternalApisTab = isSuperAdminRoute || isSuperAdmin || isSuperAdminSession;
  useEffect(() => {
    if (canShowExternalApisTab) console.debug('Super Admin External API tab visible', userRole);
  }, [canShowExternalApisTab, userRole]);

  const [activeTab, setActiveTab] = useState('analytics');
  const [costSubTab, setCostSubTab] = useState<'accounting' | 'activities'>('accounting');
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingAnalytics, setIsLoadingAnalytics] = useState(false);
  const [analyticsSummary, setAnalyticsSummary] = useState<AnalyticsSummary | null>(null);
  const [campaignHealth, setCampaignHealth] = useState<CampaignHealthSummary | null>(null);
  const [isLoadingCampaignHealth, setIsLoadingCampaignHealth] = useState(false);
  const [auditLogs, setAuditLogs] = useState<DeletionAudit[]>([]);
  const [companies, setCompanies] = useState<CompanyData[]>([]);
  const [communityMetrics, setCommunityMetrics] = useState<CommunityAiMetrics | null>(null);
  const [communityPolicy, setCommunityPolicy] = useState<CommunityAiPolicy | null>(null);
  const [communityPolicyUpdatedBy, setCommunityPolicyUpdatedBy] = useState<string | null>(null);
  const [isSavingPolicy, setIsSavingPolicy] = useState(false);
  const [showPolicyConfirm, setShowPolicyConfirm] = useState(false);
  const [pendingPolicy, setPendingPolicy] = useState<CommunityAiPolicy | null>(null);
  const [pendingPolicyLabel, setPendingPolicyLabel] = useState('');
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [pricingPlans, setPricingPlans] = useState<Array<{ id: string; plan_key: string; name: string; description?: string | null; monthly_price?: number | null }>>([]);
  const [plansLimits, setPlansLimits] = useState<Record<string, Record<string, number | null>>>({});
  const [plansDraftLimits, setPlansDraftLimits] = useState<Record<string, Record<string, string>>>({});
  const [isSavingPlan, setIsSavingPlan] = useState<string | null>(null);
  const [plansSaveError, setPlansSaveError] = useState<string | null>(null);
  const [plansSaveSuccess, setPlansSaveSuccess] = useState<string | null>(null);
  const [plansSubTab, setPlansSubTab] = useState<'plans' | 'consumption'>('plans');
  const [externalApisHealth, setExternalApisHealth] = useState<{ healthy: number; warning: number; failed: number; status: string } | null>(null);

  // Hydration-stability gate. The dashboard's tree depends on
  // useCompanyContext (userRole, isAuthenticated), router state, and async
  // probes — all of which differ between SSR and the first client render
  // and were producing the lucide icon mismatches when conditional
  // sub-trees re-flowed during hydration. Holding the entire panel behind
  // a single `mounted` flag makes the SSR HTML and the first client render
  // identical (both render the placeholder), so React never sees a tree
  // mismatch. After the effect fires we know hydration has settled and
  // can safely render the auth-dependent UI.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    // Phase 1 — Session Integrity Diagnostics: probe the bridge-honoring
    // analytics-summary endpoint to confirm the operator has SOME super-admin
    // authority. We only redirect to login on a real NOT_AUTHENTICATED
    // response. Capability/step-up failures and network blips no longer
    // boot the operator — those surface inline via the per-tab auth banner.
    void (async () => {
      try {
        const r = await fetchWithAuth('/api/super-admin/analytics-summary');
        if (r.ok) return;
        const failure = await classifyAuthFailure(r);
        if (failure.kind === 'not_authenticated') {
          // eslint-disable-next-line no-console
          console.warn('[super-admin] initial probe → not_authenticated, redirecting', {
            correlationId: failure.correlationId,
          });
          window.location.href = '/super-admin/login';
          return;
        }
        if (isRecoverableAuthFailure(failure)) {
          setAuthError(`Initial super-admin probe denied (${failure.kind}${'capability' in failure && failure.capability ? `: ${failure.capability}` : ''}).`);
        }
      } catch (err) {
        // Network blip — DO NOT log the operator out. Surface a banner;
        // the user can hit refresh.
        // eslint-disable-next-line no-console
        console.warn('[super-admin] initial probe network error (preserving session)', err);
        setAuthError('Network error contacting super-admin API. Check your connection and retry.');
      }
    })();
    loadSuperAdminData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadSuperAdminData = async () => {
    setIsLoading(true);
    setIsLoadingAnalytics(true);
    setIsLoadingCampaignHealth(true);
    try {
      const auditResponse = await fetchWithAuth('/api/admin/audit-logs');
      if (auditResponse.ok) {
        const auditData = await auditResponse.json();
        setAuditLogs(auditData.logs || []);
        setIsSuperAdminSession(true);
      }

      const analyticsResponse = await fetchWithAuth('/api/super-admin/analytics-summary');
      if (analyticsResponse.ok) {
        setAnalyticsSummary(await analyticsResponse.json() || null);
        setIsSuperAdminSession(true);
      } else {
        setAnalyticsSummary(null);
      }

      const healthResponse = await fetchWithAuth('/api/super-admin/campaign-health');
      if (healthResponse.ok) {
        setCampaignHealth(await healthResponse.json() || null);
        setIsSuperAdminSession(true);
      } else {
        setCampaignHealth(null);
      }

      // Load companies (needed for AnalyticsTab campaign-health company name lookup)
      const companiesResponse = await fetchWithAuth('/api/super-admin/companies');
      if (companiesResponse.ok) {
        const companiesData = await companiesResponse.json();
        setCompanies(companiesData.companies || []);
        setIsSuperAdminSession(true);
        setAuthError(null);
      } else if (companiesResponse.status === 403) {
        setAuthError('Session expired or not authorised. Please log in via the Super Admin login page.');
      }

      const communityResponse = await fetchWithAuth('/api/super-admin/community-ai-metrics');
      if (communityResponse.ok) {
        setCommunityMetrics(await communityResponse.json() || null);
        setIsSuperAdminSession(true);
      }

      const policyResponse = await fetchWithAuth('/api/super-admin/community-ai-policy');
      if (policyResponse.ok) {
        const policyData = await policyResponse.json();
        setCommunityPolicy(policyData?.policy || null);
        setCommunityPolicyUpdatedBy(policyData?.updated_by_email || null);
        setIsSuperAdminSession(true);
      }

      const healthRes = await fetchWithAuth('/api/external-apis/health-summary');
      if (healthRes.ok) setExternalApisHealth(await healthRes.json());
      else setExternalApisHealth(null);

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

  const openPolicyConfirm = (key: keyof CommunityAiPolicy, label: string) => {
    const basePolicy = communityPolicy || defaultPolicy;
    setPendingPolicy({ ...basePolicy, [key]: !basePolicy[key] });
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
      const parsed = await parseJsonResponse<{ policy?: any; updated_by_email?: string }>(response, '/api/super-admin/community-ai-policy');
      if (parsed.ok !== true) throw new Error(parsed.message || 'Failed to update policy');
      setCommunityPolicy(parsed.data?.policy || null);
      setCommunityPolicyUpdatedBy(parsed.data?.updated_by_email || null);
      alert('Community-AI platform policy updated.');
    } catch (error: unknown) {
      console.error('Error updating platform policy:', error);
      alert(error instanceof Error ? error.message : 'Failed to update platform policy');
    } finally {
      setIsSavingPolicy(false);
      setShowPolicyConfirm(false);
      setPendingPolicy(null);
      setPendingPolicyLabel('');
    }
  };

  const setPlanDraftLimit = (planId: string, resourceKey: string, value: string) => {
    setPlansDraftLimits((prev) => ({ ...prev, [planId]: { ...(prev[planId] || {}), [resourceKey]: value } }));
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
        if (v == null || String(v).trim() === '') { limits[key] = null; }
        else { const n = parseInt(String(v).trim(), 10); limits[key] = Number.isFinite(n) ? n : null; }
      }
      const response = await fetchWithAuth('/api/super-admin/plans/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_key: plan.plan_key, name: plan.name, description: plan.description ?? null, monthly_price: plan.monthly_price ?? null, limits }),
      });
      const parsed = await parseJsonResponse(response, '/api/super-admin/plans/create');
      if (parsed.ok !== true) throw new Error(parsed.message || 'Failed to update plan');
      setPlansSaveSuccess(`${plan.name} limits updated.`);
      setPlansLimits((prev) => ({ ...prev, [plan.id]: limits }));
    } catch (error: unknown) {
      setPlansSaveError(error instanceof Error ? error.message : 'Failed to update plan');
    } finally {
      setIsSavingPlan(null);
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

  if (!mounted) {
    // Stable placeholder — IDENTICAL on SSR and first client render so React
    // hydration finds no mismatch. The full dashboard renders on the next
    // tick once `setMounted(true)` runs in the effect above.
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 shadow-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button onClick={() => window.location.href = '/team-management'} className="p-2 hover:bg-slate-100 rounded-lg transition-colors text-slate-600">
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div>
                <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
                  <div className="p-2.5 bg-blue-100 rounded-lg"><BarChart3 className="h-6 w-6 text-blue-600" /></div>
                  Platform Analytics Console
                </h1>
                <p className="text-sm text-slate-600 mt-1">Realtime analytics and governance across all tenants</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={loadSuperAdminData}
                disabled={isLoading}
                className="px-4 py-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 font-medium transition-all rounded-lg disabled:opacity-50 flex items-center gap-2"
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
                className="px-4 py-2 bg-slate-900 text-white hover:bg-slate-800 rounded-lg font-medium transition-all disabled:opacity-50"
              >
                {isLoggingOut ? 'Signing out...' : 'Logout'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Navigation Tabs */}
        <div className="flex flex-wrap gap-2 bg-white rounded-lg p-2 mb-8 shadow-sm border border-slate-200">
          {[
            { id: 'analytics',      label: 'Analytics',         icon: BarChart3  },
            { id: 'company-users',  label: 'Companies & Users',  icon: Users      },
            { id: 'plans',          label: 'Pricing & Plans',    icon: DollarSign },
            { id: 'monetization-ops', label: 'Monetization Ops',  icon: Coins      },
            { id: 'community-ai',   label: 'Engagement',         icon: Activity   },
            { id: 'cost-analysis',  label: 'Cost Analysis',      icon: DollarSign },
            { id: 'audit',          label: 'Audit Logs',         icon: Eye        },
            { id: 'social-platforms', label: 'APIs',             icon: Globe      },
            { id: 'security',       label: 'Security',           icon: Shield     },
            { id: 'blog',           label: 'Blog',               icon: FileText   },
          ].map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  if (tab.id === 'blog') { router.push('/admin/blog'); return; }
                  setActiveTab(tab.id);
                }}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-all duration-200 whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
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
          <AnalyticsTab
            isLoadingAnalytics={isLoadingAnalytics}
            analyticsSummary={analyticsSummary}
            campaignHealth={campaignHealth}
            isLoadingCampaignHealth={isLoadingCampaignHealth}
            canShowExternalApisTab={canShowExternalApisTab}
            externalApisHealth={externalApisHealth}
            companies={companies}
            onNavigateToApis={() => setActiveTab('social-platforms')}
          />
        )}

        {activeTab === 'company-users' && (
          <CompanyUsersTab authError={authError} />
        )}

        {activeTab === 'plans' && (
          <PlansTab
            pricingPlans={pricingPlans}
            plansLimits={plansLimits}
            plansDraftLimits={plansDraftLimits}
            isSavingPlan={isSavingPlan}
            plansSaveError={plansSaveError}
            plansSaveSuccess={plansSaveSuccess}
            plansSubTab={plansSubTab}
            setPlansSubTab={setPlansSubTab}
            setPlanDraftLimit={setPlanDraftLimit}
            handleSavePlanLimits={handleSavePlanLimits}
          />
        )}

        {activeTab === 'community-ai' && (
          <CommunityAiTab
            communityPolicy={communityPolicy}
            defaultPolicy={defaultPolicy}
            communityMetrics={communityMetrics}
            communityPolicyUpdatedBy={communityPolicyUpdatedBy}
            isSavingPolicy={isSavingPolicy}
            openPolicyConfirm={openPolicyConfirm}
          />
        )}

        {activeTab === 'monetization-ops' && (
          <MonetizationOpsTab />
        )}

        {activeTab === 'social-platforms' && (
          <ApisPlatformsTab authError={authError} />
        )}

        {activeTab === 'security' && (
          <SecurityTab />
        )}

        {activeTab === 'cost-analysis' && (
          <div className="space-y-6">
            <div className="flex gap-2 bg-white rounded-lg p-2 border border-slate-200 shadow-sm">
              {([{ id: 'accounting', label: 'Cost Accounting' }, { id: 'activities', label: 'Activities' }] as const).map((sub) => (
                <button
                  key={sub.id}
                  onClick={() => setCostSubTab(sub.id)}
                  className={`px-4 py-2 rounded-lg font-medium transition-all text-sm ${costSubTab === sub.id ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}
                >
                  {sub.label}
                </button>
              ))}
            </div>
            {costSubTab === 'accounting' && (
              <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
                <CostAccountingDashboard />
              </div>
            )}
            {costSubTab === 'activities' && (
              <div className="bg-white rounded-lg shadow-sm border border-slate-200">
                <ActivityCostBreakdown period="month" />
              </div>
            )}
          </div>
        )}

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
                        <div className="text-sm font-medium text-gray-900">{log.user_name}</div>
                        <div className="text-sm text-gray-500">{log.user_role}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${getActionColor(log.action)}`}>
                          {log.action.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{log.table_name}: {log.record_id}</td>
                      <td className="px-6 py-4 text-sm text-gray-500 max-w-xs truncate">{log.reason || 'No reason provided'}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{log.ip_address}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{new Date(log.created_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {showPolicyConfirm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4">
            <div className="p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Confirm Global Policy Change</h3>
              <p className="text-sm text-gray-600 mb-4">This will affect ALL tenants and ALL Engagement Center actions.</p>
              <div className="text-sm text-gray-700 mb-6">
                Toggle: <span className="font-medium">{pendingPolicyLabel}</span>
              </div>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => { if (isSavingPolicy) return; setShowPolicyConfirm(false); setPendingPolicy(null); setPendingPolicyLabel(''); }}
                  className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
                >
                  Cancel
                </button>
                <button onClick={savePolicy} disabled={isSavingPolicy} className="px-4 py-2 bg-gray-900 text-white rounded-lg disabled:opacity-50">
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
