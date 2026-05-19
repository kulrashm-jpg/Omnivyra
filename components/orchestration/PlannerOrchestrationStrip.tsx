/**
 * PlannerOrchestrationStrip — Phase-2 Step-15.
 * READ-ONLY, additive, fail-soft orchestration visibility for the planner.
 * Renders nothing when no campaign / no data / error. No mutation, no
 * layout redesign — a single thin chip row reusing existing chip patterns.
 */

import { usePlannerOrchestrationView } from '../../hooks/orchestration/usePlannerOrchestrationView';

function Chip({ label, tone = 'gray' }: { label: string; tone?: 'gray' | 'indigo' | 'amber' | 'emerald' | 'red' }) {
  const cls: Record<string, string> = {
    gray: 'bg-gray-100 text-gray-600',
    indigo: 'bg-indigo-50 text-indigo-700',
    amber: 'bg-amber-50 text-amber-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    red: 'bg-red-50 text-red-700',
  };
  return <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${cls[tone]}`}>{label}</span>;
}

export function PlannerOrchestrationStrip({ campaignId }: { campaignId?: string | null }) {
  const { view } = usePlannerOrchestrationView(campaignId);
  if (!campaignId || !view || view.available === false) return null;

  const es = view.execution_summary;
  const ov = view.orchestration_visibility;
  const score = view.readiness_summary?.readiness_score;
  const mode = view.strategy_visibility?.generation_mode ?? 'EMPTY';
  const blocked = es?.blocked ?? 0;

  return (
    <div className="flex flex-wrap items-center gap-1.5 mb-2" aria-label="Orchestration visibility (read-only)">
      <Chip label="Orchestration" tone="indigo" />
      {typeof score === 'number' && (
        <Chip label={`Readiness ${score}%`} tone={score >= 80 ? 'emerald' : score >= 50 ? 'amber' : 'red'} />
      )}
      {es && <Chip label={`${es.ready}/${es.total} ready`} tone="gray" />}
      {blocked > 0 && <Chip label={`${blocked} blocked`} tone="red" />}
      {es && es.creator_flows > 0 && <Chip label={`${es.creator_flows} creator`} tone="amber" />}
      {es && es.owned_content_flows > 0 && <Chip label={`${es.owned_content_flows} owned`} tone="indigo" />}
      <Chip label={mode} tone="gray" />
      {ov?.rollback_active && <Chip label="rollback" tone="red" />}
      {ov && !ov.rollback_active && ov.fallback_active && <Chip label="legacy/fallback" tone="amber" />}
      {ov?.authoritative_available && !ov.fallback_active && <Chip label="authoritative" tone="emerald" />}
    </div>
  );
}
