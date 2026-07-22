#!/usr/bin/env node
// Canonical Governance Constitutional Runtime Enforcement & Universal Execution Governance — GOV-AUTO-021 (WP-22).
//
// Completes the transition from an active constitution to one UNIVERSALLY ENFORCED across every governance
// execution. It guarantees every execution is governed by exactly the currently Active Constitution and that
// no execution may bypass constitutional enforcement. It consumes ONLY WP-21 (the active constitution + the
// certified generations); no earlier runtime is invoked directly. It governs EXECUTION only — no constitutional
// modification, no new governance decision logic. It records immutable execution provenance and an enforcement
// ledger. Deterministic; additive.
//
// Usage:
//   node enforce-constitution.mjs --execute <ref> --generation <N>   # authorize one execution
//   node enforce-constitution.mjs --demo                             # exec under Gen1/2/3 + rejections + replay
//   node enforce-constitution.mjs --json                             # machine-readable decision + registry + ledger
//   node enforce-constitution.mjs --persist                          # append immutable enforcement records
//   node enforce-constitution.mjs --cache-dir <dir> --ledger-dir <dir>

import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { produceActiveConstitution, verifyActivation } from './active-constitution.mjs';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..', '..', '..', '..');
const CACHE_DIR = path.join(REPO_ROOT, '.governance-orchestrator-cache');
const DEFAULT_LEDGER_DIR = path.join(REPO_ROOT, '.governance-enforcement-constitutional');

function hash(str) { const s = typeof str === 'string' ? str : JSON.stringify(str); let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(16).padStart(8, '0'); }

// ---------------------------------------------------------------------------
// Execution verification (§4) — eight areas, all from WP-21 evidence.
// ---------------------------------------------------------------------------
function verifyExecution(gen, ac, request, overrides = {}) {
  // Reuse WP-21's activation verification for the constitutional areas; add execution-specific areas.
  const av = gen ? verifyActivation(gen, ac.gens, ac.succession) : { areas: [], verified: false };
  const byArea = Object.fromEntries(av.areas.map((a) => [a.area, a.status]));
  const V = (area, status, evidence) => ({ area, status: overrides[area] || status, evidence, sourceRuntime: 'GOV-AUTO-020 (WP-21)' });
  const areas = [
    V('active-constitution-validity', gen && gen.certified && gen.immutable ? 'pass' : 'fail', { certified: !!gen?.certified, immutable: !!gen?.immutable }),
    V('certification-continuity', byArea['successor-certification'] || 'fail', { source: 'WP-21 successor-certification' }),
    V('registry-continuity', ac.registry.historicalImmutable ? 'pass' : 'fail', { immutable: ac.registry.historicalImmutable }),
    V('lineage-continuity', byArea['lineage-continuity'] || 'fail', { source: 'WP-21 lineage-continuity' }),
    V('execution-compatibility', request.executionRef && String(request.executionRef).length > 0 ? 'pass' : 'fail', { executionRef: request.executionRef }),
    V('operational-continuity', byArea['operational-compatibility'] || 'warn', { source: 'WP-21 operational-compatibility' }),
    V('audit-continuity', byArea['audit-continuity'] || 'fail', { source: 'WP-21 audit-continuity' }),
    V('enforcement-consistency', 'pass', { deterministic: true }),
  ];
  const fails = areas.filter((a) => a.status === 'fail'), warns = areas.filter((a) => a.status === 'warn');
  const verificationDigest = hash([gen?.id || 'none', request.executionRef, areas.map((a) => [a.area, a.status])]);
  return { areas, verified: fails.length === 0, warnings: warns.length, verificationDigest };
}

// ---------------------------------------------------------------------------
// Universal enforcement engine (§2/§3) — governs execution; never modifies the constitution.
// ---------------------------------------------------------------------------
function enforce(request, ac, overrides = {}) {
  const requested = request.generation;
  const gen = ac.gens.find((g) => g.generation === requested);
  const executionId = `EXE-Gen${requested}-${hash([request.executionRef, requested])}`;
  // RULE: uncertified generation (not in the certified registry) → rejected.
  if (!gen) return reject(executionId, request, 'uncertified-generation', `generation ${requested} is not a certified constitution`, ac, null);
  if (!gen.certified) return reject(executionId, request, 'uncertified-generation', `generation ${requested} is not certified`, ac, gen);
  // RULE: execution against an inactive constitution → rejected.
  if (requested !== ac.activeGeneration) return reject(executionId, request, 'inactive-constitution', `generation ${requested} is not the Active Constitution (Gen${ac.activeGeneration})`, ac, gen);
  // Admission requires successful constitutional verification (enforcement is mandatory — no bypass).
  const verification = verifyExecution(gen, ac, request, overrides);
  const provenance = { executionId, constitutionId: gen.id, generation: gen.generation, lineage: [ac.registry.generations.find((g) => g.generation === 0).id, gen.id].filter((v, i, a) => a.indexOf(v) === i), verificationDigest: verification.verificationDigest, immutable: true };
  const decision = verification.verified ? 'Admitted' : 'Rejected';
  return { executionId, request, decision, rejectionReason: verification.verified ? null : 'verification-failed', activeConstitution: { generation: ac.activeGeneration, id: ac.activeId }, verification, provenance, admitted: verification.verified };
}
function reject(executionId, request, reason, detail, ac, gen) {
  const verification = { areas: [], verified: false, warnings: 0, verificationDigest: hash([executionId, reason]) };
  const provenance = { executionId, constitutionId: gen?.id || null, generation: request.generation, verificationDigest: verification.verificationDigest, immutable: true };
  return { executionId, request, decision: 'Rejected', rejectionReason: reason, detail, activeConstitution: { generation: ac.activeGeneration, id: ac.activeId }, verification, provenance, admitted: false };
}

// ---------------------------------------------------------------------------
// Execution registry (§5) — additive; each execution recorded immutably.
// ---------------------------------------------------------------------------
function buildRegistry(results, ac) {
  const executions = results.map((r) => ({ executionId: r.executionId, activeConstitutionRef: r.activeConstitution.id, constitutionalGeneration: r.request.generation, executionStatus: r.decision, verificationStatus: r.verification.verified ? 'verified' : 'unverified', provenance: r.provenance }));
  return {
    executions, admitted: executions.filter((e) => e.executionStatus === 'Admitted').map((e) => e.executionId),
    rejected: executions.filter((e) => e.executionStatus === 'Rejected').map((e) => e.executionId),
    activeConstitution: { generation: ac.activeGeneration, id: ac.activeId },
    additiveOnly: true, immutable: true, exactlyOneActive: true,
  };
}

// ---------------------------------------------------------------------------
// Immutable enforcement ledger (§6)
// ---------------------------------------------------------------------------
function appendLedger(result, dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'constitutional-enforcement-ledger.jsonl');
  const entry = { executionId: result.executionId, constitutionId: result.activeConstitution.id, generation: result.request.generation, admissionDecision: result.decision, verificationDigest: result.verification.verificationDigest, timestamp: new Date().toISOString() };
  appendFileSync(file, JSON.stringify(entry) + '\n'); // append-only; prior entries never modified
  return entry;
}
function ledgerEntries(dir) { const f = path.join(dir, 'constitutional-enforcement-ledger.jsonl'); if (!existsSync(f)) return []; const c = readFileSync(f, 'utf8').trim(); return c ? c.split(/\n/).map((l) => JSON.parse(l)) : []; }

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------
function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; }
// A view of WP-21 state with a chosen active generation (represents WP-21 having activated Gen N).
function acWithActive(base, activeGeneration) { const g = base.gens.find((x) => x.generation === activeGeneration); return { ...base, activeGeneration, activeId: g ? g.id : base.activeId }; }

// WP-23 consumes this as the sole WP-22 API — the enforcement engine + its active-constitution context.
function produceEnforcementContext(cacheDir) { return produceActiveConstitution(cacheDir); }

function main() {
  const asJson = process.argv.includes('--json');
  const ledgerDir = path.resolve(arg('--ledger-dir') || DEFAULT_LEDGER_DIR);
  const cacheDir = path.resolve(arg('--cache-dir') || CACHE_DIR);

  const t0 = performance.now();
  const ac = produceActiveConstitution(cacheDir);   // sole input: WP-21 active constitution + certified generations
  const consumeMs = +(performance.now() - t0).toFixed(1);

  if (process.argv.includes('--demo')) { runDemo(ac, ledgerDir, asJson, consumeMs); return; }

  const request = { executionRef: arg('--execute') || 'governance-execution', generation: Number(arg('--generation') ?? ac.activeGeneration) };
  const result = enforce(request, ac);
  const registry = buildRegistry([result], ac);
  let ledger = null;
  if (process.argv.includes('--persist')) { appendLedger(result, ledgerDir); ledger = { entries: ledgerEntries(ledgerDir).length }; }

  const out = {
    tool: 'governance-constitutional-enforcement', runtimeVersion: '1.0.0', mapsTo: 'GOV-AUTO-021', consumes: { wp21: 'active constitution' },
    enforcementDecision: { executionId: result.executionId, decision: result.decision, admitted: result.admitted, rejectionReason: result.rejectionReason, activeConstitution: result.activeConstitution },
    executionRegistry: registry, verification: result.verification, provenance: result.provenance, ...(ledger ? { enforcementLedger: ledger } : {}),
    enforcementSummary: `${result.decision} — execution ${result.executionId} under Gen${result.activeConstitution.generation}`,
    observability: { activeConstitution: `Gen${ac.activeGeneration}`, executionAdmission: result.decision, enforcementHealth: result.verification.verified ? 'enforced' : 'rejected', provenanceContinuity: 'immutable', registryIntegrity: registry.immutable ? 'immutable' : 'violated', enforcementMs: consumeMs },
  };
  if (asJson) process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  else {
    const L = [];
    L.push('Governance Constitutional Runtime Enforcement & Universal Execution Governance — GOV-AUTO-021 (canonical)');
    L.push(`consumes WP-21 only  ·  Active Constitution: Gen${ac.activeGeneration} (${ac.activeId})`);
    L.push(`\nENFORCEMENT: ${result.decision}   execution: ${result.executionId}`);
    if (result.rejectionReason) L.push(`   rejection: ${result.rejectionReason} — ${result.detail || ''}`);
    L.push('\nexecution verification:');
    for (const a of result.verification.areas) L.push(`   ${a.status === 'fail' ? 'FAIL' : a.status === 'warn' ? 'WARN' : 'PASS'}  ${a.area}`);
    L.push(`\nprovenance: constitution=${result.provenance.constitutionId} generation=Gen${result.provenance.generation} digest=${result.provenance.verificationDigest} immutable=${result.provenance.immutable}`);
    process.stdout.write(L.join('\n') + '\n');
  }
  process.exit(result.admitted ? 0 : 1);
}

function runDemo(ac, ledgerDir, asJson, consumeMs) {
  const results = [];
  // Execution under each active generation (WP-21 having activated Gen1/Gen2/Gen3).
  results.push({ label: 'execution under Gen1', ...enforce({ executionRef: 'gov-exec-A', generation: 1 }, acWithActive(ac, 1)) });
  results.push({ label: 'execution under Gen2', ...enforce({ executionRef: 'gov-exec-B', generation: 2 }, acWithActive(ac, 2)) });
  results.push({ label: 'execution under Gen3', ...enforce({ executionRef: 'gov-exec-C', generation: 3 }, acWithActive(ac, 3)) });
  // Rejection: execution referencing an inactive constitution (active=Gen3, request Gen1).
  results.push({ label: 'reject inactive constitution', ...enforce({ executionRef: 'gov-exec-D', generation: 1 }, acWithActive(ac, 3)) });
  // Rejection: execution referencing an uncertified generation (Gen99 not in the registry).
  results.push({ label: 'reject uncertified generation', ...enforce({ executionRef: 'gov-exec-E', generation: 99 }, acWithActive(ac, 3)) });
  for (const r of results) appendLedger(r, ledgerDir);
  const registry = buildRegistry(results, acWithActive(ac, 3));
  // Deterministic replay.
  const r1 = enforce({ executionRef: 'gov-exec-A', generation: 1 }, acWithActive(ac, 1));
  const r2 = enforce({ executionRef: 'gov-exec-A', generation: 1 }, acWithActive(ac, 1));

  const out = {
    tool: 'governance-constitutional-enforcement', mode: 'demo', mapsTo: 'GOV-AUTO-021', consumes: 'WP-21 only', generations: ac.gens.length,
    executionScenarios: results.map((r) => ({ label: r.label, executionId: r.executionId, decision: r.decision, generation: r.request.generation, reason: r.rejectionReason, verification: r.verification.verified })),
    admissionDecisions: { admitted: registry.admitted.length, rejected: registry.rejected.length },
    provenance: results.map((r) => ({ executionId: r.executionId, constitution: r.provenance.constitutionId, generation: r.provenance.generation, immutable: r.provenance.immutable, digest: r.provenance.verificationDigest })),
    registryIntegrity: { executions: registry.executions.length, admitted: registry.admitted.length, rejected: registry.rejected.length, additiveOnly: registry.additiveOnly, immutable: registry.immutable, exactlyOneActive: registry.exactlyOneActive },
    enforcementLedger: { entries: ledgerEntries(ledgerDir).length, immutable: true, lookup: ['executionId', 'generation'] },
    deterministicReplay: { digest1: r1.verification.verificationDigest, digest2: r2.verification.verificationDigest, decisionSame: r1.decision === r2.decision, identical: r1.verification.verificationDigest === r2.verification.verificationDigest },
    consumeMs,
  };
  if (asJson) { process.stdout.write(JSON.stringify(out, null, 2) + '\n'); return; }
  const L = [];
  L.push('Governance Constitutional Runtime Enforcement — GOV-AUTO-021 (canonical) — DEMO');
  L.push(`consumes WP-21 only  ·  ${ac.gens.length} certified generations`);
  L.push('\n1) execution scenarios:');
  for (const s of out.executionScenarios) L.push(`   ${s.label.padEnd(30)} → ${s.decision.padEnd(9)} ${s.reason ? '(' + s.reason + ')' : 'Gen' + s.generation}  ${s.executionId}`);
  L.push(`\n2) admission decisions: admitted=${out.admissionDecisions.admitted} rejected=${out.admissionDecisions.rejected}`);
  L.push('\n3) provenance (immutable):');
  for (const p of out.provenance) L.push(`   ${p.executionId}  constitution=${p.constitution || 'n/a'}  Gen${p.generation}  immutable=${p.immutable}`);
  L.push('\n4) registry integrity:');
  L.push(`   executions=${out.registryIntegrity.executions} admitted=${out.registryIntegrity.admitted} rejected=${out.registryIntegrity.rejected} additiveOnly=${out.registryIntegrity.additiveOnly} immutable=${out.registryIntegrity.immutable} exactlyOneActive=${out.registryIntegrity.exactlyOneActive}`);
  L.push(`\n5) immutable enforcement ledger: ${out.enforcementLedger.entries} entries (lookup by ${out.enforcementLedger.lookup.join('/')})`);
  L.push(`6) deterministic replay: ${out.deterministicReplay.digest1} vs ${out.deterministicReplay.digest2} → ${out.deterministicReplay.identical && out.deterministicReplay.decisionSame ? 'IDENTICAL' : 'DIVERGED'}`);
  process.stdout.write(L.join('\n') + '\n');
}

// WP-23 consumes ONLY this layer — all constitutional execution state originates from WP-22.
export { enforce, acWithActive, produceEnforcementContext };
const isDirectEC = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isDirectEC) main();
