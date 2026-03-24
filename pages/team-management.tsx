import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { ArrowLeft, Shield, UserPlus, Users, RefreshCw } from 'lucide-react';
import { getAuthToken } from '../utils/getAuthToken';
import { useCompanyContext } from '../components/CompanyContext';
import Header from '../components/Header';

type TeamMember = {
  user_id?: string;
  id?: string;
  name?: string;
  email: string;
  role: string;
  status?: string;
  created_at: string;
};

const roleOptions = [
  { id: 'COMPANY_ADMIN', name: 'Company Admin', description: 'Manage users and permissions' },
  { id: 'CONTENT_CREATOR', name: 'Content Creator', description: 'Create content' },
  { id: 'CONTENT_REVIEWER', name: 'Content Reviewer', description: 'Approve content' },
  { id: 'CONTENT_PUBLISHER', name: 'Content Publisher', description: 'Publish content' },
  { id: 'VIEW_ONLY', name: 'View Only', description: 'View content' },
];

export default function TeamManagement() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('members');
  const [isLoading, setIsLoading] = useState(false);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteForm, setInviteForm] = useState({
    name: '',
    email: '',
    role: 'CONTENT_CREATOR',
  });
  const [roleNotice, setRoleNotice] = useState('');
  const [toastMessage, setToastMessage] = useState('');

  const { selectedCompanyId, selectedCompanyName, userRole, isAuthenticated, refreshCompanies } = useCompanyContext();
  const canManage =
    userRole === 'COMPANY_ADMIN' ||
    userRole === 'SUPER_ADMIN' ||
    userRole === 'ADMIN';

  const fetchWithAuth = async (input: RequestInfo, init?: RequestInit) => {
    const token = await getAuthToken();
    if (!token) {
      throw new Error('Not authenticated');
    }
    return fetch(input, {
      ...init,
      headers: {
        ...(init?.headers || {}),
        Authorization: `Bearer ${token}`,
      },
    });
  };

  const loadUsers = async () => {
    if (!selectedCompanyId) return;
    setIsLoading(true);
    try {
      const response = await fetchWithAuth(
        `/api/company/users?companyId=${selectedCompanyId}&ts=${Date.now()}`,
        { cache: 'no-store' }
      );
      const data = await response.json();
      if (!response.ok) {
        console.error(data.error || 'FAILED_TO_LIST_USERS');
        const errorCode = data.error || 'FAILED_TO_LIST_USERS';
        const friendlyMessage =
          errorCode === 'FORBIDDEN_ROLE'
            ? "You don't have permission to view this company's team. If you were invited, accept the invite first. Otherwise select a company you belong to or contact your admin."
            : errorCode === 'COMPANY_ACCESS_DENIED'
            ? "You don't have access to this company. Please select a company you belong to from the dropdown."
            : errorCode === 'UNAUTHORIZED'
            ? 'Please log in again to view team members.'
            : errorCode;
        setToastMessage(friendlyMessage);
        setTeamMembers([]);
        if (errorCode === 'FORBIDDEN_ROLE' || errorCode === 'COMPANY_ACCESS_DENIED') {
          refreshCompanies?.();
        }
        return;
      }
      const users = (data.users || []).map((row: any) => ({
        user_id: row.user_id,
        name: row.name || '',
        email: row.email || '',
        role: row.role,
        status: row.status || 'active',
        created_at: row.created_at,
      }));
      setTeamMembers(users);
    } catch (error: any) {
      console.error('Error loading users:', error);
      setToastMessage(error?.message || 'Failed to load users');
      setTeamMembers([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!toastMessage) return;
    const timer = window.setTimeout(() => {
      setToastMessage('');
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [toastMessage]);

  useEffect(() => {
    if (!isAuthenticated) {
      setTeamMembers([]);
      setRoleNotice('');
      return;
    }
    if (!selectedCompanyId) {
      setRoleNotice('Select a company first');
      return;
    }
    setRoleNotice('');
    loadUsers();
  }, [isAuthenticated, selectedCompanyId]);

  const sendInvitation = async () => {
    if (!inviteForm.email || !inviteForm.role || !selectedCompanyId) return;
    setIsLoading(true);
    try {
      const response = await fetchWithAuth('/api/company/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: inviteForm.name,
          email: inviteForm.email,
          role: inviteForm.role,
          companyId: selectedCompanyId,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        setToastMessage(result.error || 'Failed to invite user');
        return;
      }
      setInviteForm({ name: '', email: '', role: 'CONTENT_CREATOR' });
      setShowInviteModal(false);
      setToastMessage(result.message || 'Invitation sent');
      loadUsers();
    } catch (error: any) {
      console.error('Error sending invitation:', error);
      setToastMessage(error?.message || 'Failed to invite user');
    } finally {
      setIsLoading(false);
    }
  };

  const updateUserRole = async (userId: string, role: string) => {
    if (!selectedCompanyId) return;
    setIsLoading(true);
    try {
      const response = await fetchWithAuth('/api/company/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: selectedCompanyId, role, userId }),
      });
      if (!response.ok) {
        const result = await response.json();
        setToastMessage(result.error || 'Failed to update role');
        return;
      }
      loadUsers();
    } catch (error: any) {
      console.error('Error updating role:', error);
      setToastMessage(error?.message || 'Failed to update role');
    } finally {
      setIsLoading(false);
    }
  };

  const reinviteUser = async (email: string, role: string, name?: string) => {
    if (!selectedCompanyId) return;
    setIsLoading(true);
    try {
      const response = await fetchWithAuth('/api/company/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role, name, companyId: selectedCompanyId }),
      });
      const result = await response.json();
      if (!response.ok) {
        setToastMessage(result.error || 'Failed to reinvite user');
        return;
      }
      setToastMessage(result.message || 'Reinvite sent');
      loadUsers();
    } catch (error: any) {
      console.error('Error reinviting user:', error);
      setToastMessage(error?.message || 'Failed to reinvite user');
    } finally {
      setIsLoading(false);
    }
  };

  const deactivateUser = async (userId: string, role: string) => {
    if (!selectedCompanyId) return;
    setIsLoading(true);
    try {
      const response = await fetchWithAuth('/api/company/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: selectedCompanyId, role, userId, status: 'inactive' }),
      });
      const result = await response.json();
      if (!response.ok) {
        setToastMessage(result.error || 'Failed to deactivate user');
        return;
      }
      setToastMessage('User deactivated');
      loadUsers();
    } catch (error: any) {
      console.error('Error deactivating user:', error);
      setToastMessage(error?.message || 'Failed to deactivate user');
    } finally {
      setIsLoading(false);
    }
  };

  const removeUser = async (userId: string) => {
    if (!selectedCompanyId) return;
    if (!window.confirm('Remove this user from the company?')) return;
    setIsLoading(true);
    try {
      const response = await fetchWithAuth('/api/company/users', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: selectedCompanyId, userId }),
      });
      const result = await response.json();
      if (!response.ok) {
        setToastMessage(result.error || 'Failed to remove user');
        return;
      }
      setToastMessage('User removed');
      loadUsers();
    } catch (error: any) {
      console.error('Error removing user:', error);
      setToastMessage(error?.message || 'Failed to remove user');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-100 via-purple-100 to-pink-100">
      <Header />
      <div className="bg-gradient-to-r from-indigo-200/90 via-purple-200/90 to-pink-200/90 backdrop-blur-sm border-b border-purple-300/50 shadow-lg">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.push('/team-management')}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ArrowLeft className="h-5 w-5 text-gray-600" />
              </button>
              <div>
                <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
                  Team Management
                </h1>
                <p className="text-gray-600 mt-1">
                  {selectedCompanyName ? `Company: ${selectedCompanyName}` : 'Manage your team members'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  if (canManage) setShowInviteModal(true);
                }}
                disabled={!canManage}
                className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white px-6 py-3 rounded-xl font-semibold shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 flex items-center gap-2 disabled:opacity-50"
              >
                <UserPlus className="h-5 w-5" />
                Invite Member
              </button>
              <button
                onClick={loadUsers}
                disabled={isLoading}
                className="px-4 py-2 text-gray-600 hover:text-gray-900 font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                Refresh Users
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="mb-8">
          <div className="flex space-x-1 bg-white/70 backdrop-blur-sm rounded-xl p-1 border border-gray-200/50">
            {[
              { id: 'members', label: 'Team Members', icon: Users },
              { id: 'roles', label: 'Roles', icon: Shield },
            ].map((tab) => {
              const IconComponent = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all duration-200 ${
                    activeTab === tab.id
                      ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-lg'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-white/50'
                  }`}
                >
                  <IconComponent className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {!isAuthenticated && (
          <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-200/50 p-6">
            <p className="text-gray-700">Please log in to manage your team.</p>
          </div>
        )}

        {isAuthenticated && !userRole && (
          <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-200/50 p-6">
            <p className="text-gray-700">No company role assigned yet.</p>
          </div>
        )}

        {roleNotice && (
          <div className="text-yellow-600 text-sm mb-2">
            {roleNotice}
          </div>
        )}

        {toastMessage && (
          <div className="bg-orange-100 text-orange-700 rounded-lg p-4 mb-6">
            {toastMessage}
          </div>
        )}

        {activeTab === 'members' && isAuthenticated && (
          <div className="space-y-6">
            <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-200/50 p-6">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-xl font-bold text-gray-900">
                  Team Members ({teamMembers.length})
                </h2>
                <span className="text-xs text-gray-500">
                  Use the Role dropdown to assign roles
                </span>
              </div>
              {teamMembers.length === 0 ? (
                <p className="text-gray-600">No users yet. Invite your first team member.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {teamMembers.map((member) => (
                        <tr key={member.user_id || member.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {member.name || '—'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {member.email}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                            {member.role}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm">
                            <span
                              className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                                member.status === 'invited'
                                  ? 'bg-yellow-100 text-yellow-800'
                                  : member.status === 'expired'
                                  ? 'bg-orange-100 text-orange-700'
                                  : member.status === 'inactive' || member.status === 'deactivated'
                                  ? 'bg-red-100 text-red-700'
                                  : 'bg-green-100 text-green-700'
                              }`}
                            >
                              {member.status || 'active'}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {new Date(member.created_at).toLocaleDateString()}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                            <div className="flex items-center gap-3">
                              <select
                                value={member.role}
                                onChange={(e) => updateUserRole(String(member.user_id || member.id), e.target.value)}
                                className="border border-gray-300 rounded-lg px-3 py-1"
                                disabled={isLoading || !canManage}
                              >
                                {roleOptions.map((role) => (
                                  <option key={role.id} value={role.id}>
                                    {role.name}
                                  </option>
                                ))}
                              </select>
                              {member.status === 'invited' && (
                                <button
                                  onClick={() => reinviteUser(member.email, member.role, member.name)}
                                  disabled={isLoading || !canManage}
                                  className="text-indigo-600 hover:text-indigo-800 text-sm font-medium disabled:opacity-50"
                                >
                                  Reinvite
                                </button>
                              )}
                              {member.status === 'invited' && canManage && (
                                <button
                                  onClick={() => removeUser(String(member.user_id || member.id))}
                                  disabled={isLoading}
                                  className="text-red-600 hover:text-red-800 text-sm font-medium disabled:opacity-50"
                                >
                                  Cancel Invite
                                </button>
                              )}
                              {member.status === 'active' && canManage && (
                                <button
                                  onClick={() => deactivateUser(String(member.user_id || member.id), member.role)}
                                  disabled={isLoading}
                                  className="text-red-600 hover:text-red-800 text-sm font-medium disabled:opacity-50"
                                >
                                  Deactivate
                                </button>
                              )}
                              {member.status === 'active' && canManage && (
                                <button
                                  onClick={() => removeUser(String(member.user_id || member.id))}
                                  disabled={isLoading}
                                  className="text-red-600 hover:text-red-800 text-sm font-medium disabled:opacity-50"
                                >
                                  Remove
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'roles' && (
          <div className="space-y-6">
            <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-200/50 p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-6">Roles</h2>
              <div className="space-y-3">
                {roleOptions.map((role) => (
                  <div key={role.id} className="bg-white/80 backdrop-blur-sm rounded-xl p-4 border border-gray-200/50">
                    <h4 className="font-semibold text-gray-900">{role.name}</h4>
                    <p className="text-sm text-gray-600 mt-1">{role.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {showInviteModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md mx-4">
            <h3 className="text-xl font-bold text-gray-900 mb-4">Invite Team Member</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Full Name</label>
                <input
                  type="text"
                  value={inviteForm.name}
                  onChange={(e) => setInviteForm((prev) => ({ ...prev, name: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  placeholder="Alex Johnson"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Email Address</label>
                <input
                  type="email"
                  value={inviteForm.email}
                  onChange={(e) => setInviteForm((prev) => ({ ...prev, email: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  placeholder="colleague@drishiq.com"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Role</label>
                <select
                  value={inviteForm.role}
                  onChange={(e) => setInviteForm((prev) => ({ ...prev, role: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                >
                  {roleOptions.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center gap-3 mt-6">
              <button
                onClick={() => setShowInviteModal(false)}
                className="flex-1 px-4 py-2 text-gray-600 hover:text-gray-900 font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={sendInvitation}
                disabled={isLoading || !inviteForm.email}
                className="flex-1 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg font-medium transition-all duration-200"
              >
                {isLoading ? 'Sending...' : 'Send Invitation'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
