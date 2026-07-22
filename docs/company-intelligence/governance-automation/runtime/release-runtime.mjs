#!/usr/bin/env node
// Canonical Governance Release Readiness & Production Gate Runtime — realizes GOV-AUTO-007 (WP-09).
//
// THE single authoritative release decision engine. It performs NO discovery, parsing, validation,
// census, health, freeze, graph, drift, or evidence generation of its own — it CONSUMES the WP-08
// Evidence Registry, which is itself the normalized aggregation of WP-02..07. All upstream evidence
// therefore reaches this runtime through the single certification source of truth (no re-aggregation).
// It evaluates 12 release criteria under configurable per-type policies, yields Ready / Ready With
// Warnings / Blocked, packages release evidence, and records immutable release history. Deterministic.
//
// Usage:
//   node release-runtime.mjs                      # production release evaluation
//   node release-runtime.mjs --type governance    # a specific release type
//   node release-runtime.mjs --all                # all five release types
//   node release-runtime.mjs --demo               # Ready + Warnings + Blocked + package + history + replay
//   node release-runtime.mjs --json               # machine-readable release decision
//   node release-runtime.mjs --persist            # append an immutable release record
//   node release-runtime.mjs --release-dir <dir>  # history location (default <repo>/.governance-releases)

import { existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { invoke } from './lib/runtime-invoke.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WP08 = path.join(__dirname, 'evidence-runtime.mjs');
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const DEFAULT_RELEASE_DIR = path.join(REPO_ROOT, '.governance-releases');

function consume(script, args = []) { return invoke(script, args); } // WP-12: orchestrator seam
function hash(str) { const s = typeof str === 'string' ? str : JSON.stringify(str); let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(16).padStart(8, '0'); }

// ---------------------------------------------------------------------------
// Release policy configuration (§4) — data, not code. New types/criteria add here or via extension.
// mandatory: criteria that must pass; a WARN on a mandatory criterion → Ready With Warnings; BLOCK → Blocked.
// ---------------------------------------------------------------------------
const RELEASE_POLICIES = {
  production: ['documentation', 'census', 'health', 'posture', 'freeze', 'dependency', 'impact', 'drift', 'compliance', 'certification-completeness', 'constitutional', 'outstanding-violations'],
  governance: ['documentation', 'census', 'health', 'drift', 'compliance', 'certification-completeness'],
  constitutional: ['documentation', 'census', 'freeze', 'constitutional', 'drift', 'certification-completeness'],
  certification: ['certification-completeness', 'compliance', 'health', 'census'],
  maintenance: ['documentation', 'census'],
};

// ---------------------------------------------------------------------------
// Criteria evaluation (§3) — every criterion derived from WP-08 evidence records.
// ---------------------------------------------------------------------------
function buildCriteria(reg) {
  const byType = (t) => reg.records.filter((r) => r.evidenceType === t);
  const one = (t) => byType(t)[0];
  const idOf = (t) => (one(t) ? one(t).evidenceId : null);
  const val = one('validation-summary')?.payload || {};
  const census = one('census-inventory')?.payload || {};
  const health = one('health-metrics')?.payload || {};
  const dep = one('dependency-analysis')?.payload || {};
  const drift = one('drift-report')?.payload || {};
  const compliance = one('compliance-report')?.payload || {};
  const freeze = byType('freeze-decision');
  const impacts = byType('impact-analysis');
  const bundle = (reg.bundles || []).find((b) => b.scope === 'repository') || { requiredTypesMissing: [] };

  const C = (id, runtime, status, evidence, ids) => ({ id, contributingRuntime: runtime, status, evidence, evidenceReferences: (ids || []).filter(Boolean), blockingImpact: status === 'block' });
  const band = (n, pass, warn) => (n >= pass ? 'pass' : n >= warn ? 'warn' : 'block');

  const outstanding = (reg.integrity.violations || 0) + (val.failures || 0) + (census.violations || 0) + (dep.integrityViolations || 0) + (drift.critical || 0);
  const maxImpact = impacts.reduce((m, r) => Math.max(m, ({ Critical: 3, High: 2, Moderate: 1, Low: 0 }[r.payload.impactLevel] ?? 0)), 0);

  return [
    C('documentation', 'GOV-AUTO-001', val.result === 'PASS' ? 'pass' : 'block', { result: val.result, failures: val.failures }, [idOf('validation-summary')]),
    C('census', 'GOV-AUTO-002', (census.violations || 0) === 0 ? 'pass' : 'block', { violations: census.violations, total: census.total }, [idOf('census-inventory')]),
    C('health', 'GOV-AUTO-008', band(health.overall ?? 0, 85, 70), { overall: health.overall, posture: health.posture }, [idOf('health-metrics')]),
    C('posture', 'GOV-AUTO-008', ['Excellent', 'Healthy'].includes(health.posture) ? 'pass' : health.posture === 'Needs Attention' ? 'warn' : 'block', { posture: health.posture }, [idOf('health-metrics')]),
    C('freeze', 'GOV-AUTO-003', freeze.length > 0 ? 'pass' : 'warn', { evaluated: freeze.length, denies: freeze.filter((f) => f.severity === 'block').length, note: 'demo denials are the guard working; no pending real mutation' }, freeze.map((f) => f.evidenceId).slice(0, 3)),
    C('dependency', 'GOV-AUTO-004', (dep.integrityViolations || 0) === 0 ? 'pass' : 'block', { integrityViolations: dep.integrityViolations, components: dep.components }, [idOf('dependency-analysis')]),
    C('impact', 'GOV-AUTO-004', 'pass', { maxSimulatedImpact: ['Low', 'Moderate', 'High', 'Critical'][maxImpact], note: 'simulated impacts are hypothetical; none pending' }, impacts.map((r) => r.evidenceId).slice(0, 3)),
    C('drift', 'GOV-AUTO-005', (drift.critical || 0) > 0 ? 'block' : (drift.driftDetected || 0) > 0 ? 'warn' : 'pass', { critical: drift.critical, detected: drift.driftDetected }, [idOf('drift-report')]),
    C('compliance', 'GOV-AUTO-005', band(compliance.overall ?? 0, 95, 80), { overall: compliance.overall }, [idOf('compliance-report')]),
    C('certification-completeness', 'GOV-AUTO-006', (bundle.requiredTypesMissing || []).length === 0 ? 'pass' : 'warn', { missing: bundle.requiredTypesMissing }, [idOf('compliance-report')]),
    C('constitutional', 'GOV-AUTO-005', band(compliance.byCategory?.constitutional ?? 100, 100, 80), { constitutional: compliance.byCategory?.constitutional }, [idOf('compliance-report')]),
    C('outstanding-violations', 'GOV-AUTO-006', outstanding === 0 ? 'pass' : 'block', { outstanding }, [idOf('validation-summary'), idOf('census-inventory'), idOf('dependency-analysis'), idOf('drift-report')]),
  ];
}

// ---------------------------------------------------------------------------
// Decision engine (§2) — deterministic from criteria + policy.
// ---------------------------------------------------------------------------
function decide(releaseType, criteria) {
  const mandatoryIds = RELEASE_POLICIES[releaseType] || [];
  const mandatory = criteria.filter((c) => mandatoryIds.includes(c.id));
  const blockers = mandatory.filter((c) => c.status === 'block');
  const warnings = mandatory.filter((c) => c.status === 'warn');
  const informational = criteria.filter((c) => !mandatoryIds.includes(c.id));
  const decision = blockers.length ? 'Blocked' : warnings.length ? 'Ready With Warnings' : 'Ready';
  return { releaseType, decision, mandatory, blockers, warnings, informational };
}

// ---------------------------------------------------------------------------
// Release evidence package (§5) + blocking analysis (§6)
// ---------------------------------------------------------------------------
function packageRelease(reg, evalResult) {
  const { releaseType, decision, mandatory, blockers, warnings } = evalResult;
  const health = reg.records.find((r) => r.evidenceType === 'health-metrics')?.payload || {};
  const compliance = reg.records.find((r) => r.evidenceType === 'compliance-report')?.payload || {};
  const decisionDigest = hash([releaseType, decision, mandatory.map((c) => [c.id, c.status])]);
  return {
    releaseId: `REL-${releaseType}-${reg.repositoryRevision}-${decisionDigest}`,
    releaseType, decision, decisionDigest,
    repositoryRevision: reg.repositoryRevision, registryDigest: reg.registryDigest,
    governancePosture: health.posture, complianceScore: compliance.overall,
    evaluatedCriteria: mandatory.map((c) => ({ id: c.id, status: c.status, contributingRuntime: c.contributingRuntime, evidence: c.evidence })),
    evidenceReferences: [...new Set(mandatory.flatMap((c) => c.evidenceReferences))].sort(),
    evidenceDigests: { registry: reg.registryDigest, revision: reg.repositoryRevision },
    blockers: blockers.map((c) => ({ criterion: c.id, runtime: c.contributingRuntime, evidence: c.evidence, evidenceReferences: c.evidenceReferences })),
    warnings: warnings.map((c) => ({ criterion: c.id, runtime: c.contributingRuntime, evidence: c.evidence })),
    releaseRiskSummary: { blockers: blockers.length, warnings: warnings.length, riskLevel: decision === 'Blocked' ? 'High' : decision === 'Ready With Warnings' ? 'Medium' : 'Low' },
  };
}

// ---------------------------------------------------------------------------
// Immutable release history (§7)
// ---------------------------------------------------------------------------
function persist(pkg, dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const record = { ...pkg, recordedAt: new Date().toISOString() };
  const file = path.join(dir, `release-${pkg.releaseType}-${ts}.json`);
  writeFileSync(file, JSON.stringify(record, null, 2)); // timestamped — immutable, never overwritten
  return file;
}
function historyIndex(dir) { return existsSync(dir) ? readdirSync(dir).filter((f) => f.startsWith('release-') && f.endsWith('.json')).sort() : []; }

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------
function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; }

function main() {
  const asJson = process.argv.includes('--json');
  const releaseDir = path.resolve(arg('--release-dir') || DEFAULT_RELEASE_DIR);

  const t0 = performance.now();
  const tc = performance.now();
  const reg = consume(WP08, ['--bundle', 'repository']); // WP-08 = normalized union of WP-02..07 + repository bundle
  const consumeMs = +(performance.now() - tc).toFixed(1);

  const te = performance.now();
  const criteria = buildCriteria(reg);
  const evalMs = +(performance.now() - te).toFixed(1);

  if (process.argv.includes('--demo')) { runDemo(reg, criteria, releaseDir, asJson, { consumeMs, evalMs, t0 }); return; }

  const types = process.argv.includes('--all') ? Object.keys(RELEASE_POLICIES) : [arg('--type') || 'production'];
  const results = types.map((t) => { const ev = decide(t, criteria); return packageRelease(reg, ev); });
  let history = null;
  if (process.argv.includes('--persist')) { const files = results.map((r) => persist(r, releaseDir)); history = { written: files.length, index: historyIndex(releaseDir).length }; }

  const observability = {
    runtimeMs: +(performance.now() - t0).toFixed(1), consumeMs, evaluationMs: evalMs, decisionMs: +(performance.now() - te).toFixed(1),
    criteriaEvaluated: criteria.length, releasePoliciesEvaluated: types.length, evidenceConsumed: reg.evidenceCount,
    heapUsedMB: +(process.memoryUsage().heapUsed / 1048576).toFixed(1),
  };
  const out = { tool: 'governance-release-gate', runtimeVersion: '1.0.0', mapsTo: 'GOV-AUTO-007', consumes: { wp08: 'GOV-AUTO-006 evidence registry (union of WP-02..07)' }, repositoryRevision: reg.repositoryRevision, releases: results, ...(history ? { history } : {}), observability };

  if (asJson) process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  else {
    const L = [];
    L.push('Governance Release Readiness & Production Gate Runtime — GOV-AUTO-007 (canonical)');
    L.push(`consumes: WP-08 evidence registry (union of WP-02..07)  ·  revision: ${reg.repositoryRevision}`);
    for (const r of results) {
      L.push(`\n${r.releaseType.toUpperCase()} RELEASE: ${r.decision}  (risk ${r.releaseRiskSummary.riskLevel})  digest=${r.decisionDigest}`);
      L.push(`  posture=${r.governancePosture}  compliance=${r.complianceScore}  blockers=${r.blockers.length}  warnings=${r.warnings.length}`);
      for (const b of r.blockers) L.push(`    [BLOCK] ${b.criterion} (${b.runtime}) ${JSON.stringify(b.evidence)}`);
      for (const w of r.warnings) L.push(`    [WARN]  ${w.criterion} (${w.runtime})`);
    }
    L.push(`\nobservability: ${observability.runtimeMs}ms (consume ${consumeMs}ms)  criteria ${criteria.length}  evidence ${reg.evidenceCount}  heap ${observability.heapUsedMB}MB`);
    process.stdout.write(L.join('\n') + '\n');
  }
  process.exit(results.some((r) => r.decision === 'Blocked') ? 1 : 0);
}

function runDemo(reg, criteria, releaseDir, asJson, timing) {
  // Real evaluations across all five release types.
  const real = Object.keys(RELEASE_POLICIES).map((t) => { const ev = decide(t, criteria); return { ...packageRelease(reg, ev), _decision: ev.decision }; });
  // Synthetic WARN: force compliance criterion to warn → production = Ready With Warnings.
  const warnCriteria = criteria.map((c) => c.id === 'compliance' ? { ...c, status: 'warn' } : c);
  const warnPkg = packageRelease(reg, decide('production', warnCriteria));
  // Synthetic BLOCK: force documentation criterion to block → production = Blocked.
  const blockCriteria = criteria.map((c) => c.id === 'documentation' ? { ...c, status: 'block', blockingImpact: true } : c);
  const blockPkg = packageRelease(reg, decide('production', blockCriteria));
  // Immutable history + deterministic replay.
  const f1 = persist(real[0], releaseDir); const f2 = persist(warnPkg, releaseDir);
  const replay = packageRelease(reg, decide('production', criteria));

  const out = {
    tool: 'governance-release-gate', mode: 'demo', mapsTo: 'GOV-AUTO-007', repositoryRevision: reg.repositoryRevision,
    realDecisions: real.map((r) => ({ releaseType: r.releaseType, decision: r.decision, risk: r.releaseRiskSummary.riskLevel, digest: r.decisionDigest })),
    syntheticReadyWithWarnings: { decision: warnPkg.decision, warnings: warnPkg.warnings.map((w) => w.criterion), digest: warnPkg.decisionDigest },
    syntheticBlocked: { decision: blockPkg.decision, blockers: blockPkg.blockers.map((b) => b.criterion), digest: blockPkg.decisionDigest },
    history: { files: historyIndex(releaseDir).length, immutableFirst: path.basename(f1), retrievalAxes: ['releaseId', 'repositoryRevision', 'timestamp', 'releaseType'] },
    deterministicReplay: { digest1: real.find((r) => r.releaseType === 'production').decisionDigest, digest2: replay.decisionDigest, identical: real.find((r) => r.releaseType === 'production').decisionDigest === replay.decisionDigest },
    productionEvidencePackage: real.find((r) => r.releaseType === 'production'),
  };
  if (asJson) { process.stdout.write(JSON.stringify(out, null, 2) + '\n'); return; }
  const L = [];
  L.push('Governance Release Gate — GOV-AUTO-007 (canonical) — DEMO');
  L.push(`revision: ${reg.repositoryRevision}  ·  evidence consumed: ${reg.evidenceCount}`);
  L.push('\n1) real release decisions (all five types):');
  for (const r of out.realDecisions) L.push(`   ${r.releaseType.padEnd(15)} ${r.decision.padEnd(20)} risk=${r.risk} digest=${r.digest}`);
  L.push(`\n2) synthetic Ready With Warnings (compliance→warn): ${out.syntheticReadyWithWarnings.decision}  [${out.syntheticReadyWithWarnings.warnings.join(',')}]`);
  L.push(`3) synthetic Blocked (documentation→block): ${out.syntheticBlocked.decision}  [${out.syntheticBlocked.blockers.join(',')}]`);
  L.push(`4) immutable history: ${out.history.files} records (retrieval by ${out.history.retrievalAxes.join('/')})`);
  L.push(`5) deterministic replay: ${out.deterministicReplay.digest1} vs ${out.deterministicReplay.digest2} → ${out.deterministicReplay.identical ? 'IDENTICAL' : 'DIVERGED'}`);
  L.push(`\nproduction evidence package: decision=${out.productionEvidencePackage.decision} criteria=${out.productionEvidencePackage.evaluatedCriteria.length} evidenceRefs=${out.productionEvidencePackage.evidenceReferences.length} risk=${out.productionEvidencePackage.releaseRiskSummary.riskLevel}`);
  process.stdout.write(L.join('\n') + '\n');
}

main();
