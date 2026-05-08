'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { EvidenceTrace, PillarKey } from './CanonicalPrimitives';

// Production evidence-trace UX. Any component (Score, PillarCard, radar axis,
// recommendation card) can call `useEvidenceTrace().open({...})` to surface a
// scoped drawer focused on the evidence behind that specific surface.

export type EvidenceFocus =
  | { kind: 'overall' }
  | { kind: 'pillar'; pillar: PillarKey; label: string }
  | { kind: 'dimension'; dimensionKey: string; label: string }
  | { kind: 'radar_axis'; axisKey: string; label: string }
  | { kind: 'recommendation'; actionId: string; label: string }
  | { kind: 'provider'; providerId: string; label: string }
  | { kind: 'benchmark'; vertical: string }
  | { kind: 'freshness_timeline' };

type EvidenceTraceContextShape = {
  isOpen: boolean;
  focus: EvidenceFocus;
  open: (focus: EvidenceFocus) => void;
  close: () => void;
};

const EvidenceTraceContext = createContext<EvidenceTraceContextShape | null>(null);

export function EvidenceTraceProvider({ children }: { children: ReactNode }) {
  const [focus, setFocus] = useState<EvidenceFocus>({ kind: 'overall' });
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback((next: EvidenceFocus) => {
    setFocus(next);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => setIsOpen(false), []);

  const value = useMemo(() => ({ isOpen, focus, open, close }), [isOpen, focus, open, close]);

  return <EvidenceTraceContext.Provider value={value}>{children}</EvidenceTraceContext.Provider>;
}

export function useEvidenceTrace(): EvidenceTraceContextShape {
  const ctx = useContext(EvidenceTraceContext);
  if (!ctx) {
    // No-op when the provider isn't mounted (e.g., PDF export). This keeps
    // the click-affordance components inert rather than throwing.
    return {
      isOpen: false,
      focus: { kind: 'overall' },
      open: () => undefined,
      close: () => undefined,
    };
  }
  return ctx;
}

// ── Drawer renderer (production grade) ────────────────────────────────────────

type DrawerProps = {
  evidenceByDimension: Record<string, EvidenceTrace | undefined>;
  evidenceByPillar: Partial<Record<PillarKey, EvidenceTrace>>;
  overall: EvidenceTrace;
  recommendationsById?: Record<string, EvidenceTrace>;
  providerEvidenceById?: Record<string, EvidenceTrace>;
};

const PILLAR_LABEL: Record<PillarKey, string> = {
  foundation: 'Foundation',
  authority: 'Authority',
  discoverability: 'Discoverability',
  trust: 'Trust',
  momentum: 'Momentum',
};

export function ProductionEvidenceDrawer(props: DrawerProps) {
  const { isOpen, focus, close } = useEvidenceTrace();

  if (!isOpen) return null;

  const trace = resolveFocusedEvidence(focus, props);
  const title = describeFocus(focus);

  return (
    <div
      className="fixed inset-0 z-50 flex"
      role="dialog"
      aria-modal="true"
      onKeyDown={(e) => {
        if (e.key === 'Escape') close();
      }}
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close evidence drawer"
        className="flex-1 bg-slate-900/40 backdrop-blur-sm"
        onClick={close}
      />
      {/* Panel */}
      <aside className="flex h-full w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 p-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Evidence Trace</p>
            <h2 className="mt-1 text-base font-bold text-slate-900">{title}</h2>
          </div>
          <button
            type="button"
            onClick={close}
            className="rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Close
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5">
          {trace ? (
            <EvidenceContent trace={trace} />
          ) : (
            <p className="text-sm text-slate-500">No evidence is recorded for this focus yet.</p>
          )}
        </div>
      </aside>
    </div>
  );
}

function resolveFocusedEvidence(focus: EvidenceFocus, props: DrawerProps): EvidenceTrace | null {
  if (focus.kind === 'overall') return props.overall;
  if (focus.kind === 'pillar') return props.evidenceByPillar[focus.pillar] ?? null;
  if (focus.kind === 'dimension' || focus.kind === 'radar_axis') {
    const key = focus.kind === 'dimension' ? focus.dimensionKey : focus.axisKey;
    return props.evidenceByDimension[key] ?? null;
  }
  if (focus.kind === 'recommendation' && props.recommendationsById) {
    return props.recommendationsById[focus.actionId] ?? null;
  }
  if (focus.kind === 'provider' && props.providerEvidenceById) {
    return props.providerEvidenceById[focus.providerId] ?? null;
  }
  return props.overall;
}

function describeFocus(focus: EvidenceFocus): string {
  if (focus.kind === 'overall') return 'Overall authority';
  if (focus.kind === 'pillar') return `${focus.label} pillar`;
  if (focus.kind === 'dimension') return `${focus.label} dimension`;
  if (focus.kind === 'radar_axis') return `${focus.label} (radar axis)`;
  if (focus.kind === 'recommendation') return `Recommendation: ${focus.label}`;
  if (focus.kind === 'provider') return `Provider: ${focus.label}`;
  if (focus.kind === 'benchmark') return `Benchmark: ${focus.vertical}`;
  return 'Freshness timeline';
}

function EvidenceContent({ trace }: { trace: EvidenceTrace }) {
  if (trace.count === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
        No observations have been recorded for this focus yet.
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-700">
        <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold uppercase">
          {trace.count} observation{trace.count === 1 ? '' : 's'}
        </span>
        {trace.sources.map((source) => (
          <span key={source} className="rounded-full bg-blue-50 px-2 py-0.5 font-semibold uppercase text-blue-700">
            {source.replace(/_/g, ' ')}
          </span>
        ))}
      </div>
      {trace.freshness.last_observed_at ? (
        <p className="text-xs text-slate-500">
          Last observed {new Date(trace.freshness.last_observed_at).toLocaleString()}
          {trace.freshness.age_hours != null ? ` · ${trace.freshness.age_hours}h ago` : ''}
        </p>
      ) : null}

      {/* Freshness timeline */}
      <FreshnessTimeline trace={trace} />

      <ol className="space-y-2 text-xs text-slate-700">
        {trace.observations.map((obs, idx) => (
          <li key={`${obs.signal}-${idx}`} className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
            <span className="mt-0.5 rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-700">
              {obs.source.replace(/_/g, ' ')}
            </span>
            <span className="flex-1 break-all">{obs.signal}</span>
            {obs.observed_at ? (
              <span className="text-slate-500">{new Date(obs.observed_at).toLocaleDateString()}</span>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

function FreshnessTimeline({ trace }: { trace: EvidenceTrace }) {
  const observationsWithDates = trace.observations.filter((o) => o.observed_at);
  if (observationsWithDates.length === 0) return null;
  const dates = observationsWithDates.map((o) => new Date(o.observed_at!).getTime());
  const min = Math.min(...dates);
  const max = Math.max(...dates);
  const span = Math.max(1, max - min);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Freshness timeline</p>
      <div className="relative h-2 rounded-full bg-slate-100">
        {dates.map((date, idx) => {
          const ratio = (date - min) / span;
          return (
            <span
              key={`${date}-${idx}`}
              className="absolute -mt-0.5 h-3 w-3 -translate-x-1/2 rounded-full border border-blue-700 bg-blue-500"
              style={{ left: `${ratio * 100}%` }}
              title={new Date(date).toLocaleString()}
            />
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-slate-500">
        <span>{new Date(min).toLocaleDateString()}</span>
        <span>{new Date(max).toLocaleDateString()}</span>
      </div>
    </div>
  );
}

// ── Click-through affordance ──────────────────────────────────────────────────
//
// A tiny inline button that any score-bearing surface wraps to make the
// evidence drawer one click away.

export function EvidenceLink({
  focus,
  children,
  className,
}: {
  focus: EvidenceFocus;
  children: ReactNode;
  className?: string;
}) {
  const { open } = useEvidenceTrace();
  return (
    <button
      type="button"
      onClick={() => open(focus)}
      className={`inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700 hover:bg-slate-50 ${className ?? ''}`}
    >
      {children}
    </button>
  );
}
