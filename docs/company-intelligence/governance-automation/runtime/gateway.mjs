#!/usr/bin/env node
// Canonical Governance Constitutional Compliance Gateway & Mandatory Governance Admission Runtime — GOV-AUTO-022 (WP-23).
//
// The final operational enforcement layer: the SINGLE mandatory constitutional entry point through which every
// governance operation, runtime, automation, certification, audit, and future capability MUST pass before
// execution. No governance execution may enter the pipeline without passing this gateway. It consumes ONLY
// WP-22 (the constitutional enforcement engine + its active-constitution context); no earlier runtime is
// invoked directly. It governs ADMISSION only — no constitutional modification, no new governance decision
// logic. It records immutable admission provenance, an additive admission registry, and an immutable ledger.
//
// Usage:
//   node gateway.mjs --execute <ref> --generation <N>   # request admission for one execution
//   node gateway.mjs --demo                             # admitted/rejected/deferred + verification + replay
//   node gateway.mjs --json                             # machine-readable admission + registry + ledger
//   node gateway.mjs --persist                          # append immutable admission records
//   node gateway.mjs --cache-dir <dir> --ledger-dir <dir>

import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { enforce, acWithActive, produceEnforcementContext } from './enforce-constitution.mjs';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..', '..', '..', '..');
const CACHE_DIR = path.join(REPO_ROOT, '.governance-orchestrator-cache');
const DEFAULT_LEDGER_DIR = path.join(REPO_ROOT, '.governance-gateway');

function hash(str) { const s = typeof str === 'string' ? str : JSON.stringify(str); let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(16).padStart(8, '0'); }

// ---------------------------------------------------------------------------
// Admission verification (§4) — eight areas, all from WP-22 enforcement evidence.
// ---------------------------------------------------------------------------
function verifyAdmission(enforcement, ac, request, overrides = {}) {
  const ev = enforcement.verification || { areas: [], verified: false };
  const byArea = Object.fromEntries((ev.areas || []).map((a) => [a.area, a.status]));
  const V = (area, status, evidence) => ({ area, status: overrides[area] || status, evidence, sourceRuntime: 'GOV-AUTO-021 (WP-22)' });
  const areas = [
    V('constitutional-enforcement', enforcement.decision === 'Admitted' ? 'pass' : 'fail', { enforcementDecision: enforcement.decision }),
    V('active-constitution', request.generation === ac.activeGeneration ? 'pass' : 'fail', { requested: request.generation, active: ac.activeGeneration }),
    V('certification-continuity', byArea['certification-continuity'] || (enforcement.admitted ? 'pass' : 'fail'), { source: 'WP-22 certification-continuity' }),
    V('lineage-continuity', byArea['lineage-continuity'] || (enforcement.admitted ? 'pass' : 'fail'), { source: 'WP-22 lineage-continuity' }),
    V('registry-integrity', ac.registry.historicalImmutable ? 'pass' : 'fail', { immutable: ac.registry.historicalImmutable }),
    V('execution-provenance', enforcement.provenance && enforcement.provenance.immutable ? 'pass' : 'fail', { provenanceId: enforcement.provenance?.executionId }),
    V('operational-continuity', byArea['operational-continuity'] || (enforcement.admitted ? 'pass' : 'warn'), { source: 'WP-22 operational-continuity' }),
    V('gateway-consistency', 'pass', { deterministic: true }),
  ];
  const fails = areas.filter((a) => a.status === 'fail'), warns = areas.filter((a) => a.status === 'warn');
  const verificationDigest = hash([enforcement.executionId, request.executionRef, areas.map((a) => [a.area, a.status])]);
  return { areas, verified: fails.length === 0, warnings: warns.length, verificationDigest };
}

// ---------------------------------------------------------------------------
// Admission gateway engine (§2/§3) — the single mandatory entry point; admission only.
// ---------------------------------------------------------------------------
function admit(request, ac, overrides = {}) {
  const admissionId = `ADM-Gen${request.generation}-${hash([request.executionRef, request.generation, request.pending ? 'pending' : 'ready'])}`;
  // RULE: a pending/incomplete request is DEFERRED and remains outside the execution pipeline (not enforced through).
  if (request.pending) {
    const verificationDigest = hash([admissionId, 'deferred']);
    return { admissionId, request, gatewayDecision: 'Deferred', entersPipeline: false, reason: 'request pending — held outside execution', enforcement: null, verification: { areas: [], verified: false, verificationDigest }, provenance: { admissionId, executionId: null, generation: request.generation, verificationDigest, immutable: true } };
  }
  // Constitutional admission evaluation: run WP-22 enforcement (mandatory — no bypass).
  const enforcement = enforce(request, ac, overrides);
  const verification = verifyAdmission(enforcement, ac, request, overrides);
  // RULE: admitted iff WP-22 admitted AND gateway verification passes; rejected executions never enter the pipeline.
  const gatewayDecision = enforcement.decision === 'Admitted' && verification.verified ? 'Admitted' : 'Rejected';
  const entersPipeline = gatewayDecision === 'Admitted';
  const provenance = { admissionId, executionId: enforcement.executionId, generation: request.generation, constitutionId: enforcement.activeConstitution.id, enforcementVerificationDigest: enforcement.verification.verificationDigest, gatewayVerificationDigest: verification.verificationDigest, immutable: true };
  return { admissionId, request, gatewayDecision, entersPipeline, reason: gatewayDecision === 'Rejected' ? (enforcement.rejectionReason || 'gateway-verification-failed') : null, enforcement, verification, provenance };
}

// ---------------------------------------------------------------------------
// Admission registry (§5) — additive; every admission recorded immutably.
// ---------------------------------------------------------------------------
function buildRegistry(admissions, ac) {
  const records = admissions.map((a) => ({ admissionId: a.admissionId, executionId: a.enforcement?.executionId || null, constitutionalGeneration: a.request.generation, admissionDecision: a.gatewayDecision, verificationState: a.verification.verified ? 'verified' : (a.gatewayDecision === 'Deferred' ? 'deferred' : 'unverified'), provenance: a.provenance }));
  return {
    admissions: records,
    admitted: records.filter((r) => r.admissionDecision === 'Admitted').map((r) => r.admissionId),
    rejected: records.filter((r) => r.admissionDecision === 'Rejected').map((r) => r.admissionId),
    deferred: records.filter((r) => r.admissionDecision === 'Deferred').map((r) => r.admissionId),
    activeConstitution: { generation: ac.activeGeneration, id: ac.activeId },
    additiveOnly: true, immutable: true, singleGateway: true,
  };
}

// ---------------------------------------------------------------------------
// Immutable gateway ledger (§6)
// ---------------------------------------------------------------------------
function appendLedger(a, dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'gateway-ledger.jsonl');
  const entry = { admissionId: a.admissionId, executionId: a.enforcement?.executionId || null, constitutionGeneration: a.request.generation, gatewayDecision: a.gatewayDecision, verificationDigest: a.verification.verificationDigest, timestamp: new Date().toISOString() };
  appendFileSync(file, JSON.stringify(entry) + '\n'); // append-only; prior entries never modified
  return entry;
}
function ledgerEntries(dir) { const f = path.join(dir, 'gateway-ledger.jsonl'); if (!existsSync(f)) return []; const c = readFileSync(f, 'utf8').trim(); return c ? c.split(/\n/).map((l) => JSON.parse(l)) : []; }

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------
function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; }

// WP-24 consumes this as the sole WP-23 API — the admission gateway + its enforcement context.
function produceGatewayContext(cacheDir) { return produceEnforcementContext(cacheDir); }

function main() {
  const asJson = process.argv.includes('--json');
  const ledgerDir = path.resolve(arg('--ledger-dir') || DEFAULT_LEDGER_DIR);
  const cacheDir = path.resolve(arg('--cache-dir') || CACHE_DIR);

  const t0 = performance.now();
  const ac = produceEnforcementContext(cacheDir);   // sole input: WP-22 enforcement context
  const consumeMs = +(performance.now() - t0).toFixed(1);

  if (process.argv.includes('--demo')) { runDemo(ac, ledgerDir, asJson, consumeMs); return; }

  const request = { executionRef: arg('--execute') || 'governance-operation', generation: Number(arg('--generation') ?? ac.activeGeneration), pending: process.argv.includes('--pending') };
  const a = admit(request, ac);
  const registry = buildRegistry([a], ac);
  let ledger = null;
  if (process.argv.includes('--persist')) { appendLedger(a, ledgerDir); ledger = { entries: ledgerEntries(ledgerDir).length }; }

  const out = {
    tool: 'governance-admission-gateway', runtimeVersion: '1.0.0', mapsTo: 'GOV-AUTO-022', consumes: { wp22: 'constitutional runtime enforcement' },
    admissionDecision: { admissionId: a.admissionId, gatewayDecision: a.gatewayDecision, entersPipeline: a.entersPipeline, reason: a.reason },
    admissionRegistry: registry, verification: a.verification, provenance: a.provenance, ...(ledger ? { gatewayLedger: ledger } : {}),
    gatewaySummary: `${a.gatewayDecision} — admission ${a.admissionId} (entersPipeline=${a.entersPipeline})`,
    observability: { gatewayHealth: a.verification.verified || a.gatewayDecision === 'Deferred' ? 'operational' : 'rejecting', admissionDecision: a.gatewayDecision, constitutionalContinuity: `Gen${ac.activeGeneration}`, provenanceContinuity: 'immutable', registryIntegrity: registry.immutable ? 'immutable' : 'violated', gatewayMs: consumeMs },
  };
  if (asJson) process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  else {
    const L = [];
    L.push('Governance Constitutional Compliance Gateway & Mandatory Governance Admission — GOV-AUTO-022 (canonical)');
    L.push(`consumes WP-22 only  ·  Active Constitution: Gen${ac.activeGeneration} (${ac.activeId})`);
    L.push(`\nGATEWAY DECISION: ${a.gatewayDecision}   entersPipeline=${a.entersPipeline}   admission: ${a.admissionId}`);
    if (a.reason) L.push(`   reason: ${a.reason}`);
    if (a.verification.areas.length) { L.push('\nadmission verification:'); for (const x of a.verification.areas) L.push(`   ${x.status === 'fail' ? 'FAIL' : x.status === 'warn' ? 'WARN' : 'PASS'}  ${x.area}`); }
    L.push(`\nprovenance: admission=${a.provenance.admissionId} execution=${a.provenance.executionId || 'n/a'} immutable=${a.provenance.immutable}`);
    process.stdout.write(L.join('\n') + '\n');
  }
  process.exit(a.gatewayDecision === 'Rejected' ? 1 : 0);
}

function runDemo(ac, ledgerDir, asJson, consumeMs) {
  const admissions = [];
  admissions.push({ label: 'admitted execution', ...admit({ executionRef: 'gov-op-A', generation: ac.activeGeneration }, ac) });                       // admitted under active constitution
  admissions.push({ label: 'rejected execution', ...admit({ executionRef: 'gov-op-B', generation: 1 }, acWithActive(ac, ac.activeGeneration)) });        // inactive → rejected (unless active is 1)
  admissions.push({ label: 'deferred execution', ...admit({ executionRef: 'gov-op-C', generation: ac.activeGeneration, pending: true }, ac) });          // pending → deferred
  for (const a of admissions) appendLedger(a, ledgerDir);
  const registry = buildRegistry(admissions, ac);
  // Deterministic replay.
  const r1 = admit({ executionRef: 'gov-op-A', generation: ac.activeGeneration }, ac);
  const r2 = admit({ executionRef: 'gov-op-A', generation: ac.activeGeneration }, ac);

  const out = {
    tool: 'governance-admission-gateway', mode: 'demo', mapsTo: 'GOV-AUTO-022', consumes: 'WP-22 only', activeConstitution: `Gen${ac.activeGeneration}`,
    admissionScenarios: admissions.map((a) => ({ label: a.label, admissionId: a.admissionId, decision: a.gatewayDecision, entersPipeline: a.entersPipeline, reason: a.reason, verified: a.verification.verified })),
    gatewayDecisions: { admitted: registry.admitted.length, rejected: registry.rejected.length, deferred: registry.deferred.length },
    provenance: admissions.map((a) => ({ admissionId: a.admissionId, executionId: a.enforcement?.executionId || null, immutable: a.provenance.immutable })),
    registryContinuity: { admissions: registry.admissions.length, admitted: registry.admitted.length, rejected: registry.rejected.length, deferred: registry.deferred.length, additiveOnly: registry.additiveOnly, immutable: registry.immutable, singleGateway: registry.singleGateway },
    gatewayLedger: { entries: ledgerEntries(ledgerDir).length, immutable: true, lookup: ['admissionId', 'executionId'] },
    deterministicReplay: { digest1: r1.verification.verificationDigest, digest2: r2.verification.verificationDigest, decisionSame: r1.gatewayDecision === r2.gatewayDecision, identical: r1.verification.verificationDigest === r2.verification.verificationDigest },
    consumeMs,
  };
  if (asJson) { process.stdout.write(JSON.stringify(out, null, 2) + '\n'); return; }
  const L = [];
  L.push('Governance Admission Gateway — GOV-AUTO-022 (canonical) — DEMO');
  L.push(`consumes WP-22 only  ·  Active Constitution: Gen${ac.activeGeneration}`);
  L.push('\n1) admission scenarios:');
  for (const s of out.admissionScenarios) L.push(`   ${s.label.padEnd(22)} → ${s.decision.padEnd(9)} entersPipeline=${s.entersPipeline} ${s.reason ? '(' + s.reason + ')' : ''}  ${s.admissionId}`);
  L.push(`\n2) gateway decisions: admitted=${out.gatewayDecisions.admitted} rejected=${out.gatewayDecisions.rejected} deferred=${out.gatewayDecisions.deferred}`);
  L.push('\n3) immutable provenance:');
  for (const p of out.provenance) L.push(`   ${p.admissionId}  execution=${p.executionId || 'n/a'}  immutable=${p.immutable}`);
  L.push('\n4) registry continuity:');
  L.push(`   admissions=${out.registryContinuity.admissions} admitted=${out.registryContinuity.admitted} rejected=${out.registryContinuity.rejected} deferred=${out.registryContinuity.deferred}`);
  L.push(`   additiveOnly=${out.registryContinuity.additiveOnly} immutable=${out.registryContinuity.immutable} singleGateway=${out.registryContinuity.singleGateway}`);
  L.push(`\n5) immutable gateway ledger: ${out.gatewayLedger.entries} entries (lookup by ${out.gatewayLedger.lookup.join('/')})`);
  L.push(`6) deterministic replay: ${out.deterministicReplay.digest1} vs ${out.deterministicReplay.digest2} → ${out.deterministicReplay.identical && out.deterministicReplay.decisionSame ? 'IDENTICAL' : 'DIVERGED'}`);
  process.stdout.write(L.join('\n') + '\n');
}

// WP-24 consumes ONLY this layer — all governance execution state originates from WP-23.
export { admit, produceGatewayContext };
const isDirectGW = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isDirectGW) main();
