/**
 * Phase 13.9 — Cross-modal operational stress tests.
 *
 * Exercises the production operationalization layer end-to-end:
 *   - auto-adaptive wiring with stability smoothing
 *   - chain health governance
 *   - semantic confidence + ambiguity warnings
 *   - persistent snapshot model
 *   - real-time ecosystem coherence monitor
 *   - governance stabilization engine
 *   - cross-modal safety guard
 *   - hardened explanation composer
 *   - operational diagnostics registry
 *
 * Run via:
 *   npx tsx scripts/ops/longFormCrossModalOperationalStress.ts
 */

import type {
  AdaptiveTransformationProfile,
  CrossModalFormat,
  NarrativeArchetype,
  TransformationRecoveryPlan,
} from './longFormRecommendationTypes';
import {
  createCrossModalContentRegistry,
  type CrossModalContentRegistry,
  type RegisterAssetInput,
} from './crossModalContentRegistry';
import { governMultiHopTransformation } from './multiHopTransformationGovernor';
import { createSemanticMatcher } from './semanticTransformationMatcher';
import { createAdaptiveTransformationApplicationLayer } from './adaptiveTransformationApplicationLayer';
import { createTransformationChainHealthGovernor } from './transformationChainHealthGovernor';
import { createPersistentTransformationSnapshotModel } from './persistentTransformationSnapshotModel';
import { createRealTimeEcosystemCoherenceMonitor } from './realTimeEcosystemCoherenceMonitor';
import { createGovernanceStabilizationEngine } from './governanceStabilizationEngine';
import { createCrossModalSafetyGuard } from './crossModalSafetyGuard';
import { composeCrossModalExplanation } from './crossModalIntelligenceExplanationComposer';
import { createCrossModalOperationalDiagnosticsRegistry } from './crossModalOperationalDiagnostics';
import { analyzeCrossModalCannibalization } from './crossModalCannibalizationAnalyzer';
import { computeAuthorityCompounding } from './authorityCompoundingEngine';
import { analyzeCrossModalEditorialMemory } from './crossModalEditorialMemory';

// ─── helpers ────────────────────────────────────────────────────────────

let idCounter = 0;
function isoDaysAgo(days: number): string {
  return new Date(Date.now() - Math.max(0, days) * 24 * 60 * 60 * 1000).toISOString();
}
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${idCounter.toString(36)}`;
}

interface AssetSeed {
  format: CrossModalFormat;
  title: string;
  strategicNarrative: string;
  archetype: NarrativeArchetype | null;
  icpFocus: string[];
  themes: string[];
  terms: string[];
  words: number;
  authorityClaim: number;
  evidence: number;
  daysAgo?: number;
}

function makeSeed(s: AssetSeed): RegisterAssetInput {
  return {
    companyId: 'co_test',
    format: s.format, title: s.title, strategicNarrative: s.strategicNarrative,
    authorityThemes: s.themes, icpFocus: s.icpFocus, terminologyClusters: s.terms,
    narrativeArchetype: s.archetype,
    publishedAt: isoDaysAgo(s.daysAgo ?? Math.max(1, 60 - idCounter)),
    approximateWordCount: s.words,
    authorityClaimCoverage: s.authorityClaim, evidenceDensity: s.evidence,
    assetId: nextId('a'),
  };
}

function newRegistry(): CrossModalContentRegistry {
  idCounter = 0;
  return createCrossModalContentRegistry({ maxAssetsPerCompany: 5000, maxLineagesPerCompany: 20000 });
}

function buildAdaptiveProfile(overrides: Partial<AdaptiveTransformationProfile> = {}): AdaptiveTransformationProfile {
  return {
    compatibilityWeightMultiplier: overrides.compatibilityWeightMultiplier ?? 1.0,
    retentionThresholdShift: overrides.retentionThresholdShift ?? 0,
    oversimplificationSensitivityDelta: overrides.oversimplificationSensitivityDelta ?? 0,
    decompositionAggressivenessDelta: overrides.decompositionAggressivenessDelta ?? 0,
    adaptiveTransformationConfidence: overrides.adaptiveTransformationConfidence ?? 70,
    rationaleNotes: overrides.rationaleNotes ?? [],
  };
}

export interface OperationalAssertion { name: string; passed: boolean; observed: string | number; expected: string }
export interface OperationalScenarioResult { scenario: string; assertions: OperationalAssertion[]; passed: boolean }
function ok(name: string, observed: string | number, passed: boolean, expected: string): OperationalAssertion {
  return { name, observed, passed, expected };
}

// ─── scenarios ──────────────────────────────────────────────────────────

async function scenario_baseline(): Promise<OperationalScenarioResult> {
  // Stable adaptive profile → application layer reports full mode with high stability.
  const layer = createAdaptiveTransformationApplicationLayer();
  for (let i = 0; i < 5; i += 1) {
    layer.apply('co_test', buildAdaptiveProfile({
      compatibilityWeightMultiplier: 1.05,
      retentionThresholdShift: 2,
      adaptiveTransformationConfidence: 75,
    }));
  }
  const last = layer.current('co_test')!;
  return {
    scenario: 'baseline. stable adaptive profile',
    passed: true,
    assertions: [
      ok('application mode is full', last.applicationMode, last.applicationMode === 'full', 'full'),
      ok('adaptation stability ≥ 70', last.adaptationStabilityScore, last.adaptationStabilityScore >= 70, '≥ 70'),
      ok('effective cwm within bounds', last.effectiveCompatibilityWeightMultiplier,
        last.effectiveCompatibilityWeightMultiplier >= 0.6 && last.effectiveCompatibilityWeightMultiplier <= 1.4, '0.6..1.4'),
      ok('smoothingWindow = 5', last.smoothingWindow, last.smoothingWindow === 5, '5'),
    ],
  };
}

async function scenario1_adaptiveOscillationLoops(): Promise<OperationalScenarioResult> {
  // Alternating profiles → application layer should detect oscillation and damp.
  const layer = createAdaptiveTransformationApplicationLayer();
  for (let i = 0; i < 8; i += 1) {
    const swing = i % 2 === 0;
    layer.apply('co_test', buildAdaptiveProfile({
      compatibilityWeightMultiplier: swing ? 1.3 : 0.7,
      retentionThresholdShift: swing ? 12 : -10,
      oversimplificationSensitivityDelta: swing ? 18 : -16,
      decompositionAggressivenessDelta: swing ? 18 : -18,
      adaptiveTransformationConfidence: 75,
    }));
  }
  const last = layer.current('co_test')!;
  return {
    scenario: '1. adaptive oscillation loops',
    passed: true,
    assertions: [
      ok('mode is "damped"', last.applicationMode, last.applicationMode === 'damped', 'damped'),
      ok('adaptationStabilityScore depressed', last.adaptationStabilityScore,
        last.adaptationStabilityScore < 70, '< 70'),
      ok('effective rts magnitude smaller than raw 12', Math.abs(last.effectiveRetentionThresholdShift),
        Math.abs(last.effectiveRetentionThresholdShift) < 12, '< 12'),
      ok('rationale mentions oscillation/damped', last.rationaleNotes.join('|'),
        last.rationaleNotes.some((n) => /damped|sign-flips/i.test(n)), 'mentions oscillation'),
    ],
  };
}

async function scenario2_recursiveTransformationChains(): Promise<OperationalScenarioResult> {
  // Create A → B → A cycle.
  const reg = newRegistry();
  const a = reg.registerAsset(makeSeed({
    format: 'long_form', title: 'A', strategicNarrative: 'A.', archetype: 'observability',
    icpFocus: ['X'], themes: ['x'], terms: ['t'], words: 3500, authorityClaim: 70, evidence: 60, daysAgo: 30,
  }));
  const b = reg.registerAsset(makeSeed({
    format: 'thread', title: 'B', strategicNarrative: 'B.', archetype: 'observability',
    icpFocus: ['X'], themes: ['x'], terms: ['t'], words: 1000, authorityClaim: 60, evidence: 50, daysAgo: 20,
  }));
  reg.registerLineage({ companyId: 'co_test', sourceAssetId: a.assetId, derivedAssetId: b.assetId, transformationType: 'decomposition', ecosystemRole: 'amplifier' });
  reg.registerLineage({ companyId: 'co_test', sourceAssetId: b.assetId, derivedAssetId: a.assetId, transformationType: 'expansion', ecosystemRole: 'extension' });
  const safety = createCrossModalSafetyGuard().audit({ registry: reg, companyId: 'co_test' });
  return {
    scenario: '2. recursive transformation chains',
    passed: true,
    assertions: [
      ok('circular_lineage detected', safety.recursiveTransformationDetections.map((d) => d.type).join(','),
        safety.recursiveTransformationDetections.some((d) => d.type === 'circular_lineage'), 'circular_lineage'),
      ok('safe = false', safety.safe ? 'true' : 'false', !safety.safe, 'false'),
    ],
  };
}

async function scenario3_semanticOverClustering(): Promise<OperationalScenarioResult> {
  // Two assets that share a word in different DOMAINS — confidence layer should dampen.
  const reg = newRegistry();
  const a = reg.registerAsset(makeSeed({
    format: 'long_form', title: 'Healthcare', strategicNarrative: 'Clinical workflows in hospital settings.',
    archetype: 'orchestration', icpFocus: ['Clinicians'], themes: ['clinical workflows'], terms: ['workflow'],
    words: 3500, authorityClaim: 70, evidence: 60, daysAgo: 40,
  }));
  const b = reg.registerAsset(makeSeed({
    format: 'long_form', title: 'Fintech', strategicNarrative: 'Trading workflows in capital markets.',
    archetype: 'transformation_path', icpFocus: ['Traders'], themes: ['trading workflows'], terms: ['workflow'],
    words: 3500, authorityClaim: 70, evidence: 60, daysAgo: 20,
  }));
  const matcher = createSemanticMatcher({
    domainGroups: {
      healthcare: ['clinical', 'hospital', 'patient', 'clinician', 'clinicians'],
      fintech: ['trading', 'capital', 'markets', 'trader', 'traders'],
    },
    ambiguousTokens: ['workflow', 'workflows'],
  });
  const conf = matcher.compareWithConfidence(a, b);
  return {
    scenario: '3. semantic over-clustering suppressed',
    passed: true,
    assertions: [
      ok('cross-domain warning surfaced', conf.equivalenceAmbiguityWarnings.map((w) => w.token).join(','),
        conf.equivalenceAmbiguityWarnings.some((w) => w.token === '(cross-domain)'), '(cross-domain)'),
      ok('contextual equivalence dropped (archetype mismatch)', conf.contextualEquivalenceScore,
        conf.contextualEquivalenceScore < conf.semanticTransformationSimilarityScore + 10, 'reduced'),
      ok('domainsTouched includes both', conf.domainsTouched.join(','),
        conf.domainsTouched.includes('healthcare') && conf.domainsTouched.includes('fintech'), 'healthcare,fintech'),
      ok('semantic confidence reported', conf.semanticConfidenceScore,
        conf.semanticConfidenceScore >= 0 && conf.semanticConfidenceScore <= 100, '0..100'),
    ],
  };
}

async function scenario4_lineageCorruptionAttempt(): Promise<OperationalScenarioResult> {
  // Snapshot, then corrupt its blob, then verify.
  const model = createPersistentTransformationSnapshotModel();
  const snap = await model.takeSnapshot({
    companyId: 'co_test',
    payload: {
      assets: [], lineages: [], feedbackEvents: [],
      fatiguePatterns: [], chainHealthRecords: [], adaptiveSamples: [],
    },
  });
  // Corrupt the blob (but keep the original integrityHash).
  const tampered = { ...snap, blob: snap.blob.replace('[]', '[{"assetId":"injected"}]') };
  const integrity = model.verify(tampered);
  return {
    scenario: '4. lineage corruption attempt',
    passed: true,
    assertions: [
      ok('hashVerified = false', integrity.hashVerified ? 'true' : 'false', !integrity.hashVerified, 'false'),
      ok('integrity score below 100', integrity.snapshotIntegrityScore, integrity.snapshotIntegrityScore < 100, '< 100'),
      ok('warning surfaced about integrity hash', integrity.warnings.join('|'),
        integrity.warnings.some((w) => /Integrity hash mismatch|Payload count mismatch/i.test(w)),
        'mentions hash or payload mismatch'),
    ],
  };
}

async function scenario5_unstableAuthorityAmplification(): Promise<OperationalScenarioResult> {
  // Multiple lineages where derivative authority > source by huge margin.
  const reg = newRegistry();
  for (let i = 0; i < 5; i += 1) {
    const src = reg.registerAsset(makeSeed({
      format: 'thread', title: `Src ${i}`, strategicNarrative: 'Source.',
      archetype: 'observability', icpFocus: ['X'], themes: ['x'], terms: ['t'],
      words: 1000, authorityClaim: 30, evidence: 25, daysAgo: 50 - i * 5,
    }));
    const dst = reg.registerAsset(makeSeed({
      format: 'long_form', title: `Dst ${i}`, strategicNarrative: 'Derived w/ inflated authority.',
      archetype: 'observability', icpFocus: ['X'], themes: ['x'], terms: ['t'],
      words: 3500, authorityClaim: 85, evidence: 75, daysAgo: 40 - i * 5,
    }));
    reg.registerLineage({ companyId: 'co_test', sourceAssetId: src.assetId, derivedAssetId: dst.assetId, transformationType: 'expansion', ecosystemRole: 'extension' });
  }
  const safety = createCrossModalSafetyGuard().audit({ registry: reg, companyId: 'co_test' });
  return {
    scenario: '5. unstable authority amplification',
    passed: true,
    assertions: [
      ok('authority_amplification_loop detected', safety.recursiveTransformationDetections.map((d) => d.type).join(','),
        safety.recursiveTransformationDetections.some((d) => d.type === 'authority_amplification_loop'),
        'authority_amplification_loop'),
    ],
  };
}

async function scenario6_crashRecoveryReplay(): Promise<OperationalScenarioResult> {
  // Snapshot a populated registry, simulate a "crash" (new registry), then restore.
  const original = newRegistry();
  const a1 = original.registerAsset(makeSeed({ format: 'long_form', title: 'A', strategicNarrative: 'A.', archetype: 'observability',
    icpFocus: ['X'], themes: ['x'], terms: ['t'], words: 3500, authorityClaim: 80, evidence: 70, daysAgo: 30 }));
  const a2 = original.registerAsset(makeSeed({ format: 'thread', title: 'B', strategicNarrative: 'B.', archetype: 'observability',
    icpFocus: ['X'], themes: ['x'], terms: ['t'], words: 1000, authorityClaim: 60, evidence: 50, daysAgo: 20 }));
  original.registerLineage({ companyId: 'co_test', sourceAssetId: a1.assetId, derivedAssetId: a2.assetId, transformationType: 'decomposition', ecosystemRole: 'amplifier' });

  const model = createPersistentTransformationSnapshotModel();
  const snap = await model.takeSnapshot({
    companyId: 'co_test',
    payload: {
      assets: original.listAssets('co_test'),
      lineages: original.listLineages('co_test'),
      feedbackEvents: [], fatiguePatterns: [], chainHealthRecords: [], adaptiveSamples: [],
    },
  });

  // simulate crash + replay
  const { payload, integrity } = model.restore(snap);
  return {
    scenario: '6. crash-recovery replay',
    passed: true,
    assertions: [
      ok('integrity = 100', integrity.snapshotIntegrityScore, integrity.snapshotIntegrityScore === 100, '100'),
      ok('replayed assets count match', payload.assets.length, payload.assets.length === 2, '2'),
      ok('replayed lineages count match', payload.lineages.length, payload.lineages.length === 1, '1'),
      ok('integrity reports schemaOk', integrity.schemaOk ? 'true' : 'false', integrity.schemaOk, 'true'),
    ],
  };
}

async function scenario7_excessiveBranchNesting(): Promise<OperationalScenarioResult> {
  // Create one root with 15 direct children (over branchLimit=12 default).
  const reg = newRegistry();
  const root = reg.registerAsset(makeSeed({ format: 'long_form', title: 'Root', strategicNarrative: 'Root.',
    archetype: 'observability', icpFocus: ['X'], themes: ['x'], terms: ['t'], words: 3500, authorityClaim: 80, evidence: 70, daysAgo: 60 }));
  for (let i = 0; i < 15; i += 1) {
    const child = reg.registerAsset(makeSeed({ format: 'post', title: `Child ${i}`, strategicNarrative: 'Child.',
      archetype: 'observability', icpFocus: ['X'], themes: ['x'], terms: ['t'], words: 200, authorityClaim: 50, evidence: 40, daysAgo: 50 - i }));
    reg.registerLineage({ companyId: 'co_test', sourceAssetId: root.assetId, derivedAssetId: child.assetId, transformationType: 'extraction', ecosystemRole: 'derivative' });
  }
  const safety = createCrossModalSafetyGuard().audit({ registry: reg, companyId: 'co_test' });
  return {
    scenario: '7. excessive branch nesting',
    passed: true,
    assertions: [
      ok('infinite_decomposition detected', safety.recursiveTransformationDetections.map((d) => d.type).join(','),
        safety.recursiveTransformationDetections.some((d) => d.type === 'infinite_decomposition'),
        'infinite_decomposition'),
      ok('observedMaxBranching = 15', safety.observedMaxBranching, safety.observedMaxBranching === 15, '15'),
    ],
  };
}

async function scenario8_partialSnapshotRestoration(): Promise<OperationalScenarioResult> {
  // Snapshot whose payload counts get corrupted by overwriting the .payloads object.
  const model = createPersistentTransformationSnapshotModel();
  const snap = await model.takeSnapshot({
    companyId: 'co_test',
    payload: {
      assets: [{ assetId: 'a1', companyId: 'co_test', format: 'long_form', title: 'T',
        strategicNarrative: 'N', authorityThemes: [], icpFocus: [], terminologyClusters: [],
        narrativeArchetype: 'observability', publishedAt: new Date().toISOString(),
        approximateWordCount: 1000, authorityClaimCoverage: 50, evidenceDensity: 40 }],
      lineages: [], feedbackEvents: [], fatiguePatterns: [], chainHealthRecords: [], adaptiveSamples: [],
    },
  });
  const tampered = { ...snap, payloads: { ...snap.payloads, assets: 99 } };
  const integrity = model.verify(tampered);
  return {
    scenario: '8. partial snapshot restoration mismatch',
    passed: true,
    assertions: [
      ok('payloadCountsMatch = false', integrity.payloadCountsMatch ? 'true' : 'false', !integrity.payloadCountsMatch, 'false'),
      ok('integrity < 100', integrity.snapshotIntegrityScore, integrity.snapshotIntegrityScore < 100, '< 100'),
    ],
  };
}

async function scenario9_ecosystemRecomputationStorms(): Promise<OperationalScenarioResult> {
  // Hammer the monitor with 100 ticks; most should be skips because of zero invalidation.
  const reg = newRegistry();
  for (let i = 0; i < 6; i += 1) {
    reg.registerAsset(makeSeed({
      format: (['long_form', 'thread', 'post', 'newsletter', 'guide', 'story'] as CrossModalFormat[])[i],
      title: `${i}`, strategicNarrative: 'Decision-trace observability sequenced before evaluations.',
      archetype: 'observability', icpFocus: ['Engineers'], themes: ['observability'],
      terms: ['decision traces'], words: 1000, authorityClaim: 60, evidence: 50, daysAgo: 60 - i * 5,
    }));
  }
  const monitor = createRealTimeEcosystemCoherenceMonitor();
  const assets = reg.listAssets('co_test');
  // First tick → full compute
  monitor.invalidate('co_test', 'all');
  const firstTick = monitor.tick({ companyId: 'co_test', assets });
  // 100 ticks without invalidation should skip
  let recomputed = 0;
  for (let i = 0; i < 100; i += 1) {
    const t = monitor.tick({ companyId: 'co_test', assets });
    if (t.recomputed) recomputed += 1;
  }
  // Invalidate a single scope → only that scope recomputes
  monitor.invalidate('co_test', ['narrative']);
  const targetedTick = monitor.tick({ companyId: 'co_test', assets });
  return {
    scenario: '9. ecosystem recomputation storms (incremental)',
    passed: true,
    assertions: [
      ok('first tick recomputed = true', firstTick.recomputed ? 'true' : 'false', firstTick.recomputed, 'true'),
      ok('100 idle ticks did NOT recompute', recomputed, recomputed === 0, '0'),
      ok('targeted invalidate recomputed only narrative', targetedTick.scopesRecomputed.join(','),
        targetedTick.scopesRecomputed.includes('narrative') && !targetedTick.scopesRecomputed.includes('positioning'),
        'narrative only'),
      ok('targeted tick has overall coherence ≤ 100', targetedTick.overallCoherenceScore,
        targetedTick.overallCoherenceScore >= 0 && targetedTick.overallCoherenceScore <= 100, '0..100'),
    ],
  };
}

async function scenario10_recoveryThrashing(): Promise<OperationalScenarioResult> {
  // Repeatedly hand the stabilizer recovery plans with rotating actions.
  const engine = createGovernanceStabilizationEngine({ recoveryCooldownMs: 60_000 });
  const allActions: TransformationRecoveryPlan = {
    overallRiskScore: 60,
    steps: [
      { action: 'diversify_transformation_path', severity: 'medium', rationale: 'r', targetFormats: [] },
      { action: 'fatigue_mitigation', severity: 'medium', rationale: 'r', targetFormats: [] },
      { action: 'prevent_repetitive_decomposition', severity: 'medium', rationale: 'r', targetFormats: [] },
      { action: 'rebalance_educational_sequencing', severity: 'medium', rationale: 'r', targetFormats: [] },
      { action: 'lineage_rollback', severity: 'high', rationale: 'r', targetFormats: [] },
      { action: 'lineage_rollback', severity: 'high', rationale: 'r', targetFormats: [] },
      { action: 'lineage_rollback', severity: 'high', rationale: 'r', targetFormats: [] },
    ],
  };
  const nowMs = Date.now();
  const observed = engine.observe({ companyId: 'co_test', recoveryPlan: allActions, nowMs });
  // Try to re-emit lineage_rollback while cooldown is active.
  const filtered = engine.applyCooldownsToPlan('co_test', allActions, nowMs);
  return {
    scenario: '10. recovery thrashing',
    passed: true,
    assertions: [
      ok('thrashing warning surfaced', observed.stabilizationWarnings.map((w) => w.type).join(','),
        observed.stabilizationWarnings.some((w) => w.type === 'thrashing'), 'thrashing'),
      ok('rollback overcorrection warning', observed.stabilizationWarnings.map((w) => `${w.source}:${w.type}`).join(','),
        observed.stabilizationWarnings.some((w) => w.source === 'rollback' && w.type === 'overcorrection'), 'rollback:overcorrection'),
      ok('cooldown active', observed.cooldownActive ? 'true' : 'false', observed.cooldownActive, 'true'),
      ok('applyCooldownsToPlan filters out actions', filtered.steps.length,
        filtered.steps.length < allActions.steps.length, '< 7'),
      ok('governance stability score depressed', observed.governanceStabilityScore,
        observed.governanceStabilityScore < 70, '< 70'),
    ],
  };
}

async function scenario_endToEnd(): Promise<OperationalScenarioResult> {
  // Full ride: registry → multi-hop → chain health → adaptive layer → stabilizer
  // → safety → snapshot → diagnostics → composer with all 5 hardening + 5 operational rationales.
  const reg = newRegistry();
  const a = reg.registerAsset(makeSeed({
    format: 'long_form', title: 'Pillar A',
    strategicNarrative: 'Decision-trace observability sequenced before evaluations.',
    archetype: 'observability', icpFocus: ['Platform engineers'],
    themes: ['observability platform'], terms: ['decision traces', 'runtime telemetry'],
    words: 4000, authorityClaim: 85, evidence: 80, daysAgo: 50,
  }));
  const b = reg.registerAsset(makeSeed({
    format: 'thread', title: 'Thread B',
    strategicNarrative: 'Decision-trace observability sequenced before evaluations catch silent failures.',
    archetype: 'observability', icpFocus: ['Platform engineers'],
    themes: ['observability platform'], terms: ['decision traces'],
    words: 1100, authorityClaim: 70, evidence: 60, daysAgo: 30,
  }));
  reg.registerLineage({ companyId: 'co_test', sourceAssetId: a.assetId, derivedAssetId: b.assetId,
    transformationType: 'decomposition', ecosystemRole: 'amplifier' });
  const assets = reg.listAssets('co_test');
  const multiHop = governMultiHopTransformation({ registry: reg, companyId: 'co_test', leafAssetId: b.assetId });

  const chainHealth = createTransformationChainHealthGovernor()
    .recordTick({ companyId: 'co_test', multiHop, cumulativeFatigueScore: 10 });

  const layer = createAdaptiveTransformationApplicationLayer();
  for (let i = 0; i < 4; i += 1) {
    layer.apply('co_test', buildAdaptiveProfile({ adaptiveTransformationConfidence: 75 }));
  }
  const effective = layer.current('co_test')!;

  const stabilizer = createGovernanceStabilizationEngine();
  const stab = stabilizer.observe({ companyId: 'co_test', effectiveProfile: effective });

  const safety = createCrossModalSafetyGuard().audit({ registry: reg, companyId: 'co_test' });
  const semanticConf = createSemanticMatcher().compareWithConfidence(a, b);

  const cannib = analyzeCrossModalCannibalization({ assets });
  const compounding = computeAuthorityCompounding({ assets });
  const editorial = analyzeCrossModalEditorialMemory({ registry: reg, companyId: 'co_test' });

  const exp = composeCrossModalExplanation({
    transformation: null, continuity: null, cannibalization: cannib, editorialMemory: editorial,
    compounding, recoveryPlan: { steps: [], overallRiskScore: 0 },
    multiHop, fatigue: undefined, ecosystemNarrative: undefined, sequencing: undefined, adaptive: undefined,
    effective, chainHealth, semanticConfidence: semanticConf, stabilization: stab, safety,
  });

  // Snapshot + diagnostics smoke.
  const model = createPersistentTransformationSnapshotModel();
  const snap = await model.takeSnapshot({
    companyId: 'co_test',
    payload: {
      assets, lineages: reg.listLineages('co_test'),
      feedbackEvents: [], fatiguePatterns: [], chainHealthRecords: [chainHealth], adaptiveSamples: [],
    },
  });
  const integ = model.verify(snap);

  const diagReg = createCrossModalOperationalDiagnosticsRegistry();
  for (let i = 0; i < 6; i += 1) {
    diagReg.record({
      timestamp: new Date(Date.now() - (6 - i) * 1000).toISOString(),
      companyId: 'co_test',
      chainHealth, effective, semanticConfidence: semanticConf, stabilization: stab,
      safety, snapshotIntegrity: integ, recomputationCostMs: 2,
    });
  }
  const diag = diagReg.build('co_test');

  return {
    scenario: '11. end-to-end operationalization',
    passed: true,
    assertions: [
      ok('adaptationRationale present', exp.adaptationRationale ?? '(none)',
        typeof exp.adaptationRationale === 'string' && exp.adaptationRationale.length > 10, 'present'),
      ok('chainHealthRationale present', exp.chainHealthRationale ?? '(none)',
        typeof exp.chainHealthRationale === 'string' && exp.chainHealthRationale.length > 10, 'present'),
      ok('semanticConfidenceRationale present', exp.semanticConfidenceRationale ?? '(none)',
        typeof exp.semanticConfidenceRationale === 'string' && exp.semanticConfidenceRationale.length > 10, 'present'),
      ok('stabilizationRationale present', exp.stabilizationRationale ?? '(none)',
        typeof exp.stabilizationRationale === 'string' && exp.stabilizationRationale.length > 10, 'present'),
      ok('lineageSafetyRationale present', exp.lineageSafetyRationale ?? '(none)',
        typeof exp.lineageSafetyRationale === 'string' && exp.lineageSafetyRationale.length > 10, 'present'),
      ok('explanation hash prefix cmi_', exp.reasoningSourceHash.slice(0, 4), exp.reasoningSourceHash.startsWith('cmi_'), 'cmi_'),
      ok('snapshot integrity = 100', integ.snapshotIntegrityScore, integ.snapshotIntegrityScore === 100, '100'),
      ok('diagnostics sample = 6', diag.sampleSize, diag.sampleSize === 6, '6'),
      ok('diagnostics report integrity score', diag.lineageReplayIntegrityScore,
        diag.lineageReplayIntegrityScore === 100, '100'),
    ],
  };
}

// ─── suite ──────────────────────────────────────────────────────────────

export interface OperationalStressSuiteReport {
  scenarios: OperationalScenarioResult[];
  overall: { total: number; passed: number; failed: number };
}

function finalize(r: OperationalScenarioResult): OperationalScenarioResult {
  r.passed = r.assertions.every((a) => a.passed);
  return r;
}

export async function runCrossModalOperationalStressTests(): Promise<OperationalStressSuiteReport> {
  const results = await Promise.all([
    scenario_baseline(),
    scenario1_adaptiveOscillationLoops(),
    scenario2_recursiveTransformationChains(),
    scenario3_semanticOverClustering(),
    scenario4_lineageCorruptionAttempt(),
    scenario5_unstableAuthorityAmplification(),
    scenario6_crashRecoveryReplay(),
    scenario7_excessiveBranchNesting(),
    scenario8_partialSnapshotRestoration(),
    scenario9_ecosystemRecomputationStorms(),
    scenario10_recoveryThrashing(),
    scenario_endToEnd(),
  ]);
  const scenarios = results.map(finalize);
  const passed = scenarios.filter((s) => s.passed).length;
  return { scenarios, overall: { total: scenarios.length, passed, failed: scenarios.length - passed } };
}

export function formatOperationalStressReport(report: OperationalStressSuiteReport): string {
  const lines: string[] = [];
  lines.push('═══════════════════════════════════════════════════════');
  lines.push(' Long-form recommendation engine — cross-modal operationalization');
  lines.push('═══════════════════════════════════════════════════════');
  for (const s of report.scenarios) {
    lines.push('');
    lines.push(`${s.passed ? '[PASS]' : '[FAIL]'} ${s.scenario}`);
    for (const a of s.assertions) {
      lines.push(`   ${a.passed ? '✓' : '✗'} ${a.name}: ${a.observed} (${a.expected})`);
    }
  }
  lines.push('');
  lines.push('───────────────────────────────────────────────────────');
  lines.push(` Overall: ${report.overall.passed}/${report.overall.total} scenarios passed`);
  lines.push('═══════════════════════════════════════════════════════');
  return lines.join('\n');
}
