/** Part 2/3 of MarketPulseTabV2.tsx — verbatim split (barrel preserved; importers unchanged). */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { OpportunityTabProps } from './types';
import { RefreshCw, Radar, ShieldAlert, Sparkles } from 'lucide-react';
import EngineJobStatusPanel from '../../engines/EngineJobStatusPanel';

import { MARKET_PULSE_CATEGORIES, FOCUSED_MARKET_PULSE_CATEGORIES, EXPANDED_MARKET_PULSE_FALLBACK_CATEGORIES, type ContextResponse, type MarketPulseFinding, type MomentumOverview, type CategoryAcceleration, type CompetitorPressure, type EscalationTimeline, type PropagationMap, type TrendPersistence, type MarketDeltaSummary, type RunResponse, type SignalSignificance, type MarketDimension, type AttentionFilter, MARKET_DIMENSIONS, ATTENTION_FILTERS, findingMatchesDimension, deriveSignalSignificance, sortBySignalAttention, compactTakeaway, buildMarketNarratives, SignalExplainability, MOVEMENT_DIRECTION_STYLE, MOVEMENT_MOMENTUM_STYLE, SIGNIFICANCE_STYLE } from './MarketPulseTabV2Model';

function SignificancePill({ significance }: { significance: SignalSignificance }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${SIGNIFICANCE_STYLE[significance]}`}>
      {significance}
    </span>
  );
}

export function SignificanceBadge({ finding }: { finding: MarketPulseFinding }) {
  const significance = deriveSignalSignificance(finding);
  return <SignificancePill significance={significance} />;
}

export function SignalMovement({ finding }: { finding: MarketPulseFinding }) {
  const movement = finding.movement_summary;
  if (!movement) return null;
  const changes = movement.changes?.length
    ? movement.changes
    : movement.first_observation
      ? ['First observation.']
      : [];

  return (
    <div className="mt-2 rounded-lg border border-slate-100 bg-white/80 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center rounded-full border px-2.5 py-1 font-semibold ${MOVEMENT_DIRECTION_STYLE[movement.direction]}`}>
          {movement.direction}
        </span>
        <span className={`inline-flex items-center rounded-full px-2.5 py-1 font-semibold ${MOVEMENT_MOMENTUM_STYLE[movement.momentum]}`}>
          Momentum: {movement.momentum}
        </span>
      </div>
      {changes.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-slate-600">
          <span className="font-semibold text-slate-700">What changed:</span>
          {changes.map((change) => (
            <span key={change}>{change}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export function ExecutiveScanStrip({ findings }: { findings: MarketPulseFinding[] }) {
  const ranked = sortBySignalAttention(findings);
  const snapshot = ranked.reduce(
    (acc, finding) => {
      const significance = deriveSignalSignificance(finding);
      const direction = finding.movement_summary?.direction;
      if (significance === 'Critical') acc.critical += 1;
      if (significance === 'Important') acc.important += 1;
      if (direction === 'Growing' || direction === 'Accelerating') acc.growing += 1;
      if (direction === 'Emerging') acc.emerging += 1;
      if (direction === 'Declining') acc.declining += 1;
      return acc;
    },
    { critical: 0, important: 0, growing: 0, emerging: 0, declining: 0 },
  );
  const topDevelopments = ranked.slice(0, 3);

  if (ranked.length === 0) return null;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.35fr)]">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Market snapshot</div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5 lg:grid-cols-2">
            {[
              ['Critical', snapshot.critical, 'text-rose-700'],
              ['Important', snapshot.important, 'text-amber-700'],
              ['Growing', snapshot.growing, 'text-emerald-700'],
              ['Emerging', snapshot.emerging, 'text-blue-700'],
              ['Declining', snapshot.declining, 'text-slate-700'],
            ].map(([label, value, color]) => (
              <div key={label} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                <div className={`text-lg font-bold ${color}`}>{value}</div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Top developments</div>
          <div className="mt-3 space-y-2">
            {topDevelopments.map((finding) => {
              const significance = deriveSignalSignificance(finding);
              const direction = finding.movement_summary?.direction ?? 'Stable';
              return (
                <div key={finding.id} className="rounded-lg border border-slate-100 bg-white px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <SignificanceBadge finding={finding} />
                    <span className="text-[11px] font-semibold text-slate-500">{direction}</span>
                    <span className="text-sm font-semibold text-slate-900">{finding.title}</span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-slate-600">{compactTakeaway(finding)}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

const MARKET_DIRECTION_STYLE: Record<MarketDeltaSummary['market_direction'], string> = {
  Expanding: 'bg-emerald-50 text-emerald-800 border-emerald-100',
  Stable: 'bg-slate-50 text-slate-700 border-slate-200',
  Shifting: 'bg-blue-50 text-blue-800 border-blue-100',
  Volatile: 'bg-rose-50 text-rose-800 border-rose-100',
};

function DeltaSignalList({
  title,
  items,
  tone,
}: {
  title: string;
  items: MarketDeltaSummary['new_signals'];
  tone: string;
}) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{title}</div>
        <div className={`text-sm font-bold ${tone}`}>{items.length}</div>
      </div>
      {items.length > 0 && (
        <ul className="mt-1.5 space-y-1 text-xs text-slate-700">
          {items.slice(0, 3).map((item, index) => (
            <li key={item.id ?? item.canonical_event_key ?? `${title}-${index}`} className="truncate">
              {item.title}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SinceLastPulseStrip({ delta }: { delta: MarketDeltaSummary | null | undefined }) {
  if (!delta) return null;

  if (delta.baseline) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Since last pulse</div>
        <p className="mt-2 text-sm font-medium text-slate-800">Baseline pulse established. Future runs will show market change.</p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Since last pulse</div>
          <div className="mt-1 text-sm font-semibold text-slate-950">Market change summary</div>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wide ${MARKET_DIRECTION_STYLE[delta.market_direction]}`}>
          {delta.market_direction}
        </span>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-4">
        <DeltaSignalList title="New signals" items={delta.new_signals} tone="text-blue-700" />
        <DeltaSignalList title="Strengthening" items={delta.strengthening_signals} tone="text-emerald-700" />
        <DeltaSignalList title="Weakening" items={delta.weakening_signals} tone="text-amber-700" />
        <DeltaSignalList title="Retired" items={delta.retired_signals} tone="text-slate-600" />
      </div>
    </section>
  );
}

export function filterDeltaSummary(delta: MarketDeltaSummary | null | undefined, dimension: MarketDimension): MarketDeltaSummary | null | undefined {
  if (!delta || delta.baseline || dimension === 'all') return delta;

  const matches = (item: MarketDeltaSummary['new_signals'][number]) => {
    return findingMatchesDimension(
      {
        category: item.category ?? '',
        title: item.title,
        summary: '',
        regions: [],
        cluster_role: null,
        alert_class: null,
      },
      dimension,
    );
  };
  const newSignals = delta.new_signals.filter(matches);
  const strengtheningSignals = delta.strengthening_signals.filter(matches);
  const weakeningSignals = delta.weakening_signals.filter(matches);
  const retiredSignals = delta.retired_signals.filter(matches);
  const expansionPressure = newSignals.length + strengtheningSignals.length;
  const contractionPressure = weakeningSignals.length + retiredSignals.length;
  const marketDirection: MarketDeltaSummary['market_direction'] =
    expansionPressure > 0 && contractionPressure > 0
      ? 'Volatile'
      : expansionPressure > contractionPressure
        ? 'Expanding'
        : contractionPressure > expansionPressure
          ? 'Shifting'
          : 'Stable';

  return {
    ...delta,
    market_direction: marketDirection,
    new_signals: newSignals,
    strengthening_signals: strengtheningSignals,
    weakening_signals: weakeningSignals,
    retired_signals: retiredSignals,
  };
}

export function DimensionFilters({
  activeDimension,
  counts,
  onChange,
}: {
  activeDimension: MarketDimension;
  counts: Record<MarketDimension, number>;
  onChange: (dimension: MarketDimension) => void;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Market dimensions</div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {MARKET_DIMENSIONS.map((dimension) => {
          const active = activeDimension === dimension.id;
          return (
            <button
              key={dimension.id}
              type="button"
              onClick={() => onChange(dimension.id)}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                active
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
              }`}
            >
              {dimension.label} ({counts[dimension.id] ?? 0})
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function AttentionFilters({
  activeFilter,
  counts,
  onChange,
}: {
  activeFilter: AttentionFilter;
  counts: Record<AttentionFilter, number>;
  onChange: (filter: AttentionFilter) => void;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Attention</div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {ATTENTION_FILTERS.map((filter) => {
          const active = activeFilter === filter.id;
          return (
            <button
              key={filter.id}
              type="button"
              onClick={() => onChange(filter.id)}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                active
                  ? 'border-indigo-700 bg-indigo-700 text-white'
                  : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
              }`}
            >
              {filter.label} ({counts[filter.id] ?? 0})
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function MarketNarrativesSection({ findings }: { findings: MarketPulseFinding[] }) {
  const narratives = buildMarketNarratives(findings);
  if (narratives.length === 0) return null;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Market narratives</div>
          <h4 className="mt-1 text-base font-semibold text-slate-950">Broader movements across signals</h4>
        </div>
        <span className="text-xs text-slate-500">{narratives.length} connected stor{narratives.length === 1 ? 'y' : 'ies'}</span>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {narratives.map((narrative) => (
          <article key={narrative.id} className="rounded-xl border border-slate-100 bg-slate-50/70 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <SignificancePill significance={narrative.significance} />
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${MOVEMENT_DIRECTION_STYLE[narrative.direction]}`}>
                {narrative.direction}
              </span>
            </div>
            <h5 className="mt-2 text-sm font-bold text-slate-950">{narrative.title}</h5>
            <div className="mt-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Supporting findings</div>
              <ul className="mt-1.5 space-y-1 text-xs text-slate-700">
                {narrative.supportingFindings.slice(0, 4).map((finding) => (
                  <li key={finding.id} className="flex gap-2">
                    <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-400" />
                    <span>{finding.title}</span>
                  </li>
                ))}
              </ul>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-700">{narrative.summary}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

export type MarketPulseLoadError = Error & {
  status?: number;
};

export const OBJECTIVES = [
  { value: 'growth', label: 'Growth' },
  { value: 'expansion', label: 'Expansion' },
  { value: 'hiring', label: 'Hiring' },
  { value: 'partnerships', label: 'Partnerships' },
  { value: 'product', label: 'Product' },
  { value: 'risk', label: 'Risk' },
] as const;

export function toTitle(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

export function buildResolvedRegionPreview(
  context: ContextResponse | null,
  scope: 'profile_markets' | 'expansion_markets' | 'all_defaults' | 'custom',
  customRegions: string,
) {
  if (!context) return [];
  const trimmedCustomRegions = customRegions.split(',').map((item) => item.trim()).filter(Boolean);
  const profileMarkets = context.marketPulseProfile.primary_operating_markets ?? [];
  const expansionMarkets = context.marketPulseProfile.target_expansion_markets ?? [];
  const preferredRegions = context.marketPulseProfile.preferred_regions ?? [];
  const geographyList = context.profile.geography_list ?? [];
  const geography = context.profile.geography ? [context.profile.geography] : [];

  const resolved = scope === 'custom'
    ? trimmedCustomRegions
    : scope === 'expansion_markets'
      ? (expansionMarkets.length ? expansionMarkets : preferredRegions)
      : scope === 'all_defaults'
        ? [...profileMarkets, ...expansionMarkets, ...preferredRegions]
        : profileMarkets.length
          ? profileMarkets
          : preferredRegions.length
            ? preferredRegions
            : geographyList.length
              ? geographyList
              : geography;

  return Array.from(new Set(resolved)).filter(Boolean);
}

export function buildFocusedCategoryDefaults(context: ContextResponse | null): string[] {
  const profileDefaults = context?.marketPulseProfile.default_categories ?? [];
  const preferred = FOCUSED_MARKET_PULSE_CATEGORIES.find((category) => profileDefaults.includes(category));
  return [preferred ?? FOCUSED_MARKET_PULSE_CATEGORIES[0]];
}

export function buildExpandedCategoryDefaults(context: ContextResponse | null): string[] {
  const profileDefaults = (context?.marketPulseProfile.default_categories ?? [])
    .filter((category) => MARKET_PULSE_CATEGORIES.includes(category));
  const categories = profileDefaults.length > 0 ? profileDefaults : EXPANDED_MARKET_PULSE_FALLBACK_CATEGORIES;
  return Array.from(new Set(categories)).filter((category) => MARKET_PULSE_CATEGORIES.includes(category));
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1B: tier-grouped feed with per-finding action rail.
// P0 dominant (rose ring + larger card + interruptive title), P1 visible
// (amber accent), P2 compact (collapsed by default with expand toggle).
// ─────────────────────────────────────────────────────────────────────────────
type FeedSectionProps = {
  tieredFindings: {
    P0: MarketPulseFinding[];
    P1: MarketPulseFinding[];
    P2: MarketPulseFinding[];
    hidden: number;
  };
  actioningFindingId: string | null;
  findingStateOverrides: Record<string, MarketPulseFinding['user_action_state']>;
  performFindingAction: (
    finding: MarketPulseFinding,
    actionType: 'resolve' | 'reopen' | 'snooze' | 'escalate' | 'promote' | 'share' | 'generate',
    payload?: Record<string, unknown>,
  ) => Promise<void>;
};

const ALERT_CLASS_LABEL: Record<NonNullable<MarketPulseFinding['alert_class']>, { label: string; color: string }> = {
  strategic_risk:        { label: 'Strategic risk',        color: 'bg-rose-100 text-rose-800' },
  competitor_escalation: { label: 'Competitor escalation', color: 'bg-purple-100 text-purple-800' },
  regulatory_exposure:   { label: 'Regulatory exposure',   color: 'bg-orange-100 text-orange-800' },
  market_acceleration:   { label: 'Market acceleration',   color: 'bg-emerald-100 text-emerald-800' },
  opportunity_breakout:  { label: 'Opportunity breakout',  color: 'bg-teal-100 text-teal-800' },
};

const CLUSTER_ROLE_LABEL: Record<NonNullable<MarketPulseFinding['cluster_role']>, string> = {
  isolated:                       'Isolated',
  repeated:                       'Recurring',
  market_wide:                    'Market-wide',
  localized_anomaly:              'Localized anomaly',
  emerging_market_shift:          'Emerging shift',
  coordinated_competitor_movement:'Coordinated competitor move',
};

function FindingCard({
  finding,
  tier,
  onAction,
  loading,
  stateOverride,
}: {
  finding: MarketPulseFinding;
  tier: 'P0' | 'P1' | 'P2';
  onAction: FeedSectionProps['performFindingAction'];
  loading: boolean;
  stateOverride: MarketPulseFinding['user_action_state'];
}) {
  const ringClass =
    tier === 'P0' ? 'border-rose-300 ring-2 ring-rose-200/60 shadow-sm'
    : tier === 'P1' ? 'border-amber-200'
    : 'border-gray-200';
  const tierBadge =
    tier === 'P0' ? 'bg-rose-600 text-white'
    : tier === 'P1' ? 'bg-amber-500 text-white'
    : 'bg-gray-200 text-gray-700';
  const titleClass = tier === 'P0' ? 'text-base font-bold' : tier === 'P1' ? 'text-sm font-semibold' : 'text-sm font-medium';
  const padding = tier === 'P0' ? 'p-5' : tier === 'P1' ? 'p-4' : 'p-3';
  const stateLabel = stateOverride ?? finding.user_action_state ?? 'open';

  const confidenceColor = finding.confidence_score >= 75 ? 'text-emerald-700' : finding.confidence_score >= 50 ? 'text-amber-700' : 'text-gray-500';
  const evidenceColor = (finding.evidence_strength ?? 0) >= 0.7 ? 'text-emerald-700' : (finding.evidence_strength ?? 0) >= 0.5 ? 'text-amber-700' : 'text-gray-500';
  const changeBadge = finding.change_status === 'new' ? 'bg-blue-100 text-blue-800'
    : finding.change_status === 'updated' ? 'bg-amber-100 text-amber-800'
    : finding.change_status === 'resolved' ? 'bg-emerald-100 text-emerald-800'
    : 'bg-gray-100 text-gray-600';

  return (
    <div className={`rounded-xl border ${ringClass} bg-white ${padding}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded px-2 py-0.5 text-[11px] font-bold tracking-wide ${tierBadge}`}>{tier}</span>
          <span className={`text-gray-900 ${titleClass}`}>{finding.title}</span>
          <SignificanceBadge finding={finding} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {finding.alert_class && ALERT_CLASS_LABEL[finding.alert_class] && (
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${ALERT_CLASS_LABEL[finding.alert_class].color}`}>
              {ALERT_CLASS_LABEL[finding.alert_class].label}
            </span>
          )}
          {finding.cluster_role && (
            <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700">
              {CLUSTER_ROLE_LABEL[finding.cluster_role]}
            </span>
          )}
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600">{finding.category.replace(/_/g, ' ')}</span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] ${changeBadge}`}>{finding.change_status}</span>
        </div>
      </div>

      <SignalMovement finding={finding} />

      {/* Phase 1B interpretation block — replaces the legacy "summary + why_it_matters" pair when present. */}
      {finding.interpretation_text ? (
        <p className="mt-2 text-sm text-gray-800 leading-relaxed">{finding.interpretation_text}</p>
      ) : (
        <p className="mt-2 text-sm text-gray-600">{finding.summary}</p>
      )}

      {finding.strategic_implication && (
        <p className="mt-2 text-sm text-gray-700"><span className="font-semibold text-gray-900">Strategic implication:</span> {finding.strategic_implication}</p>
      )}
      {finding.urgency_reason && (
        <p className="mt-1 text-sm text-gray-700"><span className="font-semibold text-rose-700">Urgency:</span> {finding.urgency_reason}</p>
      )}
      {finding.opportunity_window && (
        <p className="mt-1 text-sm text-gray-700"><span className="font-semibold text-amber-700">Window:</span> {finding.opportunity_window}</p>
      )}
      {finding.operational_impact && (
        <p className="mt-1 text-sm text-gray-700"><span className="font-semibold text-gray-900">Owner:</span> {finding.operational_impact}</p>
      )}
      {finding.affected_business_areas && finding.affected_business_areas.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">Affects</span>
          {finding.affected_business_areas.map((area) => (
            <span key={area} className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-700">{area}</span>
          ))}
        </div>
      )}

      <SignalExplainability finding={finding} />

      {/* Trust + scoring footer. */}
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
        <span className={`font-semibold ${confidenceColor}`}>Conf {Math.round(finding.confidence_score)}</span>
        <span className="text-gray-500">·</span>
        <span className="font-semibold text-gray-700">Rel {Math.round(finding.relevance_score)}</span>
        {typeof finding.evidence_strength === 'number' && (
          <>
            <span className="text-gray-500">·</span>
            <span className={`font-semibold ${evidenceColor}`}>Trust {Math.round((finding.evidence_strength ?? 0) * 100)}</span>
          </>
        )}
        {typeof finding.company_alignment_score === 'number' && (
          <>
            <span className="text-gray-500">·</span>
            <span className="font-semibold text-indigo-700">Align {Math.round((finding.company_alignment_score ?? 0) * 100)}</span>
          </>
        )}
        <span className="text-gray-500">·</span>
        <span className="text-gray-500">{finding.regions?.length ? finding.regions.join(', ') : 'Global'}</span>
      </div>

      {/* Correlated peers. */}
      {finding.correlated_findings && finding.correlated_findings.length > 0 && (
        <details className="mt-3 rounded-lg border border-gray-100 bg-gray-50 p-2">
          <summary className="cursor-pointer text-xs font-semibold text-gray-600">Related signals ({finding.correlated_findings.length})</summary>
          <ul className="mt-2 space-y-1 text-xs text-gray-700">
            {finding.correlated_findings.slice(0, 4).map((c, idx) => (
              <li key={idx}>· <span className="font-medium">{c.related_finding_title}</span> <span className="text-gray-500">({c.relation.replace(/_/g, ' ')}, {(c.score * 100).toFixed(0)}%)</span></li>
            ))}
          </ul>
        </details>
      )}

      {/* Action rail. */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-gray-100 pt-3">
        {stateLabel === 'resolved' ? (
          <button
            type="button"
            disabled={loading}
            onClick={() => onAction(finding, 'reopen')}
            className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >Reopen</button>
        ) : (
          <button
            type="button"
            disabled={loading}
            onClick={() => onAction(finding, 'resolve')}
            className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
          >Mark resolved</button>
        )}
        <button
          type="button"
          disabled={loading || stateLabel === 'snoozed'}
          onClick={() => onAction(finding, 'snooze', { days: 7 })}
          className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >Snooze 7d</button>
        <button
          type="button"
          disabled={loading || stateLabel === 'escalated'}
          onClick={() => onAction(finding, 'escalate')}
          className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
        >Track escalation</button>
        <button
          type="button"
          disabled={loading}
          onClick={() => onAction(finding, 'promote')}
          className="rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-800 hover:bg-indigo-100 disabled:opacity-50"
          title="Create an opportunity and prefill the campaign builder"
        >Promote to campaign</button>
        <button
          type="button"
          disabled={loading}
          onClick={() => onAction(finding, 'generate')}
          className="rounded-md border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-800 hover:bg-violet-100 disabled:opacity-50"
          title="Hand off this finding's context to the content generator"
        >Generate response</button>
        <button
          type="button"
          disabled={loading}
          onClick={() => onAction(finding, 'share')}
          className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          title="Copy a shareable summary to your clipboard"
        >Share</button>
        {stateLabel !== 'open' && (
          <span className="ml-auto rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-600">{stateLabel}</span>
        )}
      </div>
    </div>
  );
}

export function FeedSection({ tieredFindings, actioningFindingId, findingStateOverrides, performFindingAction }: FeedSectionProps) {
  const [showP2, setShowP2] = useState(false);
  return (
    <section className="space-y-4">
      {tieredFindings.P0.length > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="rounded bg-rose-600 px-2 py-0.5 text-[11px] font-bold tracking-wide text-white">P0</span>
            <h4 className="text-sm font-semibold text-gray-900">Decide this week — {tieredFindings.P0.length}</h4>
          </div>
          <div className="space-y-3">
            {tieredFindings.P0.map((f) => (
              <FindingCard
                key={f.id}
                finding={f}
                tier="P0"
                onAction={performFindingAction}
                loading={actioningFindingId === f.id}
                stateOverride={findingStateOverrides[f.id]}
              />
            ))}
          </div>
        </div>
      )}

      {tieredFindings.P1.length > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="rounded bg-amber-500 px-2 py-0.5 text-[11px] font-bold tracking-wide text-white">P1</span>
            <h4 className="text-sm font-semibold text-gray-900">Review this cycle — {tieredFindings.P1.length}</h4>
          </div>
          <div className="space-y-2">
            {tieredFindings.P1.map((f) => (
              <FindingCard
                key={f.id}
                finding={f}
                tier="P1"
                onAction={performFindingAction}
                loading={actioningFindingId === f.id}
                stateOverride={findingStateOverrides[f.id]}
              />
            ))}
          </div>
        </div>
      )}

      {tieredFindings.P2.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowP2((v) => !v)}
            className="mb-2 flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-gray-50"
          >
            <span className="rounded bg-gray-200 px-2 py-0.5 text-[11px] font-bold tracking-wide text-gray-700">P2</span>
            <h4 className="text-sm font-semibold text-gray-900">Watchlist — {tieredFindings.P2.length}</h4>
            <span className="text-xs text-gray-500">{showP2 ? '(hide)' : '(show)'}</span>
          </button>
          {showP2 && (
            <div className="space-y-2">
              {tieredFindings.P2.map((f) => (
                <FindingCard
                  key={f.id}
                  finding={f}
                  tier="P2"
                  onAction={performFindingAction}
                  loading={actioningFindingId === f.id}
                  stateOverride={findingStateOverrides[f.id]}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {tieredFindings.hidden > 0 && (
        <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">
          {tieredFindings.hidden} resolved/snoozed finding{tieredFindings.hidden === 1 ? '' : 's'} hidden from feed.
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2: ExecutivePanels — operational command center surface.
// Renders momentum overview, category acceleration, competitor pressure,
// propagation map, escalation timeline, and trend persistence in a compact
// 2x3 grid that scans top-to-bottom in <30 seconds.
// ─────────────────────────────────────────────────────────────────────────────
function MomentumPanel({ data }: { data: MomentumOverview | null | undefined }) {
  if (!data || data.history.length === 0) return null;
  const max = Math.max(1, ...data.history.map((h) => h.total));
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">Momentum (last {data.history.length} runs)</span>
        <span className={`text-xs font-semibold ${data.trend === 'rising' ? 'text-rose-700' : data.trend === 'falling' ? 'text-emerald-700' : 'text-gray-600'}`}>
          {data.trend === 'rising' ? '↑' : data.trend === 'falling' ? '↓' : '→'}
          {' '}P0 {data.delta_p0_vs_prior >= 0 ? '+' : ''}{data.delta_p0_vs_prior}
        </span>
      </div>
      <div className="mt-2 flex items-end gap-1 h-14">
        {[...data.history].reverse().map((h) => {
          const heightPct = Math.max(8, (h.total / max) * 100);
          return (
            <div key={h.run_id} className="flex-1 flex flex-col-reverse gap-0.5" title={`${new Date(h.created_at).toLocaleDateString()} · P0 ${h.p0} · P1 ${h.p1} · P2 ${h.p2}`}>
              <div className="bg-gray-300" style={{ height: `${(h.p2 / max) * 100}%` }} />
              <div className="bg-amber-400" style={{ height: `${(h.p1 / max) * 100}%` }} />
              <div className="bg-rose-500" style={{ height: `${(h.p0 / max) * 100}%`, minHeight: h.p0 > 0 ? '2px' : '0' }} />
              {/* placeholder so the column has at least minHeightPct of paint */}
              <div className="border-b border-gray-200 mt-auto" style={{ visibility: heightPct < 8 ? 'visible' : 'hidden' }} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CategoryAccelerationPanel({ data }: { data: CategoryAcceleration | null | undefined }) {
  if (!data || data.categories.length === 0) return null;
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">Category acceleration</span>
      <ul className="mt-2 space-y-1">
        {data.categories.slice(0, 5).map((c) => (
          <li key={c.category} className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-gray-800">{c.category.replace(/_/g, ' ')}</span>
            <span className="flex items-center gap-1.5">
              <span className="font-semibold text-gray-900">{c.current_count}</span>
              {c.delta !== 0 && (
                <span className={`font-semibold ${c.direction === 'up' ? 'text-rose-700' : 'text-emerald-700'}`}>
                  {c.direction === 'up' ? '↑' : '↓'}{Math.abs(c.delta)}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CompetitorPressurePanel({ data }: { data: CompetitorPressure | null | undefined }) {
  if (!data || data.competitors.length === 0) return null;
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">Competitor pressure</span>
      <ul className="mt-2 space-y-1">
        {data.competitors.slice(0, 5).map((c) => (
          <li key={c.name} className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate font-medium text-gray-900 capitalize">{c.name}</span>
            <span className="flex items-center gap-1.5">
              {c.has_escalation && <span className="text-[10px] font-bold text-amber-700">↑</span>}
              {c.p0_count > 0 && <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-800">P0 {c.p0_count}</span>}
              <span className="text-gray-700">{c.finding_count}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PropagationPanel({ data }: { data: PropagationMap | null | undefined }) {
  if (!data || data.regions.length === 0) return null;
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">Regional propagation</span>
      <ul className="mt-2 space-y-1">
        {data.regions.slice(0, 5).map((r) => (
          <li key={r.region} className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate font-medium text-gray-900 uppercase">{r.region}</span>
            <span className="flex items-center gap-1.5">
              {r.p0_count > 0 && <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-800">P0 {r.p0_count}</span>}
              <span className="text-gray-700">{r.finding_count}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EscalationTimelinePanel({ data }: { data: EscalationTimeline | null | undefined }) {
  if (!data || data.events.length === 0) return null;
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">Escalation timeline</span>
      <ul className="mt-2 space-y-1">
        {data.events.slice(0, 5).map((e) => (
          <li key={e.finding_id} className="flex items-start justify-between gap-2 text-xs">
            <span className="truncate text-gray-800">{e.title}</span>
            <span className={`flex-shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${e.escalation_level === 'market_wide_propagation' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'}`}>
              {e.escalation_level === 'market_wide_propagation' ? 'PROPAGATING' : 'ESCALATING'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TrendPersistencePanel({ data }: { data: TrendPersistence | null | undefined }) {
  if (!data || data.trends.length === 0) return null;
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">Recurring patterns</span>
      <ul className="mt-2 space-y-1">
        {data.trends.slice(0, 5).map((t) => (
          <li key={t.canonical_event_key} className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-gray-800">{t.title}</span>
            <span className="flex items-center gap-1.5">
              {t.trajectory && <span className={`text-[10px] font-semibold ${t.trajectory === 'accelerating' ? 'text-rose-700' : t.trajectory === 'fading' ? 'text-emerald-700' : 'text-gray-600'}`}>{t.trajectory}</span>}
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-700">{t.times_seen}×</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ExecutivePanels({ run }: { run: RunResponse['run'] }) {
  const hasAnyPanel = !!(
    run.momentum_overview ||
    run.category_acceleration?.categories?.length ||
    run.competitor_pressure?.competitors?.length ||
    run.propagation_map?.regions?.length ||
    run.escalation_timeline?.events?.length ||
    run.trend_persistence?.trends?.length
  );
  if (!hasAnyPanel) return null;
  return (
    <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <MomentumPanel data={run.momentum_overview} />
      <CategoryAccelerationPanel data={run.category_acceleration} />
      <CompetitorPressurePanel data={run.competitor_pressure} />
      <PropagationPanel data={run.propagation_map} />
      <EscalationTimelinePanel data={run.escalation_timeline} />
      <TrendPersistencePanel data={run.trend_persistence} />
    </section>
  );
}

