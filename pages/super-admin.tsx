import React, { useState, useEffect } from 'react';
import { 
  ArrowLeft, 
  Shield, 
  Trash2, 
  Eye, 
  AlertTriangle,
  Users,
  Database,
  Activity,
  Settings,
  Key,
  Clock,
  CheckCircle,
  XCircle,
  Search,
  Filter,
  Download,
  RefreshCw,
  Lock,
  Unlock
} from 'lucide-react';

interface SuperAdminUser {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  lastActive: string;
  createdAt: string;
  isSuperAdmin: boolean;
}

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

interface CampaignData {
  id: string;
  name: string;
  status: string;
  created_at: string;
  user_id: string;
  user_name: string;
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
  created_at: string;
}

export default function SuperAdminPanel() {
  const [activeTab, setActiveTab] = useState('overview');
  const [isLoading, setIsLoading] = useState(false);
  const [superAdmins, setSuperAdmins] = useState<SuperAdminUser[]>([]);
  const [auditLogs, setAuditLogs] = useState<DeletionAudit[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignData[]>([]);
  const [companies, setCompanies] = useState<CompanyData[]>([]);
  const [appUsers, setAppUsers] = useState<AppUserData[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState<string | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [showCreateCompanyModal, setShowCreateCompanyModal] = useState(false);
  const [showCreateCompanyAdminModal, setShowCreateCompanyAdminModal] = useState(false);
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

  useEffect(() => {
    loadSuperAdminData();
  }, []);

  const loadSuperAdminData = async () => {
    setIsLoading(true);
    try {
      // Load super admins
      const adminsResponse = await fetch('/api/admin/super-admins');
      if (adminsResponse.ok) {
        const adminsData = await adminsResponse.json();
        setSuperAdmins(adminsData.admins || []);
      }

      // Load audit logs
      const auditResponse = await fetch('/api/admin/audit-logs');
      if (auditResponse.ok) {
        const auditData = await auditResponse.json();
        setAuditLogs(auditData.logs || []);
      }

      // Super Admin dashboard does not request campaigns without companyId
      setCampaigns([]);

      // Load companies
      const companiesResponse = await fetch('/api/super-admin/companies');
      if (companiesResponse.ok) {
        const companiesData = await companiesResponse.json();
        setCompanies(companiesData.companies || []);
      }

      // Load users
      const usersResponse = await fetch('/api/super-admin/users');
      if (usersResponse.ok) {
        const usersData = await usersResponse.json();
        setAppUsers(usersData.users || []);
      }
    } catch (error) {
      console.error('Error loading super admin data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateCompany = async () => {
    if (!companyForm.name.trim() || !companyForm.website.trim()) {
      alert('Company name and website are required');
      return;
    }
    setIsLoading(true);
    try {
      const response = await fetch('/api/super-admin/companies', {
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
      const response = await fetch('/api/super-admin/users', {
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

  const handleDeleteCampaign = async () => {
    if (!selectedCampaign || !deleteReason.trim()) {
      alert('Please provide a reason for deletion');
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch('/api/admin/delete-campaign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId: selectedCampaign,
          reason: deleteReason,
          ipAddress: '127.0.0.1', // In production, get real IP
          userAgent: navigator.userAgent
        })
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          alert('Campaign deleted successfully');
          setShowDeleteModal(false);
          setSelectedCampaign(null);
          setDeleteReason('');
          loadSuperAdminData(); // Refresh data
        } else {
          alert(`Error: ${result.error}`);
        }
      } else {
        alert('Failed to delete campaign');
      }
    } catch (error) {
      console.error('Error deleting campaign:', error);
      alert('Failed to delete campaign');
    } finally {
      setIsLoading(false);
    }
  };

  const grantSuperAdmin = async (userId: string) => {
    if (!confirm('Are you sure you want to grant super admin privileges to this user?')) {
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch('/api/admin/grant-super-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          alert('Super admin privileges granted successfully');
          loadSuperAdminData();
        } else {
          alert(`Error: ${result.error}`);
        }
      }
    } catch (error) {
      console.error('Error granting super admin:', error);
      alert('Failed to grant super admin privileges');
    } finally {
      setIsLoading(false);
    }
  };

  const revokeSuperAdmin = async (userId: string) => {
    if (!confirm('Are you sure you want to revoke super admin privileges from this user?')) {
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch('/api/admin/revoke-super-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          alert('Super admin privileges revoked successfully');
          loadSuperAdminData();
        } else {
          alert(`Error: ${result.error}`);
        }
      }
    } catch (error) {
      console.error('Error revoking super admin:', error);
      alert('Failed to revoke super admin privileges');
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
                  <Shield className="h-8 w-8 text-red-600" />
                  Super Admin Panel
                </h1>
                <p className="text-gray-600 mt-1">Advanced system administration and data management</p>
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
                  await fetch('/api/super-admin/logout', { method: 'POST' });
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
            { id: 'overview', label: 'Overview', icon: Activity },
            { id: 'campaigns', label: 'Campaign Management', icon: Database },
            { id: 'admins', label: 'Super Admins', icon: Shield },
            { id: 'company-users', label: 'Companies & Users', icon: Users },
            { id: 'audit', label: 'Audit Logs', icon: Eye }
          ].map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
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
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-red-100 rounded-lg">
                  <Shield className="h-6 w-6 text-red-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-600">Super Admins</p>
                  <p className="text-2xl font-bold text-gray-900">{superAdmins.length}</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-blue-100 rounded-lg">
                  <Database className="h-6 w-6 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-600">Total Campaigns</p>
                  <p className="text-2xl font-bold text-gray-900">{campaigns.length}</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-orange-100 rounded-lg">
                  <Eye className="h-6 w-6 text-orange-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-600">Audit Logs</p>
                  <p className="text-2xl font-bold text-gray-900">{auditLogs.length}</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-green-100 rounded-lg">
                  <Activity className="h-6 w-6 text-green-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-600">Active Users</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {superAdmins.filter(a => a.status === 'active').length}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'campaigns' && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 rounded-t-lg">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">Campaign Management</h3>
                <div className="flex items-center gap-2">
                  <Search className="h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search campaigns..."
                    className="px-3 py-1 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Campaign</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Owner</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {campaigns.map((campaign) => (
                    <tr key={campaign.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div>
                          <div className="text-sm font-medium text-gray-900">{campaign.name}</div>
                          <div className="text-sm text-gray-500">ID: {campaign.id}</div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {campaign.user_name || 'Unknown'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(campaign.status)}`}>
                          {campaign.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(campaign.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => window.location.href = `/campaign-planning-hierarchical?campaignId=${campaign.id}`}
                            className="text-blue-600 hover:text-blue-900 p-1 rounded hover:bg-blue-50"
                            title="View Campaign"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => {
                              setSelectedCampaign(campaign.id);
                              setShowDeleteModal(true);
                            }}
                            className="text-red-600 hover:text-red-900 p-1 rounded hover:bg-red-50"
                            title="Delete Campaign"
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
        )}

        {activeTab === 'admins' && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 rounded-t-lg">
              <h3 className="text-lg font-semibold text-gray-900">Super Admin Management</h3>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Active</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {superAdmins.map((admin) => (
                    <tr key={admin.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="flex-shrink-0 h-10 w-10">
                            <div className="h-10 w-10 rounded-full bg-red-100 flex items-center justify-center">
                              <Shield className="h-5 w-5 text-red-600" />
                            </div>
                          </div>
                          <div className="ml-4">
                            <div className="text-sm font-medium text-gray-900">{admin.name}</div>
                            <div className="text-sm text-gray-500">{admin.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {admin.role}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(admin.status)}`}>
                          {admin.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {admin.lastActive}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <div className="flex items-center gap-2">
                          {admin.isSuperAdmin ? (
                            <button
                              onClick={() => revokeSuperAdmin(admin.id)}
                              className="text-red-600 hover:text-red-900 p-1 rounded hover:bg-red-50 flex items-center gap-1"
                              title="Revoke Super Admin"
                            >
                              <Unlock className="h-4 w-4" />
                              Revoke
                            </button>
                          ) : (
                            <button
                              onClick={() => grantSuperAdmin(admin.id)}
                              className="text-green-600 hover:text-green-900 p-1 rounded hover:bg-green-50 flex items-center gap-1"
                              title="Grant Super Admin"
                            >
                              <Lock className="h-4 w-4" />
                              Grant
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'company-users' && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200">
              <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 rounded-t-lg flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">Companies</h3>
                <button
                  onClick={() => setShowCreateCompanyModal(true)}
                  className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium"
                >
                  Create Company
                </button>
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
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {companies.map((company) => (
                      <tr key={company.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {company.name}
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
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-gray-200">
              <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 rounded-t-lg flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">Company Admins</h3>
                <button
                  onClick={() => setShowCreateCompanyAdminModal(true)}
                  className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium"
                >
                  Create Company Admin
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Company</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {appUsers.map((user) => (
                      <tr key={user.user_id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {user.email}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                          {user.company_name || user.company_id}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                          {user.role}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {new Date(user.created_at).toLocaleDateString()}
                        </td>
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

      {/* Delete Campaign Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-red-100 rounded-lg">
                  <AlertTriangle className="h-6 w-6 text-red-600" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Delete Campaign</h3>
                  <p className="text-sm text-gray-600">This action cannot be undone</p>
                </div>
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Reason for deletion (required)
                </label>
                <textarea
                  value={deleteReason}
                  onChange={(e) => setDeleteReason(e.target.value)}
                  placeholder="Please provide a reason for deleting this campaign..."
                  className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent resize-none"
                  rows={3}
                />
              </div>

              <div className="flex justify-end gap-3">
                <button
                  onClick={() => {
                    setShowDeleteModal(false);
                    setSelectedCampaign(null);
                    setDeleteReason('');
                  }}
                  className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteCampaign}
                  disabled={isLoading || !deleteReason.trim()}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors flex items-center gap-2"
                >
                  {isLoading ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  Delete Campaign
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Create Company Admin</h3>
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
                    <option value="COMPANY_ADMIN">Company Admin</option>
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
    </div>
  );
}






