/**
 * Outcome Value Dashboard
 *
 * Shows the user the business value delivered by the AI system:
 *   - Leads generated, cost per lead
 *   - Top performing content type
 *   - Credits saved by AI optimization
 *   - Engagement quality score
 *   - North-star KPI: credits_per_outcome trend
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Target, TrendingDown, Zap, Star, Users, RefreshCw, ChevronRight, ChevronDown } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type OutcomeSnapshot = {
  campaign_id:         string;
  leads_generated:     number;
  conversion_count:    number;
  engagement_quality:  number;
  sentiment_shift:     number;
  outcome_score:       number;
  credits_used:        number;
  credits_per_outcome: number;
  top_content_type:    string | null;
  credits_saved:       number;
  snapshot_at:         string;
};

type EfficiencyTier = 'standard' | 'efficient' | 'optimized' | 'elite';

type CompanyStats = {
  avg_credits_per_outcome: number;
  total_outcomes: number;
  total_leads: number;
  total_credits_used: number;
  best_campaign_id: string | null;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const TIER_STYLES: Record<EfficiencyTier, { label: string; color: string; bg: string }> = {
  standard:  { label: 'Standard',  color: 'text-slate-300', bg: 'bg-slate-700' },
  efficient: { label: 'Efficient', color: 'text-blue-300',  bg: 'bg-blue-900/40' },
  optimized: { label: 'Optimized', color: 'text-violet-300', bg: 'bg-violet-900/40' },
  elite:     { label: 'Elite',     color: 'text-amber-300', bg: 'bg-amber-900/40' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function sentimentLabel(shift: number): { text: string; color: string } {
  if (shift > 0.2)  return { text: 'Positive ↑', color: 'text-emerald-400' };
  if (shift < -0.2) return { text: 'Negative ↓', color: 'text-red-400' };
  return { text: 'Neutral', color: 'text-slate-400' };
}

function qualityLabel(q: number): string {
  if (q > 0.05) return 'Excellent';
  if (q > 0.02) return 'Good';
  if (q > 0.01) return 'Average';
  return 'Low';
}

// ── Component ─────────────────────────────────────────────────────────────────

interface OutcomeValueDashboardProps {
  companyId: string;
  campaignId?: string;
}

export default function OutcomeValueDashboard({ companyId, campaignId }: OutcomeValueDashboardProps) {
  const [outcome, setOutcome]       = useState<OutcomeSnapshot | null>(null);
  const [stats, setStats]           = useState<CompanyStats | null>(null);
  const [tier, setTier]             = useState<EfficiencyTier>('standard');
  const [loading, setLoading]       = useState(true);
  const [showDetails, setShowDetails] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const fetches: Promise<void>[] = [
        fetch(`/api/companies/${companyId}/efficiency`)
          .then(r => r.ok ? r.json() : null)
          .then(d => { if (d) setStats(d); }),
      ];

      if (campaignId) {
        fetches.push(
          fetch(`/api/campaigns/${campaignId}/outcomes`)
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (d) setOutcome(d); })
        );
      }

      // Fetch efficiency tier
      fetches.push(
        fetch(`/api/admin/revenue-analytics?org_id=${companyId}&year=${new Date().getFullYear()}&month=${new Date().getMonth() + 1}`)
          .then(() => {}) // just warm the cache
      );

      await Promise.all(fetches);
    } catch (e) {
      console.error('[OutcomeValueDashboard]', e);
    } finally {
      setLoading(false);
    }
  }, [companyId, campaignId]);

  useEffect(() => { void load(); }, [load]);

  const sentiment = sentimentLabel(outcome?.sentiment_shift ?? 0);
  const tierStyle = TIER_STYLES[tier];

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Target className="w-5 h-5 text-emerald-400" />
          <h2 className="text-lg font-semibold text-white">Value Delivered</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${tierStyle.color} ${tierStyle.bg}`}>
            {tierStyle.label}
          </span>
          <button onClick={() => void load()} disabled={loading}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* ── North-star KPI ── */}
      <div className="rounded-xl border border-emerald-800/50 bg-emerald-900/20 p-4">
        <div className="text-xs text-emerald-400/70 uppercase tracking-wider mb-1">Credits per outcome</div>
        <div className="flex items-end gap-3">
          <span className="text-3xl font-bold text-white">
            {loading ? '—' : (outcome?.credits_per_outcome ?? stats?.avg_credits_per_outcome ?? 0).toFixed(1)}
          </span>
          <span className="text-sm text-slate-400 mb-1">credits / outcome unit</span>
        </div>
        <div className="text-xs text-emerald-400 mt-1">
          Lower is better — AI learns to reduce this over time
        </div>
      </div>

      {/* ── Value KPIs ── */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Users className="w-4 h-4 text-blue-400" />
            <span className="text-xs text-slate-400">Leads generated</span>
          </div>
          <div className="text-xl font-bold text-white">
            {loading ? '—' : (outcome?.leads_generated ?? stats?.total_leads ?? 0).toLocaleString()}
          </div>
          {outcome && (
            <div className="text-xs text-slate-500 mt-0.5">
              this campaign
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Zap className="w-4 h-4 text-violet-400" />
            <span className="text-xs text-slate-400">Credits saved</span>
          </div>
          <div className="text-xl font-bold text-emerald-400">
            {loading ? '—' : (outcome?.credits_saved ?? 0).toLocaleString()}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">via AI optimization</div>
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Star className="w-4 h-4 text-amber-400" />
            <span className="text-xs text-slate-400">Top content type</span>
          </div>
          <div className="text-sm font-semibold text-white capitalize">
            {loading ? '—' : (outcome?.top_content_type?.replace(/_/g, ' ') ?? '—')}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">highest engagement quality</div>
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingDown className="w-4 h-4 text-slate-400" />
            <span className="text-xs text-slate-400">Sentiment</span>
          </div>
          <div className={`text-sm font-semibold ${sentiment.color}`}>
            {loading ? '—' : sentiment.text}
          </div>
          {outcome && (
            <div className="text-xs text-slate-500 mt-0.5">
              quality: {qualityLabel(outcome.engagement_quality)}
            </div>
          )}
        </div>
      </div>

      {/* ── "AI saved you Z credits" messaging ── */}
      {outcome && outcome.credits_saved > 0 && (
        <div className="rounded-xl border border-violet-800/40 bg-violet-900/10 px-4 py-3 text-sm text-violet-300">
          <span className="font-semibold">AI saved you {outcome.credits_saved} credits</span>
          {' '}via Smart Mode deduplication and pattern reuse on this campaign.
        </div>
      )}

      {/* ── Campaign outcome score breakdown ── */}
      {outcome && (
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 overflow-hidden">
          <button onClick={() => setShowDetails(v => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm text-slate-300 hover:text-white hover:bg-white/5 transition-colors">
            <span>Outcome score breakdown ({outcome.outcome_score.toFixed(1)} / 100)</span>
            {showDetails ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
          {showDetails && (
            <div className="border-t border-slate-700 px-4 py-3 space-y-2 text-sm">
              {[
                { label: 'Leads score',        value: Math.min(outcome.leads_generated * 2, 40),                  max: 40 },
                { label: 'Conversions score',  value: Math.min(outcome.conversion_count * 3.5, 35),               max: 35 },
                { label: 'Quality score',      value: parseFloat((outcome.engagement_quality * 15).toFixed(1)),   max: 15 },
                { label: 'Sentiment score',    value: parseFloat((((outcome.sentiment_shift + 1) / 2) * 10).toFixed(1)), max: 10 },
              ].map(row => (
                <div key={row.label}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-slate-400">{row.label}</span>
                    <span className="text-white font-mono">{row.value} / {row.max}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-700">
                    <div
                      className="h-full rounded-full bg-emerald-500"
                      style={{ width: `${Math.min(100, (row.value / row.max) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
