#!/usr/bin/env node
// Canonical Repository Health & Governance Posture Runtime — realizes GOV-AUTO-008 (WP-04).
//
// THE single runtime that computes the repository's governance posture from OBJECTIVE EVIDENCE.
// It performs NO discovery, NO parsing, NO validation of its own — it CONSUMES the machine-readable
// outputs of WP-02 (Documentation Validation Runtime) and WP-03 (Constitutional Census Runtime),
// which are the only components allowed to traverse/parse/validate the repository. This is the
// aggregation layer (GOV-AUTO-008 §1), derive-only, additive, deterministic.
//
// Usage:
//   node health-runtime.mjs                       # human posture report
//   node health-runtime.mjs --json                # full machine-readable health report
//   node health-runtime.mjs --snapshot            # also persist a timestamped snapshot (never overwrites)
//   node health-runtime.mjs --compare <file>      # trend analysis vs a prior snapshot (or latest if omitted)
//   node health-runtime.mjs --snapshot-dir <dir>  # snapshot location (default: <repo>/.governance-snapshots)

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { invoke } from './lib/runtime-invoke.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WP02 = path.join(__dirname, 'validate-docs.mjs');
const WP03 = path.join(__dirname, 'census-runtime.mjs');
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const DEFAULT_SNAP_DIR = path.join(REPO_ROOT, '.governance-snapshots');

// ---------------------------------------------------------------------------
// Reuse: consume WP-02 / WP-03 canonical JSON outputs (stdout captured even on non-zero exit).
// ---------------------------------------------------------------------------
function consume(script, args = []) { return { json: invoke(script, args), exit: 0 }; } // WP-12: orchestrator seam

// ---------------------------------------------------------------------------
// Deterministic scoring helpers
// ---------------------------------------------------------------------------
const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));
const pct = (part, whole) => (whole ? clamp((part / whole) * 100) : 100);
function statusFor(score) {
  if (score >= 95) return 'Excellent';
  if (score >= 85) return 'Healthy';
  if (score >= 70) return 'Needs Attention';
  if (score >= 50) return 'At Risk';
  return 'Critical';
}
function hash(str) { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0; return h.toString(16).padStart(8, '0'); }

// Count WP-02 findings by mapsTo prefix + severity.
function cw2(wp02, mapsToPrefixes, severity) {
  return wp02.findings.filter((f) =>
    (severity ? f.severity === severity : true) &&
    mapsToPrefixes.some((p) => f.mapsTo === p || f.mapsTo.startsWith(p))).length;
}
// Count WP-03 findings by rule set + severity.
function cw3(wp03, rules, severity) {
  return wp03.findings.filter((f) => (severity ? f.severity === severity : true) && rules.includes(f.rule)).length;
}

// ---------------------------------------------------------------------------
// Health dimensions (§2) — each: score, status, evidence, contributingRules
// ---------------------------------------------------------------------------
function computeDimensions(wp02, wp03) {
  const arts = wp03.artifacts;
  const total = arts.length;
  const gaTypes = new Set(['governance-audit', 'governance-program', 'realization-program', 'certification-program', 'execution-program', 'execution-audit', 'work-package']);
  const gaPrograms = arts.filter((a) => gaTypes.has(a.documentType));
  const gc = wp03.inventory.governanceCoverage;

  const w2block = wp02.stats.failures, w2warn = wp02.stats.warnings;
  const badDocFiles = new Set(wp02.findings.filter((f) => f.severity === 'BLOCK').map((f) => f.file));

  const D = (name, mapsTo, score, evidence, contributingRules) => ({ name, mapsTo, score: clamp(score), status: statusFor(clamp(score)), evidence, contributingRules });

  const dims = [];
  // 1 Documentation Health ← WP-02
  dims.push(D('Documentation Health', 'GOV-AUTO-008 §Documentation', 100 - 25 * w2block - 5 * w2warn,
    { validationResult: wp02.result, blocking: w2block, warnings: w2warn, documentsScanned: wp02.stats.documentsScanned },
    ['V1', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8', 'V9', 'V11']));
  // 2 Governance Coverage ← WP-03 governanceCoverage
  dims.push(D('Governance Coverage', 'GOV-AUTO-008 §Coverage',
    (pct(gc.withOwner, gc.governancePrograms) + pct(gc.withClassification, gc.governancePrograms) + pct(gc.withDependencies, gc.governancePrograms)) / 3,
    { programs: gc.governancePrograms, owned: gc.withOwner, classified: gc.withClassification, withDeps: gc.withDependencies },
    ['NO-DEPS', 'BAD-OWNER', 'BAD-CLASS']));
  // 3 Repository Integrity ← WP-02 STRUCTURE + WP-03 structural
  const integ = cw2(wp02, ['V-struct'], 'BLOCK') + cw3(wp03, ['DUP-REG', 'ORPHAN', 'FULL-ORPHAN', 'MISSING-REQ'], 'BLOCK');
  dims.push(D('Repository Integrity', 'GOV-AUTO-008 §Integrity', 100 - 20 * integ,
    { structuralViolations: integ }, ['STRUCT-DIR', 'STRUCT-FILE', 'DUP-REG', 'MISSING-REQ', 'FULL-ORPHAN']));
  // 4 Constitutional Compliance ← WP-02 V6/V11 + WP-03 lifecycle/relationship
  const compl = cw2(wp02, ['V6', 'V11'], 'BLOCK') + cw3(wp03, ['BAD-LIFECYCLE', 'BAD-REL'], 'BLOCK');
  dims.push(D('Constitutional Compliance', 'GOV-AUTO-008 §Compliance', 100 - 20 * compl,
    { complianceViolations: compl }, ['V6', 'V11', 'BAD-LIFECYCLE', 'BAD-REL']));
  // 5 Dependency Completeness ← WP-03 artifacts (declaresDependencies; AUDIT-005 is a root)
  const depOk = gaPrograms.filter((a) => a.declaresDependencies || a.canonicalId === 'AUDIT-005').length;
  dims.push(D('Dependency Completeness', 'GOV-AUTO-008 §Dependencies', pct(depOk, gaPrograms.length),
    { gaPrograms: gaPrograms.length, declaring: depOk }, ['NO-DEPS', 'BAD-REL']));
  // 6 Ownership Completeness ← WP-03
  const owned = arts.filter((a) => a.owner && a.owner.trim()).length;
  dims.push(D('Ownership Completeness', 'GOV-AUTO-008 §Ownership', pct(owned, total),
    { owned, total }, ['BAD-OWNER']));
  // 7 Lifecycle Completeness ← WP-03
  const valid = new Set(['Ratified', 'Specified', 'Template', 'Draft', 'Superseded', 'Archived', 'Withdrawn']);
  const lifeOk = arts.filter((a) => valid.has(a.lifecycleStage)).length;
  dims.push(D('Lifecycle Completeness', 'GOV-AUTO-008 §Lifecycle', pct(lifeOk, total),
    { validLifecycle: lifeOk, total, distribution: wp03.inventory.byLifecycle }, ['BAD-LIFECYCLE']));
  // 8 Version Consistency ← WP-03 BAD-VERSION + WP-02 V11
  const vbad = cw3(wp03, ['BAD-VERSION'], null) + cw2(wp02, ['V11'], 'BLOCK') + cw2(wp02, ['V6'], 'BLOCK');
  dims.push(D('Version Consistency', 'GOV-AUTO-008 §Version', 100 - 20 * vbad,
    { versionIssues: vbad, distribution: wp03.inventory.byVersion }, ['BAD-VERSION', 'V6', 'V11']));
  // 9 Amendment Integrity ← WP-02 V5 + WP-03 amendment records
  const amdBad = cw2(wp02, ['V5'], 'BLOCK');
  dims.push(D('Amendment Integrity', 'GOV-AUTO-008 §Amendment', 100 - 20 * amdBad,
    { amendmentIssues: amdBad, amendmentRecords: wp03.inventory.amendmentRelationships.length }, ['V5']));
  // 10 Navigation Integrity ← WP-02 V1/V2
  const nav = cw2(wp02, ['V1', 'V2'], 'BLOCK');
  dims.push(D('Navigation Integrity', 'GOV-AUTO-008 §Navigation', 100 - 20 * nav,
    { navigationViolations: nav }, ['V1', 'V2']));

  return dims;
}

// ---------------------------------------------------------------------------
// Metrics (§4)
// ---------------------------------------------------------------------------
function computeMetrics(wp02, wp03, dims) {
  const dim = (n) => dims.find((d) => d.name === n).score;
  const badDocs = new Set(wp02.findings.filter((f) => f.severity === 'BLOCK').map((f) => f.file)).size;
  const docs = wp02.stats.documentsScanned;
  const amd = wp03.inventory.amendmentRelationships;
  return {
    governedArtifactCount: wp03.inventory.total,
    validationPassRate: pct(docs - badDocs, docs),
    ownershipCoverage: dim('Ownership Completeness'),
    lifecycleCoverage: dim('Lifecycle Completeness'),
    dependencyCompleteness: dim('Dependency Completeness'),
    amendmentCoverage: amd.length ? pct(amd.filter((a) => a.target).length, amd.length) : 100,
    documentationCompleteness: 100 - 20 * cw2(wp02, ['V-struct'], 'BLOCK'),
    constitutionalCompliance: dim('Constitutional Compliance'),
    governanceMaturity: Math.round(dims.reduce((s, d) => s + d.score, 0) / dims.length),
  };
}

// ---------------------------------------------------------------------------
// Posture (§3) — reproducible from dimension scores; any BLOCK caps posture.
// ---------------------------------------------------------------------------
function computePosture(dims, wp02, wp03) {
  const overall = Math.round(dims.reduce((s, d) => s + d.score, 0) / dims.length);
  let classification = statusFor(overall);
  const hardFailures = wp02.stats.failures + wp03.stats.violations;
  // Objective cap: unresolved blocking evidence cannot read as Healthy/Excellent.
  if (hardFailures > 0 && (classification === 'Healthy' || classification === 'Excellent')) classification = 'Needs Attention';
  return { overallScore: overall, classification, hardFailures };
}

// ---------------------------------------------------------------------------
// Snapshots (§5) + Trend (§6)
// ---------------------------------------------------------------------------
function toSnapshot(report) {
  return {
    timestamp: report.generatedAt,
    digest: report.digest,
    posture: report.posture.classification,
    overallScore: report.posture.overallScore,
    dimensions: Object.fromEntries(report.dimensions.map((d) => [d.name, d.score])),
    metrics: report.metrics,
  };
}
function writeSnapshot(report, dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const safe = report.generatedAt.replace(/[:.]/g, '-');
  const file = path.join(dir, `health-${safe}.json`);
  writeFileSync(file, JSON.stringify(toSnapshot(report), null, 2)); // timestamped filename — never overwrites history
  return file;
}
function latestSnapshot(dir) {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.startsWith('health-') && f.endsWith('.json')).sort();
  return files.length ? path.join(dir, files[files.length - 1]) : null;
}
function trend(current, previous) {
  const cur = toSnapshot(current);
  const cmp = (curObj, prevObj) => {
    const improvements = [], regressions = [], unchanged = [];
    for (const k of Object.keys(curObj)) {
      const c = curObj[k], p = prevObj[k];
      if (typeof c !== 'number' || typeof p !== 'number') continue;
      const delta = c - p;
      const row = { key: k, from: p, to: c, delta };
      if (delta > 0) improvements.push(row); else if (delta < 0) regressions.push(row); else unchanged.push(row);
    }
    return { improvements, regressions, unchanged };
  };
  const dimTrend = cmp(cur.dimensions, previous.dimensions || {});
  const metricTrend = cmp(cur.metrics, previous.metrics || {});
  const govCoverage = (cur.dimensions['Governance Coverage'] || 0) - (previous.dimensions?.['Governance Coverage'] || 0);
  const integrity = (cur.dimensions['Repository Integrity'] || 0) - (previous.dimensions?.['Repository Integrity'] || 0);
  return {
    previousTimestamp: previous.timestamp, previousPosture: previous.posture, currentPosture: cur.posture,
    overallDelta: cur.overallScore - (previous.overallScore || 0),
    dimensions: dimTrend, metrics: metricTrend,
    signals: {
      healthDirection: cur.overallScore > (previous.overallScore || 0) ? 'improving' : (cur.overallScore < (previous.overallScore || 0) ? 'declining' : 'stable'),
      governanceDrift: govCoverage < 0,
      coverageChange: govCoverage,
      documentationGrowth: (cur.metrics.governedArtifactCount || 0) - (previous.metrics?.governedArtifactCount || 0),
      structuralRegression: integrity < 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------
function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; }
function iso() { return new Date().toISOString(); }

function main() {
  const asJson = process.argv.includes('--json');
  const doSnapshot = process.argv.includes('--snapshot');
  const doCompare = process.argv.includes('--compare');
  const snapDir = path.resolve(arg('--snapshot-dir') || DEFAULT_SNAP_DIR);

  const t0 = performance.now();
  const t2a = performance.now();
  const { json: wp02 } = consume(WP02);
  const { json: wp03 } = consume(WP03);
  const consumeMs = +(performance.now() - t2a).toFixed(1);

  const tScore = performance.now();
  const dimensions = computeDimensions(wp02, wp03);
  const posture = computePosture(dimensions, wp02, wp03);
  const metrics = computeMetrics(wp02, wp03, dimensions);
  const scoreMs = +(performance.now() - tScore).toFixed(1);

  // Deterministic digest — over posture/dimensions/metrics only (excludes timestamp & timing).
  const digest = hash(JSON.stringify([posture, dimensions.map((d) => [d.name, d.score, d.status]), metrics]));

  const report = {
    tool: 'repository-health-runtime', runtimeVersion: '1.0.0', mapsTo: 'GOV-AUTO-008',
    generatedAt: iso(), digest,
    consumes: { wp02: 'GOV-AUTO-001 validate-docs', wp03: 'GOV-AUTO-002 census-runtime' },
    posture, dimensions, metrics,
    sources: { documentationValidation: wp02.result, census: wp03.stats.violations === 0 ? 'PASS' : 'FAIL' },
  };

  // Snapshot + trend
  let snapshotFile = null, trendReport = null;
  const tSnap = performance.now();
  if (doCompare) {
    const prevFile = arg('--compare') && !arg('--compare').startsWith('--') ? path.resolve(arg('--compare')) : latestSnapshot(snapDir);
    if (prevFile && existsSync(prevFile)) trendReport = trend(report, JSON.parse(readFileSync(prevFile, 'utf8')));
  }
  if (doSnapshot) snapshotFile = writeSnapshot(report, snapDir);
  const snapMs = +(performance.now() - tSnap).toFixed(1);

  report.observability = {
    runtimeMs: +(performance.now() - t0).toFixed(1),
    consumeMs, scoringMs: scoreMs, snapshotTrendMs: snapMs,
    artifactsEvaluated: wp03.inventory.total,
    rulesConsumed: (wp02.stats.ruleIds?.length || 0) + wp03.stats.rulesExecuted,
    heapUsedMB: +(process.memoryUsage().heapUsed / 1048576).toFixed(1),
    snapshotFile, trendComputed: !!trendReport,
  };
  if (trendReport) report.trend = trendReport;

  if (asJson) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    const L = [];
    L.push('Repository Health & Governance Posture Runtime — GOV-AUTO-008 (canonical)');
    L.push(`consumes: WP-02 (${wp02.result}) + WP-03 (${report.sources.census})  ·  digest: ${digest}`);
    L.push(`\nGOVERNANCE POSTURE: ${posture.classification}   overall: ${posture.overallScore}/100   (blocking evidence: ${posture.hardFailures})`);
    L.push('\ndimensions:');
    for (const d of dimensions) L.push(`  ${String(d.score).padStart(3)}  ${d.status.padEnd(16)} ${d.name}`);
    L.push('\nmetrics:');
    for (const [k, v] of Object.entries(metrics)) L.push(`  ${String(v).padStart(4)}  ${k}`);
    if (snapshotFile) L.push(`\nsnapshot: ${path.relative(REPO_ROOT, snapshotFile)}`);
    if (trendReport) {
      L.push(`\ntrend vs ${trendReport.previousTimestamp} (${trendReport.previousPosture} → ${trendReport.currentPosture}), overallΔ ${trendReport.overallDelta >= 0 ? '+' : ''}${trendReport.overallDelta}:`);
      L.push(`  health: ${trendReport.signals.healthDirection}   drift: ${trendReport.signals.governanceDrift}   docGrowth: ${trendReport.signals.documentationGrowth}   structuralRegression: ${trendReport.signals.structuralRegression}`);
      L.push(`  dimensions ↑${trendReport.dimensions.improvements.length} ↓${trendReport.dimensions.regressions.length} =${trendReport.dimensions.unchanged.length}   metrics ↑${trendReport.metrics.improvements.length} ↓${trendReport.metrics.regressions.length} =${trendReport.metrics.unchanged.length}`);
    }
    L.push(`\nobservability: ${report.observability.runtimeMs}ms (consume ${consumeMs}ms, score ${scoreMs}ms)  heap ${report.observability.heapUsedMB}MB  rulesConsumed ${report.observability.rulesConsumed}`);
    process.stdout.write(L.join('\n') + '\n');
  }
  // Exit reflects posture: non-zero only when unresolved blocking evidence exists.
  process.exit(posture.hardFailures === 0 ? 0 : 1);
}

main();
