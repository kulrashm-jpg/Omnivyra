import {
  composeDecisionIntelligence,
  type ComposedDecisionInsight,
} from './decisionComposerService';
import type { PersistedDecisionObject } from './decisionObjectService';
import { classifyDecisionType } from './decisionTypeRegistry';
import type { ReportReadinessResult } from './reportReadinessService';
import type { ResolvedReportInput } from './reportInputResolver';
import { impactScore, rankByImpactConfidence } from './reportDecisionUtils';
import {
  buildCompetitorIntelligence,
  buildCompetitorIntelligenceActive,
  competitorGapsToDecisions,
  enforceFinalCompetitorIntelligenceSync,
  type CompetitorIntelligenceResult,
} from './reportCompetitorIntelligenceService';
import { buildPublicDomainAuditDecisions, type PublicAuditResult } from './publicDomainAuditService';
import {
  synthesizePrimaryNarrative,
  type PrimaryNarrative,
} from './primaryNarrativeService';
import { buildDecisionBusinessImpact } from './businessImpactFormatter';
import {
  buildExpectedUpside,
  classifyPriorityType,
  type PriorityType,
} from './actionPriorityService';
import { buildReportScoreModel } from './reportScoreModelService';
import {
  average,
  clamp,
  getTone,
  hasConcreteSignal,
  nowIso,
  toneImpactWord,
} from './snapshotReportNarrativeHelpers';
import {
  buildActionPlan,
  toAction,
} from './snapshotReport/actionPlanBuilder';
import {
  assessPositioningAndMarket,
  evidenceSignalFromDecision,
  inferEffortLevel,
  isCompetitorDecision,
  resolverInputsPresent,
  signalKeyFromIssueType,
  toInsight,
  toOpportunity,
  uniqueById,
} from './snapshotReport/actionHelpers';
import {
  inferStructuredActionTrack,
  isContentDecision,
  isOpportunityCandidate,
} from './snapshotReport/actionTacticHelpers';
import {
  createNarrativeContext,
  extractCompanyNarrativeContext,
} from './snapshotReport/narrativeHelpers';
import {
  buildDecisionSnapshot,
  buildDiagnosis,
  buildSummary,
  buildTopPriorities,
  normalizeCoreProblem,
  sortSectionActions,
} from './snapshotReport/summaryDecisionHelpers';
import {
  capActionMentionsAcrossSections,
  capSignalReuseAcrossSections,
  ensureSectionFloor,
  SNAPSHOT_SECTION_DEFINITIONS,
} from './snapshotReport/sectionAssemblyHelpers';
import { signalAvailabilityFromDecisions } from './snapshotReport/signalAvailability';
import {
  classifySystemMaturity,
  emptyEnvelope,
  measuredEnvelope,
} from './snapshotReport/canonicalScoreState';
import { buildCanonicalReport } from './canonicalReport/canonicalReportBuilder';
import type { CanonicalReport } from './canonicalReport/canonicalReportTypes';
// BETA-PHASE1-AUDIT-005: composeSnapshotReport owns the report scan-budget lifecycle.
import { startScanBudget, endScanBudget } from './intelligence/costGovernance';
import { runWithScanBudget } from './intelligence/scanBudgetContext';
import { policyFor } from './intelligence/executionPolicies';
import { randomUUID } from 'crypto';
import {
  buildGeoAeoExecutiveSummary,
  buildGeoAeoVisuals,
} from './snapshotReport/geoAeoSummaryHelpers';
import { buildSeoExecutiveSummary } from './snapshotReport/seoExecutiveSummaryHelpers';
import {
  buildCompetitorIntelligenceSummary,
  buildCompetitorVisuals,
} from './snapshotReport/competitorSummaryHelpers';
import { buildCompetitiveSnapshotReport } from './reportCompetitorStrategyService';
import { buildUnifiedIntelligenceSummary } from './snapshotReport/unifiedSummaryHelpers';
import { buildSnapshotVisualIntelligence } from './snapshotReport/visualIntelligenceHelpers';
// BETA-EXEC-001: reuse the existing Website Intelligence engines (Technical/Content) as
// measured evidence for the Authority radar — fully implemented but previously wired only
// into the separate Website Health report. Consumed directly (no recomputation).
import {
  getWebsiteTechnicalIntelligence,
  getWebsiteContentIntelligence,
  getWebsiteAccessibilityIntelligence,
  getWebsiteBrandIntelligence,
} from './websiteIntelligence/websiteIntelligenceRepository';
import {
  SIGNAL_BUCKETS,
  type CompanyNarrativeContext,
  type MarketType,
  type NarrativeContext,
  type NarrativeSection,
  type PositioningStrength,
  type SnapshotAction,
  type SnapshotInsight,
  type SnapshotOpportunity,
  type SnapshotReport,
  type SnapshotReportOptions,
  type SnapshotReportSection,
  type SnapshotSectionDefinition,
  type StrategicContext,
} from './snapshotReportTypes';

function mapIssueToExecutiveArea(issueType: string): 'technical_seo' | 'content' | 'keywords' | 'backlinks' | 'visibility' {
  if (/(backlink|authority)/.test(issueType)) return 'backlinks';
  if (/(keyword|ranking|impression_click_gap)/.test(issueType)) return 'keywords';
  if (/(content|topic|cluster|weak_content_depth)/.test(issueType)) return 'content';
  if (/(geo|distribution|search|seo_gap)/.test(issueType)) return 'visibility';
  return 'technical_seo';
}

function severityLabel(score: number): 'critical' | 'moderate' | 'low' {
  if (score >= 75) return 'critical';
  if (score >= 45) return 'moderate';
  return 'low';
}

function impactBand(score: number): 'high' | 'medium' | 'low' {
  if (score >= 70) return 'high';
  if (score >= 45) return 'medium';
  return 'low';
}

function executivePriorityBand(score: number): 'high' | 'medium' | 'low' {
  if (score >= 72) return 'high';
  if (score >= 48) return 'medium';
  return 'low';
}

export async function composeSnapshotReportFromDecisions(params: {
  companyId: string;
  snapshotDecisions: PersistedDecisionObject[];
  supplementalGrowthDecisions?: PersistedDecisionObject[];
  resolvedInput?: ResolvedReportInput | null;
  readiness?: ReportReadinessResult | null;
  publicAudit?: Awaited<ReturnType<typeof buildPublicDomainAuditDecisions>> | null;
  competitorIntelligenceOverride?: CompetitorIntelligenceResult | null;
}): Promise<SnapshotReport> {
  const supplementalGrowthDecisions = params.supplementalGrowthDecisions ?? [];
  const baseCombined = uniqueById([...params.snapshotDecisions, ...supplementalGrowthDecisions]);
  const competitorIntelligence = enforceFinalCompetitorIntelligenceSync({
    result: params.competitorIntelligenceOverride ?? buildCompetitorIntelligence({
      decisions: baseCombined,
      resolvedInput: params.resolvedInput,
    }),
    resolvedInput: params.resolvedInput,
  });
  const competitorDecisions = competitorGapsToDecisions({
    companyId: params.companyId,
    gaps: competitorIntelligence.generated_gaps,
    reportTier: 'snapshot',
  });
  // Canonical Trust Foundation: no synthetic decision floor. We use real evidence only.
  const finalDecisions = uniqueById([...baseCombined, ...competitorDecisions]);
  // Internal helper: derive a count of weak/missing signal channels for the narrative
  // helpers. This replaces the previously-public signal_availability field on the report.
  const _weakSignalSnapshot = signalAvailabilityFromDecisions({
    decisions: finalDecisions,
    resolvedInput: params.resolvedInput,
  });
  const weakSignalChannels = Object.entries(_weakSignalSnapshot)
    .filter(([, status]) => status !== 'NORMAL')
    .map(([key]) => key.replace(/_/g, ' '));
  const companyContext = extractCompanyNarrativeContext({
    resolvedInput: params.resolvedInput,
  });
  const strategicContext = assessPositioningAndMarket({
    companyContext,
    competitorIntelligence,
    decisions: finalDecisions,
    publicAudit: params.publicAudit ?? null,
  });
  const narrative = synthesizePrimaryNarrative(finalDecisions);
  const coreProblem = normalizeCoreProblem(narrative.primary_problem);
  const diagnosis = buildDiagnosis({
    narrative,
    companyContext,
    strategicContext,
  });
  const score = buildReportScoreModel({
    decisions: finalDecisions,
    resolvedInput: params.resolvedInput,
    competitorIntelligence,
  });
  const narrativeContext = createNarrativeContext();
  // BETA-EXEC-001: fetch the Technical + Content engines once (parallel, best-effort — a
  // failure degrades to the prior behaviour, never blocks the report). Their measured scores
  // replace the heuristic/decision-derived radar axes when the engine has real evidence.
  // BETA-EXEC-001 (Technical/Content → radar) + BETA-EXEC-002 (Accessibility → Foundation,
  // Brand → Trust): fetch all four engines once (parallel, best-effort).
  // BETA-EXEC-003 (robustness): defer each call into a microtask so a SYNCHRONOUS throw from an
  // engine (e.g. an admin-client/env-isolation guard that runs before the first await) is also
  // converted to a rejection and swallowed by .catch — honouring the "never blocks the report"
  // contract above. A bare `.catch()` on a sync-throwing call would not catch it.
  const [wiTechnical, wiContent, wiAccessibility, wiBrand] = await Promise.all([
    Promise.resolve().then(() => getWebsiteTechnicalIntelligence(params.companyId)).catch(() => null),
    Promise.resolve().then(() => getWebsiteContentIntelligence(params.companyId)).catch(() => null),
    Promise.resolve().then(() => getWebsiteAccessibilityIntelligence(params.companyId)).catch(() => null),
    Promise.resolve().then(() => getWebsiteBrandIntelligence(params.companyId)).catch(() => null),
  ]);
  // BETA-EXEC-004: single deterministic engine-evidence digest, reused by insights, the executive
  // summary, and the canonical dimension rationales (read-only — no scoring/recalculation).
  const engineEvidenceDigest = { technical: wiTechnical, content: wiContent, accessibility: wiAccessibility, brand: wiBrand };
  const visualIntelligence = buildSnapshotVisualIntelligence({
    decisions: finalDecisions,
    score,
    competitorIntelligence,
    publicAudit: params.publicAudit ?? null,
    narrativeContext,
    websiteIntelligence: {
      technical: wiTechnical
        ? { score: wiTechnical.technicalScore, confidence: wiTechnical.confidence, evaluatedAt: wiTechnical.freshness?.lastEvaluatedAt ?? null }
        : null,
      content: wiContent
        ? { score: wiContent.contentScore, confidence: wiContent.confidence, evaluatedAt: wiContent.freshness?.lastEvaluatedAt ?? null }
        : null,
    },
  });
  const geoAeoVisuals = buildGeoAeoVisuals({
    publicAudit: params.publicAudit ?? null,
  });
  const geoAeoExecutiveSummary = buildGeoAeoExecutiveSummary({
    geoAeoVisuals,
  });
  const recommendationContext = {
    publicAudit: params.publicAudit ?? null,
    competitorIntelligence,
    authorityScore: visualIntelligence.seo_capability_radar.backlinks_score,
    contentQualityScore: visualIntelligence.seo_capability_radar.content_quality_score,
    aiVisibilityScore: geoAeoExecutiveSummary.overall_ai_visibility_score,
  };

  let sections = SNAPSHOT_SECTION_DEFINITIONS.map((definition) => {
    const sectionDecisions = finalDecisions
      .filter(definition.matches)
      .sort(rankByImpactConfidence);

    return {
      section_name: definition.section_name,
      IU_ids: definition.IU_ids,
      insights: sectionDecisions.slice(0, 4).map((decision) => toInsight(decision, companyContext, engineEvidenceDigest)),
      opportunities: sectionDecisions.filter(isOpportunityCandidate).slice(0, 2).map(toOpportunity),
      actions: sortSectionActions(sectionDecisions.slice(0, 3).map((decision) => toAction(decision, companyContext, strategicContext, recommendationContext))),
    } satisfies SnapshotReportSection;
  });

  sections = sections.map((section, index) => {
    const ensured = ensureSectionFloor({
      section,
      fallbackPool: finalDecisions,
      sectionDefinition: SNAPSHOT_SECTION_DEFINITIONS[index],
      companyContext,
      strategicContext,
      recommendationContext,
      toInsight,
      toAction,
      toOpportunity,
      isOpportunityCandidate,
    });
    return {
      ...ensured,
      actions: sortSectionActions(ensured.actions),
    };
  });

  // Canonical Trust Foundation: no min-insight/min-action backfill loops. Sections render
  // exactly what their evidence supports — empty sections are honest sections.
  sections = capSignalReuseAcrossSections(sections, signalKeyFromIssueType, 2);
  sections = capActionMentionsAcrossSections(sections, 1);

  const topPriorities = buildTopPriorities(sections);
  const summary = buildSummary({
    sections,
    weakSignalChannels,
    competitorIntelligence,
    narrative,
    readiness: params.readiness,
    topPriorityTitle: topPriorities[0]?.title ?? null,
    coreProblem,
    companyContext,
    // BETA-EXEC-004: measured engine evidence for an evidence-driven summary clause.
    engineEvidence: engineEvidenceDigest,
  });
  const seoExecutiveSummary = buildSeoExecutiveSummary({
    decisions: finalDecisions,
    score,
    visualIntelligence,
    topPriorities,
    companyContext,
    strategicContext,
    publicAudit: params.publicAudit ?? null,
    competitorIntelligence,
    geoAeoSummary: geoAeoExecutiveSummary,
    mapIssueToExecutiveArea,
    severityLabel,
    impactBand,
    executivePriorityBand,
    evidenceSignalFromDecision,
    inferEffortLevel,
    inferStructuredActionTrack,
    buildActionPlan,
  });
  // Canonical Trust Foundation: classify system maturity from measured foundation vs authority signals.
  // This distinguishes structurally-weak systems (broken fundamentals) from early-stage brands
  // (good fundamentals, immature market authority) so narratives don't punish new companies.
  const technicalRadarValue = visualIntelligence.seo_capability_radar.technical_seo_score;
  const contentQualityValue = visualIntelligence.seo_capability_radar.content_quality_score;
  const backlinksValue = visualIntelligence.seo_capability_radar.backlinks_score;
  const competitorIntelValue = visualIntelligence.seo_capability_radar.competitor_intelligence_score;
  const foundationEnvelopes = [
    typeof technicalRadarValue === 'number'
      ? measuredEnvelope({ value: technicalRadarValue, evidence_count: 1, evidence_sources: ['crawler'] })
      : emptyEnvelope(),
    typeof contentQualityValue === 'number'
      ? measuredEnvelope({ value: contentQualityValue, evidence_count: 1, evidence_sources: ['decisions'] })
      : emptyEnvelope(),
  ];
  const authorityEnvelopes = [
    typeof backlinksValue === 'number'
      ? measuredEnvelope({ value: backlinksValue, evidence_count: 1, evidence_sources: ['decisions'] })
      : emptyEnvelope('unavailable'),
    typeof competitorIntelValue === 'number'
      ? measuredEnvelope({ value: competitorIntelValue, evidence_count: 1, evidence_sources: ['competitor_intelligence'] })
      : emptyEnvelope(),
  ];
  const systemMaturity = classifySystemMaturity({
    foundationEnvelopes,
    authorityEnvelopes,
  });

  const unifiedIntelligenceSummary = buildUnifiedIntelligenceSummary({
    coreProblem,
    seoSummary: seoExecutiveSummary,
    geoAeoSummary: geoAeoExecutiveSummary,
    systemMaturity,
    narrativeContext,
  });
  const competitorVisuals = buildCompetitorVisuals({
    competitorIntelligence,
    visualIntelligence,
    geoAeoVisuals,
    decisions: finalDecisions,
  });
  const competitorIntelligenceSummary = buildCompetitorIntelligenceSummary({
    competitorIntelligence,
    competitorVisuals,
    narrativeContext,
  });
  const competitiveSnapshot = buildCompetitiveSnapshotReport(competitorIntelligence);
  const decisionSnapshot = buildDecisionSnapshot({
    diagnosis,
    coreProblem,
    companyContext,
    strategicContext,
    weakSignalChannelCount: weakSignalChannels.length,
    unifiedSummary: unifiedIntelligenceSummary,
    seoSummary: seoExecutiveSummary,
    geoAeoSummary: geoAeoExecutiveSummary,
    competitorSummary: competitorIntelligenceSummary,
    competitorIntelligence,
    topPriorities,
  });

  // Build the canonical (Phase 2) report layer over the snapshot. The canonical layer
  // becomes the source of truth for executive surface, radar, pillars, action playbook,
  // and evidence trace. The legacy fields below remain so trend/PDF/comparison consumers
  // can be migrated in dedicated passes; new UI surfaces consume `canonical` only.
  const canonicalSnapshotShape: SnapshotReport = {
    report_type: 'snapshot',
    score,
    diagnosis,
    summary,
    primary_problem: coreProblem,
    secondary_problems: narrative.secondary_problems.slice(0, 2),
    system_maturity: systemMaturity,
    canonical: undefined as unknown as CanonicalReport,
    seo_executive_summary: seoExecutiveSummary,
    geo_aeo_visuals: geoAeoVisuals,
    geo_aeo_executive_summary: geoAeoExecutiveSummary,
    unified_intelligence_summary: unifiedIntelligenceSummary,
    competitor_visuals: competitorVisuals,
    competitor_intelligence_summary: competitorIntelligenceSummary,
    competitive_snapshot: competitiveSnapshot,
    visual_intelligence: visualIntelligence,
    company_context: {
      company_name: companyContext.companyName,
      domain: companyContext.domain,
      homepage_headline: companyContext.homepageHeadline,
      tagline: companyContext.tagline,
      primary_offering: companyContext.primaryOffering,
      positioning: companyContext.positioning,
      market_context: companyContext.marketContext,
      logo_url: companyContext.logoUrl,
      favicon_url: companyContext.faviconUrl,
      positioning_strength: strategicContext.positioningStrength,
      positioning_narrative: strategicContext.positioningNarrative,
      positioning_gap: strategicContext.positioningGap,
      market_type: strategicContext.marketType,
      market_narrative: strategicContext.marketNarrative,
      strategy_alignment: strategicContext.strategyAlignment,
      market_position: strategicContext.marketPosition,
      market_position_statement: strategicContext.marketPositionStatement,
      position_implication: strategicContext.positionImplication,
      execution_risk: strategicContext.executionRisk,
      resilience_guidance: strategicContext.resilienceGuidance,
    },
    competitor_intelligence: competitorIntelligence,
    decision_snapshot: decisionSnapshot,
    top_priorities: topPriorities,
    pipeline_audit: {
      resolver_inputs_present: resolverInputsPresent(params.resolvedInput),
      snapshot_decisions: params.snapshotDecisions.length,
      supplemental_growth_decisions: supplementalGrowthDecisions.length,
      competitor_gap_decisions_added: competitorDecisions.length,
      fallback_decisions_added: 0,
      final_decisions: finalDecisions.length,
      final_insights: sections.reduce((sum, section) => sum + section.insights.length, 0),
      final_actions: sections.reduce((sum, section) => sum + section.actions.length, 0),
    },
    sections,
  };
  // Phase 3: canonical builder is async because it queries the provider registry
  // (LLM citation matrix, knowledge graph, authority inflow, trust, benchmark,
  // trajectory). Every provider returns `state: 'unavailable'` by default — no
  // synthetic data is introduced.
  canonicalSnapshotShape.canonical = await buildCanonicalReport(canonicalSnapshotShape, {
    brandName: companyContext.companyName,
    domain: companyContext.domain,
    category: params.resolvedInput?.resolved.businessType ?? null,
    competitors: (params.resolvedInput?.resolved.competitors ?? []).map((c) => String(c)),
    productServices: companyContext.productServices,
    companyId: params.companyId,
    // BETA-EVIDENCE-EXEC-003: non-scored declared evidence, aggregated by the public audit from crawl signals.
    declaredEvidence: params.publicAudit?.declared_evidence ?? null,
    // BETA-EXEC-002: Brand → Trust pillar, Accessibility → Foundation pillar (consumed
    // directly from the engines; unavailable when the engine has no evidence).
    websiteIntelligence: {
      brand: wiBrand
        ? { score: wiBrand.brandScore, brandTrust: wiBrand.brandTrust, confidence: wiBrand.confidence, evaluatedAt: wiBrand.freshness?.lastEvaluatedAt ?? null }
        : null,
      accessibility: wiAccessibility
        ? { score: wiAccessibility.accessibilityScore, wcagLevel: wiAccessibility.wcagLevel, criticalIssues: (wiAccessibility.criticalIssues ?? []).length, confidence: wiAccessibility.confidence, evaluatedAt: wiAccessibility.freshness?.lastEvaluatedAt ?? null }
        : null,
      // BETA-EXEC-004: full engine outputs for evidence-driven dimension rationales (read-only).
      engineEvidence: engineEvidenceDigest,
    },
  });
  return canonicalSnapshotShape;
}

export async function composeSnapshotReport(
  companyId: string,
  options?: SnapshotReportOptions,
): Promise<SnapshotReport> {
  const [snapshotComposition, growthComposition] = await Promise.all([
    composeDecisionIntelligence({
      companyId,
      reportTier: 'snapshot',
      status: ['open'],
    }),
    composeDecisionIntelligence({
      companyId,
      reportTier: 'growth',
      status: ['open'],
    }),
  ]);

  const growthSupplement = growthComposition.decisions.filter((decision) => {
    const category = classifyDecisionType(decision.issue_type);
    return category === 'authority' || category === 'trust' || category === 'geo' || isContentDecision(decision) || isCompetitorDecision(decision);
  });
  const publicAudit = await buildPublicDomainAuditDecisions({
    companyId,
    reportTier: 'snapshot',
    resolvedInput: options?.resolvedInput ?? null,
  });
  // BETA-PHASE1-AUDIT-005: this is the SINGLE owner of the report scan-budget
  // lifecycle. One ALS scope + one ledger enclose EVERY paid provider — SERP
  // (competitor intelligence) AND the report providers (LLM/Ahrefs, inside
  // buildCanonicalReport via composeSnapshotReportFromDecisions). Inner code
  // reuses the active scan through getActiveScanId(); no inner lifecycle exists.
  // Report-side providers historically resolved a 'standard' policy budget; that
  // is preserved here.
  const scanId = randomUUID();
  startScanBudget({ scan_id: scanId, ...policyFor('standard').budget });
  let report: SnapshotReport | null = null;
  try {
    report = await runWithScanBudget(scanId, async () => {
      const activeCompetitorIntelligence = await buildCompetitorIntelligenceActive({
        companyId,
        decisions: uniqueById([...snapshotComposition.decisions, ...growthSupplement, ...publicAudit.decisions]),
        resolvedInput: options?.resolvedInput ?? null,
      });

      return composeSnapshotReportFromDecisions({
        companyId,
        snapshotDecisions: [...snapshotComposition.decisions, ...publicAudit.decisions],
        supplementalGrowthDecisions: growthSupplement,
        resolvedInput: options?.resolvedInput ?? null,
        readiness: options?.readiness ?? null,
        publicAudit,
        competitorIntelligenceOverride: activeCompetitorIntelligence,
      });
    });
  } finally {
    // Single close of the module-level ledger (always released, even on throw —
    // the previous owner leaked the entry on failure). On success, attach
    // cost_summary (execution metadata) at the lifecycle boundary; the value is
    // identical to what the builder produced — only its producer moved.
    const ledger = endScanBudget(scanId);
    if (ledger && report?.canonical) {
      report.canonical.scan_metadata.cost_summary = {
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
  }

  // Reachable only when the try completed without throwing (report is set).
  return report as SnapshotReport;
}

// Phase 2 deletion: createSnapshotInsightsFromComposition was dead code (no callers).
// Snapshot insights now flow through the canonical pillar/dimension structure.
