#!/usr/bin/env node
// Canonical Governance Runtime Optimization & Incremental Execution Platform — realizes GOV-AUTO-012 (WP-13).
//
// Extends ONLY the WP-12 orchestrator. It reuses the orchestrator's runtime registry, DAG resolver,
// executor, and content cache (imported from orchestrator.mjs) — it duplicates no governance logic and
// changes no runtime business logic. It adds change analysis, runtime fingerprinting, dependency-aware
// cache invalidation, an optimized (incremental) scheduler, and an equivalence verifier that proves an
// optimized run is byte-identical to the canonical full run. Deterministic; additive.
//
// Invalidation is expressed through the WP-12 cache: to invalidate a node, its cache entry (and its
// transitive descendants') is evicted; the orchestrator then re-executes only those, reusing the rest.
//
// Usage:
//   node optimizer.mjs --demo                       # no-change/single/upstream/downstream + equivalence
//   node optimizer.mjs --incremental WP-05          # optimized run treating WP-05 (and descendants) dirty
//   node optimizer.mjs --json                       # machine-readable optimization + equivalence report
//   node optimizer.mjs --cache-dir <dir>            # persistent cache (default <repo>/.governance-orchestrator-cache)

import { existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { REGISTRY, BY_ID, runDag, hash } from './orchestrator.mjs';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..', '..', '..', '..');
const DEFAULT_CACHE = path.join(REPO_ROOT, '.governance-orchestrator-cache');
const ALL = REGISTRY.map((n) => n.id);

// ---------------------------------------------------------------------------
// Invalidation engine (§4/§5) — reverse-dependency transitive closure.
// ---------------------------------------------------------------------------
const REVDEP = (() => { const r = {}; for (const n of REGISTRY) for (const d of n.deps) (r[d] = r[d] || []).push(n.id); return r; })();
function descendants(id) { const out = new Set(), q = [id]; while (q.length) { const x = q.shift(); for (const c of (REVDEP[x] || [])) if (!out.has(c)) { out.add(c); q.push(c); } } return out; }
function invalidationSet(dirty) { const s = new Set(); for (const d of dirty) { s.add(d); for (const x of descendants(d)) s.add(x); } return s; }

// ---------------------------------------------------------------------------
// Fingerprint engine (§4) — deterministic per-runtime fingerprint.
//   fp(node) = hash(version, args, repositoryFingerprint, [dependency output digests])
// ---------------------------------------------------------------------------
function fingerprints(repoFp, outDigests) {
  const fp = {};
  for (const id of topo()) { const n = BY_ID[id]; fp[id] = hash([n.version, n.args, repoFp, n.deps.map((d) => outDigests[d] || '?')]); }
  return fp;
}
function topo() { // registry declaration order already satisfies dependencies
  return REGISTRY.map((n) => n.id);
}
function evict(cacheDir, ids, repoFp) {
  const removed = [];
  for (const id of ids) { const f = path.join(cacheDir, `${id.replace(/[:]/g, '_')}__${repoFp}.json`); if (existsSync(f)) { rmSync(f); removed.push(id); } }
  return removed;
}

// ---------------------------------------------------------------------------
// Canonical reference (§ full execution) + optimized (incremental) execution (§3)
// ---------------------------------------------------------------------------
function canonicalFull(cacheDir) {
  try { rmSync(cacheDir, { recursive: true, force: true }); } catch { /* ignore */ }
  const t = performance.now();
  const run = runDag(ALL, { useCache: true, cacheDir });                 // cold: every node executes → the reference
  return { run, ms: +(performance.now() - t).toFixed(1), digests: Object.fromEntries(run.nodes.map((n) => [n.id, n.digest])) };
}
function optimized(cacheDir, repoFp, dirty) {
  const inval = invalidationSet(dirty);
  const evicted = evict(cacheDir, inval, repoFp);                        // dependency-aware invalidation
  const t = performance.now();
  const run = runDag(ALL, { useCache: true, cacheDir });                 // only invalidated nodes re-execute; rest reused
  const ms = +(performance.now() - t).toFixed(1);
  const executed = run.nodes.filter((n) => n.mode === 'miss').map((n) => n.id);
  const reused = run.nodes.filter((n) => n.mode === 'hit').map((n) => n.id);
  return { run, ms, invalidation: [...inval].sort(), evicted: evicted.sort(), executed: executed.sort(), reused: reused.sort() };
}

// ---------------------------------------------------------------------------
// Equivalence verifier (§7) — optimized MUST equal canonical.
// ---------------------------------------------------------------------------
function verifyEquivalence(canonical, opt) {
  const perNode = REGISTRY.map((n) => ({ id: n.id, canonical: canonical.digests[n.id], optimized: Object.fromEntries(opt.run.nodes.map((x) => [x.id, x.digest]))[n.id] }));
  const mismatches = perNode.filter((p) => p.canonical !== p.optimized);
  return {
    equivalenceStatus: mismatches.length === 0 ? 'EQUIVALENT' : 'DIVERGED',
    manifestDigestCanonical: canonical.run.manifestDigest, manifestDigestOptimized: opt.run.manifestDigest,
    digestMatch: canonical.run.manifestDigest === opt.run.manifestDigest,
    mismatches,
  };
}

function optimizationReport(canonical, opt, dirty, repoFp, outDigests) {
  const total = ALL.length;
  const executed = opt.executed.length, reused = opt.reused.length;
  const fpBase = fingerprints(repoFp, outDigests);
  // Simulated dirty fingerprints: perturb the dirty nodes' input to show fingerprint change → invalidation.
  const perturbed = { ...outDigests }; for (const d of dirty) perturbed[d] = (outDigests[d] || '') + '*';
  const fpDirty = fingerprints(repoFp, perturbed);
  const changedFps = Object.keys(fpBase).filter((k) => fpBase[k] !== fpDirty[k]);
  return {
    changedArtifacts: dirty, affectedRuntimes: [...invalidationSet(dirty)].sort(),
    unaffectedRuntimes: ALL.filter((id) => !invalidationSet(dirty).has(id)).sort(),
    invalidationGraph: dirty.map((d) => ({ dirty: d, descendants: [...descendants(d)].sort() })),
    fingerprintChanges: changedFps.sort(),
    nodesExecuted: executed, nodesSkipped: reused, cacheHits: opt.run.cacheHits, cacheMisses: opt.run.cacheMisses,
    executionSavings: +(reused / total).toFixed(3), incrementalRatio: +(executed / total).toFixed(3),
  };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------
function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; }

function main() {
  const asJson = process.argv.includes('--json');
  const cacheDir = path.resolve(arg('--cache-dir') || DEFAULT_CACHE);

  if (process.argv.includes('--demo')) { runDemo(cacheDir, asJson); return; }

  const dirty = arg('--incremental') ? [arg('--incremental')] : [];
  const canonical = canonicalFull(cacheDir);
  const repoFp = canonical.run.fingerprint;
  const opt = optimized(cacheDir, repoFp, dirty);
  const equivalence = verifyEquivalence(canonical, opt);
  const report = optimizationReport(canonical, opt, dirty, repoFp, canonical.digests);
  const out = {
    tool: 'governance-runtime-optimizer', runtimeVersion: '1.0.0', mapsTo: 'GOV-AUTO-012', extends: 'WP-12 orchestrator',
    repositoryFingerprint: repoFp, optimizationReport: report, equivalence,
    performance: { fullMs: canonical.ms, optimizedMs: opt.ms, executionReduction: +(1 - opt.executed.length / ALL.length).toFixed(3), cacheHitRatio: opt.run.cacheHitRatio },
    observability: { incrementalExecutionRatio: report.incrementalRatio, cacheEfficiency: opt.run.cacheHitRatio, invalidationEfficiency: +(report.affectedRuntimes.length / ALL.length).toFixed(3), replayCorrectness: equivalence.equivalenceStatus },
  };
  if (asJson) process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  else {
    const L = [];
    L.push('Governance Runtime Optimization & Incremental Execution Platform — GOV-AUTO-012 (canonical)');
    L.push(`extends WP-12  ·  repoFingerprint: ${repoFp}`);
    L.push(`\nchanged: [${dirty.join(',') || 'none'}]  → affected: [${report.affectedRuntimes.join(', ')}]`);
    L.push(`executed: ${report.nodesExecuted.length}  skipped(reused): ${report.nodesSkipped.length}  savings: ${report.executionSavings}`);
    L.push(`equivalence: ${equivalence.equivalenceStatus}  (canonical ${equivalence.manifestDigestCanonical} vs optimized ${equivalence.manifestDigestOptimized}, match=${equivalence.digestMatch})`);
    process.stdout.write(L.join('\n') + '\n');
  }
  process.exit(equivalence.equivalenceStatus === 'EQUIVALENT' ? 0 : 1);
}

function runDemo(cacheDir, asJson) {
  const canonical = canonicalFull(cacheDir);          // full reference (also warms cache)
  const repoFp = canonical.run.fingerprint;
  const scenarios = [
    { label: 'no-change', dirty: [] },
    { label: 'single-runtime change (WP-05)', dirty: ['WP-05'] },
    { label: 'upstream change (WP-03)', dirty: ['WP-03'] },
    { label: 'downstream change (WP-11)', dirty: ['WP-11'] },
  ];
  const results = [];
  for (const sc of scenarios) {
    const opt = optimized(cacheDir, repoFp, sc.dirty);   // each optimized run re-warms the evicted entries
    const eq = verifyEquivalence(canonical, opt);
    const rep = optimizationReport(canonical, opt, sc.dirty, repoFp, canonical.digests);
    results.push({ label: sc.label, dirty: sc.dirty, executed: opt.executed, reused: opt.reused, invalidation: opt.invalidation, savings: rep.executionSavings, equivalence: eq.equivalenceStatus, digestMatch: eq.digestMatch, optimizedMs: opt.ms });
  }
  const out = {
    tool: 'governance-runtime-optimizer', mode: 'demo', mapsTo: 'GOV-AUTO-012', extends: 'WP-12 orchestrator',
    repositoryFingerprint: repoFp, canonicalManifestDigest: canonical.run.manifestDigest, fullMs: canonical.ms,
    scenarios: results,
    fullVsOptimized: { canonical: canonical.run.manifestDigest, optimizedNoChange: results[0] ? verifyDigest(results, 'no-change') : null, allEquivalent: results.every((r) => r.equivalence === 'EQUIVALENT' && r.digestMatch) },
  };
  if (asJson) { process.stdout.write(JSON.stringify(out, null, 2) + '\n'); return; }
  const L = [];
  L.push('Governance Runtime Optimizer — GOV-AUTO-012 (canonical) — DEMO');
  L.push(`repoFingerprint: ${repoFp}  ·  canonical manifestDigest: ${canonical.run.manifestDigest}  ·  full: ${canonical.ms}ms`);
  L.push('');
  for (const r of results) {
    L.push(`${r.label}:`);
    L.push(`   changed=[${r.dirty.join(',') || 'none'}]  invalidated=[${r.invalidation.join(',') || 'none'}]`);
    L.push(`   executed=${r.executed.length} [${r.executed.join(',')}]  reused=${r.reused.length}  savings=${r.savings}  (${r.optimizedMs}ms)`);
    L.push(`   equivalence: ${r.equivalence}  digestMatch: ${r.digestMatch}`);
  }
  L.push(`\nfull vs optimized: all scenarios equivalent to canonical = ${out.fullVsOptimized.allEquivalent}`);
  process.stdout.write(L.join('\n') + '\n');
}
function verifyDigest(results, label) { const r = results.find((x) => x.label.startsWith(label)); return r ? r.digestMatch : null; }

// WP-14 reuses these to run governance through the optimizer/orchestrator — no runtime is invoked directly.
export { canonicalFull, optimized, verifyEquivalence, invalidationSet, descendants, fingerprints };
const isDirectOpt = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isDirectOpt) main();
