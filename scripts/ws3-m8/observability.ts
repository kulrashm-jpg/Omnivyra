/**
 * WS-3 M8 — observability, health, operations and performance proof.
 *
 * The registry is the REAL HARDEN-001 registry, and every counter read here was
 * emitted by the runtime doing actual work earlier in the same process. Nothing
 * is recorded by this file for the sake of being observed — the one exception
 * is the synthetic-failure section, which is labelled as such because a runtime
 * that has not failed cannot demonstrate what its failure telemetry looks like.
 */
/* eslint-disable no-console */

import {
  FAILURE_CLASSES,
  OUTREACH_METRICS,
  RUNTIME_STAGES,
  approveOutreachTask,
  buildFeedbackEnvelope,
  dispatchInternalOutreachTask,
  getOutreachRuntimeHealth,
  ingestFeedback,
  listOutreachTasksForLead,
  materializeAutomationPlan,
  readTaskFeedback,
  recordFailure,
  recordStageOutcome,
  submitForApproval,
  translateAutomationPlan,
  evaluateTaskGovernance,
  LEAD_OUTREACH_DISABLED_ENV,
} from '../../backend/services/leadOutreachExecution';
import { registry } from '../../backend/observability/registry';
import { renderPrometheusText } from '../../backend/observability/promExporter';
import { check, configureTenant, fmt, measure, nowMs, provider, realPlan, section, stats, tenantId } from './harness';

const NOW = '2026-08-05T12:00:00.000Z';
const RECIPIENT = 'cto@bigcorp.test';
type Plan = Parameters<typeof materializeAutomationPlan>[0];
const ctx = (companyId: string, leadId: string) => ({ companyId, leadId, plannerVersion: 'lie-2.1.0', materializedAt: NOW });

type Entry = { name: string; labels?: Record<string, unknown>; value: number };
const entries = (): Entry[] => registry.counterEntries() as unknown as Entry[];
const family = (name: string): Entry[] => entries().filter((e) => e.name === name);

async function readyTask(co: string): Promise<string | null> {
  const plan = (await realPlan(co, 'L1', NOW)) as Plan;
  await materializeAutomationPlan(plan, ctx(co, 'L1'));
  const t = (await listOutreachTasksForLead(co, 'L1')).find((x) => x.channel === 'email' && x.status === 'pending');
  if (!t?.id) return null;
  await submitForApproval(co, String(t.id));
  await approveOutreachTask(co, String(t.id), { approverUserId: 'u-cert', reason: 'cert', notes: null });
  return String(t.id);
}

/** One full pipeline run, so the registry holds real series to inspect. */
async function exercise(tag: string): Promise<{ co: string; taskId: string } | null> {
  const co = tenantId(tag);
  await configureTenant(co);
  provider.reset();
  const taskId = await readyTask(co);
  if (!taskId) return null;
  await dispatchInternalOutreachTask(co, taskId, { now: NOW, recipient: RECIPIENT });
  await ingestFeedback({ companyId: co, taskId, signal: 'delivered', occurredAt: '2026-08-05T12:05:00.000Z', source: 'provider_webhook', provider: 'certenv_stub', providerEventId: `${tag}-d` });
  await ingestFeedback({ companyId: co, taskId, signal: 'replied', occurredAt: '2026-08-05T14:00:00.000Z', source: 'provider_webhook', provider: 'certenv_stub', providerEventId: `${tag}-r` });
  await ingestFeedback({ companyId: co, taskId, signal: 'replied', occurredAt: '2026-08-05T14:00:00.000Z', source: 'provider_webhook', provider: 'certenv_stub', providerEventId: `${tag}-r` });
  return { co, taskId };
}

// ── Telemetry ───────────────────────────────────────────────────────────────

export async function proofTelemetry(): Promise<void> {
  section('TELEMETRY — every family, real emissions from real work');

  registry.reset();
  const run = await exercise('tel');
  if (!run) return void check('fixture', false);

  const families = [
    OUTREACH_METRICS.governance.evaluations, OUTREACH_METRICS.governance.gate,
    OUTREACH_METRICS.dispatch.outcome, OUTREACH_METRICS.quota.reserved,
    OUTREACH_METRICS.quota.reconciled, OUTREACH_METRICS.external.dispatch,
    OUTREACH_METRICS.provider.response, OUTREACH_METRICS.stage.outcome,
    OUTREACH_METRICS.lifecycle.transition, OUTREACH_METRICS.feedback.result,
    OUTREACH_METRICS.feedback.routed,
  ];
  for (const f of families) {
    const rows = family(f);
    check(`${f} emitted`, rows.length > 0, `${rows.length} series, ${rows.reduce((a, b) => a + b.value, 0)} events`);
  }

  // Histograms.
  const hist = registry.histogramEntries() as unknown as Array<{ name: string; count: number }>;
  for (const h of [OUTREACH_METRICS.dispatch.duration, OUTREACH_METRICS.provider.latency]) {
    const found = hist.find((x) => x.name === h);
    check(`${h} histogram recorded`, !!found && found.count > 0, `count=${found?.count ?? 0}`);
  }

  // Feedback result split: accepted AND duplicate both present.
  const fb = family(OUTREACH_METRICS.feedback.result);
  check('feedback telemetry distinguishes accepted from duplicate',
    fb.some((e) => e.labels?.result === 'accepted') && fb.some((e) => e.labels?.result === 'duplicate'),
    fb.map((e) => `${e.labels?.result}=${e.value}`).join(' '));

  // NO IDENTIFIER LEAKAGE — the property that would breach a tenant.
  const outreach = entries().filter((e) => e.name.startsWith('outreach.'));
  const labelValues = outreach.flatMap((e) => Object.values(e.labels ?? {}).map(String));
  check('no company id appears in any label', !labelValues.some((v) => v.includes(run.co)), `${labelValues.length} label values`);
  check('no task id appears in any label', !labelValues.some((v) => v.includes(run.taskId)));
  check('no recipient address appears in any label', !labelValues.some((v) => v.includes('@')));
  check('no label is a uuid', !labelValues.some((v) => /[0-9a-f]{8}-[0-9a-f]{4}-/i.test(v)));
  const labelKeys = new Set(outreach.flatMap((e) => Object.keys(e.labels ?? {})));
  check('label keys are drawn from a small closed set', labelKeys.size <= 14, [...labelKeys].sort().join(','));

  // No duplicated series: the registry keys by (name, sorted labels).
  const keys = outreach.map((e) => `${e.name}|${JSON.stringify(Object.entries(e.labels ?? {}).sort())}`);
  check('no series is duplicated', new Set(keys).size === keys.length, `${keys.length} series`);

  // NO SILENT STAGES. `quota` and `provider` deliberately do NOT use the
  // generic stage counter — they have dedicated families carrying information
  // the generic one cannot (which limiter layer answered; whether the provider
  // accepted, and how fast). The health module makes the same split. The
  // property to prove is therefore that every stage is observable through the
  // family that owns it, not that all nine share one counter.
  const seen = new Set(family(OUTREACH_METRICS.stage.outcome).map((e) => String(e.labels?.stage)));
  const dedicated: Record<string, string[]> = {
    quota: [OUTREACH_METRICS.quota.reserved, OUTREACH_METRICS.quota.reconciled],
    provider: [OUTREACH_METRICS.provider.response, OUTREACH_METRICS.provider.latency],
  };
  for (const s of RUNTIME_STAGES) {
    const own = dedicated[s];
    const observable = own
      ? own.some((f) => family(f).length > 0 || (registry.histogramEntries() as unknown as Array<{ name: string; count: number }>).some((h) => h.name === f && h.count > 0))
      : seen.has(s);
    check(`stage "${s}" is observable`, observable, own ? `via ${own.join(' / ')}` : [...seen].sort().join(','));
  }
  check('no stage is observable ONLY by accident (every stage has a home)',
    RUNTIME_STAGES.every((s) => seen.has(s) || !!dedicated[s]),
    RUNTIME_STAGES.filter((s) => !seen.has(s) && !dedicated[s]).join(',') || 'all nine');

  // Prometheus exporter renders every WS-3 family.
  const text = renderPrometheusText();
  const rendered = families.filter((f) => text.includes(f.replace(/\./g, '_')));
  check('the Prometheus exporter renders every WS-3 family', rendered.length === families.length, `${rendered.length}/${families.length}`);
  check('exported text is valid Prometheus line format',
    text.split('\n').filter((l) => l && !l.startsWith('#')).every((l) => /^[a-zA-Z_:][a-zA-Z0-9_:]*(\{.*\})? -?[\d.eE+]+$/.test(l)),
    `${text.split('\n').length} lines`);
  check('the exporter leaks no identifier', !text.includes(run.co) && !text.includes(run.taskId) && !text.includes(RECIPIENT));

  measure('total WS-3 series after one full pipeline run', `${outreach.length}`);
  measure('Prometheus payload size', `${text.length} bytes`);

  // Cardinality under load: series count must not grow with traffic.
  const before = entries().filter((e) => e.name.startsWith('outreach.')).length;
  for (let i = 0; i < 200; i += 1) {
    recordStageOutcome(RUNTIME_STAGES[i % RUNTIME_STAGES.length], 'ok');
    recordFailure(RUNTIME_STAGES[i % RUNTIME_STAGES.length], new Error('synthetic'));
  }
  const after = entries().filter((e) => e.name.startsWith('outreach.')).length;
  check('400 further events add no unbounded series', after - before <= 20, `${before} → ${after}`);
  measure('series growth over 400 synthetic events', `+${after - before}`);
}

// ── Health ──────────────────────────────────────────────────────────────────

export async function proofHealth(): Promise<void> {
  section('HEALTH — every indicator, every status');

  // COLD: a process that has done nothing knows it has done nothing.
  registry.reset();
  const cold = getOutreachRuntimeHealth(NOW);
  check('a cold process reports exactly 10 indicators', cold.indicators.length === 10, `${cold.indicators.length}`);
  check('a cold process is unknown, not healthy',
    cold.indicators.filter((i) => i.name !== 'configuration').every((i) => i.status === 'unknown'),
    cold.indicators.map((i) => `${i.name}=${i.status}`).join(' '));
  check('every indicator explains itself even when unknown', cold.indicators.every((i) => i.detail.length > 0));
  check('health is declared process-scoped', cold.processScoped === true);
  check('health carries the runtime and governance versions',
    cold.executionRuntimeVersion === 'lor-1.0.0' && cold.governanceVersion === 'gov-1.0.0',
    `${cold.executionRuntimeVersion}/${cold.governanceVersion}`);

  // HEALTHY: after a clean run.
  registry.reset();
  const run = await exercise('health');
  if (!run) return void check('fixture', false);
  const healthy = getOutreachRuntimeHealth(NOW);
  check('a clean run reports no unhealthy indicator',
    !healthy.indicators.some((i) => i.status === 'unhealthy'),
    healthy.indicators.filter((i) => i.status !== 'healthy').map((i) => `${i.name}=${i.status}`).join(' ') || 'all healthy');
  check('rollup is the worst of its parts',
    healthy.status === healthy.indicators.map((i) => i.status).reduce((w, s) =>
      (['unhealthy', 'degraded', 'unknown', 'healthy'].indexOf(s) < ['unhealthy', 'degraded', 'unknown', 'healthy'].indexOf(w) ? s : w), 'healthy'),
    healthy.status);
  check('degradedComponents names every non-healthy indicator',
    healthy.degradedComponents.length === healthy.indicators.filter((i) => i.status !== 'healthy').length);

  // DEGRADED / UNHEALTHY: synthetic failures, clearly labelled.
  registry.reset();
  await exercise('unhealthy');
  for (let i = 0; i < 200; i += 1) recordStageOutcome('dispatch', 'failed');
  const bad = getOutreachRuntimeHealth(NOW);
  const dispatchIndicator = bad.indicators.find((i) => i.name === 'dispatch');
  check('a flood of dispatch failures degrades the dispatch indicator',
    dispatchIndicator?.status === 'unhealthy' || dispatchIndicator?.status === 'degraded',
    `${dispatchIndicator?.status}: ${dispatchIndicator?.detail}`);
  check('the rollup follows the worst indicator', bad.status === 'unhealthy' || bad.status === 'degraded', bad.status);

  // KILL SWITCH: configuration reports it as a deliberate state.
  process.env[LEAD_OUTREACH_DISABLED_ENV] = 'true';
  const killed = getOutreachRuntimeHealth(NOW);
  const cfg = killed.indicators.find((i) => i.name === 'configuration');
  check('the global kill switch surfaces on the configuration indicator',
    cfg?.status !== 'healthy' && /kill switch/i.test(String(cfg?.detail)), `${cfg?.status}: ${cfg?.detail}`);
  delete process.env[LEAD_OUTREACH_DISABLED_ENV];

  // NEVER THROWS — two independent guards, exercised separately.
  //
  // (a) the SNAPSHOT guard: the whole counter read fails.
  const spy = registry.counterEntries;
  (registry as unknown as { counterEntries: unknown }).counterEntries = () => { throw new Error('registry exploded'); };
  let threw = false;
  let report: ReturnType<typeof getOutreachRuntimeHealth> | null = null;
  try { report = getOutreachRuntimeHealth(NOW); } catch { threw = true; }
  (registry as unknown as { counterEntries: unknown }).counterEntries = spy;
  check('health never throws when the counter read fails', !threw && report !== null, threw ? 'threw' : String(report?.status));

  // (b) the PER-INDICATOR guard: one indicator throws while the rest are fine.
  //     A poisoned label object reaches only the indicators that inspect
  //     labels, so a report that survives this proves the isolation is real
  //     rather than that the snapshot happened to be readable.
  registry.reset();
  await exercise('poison');
  const poison = new Proxy({}, { get(_t, prop) { if (prop === 'stage') throw new Error('poisoned label'); return undefined; } });
  registry.incr(OUTREACH_METRICS.stage.outcome, 1, poison as never);
  let threw2 = false;
  let report2: ReturnType<typeof getOutreachRuntimeHealth> | null = null;
  try { report2 = getOutreachRuntimeHealth(NOW); } catch { threw2 = true; }
  check('one broken indicator does not take the health report down',
    !threw2 && report2 !== null && report2.indicators.length === 10,
    threw2 ? 'threw' : `${report2?.indicators.length} indicators`);
  check('the broken indicator reports unknown rather than lying',
    !threw2 && report2!.indicators.some((i) => i.status === 'unknown'),
    report2?.indicators.filter((i) => i.status === 'unknown').map((i) => i.name).join(',') || 'none');
  registry.reset();
  await exercise('post-poison');

  const before = JSON.stringify(entries().filter((e) => e.name.startsWith('outreach.dispatch')));
  getOutreachRuntimeHealth(NOW);
  const afterCounters = entries().filter((e) => e.name.startsWith('outreach.dispatch'));
  check('reading health mutates no runtime counter', JSON.stringify(afterCounters) === before);

  const t = nowMs();
  for (let i = 0; i < 100; i += 1) getOutreachRuntimeHealth(NOW);
  measure('health evaluation, 100 reads', `${(nowMs() - t).toFixed(1)}ms total`);
}

// ── Operations ──────────────────────────────────────────────────────────────

export async function proofOperations(): Promise<void> {
  section('OPERATIONS — documentation matches the implementation');

  const fs = await import('fs');
  const path = await import('path');
  const doc = fs.readFileSync(path.join(process.cwd(), 'docs/WS3-OPERATIONS.md'), 'utf8');

  // Exercise first: comparing the document against an EMPTY registry would
  // pass by proving nothing, which is the failure mode this check exists to
  // prevent in the first place.
  await exercise('ops');
  const emitted = new Set(entries().filter((e) => e.name.startsWith('outreach.')).map((e) => e.name));
  check('the registry actually holds emissions to compare against', emitted.size >= 10, `${emitted.size} metric families`);
  const missing = [...emitted].filter((m) => !doc.includes(m));
  check('every emitted metric is documented', missing.length === 0, missing.join(',') || `${emitted.size} metrics`);

  // Every documented metric must actually exist in the code's catalogue.
  const catalogue = new Set(Object.values(OUTREACH_METRICS).flatMap((g) => Object.values(g)));
  const documented = [...doc.matchAll(/`(outreach\.[a-z_.]+)`/g)].map((m) => m[1]);
  const phantom = [...new Set(documented)].filter((d) => !catalogue.has(d as never));
  check('no documented metric is missing from the code', phantom.length === 0, phantom.join(','));

  // Failure classes and stages agree with the document.
  for (const c of FAILURE_CLASSES) check(`failure class "${c}" is documented`, doc.includes(c));
  check('all nine runtime stages are documented', RUNTIME_STAGES.every((s) => doc.includes(s)));

  // Alert catalogue is present, severities are real, and every alert names an owner.
  const alertRows = doc.split('\n').filter((l) => /^\| \*\*WS3-/.test(l));
  check('the alert catalogue has entries', alertRows.length >= 10, `${alertRows.length} alerts`);
  check('every alert carries a severity and an owner',
    alertRows.every((r) => /\*\*P[123]\*\*/.test(r) && r.split('|').length >= 6),
    `${alertRows.length} rows`);
  check('the rollout checklist covers the migration set', doc.includes('20260915'), '');
  check('the operations document states that production baselines do not exist',
    /Production baselines do not exist/i.test(doc));

  // Health indicator names in the doc match the ones the code produces.
  const names = getOutreachRuntimeHealth(NOW).indicators.map((i) => i.name);
  check('every health indicator is documented', names.every((n) => doc.includes(n)), names.join(','));

  // Runbook: rollout and rollback both exist and both reference the flags.
  check('a rollout checklist exists', /## \d+\. Rollout checklist/i.test(doc));
  check('a rollback checklist exists', /## \d+\. Rollback checklist/i.test(doc));
  check('both kill switches are documented',
    doc.includes(LEAD_OUTREACH_DISABLED_ENV) && doc.includes('LEAD_OUTREACH_EMAIL_ENABLED'));
  check('incident playbooks exist', /## \d+\. Incident playbooks/i.test(doc));

  // COLD DEPLOYMENT + FIRST TENANT ENABLEMENT, executed rather than described.
  const co = tenantId('coldstart');
  provider.reset();
  const taskId = await readyTask(co);
  if (!taskId) return void check('cold-start fixture', false);
  const beforeConfig = await evaluateTaskGovernance(co, taskId, { recipient: RECIPIENT, evaluatedAt: NOW, recordDecision: false });
  check('before enablement, a brand-new tenant cannot dispatch',
    beforeConfig.evaluation?.decision !== 'allowed', String(beforeConfig.evaluation?.decision));
  await configureTenant(co);
  const afterConfig = await evaluateTaskGovernance(co, taskId, { recipient: RECIPIENT, evaluatedAt: NOW, recordDecision: false });
  check('enabling the tenant is the ONE step that makes it dispatchable',
    afterConfig.evaluation?.decision === 'allowed', String(afterConfig.evaluation?.decision));
  const sent = await dispatchInternalOutreachTask(co, taskId, { now: NOW, recipient: RECIPIENT });
  check('a first tenant enablement dispatches on the documented path', sent.outcome === 'sent', `${sent.outcome}: ${sent.reason}`);
}

// ── Performance ─────────────────────────────────────────────────────────────

export async function proofPerformance(): Promise<void> {
  section('PERFORMANCE — measured on this run, never estimated');

  const co = tenantId('perf');
  await configureTenant(co);
  provider.reset();
  const plan = (await realPlan(co, 'L1', NOW)) as Plan;

  // Pure stages: translation and envelope.
  const tr: number[] = [];
  for (let i = 0; i < 200; i += 1) { const t = nowMs(); translateAutomationPlan(plan, ctx(co, 'L1')); tr.push(nowMs() - t); }
  measure('translation (pure)', fmt(stats(tr)));

  // Governance, against real storage.
  const taskId = await readyTask(co);
  if (!taskId) return void check('fixture', false);
  const gov: number[] = [];
  for (let i = 0; i < 30; i += 1) {
    const t = nowMs();
    await evaluateTaskGovernance(co, taskId, { recipient: RECIPIENT, evaluatedAt: NOW, recordDecision: false });
    gov.push(nowMs() - t);
  }
  measure('governance evaluation (real DB)', fmt(stats(gov)));

  // Dispatch, one task each — a fresh tenant per sample so nothing is reused.
  const dispatchSamples: number[] = [];
  for (let i = 0; i < 10; i += 1) {
    const c = tenantId(`perfd${i}`);
    await configureTenant(c);
    const id = await readyTask(c);
    if (!id) continue;
    const t = nowMs();
    await dispatchInternalOutreachTask(c, id, { now: NOW, recipient: RECIPIENT });
    dispatchSamples.push(nowMs() - t);
  }
  measure('dispatch, end to end (real DB + Redis)', fmt(stats(dispatchSamples)));

  // Feedback ingestion.
  const co2 = tenantId('perff');
  await configureTenant(co2);
  const id2 = await readyTask(co2);
  if (id2) {
    await dispatchInternalOutreachTask(co2, id2, { now: NOW, recipient: RECIPIENT });
    const fb: number[] = [];
    for (let i = 0; i < 40; i += 1) {
      const t = nowMs();
      await ingestFeedback({
        companyId: co2, taskId: id2, signal: 'opened',
        occurredAt: new Date(Date.parse(NOW) + i * 60_000).toISOString(),
        source: 'provider_webhook', provider: 'certenv_stub', providerEventId: `perf-${i}`,
      });
      fb.push(nowMs() - t);
    }
    measure('feedback ingestion (real DB)', fmt(stats(fb)));

    const rec = (await readTaskFeedback(co2, id2))!;
    const env: number[] = [];
    for (let i = 0; i < 500; i += 1) {
      const t = nowMs();
      buildFeedbackEnvelope({ companyId: co2, leadId: 'L1', tasks: [rec.task], deliveryEvidence: rec.deliveryEvidence, outcomes: rec.outcomes, now: NOW });
      env.push(nowMs() - t);
    }
    measure(`feedback envelope (${rec.outcomes.length} outcomes)`, fmt(stats(env)));
  }

  // Telemetry overhead: the same loop with and without emission.
  const bare: number[] = [];
  for (let i = 0; i < 5000; i += 1) { const t = process.hrtime.bigint(); void i; bare.push(Number(process.hrtime.bigint() - t)); }
  const withMetric: number[] = [];
  for (let i = 0; i < 5000; i += 1) { const t = process.hrtime.bigint(); recordStageOutcome('dispatch', 'ok'); withMetric.push(Number(process.hrtime.bigint() - t)); }
  const overheadNs = stats(withMetric).p50 - stats(bare).p50;
  measure('telemetry overhead per emission', `${overheadNs.toFixed(0)}ns p50`);
  check('telemetry costs under 10µs per emission', overheadNs < 10_000, `${overheadNs.toFixed(0)}ns`);

  // Concurrent throughput across distinct tasks.
  const co3 = tenantId('perfc');
  await configureTenant(co3);
  const plan3 = (await realPlan(co3, 'L1', NOW)) as Plan;
  await materializeAutomationPlan(plan3, ctx(co3, 'L1'));
  const tasks = (await listOutreachTasksForLead(co3, 'L1')).filter((x) => x.status === 'pending');
  for (const t of tasks) {
    await submitForApproval(co3, String(t.id));
    await approveOutreachTask(co3, String(t.id), { approverUserId: 'u', reason: 'r', notes: null });
  }
  const t0 = nowMs();
  const outcomes = await Promise.all(tasks.map((t) => dispatchInternalOutreachTask(co3, String(t.id), { now: NOW, recipient: RECIPIENT })));
  const wall = nowMs() - t0;
  measure(`${tasks.length} distinct tasks dispatched concurrently`, `${wall.toFixed(1)}ms wall, ${(tasks.length / (wall / 1000)).toFixed(1)} task/s`);
  check('concurrent dispatch of distinct tasks produces no failure',
    outcomes.every((o) => o.outcome === 'sent' || o.outcome === 'skipped_no_transport'),
    [...new Set(outcomes.map((o) => o.outcome))].join(','));

  // Memory.
  const mem = process.memoryUsage();
  measure('heap used after the full proof run', `${(mem.heapUsed / 1048576).toFixed(1)} MB`);
  measure('rss after the full proof run', `${(mem.rss / 1048576).toFixed(1)} MB`);
  measure('registry series retained', `${entries().length} total, ${entries().filter((e) => e.name.startsWith('outreach.')).length} WS-3`);
}
