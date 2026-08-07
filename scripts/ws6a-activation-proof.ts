/**
 * WS-6A — first governed execution THROUGH THE ACTIVATION CALLER.
 *
 * The WS-3 M8 harness already proves the runtime works when driven directly.
 * This proves something different and new: that the production caller reaches
 * it, in the documented order, with every gate intact.
 *
 * Local certification environment ONLY — asserted before anything runs.
 * Internal channel only: nothing here can contact a person.
 */
/* eslint-disable no-console */

import { assertCertenv } from './ws3-m8/harness';

assertCertenv();

const NOW = '2026-08-07T09:00:00.000Z';
let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  [${detail}]` : ''}`);
  ok ? pass++ : fail++;
}
function section(t: string): void {
  console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 68 - t.length))}`);
}

async function main(): Promise<void> {
  const activation = await import('../backend/services/leadOutreachActivation');
  const runtime = await import('../backend/services/leadOutreachExecution');
  const { realPlan, configureTenant } = await import('./ws3-m8/harness');
  const { durableIntelligencePersistence } = await import(
    '../backend/services/leadIntelligenceOrchestration/persistence'
  );
  const { ENGINE_VERSION, INTELLIGENCE_SCHEMA_VERSION } = await import(
    '../backend/services/leadIntelligenceOrchestration/engineVersion'
  );

  const companyId = `ws6a-${Date.now().toString(36)}`;
  const leadId = 'L-ws6a-1';

  console.log(`\n${'='.repeat(74)}`);
  console.log('  WS-6A — FIRST GOVERNED EXECUTION THROUGH THE ACTIVATION CALLER');
  console.log(`  tenant ${companyId}   lead ${leadId}   node ${process.version}`);
  console.log(`${'='.repeat(74)}`);

  // ── STAGE 0 — a real WS-2 plan, persisted the way production persists it ──
  section('STAGE 0 — persisted plan (the caller reads, never regenerates)');
  const plan = await realPlan(companyId, leadId, NOW);
  const planTasks = (plan as { tasks?: unknown[] })?.tasks ?? [];
  check('WS-2 produced a real automation plan', planTasks.length > 0, `${planTasks.length} planned task(s)`);

  // The record field is `intelligence`; `toRow` maps it to payload.summary, and
  // the reader only surfaces automationPlanning when that key is present
  // (persistence.ts:32-39, :69-72). Using `summary` here writes an envelope the
  // reader correctly treats as schema-1 and reports as having no plan.
  const write = await durableIntelligencePersistence.upsert({
    companyId,
    leadId,
    intelligence: { leadId } as never,
    qualificationPlanning: null as never,
    automationPlanning: plan as never,
    diagnostics: {
      durationMs: 0,
      engineVersion: ENGINE_VERSION,
      enginesExecuted: ['ws6a-fixture'],
      warnings: [],
      missingEnrichment: [],
      confidenceBreakdown: { overall: 0.8, persona: 0.8, intentBand: 'high', qualificationBand: 'hot' },
      inputCounts: { events: 5, sessions: 1, touchpoints: 0 },
    } as never,
    engineVersion: ENGINE_VERSION,
    generationVersion: 1,
    schemaVersion: INTELLIGENCE_SCHEMA_VERSION,
    inputFingerprint: `ws6a-${companyId}`,
    generatedAt: NOW,
    rebuildRequestedAt: null,
  } as never);
  check('envelope persisted for the caller to read', (write as { ok?: boolean })?.ok !== false, JSON.stringify(write).slice(0, 80));

  // ── STAGE 1 — activation BEFORE the tenant is enabled ────────────────────
  section('STAGE 1 — activation before tenant enablement (must not dispatch)');
  const cold = await activation.runOutreachActivation(companyId, leadId, { now: NOW });
  check('the caller reached the runtime and read the plan', cold.planPresent === true, `plannerVersion=${cold.plannerVersion}`);
  check('materialisation created durable tasks',
    (cold.materialization?.created ?? 0) > 0,
    `created=${cold.materialization?.created} dup=${cold.materialization?.duplicates} skipped=${cold.materialization?.skipped} failed=${cold.materialization?.failed}`);
  check('transports were registered by the caller', cold.registeredChannels.length > 0, cold.registeredChannels.join(','));
  check('the caller permits the internal channel only', cold.permittedChannels.join(',') === 'internal', cold.permittedChannels.join(','));
  check('NOTHING dispatched — new tasks are pending, approval is a human gate',
    cold.dispatched === 0, `${cold.tasks.filter((t) => t.action === 'not_approved').length} awaiting approval`);

  // ── STAGE 2 — idempotency of the caller ──────────────────────────────────
  section('STAGE 2 — re-running the caller is idempotent');
  const again = await activation.runOutreachActivation(companyId, leadId, { now: NOW });
  check('a second run creates nothing new', (again.materialization?.created ?? -1) === 0,
    `created=${again.materialization?.created} duplicates=${again.materialization?.duplicates}`);
  check('duplicates are reported as duplicates, not failures', (again.materialization?.failed ?? -1) === 0,
    `failed=${again.materialization?.failed}`);

  // ── STAGE 3 — approval, then dispatch still blocked (tenant not enabled) ──
  section('STAGE 3 — approval via the documented path');
  const tasks = await runtime.listOutreachTasksForLead(companyId, leadId);
  const internalTask = tasks.find((t) => t.channel === 'internal');
  check('the plan produced an internal task', !!internalTask, internalTask ? String(internalTask.id) : 'none');
  if (!internalTask?.id) { summarise(); return; }
  const taskId = String(internalTask.id);

  const approved = await activation.approveOutreachTaskForOperator(
    companyId, taskId, 'u-ws6a', 'WS-6A first governed execution', 'internal channel',
  );
  check('submit → approve moved the task to approved', approved.ok && approved.status === 'approved',
    `${approved.status ?? ''} ${approved.reason ?? ''}`);

  const beforeEnable = await activation.dispatchApprovedOutreachForLead(companyId, leadId, { now: NOW });
  const blockedRep = beforeEnable.find((t) => t.taskId === taskId);
  check('an approved task on an UNCONFIGURED tenant does not dispatch',
    blockedRep?.outcome !== 'sent',
    `outcome=${blockedRep?.outcome} governance=${blockedRep?.governance}`);

  // ── STAGE 4 — the ONE documented enablement step ─────────────────────────
  section('STAGE 4 — tenant enablement is the single switch');
  await configureTenant(companyId, { enabledChannels: ['internal'] });
  const hot = await activation.dispatchApprovedOutreachForLead(companyId, leadId, { now: NOW });
  const sentRep = hot.find((t) => t.taskId === taskId);
  check('after enablement the SAME task dispatches', sentRep?.action === 'dispatched' && sentRep?.outcome === 'sent',
    `${sentRep?.outcome} — ${sentRep?.reason ?? ''}`);
  check('governance allowed before the transport ran', sentRep?.governance === 'allowed', String(sentRep?.governance));

  // ── STAGE 5 — durable evidence of the execution ──────────────────────────
  section('STAGE 5 — durable evidence (queue → dispatch → transport → evidence)');
  const finalTask = await runtime.getOutreachTaskById(companyId, taskId);
  check('the task reached a sent state', String(finalTask?.status) === 'sent', String(finalTask?.status));

  const attempts = await runtime.listAttempts(companyId, taskId);
  check('exactly one attempt was recorded', attempts.length === 1, `${attempts.length}`);
  check('the attempt carries an idempotency key and runtime version',
    !!attempts[0]?.idempotency_key && !!attempts[0]?.execution_runtime_version,
    `${String(attempts[0]?.execution_runtime_version)}`);

  const workItems = await runtime.listInternalWorkItems(companyId, taskId);
  check('an internal work item exists — the thing a human acts on', workItems.length === 1, `${workItems.length}`);

  const evidence = await runtime.listDeliveryEvidence(companyId, taskId);
  check('delivery evidence was written', evidence.length >= 1, `${evidence.length} row(s)`);

  // ── STAGE 6 — double-send protection through the caller ──────────────────
  section('STAGE 6 — the caller cannot double-send');
  const replay = await activation.dispatchApprovedOutreachForLead(companyId, leadId, { now: NOW });
  const replayRep = replay.find((t) => t.taskId === taskId);
  check('a replay does not send again', replayRep?.outcome !== 'sent', `action=${replayRep?.action} outcome=${replayRep?.outcome ?? '-'}`);
  const attemptsAfter = await runtime.listAttempts(companyId, taskId);
  check('still exactly one attempt after the replay', attemptsAfter.length === 1, `${attemptsAfter.length}`);

  // ── STAGE 7 — feedback capture and the envelope ──────────────────────────
  section('STAGE 7 — outcome recording and feedback capture');
  const fb = await runtime.ingestFeedback({
    companyId, taskId, signal: 'delivered', occurredAt: '2026-08-07T09:05:00.000Z',
    source: 'internal', provider: null, providerEventId: 'ws6a-1',
  } as never);
  check('feedback ingested', (fb as { ok?: boolean })?.ok === true, JSON.stringify(fb).slice(0, 90));
  const dupFb = await runtime.ingestFeedback({
    companyId, taskId, signal: 'delivered', occurredAt: '2026-08-07T09:05:00.000Z',
    source: 'internal', provider: null, providerEventId: 'ws6a-1',
  } as never);
  check('a redelivered provider event is a duplicate SUCCESS, not an error',
    (dupFb as { ok?: boolean; duplicate?: boolean })?.duplicate === true, JSON.stringify(dupFb).slice(0, 90));

  const envelope = runtime.buildFeedbackEnvelope({
    companyId, leadId, tasks: await runtime.listOutreachTasksForLead(companyId, leadId),
    now: '2026-08-07T09:10:00.000Z',
  } as never);
  check('a feedback envelope builds from real outcomes', !!envelope, `schema v${(envelope as { schemaVersion?: number })?.schemaVersion}`);

  // ── STAGE 8 — health reflects work that actually happened ────────────────
  section('STAGE 8 — runtime health after real work');
  const health = await runtime.getOutreachRuntimeHealth();
  check('health reports indicators', (health.indicators?.length ?? 0) > 0, `${health.indicators?.length} indicators`);
  const dispatchInd = health.indicators?.find((i) => i.name === 'dispatch');
  check('the dispatch indicator is no longer cold', dispatchInd?.status !== 'unknown', String(dispatchInd?.status));

  summarise();
}

function summarise(): void {
  console.log(`\n${'='.repeat(74)}`);
  console.log(`  ${pass} passed, ${fail} failed`);
  console.log(`${'='.repeat(74)}\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('\nFATAL:', e instanceof Error ? e.stack : e);
  process.exit(1);
});
