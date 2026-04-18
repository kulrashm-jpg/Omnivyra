/**
 * Engagement Intelligence Dashboard
 * Conversation categories, sentiment, strategy effectiveness, lead/opportunity/reply trends.
 */

import React, { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useCompanyContext } from '@/components/CompanyContext';
import {
  BarChart3,
  TrendingUp,
  RefreshCw,
  MessageCircle,
  Target,
  Zap,
  Reply,
} from 'lucide-react';

type CategoryItem = { classification_category: string; count: number };
type SentimentItem = { sentiment: string; count: number };
type StrategyItem = {
  strategy_type: string;
  engagement_score: number;
  confidence_score: number;
  total_uses: number;
};
type TrendItem = { date: string; count: number };
type ReplyPerfItem = {
  date: string;
  replies: number;
  likes: number;
  followups: number;
  leads: number;
};

type AnalyticsPayload = {
  categories: CategoryItem[];
  sentiment: SentimentItem[];
  strategies: StrategyItem[];
  lead_trend: TrendItem[];
  opportunity_trend: TrendItem[];
  reply_trend: ReplyPerfItem[];
};

function ConversationCategoryChart({ data }: { data: CategoryItem[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="space-y-2">
      {data.length === 0 ? (
        <p className="text-sm text-slate-500">No classification data</p>
      ) : (
        data.map((d) => (
          <div key={d.classification_category} className="flex items-center gap-2">
            <span className="w-32 truncate text-sm text-slate-700">{d.classification_category}</span>
            <div className="h-6 flex-1 overflow-hidden rounded bg-slate-100">
              <div className="h-full rounded bg-blue-500 transition-all" style={{ width: `${(d.count / max) * 100}%` }} />
            </div>
            <span className="w-8 text-sm text-slate-600">{d.count}</span>
          </div>
        ))
      )}
    </div>
  );
}

function SentimentChart({ data }: { data: SentimentItem[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const color = (s: string) =>
    s === 'positive' ? 'bg-emerald-500' : s === 'negative' ? 'bg-rose-500' : 'bg-slate-400';
  return (
    <div className="space-y-2">
      {data.length === 0 ? (
        <p className="text-sm text-slate-500">No sentiment data</p>
      ) : (
        data.map((d) => (
          <div key={d.sentiment} className="flex items-center gap-2">
            <span className="w-24 text-sm capitalize text-slate-700">{d.sentiment}</span>
            <div className="h-6 flex-1 overflow-hidden rounded bg-slate-100">
              <div className={`h-full rounded transition-all ${color(d.sentiment)}`} style={{ width: `${(d.count / max) * 100}%` }} />
            </div>
            <span className="w-8 text-sm text-slate-600">{d.count}</span>
          </div>
        ))
      )}
    </div>
  );
}

function StrategyPerformanceTable({ data }: { data: StrategyItem[] }) {
  return (
    <div className="overflow-x-auto">
      {data.length === 0 ? (
        <p className="text-sm text-slate-500">No strategy data</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="py-2 text-left font-medium text-slate-700">Strategy</th>
              <th className="py-2 text-right font-medium text-slate-700">Score</th>
              <th className="py-2 text-right font-medium text-slate-700">Confidence</th>
              <th className="py-2 text-right font-medium text-slate-700">Uses</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.strategy_type} className="border-b border-slate-100">
                <td className="py-2 text-slate-800">{d.strategy_type}</td>
                <td className="py-2 text-right font-medium">{Number(d.engagement_score).toFixed(2)}</td>
                <td className="py-2 text-right">{Number(d.confidence_score).toFixed(2)}</td>
                <td className="py-2 text-right">{d.total_uses}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function TrendBarChart({ data, label }: { data: TrendItem[]; label: string }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="space-y-1">
      {data.length === 0 ? (
        <p className="text-sm text-slate-500">No trend data</p>
      ) : (
        <div className="flex h-32 items-end gap-0.5">
          {data.map((d) => (
            <div key={d.date} className="group flex min-w-[4px] flex-1 flex-col items-center" title={`${d.date}: ${d.count} ${label}`}>
              <div className="w-full rounded-t bg-blue-400 transition-all hover:bg-blue-500" style={{ height: `${(d.count / max) * 100}%`, minHeight: d.count > 0 ? 4 : 0 }} />
            </div>
          ))}
        </div>
      )}
      {data.length > 0 && (
        <div className="mt-1 flex text-xs text-slate-500">
          <span>{data[0]?.date ?? ''}</span>
          <span className="flex-1" />
          <span>{data[data.length - 1]?.date ?? ''}</span>
        </div>
      )}
    </div>
  );
}

function ReplyPerformanceChart({ data }: { data: ReplyPerfItem[] }) {
  const max = Math.max(1, ...data.flatMap((d) => [d.replies, d.likes, d.followups, d.leads]));
  return (
    <div className="space-y-2">
      {data.length === 0 ? (
        <p className="text-sm text-slate-500">No reply performance data</p>
      ) : (
        <div className="flex h-32 items-end gap-0.5">
          {data.map((d) => (
            <div key={d.date} className="flex min-w-[8px] flex-1 flex-col items-center gap-0.5" title={`${d.date}: ${d.replies} replies, ${d.likes} likes, ${d.followups} followups, ${d.leads} leads`}>
              <div className="w-full rounded-t bg-blue-400" style={{ height: `${(d.replies / max) * 80}%`, minHeight: d.replies > 0 ? 2 : 0 }} />
              <div className="w-full rounded bg-emerald-400" style={{ height: `${(d.likes / max) * 60}%`, minHeight: d.likes > 0 ? 2 : 0 }} />
              <div className="w-full rounded bg-amber-400" style={{ height: `${(d.followups / max) * 60}%`, minHeight: d.followups > 0 ? 2 : 0 }} />
              <div className="w-full rounded-b bg-violet-500" style={{ height: `${(d.leads / max) * 60}%`, minHeight: d.leads > 0 ? 2 : 0 }} />
            </div>
          ))}
        </div>
      )}
      {data.length > 0 && (
        <div className="mt-1 flex text-xs text-slate-500">
          <span>{data[0]?.date ?? ''}</span>
          <span className="flex-1" />
          <span>{data[data.length - 1]?.date ?? ''}</span>
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-600">
        <span><span className="inline-block h-2 w-2 rounded bg-blue-400" /> replies</span>
        <span><span className="inline-block h-2 w-2 rounded bg-emerald-400" /> likes</span>
        <span><span className="inline-block h-2 w-2 rounded bg-amber-400" /> followups</span>
        <span><span className="inline-block h-2 w-2 rounded bg-violet-500" /> leads</span>
      </div>
    </div>
  );
}

export default function EngagementAnalyticsPage() {
  const { selectedCompanyId } = useCompanyContext();
  const organizationId = selectedCompanyId || '';
  const [payload, setPayload] = useState<AnalyticsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);

  const fetchAnalytics = useCallback(async () => {
    if (!organizationId?.trim()) {
      setPayload(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ organization_id: organizationId, days: String(days) });
      const res = await fetch(`/api/engagement/analytics?${params.toString()}`, { credentials: 'include' });
      if (!res.ok) throw new Error(res.statusText);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setPayload({
        categories: json.categories ?? [],
        sentiment: json.sentiment ?? [],
        strategies: json.strategies ?? [],
        lead_trend: json.lead_trend ?? [],
        opportunity_trend: json.opportunity_trend ?? [],
        reply_trend: json.reply_trend ?? [],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics');
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [organizationId, days]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  if (!organizationId) {
    return (
      <>
        <Head>
          <title>Engagement Analytics | Omnivyra</title>
        </Head>
        <div className="flex h-[calc(100vh-4rem)] flex-col items-center justify-center p-8 text-slate-500">
          Select a company to view engagement analytics.
        </div>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>Engagement Analytics | Omnivyra</title>
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
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">Engagement Intelligence</p>
                <h1 className="text-3xl font-bold tracking-tight text-gray-900 md:text-4xl">Review conversation analytics</h1>
                <p className="mt-3 text-sm leading-relaxed text-gray-600 md:text-base">
                  Track categories, sentiment, strategy effectiveness, and performance trends in one cleaner operating view.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 lg:w-[240px]">
                <div className="rounded-2xl border border-gray-100 bg-gray-50 px-3.5 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">View</p>
                  <p className="mt-1 text-base font-semibold text-gray-900">Analytics</p>
                </div>
                <div className="rounded-2xl border border-gray-100 bg-gray-50 px-3.5 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Window</p>
                  <p className="mt-1 text-base font-semibold text-gray-900">{days} days</p>
                </div>
              </div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-gray-100 bg-gray-50/80 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Designed For</p>
                <p className="mt-1 text-sm text-gray-700">Teams reviewing engagement quality, buyer signals, and what conversation patterns are changing over time.</p>
              </div>
              <div className="rounded-2xl border border-gray-100 bg-gray-50/80 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Decision Quality</p>
                <p className="mt-1 text-sm text-gray-700">Keeps categories, sentiment, strategy performance, and trend movement in one coordinated view.</p>
              </div>
              <div className="rounded-2xl border border-gray-100 bg-gray-50/80 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Output Standard</p>
                <p className="mt-1 text-sm text-gray-700">Operational analytics with a cleaner shell and less dashboard clutter around the data itself.</p>
              </div>
            </div>
          </div>

          <div className="mb-6 rounded-[24px] border border-gray-100 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <Link href="/engagement" className="rounded-full border border-gray-200 px-3 py-1.5 text-sm text-gray-700 transition-colors hover:border-gray-300 hover:text-gray-900">
                  Inbox
                </Link>
                <Link href="/engagement/leads" className="rounded-full border border-gray-200 px-3 py-1.5 text-sm text-gray-700 transition-colors hover:border-gray-300 hover:text-gray-900">
                  Leads
                </Link>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-gray-300">
                  <option value={7}>7 days</option>
                  <option value={14}>14 days</option>
                  <option value={30}>30 days</option>
                  <option value={90}>90 days</option>
                </select>
                <button type="button" onClick={fetchAnalytics} disabled={loading} className="inline-flex items-center gap-1.5 rounded-xl bg-gray-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-50">
                  <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </div>
            </div>
            {error && <div className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</div>}
          </div>

          <main className="overflow-auto">
            {loading && !payload ? (
              <div className="space-y-4 animate-pulse">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div key={i} className="h-40 rounded-lg bg-slate-200" />
                ))}
              </div>
            ) : (
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                <section className="rounded-lg border border-slate-200 bg-white p-4">
                  <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-800"><BarChart3 className="h-4 w-4" />Conversation Categories</h2>
                  <ConversationCategoryChart data={payload?.categories ?? []} />
                </section>
                <section className="rounded-lg border border-slate-200 bg-white p-4">
                  <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-800"><MessageCircle className="h-4 w-4" />Sentiment Distribution</h2>
                  <SentimentChart data={payload?.sentiment ?? []} />
                </section>
                <section className="rounded-lg border border-slate-200 bg-white p-4 md:col-span-2 lg:col-span-1">
                  <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-800"><Zap className="h-4 w-4" />Strategy Performance</h2>
                  <StrategyPerformanceTable data={payload?.strategies ?? []} />
                </section>
                <section className="rounded-lg border border-slate-200 bg-white p-4">
                  <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-800"><Target className="h-4 w-4" />Lead Trend</h2>
                  <TrendBarChart data={payload?.lead_trend ?? []} label="leads" />
                </section>
                <section className="rounded-lg border border-slate-200 bg-white p-4">
                  <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-800"><TrendingUp className="h-4 w-4" />Opportunity Trend</h2>
                  <TrendBarChart data={payload?.opportunity_trend ?? []} label="opportunities" />
                </section>
                <section className="rounded-lg border border-slate-200 bg-white p-4 md:col-span-2">
                  <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-800"><Reply className="h-4 w-4" />Reply Performance</h2>
                  <ReplyPerformanceChart data={payload?.reply_trend ?? []} />
                </section>
              </div>
            )}
          </main>
        </div>
      </div>
    </>
  );
}
