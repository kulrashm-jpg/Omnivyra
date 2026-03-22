/**
 * BlogAnalyticsPanel v2
 *
 * Sections (in order):
 *   1. Hot content banner (if trending detected)
 *   2. Summary stats with 7d delta badges
 *   3. Prioritised insights (rule-based, top 3)
 *   4. Content clusters (tag/category intelligence)
 *   5. Top pages with content scores + intent signals
 *   6. AI Strategy Insights (loaded asynchronously, on-demand)
 *   7. Cold start empty state (when total_views < 5)
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Loader2, TrendingUp, TrendingDown, Clock, ArrowDown,
  AlertTriangle, CheckCircle2, Lightbulb, Minus,
  Flame, Zap, BarChart2, Sparkles, ChevronDown, ChevronUp,
  MousePointerClick, Copy, FormInput, ExternalLink, Anchor,
} from 'lucide-react';
import type { BlogInsight, PageStats, PeriodDelta } from '../../pages/api/track/analytics';
import type { HotSlug } from '../../pages/api/track/hot';
import type { AiInsightInput, AiInsightOutput } from '../../pages/api/track/ai-insights';
import type { AnglePerformance } from '../../pages/api/track/angle-performance';

// ── Types ──────────────────────────────────────────────────────────────────

interface ClusterResult {
  name: string; type: 'tag' | 'category'; post_count: number;
  total_views: number; avg_scroll: number; avg_time: number; intent_score: number;
}

interface IntentCounts { cta_click: number; link_click: number; copy: number; form_interaction: number }

interface AnalyticsData {
  total_views: number; avg_time: number; avg_scroll: number;
  top_pages: PageStats[]; insights: BlogInsight[]; delta: PeriodDelta;
  period_days: number; cold_start: boolean;
  intent_counts?: IntentCounts;
}

interface Props { accountId: string }

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtTime(s: number): string { return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`; }

function DeltaBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="text-[10px] text-gray-400">no prior data</span>;
  const up = value > 0; const neu = value === 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold ${up ? 'text-green-600' : neu ? 'text-gray-400' : 'text-red-500'}`}>
      {neu ? <Minus className="h-3 w-3" /> : up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {neu ? '—' : `${up ? '+' : ''}${value}% vs prev 7d`}
    </span>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const c = score >= 70 ? 'text-green-600 bg-green-50 border-green-200' : score >= 40 ? 'text-amber-600 bg-amber-50 border-amber-200' : 'text-red-500 bg-red-50 border-red-200';
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold ${c}`}>{score}/100</span>;
}

const INSIGHT_STYLE: Record<BlogInsight['type'], { bg: string; border: string; icon: React.ReactNode }> = {
  warning: { bg: 'bg-amber-50', border: 'border-amber-200', icon: <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" /> },
  success: { bg: 'bg-green-50',  border: 'border-green-200',  icon: <CheckCircle2  className="h-4 w-4 text-green-500  shrink-0 mt-0.5" /> },
  tip:     { bg: 'bg-blue-50',   border: 'border-blue-200',   icon: <Lightbulb     className="h-4 w-4 text-blue-500   shrink-0 mt-0.5" /> },
};

// ── Sub-sections ───────────────────────────────────────────────────────────

function HotBanner({ hot }: { hot: HotSlug[] }) {
  if (!hot.length) return null;
  return (
    <div className="rounded-xl border border-orange-200 bg-orange-50 p-4 flex items-start gap-3">
      <Flame className="h-5 w-5 text-orange-500 shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-bold text-orange-800">🔥 Trending right now</p>
        <div className="mt-1.5 space-y-1">
          {hot.slice(0, 3).map((h) => (
            <p key={h.slug} className="text-xs text-orange-700">
              <span className="font-mono">{h.slug}</span>
              {' '}&mdash; <strong>{h.views_last_hour}</strong> views in last hour ({h.spike_ratio}× above average)
            </p>
          ))}
        </div>
        <p className="text-[10px] text-orange-500 mt-2">Repost, boost, or convert to a campaign while it's hot.</p>
      </div>
    </div>
  );
}

function IntentRow({ counts }: { counts: IntentCounts }) {
  const items = [
    { label: 'CTA clicks',       icon: <MousePointerClick className="h-3.5 w-3.5" />, value: counts.cta_click },
    { label: 'Outbound links',   icon: <ExternalLink      className="h-3.5 w-3.5" />, value: counts.link_click },
    { label: 'Copy events',      icon: <Copy              className="h-3.5 w-3.5" />, value: counts.copy },
    { label: 'Form interactions',icon: <FormInput         className="h-3.5 w-3.5" />, value: counts.form_interaction },
  ];
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4">
      <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-3">Intent Signals</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {items.map(({ label, icon, value }) => (
          <div key={label} className="text-center">
            <div className="flex justify-center mb-1 text-indigo-400">{icon}</div>
            <div className="text-lg font-bold text-gray-900">{value}</div>
            <div className="text-[10px] text-gray-400">{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ClustersSection({ clusters, top, bottom }: { clusters: ClusterResult[]; top: string | null; bottom: string | null }) {
  const [open, setOpen] = useState(false);
  if (!clusters.length) return null;
  const maxViews = Math.max(1, ...clusters.map((c) => c.total_views));

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4">
      <button className="w-full flex items-center justify-between" onClick={() => setOpen((v) => !v)}>
        <div className="flex items-center gap-2">
          <BarChart2 className="h-4 w-4 text-indigo-400" />
          <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Content Clusters</p>
          {top && <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-semibold">Best: {top}</span>}
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
      </button>

      {open && (
        <div className="mt-4 space-y-3">
          {top && bottom && top !== bottom && (
            <div className="rounded-lg bg-indigo-50 border border-indigo-100 p-3 text-xs text-indigo-700">
              <strong>"{top}"</strong> content outperforms <strong>"{bottom}"</strong> content — consider doubling down.
            </div>
          )}
          {clusters.map((c) => (
            <div key={`${c.type}::${c.name}`} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-gray-700">
                  {c.name}
                  <span className="ml-1 text-[10px] text-gray-400 font-normal">{c.type}</span>
                </span>
                <div className="flex items-center gap-3 text-gray-500">
                  <span>{c.total_views}v</span>
                  <span>{c.avg_scroll}% scroll</span>
                  {c.intent_score > 0 && (
                    <span className="text-indigo-600 font-semibold flex items-center gap-0.5">
                      <Zap className="h-3 w-3" />{c.intent_score} intent
                    </span>
                  )}
                </div>
              </div>
              <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-indigo-500 transition-all"
                  style={{ width: `${Math.round((c.total_views / maxViews) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AiInsightsSection({ accountId, analyticsData, clusters, hot }: {
  accountId:     string;
  analyticsData: AnalyticsData;
  clusters:      ClusterResult[];
  hot:           HotSlug[];
}) {
  const [open,    setOpen]    = useState(false);
  const [loading, setLoading] = useState(false);
  const [result,  setResult]  = useState<AiInsightOutput | null>(null);
  const [error,   setError]   = useState(false);

  const fetch_ = useCallback(async () => {
    if (result || loading) return;
    setLoading(true);
    setError(false);

    // Aggregate intent counts from top_pages (not available directly — use 0 as placeholder)
    const intentCounts: AiInsightInput['intent_counts'] = analyticsData.intent_counts ?? {
      cta_click: 0, link_click: 0, copy: 0, form_interaction: 0,
    };

    const payload: AiInsightInput = {
      total_views:   analyticsData.total_views,
      avg_time:      analyticsData.avg_time,
      avg_scroll:    analyticsData.avg_scroll,
      delta:         analyticsData.delta,
      top_pages:     analyticsData.top_pages,
      clusters:      clusters,
      intent_counts: intentCounts,
      hot_slugs:     hot.map((h) => h.slug),
    };

    try {
      const r = await fetch('/api/track/ai-insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_id: accountId, metrics: payload }),
      });
      if (!r.ok) throw new Error('failed');
      setResult(await r.json());
    } catch { setError(true); }
    finally  { setLoading(false); }
  }, [accountId, analyticsData, clusters, hot, result, loading]);

  return (
    <div className="rounded-xl border border-purple-100 bg-white p-4">
      <button className="w-full flex items-center justify-between" onClick={() => { setOpen((v) => !v); if (!open) fetch_(); }}>
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-purple-500" />
          <p className="text-[11px] font-bold text-purple-600 uppercase tracking-wide">AI Strategy Insights</p>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
      </button>

      {open && (
        <div className="mt-4">
          {loading && (
            <div className="flex items-center gap-2 text-gray-400 text-sm py-4">
              <Loader2 className="h-4 w-4 animate-spin" /> Analysing your content strategy…
            </div>
          )}
          {error && <p className="text-sm text-red-500">Could not load AI insights. Try again later.</p>}
          {result && (
            <div className="space-y-4">
              {result.priority_action && (
                <div className="rounded-lg border border-purple-200 bg-purple-50 p-3">
                  <p className="text-[10px] font-bold text-purple-500 uppercase tracking-wide mb-1">Priority Action</p>
                  <p className="text-sm font-semibold text-purple-900">{result.priority_action}</p>
                </div>
              )}
              {result.observations.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">Observations</p>
                  <ul className="space-y-1.5">
                    {result.observations.map((o, i) => (
                      <li key={i} className="flex gap-2 text-sm text-gray-700">
                        <span className="text-purple-400 shrink-0">•</span>{o}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {result.recommendations.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">Recommendations</p>
                  <ul className="space-y-1.5">
                    {result.recommendations.map((r, i) => (
                      <li key={i} className="flex gap-2 text-sm text-gray-700">
                        <span className="text-green-500 shrink-0">→</span>{r}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {(result.strongest_hook || result.weakest_pattern) && (
                <div className="grid grid-cols-2 gap-3">
                  {result.strongest_hook && (
                    <div className="rounded-lg bg-green-50 border border-green-100 p-3">
                      <p className="text-[10px] font-bold text-green-600 mb-1">Strongest pattern</p>
                      <p className="text-xs text-green-800">{result.strongest_hook}</p>
                    </div>
                  )}
                  {result.weakest_pattern && (
                    <div className="rounded-lg bg-red-50 border border-red-100 p-3">
                      <p className="text-[10px] font-bold text-red-500 mb-1">Weakest pattern</p>
                      <p className="text-xs text-red-700">{result.weakest_pattern}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Angle Performance Section ───────────────────────────────────────────────

const ANGLE_LABELS: Record<string, { label: string; color: string; bg: string; border: string }> = {
  analytical: { label: 'Analytical', color: 'text-blue-700',   bg: 'bg-blue-50',   border: 'border-blue-200' },
  contrarian: { label: 'Contrarian', color: 'text-amber-700',  bg: 'bg-amber-50',  border: 'border-amber-200' },
  strategic:  { label: 'Strategic',  color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200' },
};

function AnglePerformanceSection({ accountId }: { accountId: string }) {
  const [open,    setOpen]    = useState(false);
  const [angles,  setAngles]  = useState<AnglePerformance[]>([]);
  const [best,    setBest]    = useState<string | null>(null);
  const [loaded,  setLoaded]  = useState(false);
  const [loading, setLoading] = useState(false);

  async function load() {
    if (loaded) { setOpen(true); return; }
    setOpen(true);
    setLoading(true);
    try {
      const r = await fetch(`/api/track/angle-performance?account_id=${encodeURIComponent(accountId)}&days=90`);
      if (r.ok) {
        const d = await r.json();
        setAngles(d.angles ?? []);
        setBest(d.best_angle ?? null);
      }
    } catch { /* ignore */ }
    setLoaded(true);
    setLoading(false);
  }

  const maxScore = Math.max(1, ...angles.map((a) => a.avg_content_score));

  return (
    <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
      <button
        type="button"
        onClick={() => open ? setOpen(false) : load()}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <BarChart2 className="h-4 w-4 text-gray-400" />
          <span className="text-xs font-bold text-gray-700 uppercase tracking-wide">Angle Performance</span>
          {best && angles.find(a => a.angle_type === best)?.confidence_level !== 'low' && (
            <span className="text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
              Best: {ANGLE_LABELS[best]?.label ?? best}
            </span>
          )}
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-gray-100 pt-3">
          {loading && (
            <div className="flex items-center gap-2 text-gray-400 text-xs py-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading angle data…
            </div>
          )}

          {!loading && angles.length === 0 && (
            <p className="text-xs text-gray-400 py-2">
              No angle performance data yet. Generate AI blogs with different angles to see which performs best.
            </p>
          )}

          {!loading && angles.length > 0 && (
            <>
              {best && angles.find(a => a.angle_type === best)?.confidence_level !== 'low' && (
                <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2 text-xs text-indigo-700">
                  <strong>{ANGLE_LABELS[best]?.label ?? best}</strong> blogs perform best for your audience — consider using this angle for your next post.
                </div>
              )}
              <div className="space-y-3">
                {angles.map((a) => {
                  const meta  = ANGLE_LABELS[a.angle_type] ?? { label: a.angle_type, color: 'text-gray-600', bg: 'bg-gray-50', border: 'border-gray-200' };
                  const width = Math.round((a.avg_content_score / maxScore) * 100);
                  const confidenceBadge =
                    a.confidence_level === 'high'   ? { label: 'High confidence',   cls: 'bg-emerald-50 text-emerald-700' } :
                    a.confidence_level === 'medium' ? { label: 'Medium confidence', cls: 'bg-amber-50 text-amber-700'     } :
                                                      { label: 'Low confidence',    cls: 'bg-gray-50 text-gray-400'       };
                  return (
                    <div key={a.angle_type}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-bold uppercase tracking-wider ${meta.color}`}>{meta.label}</span>
                          <span className="text-[10px] text-gray-400">{a.post_count} post{a.post_count !== 1 ? 's' : ''}</span>
                          <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${confidenceBadge.cls}`}>
                            {confidenceBadge.label}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-gray-500">
                          <span>{a.avg_scroll}% scroll</span>
                          <span>·</span>
                          <span>{a.total_views} views</span>
                          <span className="font-bold text-gray-700">{a.avg_content_score}/100</span>
                        </div>
                      </div>
                      <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${a.angle_type === 'analytical' ? 'bg-blue-400' : a.angle_type === 'contrarian' ? 'bg-amber-400' : 'bg-emerald-400'} ${a.confidence_level === 'low' ? 'opacity-40' : ''}`}
                          style={{ width: `${width}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-[9px] text-gray-400 mt-1">Scores based on views, scroll depth, and time on page across last 90 days.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Hook Performance Section ──────────────────────────────────────────────

interface HookByStrength {
  hook_strength: 'strong' | 'moderate' | 'weak';
  post_count:    number;
  avg_hook_pass: number;
  avg_hook_exit: number;
  avg_scroll:    number;
}

interface HookBlogStat {
  slug:           string;
  title:          string;
  hook_strength:  string | null;
  hook_pass_rate: number;
  hook_exit_rate: number;
  avg_scroll:     number;
  session_count:  number;
}

const HOOK_STRENGTH_META = {
  strong:   { label: 'Strong',   color: 'text-emerald-700', bar: 'bg-emerald-400', bg: 'bg-emerald-50', border: 'border-emerald-200' },
  moderate: { label: 'Moderate', color: 'text-amber-700',   bar: 'bg-amber-400',   bg: 'bg-amber-50',   border: 'border-amber-200'   },
  weak:     { label: 'Weak',     color: 'text-red-700',     bar: 'bg-red-400',     bg: 'bg-red-50',     border: 'border-red-200'     },
};

function HookPerformanceSection({ accountId }: { accountId: string }) {
  const [open,      setOpen]      = useState(false);
  const [byStrength, setByStrength] = useState<HookByStrength[]>([]);
  const [topHooks,  setTopHooks]  = useState<HookBlogStat[]>([]);
  const [loaded,    setLoaded]    = useState(false);
  const [loading,   setLoading]   = useState(false);

  async function load() {
    if (loaded) { setOpen(true); return; }
    setOpen(true);
    setLoading(true);
    try {
      const r = await fetch(`/api/track/hook-performance?account_id=${encodeURIComponent(accountId)}&days=90`);
      if (r.ok) {
        const d = await r.json();
        setByStrength(d.by_strength ?? []);
        setTopHooks(d.top_hooks ?? []);
      }
    } catch { /* ignore */ }
    setLoaded(true);
    setLoading(false);
  }

  // Best hook insight: is there a meaningful pass-rate gap between strong and weak?
  const strongStat = byStrength.find(s => s.hook_strength === 'strong');
  const weakStat   = byStrength.find(s => s.hook_strength === 'weak');
  const hasInsight = strongStat && weakStat && (strongStat.avg_hook_pass - weakStat.avg_hook_pass) >= 10;

  return (
    <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
      <button
        type="button"
        onClick={() => open ? setOpen(false) : load()}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Anchor className="h-4 w-4 text-gray-400" />
          <span className="text-xs font-bold text-gray-700 uppercase tracking-wide">Hook Performance</span>
          {strongStat && (
            <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
              Strong hooks: {strongStat.avg_hook_pass}% pass-through
            </span>
          )}
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4 border-t border-gray-100 pt-3">
          {loading && (
            <div className="flex items-center gap-2 text-gray-400 text-xs py-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading hook data…
            </div>
          )}

          {!loading && byStrength.length === 0 && (
            <p className="text-xs text-gray-400 py-2">
              No hook data yet. Generate AI blogs to start tracking hook performance against scroll behaviour.
            </p>
          )}

          {!loading && byStrength.length > 0 && (
            <>
              {hasInsight && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-xs text-emerald-700">
                  Strong hooks drive <strong>{strongStat!.avg_hook_pass - weakStat!.avg_hook_pass}% more</strong> readers past the intro than weak hooks.
                </div>
              )}

              {/* By strength group */}
              <div className="space-y-2">
                {byStrength.map(s => {
                  const meta = HOOK_STRENGTH_META[s.hook_strength];
                  return (
                    <div key={s.hook_strength} className={`rounded-lg border p-3 ${meta.bg} ${meta.border}`}>
                      <div className="flex items-center justify-between mb-2">
                        <span className={`text-[10px] font-bold uppercase tracking-wider ${meta.color}`}>
                          {meta.label} Hook — {s.post_count} post{s.post_count !== 1 ? 's' : ''}
                        </span>
                        <span className={`text-[10px] font-semibold ${meta.color}`}>{s.avg_scroll}% avg scroll</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-[10px]">
                        <div>
                          <p className="text-gray-500 mb-0.5">Past intro</p>
                          <div className="h-1.5 bg-white/60 rounded-full overflow-hidden">
                            <div className={`h-full ${meta.bar}`} style={{ width: `${s.avg_hook_pass}%` }} />
                          </div>
                          <p className={`font-semibold mt-0.5 ${meta.color}`}>{s.avg_hook_pass}%</p>
                        </div>
                        <div>
                          <p className="text-gray-500 mb-0.5">Bounced at hook</p>
                          <div className="h-1.5 bg-white/60 rounded-full overflow-hidden">
                            <div className="h-full bg-gray-300" style={{ width: `${s.avg_hook_exit}%` }} />
                          </div>
                          <p className="font-semibold mt-0.5 text-gray-500">{s.avg_hook_exit}%</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Top performing hooks */}
              {topHooks.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-2">Top hooks by pass-through rate</p>
                  <div className="space-y-1.5">
                    {topHooks.slice(0, 5).map(h => {
                      const sKey = h.hook_strength as keyof typeof HOOK_STRENGTH_META | null;
                      const meta = sKey && HOOK_STRENGTH_META[sKey];
                      return (
                        <div key={h.slug} className="flex items-center gap-2 text-[10px]">
                          <div className="flex-1 min-w-0">
                            <p className="text-gray-700 font-medium truncate">{h.title}</p>
                          </div>
                          {meta && (
                            <span className={`shrink-0 px-1.5 py-0.5 rounded-full font-semibold ${meta.bg} ${meta.color}`}>
                              {meta.label}
                            </span>
                          )}
                          <span className="shrink-0 font-bold text-gray-700">{h.hook_pass_rate}% past intro</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <p className="text-[9px] text-gray-400">
                "Past intro" = readers who scrolled ≥ 25% of the page. "Bounced at hook" = left at &lt; 20%.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function BlogAnalyticsPanel({ accountId }: Props) {
  const [data,     setData]     = useState<AnalyticsData | null>(null);
  const [clusters, setClusters] = useState<ClusterResult[]>([]);
  const [topCluster, setTopCluster] = useState<string | null>(null);
  const [botCluster, setBotCluster] = useState<string | null>(null);
  const [hot,      setHot]      = useState<HotSlug[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(false);

  useEffect(() => {
    if (!accountId) return;
    setLoading(true);

    Promise.all([
      fetch(`/api/track/analytics?account_id=${encodeURIComponent(accountId)}&days=30`).then((r) => r.ok ? r.json() : null),
      fetch(`/api/track/clusters?account_id=${encodeURIComponent(accountId)}&days=30`).then((r) => r.ok ? r.json() : null),
      fetch(`/api/track/hot?account_id=${encodeURIComponent(accountId)}`).then((r) => r.ok ? r.json() : null),
    ])
      .then(([analytics, clustersRes, hotRes]) => {
        if (analytics)   setData(analytics);
        if (clustersRes) { setClusters(clustersRes.clusters ?? []); setTopCluster(clustersRes.top_cluster); setBotCluster(clustersRes.bottom_cluster); }
        if (hotRes)      setHot(hotRes.hot ?? []);
        if (!analytics)  setError(true);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [accountId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-gray-400 text-sm py-4 mb-4">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading analytics…
      </div>
    );
  }
  if (error || !data) return null;

  // Cold start
  if (data.cold_start) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-6 mb-6 text-center">
        <TrendingUp className="h-7 w-7 text-gray-300 mx-auto mb-2" />
        <p className="text-sm font-semibold text-gray-500">Waiting for your first visitors</p>
        <p className="text-xs text-gray-400 mt-1">Insights appear after 5+ page views. Make sure the tracking script is live on your blog.</p>
      </div>
    );
  }

  const intentCounts: IntentCounts = data.intent_counts ?? { cta_click: 0, link_click: 0, copy: 0, form_interaction: 0 };
  const hasIntent = Object.values(intentCounts).some((v) => v > 0);

  return (
    <div className="mb-6 space-y-4">
      {/* Hot content banner */}
      <HotBanner hot={hot} />

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Views (30d)',       value: String(data.total_views), icon: <TrendingUp className="h-4 w-4 text-indigo-400" />, delta: data.delta.views_delta },
          { label: 'Avg time on page',  value: fmtTime(data.avg_time),   icon: <Clock       className="h-4 w-4 text-indigo-400" />, delta: data.delta.time_delta  },
          { label: 'Avg scroll depth',  value: `${data.avg_scroll}%`,    icon: <ArrowDown   className="h-4 w-4 text-indigo-400" />, delta: data.delta.scroll_delta },
        ].map(({ label, value, icon, delta }) => (
          <div key={label} className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-3.5">
            <div className="flex justify-center mb-1">{icon}</div>
            <div className="text-xl font-bold text-gray-900 text-center">{value}</div>
            <div className="text-[10px] text-gray-500 text-center mt-0.5 mb-1.5">{label}</div>
            <div className="flex justify-center"><DeltaBadge value={delta} /></div>
          </div>
        ))}
      </div>

      {/* Rule-based insights */}
      {data.insights.length > 0 && (
        <div className="space-y-2">
          {data.insights.map((ins, i) => {
            const s = INSIGHT_STYLE[ins.type];
            return (
              <div key={i} className={`flex gap-3 rounded-xl border ${s.border} ${s.bg} p-3.5`}>
                {s.icon}
                <div>
                  <p className="text-sm font-semibold text-gray-800">{ins.message}</p>
                  {ins.action && <p className="text-xs text-gray-500 mt-0.5">{ins.action}</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Intent signals */}
      {hasIntent && <IntentRow counts={intentCounts} />}

      {/* Content clusters */}
      <ClustersSection clusters={clusters} top={topCluster} bottom={botCluster} />

      {/* Angle performance */}
      <AnglePerformanceSection accountId={accountId} />
      <HookPerformanceSection  accountId={accountId} />

      {/* Top pages */}
      {data.top_pages.length > 0 && (
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-3">Top Pages</p>
          <div className="space-y-2.5">
            {data.top_pages.slice(0, 5).map((p) => (
              <div key={p.slug} className="flex items-center gap-3">
                <span className="flex-1 truncate text-xs text-gray-600 font-mono min-w-0">{p.slug}</span>
                <span className="text-[10px] text-gray-400 shrink-0 hidden sm:block">{p.views}v · {p.avg_scroll}% scroll</span>
                <ScoreBadge score={p.content_score} />
              </div>
            ))}
          </div>
          <p className="text-[9px] text-gray-400 mt-3">Score = views 30% + scroll 40% + time 30%</p>
        </div>
      )}

      {/* AI Strategy Insights */}
      <AiInsightsSection accountId={accountId} analyticsData={data} clusters={clusters} hot={hot} />
    </div>
  );
}
