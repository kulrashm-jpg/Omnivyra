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
// GAP-10 — presentation grouping for the check evidence the engines already produced.
import { buildWebsiteChecks } from './snapshotReport/websiteCheckGrouping';
import {
  classifySystemMaturity,
  emptyEnvelope,
  measuredEnvelope,
} from './snapshotReport/canonicalScoreState';
// Report 1 assembly: cross-source opportunities, priorities and the 30/60/90 plan.
import { assembleDigitalSnapshot } from './digitalSnapshotAssembly';
// Phase 4: performance + digital-experience intelligence over the existing crawl corpus.
import { assessDigitalExperience } from './digitalExperience';
import { collectPerformanceEvidence, loadExperiencePages } from './digitalExperienceRepository';
// Phase 3: the two competition views, built from the canonical relation model.
import { buildCompetitiveTables, buildCompetitorTableRows } from './competitiveTables';
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
  type ScoreState,
  type CompanyNarrativeContext,
  type MarketType,
  type NarrativeContext,
  type NarrativeSection,
  type PositioningStrength,
  type SnapshotAction,
  type SnapshotInsight,
  type SnapshotOpportunity,
  type SnapshotReport,
  type SnapshotCrawlEvidence,
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
  /** GAP-09 — the report-triggered crawl's own result, handed down by the caller that ran it. */
  crawlEvidence?: SnapshotCrawlEvidence | null;
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

  // Phase 4 — performance + digital experience. Both fail soft: a provider outage or an
  // unreadable table degrades the report to honest abstention, never to a fabricated verdict.
  const experiencePages = await loadExperiencePages(params.companyId).catch(() => []);
  const performanceEvidence = await collectPerformanceEvidence({ pages: experiencePages }).catch(() => null);
  const digitalExperience = assessDigitalExperience({
    pages: experiencePages,
    performance: performanceEvidence,
  });

  // Phase 3 tables, hoisted so the Report 1 assembler can read them.
  const competitiveTables = buildCompetitiveTables(
    buildCompetitorTableRows(
      (competitorIntelligence.detected_competitors ?? []) as never,
      { geography: params.resolvedInput?.resolved.geography ?? null },
    ),
  );
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
    // Phase 4 — performance + digital-experience evidence. Both read the EXISTING crawl
    // corpus; PageSpeed is attempted only when a quota is configured, and reports
    // `unavailable` with the real reason otherwise. Neither produces an Omnivyra score.
    performance: performanceEvidence
      ? {
        state: performanceEvidence.state,
        reasonUnavailable: performanceEvidence.reasonUnavailable,
        coverage: performanceEvidence.coverage,
        byFormFactor: performanceEvidence.byFormFactor,
        observations: performanceEvidence.observations.map((o) => ({
          url: o.url, formFactor: o.formFactor,
          providerPerformanceScore: o.providerPerformanceScore,
          overallCategory: o.overallCategory, observedAt: o.observedAt,
          provider: o.provider, state: o.state, reasonUnavailable: o.reasonUnavailable,
          metrics: o.metrics,
        })),
      }
      : null,
    digital_experience: digitalExperience
      ? {
        readiness: digitalExperience.readiness,
        state: digitalExperience.state,
        coverage: digitalExperience.coverage,
        pillars: digitalExperience.pillars,
        findings: digitalExperience.findings,
        limitations: digitalExperience.limitations,
        describesVisitorBehavior: false as const,
      }
      : null,
    // Phase 3 — the two customer-facing competition views, rendered from the CANONICAL
    // two-axis relation model. This service performs no classification of its own: it hands
    // the already-ranked competitors to `buildCompetitorTableRows`, which reuses
    // `deriveCompetitorRelations` (the sole owner) and cannot promote a competitor into a
    // category. A competitor whose axes abstained appears in both tables with null scores
    // and is listed under `unclassified`.
    competitive_tables: competitiveTables,
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

  // Phase 2 — promote evidence coverage to a FIRST-CLASS report field.
  //
  // `resolveEvidenceReadiness` already runs inside the canonical builder and lands at
  // `canonical.evidence_readiness`, three levels deep, where no report surface read it.
  // A CMO needs to know how much of the report is actually measured BEFORE reading its
  // conclusions, so the same object (not a recomputation) is lifted to the top level.
  // Nothing is re-derived and no score is reduced: coverage and confidence stay separate
  // from the scores themselves, exactly as the existing model intends.
  const readiness = canonicalSnapshotShape.canonical?.evidence_readiness ?? null;
  canonicalSnapshotShape.evidence_coverage = readiness
    ? {
      state: readiness.state,
      disposition: readiness.disposition,
      coverage_percentage: readiness.coverage_percentage,
      ai_coverage_percentage: readiness.ai_coverage_percentage,
      connected_sources: readiness.connected_sources,
      total_sources: readiness.total_sources,
      website_scanned: readiness.website_scanned,
      authority_measured: readiness.authority_measured,
      headline: readiness.headline,
      gaps: readiness.gaps,
      next_moves: readiness.next_moves,
    }
    : null;

  // GAP-08 — customer-facing identity fields, each carrying its own provenance.
  //
  // The Brand Brief has always rendered Offering / Positioning / Market / Differentiation with a
  // `measured` state and no marker, while every value came from the company's own profile. The
  // sharpest case is `homepage_headline`: the NAME says the crawler read it off the home page, the
  // VALUE is `profile.key_messages` typed into an onboarding form.
  //
  // Provenance is decided HERE, where the value is chosen and both candidates are in scope — not in
  // the renderer, which cannot know where a string came from. The vocabulary is GAP-07's; nothing
  // is reclassified and no second taxonomy is introduced.
  //
  // The observed headline is read from `experiencePages`, already loaded above for the digital-
  // experience assessment, so this costs no extra query and no extra request.
  const homepage = experiencePages.find((page) => /home/i.test(String(page.page_type ?? '')))
    ?? experiencePages.find((page) => (page.crawl_depth ?? 0) === 0)
    ?? null;
  const observedHeadline = (() => {
    if (!homepage) return null;
    const h1 = (homepage.headings ?? []).find((h) => Number(h?.level ?? 0) === 1)?.text;
    const candidate = (typeof h1 === 'string' && h1.trim()) || (typeof homepage.title === 'string' && homepage.title.trim()) || '';
    return candidate || null;
  })();
  const declaredPositioning = companyContext.positioning ?? companyContext.homepageHeadline ?? null;

  const normalizeForComparison = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
  const identityField = (params: {
    key: 'offering' | 'positioning' | 'market' | 'differentiation';
    label: string;
    declared: string | null;
    observed: string | null;
    /** Provenance to use when only the declared value exists. */
    declaredProvenance?: 'COMPANY_CONFIRMED' | 'INFERRED';
  }): NonNullable<SnapshotReport['company_identity']>['fields'][number] | null => {
    const declared = params.declared?.trim() || null;
    const observed = params.observed?.trim() || null;
    if (!declared && !observed) return null;
    if (observed && !declared) {
      return { key: params.key, label: params.label, value: observed, provenance: 'PUBLIC_OBSERVED', declaredValue: null, observedValue: observed, agreement: 'observed_only' };
    }
    if (declared && !observed) {
      return { key: params.key, label: params.label, value: declared, provenance: params.declaredProvenance ?? 'COMPANY_CONFIRMED', declaredValue: declared, observedValue: null, agreement: 'declared_only' };
    }
    // Both exist. The OBSERVED value is what the public web actually shows, so it is what the
    // report presents — but when the two disagree the declared version is retained beside it
    // rather than being quietly discarded, because the disagreement is itself a finding.
    const agrees = normalizeForComparison(declared!) === normalizeForComparison(observed!);
    return {
      key: params.key, label: params.label, value: observed!, provenance: 'PUBLIC_OBSERVED',
      declaredValue: declared, observedValue: observed, agreement: agrees ? 'agree' : 'differ',
    };
  };

  const identityFields = [
    // Declared only: the profile's product/service list has no crawl counterpart the report reads.
    identityField({ key: 'offering', label: 'Offering', declared: companyContext.primaryOffering ?? null, observed: null }),
    // The audit's original finding — declared `key_messages` reconciled against the crawled H1.
    identityField({ key: 'positioning', label: 'Positioning', declared: declaredPositioning, observed: observedHeadline }),
    // Composed from declared business type + geography.
    identityField({ key: 'market', label: 'Market', declared: companyContext.marketContext ?? null, observed: null }),
    // A conclusion, but one derived from DECLARED inputs — so company-confirmed, not inferred-from-
    // observation. Labelling it `INFERRED` would imply an evidential base it does not have.
    identityField({ key: 'differentiation', label: 'Differentiation', declared: strategicContext.positioningNarrative ?? strategicContext.positioningGap ?? null, observed: null }),
  ].filter((field): field is NonNullable<typeof field> => field !== null);

  canonicalSnapshotShape.company_identity = {
    fields: identityFields,
    hasDeclared: identityFields.some((f) => f.declaredValue !== null),
    hasObserved: identityFields.some((f) => f.observedValue !== null),
  };

  // GAP-10 — carry the per-check website evidence the engines already produced.
  //
  // `engineEvidenceDigest` above holds the technical, content and accessibility results for this
  // run. Until now it fed narrative text only: `enrichRationale` compressed 60+ checks into one
  // "weakest X; strongest Y" sentence and the checks themselves were discarded before persistence.
  // A production report therefore stated `pagesEvaluated: 27` while `robots_txt`, `sitemap_xml`,
  // `structured_data`, `hreflang` and `duplicate_titles` had ZERO occurrences in the stored
  // `composed_report` — the site had been measured and the customer was never told what was found.
  //
  // Nothing is re-evaluated, re-scored or re-thresholded here; the existing results are carried
  // across with their own statuses intact. `buildWebsiteChecks` returns null when no check was
  // evaluable, so a company with no crawled pages abstains instead of rendering an all-"not
  // evaluated" section (GAP-02's rule, applied to this surface).
  canonicalSnapshotShape.website_checks = buildWebsiteChecks({
    technical: engineEvidenceDigest.technical,
    content: engineEvidenceDigest.content,
    accessibility: engineEvidenceDigest.accessibility,
    pagesEvaluated: digitalExperience?.coverage?.pagesEvaluated ?? experiencePages.length,
  });

  // GAP-06 — public-domain search visibility.
  //
  // Built ENTIRELY from the own-domain rows the competitor engine harvested out of its own SERP
  // responses. No request is issued here, and no Search Console data touches this surface: the
  // report's existing rank signal (`visual_intelligence.seo_capability_radar.rank_tracking_score`)
  // is GSC-derived and deliberately NOT consulted, because "what does the connected property's
  // private analytics say" is a different question from "what do public search results establish".
  //
  // The four states are kept distinct on purpose. `insufficient_signal` means queries ran and the
  // domain was not found — a real, reportable finding. It is not `unavailable` (acquisition could
  // not run) and it is emphatically not a position of 0, which does not exist as a rank.
  const searchObservations = competitorIntelligence.own_domain_search_observations ?? [];
  const searchAcquisition = competitorIntelligence.search_acquisition;
  const rankedObservations = searchObservations.filter((o) => typeof o.position === 'number');
  const searchState: NonNullable<SnapshotReport['search_visibility']>['state'] =
    searchObservations.length === 0
      ? (searchAcquisition?.status === 'failed' ? 'failed' : 'unavailable')
      : rankedObservations.length > 0
        ? 'measured'
        : 'insufficient_signal';
  canonicalSnapshotShape.search_visibility = {
    state: searchState,
    // Provider identity only — never a credential, never an environment-variable name.
    provider: searchObservations.length > 0 || searchAcquisition?.status === 'ok' ? 'serpapi' : null,
    // GAP-07 — self-describing provenance. This surface is public-record evidence; the GSC-derived
    // rank signal on the radar is CONNECTED_SOURCE and is deliberately a different thing.
    source: 'serp',
    provenance: 'PUBLIC_OBSERVED',
    observedAt: searchObservations.length > 0 ? nowIso() : null,
    queriesRun: searchObservations.length,
    queriesRanked: rankedObservations.length,
    bestPosition: rankedObservations.length > 0
      ? Math.min(...rankedObservations.map((o) => o.position as number))
      : null,
    observations: searchObservations,
    requestsMade: searchAcquisition?.requests_made ?? 0,
    reason: searchState === 'measured'
      ? null
      : searchState === 'insufficient_signal'
        ? `The domain did not appear in the public results returned for ${searchObservations.length} quer${searchObservations.length === 1 ? 'y' : 'ies'}.`
        : searchAcquisition?.reason ?? 'Public search results could not be retrieved for this report.',
  };

  // GAP-09 — record what evidence acquisition actually did on this run.
  //
  // The crawl outcome arrives from the caller that ran it (`generateReportPayload`), where it was
  // previously only logged; the SERP state is read from the competitor engine's existing
  // `discovery_metadata`. Both are stored verbatim. Nothing is derived, and a missing input stays
  // missing — an absent crawl result records `null`, never a manufactured success.
  //
  // This is deliberately assembled even when every other surface abstains: a report where
  // everything reads "insufficient" is only interpretable if the reader can tell whether the site
  // was fetched and found healthy, or never fetched at all.
  const discoveryMetadata = competitorIntelligence.discovery_metadata ?? null;
  canonicalSnapshotShape.evidence_acquisition = {
    crawl: params.crawlEvidence ?? null,
    serp: {
      status: discoveryMetadata?.serp_status ?? 'unavailable',
      keywordCount: discoveryMetadata?.keyword_count ?? null,
      domainsFound: discoveryMetadata?.serp_domains_found ?? null,
    },
    observedAt: nowIso(),
  };

  // Report 1 assembly — cross-source opportunities, top priorities and the 30/60/90 plan.
  // An ASSEMBLER over already-produced outputs: it recomputes no dimension, no pillar and no
  // score, and `canonicalReportBuilder` remains the canonical owner. Runs last so it can read
  // the finished canonical states and the evidence coverage. Rules abstain when their inputs
  // are missing, so the plan shrinks rather than degrading into generic marketing activity
  // when SERP, PageSpeed or competitive evidence is unavailable.
  canonicalSnapshotShape.digital_snapshot = assembleDigitalSnapshot({
    experienceFindings: digitalExperience?.findings ?? null,
    dimensionStates: {
      // GAP-07 — the Digital Snapshot's search state now comes from the PUBLIC surface (GAP-06),
      // never from `rank_tracking_score`. That radar axis is tagged `['GSC']`: it describes the
      // customer's authenticated Search Console property, which is CONNECTED_SOURCE and outside
      // Report 1's evidence boundary. Deriving a public-domain search reading from it was Rule 1's
      // exact prohibition — a private signal acquiring public-observed standing merely by entering
      // a Report 1 dimension. `failed` and `unavailable` both mean the public check could not
      // establish anything, so both map to `unavailable`.
      searchVisibility: canonicalSnapshotShape.search_visibility?.state === 'measured'
        ? 'measured'
        : canonicalSnapshotShape.search_visibility?.state === 'insufficient_signal'
          ? 'insufficient_signal'
          : 'unavailable',
      aiVisibility: geoAeoExecutiveSummary.overall_ai_visibility_score_state,
      performance: (performanceEvidence?.state ?? 'unavailable') as ScoreState,
      content: wiContent?.contentScore == null ? 'unavailable' : 'measured',
      technical: wiTechnical?.technicalScore == null ? 'unavailable' : 'measured',
      competitive: (competitorIntelligence.detected_competitors ?? []).length === 0
        ? 'unavailable' : 'measured',
    },
    contentSignals: wiContent
      ? { score: wiContent.contentScore, weaknesses: wiContent.contentWeaknesses ?? null }
      : null,
    technicalSignals: wiTechnical
      ? { score: wiTechnical.technicalScore, criticalIssues: wiTechnical.criticalIssues ?? null }
      : null,
    competitive: {
      productCompetition: competitiveTables.productCompetition,
      empty: competitiveTables.empty,
    },
    coverage: canonicalSnapshotShape.evidence_coverage ?? null,
    positioning: {
      hasCategory: Boolean(params.resolvedInput?.resolved.businessType),
      hasOffering: (companyContext.productServices ?? []).length > 0,
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
        crawlEvidence: options?.crawlEvidence ?? null,
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
