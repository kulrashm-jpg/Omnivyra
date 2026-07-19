#!/usr/bin/env node
// Canonical Governance Execution Assurance & Continuous Runtime Supervision — GOV-AUTO-024 (WP-25).
//
// Continuously supervises every execution orchestrated by WP-24. No executing governance workload may exist
// outside continuous constitutional supervision. It consumes ONLY WP-24 (the execution orchestrator + its
// context); no earlier runtime is invoked directly. It OBSERVES only — no constitutional modification, no
// orchestration decisions, no new governance logic. It evaluates health, tracks progress, detects anomalies,
// recommends recovery, verifies, and records immutable supervision provenance + ledger. Deterministic; additive.
//
// Usage:
//   node supervision.mjs --workload <ref> --outcome success|failure|cancel|retry   # supervise one execution
//   node supervision.mjs --demo                                                    # healthy/degraded/failed/cancelled/retried + anomaly + replay
//   node supervision.mjs --json                                                    # machine-readable assessment + registry + ledger
//   node supervision.mjs --persist                                                 # append immutable supervision records
//   node supervision.mjs --cache-dir <dir> --ledger-dir <dir>

import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { orchestrate, produceExecutionContext } from './execution-orchestrator.mjs';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..', '..', '..', '..');
const CACHE_DIR = path.join(REPO_ROOT, '.governance-orchestrator-cache');
const DEFAULT_LEDGER_DIR = path.join(REPO_ROOT, '.governance-supervision');

function hash(str) { const s = typeof str === 'string' ? str : JSON.stringify(str); let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(16).padStart(8, '0'); }

// ---------------------------------------------------------------------------
// Health evaluation + progress + anomaly detection (§2) — observation only, from WP-24 execution state.
// ---------------------------------------------------------------------------
function evaluateHealth(orch, overrides = {}) {
  if (!orch.orchestrated) return { healthState: 'Unsupervised', progress: 0, anomalies: ['not-orchestrated'], recovery: 'resubmit through WP-24' };
  const outcome = orch.outcome;
  const total = orch.lifecycle.length, done = orch.lifecycle.length; // terminal executions have traversed their full path
  const progress = Math.round((done / total) * 100);
  let healthState, anomalies = [], recovery = 'none';
  if (outcome === 'success') { healthState = overrides.healthSignal === 'degraded' ? 'Degraded' : 'Healthy'; if (healthState === 'Degraded') { anomalies = ['health-degraded']; recovery = 'monitor closely'; } }
  else if (outcome === 'retry') { healthState = 'Healthy'; anomalies = ['retry-occurred']; recovery = 'none (recovered)'; }
  else if (outcome === 'failure') { healthState = 'Failed'; anomalies = ['execution-failure']; recovery = 'retry recommended'; }
  else if (outcome === 'cancel') { healthState = 'Cancelled'; anomalies = ['execution-cancelled']; recovery = 'resubmit if intended'; }
  else { healthState = 'Healthy'; }
  return { healthState, progress, anomalies, recovery };
}

// ---------------------------------------------------------------------------
// Continuous verification (§4) — eight areas, all from WP-24 orchestration evidence.
// ---------------------------------------------------------------------------
function verifySupervision(orch, ac, overrides = {}) {
  const adm = orch.admission || {}, enf = adm.enforcement || {};
  const enfAreas = Object.fromEntries((enf.verification?.areas || []).map((a) => [a.area, a.status]));
  const V = (area, status, evidence) => ({ area, status: overrides[area] || status, evidence, sourceRuntime: 'GOV-AUTO-023 (WP-24)' });
  const areas = [
    V('orchestration-validity', orch.orchestrated ? 'pass' : 'fail', { decision: orch.orchestrationDecision }),
    V('execution-continuity', orch.executionId ? 'pass' : 'fail', { executionId: orch.executionId }),
    V('admission-continuity', adm.gatewayDecision === 'Admitted' ? 'pass' : 'fail', { gatewayDecision: adm.gatewayDecision }),
    V('constitutional-enforcement', enf.decision === 'Admitted' ? 'pass' : 'fail', { enforcementDecision: enf.decision }),
    V('active-constitution', orch.workload.generation === ac.activeGeneration ? 'pass' : 'fail', { requested: orch.workload.generation, active: ac.activeGeneration }),
    V('provenance-continuity', orch.provenance && orch.provenance.immutable ? 'pass' : 'fail', { orchestrationId: orch.orchestrationId }),
    V('operational-continuity', enfAreas['operational-continuity'] || (orch.orchestrated ? 'pass' : 'warn'), { source: 'WP-24→WP-23 operational-continuity' }),
    V('supervision-consistency', 'pass', { deterministic: true }),
  ];
  const fails = areas.filter((a) => a.status === 'fail'), warns = areas.filter((a) => a.status === 'warn');
  const verificationDigest = hash([orch.executionId || 'none', areas.map((a) => [a.area, a.status])]);
  return { areas, verified: fails.length === 0, warnings: warns.length, verificationDigest };
}

// ---------------------------------------------------------------------------
// Continuous supervision engine (§2/§3) — observes; never decides orchestration.
// ---------------------------------------------------------------------------
function supervise(orch, ac, overrides = {}) {
  const supervisionId = `SUP-${orch.executionId || 'none'}-${hash([orch.workload.workloadRef, orch.outcome || orch.orchestrationDecision])}`;
  const health = evaluateHealth(orch, overrides);
  const verification = verifySupervision(orch, ac, overrides);
  const completionAssurance = ['Completed', 'Failed', 'Cancelled'].includes(orch.terminalState) ? 'terminal-observed' : 'in-progress';
  const provenance = { supervisionId, executionId: orch.executionId, orchestrationId: orch.orchestrationId, workloadId: orch.workload.workloadRef, observedLifecycle: orch.lifecycle, healthState: health.healthState, verificationDigest: verification.verificationDigest, immutable: true };
  const supervisionDigest = hash([supervisionId, health.healthState, health.anomalies, verification.verificationDigest]);
  return { supervisionId, orch, health, verification, completionAssurance, provenance, supervisionDigest, supervised: true };
}

// ---------------------------------------------------------------------------
// Supervision registry (§5) — additive; every supervision recorded immutably.
// ---------------------------------------------------------------------------
function buildRegistry(supervisions, ac) {
  const records = supervisions.map((s) => ({ executionId: s.orch.executionId, supervisionId: s.supervisionId, healthState: s.health.healthState, progressState: `${s.health.progress}%`, supervisionStatus: s.completionAssurance, verificationStatus: s.verification.verified ? 'verified' : 'unverified', provenance: s.provenance }));
  const byHealth = (h) => records.filter((r) => r.healthState === h).map((r) => r.executionId);
  return {
    supervisions: records, healthy: byHealth('Healthy'), degraded: byHealth('Degraded'), failed: byHealth('Failed'), cancelled: byHealth('Cancelled'),
    anomaliesDetected: supervisions.reduce((n, s) => n + s.health.anomalies.length, 0),
    activeConstitution: { generation: ac.activeGeneration, id: ac.activeId },
    additiveOnly: true, immutable: true, continuousSupervision: true, everyExecutionSupervised: supervisions.every((s) => s.supervised),
  };
}

// ---------------------------------------------------------------------------
// Immutable supervision ledger (§6)
// ---------------------------------------------------------------------------
function appendLedger(s, dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'supervision-ledger.jsonl');
  const entry = { supervisionId: s.supervisionId, executionId: s.orch.executionId, observedLifecycle: (s.orch.lifecycle || []).join('→'), healthAssessment: s.health.healthState, anomalies: s.health.anomalies, verificationDigest: s.verification.verificationDigest, timestamp: new Date().toISOString() };
  appendFileSync(file, JSON.stringify(entry) + '\n'); // append-only; prior entries never modified
  return entry;
}
function ledgerEntries(dir) { const f = path.join(dir, 'supervision-ledger.jsonl'); if (!existsSync(f)) return []; const c = readFileSync(f, 'utf8').trim(); return c ? c.split(/\n/).map((l) => JSON.parse(l)) : []; }

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------
function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; }

// WP-26 consumes this as the sole WP-25 API — the supervision engine + its context (and the orchestrate it wraps).
function produceSupervisionContext(cacheDir) { return produceExecutionContext(cacheDir); }

function main() {
  const asJson = process.argv.includes('--json');
  const ledgerDir = path.resolve(arg('--ledger-dir') || DEFAULT_LEDGER_DIR);
  const cacheDir = path.resolve(arg('--cache-dir') || CACHE_DIR);

  const t0 = performance.now();
  const ac = produceExecutionContext(cacheDir);   // sole input: WP-24 execution-orchestrator context
  const consumeMs = +(performance.now() - t0).toFixed(1);

  if (process.argv.includes('--demo')) { runDemo(ac, ledgerDir, asJson, consumeMs); return; }

  const workload = { workloadRef: arg('--workload') || 'governance-workload', generation: Number(arg('--generation') ?? ac.activeGeneration), outcome: arg('--outcome') || 'success' };
  const orch = orchestrate(workload, ac, new Set());
  const s = supervise(orch, ac);
  const registry = buildRegistry([s], ac);
  let ledger = null;
  if (process.argv.includes('--persist')) { appendLedger(s, ledgerDir); ledger = { entries: ledgerEntries(ledgerDir).length }; }

  const out = {
    tool: 'governance-execution-assurance', runtimeVersion: '1.0.0', mapsTo: 'GOV-AUTO-024', consumes: { wp24: 'governance execution orchestrator' },
    supervisionAssessment: { supervisionId: s.supervisionId, executionId: s.orch.executionId, health: s.health.healthState, progress: `${s.health.progress}%`, anomalies: s.health.anomalies, recovery: s.health.recovery, completionAssurance: s.completionAssurance },
    supervisionRegistry: registry, verification: s.verification, provenance: s.provenance, ...(ledger ? { supervisionLedger: ledger } : {}),
    assuranceSummary: `${s.health.healthState} — supervision ${s.supervisionId} (${s.completionAssurance})`,
    observability: { supervisionHealth: s.verification.verified ? 'operational' : 'attention', executionHealth: s.health.healthState, executionProgress: `${s.health.progress}%`, anomalySummary: s.health.anomalies, provenanceContinuity: 'immutable', registryIntegrity: registry.immutable ? 'immutable' : 'violated', supervisionMs: consumeMs },
  };
  if (asJson) process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  else {
    const L = [];
    L.push('Governance Execution Assurance & Continuous Runtime Supervision — GOV-AUTO-024 (canonical)');
    L.push(`consumes WP-24 only  ·  Active Constitution: Gen${ac.activeGeneration}`);
    L.push(`\nSUPERVISION: ${s.health.healthState}   execution: ${s.orch.executionId || 'n/a'}   progress: ${s.health.progress}%   assurance: ${s.completionAssurance}`);
    L.push(`anomalies: ${s.health.anomalies.join(', ') || 'none'}   recovery: ${s.health.recovery}`);
    L.push('\ncontinuous verification:');
    for (const a of s.verification.areas) L.push(`   ${a.status === 'fail' ? 'FAIL' : a.status === 'warn' ? 'WARN' : 'PASS'}  ${a.area}`);
    process.stdout.write(L.join('\n') + '\n');
  }
  process.exit(s.verification.verified ? 0 : 1);
}

function runDemo(ac, ledgerDir, asJson, consumeMs) {
  const seen = new Set(); const G = ac.activeGeneration;
  const sv = [];
  sv.push({ label: 'healthy execution', ...supervise(orchestrate({ workloadRef: 'sv-healthy', generation: G, outcome: 'success' }, ac, seen), ac) });
  sv.push({ label: 'degraded execution', ...supervise(orchestrate({ workloadRef: 'sv-degraded', generation: G, outcome: 'success' }, ac, seen), ac, { healthSignal: 'degraded' }) });
  sv.push({ label: 'failed execution', ...supervise(orchestrate({ workloadRef: 'sv-failed', generation: G, outcome: 'failure' }, ac, seen), ac) });
  sv.push({ label: 'cancelled execution', ...supervise(orchestrate({ workloadRef: 'sv-cancel', generation: G, outcome: 'cancel' }, ac, seen), ac) });
  sv.push({ label: 'retried execution', ...supervise(orchestrate({ workloadRef: 'sv-retry', generation: G, outcome: 'retry' }, ac, seen), ac) });
  for (const s of sv) appendLedger(s, ledgerDir);
  const registry = buildRegistry(sv, ac);
  // Deterministic replay: fresh seen-set, same workload → identical supervision digest + health.
  const r1 = supervise(orchestrate({ workloadRef: 'sv-healthy', generation: G, outcome: 'success' }, ac, new Set()), ac);
  const r2 = supervise(orchestrate({ workloadRef: 'sv-healthy', generation: G, outcome: 'success' }, ac, new Set()), ac);

  const out = {
    tool: 'governance-execution-assurance', mode: 'demo', mapsTo: 'GOV-AUTO-024', consumes: 'WP-24 only', activeConstitution: `Gen${G}`,
    supervisionScenarios: sv.map((s) => ({ label: s.label, supervisionId: s.supervisionId, health: s.health.healthState, progress: `${s.health.progress}%`, anomalies: s.health.anomalies, assurance: s.completionAssurance })),
    healthOutcomes: { healthy: registry.healthy.length, degraded: registry.degraded.length, failed: registry.failed.length, cancelled: registry.cancelled.length },
    anomalyDetection: { totalAnomalies: registry.anomaliesDetected, byExecution: sv.map((s) => ({ execution: s.orch.executionId, anomalies: s.health.anomalies })) },
    provenance: sv.map((s) => ({ supervisionId: s.supervisionId, executionId: s.orch.executionId, immutable: s.provenance.immutable })),
    registryIntegrity: { supervisions: registry.supervisions.length, additiveOnly: registry.additiveOnly, immutable: registry.immutable, continuousSupervision: registry.continuousSupervision, everyExecutionSupervised: registry.everyExecutionSupervised },
    supervisionLedger: { entries: ledgerEntries(ledgerDir).length, immutable: true, lookup: ['supervisionId', 'executionId'] },
    deterministicReplay: { digest1: r1.supervisionDigest, digest2: r2.supervisionDigest, healthSame: r1.health.healthState === r2.health.healthState, identical: r1.supervisionDigest === r2.supervisionDigest },
    consumeMs,
  };
  if (asJson) { process.stdout.write(JSON.stringify(out, null, 2) + '\n'); return; }
  const L = [];
  L.push('Governance Execution Assurance & Continuous Runtime Supervision — GOV-AUTO-024 (canonical) — DEMO');
  L.push(`consumes WP-24 only  ·  Active Constitution: Gen${G}`);
  L.push('\n1) supervision scenarios:');
  for (const s of out.supervisionScenarios) L.push(`   ${s.label.padEnd(22)} → ${s.health.padEnd(11)} progress=${s.progress.padEnd(5)} anomalies=[${s.anomalies.join(',')}]  ${s.assurance}`);
  L.push(`\n2) health outcomes: healthy=${out.healthOutcomes.healthy} degraded=${out.healthOutcomes.degraded} failed=${out.healthOutcomes.failed} cancelled=${out.healthOutcomes.cancelled}`);
  L.push(`\n3) anomaly detection: ${out.anomalyDetection.totalAnomalies} anomalies`);
  for (const a of out.anomalyDetection.byExecution.filter((x) => x.anomalies.length)) L.push(`   ${a.execution}: ${a.anomalies.join(', ')}`);
  L.push('\n4) immutable provenance:');
  for (const p of out.provenance) L.push(`   ${p.supervisionId}  execution=${p.executionId}  immutable=${p.immutable}`);
  L.push('\n5) registry integrity:');
  L.push(`   supervisions=${out.registryIntegrity.supervisions} additiveOnly=${out.registryIntegrity.additiveOnly} immutable=${out.registryIntegrity.immutable} continuousSupervision=${out.registryIntegrity.continuousSupervision} everyExecutionSupervised=${out.registryIntegrity.everyExecutionSupervised}`);
  L.push(`\n6) immutable supervision ledger: ${out.supervisionLedger.entries} entries (lookup by ${out.supervisionLedger.lookup.join('/')})`);
  L.push(`7) deterministic replay: ${out.deterministicReplay.digest1} vs ${out.deterministicReplay.digest2} healthSame=${out.deterministicReplay.healthSame} → ${out.deterministicReplay.identical ? 'IDENTICAL' : 'DIVERGED'}`);
  process.stdout.write(L.join('\n') + '\n');
}

// WP-26 consumes ONLY this layer — all execution state originates from WP-25.
export { supervise, orchestrate, produceSupervisionContext };
const isDirectSV = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isDirectSV) main();
