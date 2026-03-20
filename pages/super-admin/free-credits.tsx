/**
 * /super-admin/free-credits
 *
 * Unified Free Credits Management Hub for super admins.
 *
 * Tabs:
 *  1. Overview    — KPI cards + monthly trend + category breakdown
 *  2. Requests    — domain access requests (approve / reject / delete)
 *  3. Grant       — manually give credits to any org
 *  4. Activity    — all free credit events (claims + manual + approvals)
 *  5. Profiles    — all free_credit_profiles users
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import {
  ArrowLeft, Gift, ClipboardList, Zap, Activity, Users,
  CheckCircle, XCircle, Trash2, RefreshCw, Search, ChevronDown,
  Building2, Send, TrendingUp,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = 'overview' | 'requests' | 'grant' | 'activity' | 'profiles';

interface Summary {
  total_credits_given: number;
  total_recipients: number;
  pending_requests: number;
  approved_this_month: number;
  manual_grants_total: number;
  claims_total: number;
}

interface AccessRequest {
  id: string;
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
  credits_granted_amount: number | null;
  organization_id: string | null;
  created_at: string;
}

interface ActivityRow {
  source: string;
  id: string;
  user_id: string | null;
  organization_id: string | null;
  email?: string;
  category: string;
  credits_amount: number;
  reason: string;
  created_at: string;
}

interface Profile {
  id: string;
  user_id: string;
  phone_number: string;
  intent_team: string | null;
  initial_credits: number;
  credit_expiry_at: string;
  created_at: string;
  claims: { categories: string[]; total: number };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  pending:  'bg-amber-100 text-amber-800',
  approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-800',
  deleted:  'bg-gray-100 text-gray-500',
};

const SOURCE_COLORS: Record<string, string> = {
  claim:          'bg-blue-100 text-blue-700',
  manual:         'bg-violet-100 text-violet-700',
  access_request: 'bg-emerald-100 text-emerald-700',
};

const CATEGORY_LABELS: Record<string, string> = {
  initial:        'Initial signup',
  invite_friend:  'Invite friend',
  feedback:       'Feedback',
  setup:          'Profile setup',
  connect_social: 'Connect social',
  first_campaign: 'First campaign',
  recommendation: 'Recommendation',
  manual:         'Manual grant',
  promotion:      'Promotion',
  compensation:   'Compensation',
  referral:       'Referral',
  domain_approval:'Domain approval',
};

const GRANT_CATEGORIES = [
  'manual','recommendation','first_campaign','referral',
  'feedback','setup','connect_social','invite_friend','promotion','compensation',
];

// ── Main Component ────────────────────────────────────────────────────────────

export default function FreeCreditsPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('overview');
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  // Overview
  const [summary, setSummary] = useState<Summary | null>(null);
  const [categoryTotals, setCategoryTotals] = useState<Record<string, number>>({});
  const [monthlyTrend, setMonthlyTrend] = useState<Record<string, number>>({});
  const [summaryLoading, setSummaryLoading] = useState(false);

  // Requests
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [reqTotal, setReqTotal] = useState(0);
  const [reqStatus, setReqStatus] = useState('pending');
  const [reqSearch, setReqSearch] = useState('');
  const [reqLoading, setReqLoading] = useState(false);
  const [selectedReq, setSelectedReq] = useState<AccessRequest | null>(null);
  const [reqModal, setReqModal] = useState<'approve' | 'reject' | null>(null);
  const [approveCredits, setApproveCredits] = useState(300);
  const [approveWhitelist, setApproveWhitelist] = useState(true);
  const [adminNote, setAdminNote] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [reqActionLoading, setReqActionLoading] = useState(false);

  // Grant
  const [grantOrgId, setGrantOrgId] = useState('');
  const [grantOrgSearch, setGrantOrgSearch] = useState('');
  const [grantOrgs, setGrantOrgs] = useState<{ id: string; name: string }[]>([]);
  const [grantOrgLoading, setGrantOrgLoading] = useState(false);
  const [grantAmount, setGrantAmount] = useState(300);
  const [grantCategory, setGrantCategory] = useState('manual');
  const [grantReason, setGrantReason] = useState('');
  const [grantNote, setGrantNote] = useState('');
  const [grantLoading, setGrantLoading] = useState(false);
  const [grantSuccess, setGrantSuccess] = useState(false);

  // Activity
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [activitySource, setActivitySource] = useState('all');
  const [activityLoading, setActivityLoading] = useState(false);

  // Profiles
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profilesTotal, setProfilesTotal] = useState(0);
  const [profileSearch, setProfileSearch] = useState('');
  const [profilesLoading, setProfilesLoading] = useState(false);

  const orgSearchTimer = useRef<NodeJS.Timeout | null>(null);

  // ── Auth check ──────────────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/super-admin/session')
      .then(r => r.json())
      .then(d => {
        if (!d.isSuperAdmin) router.replace('/super-admin/login');
        else { setIsSuperAdmin(true); setAuthChecked(true); }
      })
      .catch(() => router.replace('/super-admin/login'));
  }, [router]);

  // ── Data fetchers ───────────────────────────────────────────────────────────
  const fetchSummary = useCallback(async () => {
    setSummaryLoading(true);
    const r = await fetch('/api/super-admin/free-credits/summary');
    if (r.ok) {
      const d = await r.json();
      setSummary(d.summary);
      setCategoryTotals(d.categoryTotals ?? {});
      setMonthlyTrend(d.monthlyTrend ?? {});
    }
    setSummaryLoading(false);
  }, []);

  const fetchRequests = useCallback(async () => {
    setReqLoading(true);
    const params = new URLSearchParams({ status: reqStatus, limit: '100', search: reqSearch });
    const r = await fetch(`/api/super-admin/free-credits/requests?${params}`);
    if (r.ok) { const d = await r.json(); setRequests(d.requests ?? []); setReqTotal(d.total ?? 0); }
    setReqLoading(false);
  }, [reqStatus, reqSearch]);

  const fetchActivity = useCallback(async () => {
    setActivityLoading(true);
    const r = await fetch(`/api/super-admin/free-credits/activity?source=${activitySource}&limit=200`);
    if (r.ok) { const d = await r.json(); setActivity(d.activity ?? []); }
    setActivityLoading(false);
  }, [activitySource]);

  const fetchProfiles = useCallback(async () => {
    setProfilesLoading(true);
    const params = new URLSearchParams({ limit: '100', search: profileSearch });
    const r = await fetch(`/api/super-admin/free-credits/profiles?${params}`);
    if (r.ok) { const d = await r.json(); setProfiles(d.profiles ?? []); setProfilesTotal(d.total ?? 0); }
    setProfilesLoading(false);
  }, [profileSearch]);

  // Tab-triggered loads
  useEffect(() => { if (!authChecked) return; if (tab === 'overview') fetchSummary(); }, [tab, authChecked, fetchSummary]);
  useEffect(() => { if (!authChecked) return; if (tab === 'requests') fetchRequests(); }, [tab, authChecked, fetchRequests, reqStatus]);
  useEffect(() => { if (!authChecked) return; if (tab === 'activity') fetchActivity(); }, [tab, authChecked, fetchActivity, activitySource]);
  useEffect(() => { if (!authChecked) return; if (tab === 'profiles') fetchProfiles(); }, [tab, authChecked, fetchProfiles]);

  // Org search for grant tab
  useEffect(() => {
    if (!grantOrgSearch.trim()) { setGrantOrgs([]); return; }
    if (orgSearchTimer.current) clearTimeout(orgSearchTimer.current);
    orgSearchTimer.current = setTimeout(async () => {
      setGrantOrgLoading(true);
      const r = await fetch(`/api/super-admin/companies?search=${encodeURIComponent(grantOrgSearch)}&limit=10`);
      if (r.ok) { const d = await r.json(); setGrantOrgs(d.companies ?? d.data ?? []); }
      setGrantOrgLoading(false);
    }, 400);
  }, [grantOrgSearch]);

  // ── Request actions ─────────────────────────────────────────────────────────
  function closeReqModal() { setSelectedReq(null); setReqModal(null); setAdminNote(''); setRejectReason(''); }

  async function handleReqAction(action: 'approve' | 'reject' | 'delete', req: AccessRequest) {
    if (action !== 'delete') { setSelectedReq(req); setReqModal(action); setApproveCredits(300); setApproveWhitelist(true); return; }
    if (!confirm('Soft-delete this request?')) return;
    await fetch('/api/super-admin/free-credits/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', requestId: req.id }),
    });
    fetchRequests();
  }

  async function submitReqAction() {
    if (!selectedReq || !reqModal) return;
    setReqActionLoading(true);
    await fetch('/api/super-admin/free-credits/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        reqModal === 'approve'
          ? { action: 'approve', requestId: selectedReq.id, creditsToGrant: approveCredits, whitelistDomain: approveWhitelist, adminNote }
          : { action: 'reject',  requestId: selectedReq.id, reason: rejectReason },
      ),
    });
    closeReqModal();
    setReqActionLoading(false);
    fetchRequests();
  }

  // ── Manual grant ────────────────────────────────────────────────────────────
  async function submitGrant(e: React.FormEvent) {
    e.preventDefault();
    if (!grantOrgId || !grantReason.trim()) return;
    setGrantLoading(true);
    const r = await fetch('/api/super-admin/free-credits/grant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organizationId: grantOrgId,
        creditsAmount:  grantAmount,
        category:       grantCategory,
        reason:         grantReason,
        note:           grantNote || undefined,
      }),
    });
    setGrantLoading(false);
    if (r.ok) {
      setGrantSuccess(true);
      setGrantOrgId(''); setGrantOrgSearch(''); setGrantReason(''); setGrantNote('');
      setTimeout(() => setGrantSuccess(false), 4000);
    }
  }

  if (!authChecked) return <div className="min-h-screen bg-gray-50 flex items-center justify-center text-gray-400">Checking access…</div>;

  // ── Max credit for trend bar ──────────────────────────────────────────────
  const maxTrend = Math.max(...Object.values(monthlyTrend), 1);
  const totalCategoryCredits = Math.max(Object.values(categoryTotals).reduce((a, b) => a + b, 0), 1);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4 flex items-center gap-4">
        <Link href="/super-admin" className="text-gray-400 hover:text-gray-600">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Free Credits Management</h1>
          <p className="text-xs text-gray-500">Access requests · Manual grants · Claims · Reporting</p>
        </div>
        <div className="ml-auto">
          {summary?.pending_requests ? (
            <span className="px-3 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-semibold">
              {summary.pending_requests} pending
            </span>
          ) : null}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b bg-white px-6">
        <div className="flex gap-0">
          {([
            { key: 'overview',  label: 'Overview',         icon: TrendingUp },
            { key: 'requests',  label: 'Access Requests',  icon: ClipboardList },
            { key: 'grant',     label: 'Grant Credits',    icon: Gift },
            { key: 'activity',  label: 'All Activity',     icon: Activity },
            { key: 'profiles',  label: 'Free Profiles',    icon: Users },
          ] as { key: Tab; label: string; icon: any }[]).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-2 px-4 py-3 text-sm border-b-2 transition-colors ${
                tab === key
                  ? 'border-blue-600 text-blue-600 font-medium'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
              {key === 'requests' && summary?.pending_requests ? (
                <span className="ml-1 px-1.5 py-0.5 rounded-full bg-amber-500 text-white text-xs leading-none">
                  {summary.pending_requests}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6">

        {/* ── OVERVIEW ─────────────────────────────────────────────────────── */}
        {tab === 'overview' && (
          <div className="space-y-6">
            <div className="flex justify-end">
              <button onClick={fetchSummary} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700">
                <RefreshCw className={`h-4 w-4 ${summaryLoading ? 'animate-spin' : ''}`} /> Refresh
              </button>
            </div>

            {/* KPI cards */}
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                { label: 'Total credits given',    value: (summary?.total_credits_given ?? 0).toLocaleString(), color: 'text-violet-600' },
                { label: 'Total recipients',       value: (summary?.total_recipients ?? 0).toLocaleString(),    color: 'text-blue-600' },
                { label: 'Pending requests',       value: (summary?.pending_requests ?? 0).toLocaleString(),    color: 'text-amber-600' },
                { label: 'Approved this month',    value: (summary?.approved_this_month ?? 0).toLocaleString(), color: 'text-emerald-600' },
                { label: 'Manual grants',          value: (summary?.manual_grants_total ?? 0).toLocaleString(), color: 'text-blue-600' },
                { label: 'Automated claims',       value: (summary?.claims_total ?? 0).toLocaleString(),        color: 'text-indigo-600' },
              ].map(kpi => (
                <div key={kpi.label} className="bg-white rounded-xl border p-5">
                  <p className="text-xs text-gray-500 mb-1">{kpi.label}</p>
                  <p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p>
                </div>
              ))}
            </div>

            {/* Monthly trend */}
            <div className="bg-white rounded-xl border p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">Monthly free credit grants (last 6 months)</h3>
              <div className="flex items-end gap-3 h-28">
                {Object.entries(monthlyTrend).map(([month, amount]) => (
                  <div key={month} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-xs text-gray-500">{amount.toLocaleString()}</span>
                    <div
                      className="w-full bg-blue-500 rounded-t"
                      style={{ height: `${Math.round((amount / maxTrend) * 80)}px` }}
                    />
                    <span className="text-xs text-gray-400">{month.slice(5)}</span>
                  </div>
                ))}
                {Object.keys(monthlyTrend).length === 0 && (
                  <p className="text-sm text-gray-400 m-auto">No data yet</p>
                )}
              </div>
            </div>

            {/* Category breakdown */}
            <div className="bg-white rounded-xl border p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">Credits by claim category</h3>
              <div className="space-y-2.5">
                {Object.entries(categoryTotals)
                  .sort((a, b) => b[1] - a[1])
                  .map(([cat, amount]) => (
                  <div key={cat} className="flex items-center gap-3">
                    <span className="w-36 text-sm text-gray-600 truncate">{CATEGORY_LABELS[cat] ?? cat}</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-2">
                      <div
                        className="bg-blue-500 h-2 rounded-full"
                        style={{ width: `${Math.round((amount / totalCategoryCredits) * 100)}%` }}
                      />
                    </div>
                    <span className="text-sm font-medium text-gray-700 w-16 text-right">{amount.toLocaleString()}</span>
                  </div>
                ))}
                {Object.keys(categoryTotals).length === 0 && (
                  <p className="text-sm text-gray-400">No claims yet</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── ACCESS REQUESTS ───────────────────────────────────────────────── */}
        {tab === 'requests' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              {/* Status filter */}
              <div className="flex gap-1 bg-white border rounded-lg p-1">
                {['pending','approved','rejected','deleted','all'].map(s => (
                  <button key={s} onClick={() => setReqStatus(s)}
                    className={`px-3 py-1.5 text-xs rounded-md capitalize ${reqStatus === s ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
                    {s}
                  </button>
                ))}
              </div>
              {/* Search */}
              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                <input value={reqSearch} onChange={e => setReqSearch(e.target.value)} onKeyDown={e => e.key==='Enter' && fetchRequests()}
                  placeholder="Email, domain, company…"
                  className="w-full pl-8 pr-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <button onClick={fetchRequests} className="flex items-center gap-1 px-3 py-2 bg-white border rounded-lg text-sm hover:bg-gray-50">
                <RefreshCw className={`h-3.5 w-3.5 ${reqLoading ? 'animate-spin' : ''}`} /> Refresh
              </button>
              <span className="text-xs text-gray-400">{reqTotal} total</span>
            </div>

            <div className="bg-white rounded-xl border overflow-hidden">
              {reqLoading ? (
                <div className="p-12 text-center text-gray-400">Loading…</div>
              ) : requests.length === 0 ? (
                <div className="p-12 text-center text-gray-400">No {reqStatus} requests</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Email / Domain</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Company</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Flag</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Submitted</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {requests.map(r => (
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
                            {r.domain_status ?? 'unknown'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[r.status] ?? ''}`}>
                            {r.status}
                          </span>
                          {r.credits_granted_amount ? (
                            <span className="ml-1 text-xs text-emerald-600">+{r.credits_granted_amount}</span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-gray-400 text-xs">{new Date(r.created_at).toLocaleDateString()}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1 justify-end">
                            {r.status === 'pending' && (
                              <>
                                <button onClick={() => handleReqAction('approve', r)}
                                  className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-emerald-50 text-emerald-700 hover:bg-emerald-100">
                                  <CheckCircle className="h-3 w-3" /> Approve
                                </button>
                                <button onClick={() => handleReqAction('reject', r)}
                                  className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-red-50 text-red-700 hover:bg-red-100">
                                  <XCircle className="h-3 w-3" /> Reject
                                </button>
                              </>
                            )}
                            <button onClick={() => handleReqAction('delete', r)}
                              className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50">
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
        )}

        {/* ── GRANT CREDITS ────────────────────────────────────────────────── */}
        {tab === 'grant' && (
          <div className="max-w-lg">
            <div className="bg-white rounded-xl border p-6">
              <h2 className="text-base font-semibold text-gray-900 mb-1">Grant credits to an organisation</h2>
              <p className="text-sm text-gray-500 mb-5">Covers first campaign bonus, referrals, compensations, manual approvals, and any other category.</p>

              {grantSuccess && (
                <div className="mb-4 p-3 rounded-lg bg-emerald-50 text-emerald-700 text-sm flex items-center gap-2">
                  <CheckCircle className="h-4 w-4" /> Credits granted successfully.
                </div>
              )}

              <form onSubmit={e => void submitGrant(e)} className="space-y-4">
                {/* Org search */}
                <div className="relative">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    <Building2 className="inline h-3.5 w-3.5 mr-1" />
                    Organisation <span className="text-red-500">*</span>
                  </label>
                  <input
                    value={grantOrgId ? (grantOrgs.find(o => o.id === grantOrgId)?.name ?? grantOrgSearch) : grantOrgSearch}
                    onChange={e => { setGrantOrgSearch(e.target.value); setGrantOrgId(''); }}
                    placeholder="Search by org name…"
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {grantOrgs.length > 0 && !grantOrgId && (
                    <div className="absolute z-10 mt-1 w-full bg-white border rounded-lg shadow-lg overflow-hidden">
                      {grantOrgLoading && <p className="text-sm text-gray-400 p-3">Searching…</p>}
                      {grantOrgs.map(o => (
                        <button key={o.id} type="button"
                          onClick={() => { setGrantOrgId(o.id); setGrantOrgSearch(o.name); setGrantOrgs([]); }}
                          className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 border-b last:border-0">
                          {o.name}
                          <span className="text-gray-400 text-xs ml-2">{o.id.slice(0,8)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Amount */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Credits amount <span className="text-red-500">*</span></label>
                  <input type="number" min="1" value={grantAmount} onChange={e => setGrantAmount(Number(e.target.value))}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>

                {/* Category */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                  <div className="relative">
                    <select value={grantCategory} onChange={e => setGrantCategory(e.target.value)}
                      className="w-full border rounded-lg px-3 py-2 text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500">
                      {GRANT_CATEGORIES.map(c => (
                        <option key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
                  </div>
                </div>

                {/* Reason */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Reason <span className="text-red-500">*</span></label>
                  <input value={grantReason} onChange={e => setGrantReason(e.target.value)}
                    placeholder="e.g. Completed first campaign, referral bonus…"
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>

                {/* Internal note */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Internal note (optional)</label>
                  <textarea value={grantNote} onChange={e => setGrantNote(e.target.value)} rows={2}
                    placeholder="Admin-only note…"
                    className="w-full border rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>

                <button type="submit"
                  disabled={grantLoading || !grantOrgId || !grantReason.trim()}
                  className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  <Send className="h-4 w-4" />
                  {grantLoading ? 'Granting…' : `Grant ${grantAmount.toLocaleString()} credits`}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* ── ACTIVITY ─────────────────────────────────────────────────────── */}
        {tab === 'activity' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex gap-1 bg-white border rounded-lg p-1">
                {['all','claim','manual','access_request'].map(s => (
                  <button key={s} onClick={() => setActivitySource(s)}
                    className={`px-3 py-1.5 text-xs rounded-md ${activitySource === s ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
                    {s === 'access_request' ? 'approvals' : s}
                  </button>
                ))}
              </div>
              <button onClick={fetchActivity} className="flex items-center gap-1 px-3 py-2 bg-white border rounded-lg text-sm hover:bg-gray-50">
                <RefreshCw className={`h-3.5 w-3.5 ${activityLoading ? 'animate-spin' : ''}`} /> Refresh
              </button>
              <span className="text-xs text-gray-400">{activity.length} rows</span>
            </div>

            <div className="bg-white rounded-xl border overflow-hidden">
              {activityLoading ? (
                <div className="p-12 text-center text-gray-400">Loading…</div>
              ) : activity.length === 0 ? (
                <div className="p-12 text-center text-gray-400">No activity</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Source</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Category</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Credits</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Reason</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activity.map(a => (
                      <tr key={`${a.source}-${a.id}`} className="border-b last:border-0 hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${SOURCE_COLORS[a.source] ?? 'bg-gray-100 text-gray-600'}`}>
                            {a.source}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-700">{CATEGORY_LABELS[a.category] ?? a.category}</td>
                        <td className="px-4 py-3">
                          <span className="font-semibold text-emerald-600">+{(a.credits_amount ?? 0).toLocaleString()}</span>
                        </td>
                        <td className="px-4 py-3 text-gray-500 max-w-xs truncate">{a.reason ?? '—'}</td>
                        <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                          {a.created_at ? new Date(a.created_at).toLocaleString() : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* ── PROFILES ─────────────────────────────────────────────────────── */}
        {tab === 'profiles' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="relative max-w-xs flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                <input value={profileSearch} onChange={e => setProfileSearch(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && fetchProfiles()}
                  placeholder="Phone, team…"
                  className="w-full pl-8 pr-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <button onClick={fetchProfiles} className="flex items-center gap-1 px-3 py-2 bg-white border rounded-lg text-sm hover:bg-gray-50">
                <RefreshCw className={`h-3.5 w-3.5 ${profilesLoading ? 'animate-spin' : ''}`} /> Refresh
              </button>
              <span className="text-xs text-gray-400">{profilesTotal} total</span>
            </div>

            <div className="bg-white rounded-xl border overflow-hidden">
              {profilesLoading ? (
                <div className="p-12 text-center text-gray-400">Loading…</div>
              ) : profiles.length === 0 ? (
                <div className="p-12 text-center text-gray-400">No profiles yet</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Phone</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Team</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Initial credits</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Claims</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Total claimed</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Expires</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Joined</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profiles.map(p => (
                      <tr key={p.id} className="border-b last:border-0 hover:bg-gray-50">
                        <td className="px-4 py-3 font-mono text-xs text-gray-700">{p.phone_number}</td>
                        <td className="px-4 py-3 text-gray-600">{p.intent_team ?? '—'}</td>
                        <td className="px-4 py-3 font-semibold text-blue-600">{p.initial_credits}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {p.claims.categories.map(c => (
                              <span key={c} className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 text-xs">{c}</span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-semibold text-emerald-600">+{p.claims.total}</td>
                        <td className="px-4 py-3 text-gray-400 text-xs">
                          {new Date(p.credit_expiry_at) < new Date()
                            ? <span className="text-red-500">Expired</span>
                            : new Date(p.credit_expiry_at).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 text-gray-400 text-xs">{new Date(p.created_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Approve modal ───────────────────────────────────────────────────── */}
      {selectedReq && reqModal === 'approve' && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold mb-1">Approve request</h2>
            <p className="text-sm text-gray-500 mb-4">{selectedReq.email} · {selectedReq.company_name}</p>
            <div className="space-y-3 mb-5">
              {selectedReq.use_case && (
                <div>
                  <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Use case</label>
                  <p className="text-sm text-gray-700 mt-0.5 bg-gray-50 rounded p-2">{selectedReq.use_case}</p>
                </div>
              )}
              {selectedReq.website_url && (
                <p className="text-sm text-blue-600">{selectedReq.website_url}</p>
              )}
              <div>
                <label className="text-sm font-medium text-gray-700">Credits to grant</label>
                <input type="number" value={approveCredits} onChange={e => setApproveCredits(Number(e.target.value))}
                  className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={approveWhitelist} onChange={e => setApproveWhitelist(e.target.checked)} />
                Whitelist <strong>{selectedReq.domain}</strong> for future signups
              </label>
              <div>
                <label className="text-sm font-medium text-gray-700">Admin note (optional)</label>
                <textarea value={adminNote} onChange={e => setAdminNote(e.target.value)} rows={2}
                  className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" placeholder="Internal note…" />
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={closeReqModal} className="flex-1 px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">Cancel</button>
              <button onClick={() => void submitReqAction()} disabled={reqActionLoading}
                className="flex-1 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-700 disabled:opacity-50">
                {reqActionLoading ? 'Approving…' : 'Approve & Grant'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Reject modal ────────────────────────────────────────────────────── */}
      {selectedReq && reqModal === 'reject' && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold mb-1">Reject request</h2>
            <p className="text-sm text-gray-500 mb-4">{selectedReq.email} · {selectedReq.company_name}</p>
            <div className="mb-4">
              <label className="text-sm font-medium text-gray-700">Rejection reason (required)</label>
              <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={3}
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                placeholder="e.g. Domain uses a public email forwarding service…" />
            </div>
            <div className="flex gap-3">
              <button onClick={closeReqModal} className="flex-1 px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">Cancel</button>
              <button onClick={() => void submitReqAction()} disabled={reqActionLoading || !rejectReason.trim()}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 disabled:opacity-50">
                {reqActionLoading ? 'Rejecting…' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
