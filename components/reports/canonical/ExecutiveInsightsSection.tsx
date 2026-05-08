'use client';

import { TrustEnvelope, type ConfidenceBand, type EvidenceTrace, type SystemMaturityClass } from './CanonicalPrimitives';

type CanonicalNarrative = {
  text: string;
  confidence: ConfidenceBand;
  evidence: EvidenceTrace;
  maturity: SystemMaturityClass;
};

type Props = {
  data: {
    headline_thesis: CanonicalNarrative;
    primary_constraint: CanonicalNarrative;
    next_unlock: CanonicalNarrative;
    strategic_opportunity: CanonicalNarrative;
    authority_risk: CanonicalNarrative;
    momentum_interpretation: CanonicalNarrative;
  };
};

const CARD_DEFINITIONS: Array<{
  key: keyof Props['data'];
  label: string;
  accent: string;
}> = [
  { key: 'headline_thesis', label: 'Headline Thesis', accent: 'border-indigo-200 bg-indigo-50' },
  { key: 'primary_constraint', label: 'Primary Constraint', accent: 'border-amber-200 bg-amber-50' },
  { key: 'next_unlock', label: 'Next Unlock', accent: 'border-emerald-200 bg-emerald-50' },
  { key: 'strategic_opportunity', label: 'Strategic Opportunity', accent: 'border-blue-200 bg-blue-50' },
  { key: 'authority_risk', label: 'Authority Risk', accent: 'border-rose-200 bg-rose-50' },
  { key: 'momentum_interpretation', label: 'Momentum', accent: 'border-violet-200 bg-violet-50' },
];

/**
 * Executive Insights section — the six canonical artifacts that the Executive
 * Insight Engine produces. Renders above the radar so the brief reads
 * top-down: thesis → constraint → unlock → opportunity → risk → momentum.
 */
export default function ExecutiveInsightsSection({ data }: Props) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Executive Insights</p>
        <h3 className="mt-1 text-xl font-bold text-slate-900">Six artifacts. One read.</h3>
        <p className="mt-2 text-sm text-slate-600">
          Strategic interpretation grounded in measured pillar, action, and trajectory data — every
          insight cites the evidence that produced it.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {CARD_DEFINITIONS.map((card) => {
          const narrative = data[card.key];
          return (
            <div key={card.key} className={`rounded-xl border ${card.accent} p-4`}>
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-700">{card.label}</p>
              <p className="mt-2 text-sm leading-relaxed text-slate-900">{narrative.text}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-slate-600">
                <span className="rounded-full bg-white/60 px-2 py-0.5 font-semibold uppercase">
                  {narrative.confidence}
                </span>
                {narrative.evidence.count > 0 ? (
                  <span className="rounded-full bg-white/60 px-2 py-0.5 font-semibold uppercase">
                    {narrative.evidence.count} evidence
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
