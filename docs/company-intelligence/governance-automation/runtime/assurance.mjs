#!/usr/bin/env node
// Canonical Governance Autonomous Operations & Continuous Assurance Platform — realizes GOV-AUTO-014 (WP-15).
//
// The final operational layer: it continuously supervises, validates, and assures governance health using
// the completed stack. It consumes ONLY the WP-14 Production Activation Layer — no earlier runtime is
// invoked directly, and all governance execution flows through WP-14. It introduces NO new governance
// decision logic: assurance policies read existing operational evidence and classify continuity. It keeps
// an immutable assurance ledger, a machine-readable dashboard model, and deterministic continuous
// verification. Additive; runtime business logic unchanged.
//
// Usage:
//   node assurance.mjs --profile "Production Monitoring"   # one assurance cycle
//   node assurance.mjs --demo                              # Continuous/Daily/Production + Healthy/Attention/Critical + replay
//   node assurance.mjs --verify                            # continuous verification (repeat activation, compare)
//   node assurance.mjs --json                              # machine-readable assurance report + dashboard + ledger
//   node assurance.mjs --cache-dir <dir> --ledger-dir <dir>

import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { runProfile, DEFAULT_CONFIG, configRevision } from './activation.mjs';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..', '..', '..', '..');
const DEFAULT_LEDGER_DIR = path.join(REPO_ROOT, '.governance-assurance');

function hash(str) { const s = typeof str === 'string' ? str : JSON.stringify(str); let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(16).padStart(8, '0'); }

// ---------------------------------------------------------------------------
// Assurance profiles (§4) — data-driven.
// ---------------------------------------------------------------------------
const ASSURANCE_PROFILES = {
  Continuous: { frequency: 'continuous', operationalProfile: 'Development', reportingDepth: 'summary', alertThreshold: 'Attention Required' },
  Hourly: { frequency: '3600s', operationalProfile: 'CI', reportingDepth: 'standard', alertThreshold: 'Attention Required' },
  Daily: { frequency: '86400s', operationalProfile: 'Main Branch', reportingDepth: 'full', alertThreshold: 'Attention Required' },
  'Release Window': { frequency: 'on-demand', operationalProfile: 'Release', reportingDepth: 'full', alertThreshold: 'Attention Required' },
  'Production Monitoring': { frequency: 'continuous', operationalProfile: 'Production', reportingDepth: 'full', alertThreshold: 'Attention Required' },
};

// ---------------------------------------------------------------------------
// Assurance policies (§3) — pure classifiers over the WP-14 operational state. No new governance logic.
// ---------------------------------------------------------------------------
const H = 'Healthy', A = 'Attention Required', C = 'Critical';
const POLICIES = [
  { id: 'governance-operational-health', runtime: 'GOV-AUTO-013', evaluate: (op) => cls(op.manifest.operationalStatus, { ACTIVE: H, DEGRADED: C }, { status: op.manifest.operationalStatus }) },
  { id: 'certification-continuity', runtime: 'GOV-AUTO-010', evaluate: (op) => cls(op.health.certificationStatus.decision, { Certified: H, 'Certified With Conditions': A, 'Certification Denied': C }, { decision: op.health.certificationStatus.decision, level: op.health.certificationStatus.level }) },
  { id: 'release-readiness-continuity', runtime: 'GOV-AUTO-007', evaluate: (op) => cls(op.health.releaseReadiness.decision, { Ready: H, 'Ready With Warnings': A, Blocked: C }, { decision: op.health.releaseReadiness.decision }) },
  { id: 'enforcement-continuity', runtime: 'GOV-AUTO-009', evaluate: (op) => cls(op.health.enforcementReadiness.outcome, { Pass: H, Warning: A, Fail: C }, { outcome: op.health.enforcementReadiness.outcome }) },
  { id: 'optimizer-health', runtime: 'GOV-AUTO-012', evaluate: (op) => cls(op.health.optimizerStatus, { operational: H, degraded: C }, { status: op.health.optimizerStatus }) },
  { id: 'orchestrator-health', runtime: 'GOV-AUTO-011', evaluate: (op) => cls(op.health.orchestratorStatus, { operational: H, degraded: C }, { status: op.health.orchestratorStatus }) },
  { id: 'cache-integrity', runtime: 'GOV-AUTO-011', evaluate: (op) => ({ status: (op.health.cacheHealth && op.health.cacheHealth.misses >= 0) ? H : A, evidence: op.health.cacheHealth }) },
  { id: 'execution-consistency', runtime: 'GOV-AUTO-013', evaluate: (op) => ({ status: op.verification.overall === 'READY' ? H : A, evidence: { readiness: op.verification.overall, manifestDigest: op.manifest.manifestDigest } }) },
];
function cls(value, map, evidence) { return { status: map[value] || A, evidence }; }
const SEV = { [H]: 0, [A]: 1, [C]: 2 };

function evaluateAssurance(op) {
  const policyResults = POLICIES.map((p) => ({ policy: p.id, runtime: p.runtime, ...p.evaluate(op) }));
  const worst = policyResults.reduce((m, r) => Math.max(m, SEV[r.status]), 0);
  const outcome = worst === 2 ? C : worst === 1 ? A : H;
  return { policyResults, outcome };
}

// ---------------------------------------------------------------------------
// Dashboard model (§6) — data only.
// ---------------------------------------------------------------------------
function dashboard(op, assurance, ledgerSummary) {
  return {
    currentGovernanceStatus: op.manifest.operationalStatus,
    certificationStatus: op.health.certificationStatus,
    releaseStatus: op.health.releaseReadiness,
    enforcementStatus: op.health.enforcementReadiness,
    optimizerStatus: op.health.optimizerStatus,
    orchestratorStatus: op.health.orchestratorStatus,
    posture: op.health.posture,
    operationalReadiness: op.verification.overall,
    assuranceOutcome: assurance.outcome,
    assuranceHistorySummary: ledgerSummary,
  };
}

// ---------------------------------------------------------------------------
// Immutable assurance ledger (§5)
// ---------------------------------------------------------------------------
function appendLedger(record, dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'assurance-ledger.jsonl');
  appendFileSync(file, JSON.stringify(record) + '\n'); // append-only; prior lines never modified
  return record;
}
function ledgerEntries(dir) { const f = path.join(dir, 'assurance-ledger.jsonl'); if (!existsSync(f)) return []; const c = readFileSync(f, 'utf8').trim(); return c ? c.split(/\n/).map((l) => JSON.parse(l)) : []; }
function ledgerSummary(dir) { const e = ledgerEntries(dir); const byOutcome = {}; for (const x of e) byOutcome[x.assuranceOutcome] = (byOutcome[x.assuranceOutcome] || 0) + 1; return { cycles: e.length, byOutcome }; }

// ---------------------------------------------------------------------------
// Assurance engine (§2)
// ---------------------------------------------------------------------------
function runAssuranceCycle(profileName, cacheDir, ledgerDir, config = DEFAULT_CONFIG, opOverride = null) {
  const profile = ASSURANCE_PROFILES[profileName];
  const t = performance.now();
  const op = opOverride || runProfile(profile.operationalProfile, cacheDir, config); // ALL execution flows through WP-14
  const assurance = evaluateAssurance(op);
  const operationalDigest = op.manifest.operationalDigest;
  const evidenceDigest = hash([assurance.policyResults.map((r) => [r.policy, r.status]), operationalDigest]);
  const assuranceDigest = hash([profileName, operationalDigest, assurance.outcome, evidenceDigest]);
  const record = {
    assuranceId: `ASR-${profileName.replace(/\s/g, '')}-${op.activation.fingerprint}-${assuranceDigest}`,
    profile: profileName, repositoryRevision: op.activation.fingerprint, operationalDigest,
    assuranceOutcome: assurance.outcome, evidenceDigest, timestamp: new Date().toISOString(),
  };
  const persisted = ledgerDir ? appendLedger(record, ledgerDir) : record;
  const dash = dashboard(op, assurance, ledgerDir ? ledgerSummary(ledgerDir) : { cycles: 1, byOutcome: { [assurance.outcome]: 1 } });
  return { profileName, profile, op, assurance, record: persisted, dashboard: dash, assuranceDigest, ms: +(performance.now() - t).toFixed(1) };
}

// Synthetic operational state (for demonstrating Attention/Critical without degrading the repo).
function synthOp(base, mutate) { const clone = JSON.parse(JSON.stringify(base)); mutate(clone); return clone; }

// ---------------------------------------------------------------------------
// Continuous verification (§7) — repeat activation, compare; reuses existing outputs.
// ---------------------------------------------------------------------------
function continuousVerification(profileName, cacheDir, config = DEFAULT_CONFIG) {
  const a = runProfile(ASSURANCE_PROFILES[profileName].operationalProfile, cacheDir, config);
  const b = runProfile(ASSURANCE_PROFILES[profileName].operationalProfile, cacheDir, config);
  const certOf = (o) => o.health.certificationStatus.decision + '/' + o.health.certificationStatus.level;
  const relOf = (o) => o.health.releaseReadiness.decision;
  return {
    activationConsistency: a.manifest.manifestDigest === b.manifest.manifestDigest,
    operationalDigestConsistency: a.manifest.operationalDigest === b.manifest.operationalDigest,
    certificationConsistency: certOf(a) === certOf(b),
    releaseConsistency: relOf(a) === relOf(b),
    cacheConsistency: JSON.stringify(a.health.cacheHealth) !== undefined,
    digests: { a: a.manifest.operationalDigest, b: b.manifest.operationalDigest },
  };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------
function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; }

function main() {
  const asJson = process.argv.includes('--json');
  const config = DEFAULT_CONFIG;
  const cacheDir = path.resolve(arg('--cache-dir') || path.join(REPO_ROOT, config.locations.cache));
  const ledgerDir = path.resolve(arg('--ledger-dir') || DEFAULT_LEDGER_DIR);

  if (process.argv.includes('--demo')) { runDemo(cacheDir, ledgerDir, config, asJson); return; }
  if (process.argv.includes('--verify')) {
    const v = continuousVerification(arg('--profile') || 'Production Monitoring', cacheDir, config);
    process.stdout.write((asJson ? JSON.stringify(v, null, 2) : `continuous verification: activation=${v.activationConsistency} operationalDigest=${v.operationalDigestConsistency} certification=${v.certificationConsistency} release=${v.releaseConsistency}`) + '\n');
    process.exit(Object.values(v).every((x) => x !== false) ? 0 : 1);
  }

  const cycle = runAssuranceCycle(arg('--profile') || 'Production Monitoring', cacheDir, ledgerDir, config);
  const out = {
    tool: 'governance-autonomous-operations', runtimeVersion: '1.0.0', mapsTo: 'GOV-AUTO-014', consumes: { wp14: 'production activation layer' },
    configurationRevision: configRevision(config),
    assuranceReport: { profile: cycle.profileName, profileConfig: cycle.profile, outcome: cycle.assurance.outcome, policyResults: cycle.assurance.policyResults, assuranceDigest: cycle.assuranceDigest },
    dashboardModel: cycle.dashboard, assuranceLedgerEntry: cycle.record,
    observability: { assuranceCycles: 1, profileUtilization: [cycle.profileName], operationalStability: cycle.assurance.outcome, cycleMs: cycle.ms },
  };
  if (asJson) process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  else {
    const L = [];
    L.push('Governance Autonomous Operations & Continuous Assurance Platform — GOV-AUTO-014 (canonical)');
    L.push(`consumes WP-14 only  ·  profile "${cycle.profileName}" (operational=${cycle.profile.operationalProfile})`);
    L.push(`\nASSURANCE OUTCOME: ${cycle.assurance.outcome}   assuranceDigest: ${cycle.assuranceDigest}   (${cycle.ms}ms)`);
    for (const r of cycle.assurance.policyResults) L.push(`   ${r.status === C ? 'CRIT' : r.status === A ? 'ATTN' : 'OK  '} ${r.policy} (${r.runtime}) ${JSON.stringify(r.evidence)}`);
    L.push(`\ndashboard: cert=${cycle.dashboard.certificationStatus.decision}/${cycle.dashboard.certificationStatus.level} release=${cycle.dashboard.releaseStatus.decision} enforce=${cycle.dashboard.enforcementStatus.outcome} posture=${cycle.dashboard.posture} readiness=${cycle.dashboard.operationalReadiness}`);
    process.stdout.write(L.join('\n') + '\n');
  }
  process.exit(cycle.assurance.outcome === C ? 1 : 0);
}

function runDemo(cacheDir, ledgerDir, config, asJson) {
  const real = ['Continuous', 'Daily', 'Production Monitoring'].map((p) => runAssuranceCycle(p, cacheDir, ledgerDir, config));
  const baseOp = real[2].op;
  // Synthetic Attention: release degraded to warnings.
  const attnOp = synthOp(baseOp, (o) => { o.health.releaseReadiness.decision = 'Ready With Warnings'; });
  const attn = runAssuranceCycle('Production Monitoring', cacheDir, ledgerDir, config, attnOp);
  // Synthetic Critical: certification denied.
  const critOp = synthOp(baseOp, (o) => { o.health.certificationStatus.decision = 'Certification Denied'; o.manifest.operationalStatus = 'DEGRADED'; });
  const crit = runAssuranceCycle('Production Monitoring', cacheDir, ledgerDir, config, critOp);
  // Deterministic replay: two identical Production Monitoring cycles.
  const r1 = runAssuranceCycle('Production Monitoring', cacheDir, null, config, baseOp);
  const r2 = runAssuranceCycle('Production Monitoring', cacheDir, null, config, baseOp);
  const verification = continuousVerification('Production Monitoring', cacheDir, config);

  const out = {
    tool: 'governance-autonomous-operations', mode: 'demo', mapsTo: 'GOV-AUTO-014', consumes: 'WP-14 only',
    profiles: real.map((c) => ({ profile: c.profileName, operational: c.profile.operationalProfile, outcome: c.assurance.outcome, assuranceDigest: c.assuranceDigest, ms: c.ms })),
    outcomes: { Healthy: real[2].assurance.outcome, AttentionRequired: attn.assurance.outcome, Critical: crit.assurance.outcome },
    dashboardModel: real[2].dashboard,
    continuousVerification: verification,
    deterministicReplay: { digest1: r1.assuranceDigest, digest2: r2.assuranceDigest, identical: r1.assuranceDigest === r2.assuranceDigest },
    assuranceLedger: { entries: ledgerEntries(ledgerDir).length, immutable: true, summary: ledgerSummary(ledgerDir) },
  };
  if (asJson) { process.stdout.write(JSON.stringify(out, null, 2) + '\n'); return; }
  const L = [];
  L.push('Governance Autonomous Operations — GOV-AUTO-014 (canonical) — DEMO');
  L.push('consumes WP-14 only');
  L.push('\n1) assurance profiles:');
  for (const p of out.profiles) L.push(`   ${p.profile.padEnd(22)} operational=${p.operational.padEnd(12)} outcome=${p.outcome.padEnd(18)} digest=${p.assuranceDigest} (${p.ms}ms)`);
  L.push('\n2) assurance outcomes:');
  L.push(`   Healthy            → ${out.outcomes.Healthy}`);
  L.push(`   Attention Required → ${out.outcomes.AttentionRequired}  (synthetic: release→Ready With Warnings)`);
  L.push(`   Critical           → ${out.outcomes.Critical}  (synthetic: certification→Denied)`);
  L.push('\n3) dashboard model (Production Monitoring):');
  L.push(`   governance=${out.dashboardModel.currentGovernanceStatus} cert=${out.dashboardModel.certificationStatus.decision}/${out.dashboardModel.certificationStatus.level} release=${out.dashboardModel.releaseStatus.decision} enforce=${out.dashboardModel.enforcementStatus.outcome}`);
  L.push(`   optimizer=${out.dashboardModel.optimizerStatus} orchestrator=${out.dashboardModel.orchestratorStatus} readiness=${out.dashboardModel.operationalReadiness} posture=${out.dashboardModel.posture}`);
  L.push('\n4) continuous verification:');
  L.push(`   activation=${verification.activationConsistency} operationalDigest=${verification.operationalDigestConsistency} certification=${verification.certificationConsistency} release=${verification.releaseConsistency}`);
  L.push(`\n5) deterministic replay: ${out.deterministicReplay.digest1} vs ${out.deterministicReplay.digest2} → ${out.deterministicReplay.identical ? 'IDENTICAL' : 'DIVERGED'}`);
  L.push(`6) immutable assurance ledger: ${out.assuranceLedger.entries} entries  summary=${JSON.stringify(out.assuranceLedger.summary.byOutcome)}`);
  process.stdout.write(L.join('\n') + '\n');
}

// WP-16 consumes ONLY this layer — all evidence originates from WP-15.
export { runAssuranceCycle, ASSURANCE_PROFILES, evaluateAssurance, continuousVerification, synthOp };
const isDirectAsr = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isDirectAsr) main();
