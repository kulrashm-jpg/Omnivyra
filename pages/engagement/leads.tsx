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
        <div className="flex flex-col h-[calc(100vh-4rem)] items-center justify-center p-8 text-slate-500">
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

      <div className="flex flex-col min-h-[calc(100vh-4rem)]">
        <header className="shrink-0 px-4 py-4 border-b border-slate-200 bg-white">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-slate-900">Potential Leads</h1>
              <p className="text-sm text-slate-600 mt-0.5">
                Lead signals detected in engagement conversations
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href="/engagement"
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                ← Back to Inbox
              </Link>
              <button
                type="button"
                onClick={runDetection}
                disabled={detecting || loading}
                className="text-sm px-2 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {detecting ? 'Detecting…' : 'Run Lead Detection'}
              </button>
              <button
                type="button"
                onClick={fetchLeads}
                disabled={loading}
                className="text-sm text-blue-600 hover:text-blue-800 disabled:opacity-50"
              >
                Refresh
              </button>
            </div>
          </div>

          {error && (
            <div className="mt-3 p-2 rounded bg-red-50 text-red-700 text-sm" role="alert">
              {error}
            </div>
          )}
        </header>

        <main className="flex-1 p-4 overflow-auto">
          {loading ? (
            <div className="space-y-4 animate-pulse">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-24 rounded-lg bg-slate-100" />
              ))}
            </div>
          ) : (
            <div className="space-y-6">
              <section>
                <h2 className="text-sm font-medium text-slate-700 mb-3">Threads with leads ({threads.length})</h2>
                {threads.length === 0 ? (
                  <p className="text-sm text-slate-500">No lead signals detected. Run lead detection on threads from the inbox.</p>
                ) : (
                  <div className="grid gap-2">
                    {threads.map((t) => (
                      <Link
                        key={t.thread_id}
                        href={`/engagement?thread=${t.thread_id}`}
                        className="flex items-center gap-4 p-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 transition-colors"
                      >
                        <PlatformIcon platform={t.platform ?? ''} size={20} />
                        <div className="flex-1 min-w-0">
                          <span className="font-medium text-slate-800">Thread</span>
                          <p className="text-xs text-slate-500 truncate">{t.thread_id}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="inline-block px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-sm font-medium">
                            Score: {t.lead_score}
                          </span>
                          <p className="text-xs text-slate-500 mt-0.5">{t.lead_count} signal(s)</p>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </section>

              <section>
                <h2 className="text-sm font-medium text-slate-700 mb-3">Lead signals ({leads.length})</h2>
                {leads.length === 0 ? (
                  <p className="text-sm text-slate-500">No individual lead signals.</p>
                ) : (
                  <div className="grid gap-3">
                    {leads.map((lead) => (
                      <div
                        key={lead.id}
                        className="p-4 rounded-lg border border-slate-200 bg-white"
                      >
                        <div className="flex items-start gap-3">
                          <PlatformIcon platform={lead.platform ?? ''} size={16} className="shrink-0 mt-0.5" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-slate-800">
                                {lead.author_name ?? 'Unknown'}
                              </span>
                              <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                                {lead.lead_intent}
                              </span>
                              <span className="text-xs font-medium text-emerald-600">
                                Score: {lead.lead_score}
                              </span>
                            </div>
                            <p className="text-sm text-slate-600 mt-1 line-clamp-2">
                              {lead.message_preview || '(no content)'}
                            </p>
                            <div className="flex items-center gap-2 mt-2">
                              <Link
                                href={`/engagement?thread=${lead.thread_id}`}
                                className="text-xs text-blue-600 hover:text-blue-800"
                              >
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
    </>
  );
}
