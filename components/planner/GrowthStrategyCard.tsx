/**
 * Growth Strategy Card
 * Displays the paid amplification recommendation after plan generation.
 * Shows: overall recommendation badge, reasoning, trigger conditions,
 * ad plan details, and expected impact.
 * Purely presentational — receives PaidRecommendation from the API response.
 */

import React, { useState } from 'react';
import { ChevronDown, ChevronUp, DollarSign, Target, TrendingUp, Zap } from 'lucide-react';
import type { PaidRecommendation, PaidOverallRecommendation } from '../../backend/lib/ads/paidAmplificationEngine';

// ---------------------------------------------------------------------------
// Badge styles
// ---------------------------------------------------------------------------

const REC_STYLES: Record<PaidOverallRecommendation, { bg: string; text: string; border: string; label: string; gradient: string }> = {
  NOT_NEEDED: {
    bg: 'bg-gray-100', text: 'text-gray-700', border: 'border-gray-200',
    label: 'NOT NEEDED', gradient: 'from-gray-50 to-slate-50 border-gray-100',
  },
  TEST: {
    bg: 'bg-amber-100', text: 'text-amber-800', border: 'border-amber-200',
    label: 'RUN A TEST', gradient: 'from-amber-50 to-orange-50 border-amber-100',
  },
  SCALE: {
    bg: 'bg-emerald-100', text: 'text-emerald-800', border: 'border-emerald-200',
    label: 'SCALE NOW', gradient: 'from-emerald-50 to-teal-50 border-emerald-100',
  },
};

const OBJECTIVE_LABELS: Record<string, string> = {
  AWARENESS: 'Awareness',
  ENGAGEMENT: 'Engagement',
  LEAD_GEN: 'Lead Generation',
  CONVERSION: 'Conversion',
};

const AUDIENCE_LABELS: Record<string, string> = {
  COLD: 'Cold — new audiences',
  WARM: 'Warm — past visitors/engagers',
  LOOKALIKE: 'Lookalike — similar to existing audience',
};

// ---------------------------------------------------------------------------
// Main card
// ---------------------------------------------------------------------------

interface GrowthStrategyCardProps {
  recommendation: PaidRecommendation;
}

export function GrowthStrategyCard({ recommendation }: GrowthStrategyCardProps) {
  const [expanded, setExpanded] = useState(true);
  const { overallRecommendation, reasoning, triggers, adPlan, expectedImpact } = recommendation;
  const styles = REC_STYLES[overallRecommendation];

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div
        className={`px-4 py-3 bg-gradient-to-r ${styles.gradient} border-b flex items-center justify-between cursor-pointer`}
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-indigo-500" />
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Growth Strategy</h3>
            <p className="text-xs text-gray-500 mt-0.5">Paid amplification recommendation</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${styles.bg} ${styles.text}`}>
            {styles.label}
          </span>
          {expanded
            ? <ChevronUp className="h-4 w-4 text-gray-400" />
            : <ChevronDown className="h-4 w-4 text-gray-400" />}
        </div>
      </div>

      {expanded && (
        <div className="p-4 space-y-4">
          {/* Reasoning */}
          <div>
            <p className="text-xs font-semibold text-gray-500 mb-1.5">Why this recommendation</p>
            <ul className="space-y-1">
              {reasoning.map((r, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-gray-700">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-indigo-400 shrink-0" />
                  {r}
                </li>
              ))}
            </ul>
          </div>

          {/* Ad plan */}
          {adPlan && (
            <div className="rounded-lg bg-indigo-50 p-3 space-y-2">
              <p className="text-xs font-semibold text-indigo-700 flex items-center gap-1">
                <Target className="h-3.5 w-3.5" /> Ad Plan
              </p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                <div>
                  <span className="text-gray-500">Objective</span>
                  <p className="font-medium text-gray-800 mt-0.5">{OBJECTIVE_LABELS[adPlan.objective] ?? adPlan.objective}</p>
                </div>
                <div>
                  <span className="text-gray-500">Audience</span>
                  <p className="font-medium text-gray-800 mt-0.5">{AUDIENCE_LABELS[adPlan.audienceType] ?? adPlan.audienceType}</p>
                </div>
                <div>
                  <span className="text-gray-500">Budget</span>
                  <p className="font-semibold text-indigo-700 mt-0.5">{adPlan.budgetRange}</p>
                </div>
                <div>
                  <span className="text-gray-500">Duration</span>
                  <p className="font-medium text-gray-800 mt-0.5">{adPlan.duration}</p>
                </div>
                <div className="col-span-2">
                  <span className="text-gray-500">Platforms</span>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {adPlan.platforms.map((p) => (
                      <span key={p} className="px-1.5 py-0.5 bg-white rounded border border-indigo-200 text-xs text-indigo-700 font-medium">
                        {p}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Expected impact */}
          <div className="rounded-lg bg-gray-50 p-3 space-y-1">
            <p className="text-xs font-semibold text-gray-600 flex items-center gap-1 mb-2">
              <TrendingUp className="h-3.5 w-3.5" /> Expected Impact (with ads)
            </p>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-gray-500">Reach Lift</span>
                <span className="font-medium text-gray-800">{expectedImpact.reachLift}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Engagement Lift</span>
                <span className="font-medium text-gray-800 text-right max-w-[55%]">{expectedImpact.engagementLift}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Lead Lift</span>
                <span className="font-medium text-gray-800 text-right max-w-[55%]">{expectedImpact.leadLift}</span>
              </div>
            </div>
          </div>

          {/* Triggers */}
          {triggers.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 flex items-center gap-1 mb-2">
                <Zap className="h-3.5 w-3.5 text-amber-500" /> When to activate
              </p>
              <div className="space-y-2">
                {triggers.map((t, i) => (
                  <div key={i} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs">
                    <p className="text-gray-500 mb-0.5">IF: <span className="font-medium text-gray-700">{t.condition}</span></p>
                    <p className="text-indigo-700 font-medium">→ {t.action}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
