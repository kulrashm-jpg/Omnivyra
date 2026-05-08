import {
  CANONICAL_DIMENSIONS,
  PILLAR_META,
  type AICitationMatrixSummary,
  type AuthorityInflowSummary,
  type BenchmarkOverlaySummary,
  type CanonicalAction,
  type CanonicalDimension,
  type CanonicalDimensionKey,
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
import {
  endScanBudget,
  startScanBudget,
  type ScanLedgerSummary,
} from '../intelligence/costGovernance';
import { randomUUID } from 'crypto';
import type {
  AuthorityInflowResult,
  AuthorityTrajectoryResult,
  BenchmarkResult,
  EntityIntelligenceResult,
  TrustCoherenceResult,
} from '../intelligence/providerInterfaces';

// ── Score-state helpers ───────────────────────────────────────────────────────

function bandFromCount(count: number, hasStrongSource: boolean): ConfidenceBand {
  if (count >= 4 && hasStrongSource) return 'high';
  if (count >= 2) return 'medium';
  return 'low';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isMeasured(value: number | null | undefined, state: ScoreState | undefined): boolean {
  return typeof value === 'number' && state !== 'insufficient_signal' && state !== 'unavailable';
}

function buildEvidence(params: {
  observations: EvidenceObservation[];
}): EvidenceTrace {
  const sources = new Set<EvidenceSourceKind>();
  for (const obs of params.observations) sources.add(obs.source);
  return {
    count: params.observations.length,
    sources: [...sources],
    freshness: { last_observed_at: null, age_hours: null },
    observations: params.observations,
  };
}

function scoreFromAxis(params: {
  value: number | null;
  state: ScoreState;
  evidence: EvidenceTrace;
}): CanonicalScore {
  return {
    value: params.value,
    state: params.state,
    confidence: bandFromCount(params.evidence.count, params.evidence.sources.includes('crawler') || params.evidence.sources.includes('decisions') || params.evidence.sources.includes('gsc')),
    band: canonicalBandFromValue(params.value, params.state),
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
  return scoreFromAxis({ value: avg, state, evidence });
}

function aggregateOverallScore(pillars: CanonicalPillarScore[]): CanonicalScore {
  const measured = pillars
    .filter((p) => isMeasured(p.score.value, p.score.state))
    .map((p) => p.score.value as number);
  if (measured.length === 0) return emptyCanonicalScore('insufficient_signal');
  // Geometric mean — a single weak pillar drags the total. Honest signal, no clamp.
  const logs = measured.map((v) => Math.log(Math.max(1, v)));
  const geoMean = Math.exp(logs.reduce((a, b) => a + b, 0) / logs.length);
  const value = Math.round(clamp(geoMean, 0, 100));
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
  return scoreFromAxis({ value, state, evidence });
}

// ── Dimension mappers ─────────────────────────────────────────────────────────
//
// Each canonical dimension is derived from existing snapshot signals. No new data
// sources are introduced in Phase 2 — only architectural consolidation.

type DimensionContext = {
  snapshot: SnapshotReport;
};

function dimIndexIntegrity(ctx: DimensionContext): CanonicalDimension {
  const radar = ctx.snapshot.visual_intelligence.seo_capability_radar;
  const value = radar.technical_seo_score;
  const state: ScoreState = radar.axis_states?.technical_seo_score ?? (typeof value === 'number' ? 'measured' : 'insufficient_signal');
  const sources: EvidenceObservation[] = (radar.source_tags?.technical_seo_score ?? []).map((tag) => ({
    signal: `technical_seo:${tag}`,
    source: tag === 'crawler' ? 'crawler' : 'heuristic',
    observed_at: null,
  }));
  return {
    key: 'index_integrity',
    label: 'Index Integrity',
    pillar: 'foundation',
    score: scoreFromAxis({ value: typeof value === 'number' ? value : null, state, evidence: buildEvidence({ observations: sources }) }),
    rationale: 'Crawl health, indexability, metadata coverage, internal-link support.',
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
    rationale: 'Page structure, summary blocks, and schema density that make answers extractable.',
  };
}

function dimAuthorityInflow(ctx: DimensionContext): CanonicalDimension {
  const radar = ctx.snapshot.visual_intelligence.seo_capability_radar;
  const value = radar.backlinks_score;
  const stateHint = radar.axis_states?.backlinks_score;
  // Phase 1 already marks this as `unavailable` until a real backlink data source is wired.
  const state: ScoreState = stateHint ?? (typeof value === 'number' ? 'measured' : 'unavailable');
  const observations: EvidenceObservation[] = (radar.source_tags?.backlinks_score ?? []).map((tag) => ({
    signal: `authority_inflow:${tag}`,
    source: 'decisions' as EvidenceSourceKind,
    observed_at: null,
  }));
  return {
    key: 'authority_inflow',
    label: 'Authority Inflow',
    pillar: 'authority',
    score: scoreFromAxis({ value: typeof value === 'number' ? value : null, state, evidence: buildEvidence({ observations }) }),
    rationale: 'Inbound authority signals — backlinks and brand mention reinforcement.',
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
  // Phase 2 architecture note: real trust-coherence measurement (review parity, NAP,
  // E-E-A-T) lands in Phase 3 with the corresponding data sources. Until then this
  // dimension renders as `unavailable` so the radar is honest about the gap.
  const observations: EvidenceObservation[] = [];
  return {
    key: 'trust_coherence',
    label: 'Trust Coherence',
    pillar: 'trust',
    score: scoreFromAxis({ value: null, state: 'unavailable', evidence: buildEvidence({ observations }) }),
    rationale: 'Consistency of brand description, proof, and reputation signals across sources.',
  };
}

function dimAuthorityVelocity(ctx: DimensionContext): CanonicalDimension {
  const radar = ctx.snapshot.geo_aeo_visuals.ai_answer_presence_radar;
  const value = radar.freshness_score;
  const stateHint = radar.axis_states?.freshness_score;
  const state: ScoreState = stateHint ?? (typeof value === 'number' ? 'measured' : 'insufficient_signal');
  const observations: EvidenceObservation[] = [];
  if (typeof radar.freshness_score === 'number') {
    observations.push({ signal: 'freshness', source: 'crawler', observed_at: null });
  }
  return {
    key: 'authority_velocity',
    label: 'Authority Velocity',
    pillar: 'momentum',
    score: scoreFromAxis({ value: typeof value === 'number' ? value : null, state, evidence: buildEvidence({ observations }) }),
    rationale: 'Rate of change in authority signals — publishing cadence, freshness, growth.',
  };
}

const DIMENSION_BUILDERS: Record<CanonicalDimensionKey, (ctx: DimensionContext) => CanonicalDimension> = {
  index_integrity: dimIndexIntegrity,
  extraction_readiness: dimExtractionReadiness,
  authority_inflow: dimAuthorityInflow,
  entity_graph_strength: dimEntityGraphStrength,
  topical_authority: dimTopicalAuthority,
  ai_surface_presence: dimAiSurfacePresence,
  trust_coherence: dimTrustCoherence,
  authority_velocity: dimAuthorityVelocity,
};

// ── Pillar grouping ───────────────────────────────────────────────────────────

function groupDimensionsByPillar(dimensions: CanonicalDimension[]): CanonicalPillarScore[] {
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

function buildActionPlaybook(
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

function buildHeadlineNarrative(params: {
  overall: CanonicalScore;
  maturity: SystemMaturityClass;
  pillars: CanonicalPillarScore[];
}): CanonicalNarrative {
  const measuredPillars = params.pillars.filter((p) => isMeasured(p.score.value, p.score.state));
  const weakestPillar = [...measuredPillars].sort(
    (a, b) => (a.score.value ?? 0) - (b.score.value ?? 0),
  )[0];

  const text = params.overall.state === 'insufficient_signal'
    ? `Authority cannot yet be measured — insufficient signal across all five pillars. The brand reads as ${maturityNarrativeAdjective(params.maturity)} on the maturity curve until evidence is observed.`
    : weakestPillar
      ? `${PILLAR_META[weakestPillar.pillar].label} is the throttling pillar at ${weakestPillar.score.value}/100. The brand reads as ${maturityNarrativeAdjective(params.maturity)} on the authority maturity curve.`
      : `All measured pillars are balanced. The brand reads as ${maturityNarrativeAdjective(params.maturity)} on the authority maturity curve.`;

  return {
    text,
    confidence: params.overall.confidence,
    evidence: params.overall.evidence,
    maturity: params.maturity,
  };
}

function buildPrimaryConstraintNarrative(params: {
  pillars: CanonicalPillarScore[];
  maturity: SystemMaturityClass;
}): CanonicalNarrative {
  const measuredPillars = params.pillars.filter((p) => isMeasured(p.score.value, p.score.state));
  if (measuredPillars.length === 0) {
    return {
      text: 'No pillar has measured evidence yet — the report cannot identify a primary constraint until crawl, search, or competitor signal is observed.',
      confidence: 'low',
      evidence: emptyEvidenceTrace(),
      maturity: params.maturity,
    };
  }
  const weakest = [...measuredPillars].sort((a, b) => (a.score.value ?? 0) - (b.score.value ?? 0))[0];
  return {
    text: `The largest drag on overall authority is ${PILLAR_META[weakest.pillar].label} at ${weakest.score.value}/100. ${weakest.primary_signal ?? 'Improving this pillar moves the overall score the most.'}`,
    confidence: weakest.score.confidence,
    evidence: weakest.score.evidence,
    maturity: params.maturity,
  };
}

function buildNextUnlockNarrative(params: {
  actions: CanonicalAction[];
  maturity: SystemMaturityClass;
}): CanonicalNarrative {
  const top = params.actions[0];
  if (!top) {
    return {
      text: 'No high-leverage actions could be derived — evidence is too thin to recommend a next step yet.',
      confidence: 'low',
      evidence: emptyEvidenceTrace(),
      maturity: params.maturity,
    };
  }
  return {
    text: `Highest-leverage move: ${top.title}. This ${top.maturity_implication.replace(/_/g, ' ')} via the ${PILLAR_META[top.pillar].label} pillar.`,
    confidence: top.confidence,
    evidence: top.evidence,
    maturity: params.maturity,
  };
}

function buildPlaybookSummary(params: {
  actions: CanonicalAction[];
  maturity: SystemMaturityClass;
}): CanonicalNarrative {
  if (params.actions.length === 0) {
    return {
      text: 'No actions were ranked — evidence is insufficient to issue a recommendation.',
      confidence: 'low',
      evidence: emptyEvidenceTrace(),
      maturity: params.maturity,
    };
  }
  const pillars = new Set(params.actions.map((a) => a.pillar));
  const text = `${params.actions.length} canonical action${params.actions.length === 1 ? '' : 's'} ranked by leverage across ${pillars.size} pillar${pillars.size === 1 ? '' : 's'}.`;
  return {
    text,
    confidence: params.actions[0].confidence,
    evidence: emptyEvidenceTrace(),
    maturity: params.maturity,
  };
}

// ── Competitive surface share ─────────────────────────────────────────────────

function buildCompetitiveSurfaceShare(snapshot: SnapshotReport, dimensions: CanonicalDimension[]): CanonicalReport['competitive_surface_share'] {
  const radar = snapshot.competitor_visuals.competitor_positioning_radar;
  const dimensionByLegacy: Partial<Record<CanonicalDimensionKey, number>> = {};
  for (const dim of dimensions) {
    if (typeof dim.score.value === 'number') dimensionByLegacy[dim.key] = dim.score.value;
  }

  const userShare: Partial<Record<CanonicalDimensionKey, number>> = { ...dimensionByLegacy };
  const competitors = (radar.competitors ?? []).slice(0, 4).map((c) => ({
    name: c.name,
    values: {
      index_integrity: typeof c.technical_score === 'number' && c.technical_score > 0 ? c.technical_score : undefined,
      topical_authority: typeof c.content_score === 'number' && c.content_score > 0 ? c.content_score : undefined,
      ai_surface_presence: typeof c.ai_answer_presence_score === 'number' && c.ai_answer_presence_score > 0 ? c.ai_answer_presence_score : undefined,
      authority_inflow: typeof c.authority_score === 'number' && c.authority_score > 0 ? c.authority_score : undefined,
    } as Partial<Record<CanonicalDimensionKey, number>>,
  }));

  const competitorAverage: Partial<Record<CanonicalDimensionKey, number>> = {};
  if (competitors.length > 0) {
    for (const key of ['index_integrity', 'topical_authority', 'ai_surface_presence', 'authority_inflow'] as CanonicalDimensionKey[]) {
      const values = competitors.map((c) => c.values[key]).filter((v): v is number => typeof v === 'number');
      if (values.length > 0) {
        competitorAverage[key] = Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
      }
    }
  }

  const confidence: ConfidenceBand = competitors.length >= 2 ? 'medium' : competitors.length === 1 ? 'low' : 'low';
  const summary: CanonicalNarrative = {
    text: competitors.length === 0
      ? 'No competitor evidence has been observed for this snapshot — competitive surface share cannot be measured yet.'
      : `Competitive surface compared across ${competitors.length} peer${competitors.length === 1 ? '' : 's'} on the canonical dimensions where overlap is observable.`,
    confidence,
    evidence: emptyEvidenceTrace(),
    maturity: snapshot.system_maturity,
  };

  return {
    user: userShare,
    competitor_average: competitorAverage,
    competitors,
    confidence,
    summary,
  };
}

// ── Phase 3 intelligence merge ────────────────────────────────────────────────
//
// Real adapter results override the heuristic dimension values when present.
// When an adapter is unavailable, the heuristic / null fallback survives — but
// the dimension's evidence trace clearly states `reason_unavailable` so the UI
// can render "Unavailable" instead of a fake score.

function mergeAiSurfaceDimension(
  baseline: CanonicalDimension,
  matrix: AICitationMatrix,
): CanonicalDimension {
  if (matrix.overall_score.state === 'measured' || matrix.overall_score.state === 'inferred') {
    return {
      ...baseline,
      score: {
        ...matrix.overall_score,
        evidence: {
          ...matrix.overall_score.evidence,
          sources: [...new Set<EvidenceSourceKind>([...matrix.overall_score.evidence.sources, 'llm_probe'])],
        },
      },
    };
  }
  return baseline;
}

function mergeEntityDimension(
  baseline: CanonicalDimension,
  result: EntityIntelligenceResult,
): CanonicalDimension {
  if (result.state === 'measured' && result.score != null) {
    return {
      ...baseline,
      score: {
        value: result.score,
        state: 'measured',
        confidence: result.evidence.count >= 4 ? 'high' : result.evidence.count >= 2 ? 'medium' : 'low',
        band: canonicalBandFromValue(result.score, 'measured'),
        evidence: result.evidence,
        benchmark: { value: null, label: null },
      },
    };
  }
  return baseline;
}

function mergeAuthorityInflowDimension(
  baseline: CanonicalDimension,
  result: AuthorityInflowResult,
): CanonicalDimension {
  if (result.state === 'measured' && result.score != null) {
    return {
      ...baseline,
      score: {
        value: result.score,
        state: 'measured',
        confidence: result.evidence.count >= 4 ? 'high' : result.evidence.count >= 2 ? 'medium' : 'low',
        band: canonicalBandFromValue(result.score, 'measured'),
        evidence: result.evidence,
        benchmark: { value: null, label: null },
      },
    };
  }
  // No real provider — Phase 1's `unavailable` posture for backlinks_score wins.
  return baseline;
}

function summarizeMatrix(matrix: AICitationMatrix): AICitationMatrixSummary {
  return {
    state: matrix.overall_score.state,
    overall_score: matrix.overall_score,
    cells: matrix.cells.map((cell) => ({
      provider: cell.provider,
      query_class: cell.query_class,
      state: cell.state,
      citation_rate: cell.citation_rate,
      mean_prominence: cell.mean_prominence,
      observed_count: cell.observed_count,
      reason_unavailable: cell.reason_unavailable,
    })),
    by_provider: matrix.by_provider,
    by_query_class: matrix.by_query_class,
    coverage: matrix.coverage,
  };
}

function summarizeEntity(result: EntityIntelligenceResult): EntityIntelligenceSummary {
  return {
    state: result.state,
    wikidata_qid: result.entity?.wikidata_qid ?? null,
    google_kg_mid: result.entity?.google_kg_mid ?? null,
    schema_completeness: result.entity?.schema_completeness ?? null,
    sameAs_count: result.entity?.sameAs_count ?? 0,
    sameAs_targets: result.entity?.sameAs_targets ?? [],
    canonical_description: result.entity?.canonical_description ?? null,
    reason_unavailable: result.reason_unavailable,
  };
}

function summarizeAuthorityInflow(result: AuthorityInflowResult): AuthorityInflowSummary {
  return {
    state: result.state,
    referring_domains: result.profile?.referring_domains ?? null,
    total_backlinks: result.profile?.total_backlinks ?? null,
    domain_authority: result.profile?.domain_authority ?? null,
    topical_authority: result.profile?.topical_authority ?? null,
    trust_flow: result.profile?.trust_flow ?? null,
    reason_unavailable: result.reason_unavailable,
  };
}

function summarizeTrust(result: TrustCoherenceResult): TrustCoherenceSummary {
  return {
    state: result.state,
    nap_consistency: result.signals?.nap_consistency ?? null,
    brand_description_consistency: result.signals?.brand_description_consistency ?? null,
    review_parity: result.signals?.review_parity ?? null,
    review_source_count: result.signals?.review_source_count ?? 0,
    expertise_score: result.signals?.expertise_signals?.organizational_about_completeness ?? null,
    reason_unavailable: result.reason_unavailable,
  };
}

function summarizeBenchmark(result: BenchmarkResult): BenchmarkOverlaySummary {
  return {
    state: result.state,
    vertical: result.band?.vertical ?? null,
    size_band: result.band?.size_band ?? 'unspecified',
    median: result.band?.median ?? {},
    top_quartile: result.band?.top_quartile ?? {},
    peer_count: result.band?.peer_count ?? null,
    percentile: result.percentile,
    reason_unavailable: result.reason_unavailable,
  };
}

function trustScoreFromSignals(result: TrustCoherenceResult): CanonicalScore {
  if (result.state !== 'measured' || !result.signals || result.score == null) {
    return {
      value: null,
      state: result.state,
      confidence: 'low',
      band: 'insufficient',
      evidence: result.evidence,
      benchmark: { value: null, label: null },
    };
  }
  return {
    value: result.score,
    state: 'measured',
    confidence: result.evidence.count >= 4 ? 'high' : result.evidence.count >= 2 ? 'medium' : 'low',
    band: canonicalBandFromValue(result.score, 'measured'),
    evidence: result.evidence,
    benchmark: { value: null, label: null },
  };
}

// ── Top-level builder ─────────────────────────────────────────────────────────

export async function buildCanonicalReport(snapshot: SnapshotReport, options?: {
  brandName?: string | null;
  domain?: string | null;
  category?: string | null;
  competitors?: string[];
  productServices?: string[];
  companyId?: string | null;
  scanProfile?: ScanProfile;
  engineVersion?: string;
  tenantContext?: TenantContext;
}): Promise<CanonicalReport> {
  // Phase 6: tenant context is the governance anchor. When omitted (legacy
  // callers), we synthesize a default-tenant context so the rest of the
  // pipeline still works — no synthetic tenant data is fabricated; this is
  // simply the single-tenant fallback shape.
  const tenantContext: TenantContext = options?.tenantContext ?? {
    tenant_id: options?.companyId ? `tenant:${options.companyId}` : 'tenant:default',
    actor: { id: 'system', kind: 'system', label: 'system' },
    request_at: new Date().toISOString(),
    correlation_id: `corr:${Date.now()}`,
  };
  const tenantPolicy = await loadTenantPolicy(tenantContext.tenant_id);
  // Phase 5: every report run runs under a scoped budget. The cost ledger
  // tracks every provider call and short-circuits over-budget calls to
  // `unavailable` (handled inside individual adapters).
  const scanProfile: ScanProfile = options?.scanProfile ?? 'standard';
  const policy = policyFor(scanProfile);
  const scanId = randomUUID();
  startScanBudget({ scan_id: scanId, ...policy.budget });
  const ctx: DimensionContext = { snapshot };

  const baselineDimensions: CanonicalDimension[] = CANONICAL_DIMENSIONS.map(
    (entry) => DIMENSION_BUILDERS[entry.key](ctx),
  );

  // Phase 3: hit the provider registry. Every provider is `unavailable` by default
  // — adapters return measured results only when their env flags are on.
  const brandName = options?.brandName ?? snapshot.company_context.company_name;
  const domain = options?.domain ?? snapshot.company_context.domain;
  const queries = deriveCitationQueries({
    brandName,
    domain,
    category: options?.category ?? null,
    competitors: options?.competitors ?? [],
    productServices: options?.productServices ?? [],
  });
  const matrix = await buildAICitationMatrix({ brandName, domain, queries });

  const knowledgeGraphProvider = getKnowledgeGraphProvider();
  const entityResult = await knowledgeGraphProvider.lookup({
    brandName: brandName ?? '',
    domain,
  });

  const authorityProvider = getAuthorityInflowProvider();
  const authorityResult = await authorityProvider.lookup({ domain: domain ?? '' });

  const trustProvider = getTrustCoherenceProvider();
  const trustResult = await trustProvider.lookup({ brandName: brandName ?? '', domain });

  const benchmarkProvider = getBenchmarkProvider();
  const benchmarkResult = await benchmarkProvider.lookup({
    vertical: options?.category ?? null,
    sizeHint: 'unspecified',
    userScore: null, // populated downstream once overall is computed.
  });

  const trajectoryProvider = getTrajectoryProvider();
  const trajectoryResult = await trajectoryProvider.lookup({
    companyId: options?.companyId ?? '',
  });

  // Merge real adapter results into the canonical dimensions.
  const dimensions = baselineDimensions.map((dim) => {
    if (dim.key === 'ai_surface_presence') return mergeAiSurfaceDimension(dim, matrix);
    if (dim.key === 'entity_graph_strength') return mergeEntityDimension(dim, entityResult);
    if (dim.key === 'authority_inflow') return mergeAuthorityInflowDimension(dim, authorityResult);
    if (dim.key === 'trust_coherence') {
      const trustScore = trustScoreFromSignals(trustResult);
      return { ...dim, score: trustScore };
    }
    return dim;
  });

  const pillars = groupDimensionsByPillar(dimensions);
  const overall = aggregateOverallScore(pillars);

  // Maturity stage classification (canonical 6-stage model). Derives from the
  // measured overall score; no synthesis when score is null.
  const placeholderReportForMaturity = {
    authority_overview: { overall_score: overall, maturity: snapshot.system_maturity },
    pillars,
  } as unknown as CanonicalReport;
  const maturityClassification = classifyMaturity(placeholderReportForMaturity);
  const legacyMaturity: SystemMaturityClass = legacyClassFromStage(maturityClassification.stage);

  // Phase 3: actions are now maturity-aware — built AFTER the maturity stage is
  // classified so the blocker pillar can drive leverage re-ranking.
  const actions = buildActionPlaybook(snapshot, {
    maturityStage: maturityClassification.stage,
    blockerPillar: maturityClassification.blocker.pillar,
  });

  // Phase 4: strategic playbook with dependency sequencing + per-pillar impact.
  const strategicPlaybook = buildStrategicPlaybook(actions, legacyMaturity);

  const headline = buildHeadlineNarrative({ overall, maturity: legacyMaturity, pillars });
  const primaryConstraint = buildPrimaryConstraintNarrative({ pillars, maturity: legacyMaturity });
  const nextUnlock = buildNextUnlockNarrative({ actions, maturity: legacyMaturity });
  const playbookSummary = buildPlaybookSummary({ actions, maturity: legacyMaturity });

  const aiSurfaceDim = dimensions.find((d) => d.key === 'ai_surface_presence');
  const entityDim = dimensions.find((d) => d.key === 'entity_graph_strength');
  const authorityDim = dimensions.find((d) => d.key === 'authority_inflow');
  const trustDim = dimensions.find((d) => d.key === 'trust_coherence');

  // Evidence-trace primitive: indexed by dimension and pillar.
  const evidenceByDimension: Partial<Record<CanonicalDimensionKey, EvidenceTrace>> = {};
  for (const d of dimensions) evidenceByDimension[d.key] = d.score.evidence;
  const evidenceByPillar: Partial<Record<PillarKey, EvidenceTrace>> = {};
  for (const p of pillars) evidenceByPillar[p.pillar] = p.score.evidence;

  const baseExecutiveInsights = buildExecutiveInsights({
    overall,
    maturity: legacyMaturity,
    pillars,
    actions,
    citationMatrix: summarizeMatrix(matrix),
    trajectory: {
      snapshots: trajectoryResult.snapshots.map((s) => ({
        observed_at: s.observed_at,
        score: s.authority_score,
        maturity: s.maturity,
      })),
      forecast: trajectoryResult.forecast,
      available: trajectoryResult.state === 'measured' && trajectoryResult.snapshots.length > 0,
    },
    competitiveSurfaceShare: buildCompetitiveSurfaceShare(snapshot, dimensions),
  });

  const reportShape: CanonicalReport = {
    authority_overview: {
      headline,
      overall_score: overall,
      maturity: legacyMaturity,
      primary_constraint: primaryConstraint,
      next_unlock: nextUnlock,
    },
    discoverability_authority_radar: {
      axes: dimensions,
      overall_confidence: overall.confidence,
      benchmark_label: benchmarkResult.state === 'measured' && benchmarkResult.band
        ? `${benchmarkResult.band.vertical} median`
        : null,
      competitor_overlay: [],
    },
    pillars,
    ai_surface_presence: {
      score: aiSurfaceDim?.score ?? emptyCanonicalScore('insufficient_signal'),
      rationale: {
        text: matrix.coverage.measured_cells > 0
          ? `${matrix.coverage.measured_cells} of ${matrix.coverage.total_cells} provider×query-class cells returned live citation data. Overall AI surface presence is ${matrix.overall_score.value ?? '—'}/100.`
          : `AI surface presence cannot be measured — no LLM provider is configured. ${matrix.coverage.unavailable_cells} of ${matrix.coverage.total_cells} cells are unavailable.`,
        confidence: matrix.overall_score.confidence,
        evidence: matrix.overall_score.evidence,
        maturity: legacyMaturity,
      },
      citation_matrix: summarizeMatrix(matrix),
    },
    knowledge_graph: {
      score: entityDim?.score ?? emptyCanonicalScore('insufficient_signal'),
      rationale: {
        text: entityResult.state === 'measured' && entityResult.entity
          ? entityResult.entity.wikidata_qid
            ? `Wikidata entity ${entityResult.entity.wikidata_qid} resolved with ${entityResult.entity.sameAs_count} sameAs link${entityResult.entity.sameAs_count === 1 ? '' : 's'} and ${Math.round(((entityResult.entity.schema_completeness ?? 0) * 100))}% schema completeness.`
            : 'Entity lookup ran but found no matching Wikidata entity for this brand. Entity graph strength is 0 — measurement is real.'
          : (entityResult.reason_unavailable ?? 'Knowledge-graph adapter is unavailable.'),
        confidence: entityResult.state === 'measured' ? 'high' : 'low',
        evidence: entityResult.evidence,
        maturity: legacyMaturity,
      },
      entity: summarizeEntity(entityResult),
    },
    authority_inflow: {
      score: authorityDim?.score ?? emptyCanonicalScore('unavailable'),
      rationale: {
        text: authorityResult.state === 'measured' && authorityResult.profile
          ? `Backlink provider returned ${authorityResult.profile.referring_domains} referring domain${authorityResult.profile.referring_domains === 1 ? '' : 's'} and ${authorityResult.profile.total_backlinks} backlinks. DA/TF data is real and timestamped.`
          : (authorityResult.reason_unavailable ?? 'Authority inflow adapter is unavailable.'),
        confidence: authorityResult.state === 'measured' ? 'high' : 'low',
        evidence: authorityResult.evidence,
        maturity: legacyMaturity,
      },
      profile: summarizeAuthorityInflow(authorityResult),
    },
    trust_coherence: {
      score: trustDim?.score ?? emptyCanonicalScore('unavailable'),
      rationale: {
        text: trustResult.state === 'measured' && trustResult.signals
          ? `Trust coherence measured across ${trustResult.signals.review_source_count} review source${trustResult.signals.review_source_count === 1 ? '' : 's'}.`
          : (trustResult.reason_unavailable ?? 'Trust coherence adapter is unavailable.'),
        confidence: trustResult.state === 'measured' ? 'medium' : 'low',
        evidence: trustResult.evidence,
        maturity: legacyMaturity,
      },
      signals: summarizeTrust(trustResult),
    },
    benchmark: {
      state: benchmarkResult.state,
      overlay: summarizeBenchmark(benchmarkResult),
      rationale: {
        text: benchmarkResult.state === 'measured' && benchmarkResult.band
          ? `Benchmarked against ${benchmarkResult.band.peer_count} peers in ${benchmarkResult.band.vertical} (${benchmarkResult.band.size_band}). ${benchmarkResult.percentile != null ? `Currently at the ${benchmarkResult.percentile}th percentile.` : 'Percentile not computed.'}`
          : (benchmarkResult.reason_unavailable ?? 'Benchmark dataset is unavailable.'),
        confidence: benchmarkResult.state === 'measured' ? 'medium' : 'low',
        evidence: benchmarkResult.evidence,
        maturity: legacyMaturity,
      },
    },
    maturity_stage: {
      stage: maturityClassification.stage,
      label: maturityClassification.stage === 'insufficient_signal' ? 'Insufficient Signal' : maturityClassification.stage.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()),
      next_stage: maturityClassification.next_stage,
      why_this_stage: maturityClassification.why_this_stage,
      blocker: maturityClassification.blocker,
      unlock: maturityClassification.unlock,
      confidence: maturityClassification.confidence,
      evidence: maturityClassification.evidence,
    },
    competitive_surface_share: buildCompetitiveSurfaceShare(snapshot, dimensions),
    authority_trajectory: {
      snapshots: trajectoryResult.snapshots.map((s) => ({
        observed_at: s.observed_at,
        score: s.authority_score,
        maturity: s.maturity,
      })),
      forecast: trajectoryResult.forecast,
      available: trajectoryResult.state === 'measured' && trajectoryResult.snapshots.length > 0,
    },
    action_playbook: {
      actions,
      summary: playbookSummary,
    },
    strategic_playbook: {
      actions: strategicPlaybook.actions,
      critical_path_ids: strategicPlaybook.critical_path.map((a) => a.id),
      parallel_track_ids: strategicPlaybook.parallel_track.map((a) => a.id),
      sequence_narrative: strategicPlaybook.sequence_narrative,
    },
    executive_insights: baseExecutiveInsights,
    change_intelligence: {
      state: 'insufficient_history',
      observed_at: new Date().toISOString(),
      comparison_baseline_at: null,
      authority_delta: { current: overall.value, previous: null, delta: null, direction: 'first_observation', significant: false },
      ai_visibility_delta: {
        current: aiSurfaceDim?.score.value ?? null,
        previous: null,
        delta: null,
        direction: 'first_observation',
        significant: false,
      },
      pillar_deltas: pillars.map((p) => ({
        pillar: p.pillar,
        delta: { current: p.score.value, previous: null, delta: null, direction: 'first_observation' as const, significant: false },
      })),
      notable_changes: [],
      reason_unavailable: 'Change intelligence is computed after the canonical report is assembled; the populated value is wired in below.',
    },
    forecast: {
      state: 'unavailable',
      horizon_days: 30,
      projected_score: null,
      confidence_band: null,
      trajectory: 'insufficient_history',
      history_count: 0,
      reason_unavailable: 'Forecast is computed after the canonical report is assembled.',
    },
    provider_observability: {
      observed_at: new Date().toISOString(),
      window_hours: 168,
      providers: [],
    },
    scan_metadata: {
      scan_profile: scanProfile,
      persisted: false,
      persisted_at: null,
      cost_summary: null,
    },
    governance: {
      tenant_id: tenantPolicy.tenant_id,
      plan_tier: tenantPolicy.plan_tier,
      policy_revision: tenantPolicy.policy_revision,
      enabled_providers: tenantPolicy.providers.enabled_providers,
      excluded_providers: tenantPolicy.providers.excluded_providers,
      external_calls_forbidden: tenantPolicy.providers.external_calls_forbidden,
      allowed_scan_profiles: tenantPolicy.scan_budget.allowed_profiles,
    },
    active_overrides: [],
    explanations: {} as CanonicalReport['explanations'],
    comparison: {} as CanonicalReport['comparison'],
    collaboration: {
      annotations: [],
      assignments: [],
      pinned_findings: [],
      recommendation_statuses: [],
    },
    evidence_trace: {
      by_dimension: evidenceByDimension,
      by_pillar: evidenceByPillar,
      overall: overall.evidence,
    },
  };

  // ── Phase 5: post-processing on the assembled report ───────────────────────
  // We compute change intelligence, forecast, and provider observability
  // AFTER the report is assembled so they read from the historical store
  // (and so we don't double-write the current snapshot before comparing).

  const companyId = options?.companyId ?? '';
  if (companyId) {
    try {
      const change = await buildChangeIntelligence({ companyId, current: reportShape });
      reportShape.change_intelligence = {
        state: change.state,
        observed_at: change.observed_at,
        comparison_baseline_at: change.comparison_baseline_at,
        authority_delta: change.authority,
        ai_visibility_delta: change.ai_visibility,
        pillar_deltas: change.pillars,
        notable_changes: change.notable_changes,
        reason_unavailable: change.reason_unavailable,
      };
      reportShape.executive_insights = applyChangeAwareness({
        base: baseExecutiveInsights,
        delta: change,
        maturity: legacyMaturity,
      });

      if (policy.computeForecast) {
        const snapshots = await getHistoricalStore().loadSnapshots({ company_id: companyId, limit: 24 });
        const forecast = buildForecast({ snapshots, horizonDays: 30 });
        reportShape.forecast = {
          state: forecast.state,
          horizon_days: forecast.horizon_days,
          projected_score: forecast.projected_score,
          confidence_band: forecast.confidence_band,
          trajectory: forecast.trajectory,
          history_count: forecast.history_count,
          reason_unavailable: forecast.reason_unavailable,
        };
      }

      const observability = await buildProviderObservability({ companyId, windowHours: 168 });
      reportShape.provider_observability = {
        observed_at: observability.observed_at,
        window_hours: observability.window_hours,
        providers: observability.providers.map((p) => ({
          provider_id: p.provider_id,
          state: p.state,
          uptime_pct: p.uptime_pct,
          total_calls: p.total_calls,
          cache_hit_ratio: p.cache_hit_ratio,
          mean_latency_ms: p.mean_latency_ms,
          p95_latency_ms: p.p95_latency_ms,
          freshness_lag_hours: p.freshness_lag_hours,
          circuit_breaker_state: p.circuit_breaker_state,
        })),
      };

      // Persist the snapshot AFTER comparing it against history. The writer
      // also records recommendation lifecycle (resolved / persistent / regressed).
      if (policy.persistHistory) {
        const persisted = await persistCanonicalSnapshot({
          companyId,
          report: reportShape,
          scanProfile,
          engineVersion: options?.engineVersion ?? 'phase-5',
          providerOutcomes: [], // Adapter-level outcomes are accumulated through the cost ledger; this slot remains for future per-call rows.
        });
        reportShape.scan_metadata.persisted = persisted.written;
        reportShape.scan_metadata.persisted_at = persisted.observedAt;
      }
    } catch (error) {
      // Phase 5 post-processing must NEVER block the report. A failure here
      // leaves the placeholder unavailable values in place, with the actual
      // reason logged for operators.
      // eslint-disable-next-line no-console
      console.warn('[canonical-report] Phase 5 post-processing failed:', error);
    }
  }

  // ── Phase 6: governance, overrides, explainability, collaboration ───────────
  if (companyId) {
    try {
      const overrides = await loadActiveOverrides(tenantContext, companyId);
      reportShape.active_overrides = overrides.map((o) => ({
        id: o.id,
        kind: o.kind,
        target_summary: JSON.stringify(o.target),
        reason: o.reason,
        created_at: o.created_at,
        created_by: o.created_by,
      }));

      // Apply analyst overrides at the report layer:
      //   - recommendation_dismissal removes the action from the playbook
      //   - evidence_suppression flips the dimension to insufficient_signal
      const dismissedIndex = indexActiveOverridesByActionId(overrides);
      if (Object.keys(dismissedIndex).length > 0) {
        reportShape.action_playbook = {
          ...reportShape.action_playbook,
          actions: reportShape.action_playbook.actions.filter((a) => !dismissedIndex[a.id]),
        };
        reportShape.strategic_playbook = {
          ...reportShape.strategic_playbook,
          actions: reportShape.strategic_playbook.actions.filter((a) => !dismissedIndex[a.id]),
        };
      }
      const suppressedDims = indexActiveOverridesByDimension(overrides);
      if (Object.keys(suppressedDims).length > 0) {
        reportShape.discoverability_authority_radar = {
          ...reportShape.discoverability_authority_radar,
          axes: reportShape.discoverability_authority_radar.axes.map((axis) =>
            suppressedDims[axis.key]
              ? {
                  ...axis,
                  score: emptyCanonicalScore('unavailable'),
                }
              : axis,
          ),
        };
      }

      // Comparison view (current vs historical / benchmark median).
      reportShape.comparison = await buildComparisonView({ companyId, current: reportShape });

      // Collaboration records.
      const collab = getCollaborationStore();
      const [annotations, assignments, pinned, recStatuses] = await Promise.all([
        collab.listAnnotations(tenantContext.tenant_id, companyId),
        collab.listAssignments(tenantContext.tenant_id, companyId),
        collab.listPinnedFindings(tenantContext.tenant_id, companyId),
        collab.listRecommendationStatuses(tenantContext.tenant_id, companyId),
      ]);
      reportShape.collaboration = {
        annotations,
        assignments,
        pinned_findings: pinned,
        recommendation_statuses: recStatuses,
      };

      // Explanations (built last so they reflect override-applied state).
      reportShape.explanations = buildExplanationIndex(reportShape);

      // Audit log: report generated.
      await logAuditEvent({
        tenantContext,
        kind: 'report_generated',
        payload: {
          company_id: companyId,
          scan_profile: scanProfile,
          authority_score: reportShape.authority_overview.overall_score.value,
          maturity_stage: reportShape.maturity_stage.stage,
          providers_used: tenantPolicy.providers.enabled_providers,
        },
      });
    } catch (error) {
      // Phase 6 governance must NEVER block the report.
      // eslint-disable-next-line no-console
      console.warn('[canonical-report] Phase 6 governance step failed:', error);
    }
  }

  // Close the cost ledger and surface the summary on scan_metadata.
  const ledger = endScanBudget(scanId);
  if (ledger) {
    reportShape.scan_metadata.cost_summary = {
      total_requests: ledger.totals.requests,
      total_cost_usd: Number(ledger.totals.cost_usd.toFixed(4)),
      cost_known_count: ledger.totals.cost_known_count,
      cost_unknown_count: ledger.totals.cost_unknown_count,
      per_provider: Object.fromEntries(
        Object.entries(ledger.per_provider).map(([key, slot]) => [
          key,
          {
            requests: slot.requests,
            cost_usd: Number(slot.cost_usd.toFixed(4)),
            cache_hit_ratio: slot.cache_hit_ratio,
          },
        ]),
      ),
    };
  }

  return reportShape;
}
