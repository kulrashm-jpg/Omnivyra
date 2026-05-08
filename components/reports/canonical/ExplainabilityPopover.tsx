'use client';

import { useState, type ReactNode } from 'react';

type Factor = {
  kind: 'evidence' | 'method' | 'limitation' | 'confidence' | 'override' | 'comparison';
  label: string;
  detail: string;
  weight: number | null;
};

export type Explanation = {
  headline: string;
  method_summary: string;
  factors: Factor[];
  limitations: string[];
  confidence: 'high' | 'medium' | 'low';
  evidence: { count: number; sources: string[] };
};

const FACTOR_TONE: Record<Factor['kind'], string> = {
  evidence: 'bg-blue-50 text-blue-800',
  method: 'bg-slate-100 text-slate-700',
  limitation: 'bg-amber-50 text-amber-800',
  confidence: 'bg-violet-50 text-violet-800',
  override: 'bg-rose-50 text-rose-800',
  comparison: 'bg-emerald-50 text-emerald-800',
};

const CONFIDENCE_TONE: Record<Explanation['confidence'], string> = {
  high: 'bg-emerald-100 text-emerald-800',
  medium: 'bg-amber-100 text-amber-800',
  low: 'bg-slate-200 text-slate-700',
};

/**
 * Inline "Why this?" affordance. The button toggles a focused popover that
 * renders the structured Explanation: headline → method → factors →
 * limitations. Used by every score / pillar / recommendation surface.
 */
export default function ExplainabilityPopover({
  label,
  explanation,
  children,
}: {
  label?: string;
  explanation: Explanation;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className="inline-flex relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700 hover:bg-slate-50"
        aria-expanded={open}
      >
        {children ?? <span aria-hidden>Why?</span>}
        {label ? <span className="text-slate-400">{label}</span> : null}
      </button>
      {open ? (
        <div
          role="dialog"
          className="absolute left-0 top-full z-30 mt-2 w-[min(380px,80vw)] rounded-xl border border-slate-200 bg-white p-4 text-left shadow-xl"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-bold text-slate-900">{explanation.headline}</p>
            <button
              type="button"
              aria-label="Close"
              onClick={() => setOpen(false)}
              className="rounded-md border border-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-50"
            >
              Close
            </button>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-600">{explanation.method_summary}</p>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px]">
            <span className={`rounded-full px-2 py-0.5 font-semibold uppercase ${CONFIDENCE_TONE[explanation.confidence]}`}>
              {explanation.confidence} confidence
            </span>
            {explanation.evidence.count > 0 ? (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold uppercase text-slate-700">
                {explanation.evidence.count} evidence · {explanation.evidence.sources.join(', ')}
              </span>
            ) : (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold uppercase text-slate-600">
                No evidence yet
              </span>
            )}
          </div>

          {explanation.factors.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {explanation.factors.map((factor, idx) => (
                <li key={`${factor.kind}-${idx}`} className="rounded-md border border-slate-200 bg-white p-2">
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${FACTOR_TONE[factor.kind]}`}>
                      {factor.kind}
                    </span>
                    <span className="text-xs font-semibold text-slate-800">{factor.label}</span>
                    {factor.weight != null ? (
                      <span className="ml-auto text-[10px] text-slate-500">w {Math.round(factor.weight * 100)}%</span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-[11px] text-slate-600">{factor.detail}</p>
                </li>
              ))}
            </ul>
          ) : null}

          {explanation.limitations.length > 0 ? (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-800">Limitations</p>
              <ul className="mt-1 list-disc pl-4 text-[11px] text-amber-900 space-y-0.5">
                {explanation.limitations.map((line, idx) => (
                  <li key={idx}>{line}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </span>
  );
}
