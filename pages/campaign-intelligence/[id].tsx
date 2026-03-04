import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { ArrowLeft, Brain, BarChart3, Target, Zap, Sparkles, Clock, Activity } from 'lucide-react';

type Summary = {
  campaign_id: string;
  total_feedback_events: number;
  action_acceptance_rate: Record<string, number>;
  platform_confidence_average: Record<string, number>;
  strategist_trigger_counts: { NONE: number; SUGGEST: number; AUTO_ELIGIBLE: number };
  distribution_strategy_counts: { STAGGERED: number; ALL_AT_ONCE: number };
  slot_optimization_applied_count: number;
  active_generation_bias: { cta_bias: boolean; discoverability_bias: boolean; hook_softening_bias: boolean };
};

type TimelineItem = {
  week_number: number;
  resolved_strategy: 'STAGGERED' | 'ALL_AT_ONCE';
  auto_detected: boolean;
  quality_override: boolean;
  slot_optimization_applied: boolean;
  created_at: string;
};

type StabilityResult = {
  total_weeks: number;
  strategy_switches: number;
  volatility_score: number;
  stability_level: 'STABLE' | 'MODERATE' | 'VOLATILE';
};

function confidenceLevel(avg: number): 'High' | 'Medium' | 'Weak' {
  if (avg >= 80) return 'High';
  if (avg >= 60) return 'Medium';
  return 'Weak';
}

function confidenceColorClass(avg: number): string {
  if (avg >= 80) return 'text-emerald-700 bg-emerald-50 border-emerald-200';
  if (avg >= 60) return 'text-amber-700 bg-amber-50 border-amber-200';
  return 'text-red-700 bg-red-50 border-red-200';
}

function formatPlatform(platform: string): string {
  const p = String(platform || '').trim().toLowerCase();
  if (p === 'x' || p === 'twitter') return 'X';
  return p ? p.charAt(0).toUpperCase() + p.slice(1) : '—';
}

export default function CampaignIntelligencePage() {
  const router = useRouter();
  const id = typeof router.query.id === 'string' ? router.query.id : '';
  const [summary, setSummary] = useState<Summary | null>(null);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [stability, setStability] = useState<StabilityResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    const loadSummary = fetch(`/api/intelligence/summary?campaignId=${encodeURIComponent(id)}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Failed to load intelligence summary'))));
    const loadTimeline = fetch(`/api/intelligence/decision-timeline?campaignId=${encodeURIComponent(id)}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { decisions: [], stability: null }))
      .then((data) => {
        setTimeline(Array.isArray(data?.decisions) ? data.decisions : []);
        setStability(data?.stability && typeof data.stability === 'object' ? data.stability : null);
      })
      .catch(() => {
        setTimeline([]);
        setStability(null);
      });

    Promise.all([loadSummary, loadTimeline])
      .then(([summaryData]) => {
        setSummary(summaryData);
      })
      .catch((e) => setError(String(e?.message || e)))
      .finally(() => setLoading(false));
  }, [id]);

  const platformEntries = summary
    ? Object.entries(summary.platform_confidence_average).sort(([, a], [, b]) => b - a)
    : [];

  return (
    <>
      <Head>
        <title>Campaign Intelligence | Virality</title>
      </Head>
      <div className="min-h-screen bg-slate-50 text-slate-900">
        <header className="border-b border-slate-200 bg-white px-4 py-3">
          <div className="mx-auto flex max-w-4xl items-center gap-3">
            <button
              type="button"
              onClick={() => router.back()}
              className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
            <h1 className="flex items-center gap-2 text-lg font-semibold text-slate-800">
              <Brain className="h-5 w-5 text-violet-600" />
              Campaign Intelligence
            </h1>
          </div>
        </header>

        <main className="mx-auto max-w-4xl px-4 py-6">
          {loading && (
            <p className="text-sm text-slate-500">Loading intelligence summary…</p>
          )}
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}
          {!loading && !error && summary && (
            <div className="space-y-6">
              {/* 1. Platform Confidence */}
              <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-slate-800">
                  <BarChart3 className="h-4 w-4 text-slate-500" />
                  Platform Confidence
                </h2>
                {platformEntries.length === 0 ? (
                  <p className="text-sm text-slate-500">No platform confidence data yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {platformEntries.map(([platform, avg]) => (
                      <li
                        key={platform}
                        className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${confidenceColorClass(avg)}`}
                      >
                        <span className="font-medium">{formatPlatform(platform)}</span>
                        <span>
                          {Math.round(avg)} ({confidenceLevel(avg)})
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* 2. Strategist Acceptance */}
              <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-slate-800">
                  <Target className="h-4 w-4 text-slate-500" />
                  Strategist Acceptance
                </h2>
                <p className="mb-3 text-xs text-slate-500">
                  Total feedback events: {summary.total_feedback_events}
                </p>
                <ul className="space-y-2">
                  <li className="flex justify-between rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-2 text-sm">
                    <span>IMPROVE_CTA</span>
                    <span className="font-medium">{Math.round((summary.action_acceptance_rate.IMPROVE_CTA ?? 0) * 100)}%</span>
                  </li>
                  <li className="flex justify-between rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-2 text-sm">
                    <span>IMPROVE_HOOK</span>
                    <span className="font-medium">{Math.round((summary.action_acceptance_rate.IMPROVE_HOOK ?? 0) * 100)}%</span>
                  </li>
                  <li className="flex justify-between rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-2 text-sm">
                    <span>ADD_DISCOVERABILITY</span>
                    <span className="font-medium">{Math.round((summary.action_acceptance_rate.ADD_DISCOVERABILITY ?? 0) * 100)}%</span>
                  </li>
                </ul>
              </section>

              {/* 3. Strategy Decisions */}
              <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-slate-800">
                  <Zap className="h-4 w-4 text-slate-500" />
                  Strategy Decisions
                </h2>
                <ul className="space-y-2">
                  <li className="flex justify-between rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-2 text-sm">
                    <span>STAGGERED</span>
                    <span className="font-medium">{summary.distribution_strategy_counts.STAGGERED} weeks</span>
                  </li>
                  <li className="flex justify-between rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-2 text-sm">
                    <span>ALL_AT_ONCE</span>
                    <span className="font-medium">{summary.distribution_strategy_counts.ALL_AT_ONCE} weeks</span>
                  </li>
                </ul>
              </section>

              {/* 4. Slot Optimization */}
              <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-slate-800">
                  <Zap className="h-4 w-4 text-slate-500" />
                  Slot Optimization
                </h2>
                <p className="text-sm text-slate-600">
                  Slot priority adjustments applied: <strong>{summary.slot_optimization_applied_count}</strong> times
                </p>
              </section>

              {/* 5. Generation Bias */}
              <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-slate-800">
                  <Sparkles className="h-4 w-4 text-slate-500" />
                  Generation Bias
                </h2>
                <p className="mb-3 text-xs text-slate-500">Derived from acceptance rates (read-only)</p>
                <ul className="space-y-2">
                  <li className="flex justify-between rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-2 text-sm">
                    <span>CTA Bias</span>
                    <span className={summary.active_generation_bias.cta_bias ? 'text-emerald-600 font-medium' : 'text-slate-400'}>
                      {summary.active_generation_bias.cta_bias ? 'ON' : 'OFF'}
                    </span>
                  </li>
                  <li className="flex justify-between rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-2 text-sm">
                    <span>Discoverability Bias</span>
                    <span className={summary.active_generation_bias.discoverability_bias ? 'text-emerald-600 font-medium' : 'text-slate-400'}>
                      {summary.active_generation_bias.discoverability_bias ? 'ON' : 'OFF'}
                    </span>
                  </li>
                  <li className="flex justify-between rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-2 text-sm">
                    <span>Hook Softening</span>
                    <span className={summary.active_generation_bias.hook_softening_bias ? 'text-emerald-600 font-medium' : 'text-slate-400'}>
                      {summary.active_generation_bias.hook_softening_bias ? 'ON' : 'OFF'}
                    </span>
                  </li>
                </ul>
              </section>

              {/* 6. Distribution Stability */}
              <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-slate-800">
                  <Activity className="h-4 w-4 text-slate-500" />
                  Distribution Stability
                </h2>
                {!stability || stability.total_weeks < 2 ? (
                  <p className="text-sm text-slate-500">Not enough data to determine stability.</p>
                ) : (
                  <div className="space-y-3">
                    <div className="text-2xl font-semibold text-slate-800">
                      Volatility Score: {stability.volatility_score}%
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-500 text-sm">Stability Level:</span>
                      <span
                        className={
                          stability.stability_level === 'STABLE'
                            ? 'rounded px-2 py-0.5 text-sm font-medium text-emerald-700 bg-emerald-100 border border-emerald-200'
                            : stability.stability_level === 'MODERATE'
                            ? 'rounded px-2 py-0.5 text-sm font-medium text-amber-700 bg-amber-100 border border-amber-200'
                            : 'rounded px-2 py-0.5 text-sm font-medium text-red-700 bg-red-100 border border-red-200'
                        }
                      >
                        {stability.stability_level}
                      </span>
                    </div>
                    <p className="text-sm text-slate-600">
                      Strategy Switches: <strong>{stability.strategy_switches}</strong> / {stability.total_weeks} weeks
                    </p>
                  </div>
                )}
              </section>

              {/* 7. Decision Timeline */}
              <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-slate-800">
                  <Clock className="h-4 w-4 text-slate-500" />
                  Decision Timeline
                </h2>
                {timeline.length === 0 ? (
                  <p className="text-sm text-slate-500">No distribution decisions logged yet.</p>
                ) : (
                  <ul className="space-y-4">
                    {timeline.map((item, idx) => (
                      <li key={`${item.week_number}-${idx}`} className="rounded-lg border border-slate-200 bg-slate-50/30 p-3 text-sm">
                        <div className="mb-2 font-medium text-slate-800">Week {item.week_number}</div>
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2">
                            <span className="text-slate-500">Strategy:</span>
                            <span
                              className={
                                item.resolved_strategy === 'STAGGERED'
                                  ? 'rounded px-1.5 py-0.5 text-xs font-medium text-indigo-700 bg-indigo-100 border border-indigo-200'
                                  : 'rounded px-1.5 py-0.5 text-xs font-medium text-amber-700 bg-amber-100 border border-amber-200'
                              }
                            >
                              {item.resolved_strategy}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-slate-500">AUTO:</span>
                            {item.auto_detected ? (
                              <span className="inline-flex items-center gap-1 text-blue-600">
                                <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                                Yes
                              </span>
                            ) : (
                              <span className="text-slate-400">No</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-slate-500">Quality Override:</span>
                            {item.quality_override ? (
                              <span className="rounded px-1.5 py-0.5 text-xs font-medium text-violet-700 bg-violet-100 border border-violet-200">
                                Yes
                              </span>
                            ) : (
                              <span className="text-slate-400">No</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-slate-500">Slot Optimization:</span>
                            {item.slot_optimization_applied ? (
                              <span className="rounded px-1.5 py-0.5 text-xs font-medium text-emerald-700 bg-emerald-100 border border-emerald-200">
                                Yes
                              </span>
                            ) : (
                              <span className="text-slate-400">No</span>
                            )}
                          </div>
                          <div className="text-slate-500 text-xs mt-1.5">
                            Date: {item.created_at ? new Date(item.created_at).toLocaleString() : '—'}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          )}
        </main>
      </div>
    </>
  );
}
