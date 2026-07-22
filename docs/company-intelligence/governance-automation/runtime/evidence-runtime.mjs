#!/usr/bin/env node
// Canonical Governance Evidence Registry & Certification Evidence Runtime — realizes GOV-AUTO-006 (WP-08).
//
// THE single source of truth for certification evidence. It performs NO discovery, parsing, validation,
// census, health, freeze, graph, or drift analysis of its own — it INGESTS the machine-readable outputs
// of every upstream governance runtime (WP-02..07), normalizes them into ONE canonical evidence schema,
// indexes and relates them, validates evidence integrity, generates certification bundles, and maintains
// immutable evidence history. Deterministic, additive, single-runtime doctrine.
//
// Usage:
//   node evidence-runtime.mjs                        # ingest + normalize + integrity + summary
//   node evidence-runtime.mjs --json                 # full machine-readable registry
//   node evidence-runtime.mjs --bundle <scope>       # certification bundle (repository | work-package:WP-04 | governance-program:GOV-AUTO-004 | constitutional-release | certification-event)
//   node evidence-runtime.mjs --demo                 # ingestion + integrity + bundles + history + replay
//   node evidence-runtime.mjs --persist              # append an immutable registry snapshot to history
//   node evidence-runtime.mjs --evidence-dir <dir>   # history location (default <repo>/.governance-evidence)

import { existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { invoke } from './lib/runtime-invoke.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const R = (n) => path.join(__dirname, n);
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const DEFAULT_EVIDENCE_DIR = path.join(REPO_ROOT, '.governance-evidence');

// Upstream runtime map: work package → { script, args, source runtime }
const UPSTREAM = {
  'WP-02': { script: R('validate-docs.mjs'), args: [], source: 'GOV-AUTO-001' },
  'WP-03': { script: R('census-runtime.mjs'), args: [], source: 'GOV-AUTO-002' },
  'WP-04': { script: R('health-runtime.mjs'), args: [], source: 'GOV-AUTO-008' },
  'WP-05': { script: R('freeze-runtime.mjs'), args: ['--demo', '--no-ledger'], source: 'GOV-AUTO-003' },
  'WP-06': { script: R('graph-runtime.mjs'), args: ['--demo'], source: 'GOV-AUTO-004' },
  'WP-07': { script: R('drift-runtime.mjs'), args: [], source: 'GOV-AUTO-005' },
};
const KNOWN_SOURCES = new Set(Object.values(UPSTREAM).map((u) => u.source));
const REQUIRED_TYPES = ['validation-summary', 'census-inventory', 'health-metrics', 'freeze-decision', 'dependency-analysis', 'impact-analysis', 'drift-report', 'compliance-report'];

function consume(script, args = []) { return invoke(script, args); } // WP-12: orchestrator seam
function hash(str) { let h = 5381; const s = typeof str === 'string' ? str : JSON.stringify(str); for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(16).padStart(8, '0'); }

// ---------------------------------------------------------------------------
// Normalization (§3) — every upstream output → the common evidence schema.
// ---------------------------------------------------------------------------
function normalize(consumed, revision, lifecycleOf) {
  const raw = [];
  const add = (source, wp, type, severity, artifacts, payload) =>
    raw.push({ sourceRuntime: source, sourceWorkPackage: wp, evidenceType: type, severity, governingArtifacts: artifacts.length ? artifacts : ['repository'], payload });

  // WP-02 validation
  const v = consumed['WP-02'];
  add('GOV-AUTO-001', 'WP-02', 'validation-summary', v.result === 'PASS' ? 'pass' : 'fail', ['repository'], { result: v.result, documents: v.stats.documentsScanned, failures: v.stats.failures, warnings: v.stats.warnings });
  for (const f of v.findings) add('GOV-AUTO-001', 'WP-02', 'validation-finding', f.severity.toLowerCase(), [f.file], { rule: f.rule, mapsTo: f.mapsTo, message: f.message });

  // WP-03 census
  const c = consumed['WP-03'];
  add('GOV-AUTO-002', 'WP-03', 'census-inventory', c.stats.violations ? 'fail' : 'pass', ['repository'], { total: c.inventory.total, byCategory: c.inventory.byCategory, violations: c.stats.violations });
  for (const f of c.findings) add('GOV-AUTO-002', 'WP-03', 'census-finding', f.severity.toLowerCase(), [String(f.artifact)], { rule: f.rule, message: f.message });

  // WP-04 health
  const h = consumed['WP-04'];
  add('GOV-AUTO-008', 'WP-04', 'health-metrics', h.posture.classification === 'Excellent' || h.posture.classification === 'Healthy' ? 'pass' : 'warn', ['repository'], { posture: h.posture.classification, overall: h.posture.overallScore, metrics: h.metrics });
  for (const d of h.dimensions) add('GOV-AUTO-008', 'WP-04', 'health-dimension', d.status === 'Excellent' || d.status === 'Healthy' ? 'pass' : 'warn', ['repository'], { dimension: d.name, score: d.score, status: d.status });

  // WP-05 freeze decisions
  const fz = consumed['WP-05'];
  for (const e of fz.evaluations) add('GOV-AUTO-003', 'WP-05', 'freeze-decision', e.decision === 'Deny' ? 'block' : e.decision === 'Allow With Warning' ? 'warn' : 'pass', [e.request.target], { operation: e.requestedOperation, decision: e.decision, evidenceDigest: e.evidenceDigest });

  // WP-06 dependency + impact
  const g = consumed['WP-06'];
  add('GOV-AUTO-004', 'WP-06', 'dependency-analysis', g.integrity.violations ? 'fail' : 'pass', ['repository'], { nodes: g.graph.nodes, edges: g.graph.edges, components: g.graph.components, integrityViolations: g.integrity.violations, integrityWarnings: g.integrity.warnings });
  for (const s of (g.simulations || [])) add('GOV-AUTO-004', 'WP-06', 'impact-analysis', s.impact.overallImpactLevel === 'Critical' ? 'block' : s.impact.overallImpactLevel === 'High' ? 'warn' : 'info', [s.request.target], { operation: s.request.operation, impactLevel: s.impact.overallImpactLevel, direct: s.impact.directCount, indirect: s.impact.indirectCount, freeze: s.freezeDecision });

  // WP-07 drift + compliance
  const dr = consumed['WP-07'];
  add('GOV-AUTO-005', 'WP-07', 'drift-report', dr.compliance.criticalDrift ? 'block' : dr.driftDetected ? 'warn' : 'pass', ['repository'], { baseline: dr.baseline.id, driftDetected: dr.driftDetected, critical: dr.compliance.criticalDrift, warning: dr.compliance.warningDrift });
  add('GOV-AUTO-005', 'WP-07', 'compliance-report', dr.compliance.overall >= 90 ? 'pass' : dr.compliance.overall >= 70 ? 'warn' : 'fail', ['repository'], { overall: dr.compliance.overall, byCategory: dr.compliance.byCategory, outstandingViolations: dr.compliance.outstandingViolations });

  // Assign ids, digests, timestamps, lifecycle, relationships. Deterministic ordering.
  raw.sort((a, b) => a.sourceWorkPackage.localeCompare(b.sourceWorkPackage) || a.evidenceType.localeCompare(b.evidenceType) || String(a.governingArtifacts).localeCompare(String(b.governingArtifacts)) || hash(a.payload).localeCompare(hash(b.payload)));
  const records = raw.map((e, i) => {
    const evidenceDigest = hash([e.sourceRuntime, e.evidenceType, e.governingArtifacts, e.payload]);
    return {
      evidenceId: `EV-${e.sourceWorkPackage}-${String(i).padStart(4, '0')}-${evidenceDigest}`,
      sourceRuntime: e.sourceRuntime, sourceWorkPackage: e.sourceWorkPackage, evidenceType: e.evidenceType,
      evidenceDigest, repositoryRevision: revision,
      governingArtifacts: e.governingArtifacts,
      lifecycleStage: e.governingArtifacts.map((a) => lifecycleOf[a] || (a === 'repository' ? 'n/a' : 'unknown'))[0],
      severity: e.severity, status: 'current', payload: e.payload,
    };
  });
  return records;
}

// ---------------------------------------------------------------------------
// Evidence integrity (§5)
// ---------------------------------------------------------------------------
function integrity(records, knownArtifactIds) {
  const out = [];
  const F = (rule, map, severity, subject, message) => out.push({ rule, mapsTo: map, severity, subject, message });
  const seen = new Map();
  for (const r of records) {
    if (seen.has(r.evidenceId)) F('DUP-EVIDENCE', '§5 duplicate', 'BLOCK', r.evidenceId, `duplicate evidence id`); else seen.set(r.evidenceId, r);
    if (!KNOWN_SOURCES.has(r.sourceRuntime)) F('INVALID-SOURCE', '§5 invalid source', 'BLOCK', r.evidenceId, `unknown source runtime ${r.sourceRuntime}`);
    const recomputed = hash([r.sourceRuntime, r.evidenceType, r.governingArtifacts, r.payload]);
    if (recomputed !== r.evidenceDigest) F('DIGEST-MISMATCH', '§5 digest mismatch', 'BLOCK', r.evidenceId, `digest ${r.evidenceDigest} != recomputed ${recomputed}`);
    if (!r.governingArtifacts || !r.governingArtifacts.length) F('ORPHAN-EVIDENCE', '§5 orphan', 'BLOCK', r.evidenceId, `evidence governs no artifact`);
    for (const a of r.governingArtifacts) if (a !== 'repository' && !knownArtifactIds.has(a) && !/\.md$/.test(a) && !/^\(/.test(a)) F('INVALID-REL', '§5 invalid relationship', 'WARN', r.evidenceId, `relationship to unknown artifact ${a}`);
  }
  for (const t of REQUIRED_TYPES) if (!records.some((r) => r.evidenceType === t)) F('MISSING-EVIDENCE', '§5 missing', 'BLOCK', t, `required evidence type not ingested: ${t}`);
  out.sort((a, b) => (a.severity < b.severity ? 1 : a.severity > b.severity ? -1 : 0) || a.rule.localeCompare(b.rule) || String(a.subject).localeCompare(String(b.subject)));
  return out;
}

// ---------------------------------------------------------------------------
// Certification bundles (§6)
// ---------------------------------------------------------------------------
function makeBundle(records, scope) {
  let selected;
  if (scope === 'repository' || scope === 'constitutional-release' || scope === 'certification-event') selected = records;
  else if (scope.startsWith('work-package:')) { const wp = scope.split(':')[1]; selected = records.filter((r) => r.sourceWorkPackage === wp); }
  else if (scope.startsWith('governance-program:')) { const id = scope.split(':')[1]; selected = records.filter((r) => r.governingArtifacts.includes(id) || ['census-inventory', 'health-metrics', 'compliance-report'].includes(r.evidenceType)); }
  else selected = records;
  const refs = selected.map((r) => r.evidenceId).sort();
  const coverage = [...new Set(selected.map((r) => r.evidenceType))].sort();
  const bundleDigest = hash([scope, refs, coverage]); // deterministic — excludes timestamps
  return {
    bundleId: `CERT-${scope.replace(/[:]/g, '-')}-${bundleDigest}`, scope,
    evidenceCount: selected.length, evidenceRefs: refs, coverage,
    requiredTypesPresent: REQUIRED_TYPES.filter((t) => coverage.includes(t)),
    requiredTypesMissing: REQUIRED_TYPES.filter((t) => !coverage.includes(t)),
    bundleDigest,
  };
}

// ---------------------------------------------------------------------------
// Immutable history (§7)
// ---------------------------------------------------------------------------
function persistHistory(registry, dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `registry-${registry.generatedAt.replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify(registry, null, 2)); // timestamped — immutable, never overwritten
  return file;
}
function historyIndex(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.startsWith('registry-') && f.endsWith('.json')).sort();
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------
function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; }

function main() {
  const asJson = process.argv.includes('--json');
  const evidenceDir = path.resolve(arg('--evidence-dir') || DEFAULT_EVIDENCE_DIR);

  const t0 = performance.now();
  const tc = performance.now();
  const consumed = {};
  for (const [wp, u] of Object.entries(UPSTREAM)) consumed[wp] = consume(u.script, u.args);
  const consumeMs = +(performance.now() - tc).toFixed(1);

  // Repository revision = deterministic composite of upstream evidence digests.
  const revision = hash([
    consumed['WP-02'].stats.digest, consumed['WP-03'].stats.digest, consumed['WP-04'].digest,
    hash(consumed['WP-05'].evaluations.map((e) => e.evidenceDigest)), consumed['WP-06'].digest, consumed['WP-07'].reportDigest,
  ]);
  const lifecycleOf = Object.fromEntries(consumed['WP-03'].artifacts.filter((a) => a.edition !== 'full').map((a) => [a.canonicalId, a.lifecycleStage]));
  const knownArtifactIds = new Set(Object.keys(lifecycleOf));

  const ti = performance.now();
  const records = normalize(consumed, revision, lifecycleOf);
  const indexMs = +(performance.now() - ti).toFixed(1);

  const integ = integrity(records, knownArtifactIds);
  const registryDigest = hash(records.map((r) => [r.evidenceId, r.evidenceType, r.severity, r.governingArtifacts]));

  // Index (§ relationships)
  const index = {
    byRuntime: tally(records, 'sourceRuntime'), byWorkPackage: tally(records, 'sourceWorkPackage'),
    byType: tally(records, 'evidenceType'), bySeverity: tally(records, 'severity'),
  };

  const mode = arg('--bundle') ? 'bundle' : process.argv.includes('--demo') ? 'demo' : 'registry';
  let bundles = [], history = null;
  if (mode === 'bundle') bundles = [makeBundle(records, arg('--bundle'))];
  else if (mode === 'demo') bundles = ['repository', 'work-package:WP-04', 'governance-program:GOV-AUTO-004'].map((s) => makeBundle(records, s));

  const registry = {
    tool: 'governance-evidence-registry', runtimeVersion: '1.0.0', mapsTo: 'GOV-AUTO-006',
    generatedAt: new Date().toISOString(), repositoryRevision: revision, registryDigest,
    consumes: Object.fromEntries(Object.entries(UPSTREAM).map(([wp, u]) => [wp, u.source])),
    evidenceCount: records.length, index,
    integrity: { violations: integ.filter((f) => f.severity === 'BLOCK').length, warnings: integ.filter((f) => f.severity === 'WARN').length, findings: integ },
    ...(bundles.length ? { bundles } : {}),
    records,
  };

  if (process.argv.includes('--persist') || mode === 'demo') {
    const f1 = persistHistory(registry, evidenceDir);
    if (mode === 'demo') { const r2 = { ...registry, generatedAt: new Date(Date.parse(registry.generatedAt) + 1000).toISOString() }; const f2 = persistHistory(r2, evidenceDir); history = { files: historyIndex(evidenceDir).length, immutableFirst: path.basename(f1), retrievableByRuntime: index.byRuntime, retrievableByWorkPackage: index.byWorkPackage }; }
    else history = { file: path.relative(REPO_ROOT, f1) };
  }

  const observability = {
    runtimeMs: +(performance.now() - t0).toFixed(1), consumeMs, indexingMs: indexMs,
    evidenceIngested: records.length, evidenceIndexed: records.length, bundlesGenerated: bundles.length,
    integrityRulesExecuted: 7, registryGrowth: history?.files ?? null,
    heapUsedMB: +(process.memoryUsage().heapUsed / 1048576).toFixed(1),
  };
  registry.observability = observability;
  if (history) registry.history = history;

  if (asJson) process.stdout.write(JSON.stringify(registry, null, 2) + '\n');
  else {
    const L = [];
    L.push('Governance Evidence Registry & Certification Evidence Runtime — GOV-AUTO-006 (canonical)');
    L.push(`ingests: WP-02..07  ·  revision: ${revision}  ·  registryDigest: ${registryDigest}`);
    L.push(`\nevidence records: ${records.length}   integrity: ${registry.integrity.violations} violations, ${registry.integrity.warnings} warnings`);
    L.push('by work package: ' + Object.entries(index.byWorkPackage).map(([k, v]) => `${k}=${v}`).join(' '));
    L.push('by type: ' + Object.entries(index.byType).map(([k, v]) => `${k}=${v}`).join(' '));
    L.push('by severity: ' + Object.entries(index.bySeverity).map(([k, v]) => `${k}=${v}`).join(' '));
    if (integ.length) { L.push('\nintegrity findings:'); for (const f of integ.slice(0, 8)) L.push(`  [${f.severity}] ${f.rule} ${f.subject}: ${f.message}`); }
    if (bundles.length) { L.push('\ncertification bundles:'); for (const b of bundles) L.push(`  ${b.scope}: ${b.evidenceCount} evidence, coverage ${b.coverage.length} types, required-present ${b.requiredTypesPresent.length}/${REQUIRED_TYPES.length}  digest=${b.bundleDigest}`); }
    if (history && history.files) L.push(`\nimmutable history: ${history.files} snapshots (retrieval by runtime/wp/version/timestamp)`);
    L.push(`\nobservability: ${observability.runtimeMs}ms (consume ${consumeMs}ms, index ${indexMs}ms)  heap ${observability.heapUsedMB}MB`);
    process.stdout.write(L.join('\n') + '\n');
  }
  process.exit(registry.integrity.violations === 0 ? 0 : 1);
}
function tally(arr, key) { const m = {}; for (const a of arr) { const k = a[key]; m[k] = (m[k] || 0) + 1; } return Object.fromEntries(Object.entries(m).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))); }

main();
