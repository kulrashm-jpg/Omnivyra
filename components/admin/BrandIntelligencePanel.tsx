/**
 * Brand Intelligence Panel
 *
 * "AI understands your brand" — surfaces accumulated brand learning:
 *   - Performance trajectory over time (CPO trend)
 *   - What AI has learned about the brand voice, top platforms, winning formats
 *   - Efficiency tier progress
 *   - Comparative improvement ("3× more efficient than 6 months ago")
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Brain, TrendingUp, TrendingDown, Award, RefreshCw, Minus } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type BrandLearning = {
  platform: string | null;
  content_type: string | null;
  pattern: string;
  learning_type: string;
  engagement_impact: number;
  confidence: number;
  reinforcement_score: number;
  times_reinforced: number;
};

type OutcomeHistory = {
  campaign_id: string;
  outcome_score: number;
  credits_per_outcome: number;
  leads_generated: number;
  top_content_type: string | null;
  snapshot_at: string;
};

type EfficiencyScore = {
  efficiency_tier: string;
  discount_multiplier: number;
  credits_per_outcome_avg: number;
  credits_saved_total: number;
  total_outcomes: number;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function trendIcon(values: number[], ascending = false) {
  if (values.length < 2) return <Minus className="w-3 h-3 text-slate-400" />;
  const first = values[0], last = values[values.length - 1];
  const improved = ascending ? last > first : last < first;
  return improved
    ? <TrendingUp className="w-3 h-3 text-emerald-400" />
    : <TrendingDown className="w-3 h-3 text-red-400" />;
}

const TIER_LABELS: Record<string, { emoji: string; next: string | null; desc: string }> = {
  standard:  { emoji: '🌱', next: 'efficient',  desc: 'Building your brand baseline' },
  efficient: { emoji: '⚡', next: 'optimized',  desc: 'AI has learned your patterns' },
  optimized: { emoji: '🎯', next: 'elite',      desc: 'Significantly above average efficiency' },
  elite:     { emoji: '🏆', next: null,         desc: 'Maximum AI efficiency unlocked' },
};

// ── Component ─────────────────────────────────────────────────────────────────

interface BrandIntelligencePanelProps {
  companyId: string;
}

export default function BrandIntelligencePanel({ companyId }: BrandIntelligencePanelProps) {
  const [learnings, setLearnings]     = useState<BrandLearning[]>([]);
  const [history, setHistory]         = useState<OutcomeHistory[]>([]);
  const [efficiency, setEfficiency]   = useState<EfficiencyScore | null>(null);
  const [loading, setLoading]         = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [learnRes, histRes, effRes] = await Promise.all([
        fetch(`/api/companies/${companyId}/learnings?limit=8`),
        fetch(`/api/companies/${companyId}/outcome-history?limit=6`),
        fetch(`/api/companies/${companyId}/efficiency-score`),
      ]);

      if (learnRes.ok) setLearnings(await learnRes.json());
      if (histRes.ok)  setHistory(await histRes.json());
      if (effRes.ok)   setEfficiency(await effRes.json());
    } catch (e) {
      console.error('[BrandIntelligencePanel]', e);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { void load(); }, [load]);

  const tierInfo = TIER_LABELS[efficiency?.efficiency_tier ?? 'standard'];
  const cpoValues = history.map(h => h.credits_per_outcome).reverse();
  const improving = cpoValues.length >= 2 && cpoValues[cpoValues.length - 1] < cpoValues[0];

  // Compute improvement ratio vs first campaign
  const improvementRatio = cpoValues.length >= 2 && cpoValues[0] > 0
    ? (cpoValues[0] / cpoValues[cpoValues.length - 1]).toFixed(1)
    : null;

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-violet-400" />
          <h2 className="text-lg font-semibold text-white">Brand Intelligence</h2>
        </div>
        <button onClick={() => void load()} disabled={loading}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* ── "AI understands your brand" card ── */}
      <div className="rounded-xl border border-violet-800/50 bg-gradient-to-br from-violet-900/20 to-slate-900 p-4">
        <div className="flex items-start gap-3">
          <span className="text-3xl">{tierInfo.emoji}</span>
          <div>
            <div className="text-white font-semibold">
              AI understands your brand
              {efficiency && ` — ${efficiency.efficiency_tier.charAt(0).toUpperCase() + efficiency.efficiency_tier.slice(1)} tier`}
            </div>
            <div className="text-sm text-slate-400 mt-0.5">{tierInfo.desc}</div>
            {improving && improvementRatio && parseFloat(improvementRatio) > 1.1 && (
              <div className="text-sm text-emerald-400 mt-1.5 flex items-center gap-1">
                <TrendingUp className="w-3.5 h-3.5" />
                {improvementRatio}× more efficient than when you started
              </div>
            )}
            {efficiency && efficiency.credits_saved_total > 0 && (
              <div className="text-xs text-violet-300 mt-1">
                Total credits saved through AI efficiency: {efficiency.credits_saved_total.toLocaleString()}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── CPO trend graph (sparkline) ── */}
      {history.length >= 2 && (
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm text-slate-300">Credits / outcome over time</div>
            <div className="flex items-center gap-1 text-xs">
              {trendIcon(cpoValues, false)}
              <span className={improving ? 'text-emerald-400' : 'text-slate-400'}>
                {improving ? 'Improving' : 'Monitoring'}
              </span>
            </div>
          </div>
          <div className="flex items-end gap-1.5 h-12">
            {history.slice().reverse().map((h, i) => {
              const maxCPO = Math.max(...history.map(x => x.credits_per_outcome), 1);
              const pct    = Math.max(5, (h.credits_per_outcome / maxCPO) * 100);
              const isLast = i === history.length - 1;
              return (
                <div key={h.campaign_id} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full relative" style={{ height: '40px' }}>
                    <div
                      className={`absolute bottom-0 w-full rounded-sm ${isLast ? 'bg-emerald-500' : 'bg-slate-600'}`}
                      style={{ height: `${pct}%` }}
                    />
                  </div>
                  <span className="text-xs text-slate-500 tabular-nums">
                    {h.credits_per_outcome.toFixed(0)}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="text-xs text-slate-600 mt-1 text-right">← older / newer →</div>
        </div>
      )}

      {/* ── What AI has learned ── */}
      {learnings.length > 0 && (
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
          <div className="text-sm font-medium text-slate-300 mb-3">
            What AI has learned about your brand ({learnings.length} patterns)
          </div>
          <div className="space-y-2">
            {learnings.slice(0, 5).map((l, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <span className="text-violet-400 mt-0.5 shrink-0">•</span>
                <div>
                  <span className="text-slate-200">{l.pattern}</span>
                  {l.platform && (
                    <span className="text-slate-500 ml-1.5 text-xs">[{l.platform}]</span>
                  )}
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-slate-500">
                      impact: {(l.engagement_impact * 100).toFixed(1)}%
                    </span>
                    {l.times_reinforced > 1 && (
                      <span className="text-xs text-emerald-400">
                        ✓ reinforced {l.times_reinforced}×
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Efficiency progress bar ── */}
      {efficiency && (
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm text-slate-400">Efficiency tier progress</div>
            <Award className="w-4 h-4 text-amber-400" />
          </div>
          <div className="flex items-center gap-2 mb-3">
            {(['standard', 'efficient', 'optimized', 'elite'] as const).map((t, i, arr) => {
              const active = efficiency.efficiency_tier === t;
              const passed = arr.indexOf(efficiency.efficiency_tier as any) > i;
              return (
                <React.Fragment key={t}>
                  <div className={`flex flex-col items-center`}>
                    <div className={`w-3 h-3 rounded-full border-2 ${
                      active ? 'bg-violet-500 border-violet-400' :
                      passed ? 'bg-violet-800 border-violet-700' :
                               'bg-slate-700 border-slate-600'
                    }`} />
                    <span className={`text-xs mt-1 ${active ? 'text-violet-300' : 'text-slate-600'}`}>
                      {TIER_LABELS[t].emoji}
                    </span>
                  </div>
                  {i < arr.length - 1 && (
                    <div className={`flex-1 h-0.5 ${passed ? 'bg-violet-700' : 'bg-slate-700'}`} />
                  )}
                </React.Fragment>
              );
            })}
          </div>
          {tierInfo.next && (
            <div className="text-xs text-slate-500">
              Next: <span className="text-slate-400 capitalize">{tierInfo.next}</span> tier — keep reducing credits_per_outcome
            </div>
          )}
          <div className="text-xs text-slate-500 mt-1">
            Current discount: <span className="text-violet-300">{Math.round((1 - efficiency.discount_multiplier) * 100)}% off intelligence actions</span>
          </div>
        </div>
      )}
    </div>
  );
}
