/**
 * /admin/access-requests
 * Super-admin panel: review, approve, reject, and delete domain access requests.
 */

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import { getAuthToken } from '@/utils/getAuthToken';
import { CheckCircle, XCircle, Trash2, RefreshCw, Search } from 'lucide-react';

type RequestStatus = 'pending' | 'approved' | 'rejected' | 'deleted' | 'all';

interface AccessRequest {
  id: string;
  user_id: string;
  email: string;
  domain: string;
  company_name: string;
  job_title: string | null;
  use_case: string;
  website_url: string | null;
  domain_status: string;
  status: string;
  admin_note: string | null;
  rejection_reason: string | null;
  credits_granted: number | null;
  created_at: string;
  reviewed_at: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  pending:  'bg-amber-100 text-amber-800',
  approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-800',
  deleted:  'bg-gray-100 text-gray-500',
};

const DOMAIN_REASON_LABELS: Record<string, string> = {
  public_provider:   'Public email',
  forwarding_domain: 'Forwarding domain',
  no_mx:             'No MX record',
  disposable:        'Disposable',
  blocked_domain:    'Blocked',
};

export default function AccessRequestsPage() {
  const router = useRouter();
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState<RequestStatus>('pending');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<AccessRequest | null>(null);
  const [modal, setModal] = useState<'approve' | 'reject' | null>(null);
  const [approveCredits, setApproveCredits] = useState(300);
  const [approveWhitelist, setApproveWhitelist] = useState(true);
  const [adminNote, setAdminNote] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    const token = await getAuthToken();
    if (!token) { router.push('/login'); return; }

    const params = new URLSearchParams({ status: statusFilter, limit: '100' });
    const res = await fetch(`/api/admin/access-requests/list?${params}`, {
      headers: { Authorization: `Bearer ${token ?? ''}` },
    });
    if (res.status === 403) { router.push('/'); return; }
    const json = await res.json();
    setRequests(json.requests ?? []);
    setTotal(json.total ?? 0);
    setLoading(false);
  }, [statusFilter, router]);

  useEffect(() => { void fetchRequests(); }, [fetchRequests]);

  async function authHeader() {
    const token = await getAuthToken();
    return { Authorization: `Bearer ${token ?? ''}` };
  }

  function closeModal() { setSelected(null); setModal(null); setAdminNote(''); setRejectReason(''); }

  async function handleApprove() {
    if (!selected) return;
    setActionLoading(true);
    const headers = await authHeader();
    await fetch('/api/admin/access-requests/approve', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: selected.id,
        creditsToGrant: approveCredits,
        whitelistDomain: approveWhitelist,
        adminNote: adminNote || undefined,
      }),
    });
    closeModal();
    setActionLoading(false);
    void fetchRequests();
  }

  async function handleReject() {
    if (!selected || !rejectReason.trim()) return;
    setActionLoading(true);
    const headers = await authHeader();
    await fetch('/api/admin/access-requests/reject', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: selected.id, reason: rejectReason }),
    });
    closeModal();
    setActionLoading(false);
    void fetchRequests();
  }

  async function handleDelete(id: string) {
    if (!confirm('Soft-delete this request?')) return;
    const headers = await authHeader();
    await fetch('/api/admin/access-requests/delete', {
      method: 'DELETE',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: id }),
    });
    void fetchRequests();
  }

  const filtered = requests.filter(r =>
    !search ||
    r.email.includes(search) ||
    r.domain.includes(search) ||
    r.company_name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Domain Access Requests</h1>
            <p className="text-sm text-gray-500 mt-1">{total} total · {statusFilter} view</p>
          </div>
          <button
            onClick={() => void fetchRequests()}
            className="flex items-center gap-2 px-4 py-2 bg-white border rounded-lg text-sm hover:bg-gray-50"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-4 mb-6">
          <div className="flex gap-1 bg-white border rounded-lg p-1">
            {(['pending', 'approved', 'rejected', 'deleted', 'all'] as RequestStatus[]).map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 text-sm rounded-md capitalize transition-colors ${
                  statusFilter === s ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search email, domain, company…"
              className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border overflow-hidden">
          {loading ? (
            <div className="p-12 text-center text-gray-400">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-gray-400">No requests found</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Email / Domain</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Company</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Domain flag</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Submitted</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{r.email}</p>
                      <p className="text-gray-400 text-xs">{r.domain}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{r.company_name}</p>
                      {r.job_title && <p className="text-gray-400 text-xs">{r.job_title}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded text-xs bg-amber-50 text-amber-700 border border-amber-200">
                        {DOMAIN_REASON_LABELS[r.domain_status] ?? r.domain_status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[r.status] ?? ''}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {new Date(r.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 justify-end">
                        {r.status === 'pending' && (
                          <>
                            <button
                              onClick={() => { setSelected(r); setModal('approve'); setApproveCredits(300); setApproveWhitelist(true); setAdminNote(''); }}
                              className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                            >
                              <CheckCircle className="h-3 w-3" /> Approve
                            </button>
                            <button
                              onClick={() => { setSelected(r); setModal('reject'); setRejectReason(''); }}
                              className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-red-50 text-red-700 hover:bg-red-100"
                            >
                              <XCircle className="h-3 w-3" /> Reject
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => void handleDelete(r.id)}
                          className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Approve modal */}
      {selected && modal === 'approve' && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold mb-1">Approve request</h2>
            <p className="text-sm text-gray-500 mb-4">{selected.email} · {selected.company_name}</p>

            <div className="space-y-3 mb-4">
              <div>
                <label className="text-sm font-medium text-gray-700">Use case</label>
                <p className="text-sm text-gray-600 mt-1 bg-gray-50 rounded p-2">{selected.use_case}</p>
              </div>
              {selected.website_url && (
                <div>
                  <label className="text-sm font-medium text-gray-700">Website</label>
                  <p className="text-sm text-blue-600 mt-1">{selected.website_url}</p>
                </div>
              )}
              <div>
                <label className="text-sm font-medium text-gray-700">Credits to grant</label>
                <input
                  type="number"
                  value={approveCredits}
                  onChange={e => setApproveCredits(Number(e.target.value))}
                  className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={approveWhitelist} onChange={e => setApproveWhitelist(e.target.checked)} />
                Whitelist domain ({selected.domain}) for future signups
              </label>
              <div>
                <label className="text-sm font-medium text-gray-700">Admin note (optional)</label>
                <textarea
                  value={adminNote}
                  onChange={e => setAdminNote(e.target.value)}
                  rows={2}
                  className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                  placeholder="Internal note…"
                />
              </div>
            </div>

            <div className="flex gap-3">
              <button onClick={closeModal} className="flex-1 px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">
                Cancel
              </button>
              <button
                onClick={() => void handleApprove()}
                disabled={actionLoading}
                className="flex-1 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-700 disabled:opacity-50"
              >
                {actionLoading ? 'Approving…' : 'Approve & Grant Credits'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject modal */}
      {selected && modal === 'reject' && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold mb-1">Reject request</h2>
            <p className="text-sm text-gray-500 mb-4">{selected.email} · {selected.company_name}</p>

            <div className="mb-4">
              <label className="text-sm font-medium text-gray-700">Rejection reason (required)</label>
              <textarea
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                rows={3}
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                placeholder="e.g. Domain is a known forwarding service…"
              />
            </div>

            <div className="flex gap-3">
              <button onClick={closeModal} className="flex-1 px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">
                Cancel
              </button>
              <button
                onClick={() => void handleReject()}
                disabled={actionLoading || !rejectReason.trim()}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 disabled:opacity-50"
              >
                {actionLoading ? 'Rejecting…' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
