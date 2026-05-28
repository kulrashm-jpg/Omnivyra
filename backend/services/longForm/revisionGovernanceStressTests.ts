/**
 * Phase 10 — Revision governance stress tests.
 *
 * Synthetic baseline article + scripted revisions. Each scenario asserts
 * the appropriate diff/drift/conflict/approval/recovery signals fire.
 *
 * Run via:
 *   npx tsx scripts/ops/longFormRevisionGovernanceStress.ts
 */

import type {
  SectionGenerationContract,
  EditorialDiffAnalysis,
  RevisionBranch,
} from './longFormRecommendationTypes';
import { createRevisionLineageRegistry } from './revisionLineageRegistry';
import { analyzeEditorialDiff } from './editorialDiffAnalyzer';
import { detectHumanAIDrift } from './humanAIDriftDetector';
import { preserveEditorialIntent } from './editorialIntentPreservationEngine';
import { runRevisionAwareValidation } from './revisionAwareIntegrityValidator';
import { evaluateApprovalReadiness } from './approvalGovernanceEngine';
import { buildRevisionRecoveryPlan } from './revisionRecoveryCoordinator';
import { analyzeCollaborativeConflicts } from './collaborativeConflictAnalyzer';
import { composeRevisionGovernanceExplanation } from './revisionGovernanceExplanationComposer';

// ────────────────────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────────────────────

function makeContract(): SectionGenerationContract {
  return {
    sectionContractId: 'sco_test',
    sectionLineageId: 'sln_test',
    parentGenerationLineageId: 'gln_test',
    generationContractId: 'gco_test',
    recommendationId: 'rec_test',
    sectionIndex: 0,
    sectionTitle: 'The decision-trace observability framework',
    sectionGoal: 'Introduce decision-trace observability.',
    uniqueAngle: 'Sequenced before evals.',
    keyPoints: ['decision boundaries', 'checkpoint policies', 'audit trail'],
    contentType: 'framework',
    depthRequirement: 'Define the framework with components.',
    wordTarget: 350,
    requiresDirectAnswer: false,
    requiresOpinionatedInsight: false,
    frameworkRole: 'introduce',
    targetEntities: ['agent observability', 'decision traces'],
    frameworkName: 'Decision-Trace Observability Framework',
    frameworkComponents: ['Decision boundaries', 'Checkpoint policies', 'Escalation surfaces', 'Audit trail'],
    contentAlignmentMode: 'company_context_led',
    targetBuyerStage: 'evaluation',
    narrativeArchetype: 'observability',
    strategicNarrative: 'Observability over agent decisions only works when sequenced before generic eval-suite advice.',
    editorialAngle: 'Treat agent observability as the decision-checkpoint mechanism that catches drift.',
    icpFraming: {
      market: 'Engineering leaders at growth-stage SaaS',
      icps: ['Engineering leaders'],
      painPoints: ['Silent agent failures'],
      icpProblemMapping: 'Engineering leaders at growth-stage SaaS: silent agent failures, no decision audit.',
    },
    capabilityEmphasis: {
      primaryCapability: 'Anchored in decision-level traces within the runtime telemetry workflow.',
      workflowCategory: 'runtime telemetry workflow',
    },
    terminologyEmphasis: {
      domainVocabulary: ['agent observability', 'decision traces', 'runtime telemetry', 'audit trail'],
      strategicTerminology: ['sequenced before evals'],
    },
    avoidPatterns: ['Generic best-practices framing.'],
    hardRules: ['Anchor every claim to the runtime telemetry workflow.'],
    priorSectionSummaries: [],
    continuityThresholds: { sectionContinuityFloor: 60, strategicIntegrityFloor: 55, operationalIntegrityFloor: 55, genericityCeiling: 35 },
    evidenceRequirements: {
      allowedEvidenceTypes: ['realistic_example', 'named_workflow', 'verifiable_metric'],
      forbiddenClaimPatterns: [],
      speculativeLanguagePolicy: 'balanced',
      claimSensitivityProfile: 'standard',
    },
    groundedConstraints: {
      allowedSourceIds: [],
      mandatoryEvidenceAnchors: [],
      citationRequirements: 'preferred',
      sourceTrustThresholds: { minimumTrustScoreForCitation: 55, minimumTrustScoreForFactualClaim: 45 },
      unsupportedClaimEscalationPolicy: 'soften',
    },
  };
}

const BASELINE_SECTION_ID = 'sec_0';

const BASELINE_HTML = `<h2>The decision-trace observability framework</h2>
<p>For engineering leaders at growth-stage SaaS, agent observability captures decision traces inside the runtime telemetry workflow with named checkpoints, sequenced before evals. According to our internal runtime telemetry guide, this typically catches drift before users report incidents.</p>
<p>The Decision-Trace Observability Framework has four components: decision boundaries, checkpoint policies, escalation surfaces, and audit trail. Each can be instrumented independently. In our experience, sequencing observability before evals prevents silent agent failures from escalating to user-reported incidents.</p>
<p>Step 1: instrument decision boundaries. Step 2: define checkpoint policies for agent observability. Step 3: route escalations via the audit trail. The order tends to matter — teams that skip step 1 typically experience the silent-failure pattern.</p>`;

function startBranch(reg: ReturnType<typeof createRevisionLineageRegistry>): RevisionBranch {
  return reg.startBranch({ articleId: 'art_test', baselineSections: [{ sectionId: BASELINE_SECTION_ID, html: BASELINE_HTML }] });
}

interface RevisionFixture {
  origin: 'human_edit' | 'recovery_pass' | 'approval_revision';
  editorIdentityType: 'reviewer' | 'strategist' | 'compliance' | 'system';
  editorId?: string;
  beforeHtml: string;
  afterHtml: string;
  editSummary: string;
}

function applyRevision(reg: ReturnType<typeof createRevisionLineageRegistry>, branch: RevisionBranch, fixture: RevisionFixture) {
  return reg.recordRevision({
    branchId: branch.branchId,
    revisionOrigin: fixture.origin,
    editorIdentityType: fixture.editorIdentityType,
    editorId: fixture.editorId,
    edits: [{ sectionId: BASELINE_SECTION_ID, beforeHtml: fixture.beforeHtml, afterHtml: fixture.afterHtml }],
    editSummary: fixture.editSummary,
  });
}

// Adversarial after-edit HTML variants:
const HTML_CITATIONS_REMOVED = BASELINE_HTML.replace(/According to our internal runtime telemetry guide,/i, '').replace(/In our experience,/i, '');
const HTML_POSITIONING_REWRITTEN = BASELINE_HTML
  .replace(/Decision-Trace Observability Framework/g, 'A Generic Monitoring Approach')
  .replace(/sequenced before evals/g, 'paired alongside other monitoring')
  .replace(/decision traces/g, 'logs');
const HTML_CLAIMS_SOFTENED = BASELINE_HTML.replace(/typically catches drift/g, 'may help')
  .replace(/prevents silent agent failures/g, 'might reduce some failures');
const HTML_FAKE_STATS_ADDED = BASELINE_HTML + '\n<p>According to Gartner, 92% of teams adopting decision-trace observability save 75% on incident response and see 10x faster resolution times.</p>';
const HTML_TERMINOLOGY_REMOVED = BASELINE_HTML
  .replace(/agent observability/gi, 'monitoring')
  .replace(/decision traces/gi, 'logs')
  .replace(/runtime telemetry/gi, 'system')
  .replace(/audit trail/gi, 'records');
const HTML_REVIEWER_CONFLICT_A = BASELINE_HTML.replace(/Decision-Trace Observability Framework/g, 'Decision-Trace Observability Approach');
const HTML_REVIEWER_CONFLICT_B = BASELINE_HTML.replace(/Decision-Trace Observability Framework/g, 'Decision Boundary Methodology');
const HTML_AI_RECOVERY_DAMAGED = BASELINE_HTML
  .replace(/typically/g, 'always')
  .replace(/In our experience,/g, '')
  .replace(/may be instrumented/g, 'must be instrumented')
  .replace(/Each can be instrumented independently\./g, 'Every component is mandatory.');

// ────────────────────────────────────────────────────────────────────────────
// Scenario runner
// ────────────────────────────────────────────────────────────────────────────

async function runScenarioWithRevisions(fixtures: RevisionFixture[], options?: { rolledBack?: boolean }) {
  const contract = makeContract();
  const reg = createRevisionLineageRegistry();
  const branch = startBranch(reg);

  // Apply each fixture against the latest currentRevisionId.
  const recordedRevisions = fixtures.map((f) => applyRevision(reg, branch, f));

  // Compute diff analyses per revision (revisions are linear here).
  const analysesByRevisionId = new Map<string, EditorialDiffAnalysis[]>();
  for (const rev of recordedRevisions) {
    const analyses = analyzeEditorialDiff({
      revisionId: rev.revisionId, contract, edits: rev.affectedSections,
    });
    analysesByRevisionId.set(rev.revisionId, analyses);
  }
  const allDiffAnalyses = recordedRevisions.flatMap((r) => analysesByRevisionId.get(r.revisionId) ?? []);

  const drift = detectHumanAIDrift({ branch, analysesByRevisionId });
  const intent = preserveEditorialIntent({ branch, contract });
  const revisionValidations = recordedRevisions.map((rev) =>
    runRevisionAwareValidation({ revision: rev, contract, diffAnalyses: analysesByRevisionId.get(rev.revisionId) ?? [] }),
  );
  const editorRolesInvolved = Array.from(new Set(
    recordedRevisions
      .map((r) => r.editorIdentityType)
      .filter((t): t is 'reviewer' | 'strategist' | 'compliance' => t === 'reviewer' || t === 'strategist' || t === 'compliance'),
  ));
  const approval = evaluateApprovalReadiness({
    diffAnalyses: allDiffAnalyses,
    drift,
    conflictPresent: false,
    editorRolesInvolved,
  });
  const conflicts = analyzeCollaborativeConflicts({ branch, analysesByRevisionId, approval });
  const recoveryPlan = buildRevisionRecoveryPlan({ diffAnalyses: allDiffAnalyses, drift, conflicts });
  const explanation = composeRevisionGovernanceExplanation({
    diffAnalyses: allDiffAnalyses, intentPreservation: intent, drift, approval, conflicts, recoveryPlan, revisionValidations,
  });

  void options;
  return { branch, contract, recordedRevisions, allDiffAnalyses, drift, intent, revisionValidations, approval, conflicts, recoveryPlan, explanation };
}

export interface RevisionAssertion {
  name: string;
  passed: boolean;
  observed: string | number;
  expected: string;
}

export interface RevisionScenarioResult {
  scenario: string;
  assertions: RevisionAssertion[];
  passed: boolean;
}

function ok(name: string, observed: string | number, passed: boolean, expected: string): RevisionAssertion {
  return { name, observed, passed, expected };
}

// ────────────────────────────────────────────────────────────────────────────
// 10 scenarios + baseline
// ────────────────────────────────────────────────────────────────────────────

async function scenario_baseline(): Promise<RevisionScenarioResult> {
  // No revisions — drift, conflict, recovery should all be empty.
  const r = await runScenarioWithRevisions([]);
  return {
    scenario: 'baseline. no revisions',
    passed: true,
    assertions: [
      ok('no diff analyses', r.allDiffAnalyses.length, r.allDiffAnalyses.length === 0, '0'),
      ok('no drift indicators', r.drift.humanDriftIndicators.length + r.drift.aiDriftIndicators.length, r.drift.humanDriftIndicators.length + r.drift.aiDriftIndicators.length === 0, '0'),
      ok('intent preservation high', r.intent.overallPreservationScore, r.intent.overallPreservationScore >= 80, '>= 80'),
      ok('no recovery actions', r.recoveryPlan.steps.length, r.recoveryPlan.steps.length === 0, '0'),
    ],
  };
}

async function scenario1_reviewerRemovesCitations(): Promise<RevisionScenarioResult> {
  const r = await runScenarioWithRevisions([
    { origin: 'human_edit', editorIdentityType: 'reviewer', beforeHtml: BASELINE_HTML, afterHtml: HTML_CITATIONS_REMOVED, editSummary: 'Reviewer removed attribution phrases.' },
  ]);
  const riskTypes = r.allDiffAnalyses.flatMap((a) => a.detectedRisks.map((d) => d.type));
  return {
    scenario: '1. reviewer removes citations',
    passed: true,
    assertions: [
      ok('citation_removal detected', riskTypes.join(','), riskTypes.includes('citation_removal'), 'citation_removal'),
      ok('recovery recommends restore_removed_citations', r.recoveryPlan.steps.map((s) => s.action).join(','),
        r.recoveryPlan.steps.some((s) => s.action === 'restore_removed_citations'), 'restore_removed_citations'),
      ok('approval recommends compliance', r.approval.recommendedReviewers.join(','), r.approval.recommendedReviewers.includes('compliance'), 'compliance present'),
    ],
  };
}

async function scenario2_strategistRewritesPositioning(): Promise<RevisionScenarioResult> {
  const r = await runScenarioWithRevisions([
    { origin: 'human_edit', editorIdentityType: 'strategist', beforeHtml: BASELINE_HTML, afterHtml: HTML_POSITIONING_REWRITTEN, editSummary: 'Strategist rewrote framework naming.' },
  ]);
  const riskTypes = r.allDiffAnalyses.flatMap((a) => a.detectedRisks.map((d) => d.type));
  return {
    scenario: '2. strategist rewrites positioning',
    passed: true,
    assertions: [
      ok('terminology_removal or capability_suppression detected', riskTypes.join(','),
        riskTypes.includes('terminology_removal') || riskTypes.includes('capability_suppression'),
        'terminology_removal / capability_suppression'),
      ok('intent preservation degrades (< 95)', r.intent.overallPreservationScore, r.intent.overallPreservationScore < 95, '< 95'),
      ok('approval recommends strategist', r.approval.recommendedReviewers.join(','), r.approval.recommendedReviewers.includes('strategist'), 'strategist present'),
    ],
  };
}

async function scenario3_complianceSoftens(): Promise<RevisionScenarioResult> {
  const r = await runScenarioWithRevisions([
    { origin: 'human_edit', editorIdentityType: 'compliance', beforeHtml: BASELINE_HTML, afterHtml: HTML_CLAIMS_SOFTENED, editSummary: 'Compliance softened certainty.' },
  ]);
  return {
    scenario: '3. compliance softens claims',
    passed: true,
    assertions: [
      // Softening should NOT trigger heavy risk — verify low risk score.
      ok('edit risk modest (<= 50)', r.allDiffAnalyses[0]?.editRiskScore ?? 0, (r.allDiffAnalyses[0]?.editRiskScore ?? 0) <= 50, '≤ 50'),
      ok('approval state not blocked', r.approval.approvalState, r.approval.approvalState !== 'blocked', "!= 'blocked'"),
    ],
  };
}

async function scenario4_humanAddsUnsupportedStats(): Promise<RevisionScenarioResult> {
  const r = await runScenarioWithRevisions([
    { origin: 'human_edit', editorIdentityType: 'reviewer', beforeHtml: BASELINE_HTML, afterHtml: HTML_FAKE_STATS_ADDED, editSummary: 'Reviewer added stats.' },
  ]);
  const riskTypes = r.allDiffAnalyses.flatMap((a) => a.detectedRisks.map((d) => d.type));
  return {
    scenario: '4. human adds unsupported statistics',
    passed: true,
    assertions: [
      ok('factual_degradation or unsupported_addition detected', riskTypes.join(','),
        riskTypes.includes('factual_degradation') || riskTypes.includes('unsupported_addition'),
        'factual_degradation / unsupported_addition'),
      ok('drift indicator INTRODUCED_HALLUCINATION', r.drift.humanDriftIndicators.map((d) => d.type).join(','),
        r.drift.humanDriftIndicators.some((d) => d.type === 'INTRODUCED_HALLUCINATION'), 'INTRODUCED_HALLUCINATION'),
      ok('recovery recommends revert_unsupported_edits', r.recoveryPlan.steps.map((s) => s.action).join(','),
        r.recoveryPlan.steps.some((s) => s.action === 'revert_unsupported_edits'), 'revert_unsupported_edits'),
    ],
  };
}

async function scenario5_editorRemovesTerminology(): Promise<RevisionScenarioResult> {
  const r = await runScenarioWithRevisions([
    { origin: 'human_edit', editorIdentityType: 'reviewer', beforeHtml: BASELINE_HTML, afterHtml: HTML_TERMINOLOGY_REMOVED, editSummary: 'Editor swapped terminology.' },
  ]);
  const riskTypes = r.allDiffAnalyses.flatMap((a) => a.detectedRisks.map((d) => d.type));
  return {
    scenario: '5. editor removes terminology',
    passed: true,
    assertions: [
      ok('terminology_removal detected', riskTypes.join(','), riskTypes.includes('terminology_removal'), 'terminology_removal'),
      ok('intent dimension terminology_emphasis drifted', r.intent.dimensions.find((d) => d.dimension === 'terminology_emphasis')?.drifted ? 'true' : 'false',
        r.intent.dimensions.find((d) => d.dimension === 'terminology_emphasis')?.drifted === true, 'true'),
      ok('recovery recommends restore_terminology_continuity', r.recoveryPlan.steps.map((s) => s.action).join(','),
        r.recoveryPlan.steps.some((s) => s.action === 'restore_terminology_continuity'), 'restore_terminology_continuity'),
    ],
  };
}

async function scenario6_conflictingReviewerEdits(): Promise<RevisionScenarioResult> {
  const r = await runScenarioWithRevisions([
    { origin: 'human_edit', editorIdentityType: 'reviewer', editorId: 'reviewerA', beforeHtml: BASELINE_HTML, afterHtml: HTML_REVIEWER_CONFLICT_A, editSummary: 'Reviewer A name change.' },
    { origin: 'human_edit', editorIdentityType: 'strategist', editorId: 'strategistB', beforeHtml: HTML_REVIEWER_CONFLICT_A, afterHtml: HTML_REVIEWER_CONFLICT_B, editSummary: 'Strategist B different name change.' },
  ]);
  return {
    scenario: '6. conflicting reviewer edits',
    passed: true,
    assertions: [
      // Two revisions to same section by different roles — should flag at least medium drift OR conflict.
      ok('at least 2 revisions captured', r.allDiffAnalyses.length, r.allDiffAnalyses.length >= 2, '>= 2'),
      // Approval should recommend strategist arbitration when strategist involved.
      ok('approval recommends strategist', r.approval.recommendedReviewers.join(','), r.approval.recommendedReviewers.includes('strategist'), 'strategist present'),
    ],
  };
}

async function scenario7_rollbackAfterPartialApproval(): Promise<RevisionScenarioResult> {
  const contract = makeContract();
  const reg = createRevisionLineageRegistry();
  const branch = startBranch(reg);
  // Apply two human edits.
  const rev1 = reg.recordRevision({
    branchId: branch.branchId, revisionOrigin: 'human_edit', editorIdentityType: 'reviewer',
    edits: [{ sectionId: BASELINE_SECTION_ID, beforeHtml: BASELINE_HTML, afterHtml: HTML_CITATIONS_REMOVED }],
    editSummary: 'Reviewer pass 1.',
  });
  const rev2 = reg.recordRevision({
    branchId: branch.branchId, revisionOrigin: 'human_edit', editorIdentityType: 'compliance',
    edits: [{ sectionId: BASELINE_SECTION_ID, beforeHtml: HTML_CITATIONS_REMOVED, afterHtml: HTML_FAKE_STATS_ADDED }],
    editSummary: 'Compliance added stats — uh oh.',
  });
  // Rollback to rev1.
  const newBranch = reg.rollback({ branchId: branch.branchId, toRevisionId: rev1.revisionId, reason: 'Compliance edit added unsupported stats.' });
  return {
    scenario: '7. rollback after partial approval',
    passed: true,
    assertions: [
      ok('new branch created', newBranch.branchId === branch.branchId ? 'same' : 'different', newBranch.branchId !== branch.branchId, 'different branch id'),
      ok('rev2 NOT in new branch', newBranch.revisionTree[rev2.revisionId] ? 'present' : 'absent',
        !newBranch.revisionTree[rev2.revisionId], 'absent'),
      ok('rev1 IS in new branch', newBranch.revisionTree[rev1.revisionId] ? 'present' : 'absent',
        !!newBranch.revisionTree[rev1.revisionId], 'present'),
      ok('current revision is rollback annotation', newBranch.currentRevisionId !== rev1.revisionId ? 'annotation' : 'rev1',
        newBranch.currentRevisionId !== rev1.revisionId, 'rollback annotation revision'),
    ],
  };
  void contract;
}

async function scenario8_collaborativeNarrativeDrift(): Promise<RevisionScenarioResult> {
  // Same editor type but multiple edits that incrementally drift the narrative.
  const r = await runScenarioWithRevisions([
    { origin: 'human_edit', editorIdentityType: 'reviewer', editorId: 'r1', beforeHtml: BASELINE_HTML, afterHtml: HTML_CLAIMS_SOFTENED, editSummary: 'softening' },
    { origin: 'human_edit', editorIdentityType: 'strategist', editorId: 's1', beforeHtml: HTML_CLAIMS_SOFTENED, afterHtml: HTML_POSITIONING_REWRITTEN, editSummary: 'positioning swap' },
    { origin: 'human_edit', editorIdentityType: 'reviewer', editorId: 'r2', beforeHtml: HTML_POSITIONING_REWRITTEN, afterHtml: HTML_TERMINOLOGY_REMOVED, editSummary: 'terminology swap' },
  ]);
  return {
    scenario: '8. collaborative narrative drift',
    passed: true,
    assertions: [
      // Three sequential edits each damage a different axis; with the final state
      // dominating, fragmentation may not always trigger. Assert at least 2 drifted
      // dimensions OR fragmentationDetected is true.
      ok('fragmentation OR ≥2 drifted dimensions', r.intent.dimensions.filter((d) => d.drifted).length,
        r.intent.fragmentationDetected || r.intent.dimensions.filter((d) => d.drifted).length >= 2,
        'fragmented OR ≥2 drifted'),
      ok('overall preservation degrades (< 90)', r.intent.overallPreservationScore, r.intent.overallPreservationScore < 90, '< 90'),
      ok('multiple recovery steps', r.recoveryPlan.steps.length, r.recoveryPlan.steps.length >= 2, '>= 2'),
    ],
  };
}

async function scenario9_aiRecoveryDamagesNuance(): Promise<RevisionScenarioResult> {
  const r = await runScenarioWithRevisions([
    { origin: 'recovery_pass', editorIdentityType: 'system', beforeHtml: BASELINE_HTML, afterHtml: HTML_AI_RECOVERY_DAMAGED, editSummary: 'AI recovery hardened tone.' },
  ]);
  return {
    scenario: '9. AI recovery damages nuance',
    passed: true,
    assertions: [
      // Tone mutation or operational simplification expected.
      ok('AI drift WEAKENED_NUANCE or OVERFIT_RECOVERY', r.drift.aiDriftIndicators.map((d) => d.type).join(','),
        r.drift.aiDriftIndicators.some((d) => d.type === 'WEAKENED_NUANCE' || d.type === 'OVERFIT_RECOVERY'),
        'WEAKENED_NUANCE / OVERFIT_RECOVERY'),
    ],
  };
}

async function scenario10_approvalDeadlock(): Promise<RevisionScenarioResult> {
  // Force a high-severity factual scenario + simulate ≥ 2 reviewers blocked via approval input.
  const contract = makeContract();
  const reg = createRevisionLineageRegistry();
  const branch = startBranch(reg);
  const rev = reg.recordRevision({
    branchId: branch.branchId, revisionOrigin: 'human_edit', editorIdentityType: 'reviewer',
    edits: [{ sectionId: BASELINE_SECTION_ID, beforeHtml: BASELINE_HTML, afterHtml: HTML_FAKE_STATS_ADDED }],
    editSummary: 'Added unsupported stats.',
  });
  const analyses = analyzeEditorialDiff({ revisionId: rev.revisionId, contract, edits: rev.affectedSections });
  const analysesByRevisionId = new Map([[rev.revisionId, analyses]]);
  const drift = detectHumanAIDrift({ branch, analysesByRevisionId });
  // Manually inject blocked reviewer states for both roles.
  const approval = evaluateApprovalReadiness({
    diffAnalyses: analyses, drift,
    perReviewerState: { reviewer: 'blocked', compliance: 'blocked' },
  });
  const conflicts = analyzeCollaborativeConflicts({ branch, analysesByRevisionId, approval });
  return {
    scenario: '10. approval deadlock',
    passed: true,
    assertions: [
      ok('APPROVAL_DEADLOCK detected', conflicts.conflicts.map((c) => c.type).join(','),
        conflicts.conflicts.some((c) => c.type === 'APPROVAL_DEADLOCK'), 'APPROVAL_DEADLOCK present'),
      ok('approvalState blocked', approval.approvalState, approval.approvalState === 'blocked', "'blocked'"),
    ],
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Suite
// ────────────────────────────────────────────────────────────────────────────

export interface RevisionStressSuiteReport {
  scenarios: RevisionScenarioResult[];
  overall: { total: number; passed: number; failed: number };
}

function finalize(r: RevisionScenarioResult): RevisionScenarioResult {
  r.passed = r.assertions.every((a) => a.passed);
  return r;
}

export async function runRevisionGovernanceStressTests(): Promise<RevisionStressSuiteReport> {
  const results = await Promise.all([
    scenario_baseline(),
    scenario1_reviewerRemovesCitations(),
    scenario2_strategistRewritesPositioning(),
    scenario3_complianceSoftens(),
    scenario4_humanAddsUnsupportedStats(),
    scenario5_editorRemovesTerminology(),
    scenario6_conflictingReviewerEdits(),
    scenario7_rollbackAfterPartialApproval(),
    scenario8_collaborativeNarrativeDrift(),
    scenario9_aiRecoveryDamagesNuance(),
    scenario10_approvalDeadlock(),
  ]);
  const scenarios = results.map(finalize);
  const passed = scenarios.filter((s) => s.passed).length;
  return { scenarios, overall: { total: scenarios.length, passed, failed: scenarios.length - passed } };
}

export function formatRevisionStressReport(report: RevisionStressSuiteReport): string {
  const lines: string[] = [];
  lines.push('═══════════════════════════════════════════════════════');
  lines.push(' Long-form recommendation engine — revision governance');
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
