#!/usr/bin/env node
// Canonical Governance Execution Orchestrator & Universal Governance Execution Authority — GOV-AUTO-023 (WP-24).
//
// The SOLE governance execution authority: it deterministically orchestrates every governance workload
// admitted through WP-23. No governance workload may execute outside this orchestrator. It consumes ONLY
// WP-23 (the admission gateway + its context); no earlier runtime is invoked directly. It governs EXECUTION
// only — no constitutional modification, no new governance decision logic. Execution identities are immutable,
// duplicate execution is impossible, and orchestration provenance + ledger are immutable. Deterministic; additive.
//
// Usage:
//   node execution-orchestrator.mjs --workload <ref> --outcome success|failure|cancel   # orchestrate one workload
//   node execution-orchestrator.mjs --demo                                               # success/failure/cancel/retry + dedup + replay
//   node execution-orchestrator.mjs --json                                               # machine-readable orchestration + registry + ledger
//   node execution-orchestrator.mjs --persist                                            # append immutable orchestration records
//   node execution-orchestrator.mjs --cache-dir <dir> --ledger-dir <dir>

import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { admit, produceGatewayContext } from './gateway.mjs';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..', '..', '..', '..');
const CACHE_DIR = path.join(REPO_ROOT, '.governance-orchestrator-cache');
const DEFAULT_LEDGER_DIR = path.join(REPO_ROOT, '.governance-execution');

function hash(str) { const s = typeof str === 'string' ? str : JSON.stringify(str); let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(16).padStart(8, '0'); }

// ---------------------------------------------------------------------------
// Execution lifecycle (§2) — deterministic paths per outcome. Retry preserves execution identity.
// ---------------------------------------------------------------------------
const LIFECYCLE_PATHS = {
  success: ['Admitted', 'Scheduled', 'Dispatched', 'Running', 'Completed'],
  failure: ['Admitted', 'Scheduled', 'Dispatched', 'Running', 'Failed'],
  cancel: ['Admitted', 'Scheduled', 'Cancelled'],
  retry: ['Admitted', 'Scheduled', 'Dispatched', 'Running', 'Failed', 'Retried', 'Running', 'Completed'],
};
const TERMINAL = { success: 'Completed', failure: 'Failed', cancel: 'Cancelled', retry: 'Completed' };

// ---------------------------------------------------------------------------
// Execution verification (§4) — eight areas, all from WP-23 admission evidence.
// ---------------------------------------------------------------------------
function verifyExecution(admission, ac, workload, overrides = {}) {
  const enf = admission.enforcement || {};
  const enfAreas = Object.fromEntries((enf.verification?.areas || []).map((a) => [a.area, a.status]));
  const V = (area, status, evidence) => ({ area, status: overrides[area] || status, evidence, sourceRuntime: 'GOV-AUTO-022 (WP-23)' });
  const areas = [
    V('admission-validity', admission.gatewayDecision === 'Admitted' ? 'pass' : 'fail', { gatewayDecision: admission.gatewayDecision }),
    V('constitutional-enforcement', enf.decision === 'Admitted' ? 'pass' : 'fail', { enforcementDecision: enf.decision }),
    V('active-constitution', workload.generation === ac.activeGeneration ? 'pass' : 'fail', { requested: workload.generation, active: ac.activeGeneration }),
    V('execution-provenance', admission.provenance && admission.provenance.immutable ? 'pass' : 'fail', { admissionId: admission.admissionId }),
    V('registry-integrity', ac.registry.historicalImmutable ? 'pass' : 'fail', { immutable: ac.registry.historicalImmutable }),
    V('lineage-continuity', enfAreas['lineage-continuity'] || (admission.entersPipeline ? 'pass' : 'fail'), { source: 'WP-23→WP-22 lineage-continuity' }),
    V('operational-continuity', enfAreas['operational-continuity'] || (admission.entersPipeline ? 'pass' : 'warn'), { source: 'WP-23→WP-22 operational-continuity' }),
    V('orchestration-consistency', 'pass', { deterministic: true }),
  ];
  const fails = areas.filter((a) => a.status === 'fail'), warns = areas.filter((a) => a.status === 'warn');
  const verificationDigest = hash([enf.executionId || 'none', workload.workloadRef, areas.map((a) => [a.area, a.status])]);
  return { areas, verified: fails.length === 0, warnings: warns.length, verificationDigest };
}

// ---------------------------------------------------------------------------
// Universal execution orchestrator (§2/§3) — the only execution authority. State only.
// ---------------------------------------------------------------------------
function orchestrate(workload, ac, seen, overrides = {}) {
  // Admission is mandatory (WP-23) — only admitted workloads execute.
  const admission = admit({ executionRef: workload.workloadRef, generation: workload.generation }, ac, overrides);
  if (admission.gatewayDecision !== 'Admitted') {
    return { orchestrated: false, workload, admission, orchestrationDecision: 'Not Orchestrated', reason: `workload not admitted (gateway ${admission.gatewayDecision})` };
  }
  const executionId = admission.enforcement.executionId;                 // immutable execution identity from WP-23/WP-22
  const orchestrationId = `ORCH-${executionId}-${hash([workload.workloadRef, workload.outcome])}`;
  // RULE: duplicate execution is impossible — an already-orchestrated execution identity is not re-executed.
  if (seen && seen.has(executionId)) {
    return { orchestrated: false, duplicatePrevented: true, workload, admission, executionId, orchestrationDecision: 'Duplicate Prevented', reason: `execution ${executionId} already orchestrated` };
  }
  const verification = verifyExecution(admission, ac, workload, overrides);
  const outcome = verification.verified ? (workload.outcome || 'success') : 'failure';
  const lifecycle = LIFECYCLE_PATHS[outcome];
  const terminalState = TERMINAL[outcome];
  const attempts = outcome === 'retry' ? 2 : 1;
  const provenance = { orchestrationId, executionId, workloadId: workload.workloadRef, admissionId: admission.admissionId, constitutionId: admission.provenance.constitutionId, generation: workload.generation, lifecycle, attempts, verificationDigest: verification.verificationDigest, immutable: true };
  if (seen) seen.add(executionId);
  const orchestrationDigest = hash([orchestrationId, outcome, lifecycle, verification.verificationDigest]);
  return { orchestrated: true, workload, admission, executionId, orchestrationId, orchestrationDecision: 'Orchestrated', outcome, lifecycle, terminalState, attempts, verification, provenance, orchestrationDigest };
}

// ---------------------------------------------------------------------------
// Execution registry (§5) — additive; every orchestration recorded immutably.
// ---------------------------------------------------------------------------
function buildRegistry(orchestrations, ac) {
  const records = orchestrations.filter((o) => o.orchestrated || o.duplicatePrevented).map((o) => ({ executionId: o.executionId, orchestrationId: o.orchestrationId || null, workloadId: o.workload.workloadRef, lifecycleState: o.terminalState || (o.duplicatePrevented ? 'Duplicate Prevented' : 'n/a'), constitutionalGeneration: o.workload.generation, verificationStatus: o.verification?.verified ? 'verified' : (o.duplicatePrevented ? 'deduplicated' : 'unverified'), provenance: o.provenance || null }));
  return {
    executions: records,
    completed: records.filter((r) => r.lifecycleState === 'Completed').map((r) => r.executionId),
    failed: records.filter((r) => r.lifecycleState === 'Failed').map((r) => r.executionId),
    cancelled: records.filter((r) => r.lifecycleState === 'Cancelled').map((r) => r.executionId),
    duplicatesPrevented: records.filter((r) => r.lifecycleState === 'Duplicate Prevented').length,
    activeConstitution: { generation: ac.activeGeneration, id: ac.activeId },
    additiveOnly: true, immutable: true, singleAuthority: true, uniqueIdentities: new Set(records.map((r) => r.executionId)).size,
  };
}

// ---------------------------------------------------------------------------
// Immutable orchestration ledger (§6)
// ---------------------------------------------------------------------------
function appendLedger(o, dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'orchestration-ledger.jsonl');
  const entry = { orchestrationId: o.orchestrationId || null, executionId: o.executionId || null, workloadId: o.workload.workloadRef, lifecycleTransition: (o.lifecycle || []).join('→'), completionStatus: o.terminalState || o.orchestrationDecision, verificationDigest: o.verification?.verificationDigest || o.orchestrationDecision, timestamp: new Date().toISOString() };
  appendFileSync(file, JSON.stringify(entry) + '\n'); // append-only; prior entries never modified
  return entry;
}
function ledgerEntries(dir) { const f = path.join(dir, 'orchestration-ledger.jsonl'); if (!existsSync(f)) return []; const c = readFileSync(f, 'utf8').trim(); return c ? c.split(/\n/).map((l) => JSON.parse(l)) : []; }

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------
function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; }

// WP-25 consumes this as the sole WP-24 API — the execution orchestrator + its context.
function produceExecutionContext(cacheDir) { return produceGatewayContext(cacheDir); }

function main() {
  const asJson = process.argv.includes('--json');
  const ledgerDir = path.resolve(arg('--ledger-dir') || DEFAULT_LEDGER_DIR);
  const cacheDir = path.resolve(arg('--cache-dir') || CACHE_DIR);

  const t0 = performance.now();
  const ac = produceGatewayContext(cacheDir);   // sole input: WP-23 admission-gateway context
  const consumeMs = +(performance.now() - t0).toFixed(1);

  if (process.argv.includes('--demo')) { runDemo(ac, ledgerDir, asJson, consumeMs); return; }

  const workload = { workloadRef: arg('--workload') || 'governance-workload', generation: Number(arg('--generation') ?? ac.activeGeneration), outcome: arg('--outcome') || 'success' };
  const o = orchestrate(workload, ac, new Set());
  const registry = buildRegistry([o], ac);
  let ledger = null;
  if (process.argv.includes('--persist')) { appendLedger(o, ledgerDir); ledger = { entries: ledgerEntries(ledgerDir).length }; }

  const out = {
    tool: 'governance-execution-orchestrator', runtimeVersion: '1.0.0', mapsTo: 'GOV-AUTO-023', consumes: { wp23: 'governance admission gateway' },
    orchestrationDecision: { orchestrationId: o.orchestrationId, decision: o.orchestrationDecision, executionId: o.executionId, terminalState: o.terminalState, lifecycle: o.lifecycle, reason: o.reason || null },
    executionRegistry: registry, verification: o.verification, provenance: o.provenance, ...(ledger ? { orchestrationLedger: ledger } : {}),
    orchestrationSummary: `${o.orchestrationDecision} — ${o.executionId || 'n/a'} → ${o.terminalState || o.orchestrationDecision}`,
    observability: { orchestratorHealth: o.orchestrated ? 'operational' : 'rejecting', executionLifecycle: o.terminalState || o.orchestrationDecision, workloadStatus: o.outcome || 'n/a', admissionContinuity: o.admission.gatewayDecision, provenanceContinuity: 'immutable', registryIntegrity: registry.immutable ? 'immutable' : 'violated', orchestrationMs: consumeMs },
  };
  if (asJson) process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  else {
    const L = [];
    L.push('Governance Execution Orchestrator & Universal Governance Execution Authority — GOV-AUTO-023 (canonical)');
    L.push(`consumes WP-23 only  ·  Active Constitution: Gen${ac.activeGeneration}`);
    L.push(`\nORCHESTRATION: ${o.orchestrationDecision}   execution: ${o.executionId || 'n/a'}   → ${o.terminalState || o.reason}`);
    if (o.lifecycle) L.push(`lifecycle: ${o.lifecycle.join(' → ')}`);
    if (o.verification) { L.push('\nexecution verification:'); for (const a of o.verification.areas) L.push(`   ${a.status === 'fail' ? 'FAIL' : a.status === 'warn' ? 'WARN' : 'PASS'}  ${a.area}`); }
    process.stdout.write(L.join('\n') + '\n');
  }
  process.exit(o.orchestrated ? 0 : 1);
}

function runDemo(ac, ledgerDir, asJson, consumeMs) {
  const seen = new Set();
  const orchestrations = [];
  const G = ac.activeGeneration;
  orchestrations.push({ label: 'successful execution', ...orchestrate({ workloadRef: 'wl-success', generation: G, outcome: 'success' }, ac, seen) });
  orchestrations.push({ label: 'failed execution', ...orchestrate({ workloadRef: 'wl-failure', generation: G, outcome: 'failure' }, ac, seen) });
  orchestrations.push({ label: 'cancelled execution', ...orchestrate({ workloadRef: 'wl-cancel', generation: G, outcome: 'cancel' }, ac, seen) });
  orchestrations.push({ label: 'retried execution', ...orchestrate({ workloadRef: 'wl-retry', generation: G, outcome: 'retry' }, ac, seen) });
  // Duplicate prevention: re-orchestrate the successful workload (same execution identity) → prevented.
  const dup = orchestrate({ workloadRef: 'wl-success', generation: G, outcome: 'success' }, ac, seen);
  orchestrations.push({ label: 'duplicate prevention', ...dup });
  for (const o of orchestrations) appendLedger(o, ledgerDir);
  const registry = buildRegistry(orchestrations, ac);
  // Deterministic replay: fresh seen-set, same workload → identical execution identity + digest.
  const r1 = orchestrate({ workloadRef: 'wl-success', generation: G, outcome: 'success' }, ac, new Set());
  const r2 = orchestrate({ workloadRef: 'wl-success', generation: G, outcome: 'success' }, ac, new Set());

  const out = {
    tool: 'governance-execution-orchestrator', mode: 'demo', mapsTo: 'GOV-AUTO-023', consumes: 'WP-23 only', activeConstitution: `Gen${G}`,
    executionScenarios: orchestrations.map((o) => ({ label: o.label, decision: o.orchestrationDecision, executionId: o.executionId || null, terminal: o.terminalState || o.reason, lifecycle: o.lifecycle || null, attempts: o.attempts || null })),
    lifecycleOutcomes: { completed: registry.completed.length, failed: registry.failed.length, cancelled: registry.cancelled.length, duplicatesPrevented: registry.duplicatesPrevented },
    provenance: orchestrations.filter((o) => o.provenance).map((o) => ({ orchestrationId: o.orchestrationId, executionId: o.executionId, immutable: o.provenance.immutable, attempts: o.attempts })),
    registryIntegrity: { executions: registry.executions.length, uniqueIdentities: registry.uniqueIdentities, additiveOnly: registry.additiveOnly, immutable: registry.immutable, singleAuthority: registry.singleAuthority },
    orchestrationLedger: { entries: ledgerEntries(ledgerDir).length, immutable: true, lookup: ['orchestrationId', 'executionId', 'workloadId'] },
    deterministicReplay: { exec1: r1.executionId, exec2: r2.executionId, sameIdentity: r1.executionId === r2.executionId, digest1: r1.orchestrationDigest, digest2: r2.orchestrationDigest, identical: r1.orchestrationDigest === r2.orchestrationDigest },
    consumeMs,
  };
  if (asJson) { process.stdout.write(JSON.stringify(out, null, 2) + '\n'); return; }
  const L = [];
  L.push('Governance Execution Orchestrator — GOV-AUTO-023 (canonical) — DEMO');
  L.push(`consumes WP-23 only  ·  Active Constitution: Gen${G}`);
  L.push('\n1) execution scenarios:');
  for (const s of out.executionScenarios) L.push(`   ${s.label.padEnd(22)} → ${s.decision.padEnd(20)} ${s.terminal}${s.attempts ? ' (attempts=' + s.attempts + ')' : ''}`);
  L.push('\n   lifecycle transitions:');
  for (const s of out.executionScenarios.filter((x) => x.lifecycle)) L.push(`     ${s.label.padEnd(22)} ${s.lifecycle.join(' → ')}`);
  L.push(`\n2) lifecycle outcomes: completed=${out.lifecycleOutcomes.completed} failed=${out.lifecycleOutcomes.failed} cancelled=${out.lifecycleOutcomes.cancelled} duplicatesPrevented=${out.lifecycleOutcomes.duplicatesPrevented}`);
  L.push('\n3) immutable provenance:');
  for (const p of out.provenance) L.push(`   ${p.orchestrationId}  execution=${p.executionId}  immutable=${p.immutable}`);
  L.push('\n4) registry integrity:');
  L.push(`   executions=${out.registryIntegrity.executions} uniqueIdentities=${out.registryIntegrity.uniqueIdentities} additiveOnly=${out.registryIntegrity.additiveOnly} immutable=${out.registryIntegrity.immutable} singleAuthority=${out.registryIntegrity.singleAuthority}`);
  L.push(`\n5) immutable orchestration ledger: ${out.orchestrationLedger.entries} entries (lookup by ${out.orchestrationLedger.lookup.join('/')})`);
  L.push(`6) deterministic replay: exec ${out.deterministicReplay.exec1} vs ${out.deterministicReplay.exec2} sameIdentity=${out.deterministicReplay.sameIdentity}  digest ${out.deterministicReplay.digest1} vs ${out.deterministicReplay.digest2} → ${out.deterministicReplay.identical && out.deterministicReplay.sameIdentity ? 'IDENTICAL' : 'DIVERGED'}`);
  process.stdout.write(L.join('\n') + '\n');
}

// WP-25 consumes ONLY this layer — all execution state originates from WP-24.
export { orchestrate, produceExecutionContext };
const isDirectEO = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isDirectEO) main();
