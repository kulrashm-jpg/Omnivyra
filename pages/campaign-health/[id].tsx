/**
 * Campaign Health — Content Performance & Strategic Health only.
 * UI-only projection over: campaign-health API, intelligence/summary, decision-timeline.
 * No Community AI metrics, no schema changes, no refactor of existing analytics.
 */

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Minus,
  MessageSquare,
  Zap,
  AlertTriangle,
  CheckCircle2,
  BarChart3,
  Brain,
  Shield,
  ExternalLink,
} from 'lucide-react';

type Health = {
  campaign_id: string;
  engagement_trend_percent: number | null;
  reach_trend_percent: number | null;
  total_engagement_last_7_days: number;
  total_engagement_previous_7_days: number;
  total_comments_last_7_days: number;
  total_comments_previous_7_days: number;
  stability_level: 'STABLE' | 'MODERATE' | 'VOLATILE';
  volatility_score: number;
  strategist_acceptance_rate: number | null;
  auto_distribution_ratio: number | null;
  slot_optimization_applied_count: number;
  performance_health: 'GROWING' | 'STABLE' | 'DECLINING';
  alerts: string[];
  ai_spend_last_30_days?: {
    total_tokens: number;
    total_cost: number;
    llm_calls: number;
  };
  ai_budget?: {
    budget_amount: number | null;
    used_last_30_days: number;
    percent_used: number | null;
    status: 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'NOT_CONFIGURED';
  };
};

type IntelligenceSummary = {
  campaign_id: string;
  total_feedback_events: number;
  action_acceptance_rate: Record<string, number>;
  active_generation_bias?: { cta_bias: boolean; discoverability_bias: boolean; hook_softening_bias: boolean };
};

type Stability = {
  total_weeks: number;
  strategy_switches: number;
  volatility_score: number;
  stability_level: string;
};

type TimelineResponse = {
  campaign_id: string;
  total_weeks_logged: number;
  decisions: unknown[];
  stability: Stability;
};

function fmtNum(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return Number(n).toLocaleString();
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${Math.round(Number(n) * 100)}%`;
}

function fmtTrend(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const v = Number(n);
  if (v > 0) return `+${v}%`;
  return `${v}%`;
}

export default function CampaignHealthPage() {
  const router = useRouter();
  const id = typeof router.query.id === 'string' ? router.query.id : '';
  const [mode, setMode] = useState<'creator' | 'enterprise'>('creator');
  const [health, setHealth] = useState<Health | null>(null);
  const [intelligence, setIntelligence] = useState<IntelligenceSummary | null>(null);
  const [timeline, setTimeline] = useState<TimelineResponse | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setHealthError(null);
    setHealth(null);
    setIntelligence(null);
    setTimeline(null);

    const fetchHealth = fetch(`/api/executive/campaign-health?campaignId=${encodeURIComponent(id)}`, {
      credentials: 'include',
    })
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load campaign health');
        return r.json();
      })
      .then((data) => {
        setHealth(data);
      })
      .catch((e) => {
        setHealthError(e?.message ?? 'Failed to load campaign health');
      });

    const fetchIntelligence = fetch(`/api/intelligence/summary?campaignId=${encodeURIComponent(id)}`, {
      credentials: 'include',
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => data && setIntelligence(data))
      .catch(() => {});

    const fetchTimeline = fetch(`/api/intelligence/decision-timeline?campaignId=${encodeURIComponent(id)}`, {
      credentials: 'include',
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => data && setTimeline(data))
      .catch(() => {});

    Promise.all([fetchHealth, fetchIntelligence, fetchTimeline]).finally(() => setLoading(false));
  }, [id]);

  if (!id) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-slate-600">No campaign selected.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-slate-300 border-t-violet-600 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-600">Loading campaign health…</p>
        </div>
      </div>
    );
  }

  if (healthError) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <AlertTriangle className="w-10 h-10 text-red-600 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-red-800 mb-1">Unable to load dashboard</h2>
          <p className="text-red-700 text-sm mb-4">{healthError}</p>
          <button
            type="button"
            onClick={() => router.back()}
            className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            <ArrowLeft className="w-4 h-4" />
            Go back
          </button>
        </div>
      </div>
    );
  }

  const h = health!;
  const stability = timeline?.stability;
  const healthColor =
    h.performance_health === 'GROWING'
      ? 'bg-emerald-500'
      : h.performance_health === 'DECLINING'
        ? 'bg-red-500'
        : 'bg-amber-500';
  const healthBg =
    h.performance_health === 'GROWING'
      ? 'bg-emerald-50 border-emerald-200'
      : h.performance_health === 'DECLINING'
        ? 'bg-red-50 border-red-200'
        : 'bg-amber-50 border-amber-200';
  const stabilityColor =
    h.stability_level === 'STABLE'
      ? 'text-emerald-700'
      : h.stability_level === 'VOLATILE'
        ? 'text-red-700'
        : 'text-amber-700';

  const engagementDiff = (h.total_engagement_last_7_days ?? 0) - (h.total_engagement_previous_7_days ?? 0);
  const commentsDiff = (h.total_comments_last_7_days ?? 0) - (h.total_comments_previous_7_days ?? 0);
  const engagementVs = engagementDiff > 0 ? 'Up' : engagementDiff < 0 ? 'Down' : 'Same as';
  const commentsVs = commentsDiff > 0 ? 'Up' : commentsDiff < 0 ? 'Down' : 'Same as';

  return (
    <>
      <Head>
        <title>Campaign Health | Virality</title>
      </Head>
      <div className="min-h-screen bg-slate-50 text-slate-900">
        <header className="border-b border-slate-200 bg-white">
          <div className="max-w-4xl mx-auto px-4 py-4">
            <div className="flex items-center justify-between gap-4 flex-wrap mb-2">
              <button
                type="button"
                onClick={() => router.back()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>
              <div className="flex items-center gap-4 rounded-lg border border-slate-200 bg-slate-50 p-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="mode"
                    checked={mode === 'creator'}
                    onChange={() => setMode('creator')}
                    className="text-violet-600 focus:ring-violet-500"
                  />
                  <span className="text-sm font-medium text-slate-700">Creator View</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="mode"
                    checked={mode === 'enterprise'}
                    onChange={() => setMode('enterprise')}
                    className="text-violet-600 focus:ring-violet-500"
                  />
                  <span className="text-sm font-medium text-slate-700">Enterprise View</span>
                </label>
              </div>
            </div>
            <div>
              <h1 className="text-xl font-semibold text-slate-800">Campaign Health</h1>
              <p className="text-sm text-slate-500 mt-0.5">Performance and strategic stability overview</p>
            </div>
          </div>
        </header>

        <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
          {/* 1. Campaign Health Hero */}
          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className={`rounded-lg border ${healthBg} p-4 flex flex-wrap items-center justify-between gap-4`}>
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-full ${healthColor} flex items-center justify-center text-white`}>
                  {h.performance_health === 'GROWING' ? (
                    <TrendingUp className="w-6 h-6" />
                  ) : h.performance_health === 'DECLINING' ? (
                    <TrendingDown className="w-6 h-6" />
                  ) : (
                    <Minus className="w-6 h-6" />
                  )}
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-slate-900">{h.performance_health}</h2>
                  <p className="text-sm text-slate-600 mt-0.5">
                    Engagement trend {fmtTrend(h.engagement_trend_percent)} · Reach {fmtTrend(h.reach_trend_percent)}
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* 2. Weekly Activity Snapshot */}
          <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2 text-slate-600 mb-2">
                <Zap className="w-5 h-5" />
                <span className="text-sm font-medium">Total engagement (last 7 days)</span>
              </div>
              <p className="text-2xl font-bold text-slate-900">{fmtNum(h.total_engagement_last_7_days)}</p>
              <p className="text-sm text-slate-500 mt-1">
                {engagementVs} previous week
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2 text-slate-600 mb-2">
                <MessageSquare className="w-5 h-5" />
                <span className="text-sm font-medium">Comments (last 7 days)</span>
              </div>
              <p className="text-2xl font-bold text-slate-900">{fmtNum(h.total_comments_last_7_days)}</p>
              <p className="text-sm text-slate-500 mt-1">
                {commentsVs} previous week
              </p>
            </div>
          </section>

          {/* 3. Alerts */}
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
              {h.alerts && h.alerts.length > 0 ? (
                <AlertTriangle className="w-4 h-4 text-amber-600" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              )}
              {h.alerts && h.alerts.length > 0 ? 'Needs Attention' : 'No immediate risks detected.'}
            </h3>
            {h.alerts && h.alerts.length > 0 ? (
              <ul className="list-disc list-inside space-y-1 text-sm text-slate-700">
                {h.alerts.map((msg, i) => (
                  <li key={i}>{msg}</li>
                ))}
              </ul>
            ) : null}
          </section>

          {/* 4. Strategy Stability (Light) */}
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-800 mb-3">Strategy stability</h3>
            <div className="flex flex-wrap gap-4">
              <div>
                <p className="text-xs text-slate-500">Level</p>
                <p className={`font-medium ${stabilityColor}`}>{h.stability_level}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Suggestion acceptance</p>
                <p className="font-medium text-slate-900">{fmtPct(h.strategist_acceptance_rate)}</p>
              </div>
            </div>
          </section>

          {/* 5–7. Enterprise-only */}
          {mode === 'enterprise' && (
            <>
              {/* 5. Execution Intelligence Detail */}
              <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-sm font-semibold text-slate-800 mb-4 flex items-center gap-2">
                  <BarChart3 className="w-4 h-4" />
                  Execution intelligence
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">Volatility score</p>
                    <p className="font-semibold text-slate-900">{fmtNum(h.volatility_score)}</p>
                  </div>
                  <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">Strategy switches</p>
                    <p className="font-semibold text-slate-900">{fmtNum(stability?.strategy_switches)}</p>
                  </div>
                  <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">Auto distribution ratio</p>
                    <p className="font-semibold text-slate-900">
                      {h.auto_distribution_ratio != null ? fmtPct(h.auto_distribution_ratio) : '—'}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">Slot optimization applied</p>
                    <p className="font-semibold text-slate-900">{fmtNum(h.slot_optimization_applied_count)}</p>
                  </div>
                </div>
              </section>

              {/* 5b. AI Spend (Last 30 Days) */}
              <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-sm font-semibold text-slate-800 mb-4 flex items-center gap-2">
                  <BarChart3 className="w-4 h-4" />
                  AI Spend (Last 30 Days)
                </h3>
                {h.ai_spend_last_30_days && (h.ai_spend_last_30_days.llm_calls > 0 || h.ai_spend_last_30_days.total_tokens > 0 || h.ai_spend_last_30_days.total_cost > 0) ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                      <p className="text-xs text-slate-500">Total cost</p>
                      <p className="font-semibold text-slate-900">{Number(h.ai_spend_last_30_days.total_cost).toFixed(4)}</p>
                    </div>
                    <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                      <p className="text-xs text-slate-500">Total tokens</p>
                      <p className="font-semibold text-slate-900">{fmtNum(h.ai_spend_last_30_days.total_tokens)}</p>
                    </div>
                    <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                      <p className="text-xs text-slate-500">LLM calls</p>
                      <p className="font-semibold text-slate-900">{fmtNum(h.ai_spend_last_30_days.llm_calls)}</p>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">No AI activity recorded in last 30 days.</p>
                )}
              </section>

              {/* 5c. AI Budget Status */}
              <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-sm font-semibold text-slate-800 mb-4 flex items-center gap-2">
                  <BarChart3 className="w-4 h-4" />
                  AI Budget Status
                </h3>
                {!h.ai_budget || h.ai_budget.status === 'NOT_CONFIGURED' ? (
                  <p className="text-sm text-slate-500">No AI budget configured for this campaign.</p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                      <p className="text-xs text-slate-500">Budget amount</p>
                      <p className="font-semibold text-slate-900">
                        {h.ai_budget.budget_amount != null ? Number(h.ai_budget.budget_amount).toFixed(2) : '—'}
                      </p>
                    </div>
                    <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                      <p className="text-xs text-slate-500">Used (last 30 days)</p>
                      <p className="font-semibold text-slate-900">{Number(h.ai_budget.used_last_30_days).toFixed(4)}</p>
                    </div>
                    <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                      <p className="text-xs text-slate-500">Percent used</p>
                      <p className="font-semibold text-slate-900">
                        {h.ai_budget.percent_used != null ? `${h.ai_budget.percent_used}%` : '—'}
                      </p>
                    </div>
                    <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 flex items-center">
                      <span
                        className={
                          h.ai_budget.status === 'HEALTHY'
                            ? 'text-emerald-600 font-medium'
                            : h.ai_budget.status === 'WARNING'
                            ? 'text-amber-600 font-medium'
                            : 'text-red-600 font-medium'
                        }
                      >
                        {h.ai_budget.status}
                      </span>
                    </div>
                  </div>
                )}
              </section>

              {/* 6. AI Suggestion Behavior */}
              <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-sm font-semibold text-slate-800 mb-4 flex items-center gap-2">
                  <Brain className="w-4 h-4" />
                  AI suggestion behavior
                </h3>
                <div className="space-y-3">
                  <p className="text-sm text-slate-600">
                    Total feedback events: <span className="font-medium text-slate-900">{fmtNum(intelligence?.total_feedback_events)}</span>
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {['IMPROVE_CTA', 'IMPROVE_HOOK', 'ADD_DISCOVERABILITY'].map((action) => (
                      <div key={action} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                        <p className="text-xs text-slate-500 truncate">{action.replace(/_/g, ' ')}</p>
                        <p className="font-medium text-slate-900">
                          {intelligence?.action_acceptance_rate?.[action] != null
                            ? fmtPct(intelligence.action_acceptance_rate[action])
                            : '—'}
                        </p>
                      </div>
                    ))}
                  </div>
                  {intelligence?.active_generation_bias && (
                    <div className="pt-2 border-t border-slate-100">
                      <p className="text-xs text-slate-500 mb-2">Active generation bias</p>
                      <div className="flex flex-wrap gap-2">
                        <span className={intelligence.active_generation_bias.cta_bias ? 'text-emerald-600' : 'text-slate-400'}>
                          CTA {intelligence.active_generation_bias.cta_bias ? 'ON' : '—'}
                        </span>
                        <span className={intelligence.active_generation_bias.discoverability_bias ? 'text-emerald-600' : 'text-slate-400'}>
                          Discoverability {intelligence.active_generation_bias.discoverability_bias ? 'ON' : '—'}
                        </span>
                        <span className={intelligence.active_generation_bias.hook_softening_bias ? 'text-emerald-600' : 'text-slate-400'}>
                          Hook softening {intelligence.active_generation_bias.hook_softening_bias ? 'ON' : '—'}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </section>

              {/* 7. Navigation Links */}
              <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-sm font-semibold text-slate-800 mb-4 flex items-center gap-2">
                  <ExternalLink className="w-4 h-4" />
                  Go to
                </h3>
                <div className="flex flex-wrap gap-3">
                  <a
                    href={`/analytics?campaignId=${id}`}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    View Detailed Analytics
                    <ExternalLink className="w-4 h-4" />
                  </a>
                  <a
                    href={`/campaign-intelligence/${id}`}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    View Campaign Intelligence
                    <ExternalLink className="w-4 h-4" />
                  </a>
                  <a
                    href={`/campaign-details/${id}`}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <Shield className="w-4 h-4" />
                    View Governance
                  </a>
                </div>
              </section>
            </>
          )}
        </main>
      </div>
    </>
  );
}
