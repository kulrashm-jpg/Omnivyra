'use client';

import { useState } from 'react';

type ActiveOverride = {
  id: string;
  kind: string;
  target_summary: string;
  reason: string;
  created_at: string;
  created_by: { id: string; kind: string; label: string };
};

const KIND_LABEL: Record<string, string> = {
  benchmark_band: 'Benchmark band override',
  vertical_classification: 'Vertical override',
  company_size_band: 'Size band override',
  provider_exclusion: 'Provider exclusion',
  evidence_suppression: 'Evidence suppression',
  recommendation_dismissal: 'Recommendation dismissed',
  analyst_note: 'Analyst note',
};

/**
 * Override summary banner.
 *
 * Renders at the top of the report when one or more active analyst overrides
 * are in effect. Phase 6 mandates that a reader always knows whether they're
 * looking at measured intelligence or analyst override — this badge is the
 * canonical surface that distinguishes them.
 */
export default function OverrideBadge({ overrides }: { overrides: ActiveOverride[] }) {
  const [open, setOpen] = useState(false);
  if (overrides.length === 0) return null;

  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide">Analyst overrides active</p>
          <p className="mt-1 text-sm">
            {overrides.length} active override{overrides.length === 1 ? '' : 's'} are influencing this report. Measured intelligence is overlaid by analyst decisions.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((p) => !p)}
          className="rounded-md border border-amber-400 bg-white px-3 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100"
        >
          {open ? 'Hide list' : 'Show overrides'}
        </button>
      </div>
      {open ? (
        <ul className="mt-3 space-y-2">
          {overrides.map((o) => (
            <li key={o.id} className="rounded-md border border-amber-200 bg-white p-3 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-800">
                  {KIND_LABEL[o.kind] ?? o.kind}
                </span>
                <span className="text-slate-600">by {o.created_by.label}</span>
                <span className="text-slate-500">· {new Date(o.created_at).toLocaleDateString()}</span>
              </div>
              <p className="mt-1.5 text-amber-900">{o.reason}</p>
              <p className="mt-1 font-mono text-[10px] text-amber-800/70 break-all">{o.target_summary}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
