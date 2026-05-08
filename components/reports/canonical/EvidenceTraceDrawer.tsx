'use client';

import { useState } from 'react';
import type { EvidenceTrace, PillarKey } from './CanonicalPrimitives';

const PILLAR_LABEL: Record<PillarKey, string> = {
  foundation: 'Foundation',
  authority: 'Authority',
  discoverability: 'Discoverability',
  trust: 'Trust',
  momentum: 'Momentum',
};

type Props = {
  evidenceByDimension: Record<string, EvidenceTrace | undefined>;
  evidenceByPillar: Partial<Record<PillarKey, EvidenceTrace>>;
  overall: EvidenceTrace;
};

/**
 * Canonical Evidence Trace surface.
 *
 * Every score, recommendation, and narrative in the canonical report has an
 * evidence trace attached. This component is the auditable surface — readers
 * can drill from "where did this number come from" to the underlying signal
 * names, sources, and observation timestamps.
 *
 * Phase 3 ships the architecture and the inline drawer. Per-score click-through
 * affordance lands in Phase 4.
 */
export default function EvidenceTraceDrawer({ evidenceByDimension, evidenceByPillar, overall }: Props) {
  const [open, setOpen] = useState(false);

  const dimensionEntries = Object.entries(evidenceByDimension).filter(
    ([, evidence]) => evidence != null,
  ) as Array<[string, EvidenceTrace]>;
  const pillarEntries = (Object.keys(evidenceByPillar) as PillarKey[])
    .map((key) => [key, evidenceByPillar[key]] as const)
    .filter((entry): entry is [PillarKey, EvidenceTrace] => entry[1] != null);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Evidence Trace</p>
          <h3 className="mt-1 text-xl font-bold text-slate-900">Auditable evidence behind every score</h3>
          <p className="mt-2 text-sm text-slate-600">
            Every number in this report traces to its source. Open the drawer to see signal names,
            sources, and observation timestamps per pillar and per dimension.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          {open ? 'Close drawer' : `Open drawer (${overall.count} observation${overall.count === 1 ? '' : 's'})`}
        </button>
      </div>

      {open ? (
        <div className="mt-5 space-y-5">
          {/* Overall */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Overall</p>
            <EvidenceTable evidence={overall} />
          </div>

          {/* By pillar */}
          {pillarEntries.length > 0 ? (
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">By pillar</p>
              {pillarEntries.map(([pillar, evidence]) => (
                <div key={pillar} className="rounded-lg border border-slate-200 bg-white p-4">
                  <p className="text-sm font-semibold text-slate-800">{PILLAR_LABEL[pillar]}</p>
                  <EvidenceTable evidence={evidence} />
                </div>
              ))}
            </div>
          ) : null}

          {/* By dimension */}
          {dimensionEntries.length > 0 ? (
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">By dimension</p>
              {dimensionEntries.map(([dimension, evidence]) => (
                <div key={dimension} className="rounded-lg border border-slate-200 bg-white p-4">
                  <p className="text-sm font-semibold text-slate-800">
                    {dimension.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                  </p>
                  <EvidenceTable evidence={evidence} />
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function EvidenceTable({ evidence }: { evidence: EvidenceTrace }) {
  if (evidence.count === 0) {
    return <p className="mt-2 text-xs text-slate-500">No observations yet.</p>;
  }
  return (
    <div className="mt-3">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
        <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold uppercase">
          {evidence.count} observation{evidence.count === 1 ? '' : 's'}
        </span>
        {evidence.sources.map((source) => (
          <span key={source} className="rounded-full bg-blue-50 px-2 py-0.5 font-semibold uppercase text-blue-700">
            {source.replace(/_/g, ' ')}
          </span>
        ))}
        {evidence.freshness.last_observed_at ? (
          <span className="text-slate-500">
            last seen {new Date(evidence.freshness.last_observed_at).toLocaleString()}
          </span>
        ) : null}
      </div>
      <ol className="space-y-1 text-[11px] text-slate-600">
        {evidence.observations.slice(0, 12).map((obs, idx) => (
          <li key={`${obs.signal}-${idx}`} className="flex items-start gap-2">
            <span className="mt-0.5 rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-700">
              {obs.source.replace(/_/g, ' ')}
            </span>
            <span className="flex-1 break-all">{obs.signal}</span>
            {obs.observed_at ? (
              <span className="text-slate-400">{new Date(obs.observed_at).toLocaleDateString()}</span>
            ) : null}
          </li>
        ))}
        {evidence.observations.length > 12 ? (
          <li className="pl-1 text-slate-400">+{evidence.observations.length - 12} more observations…</li>
        ) : null}
      </ol>
    </div>
  );
}
