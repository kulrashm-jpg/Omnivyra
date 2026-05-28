'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, ChevronUp, Compass, Layers, Loader2, Shield, Shuffle, Sparkles, Target, X, Zap } from 'lucide-react';
import { useCompanyContext } from '../CompanyContext';
import {
  CONTENT_ALIGNMENT_MODES,
  type ConfidenceBand,
  type ContentAlignmentMode,
  type GenerateLongFormRecommendationsResponse,
  type GenericityRiskLevel,
  type LongFormPrimaryUse,
  type LongFormRecommendation,
  type RecommendationFamilyCluster,
} from '../../backend/services/longForm/longFormRecommendationTypes';
import {
  LONG_FORM_CONTENT_TYPES,
  type LongFormContentType,
} from '../../lib/content/longFormContentTypeConfig';

interface Props {
  onSelectRecommendation?: (recommendation: LongFormRecommendation) => void;
}

const MODE_LABELS: Record<ContentAlignmentMode, string> = {
  company_context_led: 'Company-Context-Led',
  hybrid_editorial: 'Hybrid Editorial',
  independent_editorial: 'Independent Editorial',
};

const MODE_DESCRIPTIONS: Record<ContentAlignmentMode, string> = {
  company_context_led: 'Heavy company influence. Emerges from business capability + ICP pain.',
  hybrid_editorial: 'Educational first; company context still shapes perspective.',
  independent_editorial: 'Broad category content; minimal company influence (not generic filler).',
};

const RISK_STYLES: Record<GenericityRiskLevel, string> = {
  low: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  high: 'bg-rose-50 text-rose-700 border-rose-200',
};

const CONFIDENCE_STYLES: Record<ConfidenceBand, string> = {
  low: 'bg-rose-50 text-rose-800 border-rose-200',
  medium: 'bg-amber-50 text-amber-800 border-amber-200',
  high: 'bg-sky-50 text-sky-800 border-sky-200',
  exceptional: 'bg-emerald-50 text-emerald-800 border-emerald-200',
};

const PRIMARY_USE_LABELS: Record<LongFormPrimaryUse, string> = {
  long_form_educational: 'Educational long-form',
  authority_building: 'Authority building',
  seo_led_discoverability: 'SEO discovery',
  strategic_positioning: 'Strategic positioning',
  conversion_assist: 'Conversion assist',
  thought_leadership: 'Thought leadership',
  operational_deep_dive: 'Operational deep dive',
};

function ScoreBar({ label, score, accent }: { label: string; score: number; accent: string }) {
  const width = Math.max(2, Math.min(100, score));
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-32 shrink-0 text-slate-600">{label}</span>
      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
        <div className={`absolute inset-y-0 left-0 ${accent}`} style={{ width: `${width}%` }} />
      </div>
      <span className="w-8 shrink-0 text-right tabular-nums text-slate-700">{score}</span>
    </div>
  );
}

function ModePicker({
  value,
  onChange,
}: {
  value: ContentAlignmentMode;
  onChange: (mode: ContentAlignmentMode) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
      {CONTENT_ALIGNMENT_MODES.map((mode) => (
        <button
          key={mode}
          type="button"
          onClick={() => onChange(mode)}
          className={`rounded-lg border p-3 text-left transition ${
            value === mode
              ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500'
              : 'border-slate-200 bg-white hover:border-slate-300'
          }`}
        >
          <div className="text-sm font-semibold text-slate-900">{MODE_LABELS[mode]}</div>
          <div className="mt-1 text-xs text-slate-600">{MODE_DESCRIPTIONS[mode]}</div>
        </button>
      ))}
    </div>
  );
}

function ContentTypeFilter({
  value,
  onChange,
}: {
  value: LongFormContentType[];
  onChange: (next: LongFormContentType[]) => void;
}) {
  const toggle = (type: LongFormContentType) => {
    if (value.includes(type)) {
      onChange(value.filter((t) => t !== type));
    } else {
      onChange([...value, type]);
    }
  };
  return (
    <div className="flex flex-wrap gap-2">
      {LONG_FORM_CONTENT_TYPES.map((type) => {
        const active = value.includes(type);
        return (
          <button
            key={type}
            type="button"
            onClick={() => toggle(type)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
              active
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'
            }`}
          >
            {type}
          </button>
        );
      })}
    </div>
  );
}

function ExpandSection({
  label,
  icon,
  open,
  onToggle,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-slate-100">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600 hover:bg-slate-50"
      >
        <span className="flex items-center gap-2">
          {icon}
          {label}
        </span>
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
      {open && <div className="border-t border-slate-100 px-3 py-2 text-xs text-slate-700">{children}</div>}
    </div>
  );
}

function MetricChip({ label, value, intent }: { label: string; value: number | string; intent?: 'good' | 'warn' | 'bad' | 'neutral' }) {
  const tone =
    intent === 'good' ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
    : intent === 'warn' ? 'bg-amber-50 text-amber-800 border-amber-200'
    : intent === 'bad' ? 'bg-rose-50 text-rose-800 border-rose-200'
    : 'bg-slate-50 text-slate-700 border-slate-200';
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium tabular-nums ${tone}`}>
      <span className="opacity-70">{label}</span>
      <span>{value}</span>
    </span>
  );
}

function noveltyIntent(score?: number): 'good' | 'warn' | 'bad' | 'neutral' {
  if (score == null) return 'neutral';
  if (score >= 70) return 'good';
  if (score >= 35) return 'warn';
  return 'bad';
}

function RecommendationCard({
  recommendation,
  onSelect,
  cluster,
  siblings,
}: {
  recommendation: LongFormRecommendation;
  onSelect?: (recommendation: LongFormRecommendation) => void;
  cluster?: RecommendationFamilyCluster;
  siblings: LongFormRecommendation[];
}) {
  const [tracesOpen, setTracesOpen] = useState(false);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const toggle = (key: string) => setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  const risk = recommendation.genericityRiskLevel ?? 'low';

  // "Why it differs from others": compute the unique axes vs sibling cards.
  const uniqueAxes = useMemo(() => {
    const out: string[] = [];
    const sameArchetype = siblings.filter((s) => s.narrativeArchetype === recommendation.narrativeArchetype && s.recommendationId !== recommendation.recommendationId);
    if (sameArchetype.length === 0 && recommendation.narrativeArchetype) {
      out.push(`Only card with narrative archetype "${recommendation.narrativeArchetype.replace(/_/g, ' ')}".`);
    }
    const sameStage = siblings.filter((s) => s.targetBuyerStage === recommendation.targetBuyerStage && s.recommendationId !== recommendation.recommendationId);
    if (sameStage.length === 0) {
      out.push(`Only card targeting buyer stage "${recommendation.targetBuyerStage}".`);
    }
    const sameContentType = siblings.filter((s) => s.recommendedContentType === recommendation.recommendedContentType && s.recommendationId !== recommendation.recommendationId);
    if (sameContentType.length === 0) {
      out.push(`Only card recommending content type "${recommendation.recommendedContentType}".`);
    }
    const sameShape = siblings.filter((s) => s.narrativeShape === recommendation.narrativeShape && s.recommendationId !== recommendation.recommendationId);
    if (sameShape.length === 0 && recommendation.narrativeShape) {
      out.push(`Only card using narrative shape "${recommendation.narrativeShape.replace(/_/g, ' ')}".`);
    }
    if (out.length === 0) {
      out.push('Shares structural attributes with other cards; differentiated by editorial angle and operational proof.');
    }
    return out;
  }, [recommendation, siblings]);

  return (
    <article className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-indigo-700">
            {MODE_LABELS[recommendation.contentAlignmentMode]}
          </span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700">
            {recommendation.recommendedContentType}
          </span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700">
            stage: {recommendation.targetBuyerStage}
          </span>
          {recommendation.narrativeArchetype && recommendation.narrativeArchetype !== 'uncategorized' && (
            <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700">
              {recommendation.narrativeArchetype.replace(/_/g, ' ')}
            </span>
          )}
          {recommendation.confidence && (
            <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${CONFIDENCE_STYLES[recommendation.confidence.confidenceBand]}`}>
              {recommendation.confidence.confidenceBand} confidence · {recommendation.confidence.recommendationConfidenceScore}
            </span>
          )}
          {recommendation.suitability && (
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700">
              {PRIMARY_USE_LABELS[recommendation.suitability.recommendedPrimaryUse]}
            </span>
          )}
          <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${RISK_STYLES[risk]}`}>
            drift risk: {risk}
          </span>
          <span className="ml-auto rounded-md bg-slate-900 px-2 py-0.5 text-xs font-semibold text-white tabular-nums">
            score {recommendation.overallRecommendationStrength}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <MetricChip label="novelty" value={recommendation.recommendationNoveltyScore ?? '—'} intent={noveltyIntent(recommendation.recommendationNoveltyScore)} />
          <MetricChip label="shape uniqueness" value={recommendation.narrativeShapeUniquenessScore ?? '—'} intent={noveltyIntent(recommendation.narrativeShapeUniquenessScore)} />
          <MetricChip label="strategic depth" value={recommendation.authorityBuildingScore} intent={recommendation.authorityBuildingScore >= 60 ? 'good' : 'warn'} />
          <MetricChip label="operational specificity" value={recommendation.operationalDepthScore} intent={recommendation.operationalDepthScore >= 60 ? 'good' : 'warn'} />
          {cluster && <MetricChip label="cluster" value={cluster.familyClusterLabel} intent="neutral" />}
        </div>
        <h3 className="text-lg font-semibold leading-snug text-slate-900">
          {recommendation.recommendationTitle}
        </h3>
        <p className="text-sm leading-relaxed text-slate-700">{recommendation.editorialAngle}</p>
      </header>

      <section className="space-y-1.5">
        <ScoreBar label="Company alignment" score={recommendation.companyAlignmentScore} accent="bg-indigo-500" />
        <ScoreBar label="Authority building" score={recommendation.authorityBuildingScore} accent="bg-violet-500" />
        <ScoreBar label="Commercial relevance" score={recommendation.commercialRelevanceScore} accent="bg-emerald-500" />
        <ScoreBar label="Operational depth" score={recommendation.operationalDepthScore} accent="bg-amber-500" />
        <ScoreBar label="SEO opportunity" score={recommendation.seoOpportunityScore} accent="bg-sky-500" />
      </section>

      <section className="rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-700">
        <div className="mb-1 font-semibold uppercase tracking-wide text-slate-500">Why this fits the company</div>
        <div className="mb-1.5">{recommendation.whyThisFitsCompany.summary}</div>
        <ul className="space-y-1">
          <li><span className="font-medium">ICP problem:</span> {recommendation.whyThisFitsCompany.icpProblemMapping}</li>
          <li><span className="font-medium">Capability:</span> {recommendation.whyThisFitsCompany.capabilityConnection}</li>
          <li><span className="font-medium">Business origin:</span> {recommendation.whyThisFitsCompany.businessContextOrigin}</li>
        </ul>
      </section>

      <section className="text-xs leading-relaxed text-slate-700">
        <div className="mb-1 font-semibold uppercase tracking-wide text-slate-500">Strategic narrative</div>
        <p>{recommendation.strategicNarrative}</p>
      </section>

      <section className="grid grid-cols-1 gap-3 text-xs text-slate-700 md:grid-cols-2">
        <div>
          <div className="mb-1 font-semibold uppercase tracking-wide text-slate-500">Operational proof</div>
          <ul className="list-disc space-y-1 pl-4">
            {recommendation.recommendedContentDirection.operationalProof.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
        <div>
          <div className="mb-1 font-semibold uppercase tracking-wide text-slate-500">Avoid</div>
          <ul className="list-disc space-y-1 pl-4">
            {recommendation.recommendedContentDirection.avoidPatterns.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="space-y-1.5">
        <ExpandSection
          label="Why this matters operationally"
          icon={<Zap className="h-3.5 w-3.5 text-amber-500" />}
          open={!!openSections.operational}
          onToggle={() => toggle('operational')}
        >
          <p className="mb-1">{recommendation.recommendedContentDirection.primaryAngle}</p>
          {recommendation.recommendedContentDirection.operationalProof.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-4">
              {recommendation.recommendedContentDirection.operationalProof.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          )}
        </ExpandSection>

        <ExpandSection
          label="Which company capabilities influenced this"
          icon={<Layers className="h-3.5 w-3.5 text-indigo-500" />}
          open={!!openSections.capabilities}
          onToggle={() => toggle('capabilities')}
        >
          <div className="mb-1">{recommendation.whyThisFitsCompany.capabilityConnection}</div>
          {recommendation.originTrace && (
            <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-slate-600">
              {recommendation.originTrace.capabilityClustersContributed.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          )}
        </ExpandSection>

        <ExpandSection
          label="Which ICP pain generated this"
          icon={<Target className="h-3.5 w-3.5 text-rose-500" />}
          open={!!openSections.icp}
          onToggle={() => toggle('icp')}
        >
          <div className="mb-1">{recommendation.whyThisFitsCompany.icpProblemMapping}</div>
          {recommendation.originTrace && recommendation.originTrace.icpPainInfluences.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-slate-600">
              {recommendation.originTrace.icpPainInfluences.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          )}
        </ExpandSection>

        <ExpandSection
          label="Narrative family this belongs to"
          icon={<Compass className="h-3.5 w-3.5 text-violet-500" />}
          open={!!openSections.family}
          onToggle={() => toggle('family')}
        >
          <div className="mb-1">
            Archetype: <span className="font-medium">{recommendation.narrativeArchetype ?? 'uncategorized'}</span>
          </div>
          {cluster && (
            <>
              <div className="mb-1">
                Cluster: <span className="font-medium">{cluster.familyClusterLabel}</span>
              </div>
              <div className="text-[11px] text-slate-500">
                {cluster.suppressedDuplicateCount > 0
                  ? `${cluster.suppressedDuplicateCount} other candidate(s) collapsed into this cluster.`
                  : 'No near-duplicates collapsed into this cluster.'}
              </div>
            </>
          )}
          <div className="mt-1 text-[11px] text-slate-500">
            Editorial intent: {recommendation.narrativeShape?.replace(/_/g, ' ') ?? '—'}
          </div>
        </ExpandSection>

        <ExpandSection
          label="Why it differs from other recommendations"
          icon={<Shuffle className="h-3.5 w-3.5 text-emerald-500" />}
          open={!!openSections.differs}
          onToggle={() => toggle('differs')}
        >
          <ul className="list-disc space-y-0.5 pl-4">
            {uniqueAxes.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </ExpandSection>

        <ExpandSection
          label="Why it was prioritized"
          icon={<Sparkles className="h-3.5 w-3.5 text-indigo-500" />}
          open={!!openSections.priority}
          onToggle={() => toggle('priority')}
        >
          <p className="mb-1">
            Overall strength <span className="font-mono">{recommendation.overallRecommendationStrength}</span>: company alignment dominates (weight 0.32), then authority, commercial, operational, and SEO last.
          </p>
          {recommendation.alignmentDecisionTrace && (
            <div className="font-mono text-[11px] text-slate-500">
              {recommendation.alignmentDecisionTrace.scoringSummary}
            </div>
          )}
          {recommendation.confidence && (
            <div className="mt-2 border-t border-slate-100 pt-2">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Confidence contributors</div>
              <ul className="space-y-0.5 font-mono text-[11px] text-slate-600">
                {Object.entries(recommendation.confidence.contributorBreakdown).map(([k, v]) => (
                  <li key={k}>{k}: {v}</li>
                ))}
              </ul>
            </div>
          )}
        </ExpandSection>

        {recommendation.suitability && (
          <ExpandSection
            label="Recommended uses"
            icon={<Shield className="h-3.5 w-3.5 text-sky-500" />}
            open={!!openSections.suitability}
            onToggle={() => toggle('suitability')}
          >
            <div className="mb-1">
              <span className="font-medium">Primary:</span> {PRIMARY_USE_LABELS[recommendation.suitability.recommendedPrimaryUse]} —{' '}
              <span className="text-slate-500">{recommendation.suitability.primaryUseRationale}</span>
            </div>
            {recommendation.suitability.recommendedSecondaryUses.length > 0 && (
              <div className="mb-1">
                <span className="font-medium">Secondary:</span>{' '}
                {recommendation.suitability.recommendedSecondaryUses.map((u) => PRIMARY_USE_LABELS[u]).join(', ')}
              </div>
            )}
            {recommendation.suitability.unsuitableFor.length > 0 && (
              <div className="text-rose-700">
                <span className="font-medium">Unsuitable for:</span>{' '}
                {recommendation.suitability.unsuitableFor.map((u) => PRIMARY_USE_LABELS[u]).join(', ')}
              </div>
            )}
          </ExpandSection>
        )}
      </section>

      {recommendation.explanation && (
        <section className="rounded-lg border border-slate-100 bg-slate-50 p-3">
          <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            <span>Unified explanation</span>
            <span className="font-mono normal-case text-slate-400">{recommendation.explanation.reasoningSourceHash}</span>
          </div>
          <dl className="space-y-1.5 text-xs leading-relaxed text-slate-700">
            <div><dt className="inline font-semibold">Why this matters: </dt><dd className="inline">{recommendation.explanation.whyThisMatters}</dd></div>
            <div><dt className="inline font-semibold">Why this company: </dt><dd className="inline">{recommendation.explanation.whyThisCompany}</dd></div>
            <div><dt className="inline font-semibold">Why this ICP: </dt><dd className="inline">{recommendation.explanation.whyThisIcp}</dd></div>
            <div><dt className="inline font-semibold">Why now: </dt><dd className="inline">{recommendation.explanation.whyThisNow}</dd></div>
            <div><dt className="inline font-semibold">Why it differs: </dt><dd className="inline">{recommendation.explanation.whyThisDiffers}</dd></div>
            <div><dt className="inline font-semibold">Why it ranks: </dt><dd className="inline">{recommendation.explanation.whyThisRanksHighly}</dd></div>
            <div><dt className="inline font-semibold">Why operationally valuable: </dt><dd className="inline">{recommendation.explanation.whyThisIsOperationallyValuable}</dd></div>
          </dl>
          {recommendation.explanation.contradictions.length > 0 && (
            <div className="mt-2 rounded border border-rose-200 bg-rose-50 p-2 text-[11px] text-rose-700">
              <div className="font-semibold uppercase">Composer contradictions</div>
              <ul className="mt-1 list-disc pl-4">
                {recommendation.explanation.contradictions.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </div>
          )}
        </section>
      )}

      <footer className="flex items-center justify-between border-t border-slate-100 pt-3">
        <button
          type="button"
          onClick={() => setTracesOpen((v) => !v)}
          className="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700"
        >
          {tracesOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          {tracesOpen ? 'Hide raw diagnostics' : 'Show raw diagnostics'}
        </button>
        {onSelect && (
          <button
            type="button"
            onClick={() => onSelect(recommendation)}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
          >
            <Check className="h-4 w-4" />
            Use this recommendation
          </button>
        )}
      </footer>

      {tracesOpen && (
        <section className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
          <div className="mb-2 font-semibold uppercase tracking-wide text-slate-500">Raw diagnostics</div>
          {recommendation.alignmentDecisionTrace && (
            <div className="mb-3">
              <div className="font-medium">Alignment decision</div>
              <div>{recommendation.alignmentDecisionTrace.selectedModeReason}</div>
              {recommendation.alignmentDecisionTrace.caseStudyOverride && (
                <div className="text-rose-600">Case-study override applied.</div>
              )}
              <div className="font-mono text-[11px] text-slate-500">
                {recommendation.alignmentDecisionTrace.scoringSummary}
              </div>
              {recommendation.alignmentDecisionTrace.retriedFrom && (
                <div className="text-amber-700">Retried after initial validation failure.</div>
              )}
            </div>
          )}
          {recommendation.originTrace && (
            <div>
              <div className="font-medium">Origin signals</div>
              <ul className="mt-1 space-y-0.5">
                {recommendation.originTrace.companySignalsUsed.map((sig, i) => (
                  <li key={i} className="font-mono text-[11px] text-slate-500">
                    [{sig.influence}] {String(sig.section)}: {sig.signal.slice(0, 80)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </article>
  );
}

function CoverageBar({ label, ratio }: { label: string; ratio: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-32 shrink-0 text-slate-600">{label}</span>
      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
        <div className="absolute inset-y-0 left-0 bg-emerald-500" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 shrink-0 text-right tabular-nums text-slate-700">{pct}</span>
    </div>
  );
}

function BatchSummaryPanel({ response }: { response: GenerateLongFormRecommendationsResponse }) {
  const { setCoverage, batchDiagnostics, clusterDiversityReport, entropyStabilization, lifecycleDiagnostics } = response;
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
        <Compass className="h-4 w-4 text-indigo-500" />
        Recommendation set diagnostics
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Coverage</div>
          <CoverageBar label="ICP" ratio={setCoverage.icpCoverage.ratio} />
          <CoverageBar label="Capability" ratio={setCoverage.capabilityCoverage.ratio} />
          <CoverageBar label="Narrative archetype" ratio={setCoverage.narrativeCoverage.ratio} />
          <CoverageBar label="Maturity" ratio={setCoverage.maturityCoverage.ratio} />
          <CoverageBar label="Funnel stage" ratio={setCoverage.funnelStageCoverage.ratio} />
          <div className="pt-1 text-xs text-slate-600">
            Overall diversity score: <span className="font-semibold tabular-nums">{setCoverage.overallDiversityScore}</span>
          </div>
        </div>
        <div className="space-y-1 text-xs text-slate-700">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Batch diagnostics</div>
          <div>Clusters: <span className="font-medium tabular-nums">{clusterDiversityReport.clusterCount}</span> / candidates {clusterDiversityReport.totalCandidates}</div>
          <div>Cluster diversity: <span className="font-medium tabular-nums">{clusterDiversityReport.clusterDiversityScore}</span></div>
          <div>Cluster suppressions: <span className="font-medium tabular-nums">{batchDiagnostics.rejectedClusterCount}</span></div>
          <div>Diversity suppressions: <span className="font-medium tabular-nums">{batchDiagnostics.diversitySuppressionCount}</span></div>
          <div>Archetype entropy: <span className="font-medium tabular-nums">{batchDiagnostics.recommendationEntropyScore}</span></div>
          <div>Avg shape uniqueness: <span className="font-medium tabular-nums">{batchDiagnostics.narrativeShapeEntropy}</span></div>
          <div>
            Novelty distribution: low {batchDiagnostics.noveltyDistribution.low}, mid {batchDiagnostics.noveltyDistribution.medium}, high {batchDiagnostics.noveltyDistribution.high}
          </div>
          <div>Retry rounds: <span className="font-medium tabular-nums">{batchDiagnostics.retryEffectiveness.roundsUsed}</span></div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 border-t border-slate-100 pt-4 md:grid-cols-2">
        <div className="space-y-1 text-xs text-slate-700">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Entropy stabilization</div>
          <div>Coherence: <span className="font-medium tabular-nums">{entropyStabilization.batchCoherenceScore}</span></div>
          <div>Stability (harmonic): <span className="font-medium tabular-nums">{entropyStabilization.batchEntropyStabilityScore}</span></div>
          <div>Diversity shift (post-pre): <span className="font-medium tabular-nums">{entropyStabilization.diversityShift >= 0 ? '+' : ''}{entropyStabilization.diversityShift}</span></div>
          {entropyStabilization.warnings.length > 0 && (
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-amber-700">
              {entropyStabilization.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
        </div>
        <div className="space-y-1 text-xs text-slate-700">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Lifecycle</div>
          <div>
            Confidence: low {lifecycleDiagnostics.confidenceDistribution.low} · med {lifecycleDiagnostics.confidenceDistribution.medium} · high {lifecycleDiagnostics.confidenceDistribution.high} · exc {lifecycleDiagnostics.confidenceDistribution.exceptional}
          </div>
          <div>Active registry size: <span className="font-medium tabular-nums">{lifecycleDiagnostics.activeRegistrySize}</span></div>
          <div>Continuity degradations: <span className="font-medium tabular-nums">{lifecycleDiagnostics.continuityDegradationCount}</span></div>
          <div>Inheritance losses: <span className="font-medium tabular-nums">{lifecycleDiagnostics.plannerInheritanceLossCount}</span></div>
          <div>Semantic drift events: <span className="font-medium tabular-nums">{lifecycleDiagnostics.semanticDriftFrequency}</span></div>
          <div>Avg rec age: <span className="font-medium tabular-nums">{lifecycleDiagnostics.averageRecommendationAgeSeconds}s</span></div>
          <div>Stabilization effectiveness: <span className="font-medium tabular-nums">{lifecycleDiagnostics.entropyStabilizationEffectiveness}</span></div>
        </div>
      </div>
    </section>
  );
}

export default function LongFormRecommendationCards({ onSelectRecommendation }: Props = {}) {
  const { selectedCompanyId } = useCompanyContext();
  const [mode, setMode] = useState<ContentAlignmentMode>('hybrid_editorial');
  const [contentTypes, setContentTypes] = useState<LongFormContentType[]>([]);
  const [seedTopicsInput, setSeedTopicsInput] = useState('');
  const [limit, setLimit] = useState(6);
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<GenerateLongFormRecommendationsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejectedOpen, setRejectedOpen] = useState(false);

  const seedTopics = useMemo(
    () =>
      seedTopicsInput
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean),
    [seedTopicsInput],
  );

  const onGenerate = useCallback(async () => {
    if (!selectedCompanyId) {
      setError('Select a company first.');
      return;
    }
    setLoading(true);
    setError(null);
    setResponse(null);
    try {
      const res = await fetch('/api/recommendations/long-form/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: selectedCompanyId,
          requestedMode: mode,
          contentTypes: contentTypes.length > 0 ? contentTypes : undefined,
          limit,
          seedTopics: seedTopics.length > 0 ? seedTopics : undefined,
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        if (payload?.error === 'INSUFFICIENT_COMPANY_CONTEXT') {
          setError(
            `Company context is too sparse (${payload.foundationCompletion}% complete, ${payload.populatedSections?.length ?? 0}/5 sections populated). Enrich the company profile before generating long-form recommendations.`,
          );
        } else {
          setError(payload?.detail || payload?.error || `Request failed (${res.status})`);
        }
        return;
      }
      setResponse(payload as GenerateLongFormRecommendationsResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [selectedCompanyId, mode, contentTypes, limit, seedTopics]);

  return (
    <div className="space-y-6">
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <Sparkles className="h-4 w-4 text-indigo-500" />
            Long-form recommendations
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Recommendations emerge from your company's capability, ICP problems, and strategic POV — not generic SEO topics.
          </p>
        </div>

        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Content alignment mode</div>
          <ModePicker value={mode} onChange={setMode} />
        </div>

        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Content types (optional — all if none selected)
          </div>
          <ContentTypeFilter value={contentTypes} onChange={setContentTypes} />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Seed topics (optional, comma or newline separated)
            </label>
            <textarea
              rows={3}
              value={seedTopicsInput}
              onChange={(e) => setSeedTopicsInput(e.target.value)}
              placeholder="e.g. operational governance, AI agent observability"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              How many recommendations
            </label>
            <input
              type="number"
              min={1}
              max={12}
              value={limit}
              onChange={(e) => setLimit(Math.max(1, Math.min(12, Number(e.target.value) || 6)))}
              className="w-32 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onGenerate}
            disabled={loading || !selectedCompanyId}
            className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {loading ? 'Generating…' : 'Generate recommendations'}
          </button>
          {response && (
            <div className="text-xs text-slate-500">
              Foundation: {response.foundationCompletion}% complete · {response.recommendations.length} accepted
              · {response.rejected.length} rejected · {response.llmRefinementCalls} LLM call(s)
              {response.retryUsed && <span className="ml-2 text-amber-600">retry used</span>}
            </div>
          )}
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>{error}</div>
          </div>
        )}
      </section>

      {response && response.recommendations.length > 0 && (
        <>
          <BatchSummaryPanel response={response} />
          <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {response.recommendations.map((rec) => {
              const cluster = response.clusterDiversityReport.clusters.find(
                (c) => c.familyClusterId === rec.familyClusterId,
              );
              return (
                <RecommendationCard
                  key={rec.recommendationId}
                  recommendation={rec}
                  onSelect={onSelectRecommendation}
                  cluster={cluster}
                  siblings={response.recommendations}
                />
              );
            })}
          </section>
        </>
      )}

      {response && response.rejected.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <button
            type="button"
            onClick={() => setRejectedOpen((v) => !v)}
            className="flex w-full items-center justify-between text-sm font-semibold text-slate-700"
          >
            <span className="flex items-center gap-2">
              <X className="h-4 w-4 text-rose-500" />
              Rejected candidates ({response.rejected.length})
            </span>
            {rejectedOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {rejectedOpen && (
            <ul className="mt-3 space-y-2 text-xs text-slate-700">
              {response.rejected.map((rej, i) => (
                <li key={i} className="rounded-md border border-slate-100 bg-slate-50 p-2">
                  <div className="font-medium text-slate-900">{rej.candidateTitle}</div>
                  <div className="text-slate-500">mode: {rej.mode}</div>
                  <div className="mt-1 font-mono text-[11px] text-rose-700">{rej.reason}</div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
