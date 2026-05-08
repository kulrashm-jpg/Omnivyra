'use client';

import {
  Score,
  TrustEnvelope,
  type ConfidenceBand,
  type EvidenceTrace,
  type PillarKey,
  type SystemMaturityClass,
} from './CanonicalPrimitives';

type CanonicalAction = {
  id: string;
  title: string;
  pillar: PillarKey;
  severity: 'critical' | 'moderate' | 'low';
  confidence: ConfidenceBand;
  leverage_score: number;
  expected_impact: 'high' | 'medium' | 'low';
  effort: 'low' | 'medium' | 'high';
  evidence: EvidenceTrace;
  dependencies: string[];
  timeline: { short: string; mid: string; long: string };
  owner_area: 'content' | 'engineering' | 'marketing_ops' | 'pr' | 'product' | 'cross_functional';
  maturity_implication:
    | 'unblocks_foundation'
    | 'compounds_authority'
    | 'extends_discoverability'
    | 'reinforces_trust'
    | 'accelerates_momentum'
    | 'shifts_tier';
  reasoning: string;
  expected_outcome: string;
};

type Props = {
  actions: CanonicalAction[];
  summary: { text: string; confidence: ConfidenceBand; evidence: EvidenceTrace; maturity: SystemMaturityClass };
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

const MATURITY_IMPLICATION_LABEL: Record<CanonicalAction['maturity_implication'], string> = {
  unblocks_foundation: 'Unblocks foundation',
  compounds_authority: 'Compounds authority',
  extends_discoverability: 'Extends discoverability',
  reinforces_trust: 'Reinforces trust',
  accelerates_momentum: 'Accelerates momentum',
  shifts_tier: 'Shifts maturity tier',
};

function severityClasses(severity: CanonicalAction['severity']): string {
  if (severity === 'critical') return 'bg-rose-100 text-rose-800';
  if (severity === 'moderate') return 'bg-amber-100 text-amber-800';
  return 'bg-slate-100 text-slate-700';
}

function confidenceBadge(c: ConfidenceBand): string {
  if (c === 'high') return 'bg-emerald-100 text-emerald-800';
  if (c === 'medium') return 'bg-amber-100 text-amber-800';
  return 'bg-slate-100 text-slate-700';
}

export default function ActionPlaybook({ actions, summary }: Props) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Action Playbook</p>
        <h3 className="mt-1 text-xl font-bold text-slate-900">
          Canonical recommendations, ranked by leverage
        </h3>
        <p className="mt-2 text-sm text-slate-600">
          One unified action surface. Every action carries pillar, severity, confidence, leverage,
          and the maturity tier it unlocks — replacing five fragmented recommendation arrays.
        </p>
      </div>

      <div className="mb-5">
        <TrustEnvelope narrative={summary} />
      </div>

      {actions.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
          No high-leverage actions could be derived — evidence is too thin to issue a recommendation yet.
        </div>
      ) : (
        <ol className="space-y-4">
          {actions.map((action, idx) => (
            <li key={action.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">
                    {idx + 1}
                  </span>
                  <div>
                    <p className="text-sm font-bold text-slate-900">{action.title}</p>
                    <p className="mt-1 text-sm text-slate-600">{action.reasoning}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Leverage</p>
                  <p className="text-2xl font-bold text-slate-900">{action.leverage_score}</p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
                <span className={`rounded-full px-2 py-0.5 font-semibold uppercase ${PILLAR_BG[action.pillar]}`}>
                  {PILLAR_LABEL[action.pillar]}
                </span>
                <span className={`rounded-full px-2 py-0.5 font-semibold uppercase ${severityClasses(action.severity)}`}>
                  {action.severity}
                </span>
                <span className={`rounded-full px-2 py-0.5 font-semibold uppercase ${confidenceBadge(action.confidence)}`}>
                  {action.confidence} confidence
                </span>
                <span className="rounded-full bg-slate-200 px-2 py-0.5 font-semibold uppercase text-slate-700">
                  {action.expected_impact} impact
                </span>
                <span className="rounded-full bg-slate-200 px-2 py-0.5 font-semibold uppercase text-slate-700">
                  {action.effort} effort
                </span>
                <span className="rounded-full bg-slate-200 px-2 py-0.5 font-semibold uppercase text-slate-700">
                  {action.owner_area.replace(/_/g, ' ')}
                </span>
                <span className="rounded-full bg-blue-50 px-2 py-0.5 font-semibold uppercase text-blue-700">
                  {MATURITY_IMPLICATION_LABEL[action.maturity_implication]}
                </span>
                {action.evidence.count > 0 ? (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold uppercase text-slate-700">
                    {action.evidence.count} evidence
                  </span>
                ) : null}
              </div>

              {action.expected_outcome ? (
                <p className="mt-3 text-xs text-slate-600">
                  <span className="font-semibold">Expected outcome:</span> {action.expected_outcome}
                </p>
              ) : null}
              {(action.timeline.short || action.timeline.mid || action.timeline.long) ? (
                <div className="mt-3 grid gap-1 text-xs text-slate-600 sm:grid-cols-3">
                  {action.timeline.short ? <span>· {action.timeline.short}</span> : null}
                  {action.timeline.mid ? <span>· {action.timeline.mid}</span> : null}
                  {action.timeline.long ? <span>· {action.timeline.long}</span> : null}
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
