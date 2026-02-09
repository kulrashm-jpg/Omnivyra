import React, { useEffect, useMemo, useState } from 'react';
import { useCompanyContext } from '../../components/CompanyContext';
import CommunityAiLayout from '../../components/community-ai/CommunityAiLayout';
import SectionCard from '../../components/community-ai/SectionCard';
import { fetchWithAuth } from '../../components/community-ai/fetchWithAuth';

type DiscoveredUser = {
  id: string;
  tenant_id: string;
  organization_id: string;
  platform: string;
  external_username?: string | null;
  profile_url: string;
  discovered_via: 'api' | 'rpa';
  discovery_source?: 'post' | 'comment' | 'thread' | 'search' | null;
  classification?: 'influencer' | 'peer' | 'prospect' | 'spam_risk' | 'unknown' | null;
  eligible_for_engagement: boolean;
  blocked_reason?: string | null;
  last_seen_at: string;
  source_url?: string | null;
};

const PLATFORM_OPTIONS = ['all', 'facebook', 'instagram', 'twitter', 'reddit'] as const;
const CLASSIFICATION_OPTIONS = [
  'all',
  'influencer',
  'peer',
  'prospect',
  'spam_risk',
  'unknown',
] as const;
const DISCOVERED_VIA_OPTIONS = ['all', 'api', 'rpa'] as const;
const ELIGIBLE_OPTIONS = ['all', 'eligible', 'ineligible'] as const;

const canEditRole = (role?: string | null) =>
  ['CONTENT_CREATOR', 'CONTENT_REVIEWER', 'CONTENT_PUBLISHER', 'COMPANY_ADMIN', 'SUPER_ADMIN'].includes(
    (role || '').toString()
  );

export default function DiscoveredUsersPage() {
  const { selectedCompanyId, userRole } = useCompanyContext();
  const tenantId = selectedCompanyId || '';
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [users, setUsers] = useState<DiscoveredUser[]>([]);
  const [filters, setFilters] = useState({
    platform: 'all',
    classification: 'all',
    discovered_via: 'all',
    eligible: 'all',
  });

  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [blockedReasonDraft, setBlockedReasonDraft] = useState('');

  const canEdit = useMemo(() => canEditRole(userRole), [userRole]);

  const buildQuery = () => {
    const params = new URLSearchParams({
      tenant_id: tenantId,
      organization_id: tenantId,
      limit: '50',
      offset: '0',
    });
    if (filters.platform !== 'all') params.set('platform', filters.platform);
    if (filters.classification !== 'all') params.set('classification', filters.classification);
    if (filters.discovered_via !== 'all') params.set('discovered_via', filters.discovered_via);
    if (filters.eligible !== 'all') {
      params.set('eligible_for_engagement', filters.eligible === 'eligible' ? 'true' : 'false');
    }
    return params.toString();
  };

  const loadUsers = async () => {
    if (!tenantId) return;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const response = await fetchWithAuth(`/api/community-ai/discovered-users?${buildQuery()}`);
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || 'Failed to load discovered users');
      }
      const data = await response.json();
      setUsers(data.users || []);
    } catch (error: any) {
      setErrorMessage(error?.message || 'Failed to load discovered users');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, [tenantId]);

  const handleFilterChange = (key: string, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const updateUser = async (user: DiscoveredUser, updates: Partial<DiscoveredUser>) => {
    if (!tenantId) return;
    setErrorMessage(null);
    try {
      const response = await fetchWithAuth('/api/community-ai/discovered-users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: user.id,
          tenant_id: tenantId,
          organization_id: tenantId,
          eligible_for_engagement: updates.eligible_for_engagement ?? user.eligible_for_engagement,
          blocked_reason: updates.blocked_reason ?? user.blocked_reason ?? null,
          classification: updates.classification ?? user.classification ?? 'unknown',
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || 'Failed to update user');
      }
      const data = await response.json();
      setUsers((prev) =>
        prev.map((entry) => (entry.id === user.id ? { ...entry, ...data.user } : entry))
      );
      setEditingRowId(null);
      setBlockedReasonDraft('');
    } catch (error: any) {
      setErrorMessage(error?.message || 'Failed to update user');
    }
  };

  const handleEligibilityToggle = (user: DiscoveredUser, eligible: boolean) => {
    if (!canEdit) return;
    if (!eligible) {
      setEditingRowId(user.id);
      setBlockedReasonDraft(user.blocked_reason || '');
      return;
    }
    void updateUser(user, { eligible_for_engagement: true, blocked_reason: null });
  };

  const handleBlockedReasonSave = (user: DiscoveredUser) => {
    if (!blockedReasonDraft.trim()) {
      setErrorMessage('Blocked reason is required when marking ineligible.');
      return;
    }
    void updateUser(user, { eligible_for_engagement: false, blocked_reason: blockedReasonDraft });
  };

  return (
    <CommunityAiLayout title="Discovered Users" context={{ tenant_id: tenantId, organization_id: tenantId }}>
      {errorMessage && (
        <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg p-3">
          {errorMessage}
        </div>
      )}

      <SectionCard title="Filters" subtitle="Refine the discovered users list.">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <select
            className="border rounded-lg px-3 py-2 text-sm"
            value={filters.platform}
            onChange={(e) => handleFilterChange('platform', e.target.value)}
          >
            {PLATFORM_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value === 'all' ? 'All platforms' : value}
              </option>
            ))}
          </select>
          <select
            className="border rounded-lg px-3 py-2 text-sm"
            value={filters.classification}
            onChange={(e) => handleFilterChange('classification', e.target.value)}
          >
            {CLASSIFICATION_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value === 'all' ? 'All classifications' : value}
              </option>
            ))}
          </select>
          <select
            className="border rounded-lg px-3 py-2 text-sm"
            value={filters.eligible}
            onChange={(e) => handleFilterChange('eligible', e.target.value)}
          >
            {ELIGIBLE_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value === 'all' ? 'All eligibility' : value}
              </option>
            ))}
          </select>
          <select
            className="border rounded-lg px-3 py-2 text-sm"
            value={filters.discovered_via}
            onChange={(e) => handleFilterChange('discovered_via', e.target.value)}
          >
            {DISCOVERED_VIA_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value === 'all' ? 'All sources' : value.toUpperCase()}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button
            className="px-3 py-2 text-sm rounded-md bg-indigo-600 text-white"
            onClick={loadUsers}
            disabled={!tenantId || isLoading}
          >
            {isLoading ? 'Loading...' : 'Apply Filters'}
          </button>
          {!canEdit && (
            <span className="text-xs text-gray-500">Read-only access</span>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Discovered Users" subtitle="Review and manage eligibility for engagement.">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm text-left text-gray-700">
            <thead className="text-xs uppercase text-gray-500 border-b">
              <tr>
                <th className="px-3 py-2">platform</th>
                <th className="px-3 py-2">username / profile</th>
                <th className="px-3 py-2">classification</th>
                <th className="px-3 py-2">discovered via</th>
                <th className="px-3 py-2">source</th>
                <th className="px-3 py-2">eligible</th>
                <th className="px-3 py-2">last seen</th>
                <th className="px-3 py-2">actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b">
                  <td className="px-3 py-2">{user.platform}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col">
                      <span>{user.external_username || 'Unknown'}</span>
                      <a
                        href={user.profile_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-indigo-600"
                      >
                        View profile
                      </a>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {canEdit ? (
                      <select
                        className="border rounded px-2 py-1 text-xs"
                        value={user.classification || 'unknown'}
                        onChange={(e) =>
                          updateUser(user, { classification: e.target.value as DiscoveredUser['classification'] })
                        }
                        disabled={!canEdit}
                      >
                        {CLASSIFICATION_OPTIONS.filter((value) => value !== 'all').map((value) => (
                          <option key={value} value={value}>
                            {value}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span>{user.classification || 'unknown'}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">{user.discovered_via.toUpperCase()}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col">
                      <span>{user.discovery_source || 'unknown'}</span>
                      {user.source_url && (
                        <a
                          href={user.source_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-indigo-600"
                        >
                          View source
                        </a>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2">{user.eligible_for_engagement ? 'Yes' : 'No'}</td>
                  <td className="px-3 py-2">
                    {user.last_seen_at ? new Date(user.last_seen_at).toLocaleString() : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col gap-2">
                      {user.eligible_for_engagement ? (
                        <button
                          className="px-2 py-1 text-xs rounded border border-gray-300 text-gray-600"
                          onClick={() => handleEligibilityToggle(user, false)}
                          disabled={!canEdit}
                        >
                          Mark Ineligible
                        </button>
                      ) : (
                        <button
                          className="px-2 py-1 text-xs rounded border border-emerald-500 text-emerald-600"
                          onClick={() => handleEligibilityToggle(user, true)}
                          disabled={!canEdit}
                        >
                          Mark Eligible
                        </button>
                      )}
                      {editingRowId === user.id && (
                        <div className="flex flex-col gap-1">
                          <input
                            className="border rounded px-2 py-1 text-xs"
                            placeholder="Blocked reason"
                            value={blockedReasonDraft}
                            onChange={(e) => setBlockedReasonDraft(e.target.value)}
                          />
                          <button
                            className="px-2 py-1 text-xs rounded border border-indigo-500 text-indigo-600"
                            onClick={() => handleBlockedReasonSave(user)}
                          >
                            Save
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && !isLoading && (
                <tr>
                  <td className="px-3 py-3 text-gray-400" colSpan={8}>
                    No discovered users found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </CommunityAiLayout>
  );
}
