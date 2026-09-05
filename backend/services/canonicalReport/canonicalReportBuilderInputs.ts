/** Canonical report — provider inputs, normalization, scoring prep — split from canonicalReportBuilder.ts (barrel preserved; importers unchanged). */
import {
  CANONICAL_DIMENSIONS,
  PILLAR_META,
  type AICitationMatrixSummary,
  type AuthorityInflowSummary,
  type BenchmarkOverlaySummary,
  type CanonicalAction,
  type CanonicalDimension,
  type CanonicalDimensionKey,
  type CanonicalDeclaredEvidence,
  type CanonicalNarrative,
  type CanonicalPillarScore,
  type CanonicalReport,
  type CanonicalScore,
  type ConfidenceBand,
  type EntityIntelligenceSummary,
  type EvidenceObservation,
  type EvidenceSourceKind,
  type EvidenceTrace,
  type PillarKey,
  type ScoreState,
  type SystemMaturityClass,
  type TrustCoherenceSummary,
  canonicalBandFromValue,
  emptyCanonicalScore,
  emptyEvidenceTrace,
} from './canonicalReportTypes';
// BETA-EXEC-003: canonical scoring-governance registry (aggregation formula + confidence
// thresholds). Consolidation only — identical behaviour.
import { geometricMean, confidenceBandFromCount, CONFIDENCE_EVIDENCE } from './scoringGovernance';
// GAP-07 — the provenance policy, now with a runtime consumer. Imported, never re-implemented.
import { isReport1Source, provenanceForSource, type EvidenceProvenanceClass } from '../evidenceProvenance';
import { buildImprovementTodos } from './improvementTodoBuilder';
import { resolveReportRoiDeterminability } from './reportRoiDeterminability';
import { resolveTrajectoryProvenance, resolveCompetitorProvenance } from './reportProvenance';
import { resolveOverrideTransparency } from './reportOverrideTransparency';
import { resolveEvidenceReadiness } from './reportEvidenceReadiness';
// BETA-EXEC-004: deterministic engine-evidence contract for evidence-driven dimension rationales.
import {
  type EngineEvidenceInput,
  readTechnical,
  readContent,
  readAccessibility,
  readBrand,
  enrichRationale,
} from '../snapshotReport/engineEvidenceNarrative';
import {
  maturityNarrativeAdjective,
} from '../snapshotReport/canonicalScoreState';
import type { SnapshotReport } from '../snapshotReportTypes';
import { buildAICitationMatrix, deriveCitationQueries } from '../intelligence/aiCitationMatrixService';
import {
  getKnowledgeGraphProvider,
  getAuthorityInflowProvider,
  getTrustCoherenceProvider,
  getBenchmarkProvider,
  getTrajectoryProvider,
  getCommercialProvider,
} from '../intelligence/providerRegistry';
import { classifyMaturity, legacyClassFromStage } from '../intelligence/authorityMaturityModel';
import { buildExecutiveInsights } from '../intelligence/executiveInsightEngine';
import { buildStrategicPlaybook } from '../intelligence/strategicRecommendationEngine';
import type { AICitationMatrix } from '../intelligence/aiCitationMatrixService';
import { persistCanonicalSnapshot, type ScanProfile } from '../intelligence/snapshotWriter';
import { policyFor } from '../intelligence/executionPolicies';
import { buildChangeIntelligence } from '../intelligence/deltaIntelligence';
import { buildForecast } from '../intelligence/forecastService';
import { buildProviderObservability } from '../intelligence/providerObservability';
import { applyChangeAwareness } from '../intelligence/changeAwareInsights';
import { getHistoricalStore } from '../intelligence/historicalPersistence';
import { loadTenantPolicy, type TenantContext } from '../intelligence/tenantGovernance';
import { loadActiveOverrides, indexActiveOverridesByActionId, indexActiveOverridesByDimension } from '../intelligence/manualOverrides';
import { logAuditEvent } from '../intelligence/auditLog';
import { buildExplanationIndex } from '../intelligence/explainabilityEngine';
import { buildComparisonView } from '../intelligence/comparisonEngine';
import { getCollaborationStore } from '../intelligence/collaboration';
import type {
  AuthorityInflowResult,
  AuthorityTrajectoryResult,
  BenchmarkResult,
  EntityIntelligenceResult,
  TrustCoherenceResult,
} from '../intelligence/providerInterfaces';

// ── Score-state helpers ───────────────────────────────────────────────────────


function bandFromCount(count: number, hasStrongSource: boolean): ConfidenceBand {
  if (count >= CONFIDENCE_EVIDENCE.HIGH_COUNT && hasStrongSource) return 'high';
  if (count >= CONFIDENCE_EVIDENCE.MEDIUM_COUNT) return 'medium';
  return 'low';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function isMeasured(value: number | null | undefined, state: ScoreState | undefined): boolean {
  return typeof value === 'number' && state !== 'insufficient_signal' && state !== 'unavailable';
}

/**
 * BR-H-001 truth restoration for authority inflow. The snapshot's `backlinks_score` is a HEURISTIC authority
 * proxy (its source_tags include 'heuristic' and never a real backlink provider 'backlink_api'), yet the axis
 * state stamps it 'measured'. A heuristic value must never be presented as `measured` — real MEASURED
 * authority inflow comes ONLY from a wired backlink provider (applied by `mergeAuthorityInflowDimension`). So
 * a 'measured' state without a real backlink-provider source is downgraded to the honest 'inferred'. This
 * changes NO value: `inferred` aggregates exactly like `measured` (isMeasured) with the same band/confidence.
 */
export function resolveAuthorityInflowState(rawState: ScoreState, sourceTags: readonly string[]): ScoreState {
  const isRealBacklinkProvider = sourceTags.includes('backlink_api');
  return rawState === 'measured' && !isRealBacklinkProvider ? 'inferred' : rawState;
}

/**
 * GAP-07 — translate a radar `source_tag` into the canonical evidence vocabulary.
 *
 * The previous expression was `tag === 'crawler' ? 'crawler' : 'heuristic'`, which collapsed
 * EVERY non-crawler tag into `heuristic` — including the literal `'GSC'` tag the radar attaches to
 * its Search-Console-derived axes. Private analytics did not merely slip past the boundary; it
 * arrived already wearing an INFERRED label, so no downstream guard could ever have caught it.
 * Enforcement is only as good as the classification feeding it, so the classification is fixed
 * first and the mapping is explicit rather than an else-branch.
 *
 * Unknown tags stay `heuristic` (INFERRED), matching prior behaviour: they are derived signals,
 * not observations, and must never be promoted to `crawler`.
 */
function evidenceSourceFromTag(tag: string): EvidenceSourceKind {
  const normalized = tag.trim().toLowerCase();
  if (normalized === 'crawler' || normalized.startsWith('website_intelligence:')) return 'crawler';
  if (normalized === 'gsc') return 'gsc';
  if (normalized === 'backlink_signals' || normalized === 'backlink_api') return 'backlink_api';
  if (normalized === 'competitor_intelligence') return 'competitor_intelligence';
  if (normalized === 'social_links') return 'social_links';
  return 'heuristic';
}

/**
 * GAP-07 — enforce the boundary on a trace built OUTSIDE `buildEvidence`.
 *
 * The provider merges (`mergeAiSurfaceDimension`, `mergeEntityDimension`,
 * `mergeAuthorityInflowDimension`) substitute a dimension's score with one carrying the PROVIDER'S
 * own evidence trace. Those traces never passed through `buildEvidence`, so they were the one way a
 * provider could put evidence into Report 1 with no provenance check at all — the exact hole this
 * gap exists to close, one level below where it was first spotted.
 *
 * `count` is preserved when nothing is excluded, because provider traces set it deliberately (the
 * AI citation matrix counts mentions, not observation rows) and rewriting it would change
 * confidence bands — a scoring change. When something IS excluded the count drops by exactly that
 * many, which is the honest outcome: confidence must not be earned from evidence the report is not
 * permitted to assert on.
 */
export function enforceTraceProvenance(trace: EvidenceTrace): EvidenceTrace {
  const retained: EvidenceObservation[] = [];
  const excluded: EvidenceObservation[] = [];
  for (const obs of trace.observations) {
    (isReport1Source(obs.source) ? retained : excluded).push(obs);
  }
  const excludedSources = trace.sources.filter((source) => !isReport1Source(source));
  const retainedSources = trace.sources.filter(isReport1Source);
  const classes = new Set<EvidenceProvenanceClass>();
  for (const source of retainedSources) classes.add(provenanceForSource(source));

  const nothingExcluded = excluded.length === 0 && excludedSources.length === 0;
  return {
    ...trace,
    count: nothingExcluded ? trace.count : Math.max(0, trace.count - excluded.length),
    sources: retainedSources,
    observations: retained,
    provenance: {
      classes: [...classes],
      excluded,
      excludedSources: [...new Set(excludedSources)],
      report1Clean: nothingExcluded,
    },
  };
}

/**
 * GAP-07 — stamp a provenance verdict on an AGGREGATE trace.
 *
 * `aggregatePillarScore` and `aggregateOverallScore` build their traces inline rather than through
 * `buildEvidence`, because their `count` is a deliberate SUM of child counts, not a length. Routing
 * them through the filter would silently change that sum and therefore the confidence band — a
 * scoring change, which this gap must not make.
 *
 * So they are stamped instead of filtered. Their sources are already clean by construction (every
 * child trace was filtered on the way in); what this adds is the verdict, and the child exclusions
 * rolled up, so a pillar can report that something was withheld beneath it rather than looking
 * clean merely because the withholding happened one level down.
 */
function stampAggregateProvenance(
  trace: EvidenceTrace,
  children: ReadonlyArray<EvidenceTrace>,
): EvidenceTrace {
  const classes = new Set<EvidenceProvenanceClass>();
  for (const source of trace.sources) {
    if (isReport1Source(source)) classes.add(provenanceForSource(source));
  }
  const excluded = children.flatMap((child) => child.provenance?.excluded ?? []);
  const excludedSources = new Set<EvidenceSourceKind>();
  for (const child of children) {
    for (const source of child.provenance?.excludedSources ?? []) excludedSources.add(source);
  }
  return {
    ...trace,
    // Defence in depth: an aggregate must never surface a private source even if a child leaked one.
    sources: trace.sources.filter(isReport1Source),
    provenance: {
      classes: [...classes],
      excluded,
      excludedSources: [...excludedSources],
      report1Clean: excluded.length === 0 && trace.sources.every(isReport1Source),
    },
  };
}

/**
 * GAP-07 — THE runtime provenance boundary for Report 1 evidence.
 *
 * `evidenceProvenance.ts` has always held the correct taxonomy — including the entry that matters
 * most, `gsc → CONNECTED_SOURCE` — but nothing called it. The policy was a document. Evidence
 * became authoritative Report 1 evidence with no check at all that its origin was inside the
 * public-domain boundary the report claims for itself.
 *
 * Every canonical dimension routes its observations through this one function, so this is the
 * smallest place the policy can become an invariant rather than an intention. Enforcing here
 * instead of in renderers is deliberate: a renderer guard protects one surface, while the object
 * itself stays wrong for the API, the stored row and Report 2.
 *
 * WHAT ENFORCEMENT MEANS HERE:
 *
 *   • Observations whose provenance is inside `REPORT1_PROVENANCE` (public-observed, inferred,
 *     estimated, unavailable) are RETAINED and are what `count`/`sources` describe.
 *   • Observations outside it (connected private analytics, company-declared facts, Omnivyra's own
 *     history) are MOVED to `provenance.excluded` with their real source intact — never deleted.
 *     Rule 4: silently dropping them would make the coverage read as "no evidence" when the truth
 *     is "evidence we are not permitted to assert on here".
 *   • `count` therefore counts only permitted evidence. That is the point: confidence must not be
 *     earned from evidence the report may not use.
 *
 * This does not reclassify anything. `provenanceForSource` is the sole authority, and the source
 * of each observation is decided by its producer.
 */
function buildEvidence(params: {
  observations: EvidenceObservation[];
}): EvidenceTrace {
  const retained: EvidenceObservation[] = [];
  const excluded: EvidenceObservation[] = [];
  const classes = new Set<EvidenceProvenanceClass>();
  const excludedSources = new Set<EvidenceSourceKind>();

  for (const obs of params.observations) {
    if (isReport1Source(obs.source)) {
      retained.push(obs);
      classes.add(provenanceForSource(obs.source));
    } else {
      excluded.push(obs);
      excludedSources.add(obs.source);
    }
  }

  const sources = new Set<EvidenceSourceKind>();
  for (const obs of retained) sources.add(obs.source);

  return {
    count: retained.length,
    sources: [...sources],
    freshness: { last_observed_at: null, age_hours: null },
    observations: retained,
    provenance: {
      classes: [...classes],
      excluded,
      excludedSources: [...excludedSources],
      report1Clean: excluded.length === 0,
    },
  };
}

/**
 * GAP-04 — the one place a `CanonicalScore` is built, and therefore the one place the
 * state/value invariant can be made structural rather than remembered.
 *
 * THE INVARIANT
 *
 *     state ∈ { insufficient_signal, unavailable }  →  value === null
 *     state ∈ { measured, inferred }                →  value may be numeric (0 included)
 *
 * Before this, `scoreFromAxis` copied `value` through verbatim, so a caller that computed a
 * number and then classified the evidence as insufficient produced `{ value: 10, state:
 * 'insufficient_signal' }`. `aggregateOverallScore` did exactly that: it computes the geometric
 * mean of whatever pillars ARE measured, then sets the state from how many of them there were —
 * and when fewer than half qualified it returned the number anyway. That object was observed in
 * six live production reports and flowed into the stored record, the JSON API and the Report 2
 * baseline. Every HTML renderer re-checked the state and rendered `—`, which is why it stayed
 * invisible: the defect only surfaced where a consumer trusted `.value` alone.
 *
 * Nulling here rather than at each call site is deliberate. There are eleven dimension mappers
 * plus two aggregators feeding this function; a per-caller guard would be thirteen chances to
 * forget, and the next dimension added would be the fourteenth. This makes the unsafe object
 * unconstructible.
 *
 * A MEASURED ZERO IS NOT AFFECTED. `isMeasured` tests `typeof value === 'number'`, so a genuine
 * 0 with a measured/inferred state passes through untouched — "we looked and found nothing" and
 * "we could not look" stay different readings, which is the whole point.
 *
 * `inferred` deliberately keeps its number. It is a labelled, evidence-backed reading the report
 * already renders (authority inflow is downgraded to `inferred` precisely so it can carry a
 * heuristic value honestly); stripping it would be a scoring-model change, not an integrity fix.
 */
function scoreFromAxis(params: {
  value: number | null;
  state: ScoreState;
  evidence: EvidenceTrace;
}): CanonicalScore {
  const value = isMeasured(params.value, params.state) ? params.value : null;
  return {
    value,
    state: params.state,
    confidence: bandFromCount(params.evidence.count, params.evidence.sources.includes('crawler') || params.evidence.sources.includes('decisions') || params.evidence.sources.includes('gsc')),
    // Derived from the value actually stored, not the raw input. `canonicalBandFromValue` already
    // returns 'insufficient' for a denying state, so this is behaviour-identical today — it simply
    // removes the possibility of the band and the value disagreeing if that function ever changes.
    band: canonicalBandFromValue(value, params.state),
    evidence: params.evidence,
    benchmark: { value: null, label: null },
  };
}

function aggregatePillarScore(dimensions: CanonicalDimension[]): CanonicalScore {
  const measuredValues = dimensions
    .filter((dim) => isMeasured(dim.score.value, dim.score.state))
    .map((dim) => dim.score.value as number);
  if (measuredValues.length === 0) {
    return emptyCanonicalScore('insufficient_signal');
  }
  const avg = Math.round(measuredValues.reduce((sum, value) => sum + value, 0) / measuredValues.length);
  const totalEvidence = dimensions.reduce((sum, dim) => sum + dim.score.evidence.count, 0);
  const allSources = new Set<EvidenceSourceKind>();
  for (const dim of dimensions) {
    for (const source of dim.score.evidence.sources) allSources.add(source);
  }
  const evidence: EvidenceTrace = {
    count: totalEvidence,
    sources: [...allSources],
    freshness: { last_observed_at: null, age_hours: null },
    observations: dimensions.flatMap((dim) => dim.score.evidence.observations),
  };
  const state: ScoreState = measuredValues.length === dimensions.length
    ? 'measured'
    : measuredValues.length > 0
      ? 'inferred'
      : 'insufficient_signal';
  return scoreFromAxis({ value: avg, state, evidence: stampAggregateProvenance(evidence, dimensions.map((d) => d.score.evidence)) });
}

export function aggregateOverallScore(pillars: CanonicalPillarScore[]): CanonicalScore {
  const measured = pillars
    .filter((p) => isMeasured(p.score.value, p.score.state))
    .map((p) => p.score.value as number);
  if (measured.length === 0) return emptyCanonicalScore('insufficient_signal');
  // Geometric mean — a single weak pillar drags the total. Honest signal, no clamp.
  const value = Math.round(clamp(geometricMean(measured), 0, 100));
  const totalEvidence = pillars.reduce((sum, p) => sum + p.score.evidence.count, 0);
  const allSources = new Set<EvidenceSourceKind>();
  for (const p of pillars) for (const s of p.score.evidence.sources) allSources.add(s);
  const evidence: EvidenceTrace = {
    count: totalEvidence,
    sources: [...allSources],
    freshness: { last_observed_at: null, age_hours: null },
    observations: pillars.flatMap((p) => p.score.evidence.observations),
  };
  const state: ScoreState = measured.length === pillars.length
    ? 'measured'
    : measured.length >= Math.ceil(pillars.length / 2)
      ? 'inferred'
      : 'insufficient_signal';
  return scoreFromAxis({ value, state, evidence: stampAggregateProvenance(evidence, pillars.map((p) => p.score.evidence)) });
}

// ── Dimension mappers ─────────────────────────────────────────────────────────
//
// Each canonical dimension is derived from existing snapshot signals. No new data
// sources are introduced in Phase 2 — only architectural consolidation.

// BETA-EXEC-002: measured evidence from the Website Intelligence Brand + Accessibility
// engines, consumed directly (no recomputation). Optional — when absent, the dependent
// dimensions render `unavailable` exactly as before (fully backward compatible).
export type WebsiteBrandEvidence = { score: number | null; brandTrust: number | null; confidence: number; evaluatedAt: string | null };
export type WebsiteAccessibilityEvidence = { score: number | null; wcagLevel: string; criticalIssues: number; confidence: number; evaluatedAt: string | null };

export type DimensionContext = {
  snapshot: SnapshotReport;
  brand?: WebsiteBrandEvidence | null;
  accessibility?: WebsiteAccessibilityEvidence | null;
  // BETA-EXEC-004: full engine outputs for evidence-driven rationales (read-only, narrative only).
  engineEvidence?: EngineEvidenceInput | null;
};

function dimIndexIntegrity(ctx: DimensionContext): CanonicalDimension {
  const radar = ctx.snapshot.visual_intelligence.seo_capability_radar;
  const value = radar.technical_seo_score;
  const state: ScoreState = radar.axis_states?.technical_seo_score ?? (typeof value === 'number' ? 'measured' : 'insufficient_signal');
  const sources: EvidenceObservation[] = (radar.source_tags?.technical_seo_score ?? []).map((tag) => ({
    signal: `technical_seo:${tag}`,
    source: evidenceSourceFromTag(tag),
    observed_at: null,
  }));
  return {
    key: 'index_integrity',
    label: 'Index Integrity',
    pillar: 'foundation',
    score: scoreFromAxis({ value: typeof value === 'number' ? value : null, state, evidence: buildEvidence({ observations: sources }) }),
    rationale: enrichRationale('Crawl health, indexability, metadata coverage, internal-link support.', readTechnical(ctx.engineEvidence?.technical)),
  };
}

function dimExtractionReadiness(ctx: DimensionContext): CanonicalDimension {
  const radar = ctx.snapshot.geo_aeo_visuals.ai_answer_presence_radar;
  // Extraction readiness = composite of citation_readiness + content_structure
  // (both already measured by publicDomainAuditService in Phase 1).
  const components = [radar.citation_readiness_score, radar.content_structure_score].filter(
    (v): v is number => typeof v === 'number',
  );
  const value = components.length > 0
    ? Math.round(components.reduce((sum, v) => sum + v, 0) / components.length)
    : null;
  const state: ScoreState = components.length === 2
    ? 'measured'
    : components.length === 1
      ? 'inferred'
      : 'insufficient_signal';
  const observations: EvidenceObservation[] = [];
  if (typeof radar.citation_readiness_score === 'number') {
    observations.push({ signal: 'citation_readiness_pct', source: 'crawler', observed_at: null });
  }
  if (typeof radar.content_structure_score === 'number') {
    observations.push({ signal: 'content_structure_pct', source: 'crawler', observed_at: null });
  }
  return {
    key: 'extraction_readiness',
    label: 'Extraction Readiness',
    pillar: 'foundation',
    score: scoreFromAxis({ value, state, evidence: buildEvidence({ observations }) }),
    rationale: enrichRationale('Page structure, summary blocks, and schema density that make answers extractable.', readContent(ctx.engineEvidence?.content)),
  };
}

function dimAuthorityInflow(ctx: DimensionContext): CanonicalDimension {
  const radar = ctx.snapshot.visual_intelligence.seo_capability_radar;
  const value = radar.backlinks_score;
  const stateHint = radar.axis_states?.backlinks_score;
  const sourceTags = radar.source_tags?.backlinks_score ?? [];
  const rawState: ScoreState = stateHint ?? (typeof value === 'number' ? 'measured' : 'unavailable');
  // BR-H-001: never present a heuristic backlinks proxy as `measured` (see resolveAuthorityInflowState).
  const state: ScoreState = resolveAuthorityInflowState(rawState, sourceTags);
  const observations: EvidenceObservation[] = sourceTags.map((tag) => ({
    signal: `authority_inflow:${tag}`,
    source: 'decisions' as EvidenceSourceKind,
    observed_at: null,
  }));
  return {
    key: 'authority_inflow',
    label: 'Authority Inflow',
    pillar: 'authority',
    score: scoreFromAxis({ value: typeof value === 'number' ? value : null, state, evidence: buildEvidence({ observations }) }),
    rationale: 'Inbound authority signals — backlinks and brand-mention reinforcement. Heuristic (inferred from on-site authority signals) until a backlink provider is connected, at which point it becomes measured.',
  };
}

function dimEntityGraphStrength(ctx: DimensionContext): CanonicalDimension {
  const radar = ctx.snapshot.geo_aeo_visuals.ai_answer_presence_radar;
  const value = radar.entity_clarity_score;
  const stateHint = radar.axis_states?.entity_clarity_score;
  const state: ScoreState = stateHint ?? (typeof value === 'number' ? 'measured' : 'insufficient_signal');
  const observations: EvidenceObservation[] = [];
  if (typeof radar.entity_clarity_score === 'number') {
    observations.push({ signal: 'entity_clarity', source: 'crawler', observed_at: null });
  }
  return {
    key: 'entity_graph_strength',
    label: 'Entity Graph Strength',
    pillar: 'authority',
    score: scoreFromAxis({ value: typeof value === 'number' ? value : null, state, evidence: buildEvidence({ observations }) }),
    rationale: 'Knowledge-graph entity clarity, sameAs linkage, topical entity coverage.',
  };
}

function dimTopicalAuthority(ctx: DimensionContext): CanonicalDimension {
  const radar = ctx.snapshot.geo_aeo_visuals.ai_answer_presence_radar;
  const seoRadar = ctx.snapshot.visual_intelligence.seo_capability_radar;
  // Composite: AEO topical_authority and content_quality (when measured).
  const components = [radar.topical_authority_score, seoRadar.content_quality_score].filter(
    (v): v is number => typeof v === 'number',
  );
  const value = components.length > 0
    ? Math.round(components.reduce((sum, v) => sum + v, 0) / components.length)
    : null;
  const state: ScoreState = components.length === 2
    ? 'measured'
    : components.length === 1
      ? 'inferred'
      : 'insufficient_signal';
  const observations: EvidenceObservation[] = [];
  if (typeof radar.topical_authority_score === 'number') {
    observations.push({ signal: 'topical_authority', source: 'crawler', observed_at: null });
  }
  if (typeof seoRadar.content_quality_score === 'number') {
    observations.push({ signal: 'content_quality', source: 'decisions', observed_at: null });
  }
  return {
    key: 'topical_authority',
    label: 'Topical Authority',
    pillar: 'discoverability',
    score: scoreFromAxis({ value, state, evidence: buildEvidence({ observations }) }),
    rationale: 'Depth and breadth of coverage across the brand\'s topic cluster.',
  };
}

function dimAiSurfacePresence(ctx: DimensionContext): CanonicalDimension {
  const radar = ctx.snapshot.geo_aeo_visuals.ai_answer_presence_radar;
  const value = radar.answer_coverage_score;
  const stateHint = radar.axis_states?.answer_coverage_score;
  const state: ScoreState = stateHint ?? (typeof value === 'number' ? 'measured' : 'insufficient_signal');
  const observations: EvidenceObservation[] = [];
  if (typeof radar.answer_coverage_score === 'number') {
    observations.push({ signal: 'answer_coverage', source: 'crawler', observed_at: null });
  }
  return {
    key: 'ai_surface_presence',
    label: 'AI Surface Presence',
    pillar: 'discoverability',
    score: scoreFromAxis({ value: typeof value === 'number' ? value : null, state, evidence: buildEvidence({ observations }) }),
    rationale: 'How surfaceable the site is for AI answers and citation-driven discovery.',
  };
}

function dimTrustCoherence(ctx: DimensionContext): CanonicalDimension {
  // BETA-EXEC-002: consume the Brand Intelligence engine directly. Brand Trust (community
  // sentiment / reputation) is the most trust-specific brand signal; when it is unmeasured
  // we fall back to the engine's overall brand-health score. No trust-specific score is
  // invented — the value is the engine's own output. When the engine has no evidence the
  // dimension stays `unavailable`, exactly as before (honest gap).
  const brand = ctx.brand ?? null;
  const usesBrandTrust = brand != null && typeof brand.brandTrust === 'number';
  const trustValue = usesBrandTrust
    ? (brand!.brandTrust as number)
    : brand != null && typeof brand.score === 'number'
      ? (brand.score as number)
      : null;
  const observations: EvidenceObservation[] = [];
  if (typeof trustValue === 'number') {
    observations.push({ signal: usesBrandTrust ? 'brand_trust' : 'brand_health', source: 'crawler', observed_at: brand?.evaluatedAt ?? null });
  }
  const state: ScoreState = typeof trustValue === 'number' ? 'measured' : 'unavailable';
  return {
    key: 'trust_coherence',
    label: 'Trust Coherence',
    pillar: 'trust',
    score: scoreFromAxis({
      value: typeof trustValue === 'number' ? clamp(Math.round(trustValue), 0, 100) : null,
      state,
      evidence: buildEvidence({ observations }),
    }),
    rationale: enrichRationale('Consistency of brand description, proof, and reputation signals. On-site brand-health proxy (Brand Intelligence engine) until review/reputation sources are connected, at which point it becomes review-based trust.', readBrand(ctx.engineEvidence?.brand)),
  };
}

function dimAccessibility(ctx: DimensionContext): CanonicalDimension {
  // BETA-EXEC-002: Accessibility Intelligence engine surfaced as a Foundation dimension.
  // Consumes the engine's accessibilityScore directly (WCAG conformance + semantic
  // structure). `unavailable` when the engine has no crawl evidence — no synthetic default.
  const a11y = ctx.accessibility ?? null;
  const value = a11y != null && typeof a11y.score === 'number' ? clamp(Math.round(a11y.score), 0, 100) : null;
  const state: ScoreState = typeof value === 'number' ? 'measured' : 'unavailable';
  const observations: EvidenceObservation[] = [];
  if (typeof value === 'number') {
    observations.push({ signal: `accessibility:wcag_${a11y!.wcagLevel}`, source: 'crawler', observed_at: a11y?.evaluatedAt ?? null });
  }
  return {
    key: 'accessibility',
    label: 'Accessibility',
    pillar: 'foundation',
    score: scoreFromAxis({ value, state, evidence: buildEvidence({ observations }) }),
    rationale: enrichRationale('WCAG conformance, semantic structure, and accessible markup (Accessibility Intelligence engine).', readAccessibility(ctx.engineEvidence?.accessibility)),
  };
}

function dimAuthorityVelocity(ctx: DimensionContext): CanonicalDimension {
  const radar = ctx.snapshot.geo_aeo_visuals.ai_answer_presence_radar;
  const value = radar.freshness_score;
  const stateHint = radar.axis_states?.freshness_score;
  const baseState: ScoreState = stateHint ?? (typeof value === 'number' ? 'measured' : 'insufficient_signal');
  // BETA-ROADMAP-EXEC-001 — honest state classification (STATE ONLY; value + formula unchanged).
  // `freshness_score` is 0 ONLY when the crawler detected NO recency signal at all — zero dated
  // pages AND no blog (see publicDomainAuditService `freshness_score`: (datedPages/pages)*100 +
  // (blogExists?18:0)). That is an ABSENCE of signal, not a measured "zero momentum". Classifying it
  // `insufficient_signal` lets it be honestly excluded (isMeasured=false) rather than entering the
  // pillar/geometric mean as a phantom measured 0 that drags Momentum and the Authority Index down.
  // A detected recency signal (value > 0, e.g. a blog or dated pages) stays `measured`, even if low.
  const state: ScoreState = value === 0 ? 'insufficient_signal' : baseState;
  const observations: EvidenceObservation[] = [];
  if (typeof radar.freshness_score === 'number') {
    observations.push({ signal: 'freshness', source: 'crawler', observed_at: null });
  }
  return {
    // BR-C-001 truth correction: the value is `freshness_score` (content recency), not a growth rate.
    // Labeled + explained for what it genuinely measures; no rate→score mapping invented, value unchanged.
    key: 'authority_velocity',
    label: 'Content Freshness',
    pillar: 'momentum',
    score: scoreFromAxis({ value: typeof value === 'number' ? value : null, state, evidence: buildEvidence({ observations }) }),
    rationale: 'How recently the site\'s content was published or updated — a publishing-momentum proxy. This is not a measured authority growth rate; see the authority trajectory when snapshot history exists.',
  };
}

export const DIMENSION_BUILDERS: Record<CanonicalDimensionKey, (ctx: DimensionContext) => CanonicalDimension> = {
  index_integrity: dimIndexIntegrity,
  extraction_readiness: dimExtractionReadiness,
  accessibility: dimAccessibility,
  authority_inflow: dimAuthorityInflow,
  entity_graph_strength: dimEntityGraphStrength,
  topical_authority: dimTopicalAuthority,
  ai_surface_presence: dimAiSurfacePresence,
  trust_coherence: dimTrustCoherence,
  authority_velocity: dimAuthorityVelocity,
};

// ── Pillar grouping ───────────────────────────────────────────────────────────

export function groupDimensionsByPillar(dimensions: CanonicalDimension[]): CanonicalPillarScore[] {
  return Object.values(PILLAR_META).map((meta) => {
    const dims = dimensions.filter((d) => d.pillar === meta.key);
    const aggregate = aggregatePillarScore(dims);
    const measuredDims = dims.filter((d) => isMeasured(d.score.value, d.score.state));
    const weakest = [...measuredDims].sort((a, b) => (a.score.value ?? 0) - (b.score.value ?? 0))[0];
    return {
      pillar: meta.key,
      label: meta.label,
      purpose: meta.purpose,
      score: aggregate,
      dimensions: dims,
      primary_signal: weakest
        ? `${weakest.label} is the lagging axis at ${weakest.score.value}/100.`
        : measuredDims.length === 0
          ? null
          : `Pillar is balanced — no single axis is materially lagging yet.`,
    };
  });
}

// ── Action consolidation ──────────────────────────────────────────────────────
//
// Folds the 5 fragmented action arrays (seo, geo/aeo, competitor, unified,
// top_priorities) into ONE canonical Action Playbook. Dedupes by normalized title,
// assigns pillar + maturity implication, and ranks by leverage.

function pillarFromTitle(title: string, source?: 'seo' | 'geo_aeo'): PillarKey {
  const lower = title.toLowerCase();
  if (/(answer|citation|llm|ai answer|aeo|surfac)/.test(lower)) return 'discoverability';
  if (/(crawl|metadata|technical|schema|index|extract|chunk)/.test(lower)) return 'foundation';
  if (/(backlink|authority|mention|kg|knowledge graph|entity)/.test(lower)) return 'authority';
  if (/(review|trust|proof|consistency|reputation|e-e-a-t|expertise)/.test(lower)) return 'trust';
  if (/(velocity|cadence|publish|freshness|momentum)/.test(lower)) return 'momentum';
  if (source === 'geo_aeo') return 'discoverability';
  return 'discoverability';
}

function maturityImplicationFromAction(pillar: PillarKey, severity: CanonicalActionSeverityHint): CanonicalAction['maturity_implication'] {
  if (severity === 'critical') return 'shifts_tier';
  if (pillar === 'foundation') return 'unblocks_foundation';
  if (pillar === 'authority') return 'compounds_authority';
  if (pillar === 'discoverability') return 'extends_discoverability';
  if (pillar === 'trust') return 'reinforces_trust';
  return 'accelerates_momentum';
}

type CanonicalActionSeverityHint = 'critical' | 'moderate' | 'low';

function severityFromImpactPriority(
  impact: 'high' | 'medium' | 'low',
  priority: 'high' | 'medium' | 'low',
): CanonicalActionSeverityHint {
  if (impact === 'high' && priority === 'high') return 'critical';
  if (impact === 'high' || priority === 'high') return 'moderate';
  return 'low';
}

function leverageScore(params: {
  severity: CanonicalActionSeverityHint;
  confidence: ConfidenceBand;
  dependencyDepth: number;
}): number {
  const severityWeight = params.severity === 'critical' ? 100 : params.severity === 'moderate' ? 70 : 40;
  const confidenceWeight = params.confidence === 'high' ? 1 : params.confidence === 'medium' ? 0.7 : 0.4;
  const dependencyDamp = 1 / Math.max(1, params.dependencyDepth);
  return Math.round(severityWeight * confidenceWeight * dependencyDamp);
}

function ownerAreaFromPillar(pillar: PillarKey): CanonicalAction['owner_area'] {
  if (pillar === 'foundation') return 'engineering';
  if (pillar === 'authority') return 'pr';
  if (pillar === 'discoverability') return 'content';
  if (pillar === 'trust') return 'marketing_ops';
  return 'cross_functional';
}

export function buildActionPlaybook(
  snapshot: SnapshotReport,
  context?: {
    maturityStage?: string;
    blockerPillar?: PillarKey | null;
  },
): CanonicalAction[] {
  const blockerPillar = context?.blockerPillar ?? null;
  type LegacyAction = {
    id: string;
    title: string;
    impact: 'high' | 'medium' | 'low';
    priority: 'high' | 'medium' | 'low';
    effort: 'low' | 'medium' | 'high';
    confidence: number;
    reasoning: string;
    expected_outcome: string;
    timeline: { short: string; mid: string; long: string };
    source: 'seo' | 'geo_aeo' | 'competitor' | 'unified' | 'top_priority';
  };

  const legacy: LegacyAction[] = [];

  // SEO executive summary actions.
  for (const a of snapshot.seo_executive_summary.top_3_actions) {
    legacy.push({
      id: `seo:${a.title}`,
      title: a.title,
      impact: a.expected_impact,
      priority: a.priority,
      effort: a.effort,
      confidence: a.confidence,
      reasoning: a.reasoning,
      expected_outcome: '',
      timeline: a.timeline,
      source: 'seo',
    });
  }
  // GEO/AEO executive summary actions.
  for (const a of snapshot.geo_aeo_executive_summary.top_3_actions) {
    legacy.push({
      id: `geo_aeo:${a.action_title}`,
      title: a.action_title,
      impact: a.expected_impact,
      priority: a.priority,
      effort: a.effort,
      confidence: 0,
      reasoning: a.reasoning,
      expected_outcome: '',
      timeline: { short: '', mid: '', long: '' },
      source: 'geo_aeo',
    });
  }
  // Competitor intelligence actions.
  if (snapshot.competitor_intelligence_summary) {
    for (const a of snapshot.competitor_intelligence_summary.top_3_actions) {
      legacy.push({
        id: `competitor:${a.action_title}`,
        title: a.action_title,
        impact: a.expected_impact,
        priority: a.priority,
        effort: a.effort,
        confidence: 0,
        reasoning: a.reasoning,
        expected_outcome: '',
        timeline: { short: '', mid: '', long: '' },
        source: 'competitor',
      });
    }
  }
  // Unified intelligence actions.
  for (const a of snapshot.unified_intelligence_summary.top_3_unified_actions) {
    legacy.push({
      id: `unified:${a.action_title}`,
      title: a.action_title,
      impact: a.expected_impact,
      priority: a.priority,
      effort: a.effort,
      confidence: 0,
      reasoning: a.reasoning,
      expected_outcome: '',
      timeline: { short: '', mid: '', long: '' },
      source: 'unified',
    });
  }
  // Top priorities (tactical, decision-derived).
  for (const a of snapshot.top_priorities) {
    legacy.push({
      id: `top:${a.title}`,
      title: a.title,
      impact: a.impact,
      priority: a.priority,
      effort: a.effort_level,
      confidence: a.confidence,
      reasoning: a.reasoning,
      expected_outcome: a.expected_outcome,
      timeline: a.timeline,
      source: 'top_priority',
    });
  }

  // Dedupe by normalized title.
  const seen = new Map<string, CanonicalAction>();
  for (const item of legacy) {
    const key = item.title.toLowerCase().trim().replace(/\s+/g, ' ');
    if (!key) continue;
    if (seen.has(key)) continue;

    const pillar = pillarFromTitle(item.title, item.source === 'geo_aeo' ? 'geo_aeo' : 'seo');
    const severity = severityFromImpactPriority(item.impact, item.priority);
    const confidence: ConfidenceBand =
      item.confidence >= 70 ? 'high' : item.confidence >= 40 ? 'medium' : 'low';
    const dependencyDepth = pillar === 'foundation' ? 0 : pillar === 'authority' ? 1 : 2;
    const leverage = leverageScore({ severity, confidence, dependencyDepth });

    const action: CanonicalAction = {
      id: item.id,
      title: item.title,
      pillar,
      severity,
      confidence,
      leverage_score: leverage,
      expected_impact: item.impact,
      effort: item.effort,
      evidence: emptyEvidenceTrace(),
      dependencies: [],
      timeline: item.timeline.short || item.timeline.mid || item.timeline.long
        ? item.timeline
        : { short: '', mid: '', long: '' },
      owner_area: ownerAreaFromPillar(pillar),
      maturity_implication: maturityImplicationFromAction(pillar, severity),
      reasoning: item.reasoning,
      expected_outcome: item.expected_outcome,
    };

    seen.set(key, action);
  }

  // Phase 3: maturity-aware re-ranking. Actions that touch the blocker pillar get
  // a leverage bonus because they're the ones that actually shift the maturity stage.
  // Foundation-pillar actions get a smaller bonus because they unlock dependent
  // pillars regardless of which one is currently weakest.
  const ranked = [...seen.values()].map((action) => {
    let bonus = 0;
    if (blockerPillar && action.pillar === blockerPillar) bonus += 25;
    if (action.pillar === 'foundation' && action.severity !== 'low') bonus += 10;
    if (action.maturity_implication === 'shifts_tier') bonus += 15;
    return { ...action, leverage_score: action.leverage_score + bonus };
  });

  return ranked.sort((a, b) => b.leverage_score - a.leverage_score).slice(0, 5);
}

// ── Narrative builders ────────────────────────────────────────────────────────

