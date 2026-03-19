/**
 * Campaign Validation Card
 * Displays post-generation plan quality signal to the CMO.
 * Shows: confidence score, risk level, expected outcomes, issues, top suggestions.
 * Purely presentational — receives CampaignValidation from the API response.
 */

import React, { useState } from 'react';
import { AlertTriangle, CheckCircle, ChevronDown, ChevronUp, TrendingUp, Zap } from 'lucide-react';
import type { CampaignValidation } from '../../backend/lib/validation/campaignValidator';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ConfidenceBar({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(100, score));
  const color =
    clamped >= 80 ? 'bg-emerald-500' : clamped >= 50 ? 'bg-amber-500' : 'bg-red-500';
  const textColor =
    clamped >= 80 ? 'text-emerald-700' : clamped >= 50 ? 'text-amber-700' : 'text-red-700';
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-gray-700">Confidence Score</span>
        <span className={`text-lg font-bold ${textColor}`}>{clamped}</span>
      </div>
      <div className="h-2.5 rounded-full bg-gray-200 overflow-hidden">
        <div
          className={`h-full rounded-full ${color} transition-all duration-500`}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}

const RISK_STYLES: Record<CampaignValidation['riskLevel'], { bg: string; text: string; label: string }> = {
  LOW: { bg: 'bg-emerald-100', text: 'text-emerald-800', label: 'LOW RISK' },
  MEDIUM: { bg: 'bg-amber-100', text: 'text-amber-800', label: 'MEDIUM RISK' },
  HIGH: { bg: 'bg-red-100', text: 'text-red-800', label: 'HIGH RISK' },
};

function RiskBadge({ level }: { level: CampaignValidation['riskLevel'] }) {
  const s = RISK_STYLES[level];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${s.bg} ${s.text}`}>
      {level === 'HIGH' && <AlertTriangle className="h-3 w-3" />}
      {level === 'LOW' && <CheckCircle className="h-3 w-3" />}
      {s.label}
    </span>
  );
}

function DimensionMini({ label, score }: { label: string; score: number }) {
  const pct = Math.round((score / 20) * 100);
  const color = pct >= 75 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-400' : 'bg-red-400';
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-28 shrink-0 text-gray-600 truncate">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-gray-200 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-6 text-right font-medium text-gray-700">{score}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main card
// ---------------------------------------------------------------------------

interface CampaignValidationCardProps {
  validation: CampaignValidation;
}

const DIMENSION_LABELS: Record<keyof CampaignValidation['scoreBreakdown'], string> = {
  frequency: 'Frequency',
  platformMix: 'Platform Mix',
  contentDiversity: 'Content Diversity',
  funnelCoverage: 'Funnel Coverage',
  consistency: 'Consistency',
};

export function CampaignValidationCard({ validation }: CampaignValidationCardProps) {
  const [expanded, setExpanded] = useState(true);
  const { confidenceScore, riskLevel, expectedOutcome, issues, suggestions, scoreBreakdown } = validation;
  const topSuggestions = suggestions.slice(0, 3);

  const headerGradient =
    riskLevel === 'LOW'
      ? 'from-emerald-50 to-teal-50 border-emerald-100'
      : riskLevel === 'MEDIUM'
        ? 'from-amber-50 to-orange-50 border-amber-100'
        : 'from-red-50 to-rose-50 border-red-100';

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div
        className={`px-4 py-3 bg-gradient-to-r ${headerGradient} border-b flex items-center justify-between cursor-pointer`}
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-indigo-500" />
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Plan Validation</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {issues.length === 0
                ? 'No issues detected — plan looks strong.'
                : `${issues.length} issue${issues.length > 1 ? 's' : ''} detected`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <RiskBadge level={riskLevel} />
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-gray-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-gray-400" />
          )}
        </div>
      </div>

      {expanded && (
        <div className="p-4 space-y-4">
          {/* Confidence score bar */}
          <ConfidenceBar score={confidenceScore} />

          {/* Score dimension breakdown */}
          <div>
            <p className="text-xs font-medium text-gray-500 mb-2">Score Breakdown</p>
            <div className="space-y-2">
              {(Object.keys(scoreBreakdown) as Array<keyof typeof scoreBreakdown>).map((key) => (
                <DimensionMini key={key} label={DIMENSION_LABELS[key]} score={scoreBreakdown[key]} />
              ))}
            </div>
          </div>

          {/* Expected outcomes */}
          <div className="rounded-lg bg-gray-50 p-3 space-y-1">
            <p className="text-xs font-semibold text-gray-600 flex items-center gap-1 mb-2">
              <TrendingUp className="h-3.5 w-3.5" /> Expected Outcomes
            </p>
            <div className="grid grid-cols-1 gap-1 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Reach</span>
                <span className="font-medium text-gray-800">{expectedOutcome.reachEstimate}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Engagement</span>
                <span className="font-medium text-gray-800 text-right max-w-[60%]">{expectedOutcome.engagementEstimate}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Leads</span>
                <span className="font-medium text-gray-800 text-right max-w-[60%]">{expectedOutcome.leadsEstimate}</span>
              </div>
            </div>
          </div>

          {/* Issues */}
          {issues.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1.5">Issues Detected</p>
              <ul className="space-y-1">
                {issues.map((issue, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-gray-700">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
                    {issue}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Top suggestions */}
          {topSuggestions.length > 0 && (
            <div className="border-t border-gray-100 pt-3">
              <p className="text-xs font-semibold text-indigo-700 mb-2">Top Actions Before Launch</p>
              <ol className="space-y-1.5 list-decimal list-inside">
                {topSuggestions.map((s, i) => (
                  <li key={i} className="text-xs text-gray-700 leading-snug">
                    {s}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
