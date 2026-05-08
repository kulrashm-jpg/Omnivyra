'use client';

import {
  EvidenceRow,
  type ConfidenceBand,
  type EvidenceTrace,
  type PillarKey,
} from './CanonicalPrimitives';

type MaturityStage =
  | 'insufficient_signal'
  | 'foundational'
  | 'emerging'
  | 'developing'
  | 'operational'
  | 'advanced'
  | 'leading';

const STAGE_ORDER: Exclude<MaturityStage, 'insufficient_signal'>[] = [
  'foundational',
  'emerging',
  'developing',
  'operational',
  'advanced',
  'leading',
];

const STAGE_LABEL: Record<MaturityStage, string> = {
  insufficient_signal: 'Insufficient Signal',
  foundational: 'Foundational',
  emerging: 'Emerging',
  developing: 'Developing',
  operational: 'Operational',
  advanced: 'Advanced',
  leading: 'Leading',
};

const STAGE_RANGE: Record<MaturityStage, string> = {
  insufficient_signal: '—',
  foundational: '0–24',
  emerging: '25–39',
  developing: '40–54',
  operational: '55–69',
  advanced: '70–84',
  leading: '85+',
};

const STAGE_TONE: Record<MaturityStage, string> = {
  insufficient_signal: 'bg-slate-100 text-slate-600 border-slate-200',
  foundational: 'bg-rose-100 text-rose-800 border-rose-200',
  emerging: 'bg-amber-100 text-amber-800 border-amber-200',
  developing: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  operational: 'bg-blue-100 text-blue-800 border-blue-200',
  advanced: 'bg-indigo-100 text-indigo-800 border-indigo-200',
  leading: 'bg-emerald-100 text-emerald-800 border-emerald-200',
};

type Props = {
  data: {
    stage: MaturityStage;
    label: string;
    next_stage: string | null;
    why_this_stage: string;
    blocker: { pillar: PillarKey | null; explanation: string };
    unlock: { pillar: PillarKey | null; explanation: string };
    confidence: ConfidenceBand;
    evidence: EvidenceTrace;
  };
};

const PILLAR_LABEL: Record<PillarKey, string> = {
  foundation: 'Foundation',
  authority: 'Authority',
  discoverability: 'Discoverability',
  trust: 'Trust',
  momentum: 'Momentum',
};

/**
 * Canonical 6-stage Authority Maturity Model surface.
 *
 * Renders the maturity ladder with the brand's current stage highlighted and
 * the next stage clearly marked. The "why" / "blocker" / "unlock" trio is the
 * canonical interpretation flow defined in Phase 0's audit.
 */
export default function AuthorityMaturityModel({ data }: Props) {
  const currentIdx = STAGE_ORDER.indexOf(data.stage as Exclude<MaturityStage, 'insufficient_signal'>);
  const nextIdx = currentIdx >= 0 && currentIdx < STAGE_ORDER.length - 1 ? currentIdx + 1 : -1;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Authority Maturity Model</p>
        <h3 className="mt-1 text-xl font-bold text-slate-900">Where the brand sits on the maturity curve</h3>
      </div>

      {/* Maturity ladder */}
      <ol className="mb-5 grid gap-2 sm:grid-cols-6">
        {STAGE_ORDER.map((stage, idx) => {
          const isCurrent = idx === currentIdx;
          const isNext = idx === nextIdx;
          return (
            <li
              key={stage}
              className={`rounded-lg border p-3 text-center ${
                isCurrent
                  ? `${STAGE_TONE[stage]} ring-2 ring-offset-1`
                  : isNext
                    ? `${STAGE_TONE[stage]} opacity-90`
                    : 'border-slate-200 bg-slate-50 text-slate-500 opacity-70'
              }`}
            >
              <p className="text-[10px] font-semibold uppercase tracking-wide">{STAGE_RANGE[stage]}</p>
              <p className="mt-1 text-sm font-bold">{STAGE_LABEL[stage]}</p>
              {isCurrent ? <p className="mt-1 text-[10px] font-semibold uppercase">You are here</p> : null}
              {isNext ? <p className="mt-1 text-[10px] font-semibold uppercase">Next</p> : null}
            </li>
          );
        })}
      </ol>

      {/* Why / Blocker / Unlock */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Why this stage</p>
          <p className="mt-2 text-sm leading-relaxed text-slate-800">{data.why_this_stage}</p>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
            Blocker
            {data.blocker.pillar ? (
              <span className="ml-2 rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-bold">
                {PILLAR_LABEL[data.blocker.pillar]}
              </span>
            ) : null}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-slate-800">{data.blocker.explanation}</p>
        </div>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
            Unlock
            {data.unlock.pillar ? (
              <span className="ml-2 rounded-full bg-emerald-200 px-2 py-0.5 text-[10px] font-bold">
                {PILLAR_LABEL[data.unlock.pillar]}
              </span>
            ) : null}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-slate-800">{data.unlock.explanation}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px]">
        <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold uppercase text-slate-700">
          {data.confidence} confidence
        </span>
        <EvidenceRow evidence={data.evidence} inline />
      </div>
    </section>
  );
}
