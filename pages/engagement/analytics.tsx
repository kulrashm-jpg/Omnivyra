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
  ThumbsUp,
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
            <span className="w-32 text-sm text-slate-700 truncate">{d.classification_category}</span>
            <div className="flex-1 h-6 bg-slate-100 rounded overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded transition-all"
                style={{ width: `${(d.count / max) * 100}%` }}
              />
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
            <span className="w-24 text-sm text-slate-700 capitalize">{d.sentiment}</span>
            <div className="flex-1 h-6 bg-slate-100 rounded overflow-hidden">
              <div
                className={`h-full rounded transition-all ${color(d.sentiment)}`}
                style={{ width: `${(d.count / max) * 100}%` }}
              />
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
              <th className="text-left py-2 font-medium text-slate-700">Strategy</th>
              <th className="text-right py-2 font-medium text-slate-700">Score</th>
              <th className="text-right py-2 font-medium text-slate-700">Confidence</th>
              <th className="text-right py-2 font-medium text-slate-700">Uses</th>
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
        <div className="flex items-end gap-0.5 h-32">
          {data.map((d) => (
            <div
              key={d.date}
              className="flex-1 min-w-[4px] flex flex-col items-center group"
              title={`${d.date}: ${d.count} ${label}`}
            >
              <div
                className="w-full bg-blue-400 hover:bg-blue-500 rounded-t transition-all"
                style={{ height: `${(d.count / max) * 100}%`, minHeight: d.count > 0 ? 4 : 0 }}
              />
            </div>
          ))}
        </div>
      )}
      {data.length > 0 && (
        <div className="flex text-xs text-slate-500 mt-1">
          <span>{data[0]?.date ?? ''}</span>
          <span className="flex-1" />
          <span>{data[data.length - 1]?.date ?? ''}</span>
        </div>
      )}
    </div>
  );
}

function ReplyPerformanceChart({ data }: { data: ReplyPerfItem[] }) {
  const max = Math.max(
    1,
    ...data.flatMap((d) => [d.replies, d.likes, d.followups, d.leads])
  );
  return (
    <div className="space-y-2">
      {data.length === 0 ? (
        <p className="text-sm text-slate-500">No reply performance data</p>
      ) : (
        <div className="flex items-end gap-0.5 h-32">
          {data.map((d) => (
            <div
              key={d.date}
              className="flex-1 min-w-[8px] flex flex-col items-center gap-0.5"
              title={`${d.date}: ${d.replies} replies, ${d.likes} likes, ${d.followups} followups, ${d.leads} leads`}
            >
              <div
                className="w-full bg-blue-400 rounded-t"
                style={{ height: `${(d.replies / max) * 80}%`, minHeight: d.replies > 0 ? 2 : 0 }}
              />
              <div
                className="w-full bg-emerald-400 rounded"
                style={{ height: `${(d.likes / max) * 60}%`, minHeight: d.likes > 0 ? 2 : 0 }}
              />
              <div
                className="w-full bg-amber-400 rounded"
                style={{ height: `${(d.followups / max) * 60}%`, minHeight: d.followups > 0 ? 2 : 0 }}
              />
              <div
                className="w-full bg-violet-500 rounded-b"
                style={{ height: `${(d.leads / max) * 60}%`, minHeight: d.leads > 0 ? 2 : 0 }}
              />
            </div>
          ))}
        </div>
      )}
      {data.length > 0 && (
        <div className="flex text-xs text-slate-500 mt-1">
          <span>{data[0]?.date ?? ''}</span>
          <span className="flex-1" />
          <span>{data[data.length - 1]?.date ?? ''}</span>
        </div>
      )}
      <div className="flex flex-wrap gap-3 mt-2 text-xs text-slate-600">
        <span><span className="inline-block w-2 h-2 bg-blue-400 rounded" /> replies</span>
        <span><span className="inline-block w-2 h-2 bg-emerald-400 rounded" /> likes</span>
        <span><span className="inline-block w-2 h-2 bg-amber-400 rounded" /> followups</span>
        <span><span className="inline-block w-2 h-2 bg-violet-500 rounded" /> leads</span>
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
        <div className="flex flex-col h-[calc(100vh-4rem)] items-center justify-center p-8 text-slate-500">
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

      <div className="flex flex-col min-h-[calc(100vh-4rem)]">
        <header className="shrink-0 px-4 py-4 border-b border-slate-200 bg-white">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-slate-900">Engagement Intelligence</h1>
              <p className="text-sm text-slate-600 mt-0.5">
                Conversation categories, sentiment, strategy effectiveness, and trends
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/engagement" className="text-sm text-blue-600 hover:text-blue-800">
                ← Inbox
              </Link>
              <Link href="/engagement/leads" className="text-sm text-blue-600 hover:text-blue-800">
                Leads
              </Link>
              <select
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                className="text-sm border border-slate-200 rounded px-2 py-1"
              >
                <option value={7}>7 days</option>
                <option value={14}>14 days</option>
                <option value={30}>30 days</option>
                <option value={90}>90 days</option>
              </select>
              <button
                type="button"
                onClick={fetchAnalytics}
                disabled={loading}
                className="flex items-center gap-1.5 text-sm px-2 py-1 rounded bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
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

        <main className="flex-1 p-4 overflow-auto bg-slate-50">
          {loading && !payload ? (
            <div className="space-y-4 animate-pulse">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="h-40 rounded-lg bg-slate-200" />
              ))}
            </div>
          ) : (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              <section className="rounded-lg border border-slate-200 bg-white p-4">
                <h2 className="flex items-center gap-2 text-sm font-medium text-slate-800 mb-3">
                  <BarChart3 className="w-4 h-4" />
                  Conversation Categories
                </h2>
                <ConversationCategoryChart data={payload?.categories ?? []} />
              </section>

              <section className="rounded-lg border border-slate-200 bg-white p-4">
                <h2 className="flex items-center gap-2 text-sm font-medium text-slate-800 mb-3">
                  <MessageCircle className="w-4 h-4" />
                  Sentiment Distribution
                </h2>
                <SentimentChart data={payload?.sentiment ?? []} />
              </section>

              <section className="rounded-lg border border-slate-200 bg-white p-4 md:col-span-2 lg:col-span-1">
                <h2 className="flex items-center gap-2 text-sm font-medium text-slate-800 mb-3">
                  <Zap className="w-4 h-4" />
                  Strategy Performance
                </h2>
                <StrategyPerformanceTable data={payload?.strategies ?? []} />
              </section>

              <section className="rounded-lg border border-slate-200 bg-white p-4">
                <h2 className="flex items-center gap-2 text-sm font-medium text-slate-800 mb-3">
                  <Target className="w-4 h-4" />
                  Lead Trend
                </h2>
                <TrendBarChart data={payload?.lead_trend ?? []} label="leads" />
              </section>

              <section className="rounded-lg border border-slate-200 bg-white p-4">
                <h2 className="flex items-center gap-2 text-sm font-medium text-slate-800 mb-3">
                  <TrendingUp className="w-4 h-4" />
                  Opportunity Trend
                </h2>
                <TrendBarChart data={payload?.opportunity_trend ?? []} label="opportunities" />
              </section>

              <section className="rounded-lg border border-slate-200 bg-white p-4 md:col-span-2">
                <h2 className="flex items-center gap-2 text-sm font-medium text-slate-800 mb-3">
                  <Reply className="w-4 h-4" />
                  Reply Performance
                </h2>
                <ReplyPerformanceChart data={payload?.reply_trend ?? []} />
              </section>
            </div>
          )}
        </main>
      </div>
    </>
  );
}
