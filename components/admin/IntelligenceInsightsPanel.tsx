/**
 * Intelligence Insights Panel — Step 8
 *
 * User-facing panel surfacing:
 *   "Why AI did this"    — last 3 major autonomous decisions
 *   "What changed"       — week-over-week changes
 *   "What is improving"  — reinforced winning patterns
 *
 * + Pattern detection summary
 * + Market positioning whitespace
 * + Benchmark gap indicators
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Brain, TrendingUp, TrendingDown, ArrowRight, Lightbulb, Target, RefreshCw, ChevronDown, ChevronRight, Zap, BarChart3, AlertCircle } from 'lucide-react';

type Insight = {
  patterns: {
    winning_patterns: Array<{ pattern: string; platform: string; avg_engagement_rate: number; occurrence_count: number }>;
    losing_patterns:  Array<{ pattern: string; platform: string }>;
    top_cta_signals:  string[];
    content_type_clusters: Array<{ content_type: string; avg_engagement: number; volume: number }>;
  } | null;
  market_positioning: {
    whitespace_opportunities: Array<{ topic: string; opportunity_score: number }>;
    strengths:               Array<{ topic: string; engagement_score: number }>;
    recommendation:          string;
  } | null;
  competitor_intelligence: {
    benchmark_gaps: Array<{ platform: string; company_rate: number; benchmark_avg: number; gap_label: string }>;
    trending_formats: string[];
  } | null;
  strategy_evolution: {
    changes: Array<{ field: string; previous: unknown; next: unknown; reason: string }>;
    evolution_reason: string;
    confidence: number;
  } | null;
  insight_surfaces: {
    why_ai_did_this: Array<{ decision: string; reason: string; outcome: string | null; when: string }>;
    what_changed_this_week: Array<{ what: string; type: string; when: string }>;
    what_is_improving: Array<{ pattern: string; platform: string | null; effective_score: number; times_reinforced: number }>;
  };
};

const DECISION_ICONS: Record<string, string> = {
  generate: '🤖', scale: '📈', pause: '⏸️', recover: '🔄',
  optimize: '⚙️', approve: '✅', reject: '❌', learn: '🧠',
};

const GAP_COLORS: Record<string, string> = {
  above:   'text-green-600 bg-green-50',
  on_par:  'text-blue-600 bg-blue-50',
  below:   'text-red-600 bg-red-50',
};

const GAP_LABELS: Record<string, string> = {
  above: '↑ above average', on_par: '≈ on par', below: '↓ below average',
};

interface Props {
  companyId: string;
  token: string;
}

export default function IntelligenceInsightsPanel({ companyId, token }: Props) {
  const [data, setData]           = useState<Insight | null>(null);
  const [loading, setLoading]     = useState(true);
  const [activeSection, setActive] = useState<string | null>('why');
  const headers = { Authorization: `Bearer ${token}` };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/companies/${companyId}/intelligence`, { headers });
      const json = await res.json();
      if (json.success) setData(json.data);
    } finally {
      setLoading(false);
    }
  }, [companyId, token]);

  useEffect(() => { load(); }, [load]);

  function toggle(section: string) {
    setActive(v => v === section ? null : section);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400">
        <RefreshCw className="w-5 h-5 animate-spin mr-2" />
        Generating intelligence snapshot…
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-12 text-slate-400">
        <Brain className="w-8 h-8 mx-auto mb-2 opacity-40" />
        No intelligence data available yet
      </div>
    );
  }

  const { insight_surfaces: is, patterns, market_positioning: market, competitor_intelligence: competitors, strategy_evolution: evolution } = data;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-purple-600" />
          <h2 className="font-semibold text-slate-900">Intelligence Insights</h2>
        </div>
        <button onClick={load} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Why AI did this */}
      <Section
        id="why"
        active={activeSection === 'why'}
        onToggle={() => toggle('why')}
        icon={<Brain className="w-4 h-4 text-purple-500" />}
        title="Why AI did this"
        badge={is.why_ai_did_this.length}
      >
        {is.why_ai_did_this.length === 0 ? (
          <p className="text-sm text-slate-400 py-2">No major autonomous decisions yet</p>
        ) : is.why_ai_did_this.map((d, i) => (
          <div key={i} className="flex gap-3 py-2 border-b border-slate-50 last:border-0">
            <span className="text-lg leading-5">{DECISION_ICONS[d.decision] ?? '🤖'}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-800 capitalize">{d.decision}</p>
              <p className="text-xs text-slate-500 mt-0.5">{d.reason}</p>
              {d.outcome && <p className="text-xs text-slate-400 mt-0.5 italic">{d.outcome}</p>}
              <p className="text-xs text-slate-300 mt-1">{new Date(d.when).toLocaleDateString('en-GB')}</p>
            </div>
          </div>
        ))}
      </Section>

      {/* What changed this week */}
      <Section
        id="changed"
        active={activeSection === 'changed'}
        onToggle={() => toggle('changed')}
        icon={<Zap className="w-4 h-4 text-yellow-500" />}
        title="What changed this week"
        badge={is.what_changed_this_week.length}
      >
        {is.what_changed_this_week.length === 0 ? (
          <p className="text-sm text-slate-400 py-2">No changes recorded this week</p>
        ) : is.what_changed_this_week.map((c, i) => (
          <div key={i} className="flex items-start gap-2 py-1.5 border-b border-slate-50 last:border-0">
            <ArrowRight className="w-3.5 h-3.5 text-slate-300 mt-0.5 shrink-0" />
            <p className="text-xs text-slate-600">{c.what}</p>
          </div>
        ))}
      </Section>

      {/* What is improving */}
      <Section
        id="improving"
        active={activeSection === 'improving'}
        onToggle={() => toggle('improving')}
        icon={<TrendingUp className="w-4 h-4 text-green-500" />}
        title="What is improving"
        badge={is.what_is_improving.length}
      >
        {is.what_is_improving.length === 0 ? (
          <p className="text-sm text-slate-400 py-2">No reinforced patterns yet — keep publishing</p>
        ) : is.what_is_improving.map((w, i) => (
          <div key={i} className="py-2 border-b border-slate-50 last:border-0">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-slate-700 truncate flex-1 pr-2">{w.pattern}</p>
              <span className="text-xs text-green-600 font-semibold shrink-0">×{w.times_reinforced}</span>
            </div>
            {w.platform && <p className="text-xs text-slate-400 mt-0.5">{w.platform}</p>}
            <div className="w-full bg-slate-100 rounded-full h-1 mt-1.5">
              <div className="bg-green-500 h-1 rounded-full" style={{ width: `${Math.min(100, w.effective_score * 100)}%` }} />
            </div>
          </div>
        ))}
      </Section>

      {/* Winning patterns */}
      {patterns && (
        <Section
          id="patterns"
          active={activeSection === 'patterns'}
          onToggle={() => toggle('patterns')}
          icon={<Lightbulb className="w-4 h-4 text-amber-500" />}
          title="Winning patterns"
          badge={patterns.winning_patterns.length}
        >
          <div className="space-y-2">
            {patterns.winning_patterns.slice(0, 5).map((p, i) => (
              <div key={i} className="flex items-start justify-between gap-2 py-1.5 border-b border-slate-50 last:border-0">
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-slate-700 font-medium">{p.pattern}</p>
                  <p className="text-xs text-slate-400">{p.platform} · {p.occurrence_count} posts</p>
                </div>
                <span className="text-xs text-green-700 font-semibold shrink-0">{(p.avg_engagement_rate * 100).toFixed(1)}%</span>
              </div>
            ))}
            {patterns.top_cta_signals.length > 0 && (
              <div className="pt-2">
                <p className="text-xs font-medium text-slate-500 mb-1">Top CTAs:</p>
                <div className="flex flex-wrap gap-1">
                  {patterns.top_cta_signals.map(cta => (
                    <span key={cta} className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">{cta}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Section>
      )}

      {/* Market positioning */}
      {market && (
        <Section
          id="market"
          active={activeSection === 'market'}
          onToggle={() => toggle('market')}
          icon={<Target className="w-4 h-4 text-blue-500" />}
          title="Market positioning"
          badge={market.whitespace_opportunities.length}
        >
          {market.whitespace_opportunities.length > 0 && (
            <div className="mb-3">
              <p className="text-xs font-medium text-slate-500 mb-1.5">Whitespace opportunities:</p>
              {market.whitespace_opportunities.slice(0, 3).map((w, i) => (
                <div key={i} className="flex items-center justify-between py-1 border-b border-slate-50 last:border-0">
                  <p className="text-xs text-slate-700">{w.topic}</p>
                  <span className="text-xs text-purple-600 font-medium">{(w.opportunity_score * 100).toFixed(0)}%</span>
                </div>
              ))}
            </div>
          )}
          {market.recommendation && (
            <div className="mt-2 p-2 bg-amber-50 rounded-lg">
              <p className="text-xs text-amber-800">{market.recommendation}</p>
            </div>
          )}
        </Section>
      )}

      {/* Benchmark gaps */}
      {competitors?.benchmark_gaps && competitors.benchmark_gaps.length > 0 && (
        <Section
          id="benchmarks"
          active={activeSection === 'benchmarks'}
          onToggle={() => toggle('benchmarks')}
          icon={<BarChart3 className="w-4 h-4 text-indigo-500" />}
          title="vs Industry benchmarks"
        >
          <div className="space-y-1.5">
            {competitors.benchmark_gaps.map((g, i) => (
              <div key={i} className="flex items-center justify-between py-1">
                <span className="text-xs text-slate-600 capitalize">{g.platform}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">{(g.company_rate * 100).toFixed(2)}%</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${GAP_COLORS[g.gap_label] ?? 'bg-slate-50 text-slate-500'}`}>
                    {GAP_LABELS[g.gap_label] ?? g.gap_label}
                  </span>
                </div>
              </div>
            ))}
          </div>
          {competitors.trending_formats.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-medium text-slate-500 mb-1">Trending formats:</p>
              {competitors.trending_formats.slice(0, 4).map((f, i) => (
                <p key={i} className="text-xs text-slate-600 py-0.5">• {f}</p>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* Strategy evolution */}
      {evolution && evolution.changes.length > 0 && (
        <Section
          id="evolution"
          active={activeSection === 'evolution'}
          onToggle={() => toggle('evolution')}
          icon={<TrendingUp className="w-4 h-4 text-violet-500" />}
          title="Strategy evolution"
          badge={evolution.changes.length}
        >
          <div className="space-y-2">
            {evolution.changes.slice(0, 5).map((c, i) => (
              <div key={i} className="flex items-start gap-2 py-1.5 border-b border-slate-50 last:border-0">
                <AlertCircle className="w-3.5 h-3.5 text-violet-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-medium text-slate-700">{c.field}</p>
                  <p className="text-xs text-slate-400">{c.reason}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <div className="flex-1 bg-slate-100 rounded-full h-1">
              <div className="bg-violet-500 h-1 rounded-full" style={{ width: `${evolution.confidence * 100}%` }} />
            </div>
            <span className="text-xs text-slate-400">{(evolution.confidence * 100).toFixed(0)}% confidence</span>
          </div>
        </Section>
      )}
    </div>
  );
}

// ── Reusable collapsible section ─────────────────────────────────────────────
function Section({
  id, active, onToggle, icon, title, badge, children,
}: {
  id: string;
  active: boolean;
  onToggle: () => void;
  icon: React.ReactNode;
  title: string;
  badge?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-medium text-slate-800">{title}</span>
          {badge !== undefined && badge > 0 && (
            <span className="text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">{badge}</span>
          )}
        </div>
        {active ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
      </button>
      {active && <div className="px-4 pb-4 pt-1">{children}</div>}
    </div>
  );
}
