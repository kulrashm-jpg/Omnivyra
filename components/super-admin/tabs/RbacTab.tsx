import React, { useState, useEffect } from 'react';
import { getAuthToken } from '@/utils/getAuthToken';
import { type RbacPermissions, roleOptions } from '@/pages/super-admin.types';
import { fetchWithAuth } from '../../community-ai/fetchWithAuth';
import { parseJsonResponse } from '@/lib/utils/safeFetchJson';

export default function RbacTab() {

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

  useEffect(() => {
    setRbacDraftPermissions(rbacPermissions || {});
    setRbacDirty(false);
  }, [rbacPermissions]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetchWithAuth('/api/super-admin/rbac');
        const result = await parseJsonResponse<{ roles?: string[]; permissions?: RbacPermissions; error?: string; message?: string }>(res, '/api/super-admin/rbac');
        if (result.ok === true) {
          setRbacRoles(result.data?.roles || []);
          setRbacPermissions(result.data?.permissions || {});
          setRbacError(null);
          return;
        }
        // Map auth errors to a user-friendly message; surface other failures verbatim.
        const errBody = (typeof result.data === 'object' && result.data !== null) ? (result.data as { error?: string }) : null;
        if (errBody?.error === 'NOT_AUTHORIZED' || errBody?.error === 'FORBIDDEN_ROLE' || result.status === 403) {
          setRbacError('Access denied. Please log in again from the Super Admin login page.');
        } else {
          setRbacError(result.message || 'Failed to load RBAC configuration');
        }
      } catch {
        setRbacError('Failed to load RBAC configuration');
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const normalizePermissionKey = (value: string) =>
    value.trim().toUpperCase().replace(/\s+/g, '_');

  const displayRoles =
    rbacRoles.length > 0
      ? rbacRoles
      : ['SUPER_ADMIN', ...roleOptions.map((option) => option.id)];

  const togglePermissionRole = (permission: string, role: string) => {
    setRbacDraftPermissions((prev) => {
      const current = prev[permission] || [];
      const isAllRoles = current.includes('*');
      let nextRoles = current;
      if (role === '*') {
        nextRoles = isAllRoles ? [] : ['*'];
      } else {
        const cleaned = current.filter((e) => e !== '*');
        nextRoles = cleaned.includes(role) ? cleaned.filter((e) => e !== role) : [...cleaned, role];
      }
      return { ...prev, [permission]: nextRoles };
    });
    setRbacDirty(true);
  };

  const toggleNewPermissionRole = (role: string) => {
    setNewPermissionRoles((prev) => {
      const isAllRoles = prev.includes('*');
      if (role === '*') return isAllRoles ? [] : ['*'];
      const cleaned = prev.filter((e) => e !== '*');
      return cleaned.includes(role) ? cleaned.filter((e) => e !== role) : [...cleaned, role];
    });
  };

  const handleAddPermission = () => {
    const key = normalizePermissionKey(newPermissionKey);
    if (!key) { alert('Permission key is required.'); return; }
    if (rbacDraftPermissions[key]) { alert('That permission already exists.'); return; }
    setRbacDraftPermissions((prev) => ({ ...prev, [key]: newPermissionRoles.length ? newPermissionRoles : [] }));
    setNewPermissionKey('');
    setNewPermissionRoles([]);
    setRbacDirty(true);
  };

  const handleRemovePermission = (permission: string) => {
    if (!confirm(`Delete permission ${permission}? This cannot be undone.`)) return;
    setRbacDraftPermissions((prev) => { const next = { ...prev }; delete next[permission]; return next; });
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
        body: JSON.stringify({ roles: displayRoles, permissions: rbacDraftPermissions }),
      });
      const result = await parseJsonResponse<{ roles?: string[]; permissions?: RbacPermissions }>(response, '/api/super-admin/rbac');
      if (result.ok !== true) {
        setRbacSaveError(result.message || 'Failed to update RBAC configuration');
        return;
      }
      setRbacRoles(result.data?.roles || displayRoles);
      setRbacPermissions(result.data?.permissions || rbacDraftPermissions);
      setRbacSaveSuccess('RBAC permissions updated.');
      setRbacDirty(false);
    } catch (error: unknown) {
      setRbacSaveError(error instanceof Error ? error.message : 'Failed to update RBAC configuration');
    } finally {
      setIsSavingRbac(false);
    }
  };

  const permissionEntries = Object.entries(rbacDraftPermissions || {});

  return (
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
            <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">{rbacError}</div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-gray-900 mb-2">Roles</div>
              <div className="flex flex-wrap gap-2">
                {displayRoles.map((role) => (
                  <span key={role} className="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-800">{role}</span>
                ))}
              </div>
              <div className="text-xs text-gray-500 mt-2">Roles are system-defined. Use permissions below to control access.</div>
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
            <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">{rbacSaveError}</div>
          )}
          {rbacSaveSuccess && (
            <div className="rounded-md bg-green-50 border border-green-200 p-3 text-sm text-green-700">{rbacSaveSuccess}</div>
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
                  <input type="checkbox" checked={newPermissionRoles.includes('*')} onChange={() => toggleNewPermissionRole('*')} />
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
              <button onClick={handleAddPermission} className="px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg">
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
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Permission</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Allowed Roles</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {permissionEntries.map(([permission, roles]) => {
                const isAllRoles = roles.includes('*');
                return (
                  <tr key={permission} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{permission}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      <div className="flex flex-wrap gap-3">
                        <label className="flex items-center gap-2 text-xs text-gray-700">
                          <input type="checkbox" checked={isAllRoles} onChange={() => togglePermissionRole(permission, '*')} />
                          All roles
                        </label>
                        {displayRoles.map((role) => (
                          <label key={`${permission}-${role}`} className="flex items-center gap-2 text-xs text-gray-700">
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
                      <button onClick={() => handleRemovePermission(permission)} className="text-red-600 hover:text-red-900 text-xs font-medium">
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
              {permissionEntries.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-6 py-8 text-center text-sm text-gray-500">No permissions available.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
