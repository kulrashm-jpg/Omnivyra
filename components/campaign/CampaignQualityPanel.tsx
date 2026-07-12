/**
 * CAMPAIGN-IMPL-005 — Campaign Quality panel (advisory).
 *
 * Renders the pre-generation quality assessment returned by
 * /api/campaigns/generate-weekly-structure: an overall score + grade, the nine
 * strategic dimensions, and actionable recommendations. Purely presentational,
 * self-hiding when there is nothing to show. Advisory — it explains, it never
 * blocks.
 */
import React from 'react';
import type { CampaignQualityAssessment, QualityGrade } from '../../lib/shared/campaign/campaignQuality';
import type { OptimizationResult } from '../../lib/shared/campaign/campaignOptimizer';

const GRADE_STYLE: Record<QualityGrade, { label: string; cls: string }> = {
  excellent: { label: 'Excellent', cls: 'bg-green-100 text-green-700' },
  good: { label: 'Good', cls: 'bg-green-100 text-green-700' },
  fair: { label: 'Fair', cls: 'bg-amber-100 text-amber-700' },
  needs_attention: { label: 'Needs attention', cls: 'bg-red-100 text-red-700' },
};

function barColor(score: number): string {
  if (score >= 70) return 'bg-green-500';
  if (score >= 55) return 'bg-amber-500';
  return 'bg-red-500';
}

const SEVERITY_STYLE: Record<string, string> = {
  warning: 'text-red-600',
  suggestion: 'text-amber-600',
  info: 'text-gray-500',
};

export default function CampaignQualityPanel({
  assessment,
  optimization,
  className = '',
}: {
  assessment: CampaignQualityAssessment | null | undefined;
  optimization?: OptimizationResult | null;
  className?: string;
}) {
  if (!assessment || assessment.asset_count <= 0) return null;
  const { overall, grade, dimensions, recommendations } = assessment;
  const g = GRADE_STYLE[grade];
  const improved = optimization?.improved && optimization.changes.length > 0;

  return (
    <div className={`rounded-lg border border-gray-200 bg-white p-4 text-sm ${className}`} data-testid="campaign-quality">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h4 className="font-semibold text-gray-800">Campaign quality</h4>
          <span className="text-[11px] text-gray-400">pre-generation</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${g.cls}`}>{g.label}</span>
          <span className="text-lg font-semibold text-gray-800">{overall}</span>
          <span className="text-xs text-gray-400">/100</span>
        </div>
      </div>

      {improved && optimization && (
        <div className="mb-3 rounded-md bg-green-50 px-3 py-2" data-testid="optimization-summary">
          <p className="text-[12px] font-medium text-green-800">
            Optimized before generation: {optimization.before.overall} → {optimization.after.overall}
            <span className="ml-1 text-green-600">(+{optimization.delta})</span>
          </p>
          <ul className="mt-1 space-y-0.5">
            {optimization.changes.slice(0, 6).map((c, i) => (
              <li key={`${c.pass}-${i}`} className="text-[11px] text-green-700">• {c.description}</li>
            ))}
            {optimization.changes.length > 6 && (
              <li className="text-[11px] text-green-600">+{optimization.changes.length - 6} more refinement(s)</li>
            )}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {dimensions.map((d) => (
          <div key={d.key} className="flex items-center gap-2" title={d.detail}>
            <span className="w-40 shrink-0 truncate text-[12px] text-gray-600">{d.label}</span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100">
              <span className={`block h-full rounded-full ${barColor(d.score)}`} style={{ width: `${Math.max(3, d.score)}%` }} />
            </span>
            <span className="w-8 shrink-0 text-right text-[11px] tabular-nums text-gray-500">{d.score}</span>
          </div>
        ))}
      </div>

      {recommendations.length > 0 && (
        <div className="mt-3 border-t border-gray-100 pt-3">
          <p className="mb-1.5 text-xs font-medium text-gray-500">Recommendations ({recommendations.length})</p>
          <ul className="space-y-1">
            {recommendations.map((r, i) => (
              <li key={`${r.dimension}-${i}`} className="flex items-start gap-2">
                <span className={`mt-0.5 text-[10px] ${SEVERITY_STYLE[r.severity] ?? 'text-gray-500'}`}>●</span>
                <span className="text-gray-700">{r.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
