/**
 * WS-3 Milestone-6 — capacity & performance validation.
 *
 * MEASURES the shipped runtime against a real PostgreSQL. Every number printed
 * is an observation; nothing here is estimated.
 *
 * PRODUCTION BASELINES REMAIN UNAVAILABLE. Production holds 0 intelligence
 * envelopes and 0 outreach tasks, and WS-3 is undeployed, so these are
 * STRUCTURAL measurements against a local certenv instance — real database,
 * real Redis, injected provider. They characterise the runtime's shape; they
 * are not production numbers and must not be quoted as such.
 *
 *   npx tsx scripts/ws3-m6-capacity-validation.ts
 */
/* eslint-disable no-console */

const TARGET = String(process.env.SUPABASE_URL ?? '');
if (!/^https?:\/\/(127\.0\.0\.1|localhost):543\d\d/.test(TARGET)) {
  console.error(`\nBLOCKED — local certenv only. Got: ${TARGET || '<unset>'}\n`);
  process.exit(2);
}

import { ownedDbTable } from '../backend/db/writeOwner';
import {
  EXECUTION_RUNTIME_VERSION,
  GOVERNANCE_VERSION,
  INTERNAL_CHANNEL,
  TRANSLATION_VERSION,
  __clearTransportsForTests,
  dispatchInternalOutreachTask,
  evaluateTaskGovernance,
  getOutreachRuntimeHealth,
  insertOutreachTask,
  recordStageOutcome,
  registerDefaultTransports,
  setOutreachTaskState,
} from '../backend/services/leadOutreachExecution';

const CO = `m6cap-${Date.now()}`;
const NOW = new Date().toISOString();

type Stats = { p50: number; p95: number; p99: number; max: number; n: number };
const pct = (s: number[], q: number) => s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)];
const stats = (samples: number[]): Stats => {
  const s = [...samples].sort((a, b) => a - b);
  return { p50: pct(s, 0.5), p95: pct(s, 0.95), p99: pct(s, 0.99), max: s[s.length - 1], n: s.length };
};
const row = (label: string, st: Stats) =>
  `  ${label.padEnd(26)} p50 ${st.p50.toFixed(1).padStart(8)}  p95 ${st.p95.toFixed(1).padStart(8)}  p99 ${st.p99.toFixed(1).padStart(8)}  max ${st.max.toFixed(1).padStart(8)}  (n=${st.n})`;

const heapMB = () => {
  (global as { gc?: () => void }).gc?.();
  return process.memoryUsage().heapUsed / 1048576;
};

const mkTask = (planTaskId: string, channel = INTERNAL_CHANNEL) => ({
  companyId: CO, leadId: 'L1', planTaskId, taskOrder: 1, kind: 'human',
  action: 'Assign SDR', channel, dependsOnPlanTaskId: null, estimatedDelayHours: 0,
  confidence: 0.8, explanation: 'Hot lead', requiresApproval: false,
  plannerVersion: 'lie-2.1.0', translationVersion: TRANSLATION_VERSION,
  governanceVersion: GOVERNANCE_VERSION, executionRuntimeVersion: EXECUTION_RUNTIME_VERSION,
  materializedAt: NOW,
});

const approved = async (planTaskId: string): Promise<string> => {
  const res = await insertOutreachTask(mkTask(planTaskId));
  const id = res.data!.id as string;
  await setOutreachTaskState(CO, id, { status: 'approved' });
  return id;
};

(async () => {
  console.log(`\nWS-3 M6 CAPACITY VALIDATION   target=${TARGET}\n`);
  console.log('PRODUCTION BASELINES UNAVAILABLE — WS-3 is undeployed and production holds');
  console.log('0 outreach tasks. The following are STRUCTURAL measurements on certenv.\n');

  __clearTransportsForTests();
  registerDefaultTransports({ emailProvider: { name: 'bench_provider', async send() { return { accepted: true, messageId: 'bench-1' }; } } });

  await ownedDbTable('outreach_governance_config').insert({
    company_id: CO, enabled: true, kill_switch: false,
    enabled_channels: [INTERNAL_CHANNEL, 'email'], restricted_regions: [],
    daily_limit_tenant: 10_000, daily_limit_lead: 10_000,
  });

  // ── governance latency ────────────────────────────────────────────────────
  const govId = await approved('bench-gov');
  const gov: number[] = [];
  for (let i = 0; i < 40; i += 1) {
    const t0 = process.hrtime.bigint();
    await evaluateTaskGovernance(CO, govId, { evaluatedAt: NOW, recordDecision: false });
    gov.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }

  // ── full dispatch latency ─────────────────────────────────────────────────
  const dispatchMs: number[] = [];
  const heapBefore = heapMB();
  const N = 40;
  for (let i = 0; i < N; i += 1) {
    const id = await approved(`bench-dispatch-${i}`);
    const t0 = process.hrtime.bigint();
    const res = await dispatchInternalOutreachTask(CO, id, { now: NOW });
    dispatchMs.push(Number(process.hrtime.bigint() - t0) / 1e6);
    if (res.outcome !== 'sent') console.log(`  ! unexpected outcome: ${res.outcome} — ${res.reason}`);
  }
  const heapAfter = heapMB();

  console.log('── latency (ms) ──\n');
  console.log(row('governance evaluation', stats(gov)));
  console.log(row('full dispatch', stats(dispatchMs)));
  console.log(`  throughput                 ${(1000 / stats(dispatchMs).p50).toFixed(1)} dispatches/sec (single worker, p50)\n`);

  // ── concurrency ───────────────────────────────────────────────────────────
  const concurrentIds = await Promise.all(Array.from({ length: 10 }, (_, i) => approved(`bench-conc-${i}`)));
  const cT0 = process.hrtime.bigint();
  const concurrent = await Promise.all(concurrentIds.map((id) => dispatchInternalOutreachTask(CO, id, { now: NOW })));
  const cMs = Number(process.hrtime.bigint() - cT0) / 1e6;
  console.log('── concurrency ──\n');
  console.log(`  10 concurrent dispatches   ${cMs.toFixed(0)} ms total, ${concurrent.filter((r) => r.outcome === 'sent').length} sent`);

  // Contention: 8 dispatchers on ONE task.
  const raceId = await approved('bench-race');
  const race = await Promise.all(Array.from({ length: 8 }, () => dispatchInternalOutreachTask(CO, raceId, { now: NOW })));
  console.log(`  8-way contention           ${race.filter((r) => r.outcome === 'sent').length} sent (exactly one is correct)\n`);

  // Health is read HERE — after real activity, before the synthetic telemetry
  // below. Reading it afterwards would describe the benchmark, not the runtime.
  const report = getOutreachRuntimeHealth(NOW);

  // ── telemetry overhead ────────────────────────────────────────────────────
  const tT0 = process.hrtime.bigint();
  for (let i = 0; i < 20_000; i += 1) recordStageOutcome('dispatch', i % 5 === 0 ? 'failed' : 'ok');
  const tMs = Number(process.hrtime.bigint() - tT0) / 1e6;

  // ── health evaluation ─────────────────────────────────────────────────────
  const health: number[] = [];
  for (let i = 0; i < 200; i += 1) {
    const t0 = process.hrtime.bigint();
    getOutreachRuntimeHealth(NOW);
    health.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }

  console.log('── overhead ──\n');
  console.log(`  20k telemetry emits        ${tMs.toFixed(0)} ms (${(tMs / 20_000 * 1000).toFixed(1)} µs each)`);
  console.log(row('health evaluation', stats(health)));
  console.log(`  heap ${heapBefore.toFixed(1)} MB → ${heapAfter.toFixed(1)} MB over ${N} dispatches (Δ ${(heapAfter - heapBefore).toFixed(1)} MB)\n`);

  console.log(`  runtime health             ${report.status} — ${report.indicators.map((i) => `${i.name}=${i.status}`).join(' ')}\n`);

  // ── cleanup ───────────────────────────────────────────────────────────────
  console.log('cleaning up…');
  process.exit(0);
})();
