/** Canonical report — pillar assembly + builder entrypoint — split from canonicalReportBuilder.ts (barrel preserved; importers unchanged). */
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
import { resolveObservedBrandName } from '../intelligence/observedBrandName';
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

import { isMeasured, aggregateOverallScore, enforceTraceProvenance, type WebsiteBrandEvidence, type WebsiteAccessibilityEvidence, type DimensionContext, DIMENSION_BUILDERS, groupDimensionsByPillar, buildActionPlaybook } from './canonicalReportBuilderInputs';

function buildHeadlineNarrative(params: {
  overall: CanonicalScore;
  maturity: SystemMaturityClass;
  pillars: CanonicalPillarScore[];
}): CanonicalNarrative {
  const measuredPillars = params.pillars.filter((p) => isMeasured(p.score.value, p.score.state));
  const weakestPillar = [...measuredPillars].sort(
    (a, b) => (a.score.value ?? 0) - (b.score.value ?? 0),
  )[0];

  // BETA-ROADMAP-EXEC-014: honesty-of-interpretation clause. The Authority Index is a measure of
  // digital *evidence*, not verified market authority — external authority/reputation/AI-visibility
  // providers deepen it only once connected. Presentation only; reads the already-computed states.
  const evidenceBasis =
    ' This index reflects measured digital evidence — primarily on-site; external authority, reputation, and AI-visibility signals read as inferred or pending until those providers are connected, so it is not a verified market-authority ranking.';
  const text = params.overall.state === 'insufficient_signal'
    ? `Authority cannot yet be measured — insufficient signal across all five pillars. The brand reads as ${maturityNarrativeAdjective(params.maturity)} on the maturity curve until evidence is observed.`
    : weakestPillar
      ? `${PILLAR_META[weakestPillar.pillar].label} is the throttling pillar at ${weakestPillar.score.value}/100. The brand reads as ${maturityNarrativeAdjective(params.maturity)} on the authority maturity curve.${evidenceBasis}`
      : `All measured pillars are balanced. The brand reads as ${maturityNarrativeAdjective(params.maturity)} on the authority maturity curve.${evidenceBasis}`;

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
      : `Competitive surface compared across ${competitors.length} peer${competitors.length === 1 ? '' : 's'} on the dimensions where overlap is observable.`,
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
    // BR-H-003: surface that competitor values are crawl-derived (not a market panel) and blanks are
    // unavailable, not zero. Per-competitor state is not carried upstream (the snapshot radar has no
    // per-competitor provenance), so this is a truthful surface-level disclosure — no provenance invented.
    provenance: resolveCompetitorProvenance({ confidence, competitorCount: competitors.length }),
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
        // GAP-07: a provider trace entering Report 1 passes the same boundary as any other.
        evidence: enforceTraceProvenance({
          ...matrix.overall_score.evidence,
          sources: [...new Set<EvidenceSourceKind>([...matrix.overall_score.evidence.sources, 'llm_probe'])],
        }),
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
        confidence: confidenceBandFromCount(result.evidence.count),
        band: canonicalBandFromValue(result.score, 'measured'),
        // GAP-07: provider evidence crosses the same boundary as crawl evidence.
        evidence: enforceTraceProvenance(result.evidence),
        benchmark: { value: null, label: null },
      },
    };
  }
  return baseline;
}

export function mergeAuthorityInflowDimension(
  baseline: CanonicalDimension,
  result: AuthorityInflowResult,
): CanonicalDimension {
  if (result.state === 'measured' && result.score != null) {
    return {
      ...baseline,
      score: {
        value: result.score,
        state: 'measured',
        confidence: confidenceBandFromCount(result.evidence.count),
        band: canonicalBandFromValue(result.score, 'measured'),
        // GAP-07: provider evidence crosses the same boundary as crawl evidence.
        evidence: enforceTraceProvenance(result.evidence),
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
      evidence: enforceTraceProvenance(result.evidence),
      benchmark: { value: null, label: null },
    };
  }
  return {
    value: result.score,
    state: 'measured',
    confidence: confidenceBandFromCount(result.evidence.count),
    band: canonicalBandFromValue(result.score, 'measured'),
    evidence: enforceTraceProvenance(result.evidence),
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
  // BETA-EVIDENCE-EXEC-003: non-scored declared evidence (sameAs / certifications / legal transparency),
  // aggregated upstream from crawl signals. Pure passthrough into the presentation-only section — never scored.
  declaredEvidence?: CanonicalDeclaredEvidence | null;
  // BETA-EXEC-002: measured evidence from the Website Intelligence Brand + Accessibility
  // engines. Optional + additive — omitting it reproduces the prior behaviour exactly.
  websiteIntelligence?: {
    brand?: WebsiteBrandEvidence | null;
    accessibility?: WebsiteAccessibilityEvidence | null;
    // BETA-EXEC-004: full engine outputs for evidence-driven rationales (read-only, additive).
    engineEvidence?: EngineEvidenceInput | null;
  } | null;
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
  const ctx: DimensionContext = {
    snapshot,
    brand: options?.websiteIntelligence?.brand ?? null,
    accessibility: options?.websiteIntelligence?.accessibility ?? null,
    engineEvidence: options?.websiteIntelligence?.engineEvidence ?? null,
  };

  const baselineDimensions: CanonicalDimension[] = CANONICAL_DIMENSIONS.map(
    (entry) => DIMENSION_BUILDERS[entry.key](ctx),
  );

  // Phase 3: hit the provider registry. Every provider is `unavailable` by default
  // — adapters return measured results only when their env flags are on.
  const brandName = options?.brandName ?? snapshot.company_context.company_name;
  const domain = options?.domain ?? snapshot.company_context.domain;
  // GAP-17: the AI surface needs a brand LABEL to phrase its branded queries ("What is X?").
  // When the profile carries no company name the `branded` class produced no queries at all and
  // every one of its cells was recorded unavailable — a measurement gap, not a provider failure.
  // Fall back to the name the site itself declares on the pages already crawled for this domain.
  // Deliberately scoped to the AI-surface subsystem: the knowledge-graph and trust providers below
  // keep using the profile-declared `brandName`, so entity resolution cannot shift on a site label.
  const aiSurfaceBrandName = brandName ?? await resolveObservedBrandName({
    companyId: options?.companyId ?? null,
    domain,
  });
  // BETA-EVIDENCE-EXEC-001: maximise AI query coverage from ALREADY-AVAILABLE evidence. The competitor engine
  // has already detected named peers onto the snapshot; reuse them for the `competitive` query class instead
  // of relying only on user-supplied competitors. Reuse only — no fabrication, no new detection, no scoring
  // change; deriveCitationQueries still owns the query text and de-duplication is applied here.
  const detectedCompetitors = (snapshot.competitor_visuals?.competitor_positioning_radar?.competitors ?? [])
    .map((c) => (typeof c?.name === 'string' ? c.name.trim() : ''))
    .filter((n) => n.length > 0);
  const competitorsForQueries = [...new Set([...(options?.competitors ?? []), ...detectedCompetitors])].slice(0, 5);
  const queries = deriveCitationQueries({
    brandName: aiSurfaceBrandName,
    domain,
    category: options?.category ?? null,
    competitors: competitorsForQueries,
    productServices: options?.productServices ?? [],
  });
  // BETA-PHASE1-AUDIT-005: the scan-budget lifecycle (ALS scope + ledger) is owned
  // by composeSnapshotReport. This builder is reuse-only: nested paid-provider
  // adapters read the active scan via getActiveScanId(). When entered directly
  // (test harnesses) with no active scan, providers run ungoverned. No lifecycle
  // is created here.
  const {
    matrix,
    entityResult,
    authorityResult,
    trustResult,
    benchmarkResult,
    trajectoryResult,
    commercialResult,
  } = await (async () => {
    const matrix = await buildAICitationMatrix({ brandName: aiSurfaceBrandName, domain, queries });

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

    // BETA-REPORT-EXEC-006: canonical commercial evidence for ROI determinability. Unavailable (Not
    // Quantifiable) unless the commercial provider is configured AND real revenue/conversion rows exist.
    const commercialProvider = getCommercialProvider();
    const commercialResult = await commercialProvider.lookup({ companyId: options?.companyId ?? '' });

    return { matrix, entityResult, authorityResult, trustResult, benchmarkResult, trajectoryResult, commercialResult };
  })();

  // Merge real adapter results into the canonical dimensions.
  const dimensions = baselineDimensions.map((dim) => {
    if (dim.key === 'ai_surface_presence') return mergeAiSurfaceDimension(dim, matrix);
    if (dim.key === 'entity_graph_strength') return mergeEntityDimension(dim, entityResult);
    if (dim.key === 'authority_inflow') return mergeAuthorityInflowDimension(dim, authorityResult);
    if (dim.key === 'trust_coherence') {
      // BETA-ROADMAP-EXEC-012: graceful degradation. The review/reputation provider is AUTHORITATIVE when it
      // returns measured signals; otherwise it must NOT overwrite the Brand-engine Trust baseline (`dim`) with
      // an unavailable provider result. Reviews still win when measured; Brand Trust is the fallback. No scoring,
      // aggregation, weighting, provider, or review change — only which of two already-computed scores survives.
      if (trustResult.state === 'measured') return { ...dim, score: trustScoreFromSignals(trustResult) };
      return dim; // retain the Brand-engine baseline (measured brand-trust, else honest unavailable)
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

  // Quantified improvement plan: score-anchored to-dos with exact projected point gains.
  const improvementTodos = buildImprovementTodos(pillars, overall);

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
    // BETA-EVIDENCE-EXEC-003: non-scored presentation-only evidence. Pure passthrough — no score,
    // no band, no confidence, no aggregation input.
    declared_evidence: options?.declaredEvidence ?? null,
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
      // BR-H-002: propagate the provider's own state + velocity classification (previously dropped) so
      // measured history, projected forecast, and unavailable history are explicitly distinguished.
      provenance: resolveTrajectoryProvenance({
        state: trajectoryResult.state,
        snapshotCount: trajectoryResult.snapshots.length,
        classification: trajectoryResult.velocity.classification,
        forecastPresent: trajectoryResult.forecast != null,
        reasonUnavailable: trajectoryResult.reason_unavailable,
      }),
    },
    action_playbook: {
      actions,
      summary: playbookSummary,
    },
    improvement_todos: improvementTodos,
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
    // BR-H-004 / BETA-REPORT-EXEC-006: honest ROI determinability, now driven by the canonical Commercial
    // Adapter. `not_determinable` ("Not Quantifiable") when no commercial evidence is connected; upgrades to
    // `estimated` (native units) or `measured` (revenue) ONLY from real evidence. No ROI is ever fabricated.
    commercial_roi: resolveReportRoiDeterminability({
      hasCommercialEvidence: commercialResult.state === 'measured',
      quantified: commercialResult.quantified,
      measuredRevenue: commercialResult.measuredRevenue,
    }),
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

      // BR-H-005: after overrides are applied, disclose the MATERIAL ones in executive language so nothing
      // silently modified the report. Reuses active_overrides + governance; empty when none.
      reportShape.override_disclosure = resolveOverrideTransparency(reportShape.active_overrides, reportShape.governance);

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

  // The cost ledger is closed by the lifecycle owner (composeSnapshotReport),
  // which attaches scan_metadata.cost_summary after this builder returns.
  // When entered directly (tests) without an active scan, cost_summary stays null.

  // BETA-EVIDENCE-EXEC-002: compose the evidence-readiness governance summary from already-computed signals
  // (dimension states, AI coverage, scan metadata, maturity). Reads only — no scoring/evidence change.
  reportShape.evidence_readiness = resolveEvidenceReadiness(reportShape);

  return reportShape;
}

