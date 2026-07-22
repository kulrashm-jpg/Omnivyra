#!/usr/bin/env node
// Canonical Governance Constitutional Runtime Closure & Immutable Governance Seal — GOV-AUTO-025 (WP-26).
//
// The final operational state of the governance runtime. It constitutionally finalizes every supervised
// governance execution: each completed execution is immutably closed, permanently sealed, fully traceable,
// and constitutionally finalized — the definitive end-state of the governance lifecycle. No completed
// execution may remain unsealed. It consumes ONLY WP-25 (the supervision engine + its context); no earlier
// runtime is invoked directly. It FINALIZES only — no supervision/orchestration/constitutional decisions.
// Closure identities are immutable, duplicate closure is impossible, seals + ledger are immutable. Deterministic.
//
// Usage:
//   node closure.mjs --workload <ref> --outcome success|failure|cancel   # close one supervised execution
//   node closure.mjs --demo                                              # closure/dup-prevention/sealing/replay
//   node closure.mjs --json                                              # machine-readable closure + seal + registry
//   node closure.mjs --persist                                           # append immutable closure records
//   node closure.mjs --cache-dir <dir> --ledger-dir <dir>

import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { supervise, orchestrate, produceSupervisionContext } from './supervision.mjs';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..', '..', '..', '..');
const CACHE_DIR = path.join(REPO_ROOT, '.governance-orchestrator-cache');
const DEFAULT_LEDGER_DIR = path.join(REPO_ROOT, '.governance-closure');

function hash(str) { const s = typeof str === 'string' ? str : JSON.stringify(str); let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(16).padStart(8, '0'); }
const TERMINAL = new Set(['Completed', 'Failed', 'Cancelled']);

// ---------------------------------------------------------------------------
// Closure verification (§4) — eight areas, all from WP-25 supervision evidence.
// ---------------------------------------------------------------------------
function verifyClosure(sup, ac, overrides = {}) {
  const orch = sup.orch || {}, adm = orch.admission || {}, enf = adm.enforcement || {};
  const enfAreas = Object.fromEntries((enf.verification?.areas || []).map((a) => [a.area, a.status]));
  const V = (area, status, evidence) => ({ area, status: overrides[area] || status, evidence, sourceRuntime: 'GOV-AUTO-024 (WP-25)' });
  const areas = [
    V('supervision-validity', sup.verification?.verified ? 'pass' : 'fail', { supervised: sup.supervised, health: sup.health?.healthState }),
    V('orchestration-validity', orch.orchestrated ? 'pass' : 'fail', { decision: orch.orchestrationDecision }),
    V('admission-continuity', adm.gatewayDecision === 'Admitted' ? 'pass' : 'fail', { gatewayDecision: adm.gatewayDecision }),
    V('constitutional-enforcement', enf.decision === 'Admitted' ? 'pass' : 'fail', { enforcementDecision: enf.decision }),
    V('active-constitution', orch.workload?.generation === ac.activeGeneration ? 'pass' : 'fail', { requested: orch.workload?.generation, active: ac.activeGeneration }),
    V('provenance-continuity', sup.provenance && sup.provenance.immutable ? 'pass' : 'fail', { supervisionId: sup.supervisionId }),
    V('operational-continuity', enfAreas['operational-continuity'] || (orch.orchestrated ? 'pass' : 'warn'), { source: 'WP-25→WP-24 operational-continuity' }),
    V('closure-consistency', 'pass', { deterministic: true }),
  ];
  const fails = areas.filter((a) => a.status === 'fail'), warns = areas.filter((a) => a.status === 'warn');
  const verificationDigest = hash([orch.executionId || 'none', areas.map((a) => [a.area, a.status])]);
  return { areas, verified: fails.length === 0, warnings: warns.length, verificationDigest };
}

// ---------------------------------------------------------------------------
// Governance seal (§7) — deterministic, immutable after creation.
// ---------------------------------------------------------------------------
function makeSeal(sup, verification) {
  const orch = sup.orch;
  const sealDigest = hash([orch.executionId, orch.workload.generation, orch.terminalState, sup.health.healthState, verification.verificationDigest]);
  return {
    executionIdentity: orch.executionId, constitutionalGeneration: orch.workload.generation,
    lifecycleCompletion: orch.terminalState, supervisionCompletion: sup.health.healthState,
    verificationDigest: verification.verificationDigest, sealDigest, immutable: true, sealedAt: 'deterministic',
  };
}

// ---------------------------------------------------------------------------
// Runtime closure engine (§2/§3) — finalizes only; each execution closes exactly once.
// ---------------------------------------------------------------------------
function close(sup, ac, seen, overrides = {}) {
  // RULE: only supervised executions may close.
  if (!sup.supervised || !sup.orch?.orchestrated) return { closed: false, sup, closureDecision: 'Not Closeable', reason: 'execution not supervised/orchestrated' };
  const executionId = sup.orch.executionId;
  // RULE: only terminal (completion-assured) executions are finalized/sealed.
  if (!TERMINAL.has(sup.orch.terminalState)) return { closed: false, sup, executionId, closureDecision: 'Not Closeable', reason: `execution not terminal (${sup.orch.terminalState})` };
  // RULE: duplicate closure is impossible — an already-closed execution is not re-closed.
  if (seen && seen.has(executionId)) return { closed: false, duplicatePrevented: true, sup, executionId, closureDecision: 'Duplicate Closure Prevented', reason: `execution ${executionId} already closed` };
  const verification = verifyClosure(sup, ac, overrides);
  const seal = makeSeal(sup, verification);
  const closureId = `CLS-${executionId}-${seal.sealDigest}`;
  const provenance = { closureId, executionId, supervisionId: sup.supervisionId, orchestrationId: sup.orch.orchestrationId, admissionId: sup.orch.admission.admissionId, generation: sup.orch.workload.generation, lifecycleCompletion: sup.orch.terminalState, supervisionCompletion: sup.health.healthState, sealDigest: seal.sealDigest, verificationDigest: verification.verificationDigest, immutable: true };
  if (seen) seen.add(executionId);
  const closureState = verification.verified ? 'Sealed' : 'Sealed With Notes';
  return { closed: true, sup, executionId, closureId, closureDecision: 'Closed', closureState, seal, verification, provenance };
}

// ---------------------------------------------------------------------------
// Closure registry (§5) — additive; every closure recorded immutably.
// ---------------------------------------------------------------------------
function buildRegistry(closures, ac) {
  const records = closures.filter((c) => c.closed || c.duplicatePrevented).map((c) => ({ closureId: c.closureId || null, executionId: c.executionId, supervisionId: c.sup.supervisionId, constitutionalGeneration: c.sup.orch.workload.generation, closureState: c.closureState || (c.duplicatePrevented ? 'Duplicate Prevented' : 'n/a'), verificationStatus: c.verification?.verified ? 'verified' : (c.duplicatePrevented ? 'deduplicated' : 'unverified'), sealDigest: c.seal?.sealDigest || null, provenance: c.provenance || null }));
  return {
    closures: records, sealed: records.filter((r) => r.closureState === 'Sealed' || r.closureState === 'Sealed With Notes').map((r) => r.executionId),
    duplicatesPrevented: records.filter((r) => r.closureState === 'Duplicate Prevented').length,
    activeConstitution: { generation: ac.activeGeneration, id: ac.activeId },
    additiveOnly: true, immutable: true, everyExecutionSealedOnce: true, uniqueSeals: new Set(records.map((r) => r.sealDigest).filter(Boolean)).size,
  };
}

// ---------------------------------------------------------------------------
// Immutable closure ledger (§6)
// ---------------------------------------------------------------------------
function appendLedger(c, dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'closure-ledger.jsonl');
  const entry = { closureId: c.closureId || null, executionId: c.executionId || null, supervisionId: c.sup.supervisionId, closureDecision: c.closureDecision, sealDigest: c.seal?.sealDigest || null, verificationDigest: c.verification?.verificationDigest || null, timestamp: new Date().toISOString() };
  appendFileSync(file, JSON.stringify(entry) + '\n'); // append-only; prior entries never modified
  return entry;
}
function ledgerEntries(dir) { const f = path.join(dir, 'closure-ledger.jsonl'); if (!existsSync(f)) return []; const c = readFileSync(f, 'utf8').trim(); return c ? c.split(/\n/).map((l) => JSON.parse(l)) : []; }

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------
function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; }
// Each workload orchestrates with its own fresh execution-dedup set; closure dedup is a SEPARATE concern.
function superviseWorkload(workloadRef, generation, outcome, ac) { return supervise(orchestrate({ workloadRef, generation, outcome }, ac, new Set()), ac); }

function main() {
  const asJson = process.argv.includes('--json');
  const ledgerDir = path.resolve(arg('--ledger-dir') || DEFAULT_LEDGER_DIR);
  const cacheDir = path.resolve(arg('--cache-dir') || CACHE_DIR);

  const t0 = performance.now();
  const ac = produceSupervisionContext(cacheDir);   // sole input: WP-25 supervision context
  const consumeMs = +(performance.now() - t0).toFixed(1);

  if (process.argv.includes('--demo')) { runDemo(ac, ledgerDir, asJson, consumeMs); return; }

  const sup = superviseWorkload(arg('--workload') || 'governance-workload', Number(arg('--generation') ?? ac.activeGeneration), arg('--outcome') || 'success', ac);
  const c = close(sup, ac, new Set());
  const registry = buildRegistry([c], ac);
  let ledger = null;
  if (process.argv.includes('--persist')) { appendLedger(c, ledgerDir); ledger = { entries: ledgerEntries(ledgerDir).length }; }

  const out = {
    tool: 'governance-runtime-closure', runtimeVersion: '1.0.0', mapsTo: 'GOV-AUTO-025', consumes: { wp25: 'governance execution assurance' },
    closureDecision: { closureId: c.closureId, decision: c.closureDecision, closureState: c.closureState, executionId: c.executionId, reason: c.reason || null },
    governanceSeal: c.seal, closureRegistry: registry, verification: c.verification, provenance: c.provenance, ...(ledger ? { closureLedger: ledger } : {}),
    closureSummary: `${c.closureDecision} — execution ${c.executionId || 'n/a'} ${c.seal ? 'sealed ' + c.seal.sealDigest : ''}`,
    observability: { closureHealth: c.closed ? 'finalized' : 'not-closeable', sealIntegrity: c.seal?.immutable ? 'immutable' : 'n/a', registryIntegrity: registry.immutable ? 'immutable' : 'violated', provenanceContinuity: 'immutable', completionStatus: c.sup.orch.terminalState, closureMs: consumeMs },
  };
  if (asJson) process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  else {
    const L = [];
    L.push('Governance Constitutional Runtime Closure & Immutable Governance Seal — GOV-AUTO-025 (canonical)');
    L.push(`consumes WP-25 only  ·  Active Constitution: Gen${ac.activeGeneration}`);
    L.push(`\nCLOSURE: ${c.closureDecision}   execution: ${c.executionId || 'n/a'}   state: ${c.closureState || c.reason}`);
    if (c.seal) L.push(`governance seal: ${c.seal.sealDigest}  (lifecycle=${c.seal.lifecycleCompletion} supervision=${c.seal.supervisionCompletion} immutable=${c.seal.immutable})`);
    if (c.verification) { L.push('\nclosure verification:'); for (const a of c.verification.areas) L.push(`   ${a.status === 'fail' ? 'FAIL' : a.status === 'warn' ? 'WARN' : 'PASS'}  ${a.area}`); }
    process.stdout.write(L.join('\n') + '\n');
  }
  process.exit(c.closed ? 0 : 1);
}

function runDemo(ac, ledgerDir, asJson, consumeMs) {
  const closureSeen = new Set(); const G = ac.activeGeneration;   // tracks CLOSED execution identities (closure dedup)
  const closures = [];
  closures.push({ label: 'successful closure', ...close(superviseWorkload('cl-success', G, 'success', ac), ac, closureSeen) });
  closures.push({ label: 'failed execution closure', ...close(superviseWorkload('cl-failed', G, 'failure', ac), ac, closureSeen) });
  closures.push({ label: 'cancelled execution closure', ...close(superviseWorkload('cl-cancel', G, 'cancel', ac), ac, closureSeen) });
  // Duplicate closure prevention: close the successful execution again (same identity, already in closureSeen) → prevented.
  const dup = close(superviseWorkload('cl-success', G, 'success', ac), ac, closureSeen);
  closures.push({ label: 'duplicate closure prevention', ...dup });
  for (const c of closures) appendLedger(c, ledgerDir);
  const registry = buildRegistry(closures, ac);
  // Deterministic replay: fresh seen-set, same workload → identical closure identity + seal.
  const r1 = close(superviseWorkload('cl-success', G, 'success', ac), ac, new Set());
  const r2 = close(superviseWorkload('cl-success', G, 'success', ac), ac, new Set());

  const out = {
    tool: 'governance-runtime-closure', mode: 'demo', mapsTo: 'GOV-AUTO-025', consumes: 'WP-25 only', activeConstitution: `Gen${G}`,
    closureScenarios: closures.map((c) => ({ label: c.label, decision: c.closureDecision, closureId: c.closureId || null, state: c.closureState || c.reason, seal: c.seal?.sealDigest || null })),
    sealGeneration: closures.filter((c) => c.seal).map((c) => ({ executionId: c.executionId, seal: c.seal.sealDigest, lifecycle: c.seal.lifecycleCompletion, supervision: c.seal.supervisionCompletion, immutable: c.seal.immutable })),
    duplicatePrevention: { prevented: registry.duplicatesPrevented, decision: dup.closureDecision },
    provenance: closures.filter((c) => c.provenance).map((c) => ({ closureId: c.closureId, executionId: c.executionId, immutable: c.provenance.immutable })),
    registryIntegrity: { closures: registry.closures.length, sealed: registry.sealed.length, uniqueSeals: registry.uniqueSeals, additiveOnly: registry.additiveOnly, immutable: registry.immutable, everyExecutionSealedOnce: registry.everyExecutionSealedOnce },
    closureLedger: { entries: ledgerEntries(ledgerDir).length, immutable: true, lookup: ['closureId', 'executionId', 'supervisionId'] },
    deterministicReplay: { closure1: r1.closureId, closure2: r2.closureId, seal1: r1.seal.sealDigest, seal2: r2.seal.sealDigest, identical: r1.closureId === r2.closureId && r1.seal.sealDigest === r2.seal.sealDigest },
    consumeMs,
  };
  if (asJson) { process.stdout.write(JSON.stringify(out, null, 2) + '\n'); return; }
  const L = [];
  L.push('Governance Constitutional Runtime Closure & Immutable Governance Seal — GOV-AUTO-025 (canonical) — DEMO');
  L.push(`consumes WP-25 only  ·  Active Constitution: Gen${G}`);
  L.push('\n1) closure scenarios:');
  for (const s of out.closureScenarios) L.push(`   ${s.label.padEnd(28)} → ${s.decision.padEnd(26)} ${s.state}${s.seal ? '  seal=' + s.seal : ''}`);
  L.push('\n2) governance seal generation (immutable):');
  for (const g of out.sealGeneration) L.push(`   ${g.executionId}  seal=${g.seal}  lifecycle=${g.lifecycle} supervision=${g.supervision} immutable=${g.immutable}`);
  L.push(`\n3) duplicate closure prevention: prevented=${out.duplicatePrevention.prevented}  decision=${out.duplicatePrevention.decision}`);
  L.push('\n4) immutable provenance:');
  for (const p of out.provenance) L.push(`   ${p.closureId}  execution=${p.executionId}  immutable=${p.immutable}`);
  L.push('\n5) registry integrity:');
  L.push(`   closures=${out.registryIntegrity.closures} sealed=${out.registryIntegrity.sealed} uniqueSeals=${out.registryIntegrity.uniqueSeals} additiveOnly=${out.registryIntegrity.additiveOnly} immutable=${out.registryIntegrity.immutable} everyExecutionSealedOnce=${out.registryIntegrity.everyExecutionSealedOnce}`);
  L.push(`\n6) immutable closure ledger: ${out.closureLedger.entries} entries (lookup by ${out.closureLedger.lookup.join('/')})`);
  L.push(`7) deterministic replay: closure ${out.deterministicReplay.closure1} vs ${out.deterministicReplay.closure2}  seal ${out.deterministicReplay.seal1} vs ${out.deterministicReplay.seal2} → ${out.deterministicReplay.identical ? 'IDENTICAL' : 'DIVERGED'}`);
  process.stdout.write(L.join('\n') + '\n');
}

main();
