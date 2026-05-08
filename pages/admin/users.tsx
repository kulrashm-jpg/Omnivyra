import React, { useEffect, useMemo, useState } from 'react';
import { useCompanyContext } from '../../components/CompanyContext';
import { safeFetchJson } from '@/lib/utils/safeFetchJson';

type UserRow = {
  user_id: string;
  email: string | null;
  role: string | null;
};

const ROLE_OPTIONS = [
  'CONTENT_MANAGER',
  'CONTENT_PLANNER',
  'CONTENT_CREATOR',
  'CONTENT_ENGAGER',
];

export default function AdminUsersPage() {
  const {
    companies,
    selectedCompanyId,
    setSelectedCompanyId,
    isLoading,
    userRole,
  } = useCompanyContext();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('CONTENT_MANAGER');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const canManageUsers = userRole === 'SUPER_ADMIN' || userRole === 'ADMIN';
  const roleOptions = useMemo(() => {
    if (userRole === 'SUPER_ADMIN') {
      return [...ROLE_OPTIONS, 'ADMIN'];
    }
    return ROLE_OPTIONS;
  }, [userRole]);

  const loadUsers = async () => {
    if (!selectedCompanyId) return;
    setErrorMessage(null);
    const result = await safeFetchJson<{ users: unknown[] }>(
      `/api/users?companyId=${encodeURIComponent(selectedCompanyId)}`,
      { credentials: 'same-origin' },
    );
    if (result.ok === true) {
      setUsers((result.data.users as typeof users) || []);
      return;
    }
    setErrorMessage(result.message);
  };

  useEffect(() => {
    if (!canManageUsers) return;
    loadUsers();
  }, [selectedCompanyId, canManageUsers]);

  const handleInvite = async () => {
    if (!inviteEmail || !selectedCompanyId) return;
    setIsSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    const result = await safeFetchJson('/api/users/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        email: inviteEmail,
        companyId: selectedCompanyId,
        role: inviteRole,
      }),
    });
    if (result.ok === true) {
      setInviteEmail('');
      setSuccessMessage('User invited');
      await loadUsers();
    } else {
      setErrorMessage(result.message);
    }
    setIsSaving(false);
  };

  const updateRole = async (userId: string, role: string) => {
    if (!selectedCompanyId) return;
    setErrorMessage(null);
    const result = await safeFetchJson(`/api/users/${userId}/role`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ role, companyId: selectedCompanyId }),
    });
    if (result.ok === true) {
      await loadUsers();
    } else {
      setErrorMessage(result.message);
    }
  };

  const removeUser = async (userId: string) => {
    if (!selectedCompanyId) return;
    setErrorMessage(null);
    const result = await safeFetchJson(`/api/users/${userId}?companyId=${selectedCompanyId}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    if (result.ok === true) {
      await loadUsers();
    } else {
      setErrorMessage(result.message);
    }
  };

  if (isLoading) {
    return <div className="p-6 text-gray-500">Loading company context...</div>;
  }

  if (!canManageUsers) {
    return <div className="p-6 text-gray-500">Access Denied</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="bg-white rounded-lg shadow p-6">
          <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
          <p className="text-sm text-gray-600 mt-1">
            Invite users and manage roles for your company.
          </p>
        </div>

        {userRole === 'SUPER_ADMIN' && (
          <div className="bg-white rounded-lg shadow p-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Company
            </label>
            <select
              className="border rounded-md px-3 py-2 w-full"
              value={selectedCompanyId}
              onChange={(e) => setSelectedCompanyId(e.target.value)}
            >
              {companies.map((company) => (
                <option key={company.company_id} value={company.company_id}>
                  {company.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">Invite User</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input
              className="border rounded-md px-3 py-2"
              placeholder="Email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
            />
            <select
              className="border rounded-md px-3 py-2"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
            >
              {roleOptions.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
            <button
              onClick={handleInvite}
              disabled={!inviteEmail || !selectedCompanyId || isSaving}
              className="bg-indigo-600 text-white rounded-md px-4 py-2 disabled:opacity-50"
            >
              Invite
            </button>
          </div>
          {errorMessage && <div className="text-sm text-red-600">{errorMessage}</div>}
          {successMessage && <div className="text-sm text-green-600">{successMessage}</div>}
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Users</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-gray-600 border-b">
                  <th className="py-2 pr-4">Email</th>
                  <th className="py-2 pr-4">Role</th>
                  <th className="py-2 pr-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.user_id} className="border-b">
                    <td className="py-2 pr-4">{user.email || user.user_id}</td>
                    <td className="py-2 pr-4">
                      <select
                        className="border rounded-md px-2 py-1"
                        value={user.role || ''}
                        onChange={(e) => updateRole(user.user_id, e.target.value)}
                      >
                        {roleOptions.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                        {userRole === 'SUPER_ADMIN' && (
                          <option value="ADMIN">ADMIN</option>
                        )}
                      </select>
                    </td>
                    <td className="py-2 pr-4">
                      <button
                        onClick={() => removeUser(user.user_id)}
                        className="text-red-600 hover:text-red-700"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td className="py-4 text-gray-500" colSpan={3}>
                      No users found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
