import React, { useState, useEffect } from 'react';
import { getAuthToken } from '@/utils/getAuthToken';
import { parseJsonResponse } from '@/lib/utils/safeFetchJson';
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
  Mail,
  RefreshCw,
  Ban,
  Power,
  LogOut,
} from 'lucide-react';
import RbacTab from './RbacTab';
import CompaniesTable from './CompaniesTable';
import { fetchWithAuth } from '../../community-ai/fetchWithAuth';
import { describeAuthFailure } from '@/lib/security/superAdminAuthFailure';
import { runStepUpFlowIfNeeded, describeStepUpOutcome } from '@/lib/security/superAdminStepUp';

/** Idempotency key for one logical mutation. Mirrors the idiom already used
 *  by the invitation-resend call below. */
const newIdempotencyKey = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;

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
  const [companyAdminForm, setCompanyAdminForm] = useState<{
    email: string;
    fullName: string;
    companyId: string;
    role: string;
    allowPersonalEmail: boolean;
    inviteMode: 'magic_link' | 'temp_password';
    sendInvite: boolean;
  }>({
    email: '',
    fullName: '',
    companyId: '',
    role: 'COMPANY_ADMIN',
    allowPersonalEmail: false,
    inviteMode: 'magic_link',
    sendInvite: true,
  });
  const [createUserResult, setCreateUserResult] = useState<{
    email: string;
    mode: string;
    deliveryStatus: string;
    jobId: string | null;
    queueError: string | null;
  } | null>(null);

  // Map of pending invitations keyed by lower-cased email. Populated by
  // /api/super-admin/invitations alongside the user list. Used to overlay
  // delivery state and show the resend button next to invited users.
  type InviteDelivery = {
    invitationId: string;
    deliveryState: 'queued' | 'sending' | 'sent' | 'retrying' | 'failed' | 'dead' | 'none';
    retryCount: number | null;
    maxRetries: number | null;
    nextAttemptAt: string | null;
    lastError: string | null;
  };
  const [invitesByEmail, setInvitesByEmail] = useState<Record<string, InviteDelivery>>({});

  const loadData = async () => {
    setIsLoading(true);
    try {
      const companiesResponse = await fetchWithAuth('/api/super-admin/companies');
      const companiesParsed = await parseJsonResponse<{ companies?: any[] }>(companiesResponse, '/api/super-admin/companies');
      if (companiesParsed.ok === true) setCompanies(companiesParsed.data.companies || []);

      const usersResponse = await fetchWithAuth('/api/super-admin/users');
      const usersParsed = await parseJsonResponse<{ users?: any[] }>(usersResponse, '/api/super-admin/users');
      if (usersParsed.ok === true) setAppUsers(usersParsed.data.users || []);

      // Pending invitations + delivery state (Phase 2.A.1).
      const invitesResponse = await fetchWithAuth('/api/super-admin/invitations?status=pending');
      const invitesParsed = await parseJsonResponse<{ invitations?: any[] }>(invitesResponse, '/api/super-admin/invitations');
      if (invitesParsed.ok === true && Array.isArray(invitesParsed.data.invitations)) {
        const map: Record<string, InviteDelivery> = {};
        for (const inv of invitesParsed.data.invitations) {
          const email = String(inv.email || '').toLowerCase();
          if (!email) continue;
          map[email] = {
            invitationId: inv.id,
            deliveryState: inv.delivery_state,
            retryCount: inv.latest_job?.retry_count ?? null,
            maxRetries: inv.latest_job?.max_retries ?? null,
            nextAttemptAt: inv.latest_job?.next_attempt_at ?? null,
            lastError: inv.latest_job?.last_error ?? null,
          };
        }
        setInvitesByEmail(map);
      }
    } catch (error) {
      console.error('Error loading company/user data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLifecycleAction = async (
    action: 'suspend' | 'resume' | 'force-logout',
    userId: string,
    email: string,
  ) => {
    const labels: Record<typeof action, { confirm: string; reasonPrompt: string; verb: string }> = {
      suspend: {
        confirm: `Suspend ${email}? They will be signed out immediately and cannot sign in until resumed.`,
        reasonPrompt: 'Reason for suspension (required, recorded in audit log):',
        verb: 'suspend',
      },
      resume: {
        confirm: `Resume ${email}? They will be able to sign in again.`,
        reasonPrompt: 'Reason for resuming (optional):',
        verb: 'resume',
      },
      'force-logout': {
        confirm: `Force-logout ${email}? All their active sessions will be revoked. Their account stays active and they can sign in again.`,
        reasonPrompt: 'Reason for force-logout (recorded in audit log):',
        verb: 'force-logout',
      },
    };
    const cfg = labels[action];
    if (!confirm(cfg.confirm)) return;
    const reason = action === 'resume'
      ? (prompt(cfg.reasonPrompt, '') ?? '').trim()
      : (prompt(cfg.reasonPrompt, '') ?? '').trim();
    if (action !== 'resume' && !reason) {
      alert(`A reason is required to ${cfg.verb}.`);
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetchWithAuth(
        `/api/super-admin/users/${encodeURIComponent(userId)}/${action}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason }),
        },
      );
      if (!response.ok) {
        const r = await response.json().catch(() => ({}));
        alert(`${cfg.verb} failed: ${r.details || r.error || response.statusText}`);
        return;
      }
      const body = await response.json().catch(() => ({}));
      if (action === 'force-logout') {
        alert(`Sessions revoked: ${body.revoked_sessions ?? 0}. The user can sign in again.`);
      }
      await loadData();
    } catch (error) {
      console.error(`Error on ${action}:`, error);
      alert(`Failed to ${cfg.verb}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendInvite = async (invitationId: string, email: string) => {
    if (!confirm(`Resend invitation email to ${email}?`)) return;
    setIsLoading(true);
    try {
      const idempotencyKey =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
      const response = await fetchWithAuth(`/api/super-admin/invitations/${encodeURIComponent(invitationId)}/resend`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
      });
      if (!response.ok) {
        const r = await response.json().catch(() => ({}));
        alert(`Resend failed: ${r.details || r.error || response.statusText}`);
        return;
      }
      await loadData();
    } catch (error) {
      console.error('Error resending invitation:', error);
      alert('Failed to resend invitation');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

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
        body: JSON.stringify({ name: companyForm.name, website: companyForm.website, industry: companyForm.industry }),
      });
      const parsed = await parseJsonResponse(response, '/api/super-admin/companies');
      if (parsed.ok === true) {
        setCompanyForm({ name: '', website: '', industry: '' });
        setShowCreateCompanyModal(false);
        loadData();
      } else {
        alert(parsed.message || 'Failed to create company');
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
    setCreateUserResult(null);
    try {
      // Per-request idempotency key — required by withIdempotency wrapper.
      const idempotencyKey =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;

      const response = await fetchWithAuth('/api/super-admin/users/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          email: companyAdminForm.email.trim(),
          fullName: companyAdminForm.fullName.trim() || null,
          companyId: companyAdminForm.companyId,
          role: companyAdminForm.role,
          allowPersonalEmail: companyAdminForm.allowPersonalEmail,
          inviteMode: companyAdminForm.inviteMode,
          sendInvite: companyAdminForm.sendInvite,
        }),
      });
      const parsed = await parseJsonResponse<{
        user?: { email: string; status: string };
        invitation?: { mode: string; id: string | null };
        delivery?: { status: string; job_id: string | null; queue_error: string | null };
      }>(response, '/api/super-admin/users/create');
      if (parsed.ok === true) {
        setCreateUserResult({
          email: parsed.data.user?.email ?? companyAdminForm.email,
          mode: parsed.data.invitation?.mode ?? companyAdminForm.inviteMode,
          deliveryStatus: parsed.data.delivery?.status ?? 'unknown',
          jobId: parsed.data.delivery?.job_id ?? null,
          queueError: parsed.data.delivery?.queue_error ?? null,
        });
        setCompanyAdminForm({
          email: '',
          fullName: '',
          companyId: companyAdminForm.companyId,
          role: 'COMPANY_ADMIN',
          allowPersonalEmail: false,
          inviteMode: 'magic_link',
          sendInvite: true,
        });
        loadData();
      } else {
        alert(parsed.message || 'Failed to create user');
      }
    } catch (error) {
      console.error('Error creating user:', error);
      alert('Failed to create user');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCompanyStatusChange = async (companyId: string, nextStatus: 'active' | 'inactive') => {
    if (!confirm(`Are you sure you want to mark this company as ${nextStatus}?`)) return;
    setIsLoading(true);
    try {
      const response = await fetchWithAuth('/api/super-admin/companies', {
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
      const response = await fetchWithAuth('/api/super-admin/companies', {
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
      // ONE key for the whole logical action. runStepUpFlowIfNeeded retries the
      // SAME request after elevation, and reusing the key is precisely what
      // makes that retry idempotent instead of a second mutation.
      const idempotencyKey = newIdempotencyKey();
      const fire = () => fetchWithAuth('/api/super-admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ userId, companyId, status: nextStatus }),
      });
      // identity.admin.assign is step-up gated (phishing-resistant + trusted
      // device, 10-min freshness). The first call 401s until the operator has
      // elevated; the helper runs the passkey ceremony and retries once.
      const outcome = await runStepUpFlowIfNeeded(await fire(), fire);
      if (outcome.kind === 'step_up_user_cancelled' || outcome.kind === 'step_up_unavailable') {
        alert(describeStepUpOutcome(outcome));
        return;
      }
      if (outcome.kind === 'session_lost') {
        alert(describeAuthFailure(outcome.failure));
        return;
      }
      // 'success' and 'auth_banner' both carry the server's response; fall
      // through so the API's own error detail is surfaced as before.
      const response = outcome.response;
      if (!response.ok) {
        const r = await response.json().catch(() => ({} as Record<string, string>));
        alert(`Error: ${r.details || r.error || 'Failed to update user status'}`);
        return;
      }
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
      const idempotencyKey = newIdempotencyKey();
      const fire = () => fetchWithAuth('/api/super-admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ userId, companyId, role: nextRole }),
      });
      const outcome = await runStepUpFlowIfNeeded(await fire(), fire);
      if (outcome.kind === 'step_up_user_cancelled' || outcome.kind === 'step_up_unavailable') {
        alert(describeStepUpOutcome(outcome));
        return;
      }
      if (outcome.kind === 'session_lost') {
        alert(describeAuthFailure(outcome.failure));
        return;
      }
      // 'success' and 'auth_banner' both carry the server's response; fall
      // through so the API's own error detail is surfaced as before.
      const response = outcome.response;
      if (!response.ok) {
        const r = await response.json().catch(() => ({} as Record<string, string>));
        alert(`Error: ${r.details || r.error || 'Failed to update user role'}`);
        return;
      }
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
      const response = await fetchWithAuth('/api/super-admin/users', {
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
      case 'invited': return 'bg-blue-100 text-blue-800';
      case 'pending': return 'bg-yellow-100 text-yellow-800';
      case 'suspended': return 'bg-red-100 text-red-800';
      case 'inactive': return 'bg-gray-200 text-gray-700';
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
                      <div className="flex flex-col gap-1">
                        <span className={`inline-block px-2 py-1 rounded-full text-xs font-medium w-fit ${getStatusColor(user.status || 'active')}`}>
                          {user.status || 'active'}
                        </span>
                        {user.account_status && user.account_status !== 'active' && (
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium w-fit ${getStatusColor(user.account_status)}`}
                            title={`Account lifecycle: ${user.account_status}`}
                          >
                            Account: {user.account_status}
                          </span>
                        )}
                        {(() => {
                          const invite = invitesByEmail[String(user.email || '').toLowerCase()];
                          if (!invite) return null;
                          const stateLabel: Record<string, { label: string; cls: string }> = {
                            queued: { label: 'Queued', cls: 'bg-slate-100 text-slate-700' },
                            sending: { label: 'Sending', cls: 'bg-indigo-100 text-indigo-700' },
                            sent: { label: 'Delivered', cls: 'bg-green-100 text-green-700' },
                            retrying: { label: `Retrying ${invite.retryCount ?? 0}/${invite.maxRetries ?? 5}`, cls: 'bg-amber-100 text-amber-800' },
                            failed: { label: 'Failed', cls: 'bg-red-100 text-red-700' },
                            dead: { label: 'Dead-lettered', cls: 'bg-red-200 text-red-900' },
                            none: { label: 'No delivery', cls: 'bg-gray-100 text-gray-600' },
                          };
                          const tag = stateLabel[invite.deliveryState] ?? stateLabel.none;
                          return (
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium w-fit ${tag.cls}`}
                              title={invite.lastError ?? undefined}
                            >
                              <Mail className="h-3 w-3" /> {tag.label}
                            </span>
                          );
                        })()}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{new Date(user.created_at).toLocaleDateString()}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <div className="flex items-center gap-2">
                        {(() => {
                          const invite = invitesByEmail[String(user.email || '').toLowerCase()];
                          if (!invite) return null;
                          const canResend = ['queued', 'sending', 'failed', 'dead', 'retrying', 'none'].includes(invite.deliveryState);
                          if (!canResend) return null;
                          return (
                            <button
                              onClick={() => handleResendInvite(invite.invitationId, user.email)}
                              className="text-blue-600 hover:text-blue-900 p-1 rounded hover:bg-blue-50"
                              title="Resend invitation email"
                              disabled={isLoading}
                            >
                              <RefreshCw className="h-4 w-4" />
                            </button>
                          );
                        })()}
                        <button
                          onClick={() => handleUserStatusChange(user.user_id, user.company_id, (user.status || 'active') === 'active' ? 'inactive' : 'active')}
                          disabled={!user.company_id}
                          className="text-yellow-600 hover:text-yellow-900 p-1 rounded hover:bg-yellow-50 disabled:opacity-50 disabled:cursor-not-allowed"
                          title={user.company_id ? ((user.status || 'active') === 'active' ? 'Make Inactive' : 'Make Active') : 'User must be assigned to a company'}
                        >
                          {(user.status || 'active') === 'active' ? <XCircle className="h-4 w-4" /> : <CheckCircle className="h-4 w-4" />}
                        </button>
                        {/* Phase 2.B — lifecycle actions */}
                        {user.account_status === 'suspended' ? (
                          <button
                            onClick={() => handleLifecycleAction('resume', user.user_id, user.email)}
                            className="text-green-700 hover:text-green-900 p-1 rounded hover:bg-green-50"
                            title="Resume account"
                            disabled={isLoading}
                          >
                            <Power className="h-4 w-4" />
                          </button>
                        ) : (
                          <button
                            onClick={() => handleLifecycleAction('suspend', user.user_id, user.email)}
                            className="text-orange-600 hover:text-orange-900 p-1 rounded hover:bg-orange-50"
                            title="Suspend account (blocks all access, reversible)"
                            disabled={isLoading || user.account_status === 'deleted'}
                          >
                            <Ban className="h-4 w-4" />
                          </button>
                        )}
                        <button
                          onClick={() => handleLifecycleAction('force-logout', user.user_id, user.email)}
                          className="text-indigo-600 hover:text-indigo-900 p-1 rounded hover:bg-indigo-50"
                          title="Force logout (revoke all active sessions, account stays active)"
                          disabled={isLoading || user.account_status === 'deleted'}
                        >
                          <LogOut className="h-4 w-4" />
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
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl mx-4 p-6 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Create User</h3>
            <p className="text-xs text-slate-500 mb-4">
              Backend-creates the Supabase Auth account, the company role, and the invitation.
              Step-up authentication (passkey + trusted device) is required.
            </p>

            {createUserResult && (
              <div className={`mb-4 rounded-lg border px-4 py-3 text-sm ${createUserResult.queueError ? 'bg-yellow-50 border-yellow-200 text-yellow-800' : 'bg-green-50 border-green-200 text-green-800'}`}>
                <div className="font-medium">User created: {createUserResult.email}</div>
                <div className="text-xs mt-1">
                  Invite mode: <strong>{createUserResult.mode}</strong> · Delivery: <strong>{createUserResult.deliveryStatus}</strong>
                  {createUserResult.jobId && <span className="ml-2 text-slate-500">(job {createUserResult.jobId.slice(0, 8)})</span>}
                  {createUserResult.queueError && <div className="mt-1">Queue error: {createUserResult.queueError}</div>}
                  <div className="mt-1 text-slate-500">
                    Email delivery runs asynchronously. Status appears in the user list within ~1 minute.
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
                <input type="email" value={companyAdminForm.email} onChange={(e) => setCompanyAdminForm((p) => ({ ...p, email: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2" placeholder="admin@acme.com" />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Full name (optional)</label>
                <input type="text" value={companyAdminForm.fullName} onChange={(e) => setCompanyAdminForm((p) => ({ ...p, fullName: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2" placeholder="Jane Doe" />
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
                <p className="text-xs text-slate-500 mt-1">SUPER_ADMIN cannot be assigned via this flow.</p>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={companyAdminForm.allowPersonalEmail}
                    onChange={(e) => setCompanyAdminForm((p) => ({ ...p, allowPersonalEmail: e.target.checked }))}
                    className="mt-0.5"
                  />
                  <span className="text-sm">
                    <span className="font-medium text-slate-800">Allow personal email</span>
                    <span className="block text-xs text-slate-500 mt-0.5">
                      Bypasses the work-email gate. Use only for verified scenarios (consultants, contractors, internal testing).
                      This bypass is audited.
                    </span>
                  </span>
                </label>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Invite mode</label>
                <div className="space-y-2">
                  <label className="flex items-start gap-3 cursor-pointer rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50">
                    <input
                      type="radio"
                      name="inviteMode"
                      value="magic_link"
                      checked={companyAdminForm.inviteMode === 'magic_link'}
                      onChange={() => setCompanyAdminForm((p) => ({ ...p, inviteMode: 'magic_link' }))}
                      className="mt-1"
                    />
                    <span className="text-sm">
                      <span className="font-medium text-slate-800">Magic link (recommended)</span>
                      <span className="block text-xs text-slate-500 mt-0.5">
                        User receives a token URL. They sign in passwordless and can set their own password after.
                      </span>
                    </span>
                  </label>
                  <label className="flex items-start gap-3 cursor-pointer rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50">
                    <input
                      type="radio"
                      name="inviteMode"
                      value="temp_password"
                      checked={companyAdminForm.inviteMode === 'temp_password'}
                      onChange={() => setCompanyAdminForm((p) => ({ ...p, inviteMode: 'temp_password' }))}
                      className="mt-1"
                    />
                    <span className="text-sm">
                      <span className="font-medium text-slate-800">Temporary password</span>
                      <span className="block text-xs text-slate-500 mt-0.5">
                        Server generates a one-time password and emails it. User is forced to reset on first sign-in.
                      </span>
                    </span>
                  </label>
                </div>
              </div>

              {companyAdminForm.inviteMode === 'temp_password' && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  <div className="font-medium mb-1">Temporary-password warning</div>
                  <div className="text-xs leading-relaxed">
                    The password is generated server-side, transmitted only in the email body, and is single-use.
                    Prefer magic link when possible — it has no plaintext password in transit.
                  </div>
                </div>
              )}

              <div className="rounded-lg border border-slate-200 px-4 py-3">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={companyAdminForm.sendInvite}
                    onChange={(e) => setCompanyAdminForm((p) => ({ ...p, sendInvite: e.target.checked }))}
                    className="mt-0.5"
                  />
                  <span className="text-sm">
                    <span className="font-medium text-slate-800">Send invitation email now</span>
                    <span className="block text-xs text-slate-500 mt-0.5">
                      If unchecked, the user is provisioned but no email is sent. You can resend later.
                    </span>
                  </span>
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => { setShowCreateCompanyAdminModal(false); setCreateUserResult(null); }} className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors">Close</button>
              <button onClick={handleCreateCompanyAdmin} disabled={isLoading} className="px-4 py-2 bg-gray-900 text-white rounded-lg disabled:opacity-50">
                {isLoading ? 'Creating...' : 'Create User'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
