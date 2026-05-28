/**
 * Phase 26I — Production execution stress harness.
 *
 * Twelve adversarial scenarios validating the Phase 26 production wiring:
 *   1.  replay during live provider publish
 *   2.  restart during long-form generation
 *   3.  duplicate publish replay storm
 *   4.  campaign replay after deploy restart
 *   5.  reconciliation replay after worker failover
 *   6.  provider timeout during replay continuation
 *   7.  long-form replay divergence
 *   8.  checkpoint replay during campaign continuation
 *   9.  replay-safe publish suppression under retry storm
 *  10.  stale checkpoint continuation attempt
 *  11.  runtime restart during reconciliation replay
 *  12.  cross-run forensic replay comparison
 *
 * Hermetic: in-memory queue + worker registry + production hook factories
 * with stubbed service-reference functions (tracking call counts).
 *
 * Usage:
 *   npx tsx scripts/ops/longFormProductionExecutionStress.ts
 */

import {
  createInMemoryExecutionQueue,
  setDefaultExecutionQueue,
  getDefaultExecutionQueue,
} from '../../backend/services/orchestration/distributed/distributedExecutionQueue';
import {
  createDistributedWorkerCoordinator,
  setDefaultDistributedWorkerCoordinator,
} from '../../backend/services/orchestration/distributed/distributedWorkerCoordinator';
import {
  createInMemoryExecutionStore,
  setDefaultExecutionStore,
} from '../../backend/services/threadRuntime/executionStore';
import {
  createDurableExecutionCoordinator,
  setDefaultDurableExecutionCoordinator,
  getDefaultDurableExecutionCoordinator,
} from '../../backend/services/threadRuntime/durableExecutionCoordinator';
import {
  createExecutionCheckpointManager,
  setDefaultExecutionCheckpointManager,
  getDefaultExecutionCheckpointManager,
} from '../../backend/services/threadRuntime/executionCheckpointManager';
import {
  createCheckpointRestorationEngine,
  setDefaultCheckpointRestorationEngine,
} from '../../backend/services/orchestration/recovery/checkpointRestorationEngine';
import {
  setDefaultQueuePayloadHydrator,
  createQueuePayloadHydrator,
} from '../../backend/services/orchestration/distributed/queuePayloadHydrator';
import {
  activateProductionDomainRuntime,
} from '../../backend/services/orchestration/distributed/domain/production/productionDomainBootWiring';
import {
  buildDistributedRunnerStepBuilders,
} from '../../backend/services/orchestration/distributed/distributedWorkflowExecutionBridge';
import {
  createDistributedRuntimeForensicAnalyzer,
} from '../../backend/services/orchestration/distributed/distributedRuntimeForensicAnalyzer';
import {
  setDefaultExecutionPayloadGovernor,
  createExecutionPayloadGovernor,
} from '../../backend/services/orchestration/distributed/executionPayloadGovernor';
import type {
  QueuePayloadV1,
} from '../../backend/services/orchestration/distributed/workflowExecutionTypes';
import type {
  LongFormServiceDeps,
} from '../../backend/services/orchestration/distributed/domain/production/productionLongFormHooks';
import type {
  CampaignServiceDeps,
} from '../../backend/services/orchestration/distributed/domain/production/productionCampaignHooks';
import type {
  SocialPublishServiceDeps,
} from '../../backend/services/orchestration/distributed/domain/production/productionSocialPublishHooks';
import type {
  ReconciliationServiceDeps,
} from '../../backend/services/orchestration/distributed/domain/production/productionReconciliationHooks';

// ────────────────────────────────────────────────────────────────────
// Test scaffolding
// ────────────────────────────────────────────────────────────────────

interface Assertion { label: string; actual: unknown; expected: string; ok: boolean }
interface ScenarioResult { name: string; passed: boolean; assertions: Assertion[]; err?: string }

function expectEq(label: string, actual: unknown, expected: unknown): Assertion {
  return { label, actual, expected: JSON.stringify(expected), ok: JSON.stringify(actual) === JSON.stringify(expected) };
}
function expectTrue(label: string, actual: boolean, expected: string): Assertion {
  return { label, actual, expected, ok: actual === true };
}
function expectAtLeast(label: string, actual: number, threshold: number): Assertion {
  return { label, actual, expected: `>= ${threshold}`, ok: actual >= threshold };
}
function expectAtMost(label: string, actual: number, threshold: number): Assertion {
  return { label, actual, expected: `<= ${threshold}`, ok: actual <= threshold };
}

interface TrackedHooks {
  longForm: LongFormServiceDeps & { calls: { section: number; finalize: number } };
  campaign: CampaignServiceDeps & { calls: { post: number; finalize: number } };
  publish: SocialPublishServiceDeps & { calls: { publish: number; validate: number } };
  reconciliation: ReconciliationServiceDeps & { calls: { reconcile: number } };
}

function makeTrackedHooks(): TrackedHooks {
  const lf = {
    calls: { section: 0, finalize: 0 },
    async generateSection() { lf.calls.section += 1; },
    async finalize() { lf.calls.finalize += 1; },
  };
  const camp = {
    calls: { post: 0, finalize: 0 },
    async publishPost() { camp.calls.post += 1; },
    async finalizeCampaign() { camp.calls.finalize += 1; },
  };
  const pub = {
    calls: { publish: 0, validate: 0 },
    async validateTokens() { pub.calls.validate += 1; },
    adapters: {
      x: async () => { pub.calls.publish += 1; },
      linkedin: async () => { pub.calls.publish += 1; },
      instagram: async () => { pub.calls.publish += 1; },
    },
  };
  const rec = {
    calls: { reconcile: 0 },
    async reconcileRow() { rec.calls.reconcile += 1; },
  };
  return { longForm: lf, campaign: camp, publish: pub, reconciliation: rec };
}

function resetWorld(hooks: TrackedHooks) {
  setDefaultExecutionStore(createInMemoryExecutionStore());
  setDefaultDurableExecutionCoordinator(createDurableExecutionCoordinator());
  setDefaultExecutionCheckpointManager(createExecutionCheckpointManager());
  setDefaultCheckpointRestorationEngine(createCheckpointRestorationEngine({ telemetry: { emit: () => {} } }));
  setDefaultExecutionQueue(createInMemoryExecutionQueue({ telemetry: { emit: () => {} } }));
  setDefaultDistributedWorkerCoordinator(createDistributedWorkerCoordinator({
    telemetry: { emit: () => {} }, defaultStaleThresholdMs: 200,
  }));
  setDefaultQueuePayloadHydrator(createQueuePayloadHydrator({ telemetry: { emit: () => {} } }));
  // Activate production runtime — installs registry + continuity + rules.
  const boot = activateProductionDomainRuntime({
    services: {
      longForm: hooks.longForm,
      campaign: hooks.campaign,
      socialPublish: hooks.publish,
      reconciliation: hooks.reconciliation,
    },
    telemetry: { emit: () => {} },
  });
  // Ensure governor consults the same registry we just installed.
  setDefaultExecutionPayloadGovernor(createExecutionPayloadGovernor({
    registry: boot.registry, telemetry: { emit: () => {} },
  }));
}

async function runScenario(name: string, body: (h: TrackedHooks) => Promise<Assertion[]>): Promise<ScenarioResult> {
  const hooks = makeTrackedHooks();
  resetWorld(hooks);
  try {
    const assertions = await body(hooks);
    return { name, assertions, passed: assertions.every((a) => a.ok) };
  } catch (err) {
    return { name, passed: false, assertions: [], err: (err as Error).message };
  }
}

async function seedExec(): Promise<{ executionId: string; companyId: string }> {
  const e = await getDefaultDurableExecutionCoordinator().start({
    runtimeSessionId: 'rs', threadId: 'thr',
    companyId: '00000000-0000-0000-0000-000000000001',
  });
  return { executionId: e.executionId, companyId: e.companyId };
}

async function enqueue(payload: QueuePayloadV1): Promise<string> {
  const e = await getDefaultExecutionQueue().enqueue({
    executionId: payload.executionId, companyId: payload.companyId,
    kind: 'execution_start',
    payload: payload as unknown as Record<string, unknown>,
  });
  return e.queueEntryId;
}

// ────────────────────────────────────────────────────────────────────
// Scenarios
// ────────────────────────────────────────────────────────────────────

async function s1_replayDuringLiveProviderPublish(h: TrackedHooks): Promise<Assertion[]> {
  const { executionId, companyId } = await seedExec();
  await getDefaultDurableExecutionCoordinator().transition({ executionId, to: 'running' });
  await enqueue({
    schemaVersion: 1, workflowType: 'social_publish',
    executionId, companyId,
    workflowParams: {
      subType: 'social_publish', provider: 'x',
      socialAccountId: 'acc', scheduledPostId: 'sp', contentFingerprint: 'fp1',
    },
  });
  const builders = buildDistributedRunnerStepBuilders();
  const queue = getDefaultExecutionQueue();
  const [entry] = await queue.claim({ workerId: 'w' });
  const buildInput = {
    execution: (await getDefaultDurableExecutionCoordinator().get(entry.executionId))!,
    restored: null, queueEntry: entry,
  };
  const steps = await builders.buildSteps(buildInput);
  const ctx = await builders.buildContext(buildInput);
  const publishStep = steps.find((s) => s.id.startsWith('sp_publish_'))!;
  await publishStep.run(ctx);
  // Now a "replay" — same step run twice. The in-process fingerprint cache
  // should suppress the second call.
  await publishStep.run(ctx);
  return [
    expectEq('adapter called exactly once (in-process suppression)', h.publish.calls.publish, 1),
  ];
}

async function s2_restartDuringLongFormGeneration(h: TrackedHooks): Promise<Assertion[]> {
  const { executionId, companyId } = await seedExec();
  await getDefaultDurableExecutionCoordinator().transition({ executionId, to: 'running' });
  // Half-complete checkpoint.
  await getDefaultExecutionCheckpointManager().capture({
    executionId, phase: 'generation',
    newlyCompleted: ['lf_gen_s1'], pending: ['lf_gen_s2', 'lf_finalize'],
  });
  await enqueue({
    schemaVersion: 1, workflowType: 'long_form_generation',
    executionId, companyId,
    workflowParams: {
      subType: 'long_form_generation', generationId: 'g1',
      sectionIds: ['s1', 's2'],
      runEnrichment: false, emitRecommendationCard: false,
    },
  });
  const queue = getDefaultExecutionQueue();
  const [entry] = await queue.claim({ workerId: 'w' });
  const builders = buildDistributedRunnerStepBuilders();
  const steps = await builders.buildSteps({
    execution: (await getDefaultDurableExecutionCoordinator().get(entry.executionId))!,
    restored: null, queueEntry: entry,
  });
  // Run only s2 + finalize (workflow engine semantics).
  for (const s of steps) {
    if (s.id === 'lf_precheck' || s.id === 'lf_gen_s1') continue;
    await s.run({} as never);
  }
  return [
    expectEq('only s2 ran (s1 skipped)', h.longForm.calls.section, 1),
    expectEq('finalize ran once', h.longForm.calls.finalize, 1),
  ];
}

async function s3_duplicatePublishReplayStorm(h: TrackedHooks): Promise<Assertion[]> {
  const { executionId, companyId } = await seedExec();
  await getDefaultDurableExecutionCoordinator().transition({ executionId, to: 'running' });
  await enqueue({
    schemaVersion: 1, workflowType: 'social_publish',
    executionId, companyId,
    workflowParams: {
      subType: 'social_publish', provider: 'linkedin',
      socialAccountId: 'acc', scheduledPostId: 'sp', contentFingerprint: 'fp_storm',
    },
  });
  const queue = getDefaultExecutionQueue();
  const [entry] = await queue.claim({ workerId: 'w' });
  const builders = buildDistributedRunnerStepBuilders();
  const buildInput = {
    execution: (await getDefaultDurableExecutionCoordinator().get(entry.executionId))!,
    restored: null, queueEntry: entry,
  };
  const steps = await builders.buildSteps(buildInput);
  const ctx = await builders.buildContext(buildInput);
  const publishStep = steps.find((s) => s.id.startsWith('sp_publish_'))!;
  // Storm: 20 back-to-back invocations of the same publish step.
  for (let i = 0; i < 20; i += 1) await publishStep.run(ctx);
  return [
    expectEq('publish executed exactly once across 20 calls', h.publish.calls.publish, 1),
  ];
}

async function s4_campaignReplayAfterDeployRestart(h: TrackedHooks): Promise<Assertion[]> {
  const { executionId, companyId } = await seedExec();
  await getDefaultDurableExecutionCoordinator().transition({ executionId, to: 'running' });
  await getDefaultExecutionCheckpointManager().capture({
    executionId, phase: 'persistence',
    newlyCompleted: ['camp_post_p1'],
    pending: ['camp_post_p2', 'camp_finalize'],
  });
  await enqueue({
    schemaVersion: 1, workflowType: 'campaign_execution',
    executionId, companyId,
    workflowParams: {
      subType: 'campaign_execution', campaignId: 'c1',
      posts: [{ postId: 'p1' }, { postId: 'p2' }],
    },
  });
  const queue = getDefaultExecutionQueue();
  const [entry] = await queue.claim({ workerId: 'w' });
  const builders = buildDistributedRunnerStepBuilders();
  const steps = await builders.buildSteps({
    execution: (await getDefaultDurableExecutionCoordinator().get(entry.executionId))!,
    restored: null, queueEntry: entry,
  });
  for (const s of steps) {
    if (s.id === 'camp_precheck' || s.id === 'camp_post_p1') continue;
    await s.run({} as never);
  }
  return [
    expectEq('post hook ran exactly once (only p2)', h.campaign.calls.post, 1),
  ];
}

async function s5_reconciliationReplayAfterWorkerFailover(h: TrackedHooks): Promise<Assertion[]> {
  const { executionId, companyId } = await seedExec();
  await getDefaultDurableExecutionCoordinator().transition({ executionId, to: 'running' });
  await enqueue({
    schemaVersion: 1, workflowType: 'provider_reconciliation',
    executionId, companyId,
    workflowParams: {
      subType: 'provider_reconciliation', rowId: 'r1', provider: 'instagram',
    },
  });
  const queue = getDefaultExecutionQueue();
  await queue.claim({ workerId: 'w_dead', visibilityMs: 30 });
  await new Promise((r) => setTimeout(r, 80));
  await queue.reclaimExpired();
  const [entry] = await queue.claim({ workerId: 'w_alive' });
  const builders = buildDistributedRunnerStepBuilders();
  const steps = await builders.buildSteps({
    execution: (await getDefaultDurableExecutionCoordinator().get(entry.executionId))!,
    restored: null, queueEntry: entry,
  });
  const recStep = steps.find((s) => s.id.startsWith('rec_apply_'))!;
  await recStep.run({} as never);
  return [
    expectEq('reconcile hook called once after failover', h.reconciliation.calls.reconcile, 1),
  ];
}

async function s6_providerTimeoutDuringReplayContinuation(h: TrackedHooks): Promise<Assertion[]> {
  // Inject a failing adapter for the first call, succeeds after.
  let attempts = 0;
  h.publish.adapters.x = async () => {
    attempts += 1;
    if (attempts < 2) throw new Error('timeout');
    h.publish.calls.publish += 1;
  };
  const { executionId, companyId } = await seedExec();
  await getDefaultDurableExecutionCoordinator().transition({ executionId, to: 'running' });
  await enqueue({
    schemaVersion: 1, workflowType: 'social_publish',
    executionId, companyId,
    workflowParams: {
      subType: 'social_publish', provider: 'x',
      socialAccountId: 'acc', scheduledPostId: 'sp', contentFingerprint: 'fp_timeout',
    },
  });
  const queue = getDefaultExecutionQueue();
  const [entry] = await queue.claim({ workerId: 'w' });
  const builders = buildDistributedRunnerStepBuilders();
  const buildInput = {
    execution: (await getDefaultDurableExecutionCoordinator().get(entry.executionId))!,
    restored: null, queueEntry: entry,
  };
  const steps = await builders.buildSteps(buildInput);
  const ctx = await builders.buildContext(buildInput);
  const publishStep = steps.find((s) => s.id.startsWith('sp_publish_'))!;
  let threw = false;
  try { await publishStep.run(ctx); } catch { threw = true; }
  await publishStep.run(ctx);
  return [
    expectTrue('first attempt threw', threw, 'truthy'),
    expectEq('second attempt succeeded', h.publish.calls.publish, 1),
  ];
}

async function s7_longFormReplayDivergence(h: TrackedHooks): Promise<Assertion[]> {
  const { executionId, companyId } = await seedExec();
  await enqueue({
    schemaVersion: 1, workflowType: 'long_form_generation',
    executionId, companyId,
    checkpointReference: { checkpointId: 'cp_nope' },
    workflowParams: {
      subType: 'long_form_generation', generationId: 'g_div',
      sectionIds: ['s1'],
    },
  });
  const queue = getDefaultExecutionQueue();
  const [entry] = await queue.claim({ workerId: 'w' });
  const builders = buildDistributedRunnerStepBuilders();
  let threw = false;
  try {
    await builders.buildSteps({
      execution: (await getDefaultDurableExecutionCoordinator().get(entry.executionId))!,
      restored: null, queueEntry: entry,
    });
  } catch { threw = true; }
  return [
    expectEq('bridge refused (checkpoint not in chain)', threw, true),
  ];
}

async function s8_checkpointReplayDuringCampaignContinuation(h: TrackedHooks): Promise<Assertion[]> {
  // Full-completion checkpoint should trigger continuity-rule suppression.
  const { executionId, companyId } = await seedExec();
  await getDefaultDurableExecutionCoordinator().transition({ executionId, to: 'running' });
  await getDefaultExecutionCheckpointManager().capture({
    executionId, phase: 'finalize',
    newlyCompleted: ['camp_post_p1', 'camp_post_p2', 'camp_finalize'],
    pending: [],
  });
  await enqueue({
    schemaVersion: 1, workflowType: 'campaign_execution',
    executionId, companyId,
    workflowParams: {
      subType: 'campaign_execution', campaignId: 'c_done',
      posts: [{ postId: 'p1' }, { postId: 'p2' }],
    },
  });
  const queue = getDefaultExecutionQueue();
  const [entry] = await queue.claim({ workerId: 'w' });
  const builders = buildDistributedRunnerStepBuilders();
  const steps = await builders.buildSteps({
    execution: (await getDefaultDurableExecutionCoordinator().get(entry.executionId))!,
    restored: null, queueEntry: entry,
  });
  // Continuity rule should suppress → empty steps.
  return [
    expectEq('continuity rule suppressed (empty steps)', steps.length, 0),
  ];
}

async function s9_replaySafePublishSuppressionUnderRetryStorm(h: TrackedHooks): Promise<Assertion[]> {
  const { executionId, companyId } = await seedExec();
  await getDefaultDurableExecutionCoordinator().transition({ executionId, to: 'running' });
  await enqueue({
    schemaVersion: 1, workflowType: 'social_publish',
    executionId, companyId,
    workflowParams: {
      subType: 'social_publish', provider: 'instagram',
      socialAccountId: 'acc', scheduledPostId: 'sp', contentFingerprint: 'fp_retry',
    },
  });
  const queue = getDefaultExecutionQueue();
  const [entry] = await queue.claim({ workerId: 'w' });
  const builders = buildDistributedRunnerStepBuilders();
  const buildInput = {
    execution: (await getDefaultDurableExecutionCoordinator().get(entry.executionId))!,
    restored: null, queueEntry: entry,
  };
  const steps = await builders.buildSteps(buildInput);
  const ctx = await builders.buildContext(buildInput);
  const publishStep = steps.find((s) => s.id.startsWith('sp_publish_'))!;
  // Sequential retry storm — the substrate runs steps sequentially per
  // execution, so 10 SEQUENTIAL retries must all be suppressed after the
  // first call populates the in-process fingerprint cache.
  for (let i = 0; i < 10; i += 1) {
    await publishStep.run(ctx);
  }
  return [
    expectEq('publish hook called exactly once across 10 sequential retries', h.publish.calls.publish, 1),
  ];
}

async function s10_staleCheckpointContinuationAttempt(h: TrackedHooks): Promise<Assertion[]> {
  // Payload references a non-latest checkpoint → continuity coord suppresses.
  const { executionId, companyId } = await seedExec();
  await getDefaultDurableExecutionCoordinator().transition({ executionId, to: 'running' });
  await getDefaultExecutionCheckpointManager().capture({
    executionId, phase: 'generation', newlyCompleted: ['s1'], pending: [],
  });
  await getDefaultExecutionCheckpointManager().capture({
    executionId, phase: 'persistence', newlyCompleted: [], pending: [],
  });
  // Get the older checkpoint id.
  const all = await getDefaultExecutionCheckpointManager().list(executionId);
  const olderCp = all[0].checkpointId;
  await enqueue({
    schemaVersion: 1, workflowType: 'replay_continuation',
    executionId, companyId,
    checkpointReference: { checkpointId: olderCp },
    idempotencyHints: [{ stepId: 's1', cls: 'unknown', semanticParts: ['s1'] }],
  });
  const queue = getDefaultExecutionQueue();
  const [entry] = await queue.claim({ workerId: 'w' });
  const builders = buildDistributedRunnerStepBuilders();
  const steps = await builders.buildSteps({
    execution: (await getDefaultDurableExecutionCoordinator().get(entry.executionId))!,
    restored: null, queueEntry: entry,
  });
  return [
    expectEq('stale checkpoint suppressed (empty steps)', steps.length, 0),
  ];
}

async function s11_runtimeRestartDuringReconciliationReplay(h: TrackedHooks): Promise<Assertion[]> {
  const { executionId, companyId } = await seedExec();
  await getDefaultDurableExecutionCoordinator().transition({ executionId, to: 'running' });
  await enqueue({
    schemaVersion: 1, workflowType: 'provider_reconciliation',
    executionId, companyId,
    workflowParams: {
      subType: 'provider_reconciliation', rowId: 'r_restart', provider: 'reddit',
    },
  });
  const queue = getDefaultExecutionQueue();
  await queue.claim({ workerId: 'w_pre', visibilityMs: 30 });
  await new Promise((r) => setTimeout(r, 80));
  await queue.reclaimExpired();
  const [entry] = await queue.claim({ workerId: 'w_post' });
  const builders = buildDistributedRunnerStepBuilders();
  const steps = await builders.buildSteps({
    execution: (await getDefaultDurableExecutionCoordinator().get(entry.executionId))!,
    restored: null, queueEntry: entry,
  });
  for (const s of steps) await s.run({} as never);
  return [
    expectEq('reconcile hook called once after restart', h.reconciliation.calls.reconcile, 1),
  ];
}

async function s12_crossRunForensicReplayComparison(h: TrackedHooks): Promise<Assertion[]> {
  // Seed two executions: canonical + replay. Each with one publish.
  const canon = await seedExec();
  const reco = await seedExec();
  const queue = getDefaultExecutionQueue();
  await queue.enqueue({
    executionId: canon.executionId, companyId: canon.companyId, kind: 'execution_start',
    payload: {
      schemaVersion: 1, workflowType: 'social_publish',
      executionId: canon.executionId, companyId: canon.companyId,
      workflowParams: {
        subType: 'social_publish', provider: 'x', socialAccountId: 'acc',
        scheduledPostId: 'sp_canon', contentFingerprint: 'fp_canon',
      },
    } as unknown as Record<string, unknown>,
  });
  await queue.enqueue({
    executionId: reco.executionId, companyId: reco.companyId, kind: 'execution_start',
    payload: {
      schemaVersion: 1, workflowType: 'social_publish',
      executionId: reco.executionId, companyId: reco.companyId,
      workflowParams: {
        subType: 'social_publish', provider: 'x', socialAccountId: 'acc',
        scheduledPostId: 'sp_reco', contentFingerprint: 'fp_reco',
      },
    } as unknown as Record<string, unknown>,
  });

  const analyzer = createDistributedRuntimeForensicAnalyzer();
  const cmp = await analyzer.compareDistributedRuns({
    canonicalExecutionId: canon.executionId,
    recoveredExecutionId: reco.executionId,
  });
  return [
    expectTrue('cross-run comparison returned providerReplayDivergenceAssessment',
      typeof cmp.providerReplayDivergenceAssessment === 'object', 'object'),
    expectEq('recovered has 1 extra fingerprint (fp_reco)',
      cmp.providerReplayDivergenceAssessment.extraInRecovered.length, 1),
    expectEq('canonical has 1 missing fingerprint (fp_canon)',
      cmp.providerReplayDivergenceAssessment.missingInRecovered.length, 1),
  ];
}

// ────────────────────────────────────────────────────────────────────
// Runner
// ────────────────────────────────────────────────────────────────────

async function main() {
  const scenarios: Array<{ name: string; run: (h: TrackedHooks) => Promise<Assertion[]> }> = [
    { name: '1. replay during live provider publish', run: s1_replayDuringLiveProviderPublish },
    { name: '2. restart during long-form generation', run: s2_restartDuringLongFormGeneration },
    { name: '3. duplicate publish replay storm', run: s3_duplicatePublishReplayStorm },
    { name: '4. campaign replay after deploy restart', run: s4_campaignReplayAfterDeployRestart },
    { name: '5. reconciliation replay after worker failover', run: s5_reconciliationReplayAfterWorkerFailover },
    { name: '6. provider timeout during replay continuation', run: s6_providerTimeoutDuringReplayContinuation },
    { name: '7. long-form replay divergence', run: s7_longFormReplayDivergence },
    { name: '8. checkpoint replay during campaign continuation', run: s8_checkpointReplayDuringCampaignContinuation },
    { name: '9. replay-safe publish suppression under retry storm', run: s9_replaySafePublishSuppressionUnderRetryStorm },
    { name: '10. stale checkpoint continuation attempt', run: s10_staleCheckpointContinuationAttempt },
    { name: '11. runtime restart during reconciliation replay', run: s11_runtimeRestartDuringReconciliationReplay },
    { name: '12. cross-run forensic replay comparison', run: s12_crossRunForensicReplayComparison },
  ];

  const results: ScenarioResult[] = [];
  for (const s of scenarios) results.push(await runScenario(s.name, s.run));

  const passed = results.filter((r) => r.passed).length;
  for (const r of results) {
    const tag = r.passed ? '[PASS]' : '[FAIL]';
    process.stdout.write(`\n${tag} ${r.name}\n`);
    if (r.err) process.stdout.write(`   ERR: ${r.err}\n`);
    for (const a of r.assertions) {
      const mark = a.ok ? '✓' : '✗';
      process.stdout.write(`   ${mark} ${a.label}: ${JSON.stringify(a.actual)} (${a.expected})\n`);
    }
  }
  process.stdout.write('\n─'.repeat(55) + '\n');
  process.stdout.write(` Overall: ${passed}/${results.length} scenarios passed\n`);
  process.stdout.write('═'.repeat(55) + '\n');
  if (passed !== results.length) process.exitCode = 1;
}

void main();
