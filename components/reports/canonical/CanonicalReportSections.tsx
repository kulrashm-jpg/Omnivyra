'use client';

import {
  EvidenceRow,
  MaturityBadge,
  PillarCard,
  Score,
  TrustEnvelope,
  type CanonicalScore,
  type ConfidenceBand,
  type EvidenceTrace,
  type PillarKey,
  type SystemMaturityClass,
} from './CanonicalPrimitives';
import DiscoverabilityAuthorityRadar from './DiscoverabilityAuthorityRadar';
import ActionPlaybook from './ActionPlaybook';
import AICitationMatrix from './AICitationMatrix';
import AuthorityMaturityModel from './AuthorityMaturityModel';
import EvidenceTraceDrawer from './EvidenceTraceDrawer';
import ExecutiveInsightsSection from './ExecutiveInsightsSection';
import StrategicPlaybookSection from './StrategicPlaybookSection';
import {
  EvidenceTraceProvider,
  ProductionEvidenceDrawer,
} from './EvidenceTraceContext';
import OverrideBadge from './OverrideBadge';
import ComparisonStrip from './ComparisonStrip';
import AdminIntelligenceConsole from './AdminIntelligenceConsole';

// ── Type mirrors ──────────────────────────────────────────────────────────────

export type CanonicalNarrative = {
  text: string;
  confidence: ConfidenceBand;
  evidence: EvidenceTrace;
  maturity: SystemMaturityClass;
};

export type CanonicalDimensionView = {
  key: string;
  label: string;
  pillar: PillarKey;
  score: CanonicalScore;
  rationale: string;
};

export type CanonicalPillarView = {
  pillar: PillarKey;
  label: string;
  purpose: string;
  score: CanonicalScore;
  dimensions: CanonicalDimensionView[];
  primary_signal: string | null;
};

export type CanonicalReportView = {
  authority_overview: {
    headline: CanonicalNarrative;
    overall_score: CanonicalScore;
    maturity: SystemMaturityClass;
    primary_constraint: CanonicalNarrative;
    next_unlock: CanonicalNarrative;
  };
  discoverability_authority_radar: {
    axes: CanonicalDimensionView[];
    overall_confidence: ConfidenceBand;
    benchmark_label: string | null;
    competitor_overlay: Array<{ label: string; values: Record<string, number | undefined> }>;
  };
  pillars: CanonicalPillarView[];
  ai_surface_presence: {
    score: CanonicalScore;
    rationale: CanonicalNarrative;
    citation_matrix: any | null;
  };
  knowledge_graph: { score: CanonicalScore; rationale: CanonicalNarrative; entity?: any };
  authority_inflow?: { score: CanonicalScore; rationale: CanonicalNarrative; profile?: any };
  trust_coherence?: { score: CanonicalScore; rationale: CanonicalNarrative; signals?: any };
  benchmark?: { state: string; overlay?: any; rationale: CanonicalNarrative };
  maturity_stage?: {
    stage: 'insufficient_signal' | 'foundational' | 'emerging' | 'developing' | 'operational' | 'advanced' | 'leading';
    label: string;
    next_stage: string | null;
    why_this_stage: string;
    blocker: { pillar: PillarKey | null; explanation: string };
    unlock: { pillar: PillarKey | null; explanation: string };
    confidence: ConfidenceBand;
    evidence: EvidenceTrace;
  };
  competitive_surface_share: {
    user: Record<string, number | undefined>;
    competitor_average: Record<string, number | undefined>;
    competitors: Array<{ name: string; values: Record<string, number | undefined> }>;
    confidence: ConfidenceBand;
    summary: CanonicalNarrative;
  };
  authority_trajectory: {
    snapshots: Array<{
      observed_at: string;
      score: CanonicalScore;
      maturity: SystemMaturityClass;
    }>;
    forecast: { horizon_days: number; projected_score: CanonicalScore } | null;
    available: boolean;
  };
  action_playbook: {
    actions: Array<{
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
    }>;
    summary: CanonicalNarrative;
  };
  evidence_trace: {
    by_dimension: Record<string, EvidenceTrace | undefined>;
    by_pillar: Partial<Record<PillarKey, EvidenceTrace>>;
    overall: EvidenceTrace;
  };
  executive_insights?: {
    headline_thesis: CanonicalNarrative;
    primary_constraint: CanonicalNarrative;
    next_unlock: CanonicalNarrative;
    strategic_opportunity: CanonicalNarrative;
    authority_risk: CanonicalNarrative;
    momentum_interpretation: CanonicalNarrative;
  };
  strategic_playbook?: {
    actions: any[];
    critical_path_ids: string[];
    parallel_track_ids: string[];
    sequence_narrative: string;
  };
};

// ── Section: Authority Overview ───────────────────────────────────────────────
//
// The single executive surface. Replaces the five separate exec summary blocks
// (SEO, GEO/AEO, Competitor, Unified, decision_snapshot).

export function AuthorityOverview({ data }: { data: CanonicalReportView['authority_overview'] }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
            Authority Overview
          </p>
          <h2 className="mt-1 text-2xl font-bold text-slate-900">Where the brand stands</h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            One executive surface. Maturity tier, overall authority index, primary constraint, and
            the next unlock — all evidence-backed, all confidence-aware.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <MaturityBadge maturity={data.maturity} />
        </div>
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_2fr]">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Authority Index
          </p>
          <div className="mt-3">
            <Score score={data.overall_score} size="xl" showBand showEvidence />
          </div>
          <EvidenceRow evidence={data.overall_score.evidence} />
        </div>

        <div className="space-y-4">
          <TrustEnvelope narrative={data.headline} />

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                Primary constraint
              </p>
              <p className="mt-2 text-sm leading-relaxed text-slate-800">
                {data.primary_constraint.text}
              </p>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
                Next unlock
              </p>
              <p className="mt-2 text-sm leading-relaxed text-slate-800">{data.next_unlock.text}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Section: Pillar Grid ──────────────────────────────────────────────────────

export function PillarGrid({ pillars }: { pillars: CanonicalPillarView[] }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Pillars</p>
        <h3 className="mt-1 text-xl font-bold text-slate-900">
          Foundation · Authority · Discoverability · Trust · Momentum
        </h3>
        <p className="mt-2 text-sm text-slate-600">
          Every metric in the report maps to one of these five pillars. No orphan metrics, no
          duplicate semantics — one canonical hierarchy.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {pillars.map((pillar) => (
          <PillarCard
            key={pillar.pillar}
            pillar={pillar.pillar}
            label={pillar.label}
            purpose={pillar.purpose}
            score={pillar.score}
            primarySignal={pillar.primary_signal}
            dimensions={pillar.dimensions}
          />
        ))}
      </div>
    </section>
  );
}

// ── Section: AI Surface Presence (architecture stub for Phase 3) ──────────────

export function AiSurfacePresenceSection({
  data,
}: {
  data: CanonicalReportView['ai_surface_presence'];
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
        AI Surface Presence
      </p>
      <h3 className="mt-1 text-xl font-bold text-slate-900">How citable the site looks for AI answers</h3>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_2fr]">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Surface Score
          </p>
          <div className="mt-3">
            <Score score={data.score} size="xl" showBand showEvidence />
          </div>
        </div>
        <TrustEnvelope narrative={data.rationale} />
      </div>
    </section>
  );
}

// ── Section: Knowledge Graph & Entity Strength (architecture stub for Phase 3) ─

export function KnowledgeGraphSection({
  data,
}: {
  data: CanonicalReportView['knowledge_graph'];
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
        Knowledge Graph & Entity Strength
      </p>
      <h3 className="mt-1 text-xl font-bold text-slate-900">
        How clearly the brand reads as an entity
      </h3>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_2fr]">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Entity Score
          </p>
          <div className="mt-3">
            <Score score={data.score} size="xl" showBand showEvidence />
          </div>
        </div>
        <TrustEnvelope narrative={data.rationale} />
      </div>
    </section>
  );
}

// ── Section: Competitive Surface Share ────────────────────────────────────────

export function CompetitiveSurfaceShareSection({
  data,
  axes,
}: {
  data: CanonicalReportView['competitive_surface_share'];
  axes: CanonicalDimensionView[];
}) {
  const overlayAxes = axes.filter((axis) => {
    const userVal = data.user[axis.key];
    const compVal = data.competitor_average[axis.key];
    return typeof userVal === 'number' || typeof compVal === 'number';
  });

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
        Competitive Surface Share
      </p>
      <h3 className="mt-1 text-xl font-bold text-slate-900">How you compare on the canonical axes</h3>

      <div className="mt-4">
        <TrustEnvelope narrative={data.summary} />
      </div>

      {overlayAxes.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
          No overlap signal observed yet between you and your competitors on the canonical axes.
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {overlayAxes.map((axis) => {
            const userVal = data.user[axis.key];
            const compVal = data.competitor_average[axis.key];
            const userBar = typeof userVal === 'number' ? Math.max(0, Math.min(100, userVal)) : null;
            const compBar = typeof compVal === 'number' ? Math.max(0, Math.min(100, compVal)) : null;
            return (
              <div key={axis.key} className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-800">{axis.label}</span>
                  <span className="text-slate-500">
                    You {userBar ?? '—'} vs Competitors {compBar ?? '—'}
                  </span>
                </div>
                <div className="mt-2 grid gap-2">
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    {userBar != null ? <div className="h-full rounded-full bg-blue-500" style={{ width: `${userBar}%` }} /> : null}
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    {compBar != null ? <div className="h-full rounded-full bg-amber-500" style={{ width: `${compBar}%` }} /> : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {data.competitors.length > 0 ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {data.competitors.map((competitor) => (
            <div
              key={competitor.name}
              className="rounded-lg border border-slate-200 bg-slate-50 p-3"
            >
              <p className="text-sm font-semibold text-slate-900">{competitor.name}</p>
              <p className="mt-1 text-xs text-slate-600">
                {Object.entries(competitor.values)
                  .filter(([, v]) => typeof v === 'number')
                  .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)
                  .join(' · ') || 'No measured axis'}
              </p>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

// ── Section: Authority Trajectory (architecture stub) ─────────────────────────

export function AuthorityTrajectorySection({
  data,
}: {
  data: CanonicalReportView['authority_trajectory'];
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
        Authority Trajectory
      </p>
      <h3 className="mt-1 text-xl font-bold text-slate-900">Maturity over time</h3>

      {data.snapshots.length === 0 ? (
        <p className="mt-3 text-sm text-slate-600">
          Trajectory will appear once at least two report snapshots have been observed for this
          brand. The data shape is canonical — historical scoring lands in Phase 3.
        </p>
      ) : (
        <ol className="mt-4 space-y-2 text-sm text-slate-700">
          {data.snapshots.map((snap) => (
            <li key={snap.observed_at} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
              <span>{new Date(snap.observed_at).toLocaleDateString()}</span>
              <Score score={snap.score} size="sm" showBand showEvidence={false} />
              <MaturityBadge maturity={snap.maturity} size="sm" />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// ── Top-level renderer ────────────────────────────────────────────────────────

export default function CanonicalReportSections({ report }: { report: CanonicalReportView }) {
  // Phase 4: every score / radar axis / recommendation can open the production
  // evidence drawer scoped to its own evidence. The provider wraps the whole
  // canonical report so any nested component can call useEvidenceTrace().
  const recommendationsById: Record<string, EvidenceTrace> = {};
  for (const action of report.action_playbook.actions) {
    recommendationsById[action.id] = action.evidence;
  }

  // Phase 6: extract optional governance / overrides / comparison /
  // observability surfaces. The canonical builder always populates them when
  // `companyId` is present; legacy snapshots without them simply omit the UI.
  const activeOverrides = (report as any).active_overrides ?? [];
  const comparison = (report as any).comparison;
  const governance = (report as any).governance;
  const providerObservability = (report as any).provider_observability;
  const scanMetadata = (report as any).scan_metadata;

  return (
    <EvidenceTraceProvider>
    <div className="space-y-6">
      {activeOverrides.length > 0 ? <OverrideBadge overrides={activeOverrides} /> : null}
      {report.executive_insights ? <ExecutiveInsightsSection data={report.executive_insights} /> : null}
      <AuthorityOverview data={report.authority_overview} />
      {report.maturity_stage ? <AuthorityMaturityModel data={report.maturity_stage} /> : null}
      <DiscoverabilityAuthorityRadar
        axes={report.discoverability_authority_radar.axes}
        overallConfidence={report.discoverability_authority_radar.overall_confidence}
        benchmarkLabel={report.discoverability_authority_radar.benchmark_label}
        competitorOverlay={report.discoverability_authority_radar.competitor_overlay}
      />
      <PillarGrid pillars={report.pillars} />
      {report.ai_surface_presence.citation_matrix ? (
        <AICitationMatrix data={report.ai_surface_presence.citation_matrix} />
      ) : (
        <AiSurfacePresenceSection data={report.ai_surface_presence} />
      )}
      <KnowledgeGraphSection data={report.knowledge_graph} />
      {report.authority_inflow ? <AuthorityInflowSection data={report.authority_inflow} /> : null}
      {report.trust_coherence ? <TrustCoherenceSection data={report.trust_coherence} /> : null}
      {report.benchmark ? <BenchmarkOverlaySection data={report.benchmark} /> : null}
      <CompetitiveSurfaceShareSection
        data={report.competitive_surface_share}
        axes={report.discoverability_authority_radar.axes}
      />
      <AuthorityTrajectorySection data={report.authority_trajectory} />
      {report.strategic_playbook && report.strategic_playbook.actions.length > 0 ? (
        <StrategicPlaybookSection data={report.strategic_playbook} />
      ) : (
        <ActionPlaybook
          actions={report.action_playbook.actions}
          summary={report.action_playbook.summary}
        />
      )}
      {comparison ? (
        <ComparisonStrip
          prior={comparison.prior_snapshot_strip}
          benchmark={comparison.benchmark_strip}
          maturityProgression={comparison.maturity_progression}
        />
      ) : null}
      {governance && providerObservability && scanMetadata ? (
        <AdminIntelligenceConsole
          observability={providerObservability}
          scanMetadata={scanMetadata}
          governance={governance}
        />
      ) : null}
      <EvidenceTraceDrawer
        evidenceByDimension={report.evidence_trace.by_dimension}
        evidenceByPillar={report.evidence_trace.by_pillar}
        overall={report.evidence_trace.overall}
      />
    </div>
    {/* Production evidence drawer: any component within the provider can
        invoke `useEvidenceTrace().open({...})` to scope the drawer to its
        evidence. Renders outside the document flow as a slide-in panel. */}
    <ProductionEvidenceDrawer
      evidenceByDimension={report.evidence_trace.by_dimension}
      evidenceByPillar={report.evidence_trace.by_pillar}
      overall={report.evidence_trace.overall}
      recommendationsById={recommendationsById}
    />
    </EvidenceTraceProvider>
  );
}

// ── Section: Authority Inflow ─────────────────────────────────────────────────

function AuthorityInflowSection({ data }: { data: NonNullable<CanonicalReportView['authority_inflow']> }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Authority Inflow</p>
      <h3 className="mt-1 text-xl font-bold text-slate-900">Real backlinks, real domain authority</h3>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_2fr]">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Inflow Score</p>
          <div className="mt-3">
            <Score score={data.score} size="xl" showBand showEvidence />
          </div>
        </div>
        <TrustEnvelope narrative={data.rationale} />
      </div>

      {data.profile && data.profile.state === 'measured' ? (
        <dl className="mt-4 grid gap-3 text-xs text-slate-600 sm:grid-cols-3">
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <dt className="font-semibold uppercase tracking-wide text-slate-500">Referring domains</dt>
            <dd className="mt-1 text-base font-bold text-slate-900">{data.profile.referring_domains ?? '—'}</dd>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <dt className="font-semibold uppercase tracking-wide text-slate-500">Total backlinks</dt>
            <dd className="mt-1 text-base font-bold text-slate-900">{data.profile.total_backlinks ?? '—'}</dd>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <dt className="font-semibold uppercase tracking-wide text-slate-500">Domain authority</dt>
            <dd className="mt-1 text-base font-bold text-slate-900">{data.profile.domain_authority ?? '—'}</dd>
          </div>
        </dl>
      ) : null}
    </section>
  );
}

// ── Section: Trust Coherence ──────────────────────────────────────────────────

function TrustCoherenceSection({ data }: { data: NonNullable<CanonicalReportView['trust_coherence']> }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Trust Coherence</p>
      <h3 className="mt-1 text-xl font-bold text-slate-900">Consistency, expertise, and reputation parity</h3>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_2fr]">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Coherence Score</p>
          <div className="mt-3">
            <Score score={data.score} size="xl" showBand showEvidence />
          </div>
        </div>
        <TrustEnvelope narrative={data.rationale} />
      </div>
    </section>
  );
}

// ── Section: Benchmark Overlay ────────────────────────────────────────────────

function BenchmarkOverlaySection({ data }: { data: NonNullable<CanonicalReportView['benchmark']> }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Benchmark</p>
      <h3 className="mt-1 text-xl font-bold text-slate-900">Vertical-relative positioning</h3>

      <div className="mt-3">
        <TrustEnvelope narrative={data.rationale} />
      </div>

      {data.overlay && data.state === 'measured' ? (
        <dl className="mt-4 grid gap-3 text-xs text-slate-600 sm:grid-cols-3">
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <dt className="font-semibold uppercase tracking-wide text-slate-500">Vertical</dt>
            <dd className="mt-1 text-sm font-bold text-slate-900">{data.overlay.vertical ?? '—'}</dd>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <dt className="font-semibold uppercase tracking-wide text-slate-500">Peers</dt>
            <dd className="mt-1 text-sm font-bold text-slate-900">{data.overlay.peer_count ?? '—'}</dd>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <dt className="font-semibold uppercase tracking-wide text-slate-500">Percentile</dt>
            <dd className="mt-1 text-sm font-bold text-slate-900">
              {data.overlay.percentile != null ? `${data.overlay.percentile}th` : '—'}
            </dd>
          </div>
        </dl>
      ) : null}
    </section>
  );
}
