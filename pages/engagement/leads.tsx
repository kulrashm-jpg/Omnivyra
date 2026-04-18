/**
 * Lead Intelligence Dashboard
 * Displays potential leads from engagement conversations.
 */

import React, { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useCompanyContext } from '@/components/CompanyContext';
import PlatformIcon from '@/components/ui/PlatformIcon';

type LeadItem = {
  id: string;
  message_id: string;
  thread_id: string;
  platform: string | null;
  author_name: string | null;
  message_preview: string;
  lead_intent: string;
  lead_score: number;
  thread_lead_score: number;
  confidence_score: number | null;
  detected_at: string | null;
  platform_created_at: string | null;
};

type ThreadSummary = {
  thread_id: string;
  platform: string | null;
  lead_score: number;
  lead_detected: boolean;
  signal_count: number;
  top_lead_intent: string | null;
  lead_count: number;
};

export default function EngagementLeadsPage() {
  const { selectedCompanyId } = useCompanyContext();
  const organizationId = selectedCompanyId || '';
  const [leads, setLeads] = useState<LeadItem[]>([]);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLeads = useCallback(async () => {
    if (!organizationId?.trim()) {
      setLeads([]);
      setThreads([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ organization_id: organizationId });
      const res = await fetch(`/api/engagement/leads?${params.toString()}`, { credentials: 'include' });
      if (!res.ok) throw new Error(res.statusText);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setLeads(json.leads ?? []);
      setThreads(json.threads ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load leads');
      setLeads([]);
      setThreads([]);
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  const runDetection = useCallback(async () => {
    if (!organizationId?.trim()) return;
    setDetecting(true);
    setError(null);
    try {
      const res = await fetch('/api/engagement/detect-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ organization_id: organizationId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || res.statusText);
      await fetchLeads();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Detection failed');
    } finally {
      setDetecting(false);
    }
  }, [organizationId, fetchLeads]);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  if (!organizationId) {
    return (
      <>
        <Head>
          <title>Potential Leads | Engagement</title>
        </Head>
        <div className="flex h-[calc(100vh-4rem)] flex-col items-center justify-center p-8 text-slate-500">
          Select a company to view potential leads.
        </div>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>Potential Leads | Engagement</title>
      </Head>

      <div className="min-h-[calc(100vh-4rem)] bg-gradient-to-br from-gray-50 to-gray-100 px-3 py-8 sm:px-4 lg:px-6">
        <div className="mx-auto max-w-6xl">
          <Link href="/command-center/engagement" className="mb-8 inline-flex items-center gap-2 text-sm text-gray-600 transition-colors hover:text-gray-900">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
            </svg>
            Back to Engagement
          </Link>

          <div className="mb-8 rounded-[28px] border border-white/80 bg-white/92 p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur-sm md:p-8">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_240px] lg:items-end">
              <div className="max-w-3xl">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">Lead Intelligence</p>
                <h1 className="text-3xl font-bold tracking-tight text-gray-900 md:text-4xl">Review potential leads</h1>
                <p className="mt-3 text-sm leading-relaxed text-gray-600 md:text-base">
                  Surface buyer-intent signals from engagement threads, review lead quality, and move qualified conversations forward faster.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 lg:w-[240px]">
                <div className="rounded-2xl border border-gray-100 bg-gray-50 px-3.5 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Threads</p>
                  <p className="mt-1 text-base font-semibold text-gray-900">{threads.length}</p>
                </div>
                <div className="rounded-2xl border border-gray-100 bg-gray-50 px-3.5 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Signals</p>
                  <p className="mt-1 text-base font-semibold text-gray-900">{leads.length}</p>
                </div>
              </div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-gray-100 bg-gray-50/80 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Designed For</p>
                <p className="mt-1 text-sm text-gray-700">Teams monitoring live conversations to spot intent signals before they disappear into the inbox.</p>
              </div>
              <div className="rounded-2xl border border-gray-100 bg-gray-50/80 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Decision Quality</p>
                <p className="mt-1 text-sm text-gray-700">Keeps thread-level scoring and individual lead signals together so prioritization is easier.</p>
              </div>
              <div className="rounded-2xl border border-gray-100 bg-gray-50/80 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Output Standard</p>
                <p className="mt-1 text-sm text-gray-700">A cleaner leads workspace that feels aligned with the rest of the product instead of a side dashboard.</p>
              </div>
            </div>
          </div>

          <div className="mb-6 rounded-[24px] border border-gray-100 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <Link href="/engagement" className="rounded-full border border-gray-200 px-3 py-1.5 text-sm text-gray-700 transition-colors hover:border-gray-300 hover:text-gray-900">
                  Inbox
                </Link>
                <button type="button" onClick={fetchLeads} disabled={loading} className="rounded-full border border-gray-200 px-3 py-1.5 text-sm text-gray-700 transition-colors hover:border-gray-300 hover:text-gray-900 disabled:opacity-50">
                  Refresh
                </button>
              </div>
              <button type="button" onClick={runDetection} disabled={detecting || loading} className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-50">
                {detecting ? 'Detecting...' : 'Run Lead Detection'}
              </button>
            </div>

            {error && <div className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</div>}
          </div>

          <main className="overflow-auto">
            {loading ? (
              <div className="space-y-4 animate-pulse">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="h-24 rounded-lg bg-slate-100" />
                ))}
              </div>
            ) : (
              <div className="space-y-6">
                <section>
                  <h2 className="mb-3 text-sm font-medium text-slate-700">Threads with leads ({threads.length})</h2>
                  {threads.length === 0 ? (
                    <p className="text-sm text-slate-500">No lead signals detected. Run lead detection on threads from the inbox.</p>
                  ) : (
                    <div className="grid gap-2">
                      {threads.map((t) => (
                        <Link key={t.thread_id} href={`/engagement?thread=${t.thread_id}`} className="flex items-center gap-4 rounded-lg border border-slate-200 bg-white p-3 transition-colors hover:bg-slate-50">
                          <PlatformIcon platform={t.platform ?? ''} size={20} />
                          <div className="min-w-0 flex-1">
                            <span className="font-medium text-slate-800">Thread</span>
                            <p className="truncate text-xs text-slate-500">{t.thread_id}</p>
                          </div>
                          <div className="shrink-0 text-right">
                            <span className="inline-block rounded bg-emerald-100 px-2 py-0.5 text-sm font-medium text-emerald-800">Score: {t.lead_score}</span>
                            <p className="mt-0.5 text-xs text-slate-500">{t.lead_count} signal(s)</p>
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}
                </section>

                <section>
                  <h2 className="mb-3 text-sm font-medium text-slate-700">Lead signals ({leads.length})</h2>
                  {leads.length === 0 ? (
                    <p className="text-sm text-slate-500">No individual lead signals.</p>
                  ) : (
                    <div className="grid gap-3">
                      {leads.map((lead) => (
                        <div key={lead.id} className="rounded-lg border border-slate-200 bg-white p-4">
                          <div className="flex items-start gap-3">
                            <PlatformIcon platform={lead.platform ?? ''} size={16} className="mt-0.5 shrink-0" />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-medium text-slate-800">{lead.author_name ?? 'Unknown'}</span>
                                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{lead.lead_intent}</span>
                                <span className="text-xs font-medium text-emerald-600">Score: {lead.lead_score}</span>
                              </div>
                              <p className="mt-1 line-clamp-2 text-sm text-slate-600">{lead.message_preview || '(no content)'}</p>
                              <div className="mt-2 flex items-center gap-2">
                                <Link href={`/engagement?thread=${lead.thread_id}`} className="text-xs text-blue-600 hover:text-blue-800">
                                  View thread →
                                </Link>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            )}
          </main>
        </div>
      </div>
    </>
  );
}
