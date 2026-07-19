#!/usr/bin/env node
// Canonical Governance Drift Detection & Continuous Compliance Runtime — realizes GOV-AUTO-005 (WP-07).
//
// THE single authority for governance drift analysis. It performs NO discovery, parsing, validation,
// census, health, freeze, or graph generation of its own — it CONSUMES:
//   • WP-03 census   → the governance state (artifacts + inventory)
//   • WP-04 health   → posture + compliance-relevant metrics (also carries WP-02's result)
//   • WP-06 graph    → dependency adjacency + integrity (also encapsulates WP-05)
// It captures a deterministic governance SIGNATURE, compares it against an IMMUTABLE baseline across
// ten drift categories, and computes continuous compliance. Deterministic, additive, single-runtime.
//
// Usage:
//   node drift-runtime.mjs --create-baseline        # persist an immutable baseline of current state
//   node drift-runtime.mjs --baseline <file>        # compare current state against a baseline
//   node drift-runtime.mjs                           # compare against the latest baseline (or self if none)
//   node drift-runtime.mjs --demo                    # baseline create → compare → synthetic-drift → replay
//   node drift-runtime.mjs --json                    # machine-readable drift + compliance report
//   node drift-runtime.mjs --baseline-dir <dir>      # baseline location (default <repo>/.governance-baselines)

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { invoke } from './lib/runtime-invoke.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WP03 = path.join(__dirname, 'census-runtime.mjs');
const WP04 = path.join(__dirname, 'health-runtime.mjs');
const WP06 = path.join(__dirname, 'graph-runtime.mjs');
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const DEFAULT_BASELINE_DIR = path.join(REPO_ROOT, '.governance-baselines');

const GA_TYPES = new Set(['governance-audit', 'governance-program', 'realization-program', 'certification-program', 'execution-program', 'execution-audit', 'work-package']);
const CONSTITUTIONAL_TYPES = new Set(['audit', 'design', 'implementation-program', 'adr', 'version', 'ratification', 'lifecycle', 'governance-framework', 'amendment', 'amendment-template', 'maintainers', 'history']);
const LIFE_RANK = { Draft: 0, Template: 0, Specified: 1, Active: 1, Ratified: 2, Frozen: 2, Superseded: 3, Archived: 4 };

function consume(script, extra = []) { return invoke(script, extra); } // WP-12: orchestrator seam
function hash(str) { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0; return h.toString(16).padStart(8, '0'); }
const semverGte = (a, b) => { const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { const x = pa[i] || 0, y = pb[i] || 0; if (x !== y) return x > y; } return true; };

// ---------------------------------------------------------------------------
// Governance signature — built solely from upstream runtime outputs (§6 requirement).
// ---------------------------------------------------------------------------
function captureSignature(census, health, graph) {
  const canon = census.artifacts.filter((a) => a.edition !== 'full');
  const map = (pred, val) => Object.fromEntries(canon.filter(pred).map((a) => [a.canonicalId, val(a)]).sort((x, y) => x[0].localeCompare(y[0])));
  const constitutional = canon.filter((a) => CONSTITUTIONAL_TYPES.has(a.documentType)).map((a) => a.canonicalId).sort();
  const versionDoc = canon.find((a) => a.documentType === 'version');
  return {
    upstream: {
      documentationValidation: health.sources?.documentationValidation || 'unknown',
      censusResult: health.sources?.census || 'unknown',
      graphViolations: graph.integrity?.violations ?? 0,
      posture: health.posture?.classification, overallScore: health.posture?.overallScore,
    },
    constitutional: { ids: constitutional, version: versionDoc ? versionDoc.version : '1.0.0' },
    governance: map((a) => GA_TYPES.has(a.documentType), (a) => a.classification),
    documentation: { result: health.sources?.documentationValidation, passRate: health.metrics?.validationPassRate },
    dependency: graph.adjacencyList || {},
    ownership: map(() => true, (a) => a.owner),
    lifecycle: map(() => true, (a) => a.lifecycleStage),
    version: map(() => true, (a) => a.version),
    structural: { total: census.inventory.total, byCategory: census.inventory.byCategory, components: graph.graph?.components, edges: graph.graph?.edges },
    certification: map((a) => a.documentType === 'certification-program', (a) => a.classification),
    releaseReadiness: { validationPassRate: health.metrics?.validationPassRate, governanceMaturity: health.metrics?.governanceMaturity, releasePresent: canon.some((a) => a.documentType === 'release') },
  };
}
function signatureDigest(sig) { return hash(JSON.stringify(sig)); }

// ---------------------------------------------------------------------------
// Diff helpers
// ---------------------------------------------------------------------------
function diffMap(cur, base) {
  const added = [], removed = [], changed = [];
  for (const k of Object.keys(cur)) { if (!(k in base)) added.push(k); else if (JSON.stringify(cur[k]) !== JSON.stringify(base[k])) changed.push({ id: k, from: base[k], to: cur[k] }); }
  for (const k of Object.keys(base)) if (!(k in cur)) removed.push(k);
  return { added: added.sort(), removed: removed.sort(), changed: changed.sort((a, b) => a.id.localeCompare(b.id)) };
}
function diffSet(cur, base) { const c = new Set(cur), b = new Set(base); return { added: cur.filter((x) => !b.has(x)).sort(), removed: base.filter((x) => !c.has(x)).sort() }; }

// ---------------------------------------------------------------------------
// Drift model (§2/§3) — ten independently-measurable categories.
// ---------------------------------------------------------------------------
function detectDrift(curSig, baseSig) {
  const items = [];
  const D = (category, rule, severity, classification, affected, evidence) => items.push({ category, rule, severity, classification, impactLevel: severity === 'Critical' ? 'High' : severity === 'Warning' ? 'Moderate' : 'Low', affectedArtifacts: affected, sourceEvidence: evidence });

  // 1 Constitutional drift
  const c = diffSet(curSig.constitutional.ids, baseSig.constitutional.ids);
  c.removed.forEach((id) => D('constitutional', 'constitutional-artifact-removed', 'Critical', 'Critical', [id], 'constitutional artifact absent vs baseline'));
  c.added.forEach((id) => D('constitutional', 'constitutional-artifact-added', 'Warning', 'Warning', [id], 'new constitutional artifact vs baseline'));
  if (curSig.constitutional.version !== baseSig.constitutional.version)
    D('constitutional', 'constitutional-version-change', semverGte(curSig.constitutional.version, baseSig.constitutional.version) ? 'Warning' : 'Critical', semverGte(curSig.constitutional.version, baseSig.constitutional.version) ? 'Approved' : 'Critical', ['CONSTITUTION'], `version ${baseSig.constitutional.version} → ${curSig.constitutional.version}`);

  // 2 Governance drift
  const g = diffMap(curSig.governance, baseSig.governance);
  g.added.forEach((id) => D('governance', 'governance-artifact-added', 'Expected', 'Expected', [id], 'additive governance program'));
  g.removed.forEach((id) => D('governance', 'governance-artifact-removed', 'Critical', 'Critical', [id], 'governance program removed'));
  g.changed.forEach((ch) => D('governance', 'classification-changed', 'Warning', 'Warning', [ch.id], `classification ${ch.from} → ${ch.to}`));

  // 3 Documentation drift
  if (curSig.documentation.result !== baseSig.documentation.result)
    D('documentation', 'documentation-validation-change', curSig.documentation.result === 'PASS' ? 'Warning' : 'Critical', curSig.documentation.result === 'PASS' ? 'Approved' : 'Critical', ['docs'], `validation ${baseSig.documentation.result} → ${curSig.documentation.result}`);
  else if ((curSig.documentation.passRate ?? 100) < (baseSig.documentation.passRate ?? 100))
    D('documentation', 'documentation-passrate-drop', 'Warning', 'Warning', ['docs'], `passRate ${baseSig.documentation.passRate} → ${curSig.documentation.passRate}`);

  // 4 Dependency drift
  const dep = diffMap(curSig.dependency, baseSig.dependency);
  dep.added.forEach((id) => D('dependency', 'dependency-node-added', 'Expected', 'Expected', [id], 'new node in dependency graph'));
  dep.removed.forEach((id) => D('dependency', 'dependency-node-removed', 'Warning', 'Warning', [id], 'node removed from dependency graph'));
  dep.changed.forEach((ch) => { const rm = (ch.from || []).filter((x) => !(ch.to || []).includes(x)); D('dependency', rm.length ? 'dependency-removed' : 'dependency-changed', rm.length ? 'Warning' : 'Expected', rm.length ? 'Warning' : 'Expected', [ch.id], `deps ${JSON.stringify(ch.from)} → ${JSON.stringify(ch.to)}`); });

  // 5 Ownership drift
  const o = diffMap(curSig.ownership, baseSig.ownership);
  o.changed.forEach((ch) => D('ownership', String(ch.to || '').trim() ? 'ownership-changed' : 'ownership-removed', String(ch.to || '').trim() ? 'Warning' : 'Critical', String(ch.to || '').trim() ? 'Warning' : 'Critical', [ch.id], `owner ${ch.from} → ${ch.to}`));

  // 6 Lifecycle drift
  const l = diffMap(curSig.lifecycle, baseSig.lifecycle);
  l.changed.forEach((ch) => { const reg = (LIFE_RANK[ch.to] ?? 1) < (LIFE_RANK[ch.from] ?? 1); D('lifecycle', reg ? 'lifecycle-regression' : 'lifecycle-progression', reg ? 'Critical' : 'Expected', reg ? 'Critical' : 'Expected', [ch.id], `lifecycle ${ch.from} → ${ch.to}`); });

  // 7 Version drift
  const v = diffMap(curSig.version, baseSig.version);
  v.changed.forEach((ch) => { const fwd = semverGte(ch.to, ch.from); D('version', fwd ? 'version-increment' : 'version-regression', fwd ? 'Expected' : 'Critical', fwd ? 'Approved' : 'Critical', [ch.id], `version ${ch.from} → ${ch.to}`); });

  // 8 Structural drift
  if (curSig.structural.total !== baseSig.structural.total)
    D('structural', curSig.structural.total > baseSig.structural.total ? 'artifact-count-growth' : 'artifact-count-shrink', curSig.structural.total > baseSig.structural.total ? 'Expected' : 'Warning', curSig.structural.total > baseSig.structural.total ? 'Expected' : 'Warning', ['repository'], `total ${baseSig.structural.total} → ${curSig.structural.total}`);
  if (curSig.structural.components !== baseSig.structural.components)
    D('structural', 'graph-fragmentation', (curSig.structural.components || 0) > (baseSig.structural.components || 0) ? 'Warning' : 'Expected', (curSig.structural.components || 0) > (baseSig.structural.components || 0) ? 'Warning' : 'Expected', ['graph'], `components ${baseSig.structural.components} → ${curSig.structural.components}`);

  // 9 Certification drift
  const cert = diffMap(curSig.certification, baseSig.certification);
  cert.removed.forEach((id) => D('certification', 'certification-program-removed', 'Critical', 'Critical', [id], 'certification program removed'));
  cert.changed.forEach((ch) => D('certification', 'certification-classification-change', 'Warning', 'Warning', [ch.id], `certification ${ch.from} → ${ch.to}`));

  // 10 Release-readiness drift
  if (curSig.releaseReadiness.releasePresent !== baseSig.releaseReadiness.releasePresent)
    D('releaseReadiness', 'release-artifact-change', curSig.releaseReadiness.releasePresent ? 'Expected' : 'Critical', curSig.releaseReadiness.releasePresent ? 'Expected' : 'Critical', ['release'], `releasePresent ${baseSig.releaseReadiness.releasePresent} → ${curSig.releaseReadiness.releasePresent}`);
  if ((curSig.releaseReadiness.governanceMaturity ?? 0) < (baseSig.releaseReadiness.governanceMaturity ?? 0))
    D('releaseReadiness', 'governance-maturity-drop', 'Warning', 'Warning', ['maturity'], `maturity ${baseSig.releaseReadiness.governanceMaturity} → ${curSig.releaseReadiness.governanceMaturity}`);

  return items.sort((a, b) => a.category.localeCompare(b.category) || a.rule.localeCompare(b.rule) || String(a.affectedArtifacts).localeCompare(String(b.affectedArtifacts)));
}

// ---------------------------------------------------------------------------
// Continuous compliance (§6) — from upstream evidence + drift.
// ---------------------------------------------------------------------------
const CATEGORIES = ['constitutional', 'governance', 'documentation', 'dependency', 'ownership', 'lifecycle', 'version', 'structural', 'certification', 'releaseReadiness'];
function computeCompliance(driftItems, upstream) {
  const outstandingViolations = (upstream.graphViolations || 0) + (upstream.documentationValidation === 'PASS' ? 0 : 1) + (upstream.censusResult === 'PASS' ? 0 : 1);
  const crit = driftItems.filter((d) => d.severity === 'Critical').length;
  const warn = driftItems.filter((d) => d.severity === 'Warning').length;
  const overall = Math.max(0, 100 - 10 * crit - 3 * warn - 5 * outstandingViolations);
  const byCategory = {};
  for (const cat of CATEGORIES) {
    const items = driftItems.filter((d) => d.category === cat);
    const cc = items.filter((d) => d.severity === 'Critical').length, cw = items.filter((d) => d.severity === 'Warning').length;
    byCategory[cat] = Math.max(0, 100 - 15 * cc - 5 * cw);
  }
  return { overall, byCategory, outstandingViolations, unresolvedDrift: crit + warn, criticalDrift: crit, warningDrift: warn };
}

// ---------------------------------------------------------------------------
// Immutable baseline management (§4)
// ---------------------------------------------------------------------------
function createBaseline(sig, compliance, dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const createdAt = new Date().toISOString();
  const digest = signatureDigest(sig);
  const baseline = { id: `BASELINE-${createdAt.replace(/[:.]/g, '-')}-${digest}`, createdAt, digest, complianceAtCreation: compliance.overall, signature: sig };
  const file = path.join(dir, `baseline-${createdAt.replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify(baseline, null, 2)); // timestamped filename — immutable, never overwritten
  return { file, baseline };
}
function latestBaseline(dir) {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.startsWith('baseline-') && f.endsWith('.json')).sort();
  return files.length ? path.join(dir, files[files.length - 1]) : null;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------
function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; }

function analyzeAgainst(curSig, baseline) {
  const drift = detectDrift(curSig, baseline.signature);
  const compliance = computeCompliance(drift, curSig.upstream);
  const trend = { complianceAtBaseline: baseline.complianceAtCreation, currentCompliance: compliance.overall, delta: compliance.overall - baseline.complianceAtCreation, direction: compliance.overall > baseline.complianceAtCreation ? 'improving' : compliance.overall < baseline.complianceAtCreation ? 'declining' : 'stable' };
  const digest = hash(JSON.stringify([baseline.digest, drift.map((d) => [d.category, d.rule, d.severity, d.affectedArtifacts]), compliance]));
  return { drift, compliance, trend, digest };
}

function main() {
  const asJson = process.argv.includes('--json');
  const baselineDir = path.resolve(arg('--baseline-dir') || DEFAULT_BASELINE_DIR);

  const t0 = performance.now();
  const tc = performance.now();
  const census = consume(WP03);
  const health = consume(WP04);
  const graph = consume(WP06, ['--graph']);
  const consumeMs = +(performance.now() - tc).toFixed(1);

  const ts = performance.now();
  const curSig = captureSignature(census, health, graph);
  const sigMs = +(performance.now() - ts).toFixed(1);
  const baselineCompliance = computeCompliance([], curSig.upstream); // self (0 drift)

  if (process.argv.includes('--create-baseline')) {
    const { file, baseline } = createBaseline(curSig, baselineCompliance, baselineDir);
    const out = { action: 'create-baseline', baselineId: baseline.id, file: path.relative(REPO_ROOT, file), digest: baseline.digest, complianceAtCreation: baseline.complianceAtCreation };
    process.stdout.write((asJson ? JSON.stringify(out, null, 2) : `baseline created: ${baseline.id}\n  → ${out.file}  (compliance ${out.complianceAtCreation})`) + '\n');
    process.exit(0);
  }

  if (process.argv.includes('--demo')) { runDemo(curSig, baselineCompliance, asJson); return; }

  // Compare against a baseline (explicit, latest, or self if none exists).
  const tcmp = performance.now();
  const baselineFile = arg('--baseline') ? path.resolve(arg('--baseline')) : latestBaseline(baselineDir);
  let baseline;
  if (baselineFile && existsSync(baselineFile)) baseline = JSON.parse(readFileSync(baselineFile, 'utf8'));
  else baseline = { id: 'SELF', digest: signatureDigest(curSig), complianceAtCreation: baselineCompliance.overall, signature: curSig };
  const analysis = analyzeAgainst(curSig, baseline);
  const compareMs = +(performance.now() - tcmp).toFixed(1);

  emitReport({ census, health, graph, curSig, baseline, analysis, consumeMs, sigMs, compareMs, t0 }, asJson);
  process.exit(analysis.compliance.criticalDrift === 0 ? 0 : 1);
}

function emitReport(x, asJson) {
  const { curSig, baseline, analysis } = x;
  const report = {
    tool: 'governance-drift-runtime', runtimeVersion: '1.0.0', mapsTo: 'GOV-AUTO-005',
    consumes: { wp03: 'GOV-AUTO-002 census', wp04: 'GOV-AUTO-008 health', wp06: 'GOV-AUTO-004 graph (encapsulates WP-05)' },
    baseline: { id: baseline.id, digest: baseline.digest }, currentSignatureDigest: signatureDigest(curSig),
    reportDigest: analysis.digest,
    compliance: analysis.compliance, trend: analysis.trend,
    driftDetected: analysis.drift.length, drift: analysis.drift,
    observability: {
      runtimeMs: +(performance.now() - x.t0).toFixed(1), consumeMs: x.consumeMs, signatureMs: x.sigMs, comparisonMs: x.compareMs,
      driftCategoriesEvaluated: CATEGORIES.length, totalDriftDetected: analysis.drift.length,
      heapUsedMB: +(process.memoryUsage().heapUsed / 1048576).toFixed(1),
    },
  };
  if (asJson) { process.stdout.write(JSON.stringify(report, null, 2) + '\n'); return; }
  const L = [];
  L.push('Governance Drift Detection & Continuous Compliance Runtime — GOV-AUTO-005 (canonical)');
  L.push(`consumes: WP-03 + WP-04 + WP-06  ·  baseline: ${baseline.id}  ·  reportDigest: ${analysis.digest}`);
  L.push(`\nCOMPLIANCE: ${analysis.compliance.overall}/100   drift: ${analysis.drift.length}   critical: ${analysis.compliance.criticalDrift}   warning: ${analysis.compliance.warningDrift}   outstanding upstream violations: ${analysis.compliance.outstandingViolations}`);
  L.push(`trend vs baseline (${analysis.trend.complianceAtBaseline}): ${analysis.trend.delta >= 0 ? '+' : ''}${analysis.trend.delta} (${analysis.trend.direction})`);
  L.push('\ncompliance by category:');
  for (const [k, v] of Object.entries(analysis.compliance.byCategory)) L.push(`  ${String(v).padStart(3)}  ${k}`);
  if (analysis.drift.length) { L.push('\ndrift:'); for (const d of analysis.drift.slice(0, 20)) L.push(`  [${d.classification}/${d.severity}] ${d.category}:${d.rule} ${d.affectedArtifacts.join(',')} — ${d.sourceEvidence}`); }
  else L.push('\nno drift vs baseline — repository is compliant.');
  L.push(`\nobservability: ${report.observability.runtimeMs}ms (consume ${x.consumeMs}ms)  categories ${CATEGORIES.length}  heap ${report.observability.heapUsedMB}MB`);
  process.stdout.write(L.join('\n') + '\n');
}

function runDemo(curSig, baselineCompliance, asJson) {
  // 1) create an immutable baseline of the current (clean) state
  const b0 = { id: 'B0-current', digest: signatureDigest(curSig), complianceAtCreation: baselineCompliance.overall, signature: curSig };
  const selfAnalysis = analyzeAgainst(curSig, b0);
  // 2) synthetic OLDER baseline (worse/smaller prior state) → proves multi-category drift detection
  const older = JSON.parse(JSON.stringify(curSig));
  delete older.governance['GOV-AUTO-008'];                 // governance artifact "added" since baseline
  older.constitutional.version = '0.9.0';                  // constitutional version change
  const anyOwner = Object.keys(older.ownership)[0]; older.ownership[anyOwner] = 'Old Owner'; // ownership change
  const anyVer = Object.keys(older.version).find((k) => older.version[k] === '1.0'); if (anyVer) older.version[anyVer] = '0.9'; // version increment
  older.structural.total = curSig.structural.total - 3;    // structural growth
  older.releaseReadiness.governanceMaturity = (curSig.releaseReadiness.governanceMaturity || 0) + 5; // maturity drop
  const bOld = { id: 'B-OLD-synthetic', digest: signatureDigest(older), complianceAtCreation: 90, signature: older };
  const driftAnalysis = analyzeAgainst(curSig, bOld);
  // 3) deterministic replay of the drift comparison
  const replay = analyzeAgainst(curSig, bOld);

  const out = {
    tool: 'governance-drift-runtime', mode: 'demo', mapsTo: 'GOV-AUTO-005',
    baselineCreation: { id: b0.id, digest: b0.digest, complianceAtCreation: b0.complianceAtCreation },
    selfComparison: { drift: selfAnalysis.drift.length, compliance: selfAnalysis.compliance.overall },
    syntheticDriftComparison: { baseline: bOld.id, driftDetected: driftAnalysis.drift.length, byCategory: [...new Set(driftAnalysis.drift.map((d) => d.category))], compliance: driftAnalysis.compliance.overall, trend: driftAnalysis.trend },
    deterministicReplay: { digest1: driftAnalysis.digest, digest2: replay.digest, identical: driftAnalysis.digest === replay.digest },
    drift: driftAnalysis.drift,
  };
  if (asJson) { process.stdout.write(JSON.stringify(out, null, 2) + '\n'); return; }
  const L = [];
  L.push('Governance Drift Runtime — GOV-AUTO-005 (canonical) — DEMO');
  L.push(`\n1) baseline creation: ${b0.id} digest=${b0.digest} compliance=${b0.complianceAtCreation}`);
  L.push(`2) self comparison (current vs its own baseline): drift=${selfAnalysis.drift.length} compliance=${selfAnalysis.compliance.overall}  → stable/compliant`);
  L.push(`3) synthetic older baseline (${bOld.id}): drift=${driftAnalysis.drift.length} across [${[...new Set(driftAnalysis.drift.map((d) => d.category))].join(', ')}]  compliance=${driftAnalysis.compliance.overall}  trend ${driftAnalysis.trend.delta >= 0 ? '+' : ''}${driftAnalysis.trend.delta} (${driftAnalysis.trend.direction})`);
  for (const d of driftAnalysis.drift) L.push(`     [${d.classification}/${d.severity}] ${d.category}:${d.rule} ${d.affectedArtifacts.join(',')} — ${d.sourceEvidence}`);
  L.push(`4) deterministic replay: digest1=${driftAnalysis.digest} digest2=${replay.digest} → ${driftAnalysis.digest === replay.digest ? 'IDENTICAL' : 'DIVERGED'}`);
  process.stdout.write(L.join('\n') + '\n');
}

main();
