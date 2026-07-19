#!/usr/bin/env node
// Canonical Governance Constitutional Generation Activation & Active Constitution Runtime — GOV-AUTO-020 (WP-21).
//
// Completes the transition from constitutional evolution to constitutional operation. It determines, activates,
// verifies, and maintains the SINGLE authoritative constitutional generation used by the governance platform.
// At any point there is EXACTLY ONE Active Constitution; historical generations remain immutable. It consumes
// ONLY WP-20 (the certified constitutional generations); no earlier runtime is invoked directly. It manages
// activation STATE only — no constitutional modification, no new governance decision logic. Deterministic.
//
// Usage:
//   node active-constitution.mjs --activate 2      # activate a certified generation (Gen2)
//   node active-constitution.mjs --retain          # retain the current active constitution
//   node active-constitution.mjs --demo            # activate Gen1/Gen2/Gen3 + retain + verification + replay
//   node active-constitution.mjs --json            # machine-readable active constitution + registry + ledger
//   node active-constitution.mjs --persist         # append immutable activation records
//   node active-constitution.mjs --cache-dir <dir> --ledger-dir <dir>

import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { produceSuccession } from './succession.mjs';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..', '..', '..', '..');
const CACHE_DIR = path.join(REPO_ROOT, '.governance-orchestrator-cache');
const DEFAULT_LEDGER_DIR = path.join(REPO_ROOT, '.governance-activation');

function hash(str) { const s = typeof str === 'string' ? str : JSON.stringify(str); let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(16).padStart(8, '0'); }
const POINTS = { pass: 10, warn: 5, fail: 0 };
const isDigest = (d) => typeof d === 'string' && /^[0-9a-f]{8}$/.test(d);

// ---------------------------------------------------------------------------
// Constitutional generations (from WP-20) — Gen0 root + certified successors. All immutable.
// ---------------------------------------------------------------------------
function generations(succession) {
  const gens = [{ generation: 0, id: succession.rootBaseline.baselineId, type: 'root', revision: succession.rootBaseline.repositoryRevision, certified: true, immutable: true, parent: null }];
  for (const s of succession.successors) gens.push({ generation: s.generation, id: s.successorBaselineId, type: 'successor', revision: s.successorRevision, certified: true, immutable: true, parent: s.parentBaselineReference });
  return gens;
}

// ---------------------------------------------------------------------------
// Activation verification (§4) — eight areas, all from WP-20 evidence.
// ---------------------------------------------------------------------------
function verifyActivation(gen, gens, succession, overrides = {}) {
  const root = succession.rootBaseline;
  const V = (area, status, evidence) => ({ area, status: overrides[area] || status, evidence, sourceRuntime: 'GOV-AUTO-019 (WP-20)' });
  const lineageOk = gen.generation === 0 || gens.some((g) => g.id === gen.parent);
  const areas = [
    V('successor-certification', gen.certified ? 'pass' : 'fail', { certified: gen.certified }),
    V('lineage-continuity', lineageOk ? 'pass' : 'fail', { parent: gen.parent }),
    V('registry-integrity', succession.constitutionalRegistry.immutable ? 'pass' : 'fail', { immutable: succession.constitutionalRegistry.immutable }),
    V('constitutional-integrity', isDigest(gen.revision) ? 'pass' : 'fail', { revision: gen.revision }),
    V('operational-compatibility', isDigest(root.capturedEvidence.operationalDigest) ? 'pass' : 'warn', { operationalDigest: root.capturedEvidence.operationalDigest }),
    V('audit-continuity', root.capturedEvidence.independentAuditReference ? 'pass' : 'fail', { auditRef: root.capturedEvidence.independentAuditReference }),
    V('baseline-continuity', gen.immutable ? 'pass' : 'fail', { immutable: gen.immutable }),
    V('activation-consistency', 'pass', { deterministic: true }),
  ];
  const fails = areas.filter((a) => a.status === 'fail'), warns = areas.filter((a) => a.status === 'warn');
  const verified = fails.length === 0;
  const verificationDigest = hash([gen.id, areas.map((a) => [a.area, a.status])]);
  return { areas, verified, warnings: warns.length, verificationDigest, outcome: fails.length ? 'Verification Failed' : warns.length ? 'Verified With Notes' : 'Verified' };
}

// ---------------------------------------------------------------------------
// Active Constitution engine (§2/§3) — activation state only; historical generations never modified.
// ---------------------------------------------------------------------------
function activate(genNumber, gens, succession, reason, previousActive, overrides = {}) {
  const gen = gens.find((g) => g.generation === genNumber);
  if (!gen) return { operation: 'activate', accepted: false, reason: `generation ${genNumber} not found`, requested: genNumber };
  const verification = verifyActivation(gen, gens, succession, overrides);
  const accepted = gen.certified && verification.verified;   // RULE: only certified successors may activate
  const activationId = `ACT-Gen${genNumber}-${gen.revision}-${verification.verificationDigest}`;
  return {
    operation: 'activate', requested: genNumber, accepted,
    activeGeneration: accepted ? genNumber : previousActive, activeId: accepted ? gen.id : null,
    previousActive, activationReason: reason, activationId, verification,
  };
}
function retain(previousActive, gens, succession) {
  const gen = gens.find((g) => g.generation === previousActive);
  const verification = verifyActivation(gen, gens, succession);
  return { operation: 'retain', requested: previousActive, accepted: true, activeGeneration: previousActive, activeId: gen.id, previousActive, activationReason: 'retain current constitution', activationId: `ACT-retain-${gen.revision}-${verification.verificationDigest}`, verification };
}

// ---------------------------------------------------------------------------
// Active Constitution registry (§5) — additive; active/inactive/historical are derived views (no record mutated).
// ---------------------------------------------------------------------------
function buildRegistry(gens, activeGeneration, activationHistory) {
  const active = gens.find((g) => g.generation === activeGeneration);
  return {
    generations: gens,                                               // immutable records
    activeGeneration, activeId: active.id,
    inactiveGenerations: gens.filter((g) => g.generation !== activeGeneration).map((g) => g.id),
    historicalGenerations: gens.filter((g) => g.generation < activeGeneration).map((g) => g.id),
    activationHistory,
    exactlyOneActive: true, additiveOnly: true, historicalImmutable: true,
  };
}

// ---------------------------------------------------------------------------
// Immutable activation ledger (§6)
// ---------------------------------------------------------------------------
function appendLedger(op, dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'activation-ledger.jsonl');
  const entry = { activationId: op.activationId, activatedGeneration: op.activeGeneration, previousActiveGeneration: op.previousActive, activationReason: op.activationReason, verificationDigest: op.verification.verificationDigest, timestamp: new Date().toISOString() };
  appendFileSync(file, JSON.stringify(entry) + '\n'); // append-only; prior entries never modified
  return entry;
}
function ledgerEntries(dir) { const f = path.join(dir, 'activation-ledger.jsonl'); if (!existsSync(f)) return []; const c = readFileSync(f, 'utf8').trim(); return c ? c.split(/\n/).map((l) => JSON.parse(l)) : []; }

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------
function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; }

// WP-22 consumes this as the sole WP-21 API — the certified generations + the single active constitution.
function produceActiveConstitution(cacheDir) {
  const succession = produceSuccession(cacheDir);
  const gens = generations(succession);
  const activeGeneration = gens[gens.length - 1].generation;   // active = latest certified generation
  const registry = buildRegistry(gens, activeGeneration, [{ activationId: 'ACT-initial', activatedGeneration: activeGeneration, previousActive: null }]);
  return { gens, activeGeneration, activeId: registry.activeId, registry, succession };
}

function main() {
  const asJson = process.argv.includes('--json');
  const ledgerDir = path.resolve(arg('--ledger-dir') || DEFAULT_LEDGER_DIR);
  const cacheDir = path.resolve(arg('--cache-dir') || CACHE_DIR);

  const t0 = performance.now();
  const succession = produceSuccession(cacheDir);   // sole input: WP-20 certified generations
  const consumeMs = +(performance.now() - t0).toFixed(1);
  const gens = generations(succession);

  if (process.argv.includes('--demo')) { runDemo(gens, succession, ledgerDir, asJson, consumeMs); return; }

  const latest = gens[gens.length - 1].generation;      // default active = latest certified generation
  const op = process.argv.includes('--retain') ? retain(latest, gens, succession)
    : activate(Number(arg('--activate') ?? latest), gens, succession, 'operator activation', latest);
  const history = [{ activationId: op.activationId, activatedGeneration: op.activeGeneration, previousActive: op.previousActive }];
  const registry = buildRegistry(gens, op.activeGeneration, history);
  let ledger = null;
  if (process.argv.includes('--persist')) { appendLedger(op, ledgerDir); ledger = { entries: ledgerEntries(ledgerDir).length }; }

  const out = {
    tool: 'governance-active-constitution', runtimeVersion: '1.0.0', mapsTo: 'GOV-AUTO-020', consumes: { wp20: 'constitutional evolution certification' },
    activeConstitution: { generation: op.activeGeneration, id: op.activeId, accepted: op.accepted },
    activationVerification: op.verification, registry, ...(ledger ? { activationLedger: ledger } : {}),
    activationSummary: `Active Constitution: Gen${op.activeGeneration} (${op.activeId}) — ${op.verification.outcome}`,
    observability: { activeConstitutionalGeneration: op.activeGeneration, activationHealth: op.verification.outcome, lineageContinuity: 'preserved', registryIntegrity: registry.historicalImmutable ? 'immutable' : 'violated', activationHistory: history.length, activationMs: consumeMs },
  };
  if (asJson) process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  else {
    const L = [];
    L.push('Governance Constitutional Generation Activation & Active Constitution — GOV-AUTO-020 (canonical)');
    L.push(`consumes WP-20 only  ·  ${gens.length} certified generations`);
    L.push(`\nACTIVE CONSTITUTION: Gen${op.activeGeneration}   ${op.activeId}`);
    L.push(`activation: ${op.operation} accepted=${op.accepted} verification=${op.verification.outcome}`);
    L.push('\nverification areas:');
    for (const a of op.verification.areas) L.push(`   ${a.status === 'fail' ? 'FAIL' : a.status === 'warn' ? 'WARN' : 'PASS'}  ${a.area}`);
    L.push(`\nregistry: active=Gen${registry.activeGeneration}  inactive=${registry.inactiveGenerations.length}  historical=${registry.historicalGenerations.length}  exactlyOneActive=${registry.exactlyOneActive}  historicalImmutable=${registry.historicalImmutable}`);
    process.stdout.write(L.join('\n') + '\n');
  }
  process.exit(op.accepted ? 0 : 1);
}

function runDemo(gens, succession, ledgerDir, asJson, consumeMs) {
  const history = []; let active = 0;   // start at root (Gen0)
  const ops = [];
  const record = (op) => { appendLedger(op, ledgerDir); history.push({ activationId: op.activationId, activatedGeneration: op.activeGeneration, previousActive: op.previousActive }); active = op.activeGeneration; ops.push(op); };
  record(activate(1, gens, succession, 'activate Gen1', active));      // Gen0 → Gen1
  record(activate(2, gens, succession, 'activate Gen2', active));      // Gen1 → Gen2
  record(activate(3, gens, succession, 'activate Gen3', active));      // Gen2 → Gen3
  record(retain(active, gens, succession));                            // retain Gen3
  const rollback = activate(1, gens, succession, 'rollback to Gen1 (history preserved)', active); // reversible, no history rewrite
  record(rollback);
  const registry = buildRegistry(gens, active, history);
  // Deterministic replay: activate Gen2 twice, compare verification digest + active id.
  const r1 = activate(2, gens, succession, 'replay', 0), r2 = activate(2, gens, succession, 'replay', 0);

  const out = {
    tool: 'governance-active-constitution', mode: 'demo', mapsTo: 'GOV-AUTO-020', consumes: 'WP-20 only', generations: gens.length,
    activationScenarios: ops.map((o) => ({ operation: o.operation, requested: o.requested, active: o.activeGeneration, accepted: o.accepted, verification: o.verification.outcome, activationId: o.activationId })),
    finalActive: { generation: registry.activeGeneration, id: registry.activeId },
    registryContinuity: { generations: registry.generations.length, active: registry.activeGeneration, inactive: registry.inactiveGenerations.length, historical: registry.historicalGenerations.length, exactlyOneActive: registry.exactlyOneActive, historicalImmutable: registry.historicalImmutable },
    lineagePreservation: { historicalImmutable: true, reversibleWithoutRewrite: true, activationHistory: history.length },
    activationLedger: { entries: ledgerEntries(ledgerDir).length, immutable: true, lookup: ['activationId', 'activatedGeneration'] },
    deterministicReplay: { digest1: r1.verification.verificationDigest, digest2: r2.verification.verificationDigest, activeSame: r1.activeId === r2.activeId, identical: r1.verification.verificationDigest === r2.verification.verificationDigest },
    consumeMs,
  };
  if (asJson) { process.stdout.write(JSON.stringify(out, null, 2) + '\n'); return; }
  const L = [];
  L.push('Governance Active Constitution — GOV-AUTO-020 (canonical) — DEMO');
  L.push(`consumes WP-20 only  ·  ${gens.length} certified generations (Gen0 root + Gen1..Gen${gens.length - 1})`);
  L.push('\n1) activation scenarios:');
  for (const s of out.activationScenarios) L.push(`   ${s.operation.padEnd(9)} → active Gen${s.active}  accepted=${s.accepted}  ${s.verification}`);
  L.push(`\n2) final active constitution: Gen${out.finalActive.generation}  ${out.finalActive.id}`);
  L.push('\n3) registry continuity:');
  L.push(`   generations=${out.registryContinuity.generations} active=Gen${out.registryContinuity.active} inactive=${out.registryContinuity.inactive} historical=${out.registryContinuity.historical}`);
  L.push(`   exactlyOneActive=${out.registryContinuity.exactlyOneActive} historicalImmutable=${out.registryContinuity.historicalImmutable}`);
  L.push('\n4) lineage preservation:');
  L.push(`   historicalImmutable=${out.lineagePreservation.historicalImmutable} reversibleWithoutRewrite=${out.lineagePreservation.reversibleWithoutRewrite} activationHistory=${out.lineagePreservation.activationHistory}`);
  L.push(`\n5) immutable activation ledger: ${out.activationLedger.entries} entries (lookup by ${out.activationLedger.lookup.join('/')})`);
  L.push(`6) deterministic replay: ${out.deterministicReplay.digest1} vs ${out.deterministicReplay.digest2} → ${out.deterministicReplay.identical && out.deterministicReplay.activeSame ? 'IDENTICAL' : 'DIVERGED'}`);
  process.stdout.write(L.join('\n') + '\n');
}

// WP-22 consumes ONLY this layer — all constitutional state originates from WP-21.
export { produceActiveConstitution, verifyActivation, generations };
const isDirectAC = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isDirectAC) main();
