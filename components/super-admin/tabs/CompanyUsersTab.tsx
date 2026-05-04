import React, { useState, useEffect } from 'react';
import { getAuthToken } from '@/utils/getAuthToken';
import {
  type CompanyData,
  type AppUserData,
  roleOptions,
} from '@/pages/super-admin.types';
import {
  Search,
  XCircle,
  CheckCircle,
  Trash2,
} from 'lucide-react';
import RbacTab from './RbacTab';
import CompaniesTable from './CompaniesTable';
import { apiFetch } from '@/lib/apiFetch';

interface CompanyUsersTabProps {
  authError: string | null;
}

export default function CompanyUsersTab({ authError }: CompanyUsersTabProps) {

  const [isLoading, setIsLoading] = useState(false);
  const [companies, setCompanies] = useState<CompanyData[]>([]);
  const [appUsers, setAppUsers] = useState<AppUserData[]>([]);
  const [companySubTab, setCompanySubTab] = useState<'users' | 'rbac'>('users');
  const [showCreateCompanyModal, setShowCreateCompanyModal] = useState(false);
  const [showCreateCompanyAdminModal, setShowCreateCompanyAdminModal] = useState(false);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [companySearch, setCompanySearch] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [showAllUsers, setShowAllUsers] = useState(true);
  const [companyForm, setCompanyForm] = useState({ name: '', website: '', industry: '' });
  const [companyAdminForm, setCompanyAdminForm] = useState({ email: '', companyId: '', role: 'COMPANY_ADMIN' });

  const loadData = async () => {
    setIsLoading(true);
    try {
      const companiesResponse = await apiFetch('/api/super-admin/companies');
      if (companiesResponse.ok) {
        const data = await companiesResponse.json();
        setCompanies(data.companies || []);
      }
      const usersResponse = await apiFetch('/api/super-admin/users');
      if (usersResponse.ok) {
        const data = await usersResponse.json();
        setAppUsers(data.users || []);
      }
    } catch (error) {
      console.error('Error loading company/user data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreateCompany = async () => {
    if (!companyForm.name.trim() || !companyForm.website.trim()) {
      alert('Company name and website are required');
      return;
    }
    setIsLoading(true);
    try {
      const response = await apiFetch('/api/super-admin/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: companyForm.name, website: companyForm.website, industry: companyForm.industry }),
      });
      if (response.ok) {
        setCompanyForm({ name: '', website: '', industry: '' });
        setShowCreateCompanyModal(false);
        loadData();
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
      const response = await apiFetch('/api/super-admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: companyAdminForm.email, companyId: companyAdminForm.companyId, role: companyAdminForm.role }),
      });
      if (response.ok) {
        setCompanyAdminForm({ email: '', companyId: '', role: 'COMPANY_ADMIN' });
        setShowCreateCompanyAdminModal(false);
        loadData();
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
    if (!confirm(`Are you sure you want to mark this company as ${nextStatus}?`)) return;
    setIsLoading(true);
    try {
      const response = await apiFetch('/api/super-admin/companies', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, status: nextStatus }),
      });
      if (!response.ok) { const r = await response.json(); alert(r.error || 'Failed to update company status'); return; }
      await loadData();
    } catch (error) {
      console.error('Error updating company status:', error);
      alert('Failed to update company status');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteCompany = async (companyId: string) => {
    if (!confirm('Delete this company and all its user roles? This cannot be undone.')) return;
    setIsLoading(true);
    try {
      const response = await apiFetch('/api/super-admin/companies', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId }),
      });
      if (!response.ok) { const r = await response.json(); alert(r.error || 'Failed to delete company'); return; }
      if (selectedCompanyId === companyId) setSelectedCompanyId(null);
      await loadData();
    } catch (error) {
      console.error('Error deleting company:', error);
      alert('Failed to delete company');
    } finally {
      setIsLoading(false);
    }
  };

  const handleUserStatusChange = async (userId: string, companyId: string, nextStatus: 'active' | 'inactive') => {
    if (!confirm(`Are you sure you want to mark this user as ${nextStatus}?`)) return;
    setIsLoading(true);
    try {
      const response = await apiFetch('/api/super-admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, companyId, status: nextStatus }),
      });
      if (!response.ok) { const r = await response.json(); alert(`Error: ${r.details || r.error || 'Failed to update user status'}`); return; }
      await loadData();
    } catch (error) {
      console.error('Error updating user status:', error);
      alert('Failed to update user status');
    } finally {
      setIsLoading(false);
    }
  };

  const handleUserRoleChange = async (userId: string, companyId: string, nextRole: string) => {
    if (!confirm(`Change this user's role to ${nextRole}?`)) return;
    setIsLoading(true);
    try {
      const response = await apiFetch('/api/super-admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, companyId, role: nextRole }),
      });
      if (!response.ok) { const r = await response.json(); alert(`Error: ${r.details || r.error || 'Failed to update user role'}`); return; }
      await loadData();
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
    if (!confirm(confirmMsg)) return;
    setIsLoading(true);
    try {
      const response = await apiFetch('/api/super-admin/users', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, companyId }),
      });
      if (!response.ok) {
        const r = await response.json();
        console.error('Delete error response:', r);
        alert(`Error: ${r.details || r.error || 'Failed to delete user'}`);
        return;
      }
      await loadData();
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

  const normalizedCompanySearch = companySearch.trim().toLowerCase();
  const filteredCompanies = companies.filter((company) => {
    if (!normalizedCompanySearch) return true;
    return [company.name, company.website, company.industry || ''].join(' ').toLowerCase().includes(normalizedCompanySearch);
  });

  const normalizedUserSearch = userSearch.trim().toLowerCase();
  const scopedUsers = selectedCompanyId
    ? appUsers.filter((user) => user.company_id === selectedCompanyId)
    : showAllUsers ? appUsers : [];
  const filteredUsers = scopedUsers.filter((user) => {
    if (!normalizedUserSearch) return true;
    return [user.email, user.company_name || '', user.company_id || '', user.role || '', user.status || '']
      .join(' ').toLowerCase().includes(normalizedUserSearch);
  });

  return (
    <>
      <div className="space-y-6">
        {authError && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-6 py-4 flex items-center justify-between">
            <span className="text-sm text-red-700">{authError}</span>
            <a href="/super-admin/login" className="ml-4 px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition-colors whitespace-nowrap">
              Log in
            </a>
          </div>
        )}

        {/* Sub-tabs */}
        <div className="flex gap-2 bg-white rounded-lg p-2 w-fit border border-slate-200 shadow-sm">
          {([{ id: 'users', label: 'Companies & Users' }, { id: 'rbac', label: 'RBAC' }] as const).map((sub) => (
            <button
              key={sub.id}
              onClick={() => setCompanySubTab(sub.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${companySubTab === sub.id ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'}`}
            >
              {sub.label}
            </button>
          ))}
        </div>

        {companySubTab === 'rbac' && <RbacTab />}

        {companySubTab === 'users' && <>
        <CompaniesTable
          companies={companies}
          filteredCompanies={filteredCompanies}
          selectedCompanyId={selectedCompanyId}
          companySearch={companySearch}
          setSelectedCompanyId={setSelectedCompanyId}
          setShowAllUsers={setShowAllUsers}
          setCompanySearch={setCompanySearch}
          setShowCreateCompanyModal={setShowCreateCompanyModal}
          handleCompanyStatusChange={handleCompanyStatusChange}
          handleDeleteCompany={handleDeleteCompany}
        />

        <div className="bg-white rounded-lg shadow-sm border border-slate-200">
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 rounded-t-lg flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-slate-900">
                {selectedCompanyId
                  ? `Users for ${companies.find((c) => c.id === selectedCompanyId)?.name || 'Company'}`
                  : 'All Users'}
              </h3>
              <p className="text-xs text-slate-600">
                {selectedCompanyId
                  ? 'Manage users for the selected company.'
                  : showAllUsers
                    ? 'Manage users across all companies. Select a company above to see only its users.'
                    : 'Select a company above to see its users.'}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 bg-white border border-slate-300 rounded-lg px-3 py-2">
                <Search className="h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search users..."
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  className="text-sm outline-none bg-white"
                />
              </div>
              <div className="flex items-center gap-2 text-xs">
                <button
                  onClick={() => setShowAllUsers(true)}
                  className={`px-3 py-2 rounded-lg font-medium transition-colors ${showAllUsers ? 'bg-blue-600 text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                >
                  All Companies
                </button>
                <button
                  onClick={() => setShowAllUsers(false)}
                  disabled={!selectedCompanyId}
                  className={`px-3 py-2 rounded-lg font-medium transition-colors ${!showAllUsers ? 'bg-blue-600 text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'} disabled:opacity-50`}
                >
                  Selected Company
                </button>
              </div>
              <button
                onClick={() => {
                  if (selectedCompanyId) setCompanyAdminForm((prev) => ({ ...prev, companyId: selectedCompanyId }));
                  setShowCreateCompanyAdminModal(true);
                }}
                disabled={!selectedCompanyId}
                className="px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                Add User
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Email</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Company</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Role</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Created</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-200">
                {filteredUsers.map((user) => (
                  <tr key={`${user.user_id}-${user.company_id}`} className="hover:bg-slate-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900">{user.email}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">{user.company_name || user.company_id}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      <select
                        value={user.role}
                        onChange={(e) => handleUserRoleChange(user.user_id, user.company_id, e.target.value)}
                        className="border border-gray-300 rounded-lg px-2 py-1 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={isLoading || !user.company_id}
                        title={!user.company_id ? 'Assign this user to a company first' : undefined}
                      >
                        {!roleOptions.some((option) => option.id === user.role) && (
                          <option value={user.role}>{user.role}</option>
                        )}
                        {roleOptions.map((option) => (
                          <option key={option.id} value={option.id}>{option.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(user.status || 'active')}`}>
                        {user.status || 'active'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{new Date(user.created_at).toLocaleDateString()}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleUserStatusChange(user.user_id, user.company_id, (user.status || 'active') === 'active' ? 'inactive' : 'active')}
                          disabled={!user.company_id}
                          className="text-yellow-600 hover:text-yellow-900 p-1 rounded hover:bg-yellow-50 disabled:opacity-50 disabled:cursor-not-allowed"
                          title={user.company_id ? ((user.status || 'active') === 'active' ? 'Make Inactive' : 'Make Active') : 'User must be assigned to a company'}
                        >
                          {(user.status || 'active') === 'active' ? <XCircle className="h-4 w-4" /> : <CheckCircle className="h-4 w-4" />}
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
                    <td colSpan={6} className="px-6 py-8 text-center text-sm text-gray-500">No users match the current filters.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        </>}
      </div>

      {showCreateCompanyModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Create Company</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Company Name</label>
                <input type="text" value={companyForm.name} onChange={(e) => setCompanyForm((p) => ({ ...p, name: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2" placeholder="Acme Inc." />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Website</label>
                <input type="text" value={companyForm.website} onChange={(e) => setCompanyForm((p) => ({ ...p, website: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2" placeholder="acme.com" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Industry</label>
                <input type="text" value={companyForm.industry} onChange={(e) => setCompanyForm((p) => ({ ...p, industry: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2" placeholder="SaaS" />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setShowCreateCompanyModal(false)} className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors">Cancel</button>
              <button onClick={handleCreateCompany} disabled={isLoading} className="px-4 py-2 bg-gray-900 text-white rounded-lg disabled:opacity-50">
                {isLoading ? 'Creating...' : 'Create Company'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCreateCompanyAdminModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Add Company User</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
                <input type="email" value={companyAdminForm.email} onChange={(e) => setCompanyAdminForm((p) => ({ ...p, email: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2" placeholder="admin@acme.com" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Company</label>
                <select value={companyAdminForm.companyId} onChange={(e) => setCompanyAdminForm((p) => ({ ...p, companyId: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2">
                  <option value="">Select company</option>
                  {companies.map((company) => (
                    <option key={company.id} value={company.id}>{company.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Role</label>
                <select value={companyAdminForm.role} onChange={(e) => setCompanyAdminForm((p) => ({ ...p, role: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2">
                  {roleOptions.map((option) => (
                    <option key={option.id} value={option.id}>{option.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setShowCreateCompanyAdminModal(false)} className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors">Cancel</button>
              <button onClick={handleCreateCompanyAdmin} disabled={isLoading} className="px-4 py-2 bg-gray-900 text-white rounded-lg disabled:opacity-50">
                {isLoading ? 'Creating...' : 'Create Admin'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
