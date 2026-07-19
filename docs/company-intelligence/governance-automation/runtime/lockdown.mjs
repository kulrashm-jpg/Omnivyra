#!/usr/bin/env node
// Canonical Governance Constitutional Lockdown & Immutable Baseline Runtime — GOV-AUTO-017 (WP-18).
//
// The terminal governance preservation layer. Where WP-17 independently verifies the platform, WP-18
// permanently captures the verified platform state as the CONSTITUTIONAL REFERENCE BASELINE against which
// all future governance evolution is measured. It consumes ONLY WP-17 (independent audit) — every earlier
// runtime's evidence arrives transitively. It introduces NO new governance rules or decisions: it captures
// and classifies existing verified evidence into an immutable baseline. Deterministic; additive.
//
// Usage:
//   node lockdown.mjs                    # capture the constitutional baseline
//   node lockdown.mjs --demo             # 3 decisions + 4 integrity levels + reproducibility + replay
//   node lockdown.mjs --json             # machine-readable baseline artifact + verification + ledger + snapshot
//   node lockdown.mjs --persist          # append an immutable baseline record
//   node lockdown.mjs --cache-dir <dir> --ledger-dir <dir>

import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { produceAudit } from './audit.mjs';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..', '..', '..', '..');
const CACHE_DIR = path.join(REPO_ROOT, '.governance-orchestrator-cache');
const DEFAULT_LEDGER_DIR = path.join(REPO_ROOT, '.governance-baseline');
const CONSTITUTION_IDENTITY = 'Company Intelligence Constitution v1.0.0';

function hash(str) { const s = typeof str === 'string' ? str : JSON.stringify(str); let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(16).padStart(8, '0'); }

// ---------------------------------------------------------------------------
// Constitutional snapshot (§3) — every element from WP-17 audit evidence.
// ---------------------------------------------------------------------------
function constitutionalSnapshot(auditResult) {
  const r = auditResult.report, ev = auditResult.a.evidence;
  return {
    repositoryRevision: r.repositoryRevision,
    constitutionalRepositoryIdentity: CONSTITUTION_IDENTITY,
    productionCertificationReference: r.productionCertificateReference,
    independentAuditReference: r.auditId,
    runtimeRegistrySnapshot: ev.runtimeVersions,
    executionTopology: ev.executionTopology,
    evidenceDigests: r.evidenceDigests,
    operationalDigest: r.evidenceDigests.operational,
    assuranceDigest: r.evidenceDigests.assurance,
    certificationDigest: r.evidenceDigests.certification,
    auditDigest: r.auditDigest,
  };
}

// ---------------------------------------------------------------------------
// Baseline reproducibility verification (§7) — reuses WP-17 outputs only.
// ---------------------------------------------------------------------------
function baselineVerification(auditResult, snapshot) {
  const repro = auditResult.repro;
  const cap1 = hash(snapshot), cap2 = hash(constitutionalSnapshot(auditResult)); // deterministic capture twice
  return {
    baselineReproducibility: cap1 === cap2,
    auditReproducibility: auditResult.report.auditDecision !== 'Audit Failed' && repro.certificateReproducibility,
    certificationReproducibility: repro.certificateReproducibility,
    evidenceReproducibility: repro.assuranceReproducibility && repro.deploymentLedgerReproducibility,
    digestReproducibility: repro.digestReproducibility,
  };
}

// ---------------------------------------------------------------------------
// Baseline capture engine (§2) + integrity classification (§4)
// ---------------------------------------------------------------------------
function baselineDecision(auditResult, verification) {
  const allRepro = Object.values(verification).every(Boolean);
  if (auditResult.report.auditDecision === 'Audit Failed' || !allRepro) return 'Baseline Lock Failed';
  if (auditResult.report.auditDecision === 'Audit Passed With Findings') return 'Baseline Locked With Exceptions';
  return 'Baseline Locked';
}
function integrityLevel(auditResult, decision) {
  if (decision === 'Baseline Lock Failed') return 'Draft';
  return ({ Maximum: 'Immutable', High: 'Locked', Moderate: 'Stable', Limited: 'Draft' })[auditResult.report.confidenceLevel] || 'Stable';
}

// ---------------------------------------------------------------------------
// Constitutional baseline artifact (§5)
// ---------------------------------------------------------------------------
function makeBaseline(auditResult) {
  const snapshot = constitutionalSnapshot(auditResult);
  const verification = baselineVerification(auditResult, snapshot);
  const decision = baselineDecision(auditResult, verification);
  const level = integrityLevel(auditResult, decision);
  const baselineDigest = hash([decision, level, snapshot, verification]);
  return {
    baselineId: `BASELINE-${level}-${snapshot.repositoryRevision}-${baselineDigest}`,
    baselineDecision: decision, integrityLevel: level,
    repositoryRevision: snapshot.repositoryRevision,
    capturedEvidence: snapshot,
    verificationSummary: verification,
    baselineDigest, baselineTimestamp: new Date().toISOString(),
    baselineSummary: `${decision} — ${level} for constitutional revision ${snapshot.repositoryRevision} (${CONSTITUTION_IDENTITY})`,
  };
}

// ---------------------------------------------------------------------------
// Immutable baseline ledger (§6)
// ---------------------------------------------------------------------------
function appendLedger(baseline, dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'baseline-ledger.jsonl');
  const entry = { baselineId: baseline.baselineId, decision: baseline.baselineDecision, integrityLevel: baseline.integrityLevel, repositoryRevision: baseline.repositoryRevision, evidenceDigest: baseline.baselineDigest, timestamp: new Date().toISOString() };
  appendFileSync(file, JSON.stringify(entry) + '\n'); // append-only; prior lines never modified
  return entry;
}
function ledgerEntries(dir) { const f = path.join(dir, 'baseline-ledger.jsonl'); if (!existsSync(f)) return []; const c = readFileSync(f, 'utf8').trim(); return c ? c.split(/\n/).map((l) => JSON.parse(l)) : []; }

// Synthetic audit-result variant (to demonstrate all baseline decisions/levels without degrading the platform).
function synthAudit(base, mutate) { const clone = JSON.parse(JSON.stringify({ report: base.report, areas: base.areas, repro: base.repro, a: { evidence: base.a.evidence } })); mutate(clone); return clone; }

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------
function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; }

// WP-19 consumes this as the sole WP-18 API — returns the immutable constitutional baseline (never mutated).
function produceBaseline(cacheDir) { return makeBaseline(produceAudit(cacheDir)); }

function main() {
  const asJson = process.argv.includes('--json');
  const ledgerDir = path.resolve(arg('--ledger-dir') || DEFAULT_LEDGER_DIR);
  const cacheDir = path.resolve(arg('--cache-dir') || CACHE_DIR);

  const t0 = performance.now();
  const auditResult = produceAudit(cacheDir);   // sole input: one WP-17 independent audit
  const consumeMs = +(performance.now() - t0).toFixed(1);

  if (process.argv.includes('--demo')) { runDemo(auditResult, ledgerDir, asJson, consumeMs); return; }

  const baseline = makeBaseline(auditResult);
  let ledger = null;
  if (process.argv.includes('--persist')) { appendLedger(baseline, ledgerDir); ledger = { entries: ledgerEntries(ledgerDir).length }; }

  const out = {
    tool: 'governance-constitutional-lockdown', runtimeVersion: '1.0.0', mapsTo: 'GOV-AUTO-017', consumes: { wp17: 'independent repository audit' },
    baselineArtifact: baseline, baselineVerification: baseline.verificationSummary, constitutionalSnapshot: baseline.capturedEvidence,
    ...(ledger ? { baselineLedger: ledger } : {}),
    baselineSummary: baseline.baselineSummary,
    observability: { baselineDecision: baseline.baselineDecision, integrityLevel: baseline.integrityLevel, reproducibility: Object.values(baseline.verificationSummary).every(Boolean) ? 'reproducible' : 'not-reproducible', constitutionalContinuity: baseline.repositoryRevision, evidenceContinuity: baseline.capturedEvidence.evidenceDigests.evidenceContinuity, captureMs: consumeMs },
  };
  if (asJson) process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  else {
    const L = [];
    L.push('Governance Constitutional Lockdown & Immutable Baseline — GOV-AUTO-017 (canonical)');
    L.push(`consumes WP-17 only  ·  ${CONSTITUTION_IDENTITY}  ·  revision: ${baseline.repositoryRevision}`);
    L.push(`\nBASELINE DECISION: ${baseline.baselineDecision}   INTEGRITY: ${baseline.integrityLevel}`);
    L.push(`baseline: ${baseline.baselineId}`);
    L.push(`certificate: ${baseline.capturedEvidence.productionCertificationReference}`);
    L.push(`audit: ${baseline.capturedEvidence.independentAuditReference}`);
    L.push('\ncaptured constitutional snapshot:');
    for (const [k, v] of Object.entries(baseline.capturedEvidence)) L.push(`   ${k}: ${typeof v === 'object' ? JSON.stringify(v).slice(0, 80) : v}`);
    L.push('\nbaseline verification: ' + Object.entries(baseline.verificationSummary).map(([k, v]) => `${k}=${v}`).join(' '));
    process.stdout.write(L.join('\n') + '\n');
  }
  process.exit(baseline.baselineDecision === 'Baseline Lock Failed' ? 1 : 0);
}

function runDemo(auditResult, ledgerDir, asJson, consumeMs) {
  const real = makeBaseline(auditResult);                                                              // Baseline Locked / Immutable
  const exceptions = makeBaseline(synthAudit(auditResult, (x) => { x.report.auditDecision = 'Audit Passed With Findings'; x.report.confidenceLevel = 'High'; })); // Locked With Exceptions / Locked
  const failed = makeBaseline(synthAudit(auditResult, (x) => { x.repro.certificateReproducibility = false; x.report.confidenceLevel = 'Limited'; })); // Lock Failed / Draft
  const stable = makeBaseline(synthAudit(auditResult, (x) => { x.report.confidenceLevel = 'Moderate'; }));  // Stable
  const draftConf = makeBaseline(synthAudit(auditResult, (x) => { x.report.confidenceLevel = 'Limited'; })); // Draft
  appendLedger(real, ledgerDir); appendLedger(exceptions, ledgerDir);
  const r1 = makeBaseline(auditResult), r2 = makeBaseline(auditResult);

  const out = {
    tool: 'governance-constitutional-lockdown', mode: 'demo', mapsTo: 'GOV-AUTO-017', consumes: 'WP-17 only', repositoryRevision: real.repositoryRevision,
    decisions: {
      BaselineLocked: { decision: real.baselineDecision, integrity: real.integrityLevel },
      BaselineLockedWithExceptions: { decision: exceptions.baselineDecision, integrity: exceptions.integrityLevel },
      BaselineLockFailed: { decision: failed.baselineDecision, integrity: failed.integrityLevel },
    },
    integrityLevels: { Immutable: real.integrityLevel, Locked: exceptions.integrityLevel, Stable: stable.integrityLevel, Draft: draftConf.integrityLevel },
    baselineArtifact: real,
    reproducibility: real.verificationSummary,
    baselineLedger: { entries: ledgerEntries(ledgerDir).length, immutable: true, lookup: ['baselineId', 'repositoryRevision'] },
    deterministicReplay: { digest1: r1.baselineDigest, digest2: r2.baselineDigest, identical: r1.baselineDigest === r2.baselineDigest },
    consumeMs,
  };
  if (asJson) { process.stdout.write(JSON.stringify(out, null, 2) + '\n'); return; }
  const L = [];
  L.push('Governance Constitutional Lockdown — GOV-AUTO-017 (canonical) — DEMO');
  L.push(`consumes WP-17 only  ·  ${CONSTITUTION_IDENTITY}  ·  revision: ${real.repositoryRevision}`);
  L.push('\n1) baseline decisions:');
  L.push(`   Baseline Locked                → ${out.decisions.BaselineLocked.decision} / ${out.decisions.BaselineLocked.integrity}`);
  L.push(`   Baseline Locked With Exceptions → ${out.decisions.BaselineLockedWithExceptions.decision} / ${out.decisions.BaselineLockedWithExceptions.integrity}`);
  L.push(`   Baseline Lock Failed           → ${out.decisions.BaselineLockFailed.decision} / ${out.decisions.BaselineLockFailed.integrity}`);
  L.push('\n2) integrity levels (objective, from audit confidence):');
  for (const [lvl, asg] of Object.entries(out.integrityLevels)) L.push(`   ${lvl.padEnd(10)} → assigned ${asg}`);
  L.push(`\n3) baseline artifact: ${out.baselineArtifact.baselineId}`);
  L.push(`   decision=${out.baselineArtifact.baselineDecision} integrity=${out.baselineArtifact.integrityLevel} rev=${out.baselineArtifact.repositoryRevision}`);
  L.push(`   captured: cert=${out.baselineArtifact.capturedEvidence.productionCertificationReference}`);
  L.push(`             audit=${out.baselineArtifact.capturedEvidence.independentAuditReference}`);
  L.push(`             topology=[${(out.baselineArtifact.capturedEvidence.executionTopology || []).join(' → ')}]`);
  L.push('\n4) reproducibility: ' + Object.entries(out.reproducibility).map(([k, v]) => `${k}=${v}`).join(' '));
  L.push(`\n5) immutable baseline ledger: ${out.baselineLedger.entries} entries (lookup by ${out.baselineLedger.lookup.join('/')})`);
  L.push(`6) deterministic replay: ${out.deterministicReplay.digest1} vs ${out.deterministicReplay.digest2} → ${out.deterministicReplay.identical ? 'IDENTICAL' : 'DIVERGED'}`);
  process.stdout.write(L.join('\n') + '\n');
}

// WP-19 consumes ONLY this layer — all constitutional state originates from WP-18.
export { produceBaseline };
const isDirectLock = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isDirectLock) main();
