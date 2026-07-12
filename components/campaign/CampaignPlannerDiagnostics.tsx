/**
 * CAMPAIGN-IMPL-003 — Planner diagnostics panel.
 *
 * Renders the explainable outcome of a campaign generation: Requested vs
 * Generated vs Dropped, the per-reason breakdown, planner-integrity, and any
 * recommendations. Purely presentational — it consumes the `planner_diagnostics`
 * payload returned by /api/campaigns/generate-weekly-structure and never fetches.
 *
 * The rule it enforces at the UI edge: a campaign never shows only "Scheduled N"
 * — every requested piece is accounted for, and every drop shows its reason.
 */
import React from 'react';
import {
  summarizeDrops,
  publicDropReason,
  type DroppedItem,
  type DropReasonCode,
} from '../../lib/shared/campaign/plannerDiagnostics';

export interface PlannerDiagnosticsPayload {
  planned: number;
  generated: number;
  dropped: DroppedItem[];
  ok: boolean;
  metrics?: {
    generation_success_pct?: number;
    planner_integrity_pct?: number;
    regenerated?: number;
    average_regeneration_attempts?: number;
  };
  drop_events?: DroppedItem[];
  drop_summary?: Array<{ reason: DropReasonCode; message: string; count: number; public_reason?: string }>;
}

function pct(n: number | undefined): string {
  return typeof n === 'number' ? `${Math.round(n)}%` : '—';
}

export interface ValidationStatsView {
  generated: number;
  validated: number;
  regenerated: number;
  accepted: number;
  adapted?: number;
  dropped: number;
}

export default function CampaignPlannerDiagnostics({
  diagnostics,
  validation,
  className = '',
}: {
  diagnostics: PlannerDiagnosticsPayload | null | undefined;
  validation?: ValidationStatsView | null;
  className?: string;
}) {
  if (!diagnostics || diagnostics.planned <= 0) return null;

  const { planned, generated, dropped, ok, metrics } = diagnostics;
  const droppedCount = dropped?.length ?? 0;
  const summary = diagnostics.drop_summary && diagnostics.drop_summary.length > 0
    ? diagnostics.drop_summary
    : summarizeDrops(dropped ?? []).map((s) => ({ ...s, public_reason: publicDropReason(s.reason) }));

  return (
    <div className={`rounded-lg border border-gray-200 bg-white p-4 text-sm ${className}`} data-testid="planner-diagnostics">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="font-semibold text-gray-800">Generation summary</h4>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
            ok ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
          }`}
          title="Planner integrity: every requested item is either generated or dropped with a reason."
        >
          Integrity {pct(metrics?.planner_integrity_pct ?? (ok ? 100 : undefined))}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="Requested" value={planned} tone="neutral" />
        <Stat label="Generated" value={generated} tone="good" />
        <Stat label="Dropped" value={droppedCount} tone={droppedCount > 0 ? 'warn' : 'neutral'} />
      </div>

      {validation && validation.generated > 0 && (
        <div className="mt-3 border-t border-gray-100 pt-3" data-testid="validation-summary">
          <p className="mb-1.5 text-xs font-medium text-gray-500">Semantic validation</p>
          <div className="grid grid-cols-5 gap-2 text-center">
            <Stat label="Generated" value={validation.generated} tone="neutral" />
            <Stat label="Validated" value={validation.validated} tone="good" />
            <Stat label="Regenerated" value={validation.regenerated} tone={validation.regenerated > 0 ? 'warn' : 'neutral'} />
            <Stat label="Accepted" value={validation.accepted} tone="good" />
            <Stat label="Dropped" value={validation.dropped} tone={validation.dropped > 0 ? 'warn' : 'neutral'} />
          </div>
        </div>
      )}

      {droppedCount > 0 && (
        <div className="mt-3 border-t border-gray-100 pt-3">
          <p className="mb-1.5 text-xs font-medium text-gray-500">Why {droppedCount} weren’t scheduled</p>
          <ul className="space-y-1">
            {summary.map((s) => (
              <li key={s.reason} className="flex items-center justify-between gap-3">
                <span className="text-gray-700">{s.message}</span>
                <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-600">
                  {s.public_reason ?? publicDropReason(s.reason)} · {s.count}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {typeof metrics?.regenerated === 'number' && metrics.regenerated > 0 && (
        <p className="mt-2 text-[11px] text-gray-400">
          {metrics.regenerated} item(s) regenerated to avoid duplicates
          {metrics.average_regeneration_attempts ? ` (avg ${metrics.average_regeneration_attempts} attempts)` : ''}.
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'neutral' | 'good' | 'warn' }) {
  const toneClass =
    tone === 'good' ? 'text-green-600' : tone === 'warn' ? 'text-amber-600' : 'text-gray-700';
  return (
    <div className="rounded-md bg-gray-50 py-2">
      <div className={`text-lg font-semibold ${toneClass}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-gray-400">{label}</div>
    </div>
  );
}
