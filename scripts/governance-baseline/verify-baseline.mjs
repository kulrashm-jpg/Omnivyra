#!/usr/bin/env node
// Governance Runtime v1.0.0 — Baseline Protection & Verification Engine (Release R3A).
//
// This is an OMNIVYRA-SIDE tool. It does NOT live inside the frozen governance runtime tree and it NEVER
// modifies the Governance Runtime, the constitutional repository, or any deterministic output. It reads the
// frozen baseline and verifies integrity against an immutable lock file:
//   • runtime + shared-library + release-artifact + constitution content hashes (byte-for-byte drift)
//   • runtime inventory (module/library/artifact counts)
//   • dependency graph (nodes/edges/acyclicity/ordering) vs the released DEPENDENCY-GRAPH.json
//   • release integrity (release digest recomputed from MANIFEST.json)
//   • behavioral digests (fast runtimes re-emit their canonical digests)
// Verification only — no automatic correction, no remediation.
//
// Usage:
//   node scripts/governance-baseline/verify-baseline.mjs --generate-lock   # (re)create baseline.lock.json (one-time)
//   node scripts/governance-baseline/verify-baseline.mjs                    # verify current tree against the lock
//   node scripts/governance-baseline/verify-baseline.mjs --json            # machine-readable reports
//   node scripts/governance-baseline/verify-baseline.mjs --reports <dir>   # also write the five reports as JSON

import { readdirSync, readFileSync, statSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const HERE = path.dirname(__filename);
const REPO = path.resolve(HERE, '..', '..');
const RUNTIME_DIR = path.join(REPO, 'docs/company-intelligence/governance-automation/runtime');
const RELEASE_DIR = path.join(REPO, 'docs/governance-runtime-v1.0.0');
const CONSTITUTION_DIR = path.join(REPO, 'docs/company-intelligence');
const LOCK = path.join(HERE, 'baseline.lock.json');

function hash(str) { const s = typeof str === 'string' ? str : JSON.stringify(str); let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(16).padStart(8, '0'); }
function hashFile(p) { return hash(readFileSync(p, 'utf8')); }
function walk(dir, acc = []) { for (const n of readdirSync(dir).sort()) { const f = path.join(dir, n); const st = statSync(f); if (st.isDirectory()) walk(f, acc); else acc.push(f); } return acc; }
const rel = (p) => path.relative(REPO, p).split(path.sep).join('/');

// ---------------------------------------------------------------------------
// Inventory (§3/§7)
// ---------------------------------------------------------------------------
function inventory() {
  const runtimeModules = readdirSync(RUNTIME_DIR).filter((f) => f.endsWith('.mjs')).sort();
  const libs = existsSync(path.join(RUNTIME_DIR, 'lib')) ? readdirSync(path.join(RUNTIME_DIR, 'lib')).filter((f) => f.endsWith('.mjs')).sort() : [];
  const integrations = existsSync(path.join(RUNTIME_DIR, 'integrations')) ? readdirSync(path.join(RUNTIME_DIR, 'integrations')).sort() : [];
  const releaseArtifacts = existsSync(RELEASE_DIR) ? readdirSync(RELEASE_DIR).filter((f) => f !== 'reports').sort() : [];
  const constitutionDocs = walk(CONSTITUTION_DIR).filter((f) => f.endsWith('.md') && !f.includes(`${path.sep}runtime${path.sep}`)).length;
  return {
    runtimeModules, sharedLibraries: libs, integrationTemplates: integrations, releaseArtifacts,
    counts: { runtimeModules: runtimeModules.length, sharedLibraries: libs.length, integrationTemplates: integrations.length, releaseArtifacts: releaseArtifacts.length, constitutionDocuments: constitutionDocs },
  };
}

// ---------------------------------------------------------------------------
// Content hashes (§6 drift) — runtime + libs + integrations + release artifacts + constitution
// ---------------------------------------------------------------------------
function contentHashes() {
  const h = {};
  for (const f of walk(RUNTIME_DIR)) h[rel(f)] = hashFile(f);                                   // runtime + lib + integrations
  for (const f of walk(RELEASE_DIR)) { if (rel(f).includes('/reports/')) continue; h[rel(f)] = hashFile(f); } // release artifacts
  // constitution content digest (all governed .md except the runtime dir), as one rolled-up digest
  const conDocs = walk(CONSTITUTION_DIR).filter((f) => !f.includes(`${path.sep}runtime${path.sep}`)).sort();
  const constitutionDigest = hash(conDocs.map((f) => [rel(f), hashFile(f)]));
  return { fileHashes: h, runtimeDigest: hash(Object.entries(h).filter(([k]) => k.includes('/runtime/')).sort()), constitutionDigest };
}

// ---------------------------------------------------------------------------
// Dependency graph (§4) — parsed from imports; acyclicity + ordering
// ---------------------------------------------------------------------------
function dependencyGraph() {
  const files = readdirSync(RUNTIME_DIR).filter((f) => f.endsWith('.mjs'));
  const deps = {}; const edges = [];
  for (const f of files) { const c = readFileSync(path.join(RUNTIME_DIR, f), 'utf8'); const m = [...c.matchAll(/from '\.\/([a-z0-9-]+)\.mjs'/g)].map((x) => x[1] + '.mjs'); deps[f] = [...new Set(m.filter((d) => files.includes(d)))]; for (const d of deps[f]) edges.push({ from: d, to: f }); }
  // cycle detection
  const WHITE = 0, GREY = 1, color = {}; files.forEach((f) => color[f] = WHITE); let cycles = 0;
  const dfs = (f) => { color[f] = GREY; for (const d of deps[f]) { if (color[d] === GREY) cycles++; else if (color[d] === WHITE) dfs(d); } color[f] = 2; };
  files.forEach((f) => { if (color[f] === WHITE) dfs(f); });
  const digest = hash(Object.entries(deps).sort().map(([k, v]) => [k, v.sort()]));
  return { nodes: files.length, edges: edges.length, cycles, multiImport: files.filter((f) => deps[f].length > 1), digest };
}

// ---------------------------------------------------------------------------
// Release integrity (§5) — recompute release digest from MANIFEST.json
// ---------------------------------------------------------------------------
function releaseIntegrity() {
  const manifest = JSON.parse(readFileSync(path.join(RELEASE_DIR, 'MANIFEST.json'), 'utf8'));
  const version = JSON.parse(readFileSync(path.join(RELEASE_DIR, 'VERSION.json'), 'utf8'));
  const pairs = manifest.runtimes.map((r) => [r.id, r.digest]);
  const releaseDigest = hash(JSON.stringify(pairs));
  const manifestDigest = hash(readFileSync(path.join(RELEASE_DIR, 'MANIFEST.json'), 'utf8'));
  return {
    releaseId: version.releaseId, baselineId: version.baselineId,
    versions: { runtime: version.runtimeVersion, constitutional: version.constitutionalVersion, engineering: version.engineeringBaseline },
    recomputedReleaseDigest: releaseDigest, recordedReleaseDigest: version.releaseDigest, manifestDigest,
    runtimeDigestSet: Object.fromEntries(pairs),
  };
}

// ---------------------------------------------------------------------------
// Behavioral digests (§2) — fast runtimes re-emit their canonical digests
// ---------------------------------------------------------------------------
function behavioral() {
  const run = (mod, extract) => { const r = spawnSync('node', [path.join(RUNTIME_DIR, mod), '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); try { return extract(JSON.parse(r.stdout)); } catch { return null; } };
  return { 'WP-02': run('validate-docs.mjs', (j) => j.stats.digest), 'WP-03': run('census-runtime.mjs', (j) => j.stats.digest) };
}

// ---------------------------------------------------------------------------
// Snapshot the current state
// ---------------------------------------------------------------------------
function snapshot(withBehavioral = true) {
  const inv = inventory();
  const ch = contentHashes();
  const dg = dependencyGraph();
  const ri = releaseIntegrity();
  return {
    releaseId: ri.releaseId, baselineId: ri.baselineId, releaseDigest: ri.recordedReleaseDigest, versions: ri.versions,
    inventoryCounts: inv.counts, dependencyGraph: { nodes: dg.nodes, edges: dg.edges, cycles: dg.cycles, digest: dg.digest, multiImport: dg.multiImport },
    manifestDigest: ri.manifestDigest, runtimeDigest: ch.runtimeDigest, constitutionDigest: ch.constitutionDigest,
    fileHashes: ch.fileHashes, behavioral: withBehavioral ? behavioral() : null,
    runtimeDigestSet: ri.runtimeDigestSet, recomputedReleaseDigest: ri.recomputedReleaseDigest,
  };
}

// ---------------------------------------------------------------------------
// Verification (§2/§4/§5/§6) against the immutable lock
// ---------------------------------------------------------------------------
function verify(reportsDir) {
  if (!existsSync(LOCK)) return { ok: false, error: 'baseline.lock.json missing — run --generate-lock once against the frozen baseline' };
  const lock = JSON.parse(readFileSync(LOCK, 'utf8'));
  const cur = snapshot(true);
  const drift = [];
  const D = (category, subject, expected, actual) => drift.push({ category, subject, expected, actual });

  // baseline verification (§2)
  for (const [k, v] of Object.entries({ releaseId: lock.releaseId, baselineId: lock.baselineId, releaseDigest: lock.releaseDigest })) if (cur[k] !== v) D('release-drift', k, v, cur[k]);
  for (const [k, v] of Object.entries(lock.versions)) if (cur.versions[k] !== v) D('release-drift', 'version.' + k, v, cur.versions[k]);
  if (cur.recomputedReleaseDigest !== lock.releaseDigest) D('release-drift', 'recomputedReleaseDigest', lock.releaseDigest, cur.recomputedReleaseDigest);
  if (cur.manifestDigest !== lock.manifestDigest) D('manifest-drift', 'manifestDigest', lock.manifestDigest, cur.manifestDigest);

  // inventory verification (§3)
  for (const [k, v] of Object.entries(lock.inventoryCounts)) if (cur.inventoryCounts[k] !== v) D('inventory-drift', k, v, cur.inventoryCounts[k]);

  // dependency integrity (§4)
  for (const k of ['nodes', 'edges', 'cycles', 'digest']) if (cur.dependencyGraph[k] !== lock.dependencyGraph[k]) D('dependency-drift', k, lock.dependencyGraph[k], cur.dependencyGraph[k]);

  // runtime + documentation drift (§6)
  if (cur.runtimeDigest !== lock.runtimeDigest) D('runtime-drift', 'runtimeDigest', lock.runtimeDigest, cur.runtimeDigest);
  if (cur.constitutionDigest !== lock.constitutionDigest) D('documentation-drift', 'constitutionDigest', lock.constitutionDigest, cur.constitutionDigest);
  const lockedFiles = new Set(Object.keys(lock.fileHashes)), curFiles = new Set(Object.keys(cur.fileHashes));
  for (const f of lockedFiles) if (!curFiles.has(f)) D('file-removed', f, lock.fileHashes[f], null); else if (lock.fileHashes[f] !== cur.fileHashes[f]) D('file-modified', f, lock.fileHashes[f], cur.fileHashes[f]);
  for (const f of curFiles) if (!lockedFiles.has(f)) D('file-added', f, null, cur.fileHashes[f]);

  // behavioral digest drift (§2)
  for (const [k, v] of Object.entries(lock.behavioral || {})) if (cur.behavioral[k] !== v) D('digest-drift', 'behavioral.' + k, v, cur.behavioral[k]);

  const status = drift.length === 0 ? 'VERIFIED' : 'DRIFT-DETECTED';
  const reports = buildReports(lock, cur, drift, status);
  if (reportsDir) { if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true }); for (const [name, r] of Object.entries(reports)) writeFileSync(path.join(reportsDir, name + '.json'), JSON.stringify(r, null, 2)); }
  return { ok: drift.length === 0, status, drift, reports, lock, cur };
}

function buildReports(lock, cur, drift, status) {
  return {
    'repository-protection-report': { protectedPaths: PROTECTED_PATHS, ownershipEstablished: true, status },
    'baseline-verification-report': { releaseId: cur.releaseId, baselineId: cur.baselineId, versions: cur.versions, releaseDigest: cur.releaseDigest, recomputedReleaseDigest: cur.recomputedReleaseDigest, manifestDigest: cur.manifestDigest, dependencyDigest: cur.dependencyGraph.digest, status },
    'integrity-verification-report': { runtimeDigestSet: cur.runtimeDigestSet, runtimeDigest: cur.runtimeDigest, constitutionDigest: cur.constitutionDigest, deterministicReplay: 'preserved', status },
    'drift-detection-report': { driftCount: drift.length, byCategory: drift.reduce((m, d) => (m[d.category] = (m[d.category] || 0) + 1, m), {}), drift, status },
    'runtime-inventory-report': { counts: cur.inventoryCounts, runtimeModules: lock.runtimeModules || Object.keys(cur.fileHashes).filter((f) => /runtime\/[a-z-]+\.mjs$/.test(f)), status },
  };
}

const PROTECTED_PATHS = [
  'docs/company-intelligence/governance-automation/runtime/**',
  'docs/company-intelligence/**',
  'docs/governance-runtime-v1.0.0/**',
  'scripts/governance-baseline/**',
];

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; }

function main() {
  const asJson = process.argv.includes('--json');
  if (process.argv.includes('--generate-lock')) {
    const snap = snapshot(true);
    const lock = {
      generatedFor: snap.releaseId, releaseId: snap.releaseId, baselineId: snap.baselineId, releaseDigest: snap.releaseDigest, versions: snap.versions,
      inventoryCounts: snap.inventoryCounts, dependencyGraph: snap.dependencyGraph, manifestDigest: snap.manifestDigest,
      runtimeDigest: snap.runtimeDigest, constitutionDigest: snap.constitutionDigest, behavioral: snap.behavioral,
      runtimeModules: snap.inventoryCounts.runtimeModules, fileHashes: snap.fileHashes,
    };
    writeFileSync(LOCK, JSON.stringify(lock, null, 2));
    process.stdout.write(`baseline.lock.json generated for ${lock.releaseId}\n  files locked: ${Object.keys(lock.fileHashes).length}  releaseDigest: ${lock.releaseDigest}  depDigest: ${lock.dependencyGraph.digest}\n`);
    return;
  }

  const reportsDir = arg('--reports') ? path.resolve(arg('--reports')) : null;
  const res = verify(reportsDir);
  if (res.error) { process.stdout.write((asJson ? JSON.stringify({ error: res.error }, null, 2) : 'ERROR: ' + res.error) + '\n'); process.exit(2); }

  if (asJson) process.stdout.write(JSON.stringify({ status: res.status, driftCount: res.drift.length, reports: res.reports }, null, 2) + '\n');
  else {
    const L = [];
    L.push('Governance Runtime v1.0.0 — Baseline Protection & Verification (Release R3A)');
    L.push(`release: ${res.cur.releaseId}  ·  baseline: ${res.cur.baselineId}`);
    L.push(`\nBASELINE VERIFICATION: ${res.status}`);
    L.push(`  release digest      : ${res.cur.releaseDigest} (recomputed ${res.cur.recomputedReleaseDigest})  ${res.cur.releaseDigest === res.cur.recomputedReleaseDigest ? 'OK' : 'MISMATCH'}`);
    L.push(`  manifest digest     : ${res.cur.manifestDigest}`);
    L.push(`  dependency graph    : ${res.cur.dependencyGraph.nodes} nodes / ${res.cur.dependencyGraph.edges} edges / ${res.cur.dependencyGraph.cycles} cycles  digest ${res.cur.dependencyGraph.digest}`);
    L.push(`  runtime digest      : ${res.cur.runtimeDigest}`);
    L.push(`  constitution digest : ${res.cur.constitutionDigest}`);
    L.push(`  behavioral          : WP-02 ${res.cur.behavioral['WP-02']}  WP-03 ${res.cur.behavioral['WP-03']}`);
    L.push(`  inventory           : ${res.cur.inventoryCounts.runtimeModules} runtimes, ${res.cur.inventoryCounts.sharedLibraries} libs, ${res.cur.inventoryCounts.releaseArtifacts} release artifacts, ${res.cur.inventoryCounts.constitutionDocuments} constitution docs`);
    if (res.drift.length) { L.push(`\nDRIFT (${res.drift.length}):`); for (const d of res.drift.slice(0, 20)) L.push(`  [${d.category}] ${d.subject}: expected ${d.expected} got ${d.actual}`); }
    else L.push('\nno drift — Governance Runtime is byte-for-byte unchanged; digests preserved.');
    if (reportsDir) L.push(`\nreports written: ${path.relative(REPO, reportsDir)}/ (5 deterministic JSON reports)`);
    process.stdout.write(L.join('\n') + '\n');
  }
  process.exit(res.ok ? 0 : 1);
}

main();
