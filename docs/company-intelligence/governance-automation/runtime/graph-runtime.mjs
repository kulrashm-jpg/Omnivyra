#!/usr/bin/env node
// Canonical Governance Dependency Graph & Impact Analysis Runtime — realizes GOV-AUTO-004 (WP-06).
//
// THE single source of truth for dependency traversal and impact calculation. It performs NO
// discovery, parsing, validation, census, health, or freeze evaluation of its own — it CONSUMES:
//   • WP-03 census registry  → the graph (nodes, dependency edges, parent hierarchy)
//   • WP-04 health posture    → impact context
//   • WP-05 freeze runtime    → the freeze/merge dimension of each simulated mutation
// All relationships originate from repository evidence (the census); no hardcoded dependency maps.
// Deterministic, additive, single-runtime doctrine.
//
// Usage:
//   node graph-runtime.mjs --demo                 # graph + integrity + impact + critical paths + self-test
//   node graph-runtime.mjs --graph                # canonical graph + adjacency list
//   node graph-runtime.mjs --integrity            # dependency integrity report
//   node graph-runtime.mjs --impact <id>          # impact of changing an artifact
//   node graph-runtime.mjs --simulate '<json>'    # impact of a proposed mutation (reuses WP-05)
//   node graph-runtime.mjs --critical-path        # critical paths + bottlenecks + centrality
//   node graph-runtime.mjs --json                 # machine-readable output

import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { invoke } from './lib/runtime-invoke.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WP03 = path.join(__dirname, 'census-runtime.mjs');
const WP04 = path.join(__dirname, 'health-runtime.mjs');
const WP05 = path.join(__dirname, 'freeze-runtime.mjs');
const DEPTH_LIMIT = 12;
const ROOT_NODE = 'CONSTITUTION';

function consume(script, extra = []) { return invoke(script, extra); } // WP-12: orchestrator seam
function hash(str) { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0; return h.toString(16).padStart(8, '0'); }

// ---------------------------------------------------------------------------
// Canonical dependency graph (§2) — built entirely from the census registry.
// ---------------------------------------------------------------------------
const GA_TYPES = new Set(['governance-audit', 'governance-program', 'realization-program', 'certification-program', 'execution-program', 'execution-audit', 'work-package']);
const CONSTITUTIONAL_TYPES = new Set(['audit', 'design', 'implementation-program', 'adr', 'version', 'ratification', 'lifecycle', 'governance-framework', 'amendment', 'amendment-template', 'maintainers', 'history']);

function buildGraph(census) {
  const nodes = new Map();
  // Reference/sole editions are the canonical nodes (Full Editions are archival copies, not graph nodes).
  for (const a of census.artifacts) {
    if (a.edition === 'full') continue;
    const declared = [...new Set(a.dependencies || [])];
    // A self-parent is invalid hierarchy — a governance root points at itself; reparent to the
    // constitutional root so the tree unifies (reported under §3, no hardcoded id).
    let parent = a.governingParent || null;
    const selfParent = parent === a.canonicalId;
    if (selfParent) parent = ROOT_NODE;
    nodes.set(a.canonicalId, {
      id: a.canonicalId, documentType: a.documentType, lifecycleStage: a.lifecycleStage,
      state: a.status, version: a.version,
      // A self-reference is never a real graph EDGE — it is a self-dependency, reported under §3.
      outboundDependencies: declared.filter((d) => d !== a.canonicalId),
      selfReferences: declared.filter((d) => d === a.canonicalId),
      selfParent,
      inboundDependencies: [], parent, children: [],
      constitutionalAncestors: [], downstreamDependents: [], dependencyDepth: 0,
      isConstitutional: CONSTITUTIONAL_TYPES.has(a.documentType), isGovernance: GA_TYPES.has(a.documentType),
    });
  }
  // Synthetic constitutional root: parents that point at CONSTITUTION resolve to this node, unifying the tree.
  nodes.set(ROOT_NODE, {
    id: ROOT_NODE, documentType: 'constitutional-root', lifecycleStage: 'Ratified', state: 'active', version: '1.0.0',
    outboundDependencies: [], selfReferences: [], inboundDependencies: [], parent: null, children: [],
    constitutionalAncestors: [], downstreamDependents: [], dependencyDepth: 0, isConstitutional: true, isGovernance: false,
  });
  // Reverse dependency edges + parent/children hierarchy (parent may be the synthetic root).
  for (const n of nodes.values()) {
    for (const dep of n.outboundDependencies) { const d = nodes.get(dep); if (d) d.inboundDependencies.push(n.id); }
    if (n.parent) { const p = nodes.get(n.parent); if (p) p.children.push(n.id); }
  }
  // Constitutional ancestors: walk the parent chain to the constitutional root.
  for (const n of nodes.values()) {
    const chain = []; let cur = n, guard = 0;
    while (cur && cur.parent && guard++ < 50) {
      chain.push(cur.parent);
      cur = nodes.get(cur.parent);
      if (!cur || cur.id === ROOT_NODE) { if (cur) chain[chain.length - 1] = ROOT_NODE; break; }
    }
    n.constitutionalAncestors = chain;
  }
  // Dependency depth (longest outbound chain) — memoized DFS over dependency edges.
  const depthMemo = new Map();
  const depth = (id, stack = new Set()) => {
    if (depthMemo.has(id)) return depthMemo.get(id);
    if (stack.has(id)) return 0; // cycle guard; cycles reported separately
    stack.add(id);
    const n = nodes.get(id);
    let d = 0;
    if (n) for (const dep of n.outboundDependencies) if (nodes.has(dep)) d = Math.max(d, 1 + depth(dep, stack));
    stack.delete(id);
    depthMemo.set(id, d);
    return d;
  };
  for (const n of nodes.values()) n.dependencyDepth = depth(n.id);
  // Downstream dependents: transitive closure over reverse-dependency ∪ children.
  for (const n of nodes.values()) {
    const seen = new Set(), q = [...n.inboundDependencies, ...n.children];
    while (q.length) { const x = q.shift(); if (seen.has(x) || x === n.id) continue; seen.add(x); const xn = nodes.get(x); if (xn) q.push(...xn.inboundDependencies, ...xn.children); }
    n.downstreamDependents = [...seen].sort();
  }
  return nodes;
}

// Generic cycle detection over an adjacency map (reused by the real graph and the self-test).
function detectCycles(adj) {
  const WHITE = 0, GRAY = 1, BLACK = 2; const color = new Map(); const cycles = [];
  const ids = [...adj.keys()].sort();
  for (const id of ids) color.set(id, WHITE);
  const dfs = (id, pathArr) => {
    color.set(id, GRAY); pathArr.push(id);
    for (const nx of (adj.get(id) || [])) {
      if (!adj.has(nx)) continue;
      if (color.get(nx) === GRAY) { const i = pathArr.indexOf(nx); cycles.push(pathArr.slice(i).concat(nx)); }
      else if (color.get(nx) === WHITE) dfs(nx, pathArr);
    }
    color.set(id, BLACK); pathArr.pop();
  };
  for (const id of ids) if (color.get(id) === WHITE) dfs(id, []);
  return cycles;
}

// ---------------------------------------------------------------------------
// Dependency integrity (§3)
// ---------------------------------------------------------------------------
function integrity(nodes) {
  const out = [];
  const F = (rule, map, severity, subject, message) => out.push({ rule, mapsTo: map, severity, subject, message });
  const adj = new Map([...nodes.values()].map((n) => [n.id, n.outboundDependencies.filter((d) => nodes.has(d))]));

  for (const c of detectCycles(adj)) F('CYCLE', '§3 circular', 'BLOCK', c[0], `circular dependency: ${c.join(' → ')}`);
  for (const n of nodes.values()) {
    for (const _ of n.selfReferences) F('SELF-DEP', '§3 self', 'WARN', n.id, `${n.id} declares a self-dependency (filtered from graph edges; traces to census footer extraction)`);
    if (n.selfParent) F('SELF-PARENT', '§3 orphan chain', 'WARN', n.id, `${n.id} declared itself as governing parent; reparented to ${ROOT_NODE}`);
    for (const dep of n.outboundDependencies) if (!nodes.has(dep)) F('UNRESOLVED', '§3 unresolved', 'BLOCK', n.id, `${n.id} → ${dep} does not resolve to a registered node`);
    const dups = n.outboundDependencies.filter((d, i, a) => a.indexOf(d) !== i);
    for (const d of new Set(dups)) F('DUP-DEP', '§3 duplicate declaration', 'WARN', n.id, `duplicate dependency ${d}`);
    if (n.dependencyDepth > DEPTH_LIMIT) F('DEPTH-OVERFLOW', '§3 depth overflow', 'BLOCK', n.id, `dependency depth ${n.dependencyDepth} exceeds ${DEPTH_LIMIT}`);
    if (n.parent && !nodes.has(n.parent)) F('BAD-PARENT', '§3 invalid constitutional reference', 'BLOCK', n.id, `parent ${n.parent} does not resolve`);
    if (n.id !== ROOT_NODE && !n.parent && n.outboundDependencies.length === 0 && n.inboundDependencies.length === 0 && n.children.length === 0)
      F('ISLAND', '§3 disconnected island', 'WARN', n.id, `${n.id} is disconnected (no parent, deps, dependents, or children)`);
  }
  // Weakly-connected components over union(dependency, hierarchy) → islands / orphan chains.
  const undirected = new Map([...nodes.keys()].map((k) => [k, new Set()]));
  const link = (a, b) => { if (nodes.has(a) && nodes.has(b)) { undirected.get(a).add(b); undirected.get(b).add(a); } };
  for (const n of nodes.values()) { for (const d of n.outboundDependencies) link(n.id, d); if (n.parent) link(n.id, n.parent); }
  const seen = new Set(); let components = 0; const compSizes = [];
  for (const id of [...nodes.keys()].sort()) {
    if (seen.has(id)) continue; components++; let size = 0; const q = [id];
    while (q.length) { const x = q.shift(); if (seen.has(x)) continue; seen.add(x); size++; for (const nx of undirected.get(x)) if (!seen.has(nx)) q.push(nx); }
    compSizes.push(size);
  }
  if (components > 1) F('ISLANDS', '§3 disconnected islands', 'WARN', `${components} components`, `governance graph has ${components} weakly-connected components (sizes ${compSizes.sort((a, b) => b - a).join(',')}); nodes rooted only at ${ROOT_NODE} via parent are expected to unify`);
  out.sort((a, b) => (a.severity < b.severity ? 1 : a.severity > b.severity ? -1 : 0) || a.rule.localeCompare(b.rule) || String(a.subject).localeCompare(String(b.subject)));
  return { findings: out, components, componentSizes: compSizes };
}

// ---------------------------------------------------------------------------
// Impact analysis (§4)
// ---------------------------------------------------------------------------
function analyzeImpact(nodes, targetId, operation, freezeDecision) {
  const t = nodes.get(targetId);
  const direct = t ? [...new Set([...t.inboundDependencies, ...t.children])].sort() : [];
  const all = t ? t.downstreamDependents : [];
  const indirect = all.filter((x) => !direct.includes(x)).sort();
  const affected = t ? [targetId, ...all] : [targetId];
  const affectedNodes = affected.map((id) => nodes.get(id)).filter(Boolean);
  const constitutionalImpact = affectedNodes.filter((n) => n.isConstitutional).map((n) => n.id);
  const governanceImpact = affectedNodes.filter((n) => n.isGovernance).map((n) => n.id);
  const certificationImpact = affected.includes('GOV-CERT-001') || (t && t.id === 'GOV-CERT-001');
  const documentationImpact = affectedNodes.filter((n) => ['navigation', 'appendix', 'diagram'].includes(n.documentType)).map((n) => n.id);
  const releaseImpact = affectedNodes.some((n) => ['release', 'version', 'ratification'].includes(n.documentType)) || (t && ['release', 'version', 'ratification'].includes(t.documentType));
  const mergeImpact = freezeDecision || 'not-evaluated';
  let level = 'Low';
  if (freezeDecision === 'Deny' && (t?.isConstitutional)) level = 'Critical';
  else if (constitutionalImpact.length && ['delete', 'supersede', 'rename', 'move'].includes(operation)) level = 'Critical';
  else if (all.length >= 5) level = 'High';
  else if (all.length >= 1) level = 'Moderate';
  return {
    target: targetId, operation, resolved: !!t,
    directlyAffected: direct, directCount: direct.length,
    indirectlyAffected: indirect, indirectCount: indirect.length,
    constitutionalImpact, governanceImpact,
    certificationImpact, documentationImpact, releaseImpact,
    mergeImpact, overallImpactLevel: level,
  };
}

// ---------------------------------------------------------------------------
// Critical paths & centrality (§5)
// ---------------------------------------------------------------------------
function longestPathTo(nodes, targetId) {
  // longest chain of dependents leading INTO targetId (over dependency edges), via reverse walk.
  const best = new Map();
  const walk = (id, seen) => {
    if (best.has(id)) return best.get(id);
    if (seen.has(id)) return [id];
    seen.add(id);
    let longest = [id];
    const n = nodes.get(id);
    if (n) for (const up of n.inboundDependencies) { const p = walk(up, new Set(seen)); if (p.length + 1 > longest.length) longest = [id, ...p]; }
    seen.delete(id);
    best.set(id, longest);
    return longest;
  };
  return walk(targetId, new Set());
}
function criticalPaths(nodes) {
  const ranked = [...nodes.values()]
    .map((n) => ({ id: n.id, dependents: n.downstreamDependents.length, inbound: n.inboundDependencies.length, depth: n.dependencyDepth, criticality: n.downstreamDependents.length * 2 + n.inboundDependencies.length + n.dependencyDepth }))
    .sort((a, b) => b.criticality - a.criticality || a.id.localeCompare(b.id));
  const bottlenecks = [...nodes.values()].filter((n) => n.inboundDependencies.length >= 2)
    .map((n) => ({ id: n.id, dependents: n.inboundDependencies.length })).sort((a, b) => b.dependents - a.dependents || a.id.localeCompare(b.id));
  const pathTo = (id) => (nodes.has(id) ? longestPathTo(nodes, id) : []);
  return {
    highestCriticality: ranked.slice(0, 8),
    bottlenecks,
    constitutionalCriticalPath: pathTo('AUDIT-005'),
    certificationCriticalPath: pathTo('GOV-CERT-001'),
    releaseCriticalPath: pathTo('GOV-IMPL-001'),
  };
}

// ---------------------------------------------------------------------------
// Change simulation (§6) — reuses WP-05 for the freeze verdict; never mutates the repo.
// ---------------------------------------------------------------------------
function freezeVerdict(request) {
  try {
    const r = consume(WP05, ['--request', JSON.stringify(request), '--no-ledger']);
    return r.evaluations?.[0]?.decision || 'not-evaluated';
  } catch { return 'not-evaluated'; }
}
function simulate(nodes, request) {
  const verdict = freezeVerdict(request);
  const impact = analyzeImpact(nodes, request.target, request.operation, verdict);
  return { request, freezeDecision: verdict, impact };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------
function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; }
function graphSummary(nodes) {
  let edges = 0, maxDepth = 0; for (const n of nodes.values()) { edges += n.outboundDependencies.filter((d) => nodes.has(d)).length; maxDepth = Math.max(maxDepth, n.dependencyDepth); }
  return { nodes: nodes.size, edges, maxDepth };
}
function adjacencyList(nodes) {
  const adj = {}; for (const id of [...nodes.keys()].sort()) adj[id] = nodes.get(id).outboundDependencies.filter((d) => nodes.has(d)).sort(); return adj;
}

const DEMO_SIMS = [
  { label: 'supersede DESIGN-002', operation: 'supersede', target: 'DESIGN-002', viaAmendment: 'AMENDMENT-002' },
  { label: 'delete AUDIT-005', operation: 'delete', target: 'AUDIT-005' },
  { label: 'update GOV-AUTO-004 (detection foundation)', operation: 'update', target: 'GOV-AUTO-004', changes: { classification: 'x' } },
];

function selftest() {
  // Synthetic graph proving cycle + unresolved detection without touching real data.
  const adj = new Map([['A', ['B']], ['B', ['C']], ['C', ['A']], ['D', ['ZZZ']]]);
  const cycles = detectCycles(adj);
  const unresolved = [...adj.entries()].flatMap(([k, v]) => v.filter((x) => !adj.has(x)).map((x) => `${k}→${x}`));
  return { cyclesDetected: cycles.length, sampleCycle: cycles[0] || null, unresolvedDetected: unresolved };
}

function main() {
  const asJson = process.argv.includes('--json');
  const t0 = performance.now();
  const tc = performance.now();
  const census = consume(WP03);
  const health = consume(WP04);
  const consumeMs = +(performance.now() - tc).toFixed(1);

  const tg = performance.now();
  const nodes = buildGraph(census);
  const graphMs = +(performance.now() - tg).toFixed(1);

  const ti = performance.now();
  const integ = integrity(nodes);
  const integrityMs = +(performance.now() - ti).toFixed(1);

  const summary = graphSummary(nodes);
  const crit = criticalPaths(nodes);

  const mode = process.argv.includes('--graph') ? 'graph'
    : process.argv.includes('--integrity') ? 'integrity'
    : process.argv.includes('--critical-path') ? 'critical-path'
    : arg('--impact') ? 'impact'
    : arg('--simulate') ? 'simulate'
    : 'demo';

  let simulations = [], selftestResult = null, impactSingle = null;
  const tS = performance.now();
  if (mode === 'demo') { simulations = DEMO_SIMS.map((s) => ({ label: s.label, ...simulate(nodes, s) })); selftestResult = selftest(); }
  else if (mode === 'simulate') simulations = [simulate(nodes, JSON.parse(arg('--simulate')))];
  else if (mode === 'impact') impactSingle = analyzeImpact(nodes, arg('--impact'), 'update', null);
  const simMs = +(performance.now() - tS).toFixed(1);

  const digest = hash(JSON.stringify([
    adjacencyList(nodes),
    [...nodes.values()].map((n) => [n.id, n.dependencyDepth, n.downstreamDependents.length]),
    integ.findings.map((f) => [f.rule, f.subject]),
    crit.highestCriticality, simulations.map((s) => [s.request?.target, s.freezeDecision, s.impact?.overallImpactLevel]),
    impactSingle,
  ]));

  const report = {
    tool: 'governance-dependency-graph-runtime', runtimeVersion: '1.0.0', mapsTo: 'GOV-AUTO-004',
    consumes: { wp03: 'GOV-AUTO-002 census', wp04: 'GOV-AUTO-008 posture', wp05: 'GOV-AUTO-003 freeze (simulation)' },
    posture: health.posture.classification, digest,
    graph: { ...summary, components: integ.components, componentSizes: integ.componentSizes },
    integrity: { violations: integ.findings.filter((f) => f.severity === 'BLOCK').length, warnings: integ.findings.filter((f) => f.severity === 'WARN').length, findings: integ.findings },
    criticalPaths: crit,
    ...(simulations.length ? { simulations } : {}),
    ...(impactSingle ? { impact: impactSingle } : {}),
    ...(selftestResult ? { selftest: selftestResult } : {}),
    ...(mode === 'graph' ? { adjacencyList: adjacencyList(nodes), nodeDetail: [...nodes.values()] } : {}),
    observability: {
      runtimeMs: +(performance.now() - t0).toFixed(1), consumeMs, graphGenerationMs: graphMs, integrityMs, impactMs: simMs,
      nodes: summary.nodes, edges: summary.edges, integrityRulesExecuted: 8, simulationsExecuted: simulations.length,
      heapUsedMB: +(process.memoryUsage().heapUsed / 1048576).toFixed(1),
    },
  };

  if (asJson) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  else {
    const L = [];
    L.push('Governance Dependency Graph & Impact Analysis Runtime — GOV-AUTO-004 (canonical)');
    L.push(`consumes: WP-03 + WP-04 (${report.posture}) + WP-05  ·  digest: ${digest}`);
    L.push(`\ngraph: ${summary.nodes} nodes, ${summary.edges} dependency edges, max depth ${summary.maxDepth}, ${integ.components} component(s) [${integ.componentSizes.sort((a, b) => b - a).join(',')}]`);
    L.push(`integrity: ${report.integrity.violations} violations, ${report.integrity.warnings} warnings`);
    for (const f of integ.findings.slice(0, 6)) L.push(`  [${f.severity}] ${f.rule} ${f.subject}: ${f.message}`);
    L.push('\ncritical paths & centrality:');
    L.push('  highest criticality: ' + crit.highestCriticality.slice(0, 5).map((c) => `${c.id}(${c.criticality})`).join(', '));
    L.push('  bottlenecks: ' + (crit.bottlenecks.slice(0, 5).map((b) => `${b.id}(${b.dependents})`).join(', ') || 'none'));
    L.push('  constitutional critical path: ' + crit.constitutionalCriticalPath.join(' → '));
    L.push('  certification critical path: ' + crit.certificationCriticalPath.join(' → '));
    if (simulations.length) {
      L.push('\nimpact simulations:');
      for (const s of simulations) L.push(`  ${s.label || s.request.target}: op=${s.request.operation} freeze=${s.freezeDecision} impact=${s.impact.overallImpactLevel} (direct ${s.impact.directCount}, indirect ${s.impact.indirectCount}, constitutional ${s.impact.constitutionalImpact.length})`);
    }
    if (impactSingle) L.push(`\nimpact ${impactSingle.target}: ${impactSingle.overallImpactLevel} (direct ${impactSingle.directCount}, indirect ${impactSingle.indirectCount})`);
    if (selftestResult) L.push(`\nself-test (synthetic): cyclesDetected=${selftestResult.cyclesDetected} sample=${(selftestResult.sampleCycle || []).join('→')} unresolved=${selftestResult.unresolvedDetected.join(',')}`);
    L.push(`\nobservability: ${report.observability.runtimeMs}ms (consume ${consumeMs}ms, graph ${graphMs}ms, sim ${simMs}ms)  heap ${report.observability.heapUsedMB}MB`);
    process.stdout.write(L.join('\n') + '\n');
  }
  process.exit(report.integrity.violations === 0 ? 0 : 1);
}

main();
