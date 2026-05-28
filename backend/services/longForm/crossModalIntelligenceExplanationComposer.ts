/**
 * Phase 9 — Cross-modal intelligence explanation composer.
 *
 * Canonical reasoning source → stable hash. Explains why a candidate
 * transformation is valuable, what authority it compounds, what continuity
 * survives, where cannibalization risk exists, and how formats reinforce
 * each other.
 */

import type {
  AdaptiveTransformationProfile,
  AuthorityCompoundingResult,
  ChainHealthResult,
  CrossModalCannibalizationResult,
  CrossModalContinuityResult,
  CrossModalEditorialMemoryResult,
  CrossModalIntelligenceExplanation,
  CrossModalSafetyResult,
  EcosystemNarrativeResult,
  EffectiveTransformationProfile,
  GovernanceStabilityResult,
  MultiHopContinuityResult,
  SemanticConfidenceResult,
  StrategicSequencingResult,
  TransformationFatigueResult,
  TransformationRecoveryPlan,
  TransformationSuitabilityResult,
} from './longFormRecommendationTypes';

function stableHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h) ^ text.charCodeAt(i);
  return (h >>> 0).toString(16);
}

export interface ComposeCrossModalExplanationInput {
  /** The transformation being explained (may be null when explaining ecosystem-only state). */
  transformation: TransformationSuitabilityResult | null;
  continuity: CrossModalContinuityResult | null;
  cannibalization: CrossModalCannibalizationResult;
  editorialMemory: CrossModalEditorialMemoryResult;
  compounding: AuthorityCompoundingResult;
  recoveryPlan: TransformationRecoveryPlan;
  // ── Phase 12 — hardening (optional) ─────────────────────────────────
  multiHop?: MultiHopContinuityResult;
  fatigue?: TransformationFatigueResult;
  ecosystemNarrative?: EcosystemNarrativeResult;
  sequencing?: StrategicSequencingResult;
  adaptive?: AdaptiveTransformationProfile;
  // ── Phase 13 — operationalization (optional) ────────────────────────
  effective?: EffectiveTransformationProfile;
  chainHealth?: ChainHealthResult;
  semanticConfidence?: SemanticConfidenceResult;
  stabilization?: GovernanceStabilityResult;
  safety?: CrossModalSafetyResult;
}

export function composeCrossModalExplanation(
  input: ComposeCrossModalExplanationInput,
): CrossModalIntelligenceExplanation {
  const canonical = {
    transformation: input.transformation ? {
      from: input.transformation.sourceFormat,
      to: input.transformation.targetFormat,
      type: input.transformation.transformationType,
      suit: input.transformation.transformationSuitabilityScore,
      nar: input.transformation.narrativeRetentionScore,
      auth: input.transformation.authorityRetentionScore,
      aud: input.transformation.audienceFitScore,
      blockingCount: input.transformation.blockingConcerns.length,
    } : null,
    continuity: input.continuity ? {
      score: input.continuity.continuityScore,
      issues: input.continuity.detectedIssues.map((i) => `${i.type}:${i.severity}`),
      preserved: input.continuity.preservedAxes,
    } : null,
    cannib: {
      redundancy: input.cannibalization.ecosystemRedundancyPercent,
      clusterCount: input.cannibalization.clusters.length,
      highSeverityClusters: input.cannibalization.clusters.filter((c) => c.redundancySeverity === 'high').length,
      saturatedPairs: input.cannibalization.saturatedFormatPairs.slice(0, 3).map((p) => `${p.a}+${p.b}:${p.assetCount}`),
    },
    memory: {
      repeatedPaths: input.editorialMemory.repeatedTransformationPaths.length,
      exhausted: input.editorialMemory.exhaustedNarratives.length,
      expansionFatigue: input.editorialMemory.expansionFatigue.length,
      journeys: input.editorialMemory.repetitiveEducationalJourneys.length,
      novelty: input.editorialMemory.crossModalNoveltyScore,
    },
    compounding: {
      ecosystem: input.compounding.ecosystemAuthorityScore,
      narrative: input.compounding.narrativeCompoundingScore,
      synergy: input.compounding.crossFormatSynergyScore,
      topArchetype: input.compounding.archetypeCompounding[0]?.archetype ?? null,
      topPath: input.compounding.funnelProgressionPaths[0]?.orderedFormats.join('->') ?? null,
    },
    recovery: {
      stepCount: input.recoveryPlan.steps.length,
      risk: input.recoveryPlan.overallRiskScore,
      topAction: input.recoveryPlan.steps[0]?.action ?? null,
    },
    // ── Phase 12 hardening canonical state (omitted from object when
    //    absent so existing call sites yield identical hashes) ─────────
    ...(input.multiHop ? { multiHop: {
      len: input.multiHop.chainLength,
      score: input.multiHop.chainContinuityScore,
      cumAuth: input.multiHop.cumulativeAuthorityRetention,
      cumNarr: input.multiHop.cumulativeNarrativeRetention,
      cumIcp: input.multiHop.cumulativeICPAlignment,
      sev: input.multiHop.chainDriftSeverity,
      driftAxes: input.multiHop.driftAxes.map((a) => `${a.axis}:${a.cumulativeLoss}`),
    } } : {}),
    ...(input.fatigue ? { fatigue: {
      score: input.fatigue.transformationFatigueScore,
      patterns: input.fatigue.exhaustedTransformationPatterns.slice(0, 3).map((p) => `${p.patternType}:${p.signature}:${p.occurrences}`),
    } } : {}),
    ...(input.ecosystemNarrative ? { ecosystem: {
      coherence: input.ecosystemNarrative.ecosystemCoherenceScore,
      issues: input.ecosystemNarrative.detectedIssues.map((i) => `${i.type}:${i.severity}`),
      dominant: input.ecosystemNarrative.dominantSignature,
    } } : {}),
    ...(input.sequencing ? { sequencing: {
      confidence: input.sequencing.sequencingConfidence,
      top: input.sequencing.topRecommendation
        ? `${input.sequencing.topRecommendation.fromFormat}->${input.sequencing.topRecommendation.toFormat}:${input.sequencing.topRecommendation.transformationType}`
        : null,
      count: input.sequencing.recommendedTransformationSequence.length,
    } } : {}),
    ...(input.adaptive ? { adaptive: {
      cwm: input.adaptive.compatibilityWeightMultiplier,
      rts: input.adaptive.retentionThresholdShift,
      osd: input.adaptive.oversimplificationSensitivityDelta,
      dad: input.adaptive.decompositionAggressivenessDelta,
      conf: input.adaptive.adaptiveTransformationConfidence,
    } } : {}),
    // ── Phase 13 operationalization canonical state ───────────────────
    ...(input.effective ? { effective: {
      cwm: input.effective.effectiveCompatibilityWeightMultiplier,
      rts: input.effective.effectiveRetentionThresholdShift,
      osd: input.effective.effectiveOversimplificationSensitivityDelta,
      dad: input.effective.effectiveDecompositionAggressivenessDelta,
      mode: input.effective.applicationMode,
      stab: input.effective.adaptationStabilityScore,
    } } : {}),
    ...(input.chainHealth ? { chainHealth: {
      score: input.chainHealth.chainHealthScore,
      band: input.chainHealth.chainStabilityBand,
      risk: input.chainHealth.branchRecoveryRisk,
      vol: input.chainHealth.volatilityScore,
      loop: input.chainHealth.recoveryLoopDetected,
      irrev: input.chainHealth.irreversibleAuthorityCollapseDetected,
    } } : {}),
    ...(input.semanticConfidence ? { semanticConf: {
      score: input.semanticConfidence.semanticConfidenceScore,
      ctx: input.semanticConfidence.contextualEquivalenceScore,
      tcw: input.semanticConfidence.terminologyConfidenceWeight,
      warnings: input.semanticConfidence.equivalenceAmbiguityWarnings.length,
      domains: input.semanticConfidence.domainsTouched,
    } } : {}),
    ...(input.stabilization ? { stabilization: {
      score: input.stabilization.governanceStabilityScore,
      warnings: input.stabilization.stabilizationWarnings.map((w) => `${w.source}:${w.type}:${w.severity}`),
      cooldown: input.stabilization.cooldownActive,
    } } : {}),
    ...(input.safety ? { safety: {
      safe: input.safety.safe,
      detections: input.safety.recursiveTransformationDetections.map((d) => `${d.type}:${d.severity}`),
      depthLimit: input.safety.lineageDepthLimit,
      branchLimit: input.safety.derivativeBranchLimit,
      maxDepth: input.safety.observedMaxDepth,
    } } : {}),
  };

  // 1. Why transformation is valuable
  const whyTransformationIsValuable = !canonical.transformation
    ? `No specific transformation supplied — explanation is ecosystem-only (cross-modal novelty ${canonical.memory.novelty}/100, ecosystem authority ${canonical.compounding.ecosystem}/100).`
    : canonical.transformation.suit >= 75
      ? `Transformation ${canonical.transformation.from} → ${canonical.transformation.to} via ${canonical.transformation.type} scores ${canonical.transformation.suit}/100 (narrative ${canonical.transformation.nar}, authority ${canonical.transformation.auth}, audience ${canonical.transformation.aud}) — strong fit for the target format.`
      : canonical.transformation.suit >= 55
        ? `Transformation ${canonical.transformation.from} → ${canonical.transformation.to} is workable (${canonical.transformation.suit}/100) but ${canonical.transformation.blockingCount} blocking concern(s) require attention.`
        : `Transformation ${canonical.transformation.from} → ${canonical.transformation.to} is weak (${canonical.transformation.suit}/100). ${canonical.transformation.blockingCount} blocking concern(s) — consider an alternate target.`;

  // 2. What authority it compounds
  const whatAuthorityItCompounds = canonical.compounding.topArchetype
    ? `Ecosystem authority score ${canonical.compounding.ecosystem}/100; narrative compounding ${canonical.compounding.narrative}/100 (top archetype: ${canonical.compounding.topArchetype})${canonical.compounding.topPath ? `; strongest funnel progression: ${canonical.compounding.topPath}` : ''}.`
    : `Ecosystem authority ${canonical.compounding.ecosystem}/100 — no dominant archetype yet, so each new transformation is establishing first authority signal in its theme.`;

  // 3. What continuity survives
  const whatContinuitySurvives = !canonical.continuity
    ? 'No specific continuity check supplied (no derived asset to compare).'
    : canonical.continuity.score >= 80
      ? `Continuity score ${canonical.continuity.score}/100. Preserved axes: ${canonical.continuity.preserved.length > 0 ? canonical.continuity.preserved.join(', ') : '(no specific axes flagged as fully preserved)'}.`
      : canonical.continuity.score >= 50
        ? `Continuity score ${canonical.continuity.score}/100 — partial preservation. ${canonical.continuity.issues.length} issue(s): ${canonical.continuity.issues.slice(0, 3).join('; ')}.`
        : `Continuity score ${canonical.continuity.score}/100 — significant degradation. ${canonical.continuity.issues.length} issue(s): ${canonical.continuity.issues.slice(0, 5).join('; ')}.`;

  // 4. Where cannibalization risk exists
  const whereCannibalizationRiskExists = canonical.cannib.redundancy === 0
    ? 'No cross-modal cannibalization clusters detected — every format is carrying distinct narrative weight.'
    : `Ecosystem redundancy at ${canonical.cannib.redundancy}% across ${canonical.cannib.clusterCount} cluster(s)${canonical.cannib.highSeverityClusters > 0 ? ` (${canonical.cannib.highSeverityClusters} high-severity)` : ''}${canonical.cannib.saturatedPairs.length > 0 ? `. Saturated format pairs: ${canonical.cannib.saturatedPairs.join('; ')}` : ''}.`;

  // 5. How formats reinforce each other
  const reinforcementFragments: string[] = [];
  reinforcementFragments.push(`cross-format synergy ${canonical.compounding.synergy}/100`);
  if (canonical.compounding.topPath) reinforcementFragments.push(`top funnel progression ${canonical.compounding.topPath}`);
  if (canonical.memory.repeatedPaths > 0) reinforcementFragments.push(`${canonical.memory.repeatedPaths} repeated transformation path(s) — diminishing reinforcement returns`);
  if (canonical.memory.exhausted > 0) reinforcementFragments.push(`${canonical.memory.exhausted} archetype(s) saturated across formats`);
  if (canonical.recovery.stepCount > 0) reinforcementFragments.push(`recovery plan has ${canonical.recovery.stepCount} step(s) (top action: ${canonical.recovery.topAction})`);
  reinforcementFragments.push(`cross-modal novelty ${canonical.memory.novelty}/100`);
  const howFormatsReinforceEachOther = `Formats reinforce each other when shared archetypes appear across ≥3 formats — current state: ${reinforcementFragments.join('; ')}.`;

  // ── Phase 12 hardening rationale sections (only when inputs provided) ─
  let chainContinuityRationale: string | undefined;
  if (input.multiHop) {
    chainContinuityRationale = input.multiHop.chainLength <= 1
      ? `Chain has only ${input.multiHop.chainLength} hop(s) — multi-hop governance is a no-op.`
      : input.multiHop.chainDriftSeverity === 'low'
        ? `Chain ${input.multiHop.chainId} (length ${input.multiHop.chainLength}) is healthy — continuity ${input.multiHop.chainContinuityScore}/100, cumulative authority ${input.multiHop.cumulativeAuthorityRetention}/100, narrative ${input.multiHop.cumulativeNarrativeRetention}/100.`
        : `Chain ${input.multiHop.chainId} (length ${input.multiHop.chainLength}) shows ${input.multiHop.chainDriftSeverity} drift — continuity ${input.multiHop.chainContinuityScore}/100. Degraded axes: ${input.multiHop.driftAxes.map((a) => `${a.axis} (${a.cumulativeLoss}% loss)`).join(', ') || '(none)'}.`;
  }

  let ecosystemAuthorityRationale: string | undefined;
  if (input.ecosystemNarrative) {
    ecosystemAuthorityRationale = input.ecosystemNarrative.detectedIssues.length === 0
      ? `Ecosystem narrative is coherent (${input.ecosystemNarrative.ecosystemCoherenceScore}/100), dominated by class "${input.ecosystemNarrative.dominantSignature ?? '(none)'}".`
      : `Ecosystem narrative coherence ${input.ecosystemNarrative.ecosystemCoherenceScore}/100 with ${input.ecosystemNarrative.detectedIssues.length} issue(s): ${input.ecosystemNarrative.detectedIssues.slice(0, 3).map((i) => `${i.type} (${i.severity})`).join('; ')}.`;
  }

  let fatigueRationale: string | undefined;
  if (input.fatigue) {
    const top = input.fatigue.exhaustedTransformationPatterns[0];
    fatigueRationale = input.fatigue.transformationFatigueScore < 25
      ? `Transformation fatigue low (${input.fatigue.transformationFatigueScore}/100) — no fatigue patterns require action.`
      : `Transformation fatigue ${input.fatigue.transformationFatigueScore}/100 across ${input.fatigue.exhaustedTransformationPatterns.length} pattern(s)${top ? ` (top: ${top.patternType} "${top.signature}" ×${top.occurrences})` : ''}.`;
  }

  let sequencingRationale: string | undefined;
  if (input.sequencing) {
    sequencingRationale = input.sequencing.topRecommendation
      ? `Sequencer (confidence ${input.sequencing.sequencingConfidence}/100) recommends ${input.sequencing.topRecommendation.fromFormat} → ${input.sequencing.topRecommendation.toFormat} via ${input.sequencing.topRecommendation.transformationType} (forecast ${input.sequencing.topRecommendation.ecosystemContributionForecast}/100). ${input.sequencing.recommendedTransformationSequence.length - 1} additional option(s) ranked.`
      : `Sequencer found no recommendable transformation (confidence ${input.sequencing.sequencingConfidence}/100).`;
  }

  let adaptiveScoringRationale: string | undefined;
  if (input.adaptive) {
    const notesPreview = input.adaptive.rationaleNotes.slice(0, 3).join(' | ');
    adaptiveScoringRationale = input.adaptive.rationaleNotes.length === 0
      ? `Adaptive transformation scoring at baseline — no feedback signals strong enough to shift weights (confidence ${input.adaptive.adaptiveTransformationConfidence}/100).`
      : `Adaptive transformation scoring shifted weights — compat ×${input.adaptive.compatibilityWeightMultiplier.toFixed(2)}, retention shift ${input.adaptive.retentionThresholdShift >= 0 ? '+' : ''}${input.adaptive.retentionThresholdShift}, oversimplification Δ${input.adaptive.oversimplificationSensitivityDelta >= 0 ? '+' : ''}${input.adaptive.oversimplificationSensitivityDelta}, decomposition Δ${input.adaptive.decompositionAggressivenessDelta >= 0 ? '+' : ''}${input.adaptive.decompositionAggressivenessDelta} (confidence ${input.adaptive.adaptiveTransformationConfidence}/100). ${notesPreview}`;
  }

  // ── Phase 13 — operationalization rationale sections (only when inputs provided) ─
  let adaptationRationale: string | undefined;
  if (input.effective) {
    adaptationRationale = input.effective.applicationMode === 'idle'
      ? `Adaptive layer idle — source confidence ${input.effective.sourceAdaptiveConfidence}/100 below floor; effective knobs zeroed.`
      : `Adaptive layer in "${input.effective.applicationMode}" mode (stability ${input.effective.adaptationStabilityScore}/100, window ${input.effective.smoothingWindow}); effective cwm=${input.effective.effectiveCompatibilityWeightMultiplier}, rts=${input.effective.effectiveRetentionThresholdShift}, osd=${input.effective.effectiveOversimplificationSensitivityDelta}, dad=${input.effective.effectiveDecompositionAggressivenessDelta}.`;
  }

  let chainHealthRationale: string | undefined;
  if (input.chainHealth) {
    const flags: string[] = [];
    if (input.chainHealth.recoveryLoopDetected) flags.push('recovery-loop');
    if (input.chainHealth.irreversibleAuthorityCollapseDetected) flags.push('irreversible-authority-collapse');
    chainHealthRationale = `Chain ${input.chainHealth.chainId} health ${input.chainHealth.chainHealthScore}/100 (${input.chainHealth.chainStabilityBand}); branch recovery risk ${input.chainHealth.branchRecoveryRisk}/100; volatility ${input.chainHealth.volatilityScore}/100; cumulative fatigue ${input.chainHealth.cumulativeFatigueScore}/100${flags.length > 0 ? `. Flags: ${flags.join(', ')}` : '.'}.`;
  }

  let semanticConfidenceRationale: string | undefined;
  if (input.semanticConfidence) {
    semanticConfidenceRationale = input.semanticConfidence.equivalenceAmbiguityWarnings.length === 0
      ? `Semantic confidence ${input.semanticConfidence.semanticConfidenceScore}/100 (contextual ${input.semanticConfidence.contextualEquivalenceScore}/100, terminology weight ${input.semanticConfidence.terminologyConfidenceWeight}) — no ambiguity warnings.`
      : `Semantic confidence ${input.semanticConfidence.semanticConfidenceScore}/100 with ${input.semanticConfidence.equivalenceAmbiguityWarnings.length} ambiguity warning(s)${input.semanticConfidence.domainsTouched.length > 0 ? ` across domains [${input.semanticConfidence.domainsTouched.join(', ')}]` : ''}; contextual equivalence ${input.semanticConfidence.contextualEquivalenceScore}/100.`;
  }

  let stabilizationRationale: string | undefined;
  if (input.stabilization) {
    const w = input.stabilization.stabilizationWarnings;
    stabilizationRationale = w.length === 0
      ? `Governance stability ${input.stabilization.governanceStabilityScore}/100 — no stabilizer warnings; cooldowns ${input.stabilization.cooldownActive ? `active (${Math.round(input.stabilization.cooldownRemainingMs / 1000)}s remaining)` : 'inactive'}.`
      : `Governance stability ${input.stabilization.governanceStabilityScore}/100 with ${w.length} warning(s) (top: ${w.slice(0, 3).map((x) => `${x.source}:${x.type} (${x.severity})`).join('; ')})${input.stabilization.cooldownActive ? `; cooldown active ${Math.round(input.stabilization.cooldownRemainingMs / 1000)}s` : ''}.`;
  }

  let lineageSafetyRationale: string | undefined;
  if (input.safety) {
    lineageSafetyRationale = input.safety.safe && input.safety.recursiveTransformationDetections.length === 0
      ? `Lineage safety OK — observed max depth ${input.safety.observedMaxDepth}/${input.safety.lineageDepthLimit}, max branching ${input.safety.observedMaxBranching}/${input.safety.derivativeBranchLimit}.`
      : `Lineage safety violations: ${input.safety.recursiveTransformationDetections.length} detection(s) (${input.safety.recursiveTransformationDetections.slice(0, 3).map((d) => `${d.type} (${d.severity})`).join('; ')}); observed max depth ${input.safety.observedMaxDepth}/${input.safety.lineageDepthLimit}.`;
  }

  return {
    whyTransformationIsValuable,
    whatAuthorityItCompounds,
    whatContinuitySurvives,
    whereCannibalizationRiskExists,
    howFormatsReinforceEachOther,
    reasoningSourceHash: `cmi_${stableHash(JSON.stringify(canonical))}`,
    ...(chainContinuityRationale !== undefined ? { chainContinuityRationale } : {}),
    ...(ecosystemAuthorityRationale !== undefined ? { ecosystemAuthorityRationale } : {}),
    ...(fatigueRationale !== undefined ? { fatigueRationale } : {}),
    ...(sequencingRationale !== undefined ? { sequencingRationale } : {}),
    ...(adaptiveScoringRationale !== undefined ? { adaptiveScoringRationale } : {}),
    ...(adaptationRationale !== undefined ? { adaptationRationale } : {}),
    ...(chainHealthRationale !== undefined ? { chainHealthRationale } : {}),
    ...(semanticConfidenceRationale !== undefined ? { semanticConfidenceRationale } : {}),
    ...(stabilizationRationale !== undefined ? { stabilizationRationale } : {}),
    ...(lineageSafetyRationale !== undefined ? { lineageSafetyRationale } : {}),
  };
}
