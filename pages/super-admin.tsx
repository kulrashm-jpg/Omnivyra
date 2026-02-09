import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useCompanyContext } from '../components/CompanyContext';
import { supabase } from '../utils/supabaseClient';
import {
  ArrowLeft,
  BarChart3,
  Eye,
  Users,
  Activity,
  Key,
  RefreshCw,
  CheckCircle,
  XCircle,
  Search,
  Trash2,
  TrendingUp
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
  const canShowExternalApisTab = isSuperAdmin || isSuperAdminSession;
  useEffect(() => {
    if (canShowExternalApisTab) {
      console.debug('Super Admin External API tab visible', userRole);
    }
  }, [canShowExternalApisTab, userRole]);
  const [activeTab, setActiveTab] = useState('analytics');
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
  const [isSavingPolicy, setIsSavingPolicy] = useState(false);
  const [showPolicyConfirm, setShowPolicyConfirm] = useState(false);
  const [pendingPolicy, setPendingPolicy] = useState<CommunityAiPolicy | null>(null);
  const [pendingPolicyLabel, setPendingPolicyLabel] = useState('');
  const [isLoggingOut, setIsLoggingOut] = useState(false);
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
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    const headers = {
      ...(init?.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    const options: RequestInit = {
      ...init,
      headers,
    };
    if (!token) {
      options.credentials = 'include';
    }
    return fetch(input, options);
  };

  useEffect(() => {
    loadSuperAdminData();
  }, []);

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
        setRbacError('Failed to load RBAC configuration');
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
        alert(result.error || 'Failed to update user status');
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
        alert(result.error || 'Failed to update user role');
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

  const handleDeleteUser = async (userId: string, companyId: string) => {
    if (!confirm('Remove this user from the company? This cannot be undone.')) {
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
        alert(result.error || 'Failed to delete user');
        return;
      }
      await loadSuperAdminData();
    } catch (error) {
      console.error('Error deleting user:', error);
      alert('Failed to delete user');
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
  const scopedUsers = showAllUsers
    ? appUsers
    : selectedCompanyId
      ? appUsers.filter((user) => user.company_id === selectedCompanyId)
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
  const permissionEntries = Object.entries(rbacPermissions || {});

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
            { id: 'analytics', label: 'Analytics', icon: BarChart3 },
            { id: 'campaign-health', label: 'Campaign Health', icon: TrendingUp },
            { id: 'company-users', label: 'Companies & Users', icon: Users },
            { id: 'rbac', label: 'RBAC', icon: Key },
            { id: 'community-ai', label: 'Community-AI', icon: Activity },
            { id: 'audit', label: 'Audit Logs', icon: Eye },
            ...(canShowExternalApisTab
              ? [{ id: 'external-apis', label: 'External API Control', icon: BarChart3 }]
              : [])
          ].map((tab) => {
            const Icon = tab.icon;
            const isExternalApiControl = tab.id === 'external-apis';
            return (
              <button
                key={tab.id}
                onClick={() => {
                  if (isExternalApiControl) {
                    router.push('/external-apis?mode=platform');
                    return;
                  }
                  setActiveTab(tab.id);
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
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
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
          </div>
        )}

        {activeTab === 'campaign-health' && (
          <div className="space-y-6">
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
          </div>
        )}

        {activeTab === 'company-users' && (
          <div className="space-y-6">
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
                    {filteredCompanies.map((company) => (
                      <tr key={company.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          <button
                            onClick={() => {
                              setSelectedCompanyId(company.id);
                              setShowAllUsers(false);
                            }}
                            className="text-left hover:text-red-600 transition-colors"
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
                    ))}
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
                    {showAllUsers
                      ? 'Manage users across all companies.'
                      : 'Manage users for the selected company.'}
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
                              className="text-yellow-600 hover:text-yellow-900 p-1 rounded hover:bg-yellow-50"
                              title={(user.status || 'active') === 'active' ? 'Make Inactive' : 'Make Active'}
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
                              title="Delete User"
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
          </div>
        )}

        {activeTab === 'rbac' && (
          <div className="space-y-6">
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
                </div>
                <div className="text-xs text-gray-500">
                  Permission updates are defined in the RBAC configuration. If you need edits from the dashboard,
                  tell me and I will add persistence.
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
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {permissionEntries.map(([permission, roles]) => (
                      <tr key={permission} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {permission}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-600">
                          {roles.includes('*') ? (
                            <span className="px-2 py-1 text-xs rounded-full bg-green-100 text-green-800">
                              All roles
                            </span>
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              {roles.map((role) => (
                                <span
                                  key={`${permission}-${role}`}
                                  className="px-2 py-1 text-xs rounded-full bg-gray-100 text-gray-800"
                                >
                                  {role}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                    {permissionEntries.length === 0 && (
                      <tr>
                        <td colSpan={2} className="px-6 py-8 text-center text-sm text-gray-500">
                          No permissions available.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
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
                      Community-AI Execution Paused
                    </p>
                    <p className="text-sm text-yellow-700">
                      Community-AI execution is currently paused at the platform level.
                      All tenants and all Community-AI actions (manual, scheduled, and automated) are affected.
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="bg-white rounded-lg shadow-sm border border-gray-200">
              <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 rounded-t-lg">
                <h3 className="text-lg font-semibold text-gray-900">Global Platform Policy</h3>
                <p className="text-sm text-gray-600 mt-1">
                  This policy applies to ALL tenants and ALL Community-AI actions.
                </p>
              </div>
              <div className="p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">Enable Community-AI Execution</p>
                    <p className="text-xs text-gray-500">Global kill switch for all executions</p>
                  </div>
                  <button
                    onClick={() => openPolicyConfirm('execution_enabled', 'Enable Community-AI Execution')}
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
                <h3 className="text-lg font-semibold text-gray-900">Community-AI (Platform-level)</h3>
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
                This will affect ALL tenants and ALL Community-AI actions.
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






