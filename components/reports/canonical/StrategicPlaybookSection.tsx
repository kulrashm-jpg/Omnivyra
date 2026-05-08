'use client';

import { Score, TrustEnvelope, type ConfidenceBand, type EvidenceTrace, type PillarKey, type SystemMaturityClass } from './CanonicalPrimitives';

type Action = {
  id: string;
  title: string;
  pillar: PillarKey;
  severity: 'critical' | 'moderate' | 'low';
  confidence: ConfidenceBand;
  leverage_score: number;
  expected_impact: 'high' | 'medium' | 'low';
  effort: 'low' | 'medium' | 'high';
  evidence: EvidenceTrace;
  resolved_dependencies: string[];
  sequence_position: number;
  pillar_impact: Record<PillarKey, number>;
  ai_visibility_impact: number;
  discoverability_impact: number;
  trust_impact: number;
  authority_impact: number;
  expected_maturity_shift: 'no' | 'possible' | 'yes';
  classification: 'tactical_fix' | 'strategic_unlock' | 'foundational_blocker' | 'compounding_authority';
  reasoning: string;
};

type Props = {
  data: {
    actions: Action[];
    critical_path_ids: string[];
    parallel_track_ids: string[];
    sequence_narrative: string;
  };
};

const PILLAR_LABEL: Record<PillarKey, string> = {
  foundation: 'Foundation',
  authority: 'Authority',
  discoverability: 'Discoverability',
  trust: 'Trust',
  momentum: 'Momentum',
};

const PILLAR_BG: Record<PillarKey, string> = {
  foundation: 'bg-sky-100 text-sky-800',
  authority: 'bg-indigo-100 text-indigo-800',
  discoverability: 'bg-emerald-100 text-emerald-800',
  trust: 'bg-amber-100 text-amber-800',
  momentum: 'bg-rose-100 text-rose-800',
};

const CLASSIFICATION_LABEL: Record<Action['classification'], string> = {
  tactical_fix: 'Tactical fix',
  strategic_unlock: 'Strategic unlock',
  foundational_blocker: 'Foundational blocker',
  compounding_authority: 'Compounding authority',
};

const CLASSIFICATION_TONE: Record<Action['classification'], string> = {
  tactical_fix: 'bg-slate-100 text-slate-700',
  strategic_unlock: 'bg-blue-100 text-blue-800',
  foundational_blocker: 'bg-rose-100 text-rose-800',
  compounding_authority: 'bg-emerald-100 text-emerald-800',
};

function maturityShiftLabel(shift: Action['expected_maturity_shift']): string {
  if (shift === 'yes') return 'Tier shift expected';
  if (shift === 'possible') return 'Tier shift possible';
  return 'No tier shift';
}

function maturityShiftTone(shift: Action['expected_maturity_shift']): string {
  if (shift === 'yes') return 'bg-emerald-100 text-emerald-800';
  if (shift === 'possible') return 'bg-amber-100 text-amber-800';
  return 'bg-slate-100 text-slate-700';
}

export default function StrategicPlaybookSection({ data }: Props) {
  const criticalPath = new Set(data.critical_path_ids);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Strategic Playbook</p>
        <h3 className="mt-1 text-xl font-bold text-slate-900">Sequenced authority playbook</h3>
        <p className="mt-2 text-sm text-slate-600">{data.sequence_narrative}</p>
      </div>

      {data.actions.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
          No strategic actions could be sequenced from the current evidence.
        </div>
      ) : (
        <ol className="space-y-4">
          {data.actions.map((action) => {
            const onCritical = criticalPath.has(action.id);
            return (
              <li
                key={action.id}
                className={`rounded-xl border p-4 ${
                  onCritical ? 'border-blue-300 bg-blue-50/50' : 'border-slate-200 bg-slate-50'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                      onCritical ? 'bg-blue-600 text-white' : 'bg-slate-300 text-slate-800'
                    }`}>
                      {action.sequence_position}
                    </span>
                    <div>
                      <p className="text-sm font-bold text-slate-900">{action.title}</p>
                      <p className="mt-1 text-sm text-slate-600">{action.reasoning}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Leverage</p>
                    <p className="text-2xl font-bold text-slate-900">{action.leverage_score}</p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
                  <span className={`rounded-full px-2 py-0.5 font-semibold uppercase ${PILLAR_BG[action.pillar]}`}>
                    {PILLAR_LABEL[action.pillar]}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 font-semibold uppercase ${CLASSIFICATION_TONE[action.classification]}`}>
                    {CLASSIFICATION_LABEL[action.classification]}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 font-semibold uppercase ${maturityShiftTone(action.expected_maturity_shift)}`}>
                    {maturityShiftLabel(action.expected_maturity_shift)}
                  </span>
                  {onCritical ? (
                    <span className="rounded-full bg-blue-600 px-2 py-0.5 font-semibold uppercase text-white">Critical path</span>
                  ) : null}
                </div>

                {action.resolved_dependencies.length > 0 ? (
                  <p className="mt-3 text-xs text-slate-600">
                    <span className="font-semibold">Depends on:</span>{' '}
                    {action.resolved_dependencies
                      .map((depId) => data.actions.find((a) => a.id === depId)?.title ?? depId)
                      .join(' · ')}
                  </p>
                ) : null}

                {/* Per-pillar impact projection bar chart */}
                <div className="mt-3 grid gap-1.5 sm:grid-cols-5">
                  {(['foundation', 'authority', 'discoverability', 'trust', 'momentum'] as PillarKey[]).map((pillar) => {
                    const value = action.pillar_impact[pillar];
                    const width = Math.min(100, Math.max(0, Math.abs(value)));
                    return (
                      <div key={pillar} className="flex flex-col gap-1">
                        <div className="flex items-center justify-between text-[10px] text-slate-600">
                          <span className="font-semibold">{PILLAR_LABEL[pillar].slice(0, 4)}</span>
                          <span>{value > 0 ? `+${value}` : value}</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                          <div
                            className={`h-full rounded-full ${value > 0 ? 'bg-emerald-500' : value < 0 ? 'bg-rose-500' : 'bg-slate-400'}`}
                            style={{ width: `${width * 4}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
