/**
 * Campaign Proposals Page
 * Displays auto-generated campaign proposals from high-strength opportunities.
 * Actions: View Proposal, Convert to Campaign, Reject.
 */

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCompanyContext } from '../components/CompanyContext';
import Header from '../components/Header';
import {
  FileText,
  Sparkles,
  Calendar,
  Target,
  ChevronRight,
  X,
  Loader2,
  AlertCircle,
} from 'lucide-react';

type Proposal = {
  id: string;
  proposal_title: string;
  proposal_strength: number;
  opportunity_id: string;
  created_at: string;
};

export default function CampaignProposalsPage() {
  const router = useRouter();
  const { selectedCompanyId } = useCompanyContext();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('draft');
  const [detailProposalId, setDetailProposalId] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (!selectedCompanyId) {
      setProposals([]);
      setLoading(false);
      return;
    }
    const params = new URLSearchParams({
      organizationId: selectedCompanyId,
      ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
    });
    fetch(`/api/campaigns/proposals?${params}`, { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.statusText))))
      .then((data) => setProposals(data.proposals ?? []))
      .catch((err) => setError(err?.message ?? 'Failed to load proposals'))
      .finally(() => setLoading(false));
  }, [selectedCompanyId, statusFilter]);

  const fetchDetail = async (id: string) => {
    const res = await fetch(`/api/campaigns/proposals/${id}`, { credentials: 'include' });
    if (!res.ok) return;
    const data = await res.json();
    setDetailData(data);
    setDetailProposalId(id);
  };

  const handleConvert = async (proposalId: string) => {
    setConvertingId(proposalId);
    try {
      const res = await fetch('/api/campaigns/proposals/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ proposalId }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err?.error ?? 'Convert failed');
      }
      const data = await res.json();
      setProposals((prev) => prev.filter((p) => p.id !== proposalId));
      setDetailProposalId(null);
      setDetailData(null);
      if (data.campaign_id && selectedCompanyId) {
        router.push(
          `/campaign-details/${data.campaign_id}?companyId=${encodeURIComponent(selectedCompanyId)}`
        );
      } else {
        router.push('/campaigns');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setConvertingId(null);
    }
  };

  const handleReject = async (proposalId: string) => {
    setRejectingId(proposalId);
    try {
      const res = await fetch('/api/campaigns/proposals/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ proposalId }),
      });
      if (!res.ok) throw new Error('Reject failed');
      setProposals((prev) => prev.filter((p) => p.id !== proposalId));
      setDetailProposalId(null);
      setDetailData(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRejectingId(null);
    }
  };

  const strengthColor = (s: number) => {
    if (s >= 70) return 'bg-emerald-100 text-emerald-800';
    if (s >= 40) return 'bg-amber-100 text-amber-800';
    return 'bg-slate-100 text-slate-700';
  };

  const formatDate = (d: string) => {
    try {
      return new Date(d).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return d;
    }
  };

  if (!selectedCompanyId) {
    return (
      <div className="min-h-screen bg-slate-50">
        <Header />
        <main className="max-w-5xl mx-auto px-4 py-12">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-6 text-center">
            <AlertCircle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
            <p className="text-amber-800 font-medium">Select a company to view campaign proposals.</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Header />
      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 flex items-center gap-2">
              <Sparkles className="w-7 h-7 text-indigo-500" />
              Campaign Proposals
            </h1>
            <p className="text-slate-600 mt-1">
              Auto-generated campaign plans from high-confidence opportunities
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
            <p className="text-red-800">{error}</p>
            <button
              onClick={() => setError(null)}
              className="ml-auto text-red-600 hover:text-red-800"
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="flex gap-2 mb-6">
          {['draft', 'accepted', 'rejected', 'all'].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${
                statusFilter === s
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
          </div>
        ) : proposals.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
            <FileText className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-slate-700">No proposals yet</h3>
            <p className="text-slate-500 mt-2">
              Proposals are auto-generated when high-strength opportunities (score &gt; 70) are
              detected by the engagement scanner (runs every 4 hours).
            </p>
            <Link
              href="/campaigns"
              className="inline-flex items-center gap-2 mt-6 text-indigo-600 hover:text-indigo-700 font-medium"
            >
              View campaigns
              <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
        ) : (
          <div className="grid gap-4">
            {proposals.map((p) => (
              <div
                key={p.id}
                className="bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow overflow-hidden"
              >
                <div className="p-5 flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-slate-900 truncate">{p.proposal_title}</h3>
                    <div className="flex flex-wrap items-center gap-3 mt-2 text-sm text-slate-500">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium ${strengthColor(
                          p.proposal_strength
                        )}`}
                      >
                        <Target className="w-3.5 h-3.5" />
                        Strength: {p.proposal_strength}
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5" />
                        {formatDate(p.created_at)}
                      </span>
                      <span className="text-slate-400">Opp: {p.opportunity_id.slice(0, 8)}…</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => fetchDetail(p.id)}
                      className="px-3 py-1.5 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
                    >
                      View
                    </button>
                    {statusFilter === 'draft' && (
                      <>
                        <button
                          onClick={() => handleConvert(p.id)}
                          disabled={!!convertingId}
                          className="px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50 flex items-center gap-1"
                        >
                          {convertingId === p.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            'Convert'
                          )}
                        </button>
                        <button
                          onClick={() => handleReject(p.id)}
                          disabled={!!rejectingId}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-50"
                          title="Reject"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {detailProposalId && detailData && (
          <div
            className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
            onClick={() => setDetailProposalId(null)}
          >
            <div
              className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[85vh] overflow-y-auto p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-semibold text-slate-900 mb-4">
                {(detailData.campaign_title as string) ?? 'Proposal Detail'}
              </h3>
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-slate-500 font-medium">Objective</dt>
                  <dd className="text-slate-900 mt-0.5">{detailData.objective as string}</dd>
                </div>
                <div>
                  <dt className="text-slate-500 font-medium">Duration</dt>
                  <dd className="text-slate-900 mt-0.5">
                    {(detailData.duration as number) ?? 6} weeks
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500 font-medium">Platforms</dt>
                  <dd className="text-slate-900 mt-0.5">
                    {(detailData.platforms as string[])?.join(', ') ?? '—'}
                  </dd>
                </div>
                {Array.isArray(detailData.weekly_structure) && detailData.weekly_structure.length > 0 && (
                  <div>
                    <dt className="text-slate-500 font-medium mb-2">Weekly structure</dt>
                    <dd className="text-slate-900">
                      <ul className="space-y-1">
                        {(detailData.weekly_structure as Array<{ week?: number; phase?: string; focus?: string }>).map(
                          (w) => (
                            <li key={w.week}>
                              Week {w.week}: {w.phase} — {w.focus}
                            </li>
                          )
                        )}
                      </ul>
                    </dd>
                  </div>
                )}
                {Array.isArray(detailData.topics_to_cover) && detailData.topics_to_cover.length > 0 && (
                  <div>
                    <dt className="text-slate-500 font-medium">Topics to cover</dt>
                    <dd className="text-slate-900 mt-0.5">
                      {(detailData.topics_to_cover as string[]).join(', ')}
                    </dd>
                  </div>
                )}
              </dl>
              <div className="mt-6 flex gap-3">
                <button
                  onClick={() => handleConvert(detailProposalId)}
                  disabled={!!convertingId}
                  className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50"
                >
                  Convert to Campaign
                </button>
                <button
                  onClick={() => handleReject(detailProposalId)}
                  disabled={!!rejectingId}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
                >
                  Reject
                </button>
                <button
                  onClick={() => setDetailProposalId(null)}
                  className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
