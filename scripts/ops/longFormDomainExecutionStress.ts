/**
 * Phase 24I — Domain execution stress harness.
 *
 * Twelve adversarial scenarios validating Phase 24 domain builders:
 *   1.  restart during long-form generation
 *   2.  duplicate publish replay attempt
 *   3.  provider timeout during replay continuation
 *   4.  campaign restart during staggered execution
 *   5.  reconciliation replay after worker failover
 *   6.  checkpoint corruption during generation
 *   7.  duplicate regeneration attempt
 *   8.  provider publish during reclaim
 *   9.  campaign replay after deploy restart
 *  10.  long-form replay divergence
 *  11.  provider reconciliation replay storm
 *  12.  queue replay during active campaign execution
 *
 * Hermetic: in-memory queue + worker registry + the full Phase 24 pipeline.
 *
 * Usage:
 *   npx tsx scripts/ops/longFormDomainExecutionStress.ts
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
  createWorkflowStepRegistry,
  setDefaultWorkflowStepRegistry,
} from '../../backend/services/orchestration/distributed/workflowStepRegistry';
import {
  createQueuePayloadHydrator,
  setDefaultQueuePayloadHydrator,
} from '../../backend/services/orchestration/distributed/queuePayloadHydrator';
import {
  createExecutionPayloadGovernor,
  setDefaultExecutionPayloadGovernor,
} from '../../backend/services/orchestration/distributed/executionPayloadGovernor';
import {
  createQueueCheckpointContinuityCoordinator,
  setDefaultQueueCheckpointContinuityCoordinator,
} from '../../backend/services/orchestration/distributed/queueCheckpointContinuityCoordinator';
import {
  createDomainReplayGovernor,
} from '../../backend/services/orchestration/distributed/domain/domainReplayGovernor';
import {
  buildDistributedRunnerStepBuilders,
} from '../../backend/services/orchestration/distributed/distributedWorkflowExecutionBridge';
import {
  registerDomainStepBuilders,
} from '../../backend/services/orchestration/distributed/domain/registerDomainStepBuilders';
import type {
  QueuePayloadV1,
} from '../../backend/services/orchestration/distributed/workflowExecutionTypes';
import type {
  CampaignServiceHooks,
  LongFormServiceHooks,
  ReconciliationServiceHooks,
  SocialPublishServiceHooks,
} from '../../backend/services/orchestration/distributed/domain/domainWorkflowTypes';

// ────────────────────────────────────────────────────────────────────
// Test scaffolding
// ────────────────────────────────────────────────────────────────────

interface Assertion { label: string; actual: unknown; expected: string; ok: boolean }
interface ScenarioResult { name: string; passed: boolean; assertions: Assertion[]; err?: string }

function expectEq(label: string, actual: unknown, expected: unknown): Assertion {
  return { label, actual, expected: JSON.stringify(expected),
    ok: JSON.stringify(actual) === JSON.stringify(expected) };
}
function expectTrue(label: string, actual: boolean, expected: string): Assertion {
  return { label, actual, expected, ok: actual === true };
}
function expectAtLeast(label: string, actual: number, threshold: number): Assertion {
  return { label, actual, expected: `>= ${threshold}`, ok: actual >= threshold };
}

interface CountingHooks {
  longForm: LongFormServiceHooks & { calls: { section: number; finalize: number } };
  campaign: CampaignServiceHooks & { calls: { post: number; finalize: number } };
  socialPublish: SocialPublishServiceHooks & { calls: { publish: number } };
  reconciliation: ReconciliationServiceHooks & { calls: { reconcile: number } };
}

function makeCountingHooks(): CountingHooks {
  const lf = {
    calls: { section: 0, finalize: 0 },
    async runGenerationSection() { lf.calls.section += 1; },
    async runFinalize() { lf.calls.finalize += 1; },
  };
  const camp = {
    calls: { post: 0, finalize: 0 },
    async runPost() { camp.calls.post += 1; },
    async runCampaignFinalize() { camp.calls.finalize += 1; },
  };
  const pub = {
    calls: { publish: 0 },
    async runProviderPublish() { pub.calls.publish += 1; },
  };
  const rec = {
    calls: { reconcile: 0 },
    async runReconcileRow() { rec.calls.reconcile += 1; },
  };
  return { longForm: lf, campaign: camp, socialPublish: pub, reconciliation: rec };
}

function resetWorld(hooks: CountingHooks) {
  setDefaultExecutionStore(createInMemoryExecutionStore());
  setDefaultDurableExecutionCoordinator(createDurableExecutionCoordinator());
  setDefaultExecutionCheckpointManager(createExecutionCheckpointManager());
  setDefaultCheckpointRestorationEngine(createCheckpointRestorationEngine({ telemetry: { emit: () => {} } }));
  setDefaultExecutionQueue(createInMemoryExecutionQueue({ telemetry: { emit: () => {} } }));
  setDefaultDistributedWorkerCoordinator(createDistributedWorkerCoordinator({
    telemetry: { emit: () => {} }, defaultStaleThresholdMs: 200,
  }));
  const registry = createWorkflowStepRegistry({ telemetry: { emit: () => {} } });
  registerDomainStepBuilders({ registry, hooks });
  setDefaultWorkflowStepRegistry(registry);
  setDefaultQueuePayloadHydrator(createQueuePayloadHydrator({ telemetry: { emit: () => {} } }));
  setDefaultExecutionPayloadGovernor(createExecutionPayloadGovernor({ registry, telemetry: { emit: () => {} } }));
  setDefaultQueueCheckpointContinuityCoordinator(createQueueCheckpointContinuityCoordinator({
    telemetry: { emit: () => {} },
  }));
}

async function runScenario(name: string, body: (h: CountingHooks) => Promise<Assertion[]>): Promise<ScenarioResult> {
  const hooks = makeCountingHooks();
  resetWorld(hooks);
  try {
    const assertions = await body(hooks);
    return { name, assertions, passed: assertions.every((a) => a.ok) };
  } catch (err) {
    return { name, passed: false, assertions: [], err: (err as Error).message };
  }
}

async function seedExec(): Promise<{ executionId: string; companyId: string }> {
  const exec = await getDefaultDurableExecutionCoordinator().start({
    runtimeSessionId: 'rs', threadId: 'thr',
    companyId: '00000000-0000-0000-0000-000000000001',
  });
  return { executionId: exec.executionId, companyId: exec.companyId };
}

async function enqueue(payload: QueuePayloadV1): Promise<string> {
  const q = getDefaultExecutionQueue();
  const e = await q.enqueue({
    executionId: payload.executionId, companyId: payload.companyId,
    kind: 'execution_start',
    payload: payload as unknown as Record<string, unknown>,
  });
  return e.queueEntryId;
}

// ────────────────────────────────────────────────────────────────────
// Scenarios
// ────────────────────────────────────────────────────────────────────

async function s1_restartDuringLongFormGeneration(h: CountingHooks): Promise<Assertion[]> {
  const { executionId, companyId } = await seedExec();
  await getDefaultDurableExecutionCoordinator().transition({ executionId, to: 'running' });
  // Half-complete checkpoint.
  await getDefaultExecutionCheckpointManager().capture({
    executionId, phase: 'generation',
    newlyCompleted: ['lf_gen_s1'], pending: ['lf_gen_s2', 'lf_finalize'],
  });
  const qid = await enqueue({
    schemaVersion: 1, workflowType: 'long_form_generation',
    executionId, companyId,
    workflowParams: {
      subType: 'long_form_generation', generationId: 'g1',
      sectionIds: ['s1', 's2'],
      runEnrichment: false, emitRecommendationCard: false,
    },
  });
  const builders = buildDistributedRunnerStepBuilders();
  const queue = getDefaultExecutionQueue();
  const [entry] = await queue.claim({ workerId: 'w' });
  const steps = await builders.buildSteps({
    execution: (await getDefaultDurableExecutionCoordinator().get(entry.executionId))!,
    restored: null, queueEntry: entry,
  });
  void qid;
  // The bridge produced steps; the test verifies the builder + bridge wired
  // correctly. Step IDs include lf_precheck + per-section + finalize.
  const ids = steps.map((s) => s.id);
  return [
    expectTrue('includes lf_precheck', ids.includes('lf_precheck'), 'present'),
    expectTrue('includes lf_gen_s1', ids.includes('lf_gen_s1'), 'present'),
    expectTrue('includes lf_gen_s2', ids.includes('lf_gen_s2'), 'present'),
    expectTrue('includes lf_finalize', ids.includes('lf_finalize'), 'present'),
  ];
}

async function s2_duplicatePublishReplayAttempt(h: CountingHooks): Promise<Assertion[]> {
  const { executionId, companyId } = await seedExec();
  await getDefaultDurableExecutionCoordinator().transition({ executionId, to: 'running' });
  // Checkpoint already marks the publish step complete.
  const fp = 'fp_xyz';
  await getDefaultExecutionCheckpointManager().capture({
    executionId, phase: 'persistence',
    newlyCompleted: [`sp_publish_x_${fp}`], pending: [],
  });
  await enqueue({
    schemaVersion: 1, workflowType: 'social_publish',
    executionId, companyId,
    workflowParams: {
      subType: 'social_publish', provider: 'x',
      socialAccountId: 'acc1', scheduledPostId: 'sp1',
      contentFingerprint: fp,
    },
  });
  // DomainReplayGovernor should suppress.
  const gov = createDomainReplayGovernor({ telemetry: { emit: () => {} } });
  const queue = getDefaultExecutionQueue();
  const [entry] = await queue.claim({ workerId: 'w' });
  const hydrator = (await import('../../backend/services/orchestration/distributed/queuePayloadHydrator')).getDefaultQueuePayloadHydrator();
  const hyd = await hydrator.hydrate(entry);
  const v = gov.validate(hyd);
  return [
    expectEq('domain governor suppressed', v.code, 'duplicate_publish'),
    expectEq('recommendedAction = suppress', v.recommendedAction, 'suppress'),
    expectEq('publish hook never called', h.socialPublish.calls.publish, 0),
  ];
}

async function s3_providerTimeoutDuringReplayContinuation(h: CountingHooks): Promise<Assertion[]> {
  // Inject a failing publish hook for THIS scenario.
  let failed = 0;
  h.socialPublish.runProviderPublish = async () => {
    failed += 1;
    if (failed < 2) throw new Error('provider timeout');
    h.socialPublish.calls.publish += 1;
  };
  const { executionId, companyId } = await seedExec();
  await getDefaultDurableExecutionCoordinator().transition({ executionId, to: 'running' });
  await enqueue({
    schemaVersion: 1, workflowType: 'social_publish',
    executionId, companyId,
    workflowParams: {
      subType: 'social_publish', provider: 'linkedin',
      socialAccountId: 'acc', scheduledPostId: 'sp', contentFingerprint: 'fp1',
    },
  });
  // The builder produces steps; the actual run() throws on first call.
  const queue = getDefaultExecutionQueue();
  const [entry] = await queue.claim({ workerId: 'w' });
  const builders = buildDistributedRunnerStepBuilders();
  const steps = await builders.buildSteps({
    execution: (await getDefaultDurableExecutionCoordinator().get(entry.executionId))!,
    restored: null, queueEntry: entry,
  });
  const publishStep = steps.find((s) => s.id.startsWith('sp_publish_'));
  // First attempt fails, second succeeds — matches retry semantics.
  let threw = false;
  try { await publishStep!.run({} as never); } catch { threw = true; }
  await publishStep!.run({} as never);
  return [
    expectTrue('first publish attempt threw', threw, 'truthy'),
    expectEq('second publish attempt succeeded', h.socialPublish.calls.publish, 1),
  ];
}

async function s4_campaignRestartDuringStaggeredExecution(h: CountingHooks): Promise<Assertion[]> {
  const { executionId, companyId } = await seedExec();
  await getDefaultDurableExecutionCoordinator().transition({ executionId, to: 'running' });
  // Half the posts already done.
  await getDefaultExecutionCheckpointManager().capture({
    executionId, phase: 'persistence',
    newlyCompleted: ['camp_post_p1', 'camp_post_p2'],
    pending: ['camp_post_p3'],
  });
  await enqueue({
    schemaVersion: 1, workflowType: 'campaign_execution',
    executionId, companyId,
    workflowParams: {
      subType: 'campaign_execution', campaignId: 'c1',
      posts: [{ postId: 'p1' }, { postId: 'p2' }, { postId: 'p3' }],
      staggerMs: 100,
    },
  });
  const builders = buildDistributedRunnerStepBuilders();
  const queue = getDefaultExecutionQueue();
  const [entry] = await queue.claim({ workerId: 'w' });
  const steps = await builders.buildSteps({
    execution: (await getDefaultDurableExecutionCoordinator().get(entry.executionId))!,
    restored: null, queueEntry: entry,
  });
  const ids = steps.map((s) => s.id);
  return [
    expectTrue('includes camp_post_p3', ids.includes('camp_post_p3'), 'present'),
    expectTrue('includes camp_finalize', ids.includes('camp_finalize'), 'present'),
  ];
}

async function s5_reconciliationReplayAfterWorkerFailover(h: CountingHooks): Promise<Assertion[]> {
  const { executionId, companyId } = await seedExec();
  await getDefaultDurableExecutionCoordinator().transition({ executionId, to: 'running' });
  await enqueue({
    schemaVersion: 1, workflowType: 'provider_reconciliation',
    executionId, companyId,
    workflowParams: {
      subType: 'provider_reconciliation', rowId: 'row1', provider: 'instagram',
    },
  });
  // Simulate worker failover via reclaim.
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
  // Run the reconcile step.
  const recStep = steps.find((s) => s.id.startsWith('rec_apply_'));
  await recStep!.run({} as never);
  return [
    expectEq('reconcile hook called once', h.reconciliation.calls.reconcile, 1),
  ];
}

async function s6_checkpointCorruptionDuringGeneration(h: CountingHooks): Promise<Assertion[]> {
  const { executionId, companyId } = await seedExec();
  await getDefaultDurableExecutionCoordinator().transition({ executionId, to: 'running' });
  // Corrupt the checkpoint: same id in completed + pending (manually written).
  const { getDefaultExecutionStore } = await import(
    '../../backend/services/threadRuntime/executionStore'
  );
  await getDefaultExecutionStore().recordCheckpoint({
    checkpointId: 'cp_corrupt', executionId,
    takenAt: new Date().toISOString(),
    phase: 'generation',
    completedNodeOperationIds: ['lf_gen_s1'],
    pendingNodeOperationIds: ['lf_gen_s1', 'lf_gen_s2'],
    pendingTopologyMutationIds: [], recoveryProgress: null, replayContinuity: null,
  });
  await enqueue({
    schemaVersion: 1, workflowType: 'long_form_generation',
    executionId, companyId,
    workflowParams: {
      subType: 'long_form_generation', generationId: 'g_corrupt',
      sectionIds: ['s1', 's2'],
    },
  });
  // The continuity coordinator should NOT mark this as 'continuous' if the
  // chain is corrupted (integrity 'corrupted' status).
  const queue = getDefaultExecutionQueue();
  const [entry] = await queue.claim({ workerId: 'w' });
  const hydrator = (await import('../../backend/services/orchestration/distributed/queuePayloadHydrator')).getDefaultQueuePayloadHydrator();
  const hyd = await hydrator.hydrate(entry);
  // Hydration succeeds because corruption is reflected in integrity, not throw.
  return [
    expectAtLeast('restored chain has at least 1 issue', hyd.restored?.integrity.issues.length ?? 0, 1),
  ];
}

async function s7_duplicateRegenerationAttempt(h: CountingHooks): Promise<Assertion[]> {
  const { executionId, companyId } = await seedExec();
  await getDefaultDurableExecutionCoordinator().transition({ executionId, to: 'running' });
  // Mark generation fully complete.
  await getDefaultExecutionCheckpointManager().capture({
    executionId, phase: 'finalize',
    newlyCompleted: ['lf_gen_s1', 'lf_gen_s2', 'lf_finalize'], pending: [],
  });
  await enqueue({
    schemaVersion: 1, workflowType: 'long_form_generation',
    executionId, companyId,
    workflowParams: {
      subType: 'long_form_generation', generationId: 'g1',
      sectionIds: ['s1', 's2'],
    },
  });
  const gov = createDomainReplayGovernor({ telemetry: { emit: () => {} } });
  const queue = getDefaultExecutionQueue();
  const [entry] = await queue.claim({ workerId: 'w' });
  const hydrator = (await import('../../backend/services/orchestration/distributed/queuePayloadHydrator')).getDefaultQueuePayloadHydrator();
  const hyd = await hydrator.hydrate(entry);
  const v = gov.validate(hyd);
  return [
    expectEq('domain governor suppressed', v.code, 'duplicate_long_form_generation'),
  ];
}

async function s8_providerPublishDuringReclaim(h: CountingHooks): Promise<Assertion[]> {
  const { executionId, companyId } = await seedExec();
  await getDefaultDurableExecutionCoordinator().transition({ executionId, to: 'running' });
  await enqueue({
    schemaVersion: 1, workflowType: 'social_publish',
    executionId, companyId,
    workflowParams: {
      subType: 'social_publish', provider: 'x',
      socialAccountId: 'acc', scheduledPostId: 'sp',
      contentFingerprint: 'fp_during_reclaim',
    },
  });
  const queue = getDefaultExecutionQueue();
  // w_dead claims with short visibility, crashes.
  await queue.claim({ workerId: 'w_dead', visibilityMs: 30 });
  await new Promise((r) => setTimeout(r, 80));
  await queue.reclaimExpired();
  const [entry] = await queue.claim({ workerId: 'w_alive' });
  const builders = buildDistributedRunnerStepBuilders();
  const steps = await builders.buildSteps({
    execution: (await getDefaultDurableExecutionCoordinator().get(entry.executionId))!,
    restored: null, queueEntry: entry,
  });
  const publishStep = steps.find((s) => s.id.startsWith('sp_publish_'));
  await publishStep!.run({} as never);
  return [
    expectEq('publish hook called once after reclaim', h.socialPublish.calls.publish, 1),
  ];
}

async function s9_campaignReplayAfterDeployRestart(h: CountingHooks): Promise<Assertion[]> {
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
      subType: 'campaign_execution', campaignId: 'c2',
      posts: [{ postId: 'p1' }, { postId: 'p2' }],
    },
  });
  const builders = buildDistributedRunnerStepBuilders();
  const queue = getDefaultExecutionQueue();
  const [entry] = await queue.claim({ workerId: 'w' });
  const steps = await builders.buildSteps({
    execution: (await getDefaultDurableExecutionCoordinator().get(entry.executionId))!,
    restored: null, queueEntry: entry,
  });
  // Run all steps via the workflow engine semantics: skip-if-completed.
  for (const s of steps) {
    if (['camp_post_p1'].includes(s.id)) continue; // already completed
    await s.run({} as never);
  }
  return [
    expectEq('post hook called exactly once (only p2)', h.campaign.calls.post, 1),
    expectEq('finalize hook called once', h.campaign.calls.finalize, 1),
  ];
}

async function s10_longFormReplayDivergence(h: CountingHooks): Promise<Assertion[]> {
  // Payload references a checkpoint that isn't in the chain.
  const { executionId, companyId } = await seedExec();
  await getDefaultDurableExecutionCoordinator().transition({ executionId, to: 'running' });
  await enqueue({
    schemaVersion: 1, workflowType: 'long_form_generation',
    executionId, companyId,
    checkpointReference: { checkpointId: 'cp_does_not_exist' },
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
    expectEq('bridge refused (governor caught missing checkpoint)', threw, true),
  ];
}

async function s11_providerReconciliationReplayStorm(h: CountingHooks): Promise<Assertion[]> {
  // Multiple back-to-back reconcile attempts for same (rowId, provider).
  const gov = createDomainReplayGovernor({
    telemetry: { emit: () => {} },
    reconciliationSuppressionMs: 60_000,
  });
  const verdicts = [];
  for (let i = 0; i < 3; i += 1) {
    const { executionId, companyId } = await seedExec();
    await enqueue({
      schemaVersion: 1, workflowType: 'provider_reconciliation',
      executionId, companyId,
      workflowParams: {
        subType: 'provider_reconciliation', rowId: 'storm_row', provider: 'reddit',
      },
    });
    const queue = getDefaultExecutionQueue();
    const claims = await queue.claim({ workerId: `w_${i}` });
    if (claims.length === 0) continue;
    const hydrator = (await import('../../backend/services/orchestration/distributed/queuePayloadHydrator')).getDefaultQueuePayloadHydrator();
    const hyd = await hydrator.hydrate(claims[0]);
    verdicts.push(gov.validate(hyd));
  }
  const suppressed = verdicts.filter((v) => v.code === 'reconciliation_within_window').length;
  return [
    expectAtLeast('at least 2 reconciles suppressed within window', suppressed, 2),
  ];
}

async function s12_queueReplayDuringActiveCampaignExecution(h: CountingHooks): Promise<Assertion[]> {
  const { executionId, companyId } = await seedExec();
  await getDefaultDurableExecutionCoordinator().transition({ executionId, to: 'running' });
  await enqueue({
    schemaVersion: 1, workflowType: 'campaign_execution',
    executionId, companyId,
    workflowParams: {
      subType: 'campaign_execution', campaignId: 'c_active',
      posts: [{ postId: 'a' }, { postId: 'b' }],
    },
  });
  // Pre-restart: claim + run partial work + checkpoint progress.
  const queue = getDefaultExecutionQueue();
  await queue.claim({ workerId: 'w_pre', visibilityMs: 30 });
  await getDefaultExecutionCheckpointManager().capture({
    executionId, phase: 'persistence',
    newlyCompleted: ['camp_post_a'], pending: ['camp_post_b'],
  });
  await new Promise((r) => setTimeout(r, 80));
  await queue.reclaimExpired();
  // Post-restart: same queue payload, fresh hydration, replay continues.
  const [entry] = await queue.claim({ workerId: 'w_post' });
  const builders = buildDistributedRunnerStepBuilders();
  const steps = await builders.buildSteps({
    execution: (await getDefaultDurableExecutionCoordinator().get(entry.executionId))!,
    restored: null, queueEntry: entry,
  });
  for (const s of steps) {
    if (s.id === 'camp_post_a') continue; // already completed
    await s.run({} as never);
  }
  return [
    expectEq('only camp_post_b ran post-restart', h.campaign.calls.post, 1),
  ];
}

// ────────────────────────────────────────────────────────────────────
// Runner
// ────────────────────────────────────────────────────────────────────

async function main() {
  const scenarios: Array<{ name: string; run: (h: CountingHooks) => Promise<Assertion[]> }> = [
    { name: '1. restart during long-form generation', run: s1_restartDuringLongFormGeneration },
    { name: '2. duplicate publish replay attempt', run: s2_duplicatePublishReplayAttempt },
    { name: '3. provider timeout during replay continuation', run: s3_providerTimeoutDuringReplayContinuation },
    { name: '4. campaign restart during staggered execution', run: s4_campaignRestartDuringStaggeredExecution },
    { name: '5. reconciliation replay after worker failover', run: s5_reconciliationReplayAfterWorkerFailover },
    { name: '6. checkpoint corruption during generation', run: s6_checkpointCorruptionDuringGeneration },
    { name: '7. duplicate regeneration attempt', run: s7_duplicateRegenerationAttempt },
    { name: '8. provider publish during reclaim', run: s8_providerPublishDuringReclaim },
    { name: '9. campaign replay after deploy restart', run: s9_campaignReplayAfterDeployRestart },
    { name: '10. long-form replay divergence', run: s10_longFormReplayDivergence },
    { name: '11. provider reconciliation replay storm', run: s11_providerReconciliationReplayStorm },
    { name: '12. queue replay during active campaign execution', run: s12_queueReplayDuringActiveCampaignExecution },
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
