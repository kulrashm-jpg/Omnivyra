import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { OpportunityTabProps } from './types';
import { RefreshCw, Radar, ShieldAlert, Sparkles } from 'lucide-react';
import EngineJobStatusPanel from '../../engines/EngineJobStatusPanel';

const MARKET_PULSE_CATEGORIES = [
  'competitor_moves',
  'product_positioning',
  'partnerships_alliances',
  'growth_expansion',
  'hiring_talent',
  'regulatory_policy',
  'capital_business_health',
  'demand_category_momentum',
  'technology_platform_shifts',
];

type ContextResponse = {
  companyId: string;
  profile: {
    name?: string | null;
    industry?: string | null;
    geography?: string | null;
    geography_list?: string[];
  };
  marketPulseProfile: {
    primary_operating_markets?: string[];
    target_expansion_markets?: string[];
    named_competitors?: string[];
    effective_market_focus?: string[];
    effective_competitors?: string[];
    business_model?: string;
    provider_type?: string;
    domain_role?: string;
    operating_model?: string;
    solution_domains?: string[];
    competitor_details?: Array<{
      name: string;
      category?: string | null;
      tier?: string | null;
      score?: number | null;
      confidence?: number | null;
      rationale?: string | null;
    }>;
    competitor_quality?: {
      highest_score?: number | null;
      threshold?: number | null;
      threshold_met?: boolean | null;
      detail_mode?: 'high_confidence' | 'expanded_context' | null;
    };
    market_alternatives?: Array<{
      name: string;
      category?: string | null;
      tier?: string | null;
      score?: number | null;
      confidence?: number | null;
      rationale?: string | null;
      use_case?: string | null;
      business_model?: string | null;
    }>;
    core_offerings?: string[];
    growth_priorities?: string[];
    partnership_priorities?: string[];
    critical_hiring_functions?: string[];
    regulatory_policy_sensitivity?: string[];
    default_categories?: string[];
    exclusions?: string[];
    preferred_regions?: string[];
  };
};

type AutomationResponse = {
  settings?: {
    is_active?: boolean;
    objective?: string;
    categories?: string[];
    region_scope?: 'profile_markets' | 'expansion_markets' | 'all_defaults' | 'custom';
    custom_regions?: string[];
    competitor_scope?: 'profile_only' | 'auto_discover' | 'combined';
    custom_direction?: string | null;
    credit_acknowledged?: boolean;
  } | null;
};

const SOURCE_STRATEGIES = [
  { value: 'hybrid', label: 'AI + API' },
  { value: 'ai', label: 'AI only' },
  { value: 'api', label: 'API only' },
] as const;

type MarketPulseFinding = {
  id: string;
  category: string;
  title: string;
  summary: string;
  impact_type: 'opportunity' | 'risk' | 'watch';
  why_it_matters: string;
  recommended_action: string;
  change_status: 'new' | 'updated' | 'unchanged' | 'resolved';
  confidence_score: number;
  relevance_score: number;
  regions: string[];
  /** Phase 1A: additive priority tier (P0 / P1 / P2) — nullable until backfill. */
  priority_tier?: 'P0' | 'P1' | 'P2' | null;
  freshness_score?: number | null;
  company_alignment_score?: number | null;
  /** Phase 1B: intelligence layer outputs (all nullable for legacy rows). */
  interpretation_text?: string | null;
  strategic_implication?: string | null;
  urgency_reason?: string | null;
  operational_impact?: string | null;
  opportunity_window?: string | null;
  affected_business_areas?: string[] | null;
  evidence_strength?: number | null;
  cluster_role?: 'isolated' | 'repeated' | 'market_wide' | 'localized_anomaly' | 'emerging_market_shift' | 'coordinated_competitor_movement' | null;
  alert_class?: 'strategic_risk' | 'competitor_escalation' | 'regulatory_exposure' | 'market_acceleration' | 'opportunity_breakout' | null;
  priority_explanation?: string | null;
  correlated_findings?: Array<{
    related_finding_id: string;
    related_finding_title: string;
    relation: string;
    score: number;
  }> | null;
  user_action_state?: 'open' | 'resolved' | 'snoozed' | 'escalated' | 'promoted' | null;
  resolved_at?: string | null;
  snoozed_until?: string | null;
  /** Phase 2 fields. */
  trajectory?: 'accelerating' | 'fading' | 'cyclic' | 'structural' | 'stable' | null;
  escalation_level?: 'first_occurrence' | 'repeated' | 'escalating_pattern' | 'market_wide_propagation' | null;
  cluster_signal_ids?: string[] | null;
  related_intelligence_signal_ids?: string[] | null;
  historical_finding_ids?: string[] | null;
};

/** Phase 2 executive panels — typed as the API returns. */
type MomentumOverview = {
  history: Array<{ run_id: string; created_at: string; p0: number; p1: number; p2: number; total: number }>;
  trend: 'rising' | 'falling' | 'flat';
  current_p0: number;
  delta_p0_vs_prior: number;
};
type CategoryAcceleration = {
  categories: Array<{ category: string; current_count: number; prior_count: number; delta: number; direction: 'up' | 'down' | 'flat' }>;
};
type CompetitorPressure = {
  competitors: Array<{ name: string; finding_count: number; p0_count: number; has_escalation: boolean }>;
};
type EscalationTimeline = {
  events: Array<{ finding_id: string; title: string; category: string; escalation_level: string; detected_at: string }>;
};
type PropagationMap = {
  regions: Array<{ region: string; finding_count: number; p0_count: number }>;
};
type TrendPersistence = {
  trends: Array<{ canonical_event_key: string; title: string; times_seen: number; last_priority_tier: string | null; trajectory: string | null; last_seen_at: string }>;
};

type ChangeSummary = {
  prior_run_id: string | null;
  prior_run_at: string | null;
  new_count: number;
  updated_count: number;
  unchanged_count: number;
  resolved_count: number;
  escalated_count: number;
  downgraded_count: number;
  emerging_categories: string[];
  disappearing_categories: string[];
  escalated_samples: Array<{
    finding_id: string;
    title: string;
    from_tier: string | null;
    to_tier: string | null;
  }>;
};

type RunResponse = {
  run: {
    id: string;
    status: string;
    objective: string;
    categories: string[];
    created_at: string;
    completed_at?: string | null;
    progress_stage?: string | null;
    confidence_index?: number | null;
    legacy_status?: string | null;
    legacy_error?: string | null;
    /** Phase 1A: previously-dropped fields, now surfaced from consolidated_result. */
    strategic_summary?: string | null;
    risk_alerts?: string[] | null;
    region_divergence_score?: number | null;
    /** Phase 1B: run-level intelligence layer. */
    executive_summary?: string | null;
    top_takeaways?: string[] | null;
    immediate_attention_items?: Array<{
      finding_id: string | null;
      title: string;
      reason: string;
      priority_tier: string;
    }> | null;
    strategic_shift_assessment?: string | null;
    market_direction?: 'expanding' | 'contracting' | 'mixed' | 'stable' | null;
    opportunity_pressure?: number | null;
    risk_pressure?: number | null;
    change_summary?: ChangeSummary | null;
    prior_run_id?: string | null;
    /** Phase 2 executive panels. */
    momentum_overview?: MomentumOverview | null;
    category_acceleration?: CategoryAcceleration | null;
    competitor_pressure?: CompetitorPressure | null;
    escalation_timeline?: EscalationTimeline | null;
    propagation_map?: PropagationMap | null;
    trend_persistence?: TrendPersistence | null;
  };
  findings: MarketPulseFinding[];
};

type HistoryItem = {
  id: string;
  mode: string;
  objective: string;
  categories: string[];
  status: string;
  credits_consumed: number;
  created_at: string;
  completed_at?: string | null;
};

type PendingRunState = {
  created_at: string;
  status: 'pending' | 'running';
  progress_stage?: string | null;
};

const OBJECTIVES = [
  { value: 'growth', label: 'Growth' },
  { value: 'expansion', label: 'Expansion' },
  { value: 'hiring', label: 'Hiring' },
  { value: 'partnerships', label: 'Partnerships' },
  { value: 'product', label: 'Product' },
  { value: 'risk', label: 'Risk' },
] as const;

function toTitle(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function buildResolvedRegionPreview(
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

function FeedSection({ tieredFindings, actioningFindingId, findingStateOverrides, performFindingAction }: FeedSectionProps) {
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

function ExecutivePanels({ run }: { run: RunResponse['run'] }) {
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

export default function MarketPulseTabV2(props: OpportunityTabProps) {
  const { companyId, fetchWithAuth } = props;
  const [context, setContext] = useState<ContextResponse | null>(null);
  const [loadingContext, setLoadingContext] = useState(false);
  const [mode, setMode] = useState<'one_time' | 'automated'>('one_time');
  const [objective, setObjective] = useState<'growth' | 'expansion' | 'hiring' | 'partnerships' | 'product' | 'risk'>('growth');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [regionScope, setRegionScope] = useState<'profile_markets' | 'expansion_markets' | 'all_defaults' | 'custom'>('profile_markets');
  const [customRegions, setCustomRegions] = useState('');
  const [competitorScope, setCompetitorScope] = useState<'profile_only' | 'auto_discover' | 'combined'>('combined');
  const [sourceStrategy, setSourceStrategy] = useState<'ai' | 'api' | 'hybrid'>('hybrid');
  const [customDirection, setCustomDirection] = useState('');
  const [creditAcknowledged, setCreditAcknowledged] = useState(false);
  const [running, setRunning] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<RunResponse | null>(null);
  const [pendingRun, setPendingRun] = useState<PendingRunState | null>(null);
  const [automationLoading, setAutomationLoading] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [automationEnabled, setAutomationEnabled] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  // Phase 1B: feed-first UX state.
  // Default: setup collapsed UNLESS the user has never run a scan yet (no
  // history rows present after initial load — see the auto-expand effect below).
  const [scanSetupOpen, setScanSetupOpen] = useState(false);
  const [scanSetupAutoOpened, setScanSetupAutoOpened] = useState(false);
  const [actioningFindingId, setActioningFindingId] = useState<string | null>(null);
  // Track local action overrides so the UI updates instantly without
  // re-polling the run after a user mutation.
  const [findingStateOverrides, setFindingStateOverrides] = useState<Record<string, MarketPulseFinding['user_action_state']>>({});

  useEffect(() => {
    if (!companyId) return;
    let active = true;

    const load = async () => {
      setLoadingContext(true);
      try {
        const res = await fetchWithAuth(`/api/market-pulse/context?companyId=${encodeURIComponent(companyId)}`);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err?.error || 'Failed to load Market Pulse context');
        }
        const data = (await res.json()) as ContextResponse;
        if (!active) return;
        setContext(data);
        setSelectedCategories(data.marketPulseProfile.default_categories?.length ? data.marketPulseProfile.default_categories : ['competitor_moves', 'growth_expansion', 'regulatory_policy']);
      } catch (error) {
        if (!active) return;
        setErrorMessage((error as Error).message || 'Failed to load Market Pulse context');
      } finally {
        if (active) setLoadingContext(false);
      }
    };

    const loadAutomation = async () => {
      try {
        const res = await fetchWithAuth(`/api/market-pulse/automation?companyId=${encodeURIComponent(companyId)}`);
        if (!res.ok) return;
        const data = (await res.json()) as AutomationResponse;
        if (!active) return;
        if (data?.settings) {
          setAutomationEnabled(Boolean(data.settings.is_active));
          if (data.settings.objective && OBJECTIVES.some((item) => item.value === data.settings?.objective)) {
            setObjective(data.settings.objective as typeof objective);
          }
          if (Array.isArray(data.settings.categories) && data.settings.categories.length > 0) {
            setSelectedCategories(data.settings.categories.filter((item) => MARKET_PULSE_CATEGORIES.includes(item)));
          }
          if (data.settings.region_scope) {
            setRegionScope(data.settings.region_scope);
          }
          if (data.settings.competitor_scope) {
            setCompetitorScope(data.settings.competitor_scope);
          }
          if (Array.isArray(data.settings.custom_regions) && data.settings.custom_regions.length > 0) {
            setCustomRegions(data.settings.custom_regions.join(', '));
          }
          if (typeof data.settings.custom_direction === 'string') {
            setCustomDirection(data.settings.custom_direction);
          }
          setCreditAcknowledged(Boolean(data.settings.credit_acknowledged));
        }
      } catch {
        // ignore
      }
    };

    const loadHistory = async () => {
      try {
        const res = await fetchWithAuth(`/api/market-pulse/history?companyId=${encodeURIComponent(companyId)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!active) return;
        setHistory(Array.isArray(data?.history) ? data.history : []);
      } catch {
        // ignore
      }
    };

    void load();
    void loadAutomation();
    void loadHistory();
    return () => {
      active = false;
    };
  }, [companyId, fetchWithAuth]);

  useEffect(() => {
    if (!runId || !companyId) return;
    const timer = window.setInterval(async () => {
      try {
        const res = await fetchWithAuth(`/api/market-pulse/runs/${encodeURIComponent(runId)}?companyId=${encodeURIComponent(companyId)}`);
        if (!res.ok) return;
        const data = (await res.json()) as RunResponse;
        setRunResult(data);
        setPendingRun(null);
        if (!['pending', 'running'].includes(String(data.run?.status ?? ''))) {
          const historyRes = await fetchWithAuth(`/api/market-pulse/history?companyId=${encodeURIComponent(companyId)}`);
          if (historyRes.ok) {
            const historyData = await historyRes.json();
            setHistory(Array.isArray(historyData?.history) ? historyData.history : []);
          }
        }
        if (!['pending', 'running'].includes(String(data.run?.status ?? ''))) {
          setRunning(false);
          window.clearInterval(timer);
        }
      } catch {
        // ignore poll errors
      }
    }, 4000);

    return () => window.clearInterval(timer);
  }, [companyId, fetchWithAuth, runId]);

  const groupedFindings = useMemo(() => {
    const findings = runResult?.findings ?? [];
    return {
      top: findings.filter((item) => item.change_status === 'new' || item.change_status === 'updated').slice(0, 6),
      risks: findings.filter((item) => item.impact_type === 'risk'),
      watch: findings.filter((item) => item.impact_type === 'watch'),
      opportunities: findings.filter((item) => item.impact_type === 'opportunity'),
    };
  }, [runResult]);

  // First-time visitor → auto-open Scan Setup so the form is discoverable.
  // Once history loads with at least one row, the disclosure stays whatever
  // the user last toggled it to.
  useEffect(() => {
    if (scanSetupAutoOpened) return;
    if (history.length === 0 && !runResult && !pendingRun) {
      setScanSetupOpen(true);
      setScanSetupAutoOpened(true);
    } else if (history.length > 0) {
      setScanSetupAutoOpened(true);
    }
  }, [history, runResult, pendingRun, scanSetupAutoOpened]);

  // Phase 1A: change-diff strip — counts of new / updated / unchanged / resolved
  // and priority-tier counts. Renders above results when the run has findings.
  const changeDiff = useMemo(() => {
    const findings = runResult?.findings ?? [];
    const out = { new: 0, updated: 0, unchanged: 0, resolved: 0, p0: 0, p1: 0, p2: 0 };
    for (const f of findings) {
      if (f.change_status === 'new') out.new++;
      else if (f.change_status === 'updated') out.updated++;
      else if (f.change_status === 'unchanged') out.unchanged++;
      else if (f.change_status === 'resolved') out.resolved++;
      if (f.priority_tier === 'P0') out.p0++;
      else if (f.priority_tier === 'P1') out.p1++;
      else out.p2++;
    }
    return out;
  }, [runResult]);

  // Phase 1B: tier-grouped feed (P0 dominant, P1 visible, P2 compact).
  // Filters out resolved/snoozed by default so the feed only shows actionable items.
  const tieredFindings = useMemo(() => {
    const findings = runResult?.findings ?? [];
    const visible = findings.filter((f) => {
      const state = findingStateOverrides[f.id] ?? f.user_action_state ?? 'open';
      return state === 'open' || state === 'escalated';
    });
    return {
      P0: visible.filter((f) => f.priority_tier === 'P0'),
      P1: visible.filter((f) => f.priority_tier === 'P1'),
      P2: visible.filter((f) => !f.priority_tier || f.priority_tier === 'P2'),
      hidden: findings.length - visible.length,
    };
  }, [runResult, findingStateOverrides]);

  // Phase 1B + 2: per-finding action handler. Optimistic local update, then
  // POST. `promote` and `generate` route to dedicated Phase 2 endpoints;
  // others use the standard /action endpoint.
  const performFindingAction = async (
    finding: MarketPulseFinding,
    actionType: 'resolve' | 'reopen' | 'snooze' | 'escalate' | 'promote' | 'share' | 'generate',
    payload?: Record<string, unknown>,
  ) => {
    if (!companyId) return;
    setActioningFindingId(finding.id);
    setErrorMessage(null);

    // Optimistic local state.
    const nextState: MarketPulseFinding['user_action_state'] =
      actionType === 'resolve' ? 'resolved'
      : actionType === 'reopen' ? 'open'
      : actionType === 'snooze' ? 'snoozed'
      : actionType === 'escalate' ? 'escalated'
      : actionType === 'promote' ? 'promoted'
      : finding.user_action_state ?? 'open';
    if (actionType !== 'share' && actionType !== 'generate') {
      setFindingStateOverrides((prev) => ({ ...prev, [finding.id]: nextState }));
    }

    if (actionType === 'share' && typeof navigator !== 'undefined' && navigator.clipboard) {
      const text = `[Market Pulse · ${finding.priority_tier ?? 'P?'} ${finding.impact_type}] ${finding.title}\n\n${finding.interpretation_text ?? finding.summary}\n\nWhy it matters: ${finding.why_it_matters}\nRecommended action: ${finding.recommended_action}`;
      try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
    }

    try {
      // Phase 2: dedicated /promote endpoint that creates an opportunity_items
      // row + builds the campaign payload. Then we stash it in sessionStorage
      // and navigate to the recommendations planner.
      if (actionType === 'promote') {
        const res = await fetchWithAuth(`/api/market-pulse/findings/${encodeURIComponent(finding.id)}/promote`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ companyId }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err?.error || 'Failed to promote finding');
        }
        const data = await res.json();
        if (typeof window !== 'undefined') {
          try {
            sessionStorage.setItem('market_pulse_promote_bridge', JSON.stringify({
              finding_id: finding.id,
              opportunity_id: data.opportunity_id,
              campaign_payload: data.campaign_payload,
              issued_at: new Date().toISOString(),
            }));
          } catch { /* ignore quota */ }
          // Navigate to recommendations hub — campaign builder consumes the bridge.
          window.location.assign('/recommendations?from=market_pulse');
        }
        return;
      }

      // Phase 2: dedicated /generate-response endpoint that returns a handoff
      // payload + suggested target URLs. We stash + navigate.
      if (actionType === 'generate') {
        const res = await fetchWithAuth(`/api/market-pulse/findings/${encodeURIComponent(finding.id)}/generate-response`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ companyId }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err?.error || 'Failed to prepare generation context');
        }
        const data = await res.json();
        if (typeof window !== 'undefined') {
          try {
            sessionStorage.setItem(data.handoff_token, JSON.stringify(data.handoff_payload));
          } catch { /* ignore quota */ }
          // Default target = post creator. The bridge payload survives a
          // navigate so the user can change destination via the content menu.
          const target = (payload?.target as string | undefined) ?? data.suggested_targets.post_creator;
          window.location.assign(target);
        }
        return;
      }

      // Default: legacy /action endpoint (resolve / snooze / escalate / share / reopen).
      const res = await fetchWithAuth(`/api/market-pulse/findings/${encodeURIComponent(finding.id)}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          action: actionType,
          payload: payload ?? {},
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || `Failed to ${actionType} finding`);
      }
    } catch (error) {
      // Roll back the optimistic override.
      setFindingStateOverrides((prev) => {
        const next = { ...prev };
        delete next[finding.id];
        return next;
      });
      setErrorMessage((error as Error).message || `Failed to ${actionType} finding`);
    } finally {
      setActioningFindingId(null);
    }
  };

  // Phase 2: record "shown" for each visible finding once per session per
  // finding. The endpoint is idempotent per UTC day, so even multiple
  // remounts are safe — but we de-dupe client-side to avoid the network
  // calls.
  const shownRecordedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!companyId || !runResult || runResult.findings.length === 0) return;
    const toRecord = runResult.findings
      .filter((f) => !shownRecordedRef.current.has(f.id))
      .slice(0, 50);
    if (toRecord.length === 0) return;
    for (const f of toRecord) shownRecordedRef.current.add(f.id);
    void Promise.allSettled(
      toRecord.map((f) =>
        fetchWithAuth(`/api/market-pulse/findings/${encodeURIComponent(f.id)}/shown`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ companyId }),
        }),
      ),
    );
  }, [companyId, fetchWithAuth, runResult]);

  const resolvedRegionPreview = useMemo(
    () => buildResolvedRegionPreview(context, regionScope, customRegions),
    [context, regionScope, customRegions]
  );

  const toggleCategory = (category: string) => {
    setSelectedCategories((prev) =>
      prev.includes(category) ? prev.filter((item) => item !== category) : [...prev, category]
    );
  };

  const runScan = async () => {
    if (!companyId) return;
    setRunning(true);
    setErrorMessage(null);
    setRunResult(null);
    setPendingRun({
      created_at: new Date().toISOString(),
      status: 'pending',
      progress_stage: 'INITIALIZING',
    });
    try {
      const res = await fetchWithAuth('/api/market-pulse/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          mode,
          objective,
          categories: selectedCategories,
          region_scope: regionScope,
          custom_regions: customRegions.split(',').map((item) => item.trim()).filter(Boolean),
          competitor_scope: competitorScope,
          source_strategy: sourceStrategy,
          custom_direction: customDirection.trim() || null,
          delivery_mode: mode === 'automated' ? 'daily_digest' : 'page_only',
          credit_acknowledged: creditAcknowledged,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || 'Failed to start Market Pulse run');
      }
      const data = await res.json();
      setRunId(String(data.runId));
      setPendingRun((current) => current ? { ...current, status: 'running', progress_stage: 'INITIALIZING' } : current);
    } catch (error) {
      setRunning(false);
      setPendingRun(null);
      setErrorMessage((error as Error).message || 'Failed to start Market Pulse run');
    }
  };

  const saveAutomation = async () => {
    if (!companyId) return;
    setAutomationLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetchWithAuth('/api/market-pulse/automation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          is_active: automationEnabled,
          cadence: 'daily',
          objective,
          categories: selectedCategories,
          region_scope: regionScope,
          custom_regions: customRegions.split(',').map((item) => item.trim()).filter(Boolean),
          competitor_scope: competitorScope,
          custom_direction: customDirection.trim() || null,
          credit_acknowledged: creditAcknowledged,
          warning_copy_version: 'v1',
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || 'Failed to save automation');
      }
    } catch (error) {
      setErrorMessage((error as Error).message || 'Failed to save automation');
    } finally {
      setAutomationLoading(false);
    }
  };

  const stopScan = async () => {
    if (!companyId || !runId) return;
    setCancelLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetchWithAuth(`/api/market-pulse/runs/${encodeURIComponent(runId)}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || 'Failed to stop Market Pulse run');
      }

      const cancelledAt = new Date().toISOString();
      setRunning(false);
      setPendingRun(null);
      setRunResult((current) => current ? {
        ...current,
        run: {
          ...current.run,
          status: 'failed',
          completed_at: cancelledAt,
          legacy_error: 'Cancelled by user',
        },
      } : null);
    } catch (error) {
      setErrorMessage((error as Error).message || 'Failed to stop Market Pulse run');
    } finally {
      setCancelLoading(false);
    }
  };

  if (!companyId) {
    return <div className="py-4 text-sm text-gray-500">Select a company to view Market Pulse.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">Market Pulse</p>
            <h3 className="mt-2 text-2xl font-bold text-gray-900">Monitor the market with company-aware filters</h3>
            <p className="mt-2 text-sm text-gray-600">
              Use company profile context, category selection, and geography scope to surface only the external developments that matter.
            </p>
          </div>
          <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
            <span className="font-semibold">{context?.profile?.name || 'Company context'}</span>
            <span className="ml-2 text-indigo-700">{context?.profile?.industry || 'Industry pending'}</span>
          </div>
        </div>
      </div>

      {errorMessage && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{errorMessage}</div>}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          {/* Phase 1B EXECUTIVE FEED HEADER — renders when run has results.
              Pressure indicators, top changes, dominant categories, risk/opp balance. */}
          {runResult && runResult.findings.length > 0 && (
            <section className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-white p-6 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex-1 min-w-[260px]">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-700">Decision intelligence</p>
                  {runResult.run.executive_summary ? (
                    <p className="mt-2 text-base font-medium text-gray-900 leading-snug">{runResult.run.executive_summary}</p>
                  ) : runResult.run.strategic_summary ? (
                    <p className="mt-2 text-base font-medium text-gray-900 leading-snug">{runResult.run.strategic_summary}</p>
                  ) : (
                    <p className="mt-2 text-base text-gray-500">No executive summary yet — run a scan or wait for the cron to land one.</p>
                  )}
                </div>
                {runResult.run.market_direction && (
                  <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${
                    runResult.run.market_direction === 'expanding' ? 'bg-emerald-100 text-emerald-800'
                    : runResult.run.market_direction === 'contracting' ? 'bg-rose-100 text-rose-800'
                    : runResult.run.market_direction === 'mixed' ? 'bg-amber-100 text-amber-800'
                    : 'bg-gray-100 text-gray-700'
                  }`}>
                    {runResult.run.market_direction}
                  </span>
                )}
              </div>

              {/* Pressure bar — visualizes risk vs opportunity balance. */}
              {(typeof runResult.run.opportunity_pressure === 'number' || typeof runResult.run.risk_pressure === 'number') && (
                <div className="mt-4">
                  <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">
                    <span>Risk pressure {Math.round((runResult.run.risk_pressure ?? 0) * 100)}%</span>
                    <span>Opportunity pressure {Math.round((runResult.run.opportunity_pressure ?? 0) * 100)}%</span>
                  </div>
                  <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-gray-100">
                    <div className="bg-rose-400" style={{ width: `${Math.round((runResult.run.risk_pressure ?? 0) * 100)}%` }} />
                    <div className="bg-emerald-400" style={{ width: `${Math.round((runResult.run.opportunity_pressure ?? 0) * 100)}%` }} />
                  </div>
                </div>
              )}

              {/* Top takeaways. */}
              {runResult.run.top_takeaways && runResult.run.top_takeaways.length > 0 && (
                <ul className="mt-4 space-y-1.5 text-sm text-gray-700">
                  {runResult.run.top_takeaways.map((t, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-indigo-500" />
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
              )}

              {/* Strategic shift assessment. */}
              {runResult.run.strategic_shift_assessment && (
                <div className="mt-4 rounded-lg border border-indigo-100 bg-white/80 p-3 text-sm text-gray-700">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-indigo-600">Shift assessment</span>
                  <p className="mt-1">{runResult.run.strategic_shift_assessment}</p>
                </div>
              )}

              {/* Immediate-attention list — P0s requiring action. */}
              {runResult.run.immediate_attention_items && runResult.run.immediate_attention_items.length > 0 && (
                <div className="mt-4">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-rose-600">Immediate attention</span>
                  <ul className="mt-2 space-y-1.5">
                    {runResult.run.immediate_attention_items.slice(0, 5).map((item, idx) => (
                      <li key={idx} className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50/60 px-3 py-2 text-sm">
                        <span className="rounded-full bg-rose-200 px-1.5 py-0.5 text-[10px] font-bold text-rose-800">{item.priority_tier}</span>
                        <div className="flex-1">
                          <div className="font-semibold text-gray-900">{item.title}</div>
                          <div className="text-xs text-rose-700">{item.reason}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Change-summary chips — emerging/disappearing categories + escalations. */}
              {runResult.run.change_summary && (
                <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                  {runResult.run.change_summary.escalated_count > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 font-semibold text-amber-800">
                      ↑ {runResult.run.change_summary.escalated_count} escalated
                    </span>
                  )}
                  {runResult.run.change_summary.downgraded_count > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 font-medium text-gray-700">
                      ↓ {runResult.run.change_summary.downgraded_count} downgraded
                    </span>
                  )}
                  {runResult.run.change_summary.emerging_categories.length > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 font-medium text-blue-800" title={runResult.run.change_summary.emerging_categories.join(', ')}>
                      + {runResult.run.change_summary.emerging_categories.length} emerging {runResult.run.change_summary.emerging_categories.length === 1 ? 'category' : 'categories'}
                    </span>
                  )}
                  {runResult.run.change_summary.disappearing_categories.length > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 font-medium text-gray-600" title={runResult.run.change_summary.disappearing_categories.join(', ')}>
                      − {runResult.run.change_summary.disappearing_categories.length} disappearing
                    </span>
                  )}
                </div>
              )}
            </section>
          )}

          {/* Phase 2 EXECUTIVE PANELS — momentum, category acceleration,
              competitor pressure, propagation map, escalation timeline,
              trend persistence. Renders only when at least one panel has data. */}
          {runResult && runResult.findings.length > 0 && (
            <ExecutivePanels run={runResult.run} />
          )}

          {/* Scan Setup — collapsed by default once a run exists; expanded on first visit. */}
          <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <button
              type="button"
              onClick={() => setScanSetupOpen((v) => !v)}
              className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1 text-left hover:bg-gray-50"
            >
              <span className="flex items-center gap-2">
                <Radar className="h-4 w-4 text-indigo-600" />
                <span className="text-sm font-semibold text-gray-900">{scanSetupOpen ? 'Adjust scan' : 'Scan setup'}</span>
                {!scanSetupOpen && context && (
                  <span className="text-xs text-gray-500">
                    · {selectedCategories.length} categor{selectedCategories.length === 1 ? 'y' : 'ies'}
                    {' · '}{objective}
                    {' · '}{regionScope === 'custom' ? 'custom regions' : regionScope.replace(/_/g, ' ')}
                  </span>
                )}
              </span>
              <span className="text-xs text-gray-500">{scanSetupOpen ? 'Collapse' : 'Expand'}</span>
            </button>

            {!scanSetupOpen ? (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={runScan}
                  disabled={running || loadingContext || selectedCategories.length === 0}
                  className="inline-flex items-center gap-2 rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-gray-800 disabled:opacity-50"
                >
                  <Sparkles className="h-4 w-4" />
                  {running ? 'Running scan...' : 'Run Market Pulse'}
                </button>
                {running && runId && (
                  <button
                    type="button"
                    onClick={stopScan}
                    disabled={cancelLoading}
                    className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-50"
                  >
                    {cancelLoading ? 'Stopping...' : 'Stop scan'}
                  </button>
                )}
                {runResult?.run?.created_at && (
                  <span className="text-xs text-gray-500">Last run: {new Date(runResult.run.created_at).toLocaleString()}</span>
                )}
              </div>
            ) : (
              <div className="mt-4">

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-sm font-medium text-gray-700">Mode</label>
                <select value={mode} onChange={(e) => setMode(e.target.value as 'one_time' | 'automated')} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                  <option value="one_time">One-time scan</option>
                  <option value="automated">Automated monitoring</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Objective</label>
                <select value={objective} onChange={(e) => setObjective(e.target.value as typeof objective)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                  {OBJECTIVES.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Region scope</label>
                <select value={regionScope} onChange={(e) => setRegionScope(e.target.value as typeof regionScope)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                  <option value="profile_markets">Market focus</option>
                  <option value="expansion_markets">Expansion markets</option>
                  <option value="all_defaults">All defaults</option>
                  <option value="custom">Custom regions</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Competitor scope</label>
                <select value={competitorScope} onChange={(e) => setCompetitorScope(e.target.value as typeof competitorScope)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                  <option value="profile_only">Profile competitors</option>
                  <option value="auto_discover">Auto-discover</option>
                  <option value="combined">Combine both</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Research mode</label>
                <select value={sourceStrategy} onChange={(e) => setSourceStrategy(e.target.value as typeof sourceStrategy)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                  {SOURCE_STRATEGIES.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="text-sm font-medium text-gray-700">Custom regions</label>
                <input value={customRegions} onChange={(e) => setCustomRegions(e.target.value)} disabled={regionScope !== 'custom'} placeholder="Comma-separated: US, Canada, UK" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-gray-100" />
                <p className="mt-2 text-xs text-gray-500">
                  Active regions: {resolvedRegionPreview.length ? resolvedRegionPreview.join(', ') : 'Global fallback'}
                </p>
              </div>
              <div className="md:col-span-2">
                <label className="text-sm font-medium text-gray-700">Custom direction</label>
                <textarea value={customDirection} onChange={(e) => setCustomDirection(e.target.value)} rows={3} placeholder="Example: Track North America expansion, visa friction, and partnership signals for IT services." className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              </div>
            </div>

            <div className="mt-5">
              <label className="text-sm font-medium text-gray-700">Signal categories</label>
              <div className="mt-2 flex flex-wrap gap-2">
                {MARKET_PULSE_CATEGORIES.map((category) => {
                  const active = selectedCategories.includes(category);
                  return (
                    <button
                      key={category}
                      type="button"
                      onClick={() => toggleCategory(category)}
                      className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
                        active ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {toTitle(category)}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={runScan}
                disabled={running || loadingContext || selectedCategories.length === 0}
                className="inline-flex min-h-[56px] items-center gap-3 rounded-2xl bg-gray-900 px-7 py-4 text-base font-semibold text-white shadow-sm transition hover:bg-gray-800 disabled:opacity-50"
              >
                <Sparkles className="h-5 w-5" />
                {running ? 'Running scan...' : 'Run Market Pulse'}
              </button>
              {running && runId && (
                <button
                  type="button"
                  onClick={stopScan}
                  disabled={cancelLoading}
                  className="inline-flex min-h-[48px] items-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-5 py-3 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-50"
                >
                  {cancelLoading ? 'Stopping...' : 'Stop scan'}
                </button>
              )}
              {runResult?.run?.created_at && (
                <span className="text-sm text-gray-500">Last run: {new Date(runResult.run.created_at).toLocaleString()}</span>
              )}
            </div>
            {context && (
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-sm text-gray-700">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Market Focus</div>
                  <div className="mt-1">{context.marketPulseProfile.effective_market_focus?.join(', ') || 'Not set'}</div>
                </div>
                <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-sm text-gray-700">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Domain Role</div>
                  <div className="mt-1">{context.marketPulseProfile.domain_role || context.marketPulseProfile.provider_type || 'Not set'}</div>
                </div>
                <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-sm text-gray-700">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Policy Sensitivity</div>
                  <div className="mt-1">{context.marketPulseProfile.regulatory_policy_sensitivity?.join(', ') || 'Not set'}</div>
                </div>
              </div>
            )}
              </div>
            )}
          </section>

          {/* Phase 1B FEED — tier-grouped, action-rail-equipped finding cards.
              Replaces the four impact-grouped lists in the legacy Results section
              when at least one finding has a priority_tier (i.e. post-1A run). */}
          {runResult && runResult.findings.length > 0 && tieredFindings.P0.length + tieredFindings.P1.length + tieredFindings.P2.length > 0 && (
            <FeedSection
              tieredFindings={tieredFindings}
              actioningFindingId={actioningFindingId}
              findingStateOverrides={findingStateOverrides}
              performFindingAction={performFindingAction}
            />
          )}

          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-indigo-600" />
              <h4 className="text-sm font-semibold text-gray-900">Results</h4>
            </div>

            {!runResult && pendingRun && (
              <div className="mb-4">
                <EngineJobStatusPanel
                  status={String(pendingRun.status).toUpperCase()}
                  progressStage={pendingRun.progress_stage}
                  createdAt={pendingRun.created_at}
                  durationHint="Typically 1-5 min depending on regions and research mode"
                />
              </div>
            )}

            {runResult?.run?.status && ['pending', 'running', 'completed', 'completed_with_warnings', 'failed'].includes(String(runResult.run.status).toLowerCase()) && (
              <div className="mb-4">
                <EngineJobStatusPanel
                  status={String(runResult.run.status).toUpperCase()}
                  progressStage={runResult.run.progress_stage}
                  confidenceIndex={runResult.run.confidence_index}
                  error={runResult.run.legacy_error}
                  createdAt={runResult.run.created_at}
                  durationHint="Typically 1-5 min depending on regions and research mode"
                />
              </div>
            )}

            {!runResult && <div className="text-sm text-gray-500">Run a scan to see structured Market Pulse findings here.</div>}

            {runResult && (
              <div className="space-y-6">
                {/* Phase 1A: executive summary chip — surfaces strategic_summary
                    that the legacy consolidator already produced but V2 sync
                    was dropping on the floor. */}
                {runResult.run.strategic_summary && (
                  <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-indigo-700">Executive summary</div>
                    <p className="mt-2 text-sm text-indigo-900">{runResult.run.strategic_summary}</p>
                  </div>
                )}

                {/* Phase 1A: "What changed since last run" diff strip — combines
                    change_status counts (new/updated/unchanged/resolved) with
                    priority-tier counts (P0/P1/P2). */}
                {runResult.findings.length > 0 && (
                  <div className="rounded-xl border border-gray-200 bg-white p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">What changed</span>
                      {changeDiff.new > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
                          <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                          {changeDiff.new} new
                        </span>
                      )}
                      {changeDiff.updated > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                          {changeDiff.updated} updated
                        </span>
                      )}
                      {changeDiff.resolved > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          {changeDiff.resolved} resolved
                        </span>
                      )}
                      {changeDiff.unchanged > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600">
                          {changeDiff.unchanged} unchanged
                        </span>
                      )}
                      <span className="ml-2 inline-flex items-center gap-2 text-xs text-gray-500">
                        <span className="text-gray-400">·</span>
                        <span className="font-medium text-rose-700">{changeDiff.p0} P0</span>
                        <span className="font-medium text-amber-700">{changeDiff.p1} P1</span>
                        <span className="font-medium text-gray-500">{changeDiff.p2} P2</span>
                      </span>
                    </div>
                  </div>
                )}

                <div className="grid gap-4 md:grid-cols-4">
                  <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Status</div>
                    <div className="mt-1 text-sm font-semibold text-gray-900">{toTitle(runResult.run.status)}</div>
                  </div>
                  <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Findings</div>
                    <div className="mt-1 text-sm font-semibold text-gray-900">{runResult.findings.length}</div>
                  </div>
                  <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">New / Updated</div>
                    <div className="mt-1 text-sm font-semibold text-gray-900">{groupedFindings.top.length}</div>
                  </div>
                  <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Risks</div>
                    <div className="mt-1 text-sm font-semibold text-gray-900">{groupedFindings.risks.length}</div>
                  </div>
                </div>

                {/* Phase 1A: surface risk_alerts the consolidator emitted. */}
                {(runResult.run.risk_alerts ?? []).length > 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-700">Risk alerts</div>
                    <ul className="mt-2 space-y-1 text-sm text-amber-900">
                      {(runResult.run.risk_alerts ?? []).slice(0, 5).map((alert, idx) => (
                        <li key={idx}>• {alert}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {[
                  { title: 'Top Strategic Findings', items: groupedFindings.top },
                  { title: 'Risk Signals', items: groupedFindings.risks },
                  { title: 'Watch List', items: groupedFindings.watch },
                  { title: 'Opportunity Signals', items: groupedFindings.opportunities },
                ].map((section) => (
                  <div key={section.title}>
                    <h5 className="mb-3 text-sm font-semibold text-gray-900">{section.title}</h5>
                    {section.items.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-gray-200 p-4 text-sm text-gray-500">No items in this section yet.</div>
                    ) : (
                      <div className="space-y-3">
                        {section.items.map((item) => {
                          // Phase 1A: priority-tier ring + colored chip; falls back
                          // to neutral gray when priority_tier is null (legacy rows).
                          const tierRing = item.priority_tier === 'P0'
                            ? 'border-rose-300 ring-1 ring-rose-200'
                            : item.priority_tier === 'P1'
                              ? 'border-amber-200'
                              : 'border-gray-200';
                          const tierBadge = item.priority_tier === 'P0'
                            ? 'bg-rose-100 text-rose-800'
                            : item.priority_tier === 'P1'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-gray-100 text-gray-700';
                          const changeBadge = item.change_status === 'new'
                            ? 'bg-blue-100 text-blue-800'
                            : item.change_status === 'updated'
                              ? 'bg-amber-100 text-amber-800'
                              : item.change_status === 'resolved'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-gray-100 text-gray-600';
                          const confidenceColor = item.confidence_score >= 75
                            ? 'text-emerald-700'
                            : item.confidence_score >= 50
                              ? 'text-amber-700'
                              : 'text-gray-500';
                          return (
                            <div key={item.id} className={`rounded-xl border p-4 ${tierRing}`}>
                              <div className="flex flex-wrap items-center gap-2">
                                {item.priority_tier && (
                                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold tracking-wide ${tierBadge}`}>
                                    {item.priority_tier}
                                  </span>
                                )}
                                <span className="text-sm font-semibold text-gray-900">{item.title}</span>
                                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{toTitle(item.category)}</span>
                                <span className={`rounded-full px-2 py-0.5 text-xs ${changeBadge}`}>{toTitle(item.change_status)}</span>
                              </div>
                              <p className="mt-2 text-sm text-gray-600">{item.summary}</p>
                              <p className="mt-2 text-sm text-gray-800"><strong>Why it matters:</strong> {item.why_it_matters}</p>
                              <p className="mt-1 text-sm text-gray-800"><strong>Recommended action:</strong> {item.recommended_action}</p>
                              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                                <span className={`font-semibold ${confidenceColor}`}>
                                  Confidence {Math.round(item.confidence_score)}
                                </span>
                                <span className="text-gray-500">·</span>
                                <span className="font-semibold text-gray-700">Relevance {Math.round(item.relevance_score)}</span>
                                {typeof item.company_alignment_score === 'number' && (
                                  <>
                                    <span className="text-gray-500">·</span>
                                    <span className="font-semibold text-indigo-700">
                                      Alignment {Math.round((item.company_alignment_score ?? 0) * 100)}
                                    </span>
                                  </>
                                )}
                                <span className="text-gray-500">·</span>
                                <span className="text-gray-500">Regions: {item.regions?.length ? item.regions.join(', ') : 'Global'}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <h4 className="text-sm font-semibold text-gray-900">Recent runs</h4>
            <div className="mt-4 space-y-3">
              {history.length === 0 ? (
                <div className="text-sm text-gray-500">No Market Pulse history yet.</div>
              ) : (
                history.map((item) => (
                  <div key={item.id} className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-gray-900">{toTitle(item.status)}</span>
                      <span className="rounded-full bg-white px-2 py-0.5 text-xs text-gray-600">{toTitle(item.objective)}</span>
                      <span className="rounded-full bg-white px-2 py-0.5 text-xs text-gray-600">{item.mode === 'automated' ? 'Automated' : 'One-time'}</span>
                    </div>
                    <div className="mt-2 text-xs text-gray-500">
                      {new Date(item.created_at).toLocaleString()} · Credits: {item.credits_consumed ?? 0}
                    </div>
                    <div className="mt-2 text-sm text-gray-600">
                      {(item.categories || []).map(toTitle).join(', ') || 'No categories'}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        <aside className="space-y-6">
          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-600" />
              <h4 className="text-sm font-semibold text-gray-900">Automation</h4>
            </div>
            <p className="text-sm text-gray-600">
              When enabled, the Market Pulse cron runs once per UTC day (~04:30) for your company using the settings saved here. Each successful automated scan consumes credits.
            </p>
            <label className="mt-4 flex items-start gap-3 text-sm text-gray-700">
              <input type="checkbox" checked={automationEnabled} onChange={(e) => setAutomationEnabled(e.target.checked)} className="mt-1" />
              <span>Enable daily Market Pulse monitoring</span>
            </label>
            <label className="mt-3 flex items-start gap-3 text-sm text-gray-700">
              <input type="checkbox" checked={creditAcknowledged} onChange={(e) => setCreditAcknowledged(e.target.checked)} className="mt-1" />
              <span>I understand automated scans will consume credits on each completed run.</span>
            </label>
            <button type="button" onClick={saveAutomation} disabled={automationLoading || (automationEnabled && !creditAcknowledged)} className="mt-4 w-full rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-50">
              {automationLoading ? 'Saving...' : 'Save automation'}
            </button>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <h4 className="text-sm font-semibold text-gray-900">Profile-backed defaults</h4>
            <div className="mt-3 space-y-2 text-sm text-gray-600">
              <div><strong>Market focus:</strong> {context?.marketPulseProfile.effective_market_focus?.join(', ') || 'Not set'}</div>
              <div><strong>Domain role:</strong> {context?.marketPulseProfile.domain_role || context?.marketPulseProfile.provider_type || 'Not set'}</div>
              <div><strong>Solution domains:</strong> {context?.marketPulseProfile.solution_domains?.join(', ') || 'Not set'}</div>
              <div><strong>Policy sensitivity:</strong> {context?.marketPulseProfile.regulatory_policy_sensitivity?.join(', ') || 'Not set'}</div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
