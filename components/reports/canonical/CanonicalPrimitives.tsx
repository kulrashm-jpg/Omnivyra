'use client';

import { ReactNode } from 'react';

// ── Canonical types (mirrors backend/services/canonicalReport/canonicalReportTypes.ts) ──

export type ScoreState = 'measured' | 'inferred' | 'insufficient_signal' | 'unavailable';
export type ConfidenceBand = 'high' | 'medium' | 'low';
export type SystemMaturityClass =
  | 'structurally_weak'
  | 'early_stage'
  | 'building_baseline'
  | 'operational'
  | 'leading';

export type EvidenceTrace = {
  count: number;
  sources: string[];
  freshness: { last_observed_at: string | null; age_hours: number | null };
  observations: Array<{ signal: string; source: string; observed_at: string | null }>;
};

export type CanonicalScore = {
  value: number | null;
  state: ScoreState;
  confidence: ConfidenceBand;
  band: 'foundational' | 'developing' | 'operational' | 'leading' | 'insufficient';
  evidence: EvidenceTrace;
  benchmark: { value: number | null; label: string | null };
};

export type PillarKey = 'foundation' | 'authority' | 'discoverability' | 'trust' | 'momentum';

// ── Visual primitives ─────────────────────────────────────────────────────────

const PILLAR_ACCENT: Record<PillarKey, { ring: string; bg: string; text: string; bar: string }> = {
  foundation: { ring: 'border-sky-200', bg: 'bg-sky-50', text: 'text-sky-800', bar: 'bg-sky-500' },
  authority: { ring: 'border-indigo-200', bg: 'bg-indigo-50', text: 'text-indigo-800', bar: 'bg-indigo-500' },
  discoverability: { ring: 'border-emerald-200', bg: 'bg-emerald-50', text: 'text-emerald-800', bar: 'bg-emerald-500' },
  trust: { ring: 'border-amber-200', bg: 'bg-amber-50', text: 'text-amber-800', bar: 'bg-amber-500' },
  momentum: { ring: 'border-rose-200', bg: 'bg-rose-50', text: 'text-rose-800', bar: 'bg-rose-500' },
};

function bandLabel(band: CanonicalScore['band']): string {
  if (band === 'leading') return 'Leading';
  if (band === 'operational') return 'Operational';
  if (band === 'developing') return 'Developing';
  if (band === 'foundational') return 'Foundational';
  return 'Insufficient signal';
}

function bandClasses(band: CanonicalScore['band']): string {
  if (band === 'leading') return 'bg-emerald-100 text-emerald-800';
  if (band === 'operational') return 'bg-blue-100 text-blue-800';
  if (band === 'developing') return 'bg-amber-100 text-amber-800';
  if (band === 'foundational') return 'bg-rose-100 text-rose-800';
  return 'bg-slate-200 text-slate-700';
}

function confidenceClasses(confidence: ConfidenceBand): string {
  if (confidence === 'high') return 'bg-emerald-100 text-emerald-800 border-emerald-200';
  if (confidence === 'medium') return 'bg-amber-100 text-amber-800 border-amber-200';
  return 'bg-slate-100 text-slate-700 border-slate-200';
}

function maturityLabel(maturity: SystemMaturityClass): string {
  if (maturity === 'leading') return 'Leading';
  if (maturity === 'operational') return 'Operational';
  if (maturity === 'building_baseline') return 'Building Baseline';
  if (maturity === 'early_stage') return 'Early-Stage';
  return 'Structurally Weak';
}

function maturityClasses(maturity: SystemMaturityClass): string {
  if (maturity === 'leading') return 'bg-emerald-100 text-emerald-800 border-emerald-200';
  if (maturity === 'operational') return 'bg-blue-100 text-blue-800 border-blue-200';
  if (maturity === 'building_baseline') return 'bg-amber-100 text-amber-800 border-amber-200';
  if (maturity === 'early_stage') return 'bg-sky-100 text-sky-800 border-sky-200';
  return 'bg-rose-100 text-rose-800 border-rose-200';
}

// <Score> — universal score envelope renderer.
//
// Honors state (renders "—" for insufficient), confidence (visual weight),
// benchmark annotation, and an evidence count badge.
export function Score({
  score,
  size = 'md',
  showBand = true,
  showEvidence = true,
}: {
  score: CanonicalScore;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showBand?: boolean;
  showEvidence?: boolean;
}) {
  const isMissing = score.state === 'insufficient_signal' || score.state === 'unavailable';
  const numberClass =
    size === 'xl' ? 'text-5xl' : size === 'lg' ? 'text-3xl' : size === 'md' ? 'text-xl' : 'text-base';
  const numberWeight = score.confidence === 'high' ? 'font-bold' : score.confidence === 'medium' ? 'font-semibold' : 'font-medium';
  const numberOpacity = isMissing ? 'text-slate-400' : score.confidence === 'low' ? 'text-slate-700' : 'text-slate-900';
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2">
        <span className={`${numberClass} ${numberWeight} ${numberOpacity}`}>
          {isMissing || score.value == null ? '—' : Math.round(score.value)}
        </span>
        {!isMissing && score.value != null ? <span className="text-sm text-slate-500">/100</span> : null}
        {score.benchmark.value != null && !isMissing ? (
          <span className="text-xs text-slate-500">
            (benchmark {score.benchmark.value}{score.benchmark.label ? ` · ${score.benchmark.label}` : ''})
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {showBand ? (
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase ${bandClasses(score.band)}`}>
            {bandLabel(score.band)}
          </span>
        ) : null}
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase ${confidenceClasses(score.confidence)}`}>
          {score.confidence} confidence
        </span>
        {showEvidence && score.evidence.count > 0 ? (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold uppercase text-slate-700">
            {score.evidence.count} evidence
          </span>
        ) : null}
      </div>
    </div>
  );
}

// <MaturityBadge> — canonical maturity-tier indicator used everywhere maturity surfaces.
export function MaturityBadge({ maturity, size = 'md' }: { maturity: SystemMaturityClass; size?: 'sm' | 'md' }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${size === 'sm' ? 'text-[10px]' : 'text-xs'} font-semibold uppercase tracking-wide ${maturityClasses(maturity)}`}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {maturityLabel(maturity)}
    </span>
  );
}

// <EvidenceRow> — atomic evidence unit. Used in the Evidence Trace drawer (Phase 3 UX)
// and inline under any score that supports drill-down.
export function EvidenceRow({
  evidence,
  inline = false,
}: {
  evidence: EvidenceTrace;
  inline?: boolean;
}) {
  if (evidence.count === 0) {
    return (
      <p className={`text-xs text-slate-500 ${inline ? '' : 'mt-2'}`}>
        No evidence observations yet — score reflects insufficient signal.
      </p>
    );
  }
  const sources = evidence.sources.length > 0 ? evidence.sources.join(', ') : 'unspecified sources';
  return (
    <div className={`text-xs text-slate-600 ${inline ? '' : 'mt-2'}`}>
      <span className="font-semibold uppercase tracking-wide text-slate-500">
        {evidence.count} observation{evidence.count === 1 ? '' : 's'}
      </span>
      <span className="ml-2 text-slate-500">· {sources}</span>
    </div>
  );
}

// <TrustEnvelope> — wraps any narrative/recommendation with explicit confidence + evidence
// so a paragraph can never be read without knowing how trustworthy it is.
export function TrustEnvelope({
  narrative,
  children,
}: {
  narrative: { text: string; confidence: ConfidenceBand; evidence: EvidenceTrace; maturity: SystemMaturityClass };
  children?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-sm leading-relaxed text-slate-800">{narrative.text}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase ${confidenceClasses(narrative.confidence)}`}>
          {narrative.confidence} confidence
        </span>
        <MaturityBadge maturity={narrative.maturity} size="sm" />
        {narrative.evidence.count > 0 ? (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold uppercase text-slate-700">
            {narrative.evidence.count} evidence
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

// <PillarCard> — uniform card for the five canonical pillars.
export function PillarCard({
  pillar,
  label,
  purpose,
  score,
  primarySignal,
  dimensions,
}: {
  pillar: PillarKey;
  label: string;
  purpose: string;
  score: CanonicalScore;
  primarySignal: string | null;
  dimensions: Array<{ key: string; label: string; score: CanonicalScore; rationale: string }>;
}) {
  const accent = PILLAR_ACCENT[pillar];
  const isMissing = score.state === 'insufficient_signal' || score.state === 'unavailable';
  return (
    <article className={`rounded-xl border ${accent.ring} ${accent.bg} p-5`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={`text-xs font-semibold uppercase tracking-wide ${accent.text}`}>{label}</p>
          <p className="mt-1 text-xs text-slate-600">{purpose}</p>
        </div>
        <Score score={score} size="lg" showBand showEvidence />
      </div>

      {!isMissing && score.value != null ? (
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/60">
          <div className={`h-full rounded-full ${accent.bar}`} style={{ width: `${Math.max(0, Math.min(100, score.value))}%` }} />
        </div>
      ) : null}

      {primarySignal ? (
        <p className="mt-3 text-xs leading-relaxed text-slate-700">{primarySignal}</p>
      ) : null}

      {dimensions.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {dimensions.map((dim) => {
            const dimMissing = dim.score.state === 'insufficient_signal' || dim.score.state === 'unavailable';
            return (
              <li key={dim.key} className="flex items-center justify-between gap-3 rounded-md bg-white px-3 py-2 text-xs">
                <div className="flex flex-col">
                  <span className="font-semibold text-slate-800">{dim.label}</span>
                  <span className="text-[11px] text-slate-500">{dim.rationale}</span>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${bandClasses(dim.score.band)}`}>
                  {dimMissing ? '—' : `${Math.round(dim.score.value ?? 0)}/100`}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </article>
  );
}
