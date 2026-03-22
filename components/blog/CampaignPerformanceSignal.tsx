'use client';

/**
 * CampaignPerformanceSignal
 *
 * Shown on the blog detail page (super admin only).
 * Displays campaigns that used this blog's topic and their performance outcome.
 * Also shows the suggested next move from the continuity engine.
 */

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  TrendingUp, Target, AlertCircle, ArrowRight, Loader2,
  BarChart2, RefreshCw, Megaphone,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PerformanceSignal {
  campaign_id:        string;
  campaign_name:      string;
  evaluation_status:  'exceeded' | 'met' | 'underperformed';
  evaluation_score:   number;
  evaluation_summary: string;
  recommended_action: 'continue' | 'optimize' | 'pivot' | null;
  next_topic:         string | null;
  next_topic_reason:  string | null;
  recorded_at:        string;
}

interface SignalData {
  found:   boolean;
  blog:    { id: string; title: string; topic_seed: string | null } | null;
  signals: PerformanceSignal[];
}

interface Props {
  slug: string;
  className?: string;
}

// ── Config ────────────────────────────────────────────────────────────────────

const STATUS = {
  exceeded: {
    icon:  TrendingUp,
    label: 'Exceeded',
    badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    bar:   'bg-emerald-500',
  },
  met: {
    icon:  Target,
    label: 'Met Goals',
    badge: 'bg-blue-50 text-blue-700 border-blue-200',
    bar:   'bg-blue-500',
  },
  underperformed: {
    icon:  AlertCircle,
    label: 'Underperformed',
    badge: 'bg-amber-50 text-amber-700 border-amber-200',
    bar:   'bg-amber-500',
  },
};

const ACTION = {
  continue: { icon: TrendingUp, label: 'Continue & Expand', colour: 'text-emerald-600' },
  optimize: { icon: RefreshCw,  label: 'Optimise',          colour: 'text-blue-600'    },
  pivot:    { icon: ArrowRight, label: 'Pivot',             colour: 'text-amber-600'   },
};

// ── Component ─────────────────────────────────────────────────────────────────

export function CampaignPerformanceSignal({ slug, className = '' }: Props) {
  const [data, setData]       = useState<SignalData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug) return;
    fetch(`/api/blog/${encodeURIComponent(slug)}/campaign-signal`)
      .then((r) => (r.ok ? r.json() : { found: false, blog: null, signals: [] }))
      .then(setData)
      .catch(() => setData({ found: false, blog: null, signals: [] }))
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) {
    return (
      <div className={`flex items-center gap-2 py-4 text-sm text-gray-400 ${className}`}>
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading campaign signals…
      </div>
    );
  }

  if (!data || !data.found || data.signals.length === 0) {
    return (
      <div className={`rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-6 text-center ${className}`}>
        <BarChart2 className="mx-auto h-8 w-8 text-gray-300 mb-2" />
        <p className="text-sm font-medium text-gray-600 mb-0.5">No campaign data yet</p>
        <p className="text-xs text-gray-400">
          Campaigns built from this topic will appear here once performance is recorded.
        </p>
        <Link
          href="/recommendations"
          className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-[#0A66C2] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0A1F44] transition-colors"
        >
          <Megaphone className="h-3.5 w-3.5" />
          Build Campaign from this Blog
        </Link>
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${className}`}>
      <div className="flex items-center gap-2">
        <BarChart2 className="h-4 w-4 text-[#0A66C2]" />
        <h3 className="text-sm font-bold text-[#0B1F33]">Campaign Performance from this Topic</h3>
      </div>

      {data.signals.map((signal) => {
        const statusCfg = STATUS[signal.evaluation_status];
        const StatusIcon = statusCfg.icon;
        const actionCfg = signal.recommended_action ? ACTION[signal.recommended_action] : null;
        const ActionIcon = actionCfg?.icon;
        const scoreWidth = Math.min(100, Math.max(0, signal.evaluation_score || 0));

        return (
          <div
            key={signal.campaign_id}
            className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm"
          >
            {/* Campaign header */}
            <div className="flex items-start justify-between gap-3 mb-3">
              <p className="text-sm font-semibold text-[#0B1F33] leading-snug">{signal.campaign_name}</p>
              <span className={`shrink-0 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${statusCfg.badge}`}>
                <StatusIcon className="h-3 w-3" />
                {statusCfg.label}
              </span>
            </div>

            {/* Score bar */}
            <div className="mb-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-gray-400 uppercase tracking-widest">Performance</span>
                <span className="text-[10px] font-bold text-gray-700">{signal.evaluation_score}/100</span>
              </div>
              <div className="h-1 w-full rounded-full bg-gray-100">
                <div className={`h-1 rounded-full ${statusCfg.bar}`} style={{ width: `${scoreWidth}%` }} />
              </div>
            </div>

            {/* Summary */}
            {signal.evaluation_summary && (
              <p className="text-xs text-gray-500 leading-relaxed mb-2">{signal.evaluation_summary}</p>
            )}

            {/* Next move */}
            {actionCfg && ActionIcon && (
              <div className="mt-2 rounded-lg bg-gray-50 px-3 py-2">
                <div className={`flex items-center gap-1.5 text-xs font-semibold mb-0.5 ${actionCfg.colour}`}>
                  <ActionIcon className="h-3 w-3" />
                  Suggested move: {actionCfg.label}
                </div>
                {signal.next_topic && (
                  <p className="text-xs text-gray-600">
                    Next topic: <span className="font-medium">"{signal.next_topic}"</span>
                  </p>
                )}
                {signal.next_topic_reason && (
                  <p className="text-[11px] text-gray-400 mt-0.5 leading-relaxed">{signal.next_topic_reason}</p>
                )}
              </div>
            )}

            {/* Link to campaign */}
            <div className="mt-3 flex items-center gap-3">
              <Link
                href={`/campaign-planner?campaign_id=${signal.campaign_id}`}
                className="text-xs font-semibold text-[#0A66C2] hover:underline"
              >
                View campaign →
              </Link>
              <span className="text-[10px] text-gray-300">
                {new Date(signal.recorded_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
