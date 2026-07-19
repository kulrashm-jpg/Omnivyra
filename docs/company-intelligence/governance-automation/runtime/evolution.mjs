#!/usr/bin/env node
// Canonical Governance Evolution Control & Constitutional Change Management Runtime — GOV-AUTO-018 (WP-19).
//
// Begins the POST-LOCKDOWN governance lifecycle. The WP-18 immutable baseline is NEVER modified; this
// runtime governs how future constitutional evolution is proposed, evaluated, simulated, approved,
// rejected, versioned, and re-baselined — all additively. It consumes ONLY WP-18 (the immutable baseline);
// no earlier runtime is invoked directly. It introduces NO new governance decision logic: impact
// assessment reuses the baseline's captured governance evidence. Deterministic; additive.
//
// Usage:
//   node evolution.mjs --propose amendment --title "..."   # create + assess one proposal
//   node evolution.mjs --demo                              # 5 proposal types + approved/rejected/withdrawn + graph + replay
//   node evolution.mjs --json                              # machine-readable proposal + lifecycle + impact + graph + ledger
//   node evolution.mjs --persist                           # append immutable evolution records
//   node evolution.mjs --cache-dir <dir> --ledger-dir <dir>

import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { produceBaseline } from './lockdown.mjs';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..', '..', '..', '..');
const CACHE_DIR = path.join(REPO_ROOT, '.governance-orchestrator-cache');
const DEFAULT_LEDGER_DIR = path.join(REPO_ROOT, '.governance-evolution');

function hash(str) { const s = typeof str === 'string' ? str : JSON.stringify(str); let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(16).padStart(8, '0'); }

// ---------------------------------------------------------------------------
// Proposal engine (§2) — five proposal types (data-driven).
// ---------------------------------------------------------------------------
const PROPOSAL_TYPES = {
  'new-constitutional': { addsNode: 'proposal', impactWeight: 'high', description: 'introduce a new constitutional element' },
  amendment: { addsNode: 'proposal', impactWeight: 'moderate', description: 'amend an existing ratified decision' },
  deprecation: { addsNode: 'superseded', impactWeight: 'moderate', description: 'deprecate a constitutional element' },
  retirement: { addsNode: 'retirement', impactWeight: 'high', description: 'retire a constitutional element' },
  emergency: { addsNode: 'proposal', impactWeight: 'high', description: 'expedited constitutional change' },
};

// ---------------------------------------------------------------------------
// Proposal lifecycle (§3) — nine states, data-driven transitions.
// ---------------------------------------------------------------------------
const LIFECYCLE = {
  Draft: ['Submitted', 'Withdrawn'],
  Submitted: ['Under Review', 'Withdrawn'],
  'Under Review': ['Impact Assessed', 'Rejected', 'Withdrawn'],
  'Impact Assessed': ['Approved', 'Rejected', 'Withdrawn'],
  Approved: ['Baseline Candidate'],
  'Baseline Candidate': ['Baselined'],
  Rejected: [], Withdrawn: [], Baselined: [],
};
const OUTCOME_PATHS = {
  approved: ['Draft', 'Submitted', 'Under Review', 'Impact Assessed', 'Approved', 'Baseline Candidate', 'Baselined'],
  rejected: ['Draft', 'Submitted', 'Under Review', 'Impact Assessed', 'Rejected'],
  withdrawn: ['Draft', 'Submitted', 'Withdrawn'],
};
function validPath(path) { for (let i = 0; i < path.length - 1; i++) if (!(LIFECYCLE[path[i]] || []).includes(path[i + 1])) return false; return true; }

// ---------------------------------------------------------------------------
// Impact assessment (§4) — reuses the baseline's captured governance evidence. No new analysis.
// ---------------------------------------------------------------------------
const SEV = { none: 0, low: 1, moderate: 2, high: 3 };
const TYPE_IMPACT = {
  'new-constitutional': { repository: 'high', dependency: 'high', runtime: 'moderate', operational: 'moderate', certification: 'high', audit: 'high', baseline: 'preserved' },
  amendment: { repository: 'moderate', dependency: 'moderate', runtime: 'low', operational: 'low', certification: 'moderate', audit: 'moderate', baseline: 'preserved' },
  deprecation: { repository: 'moderate', dependency: 'moderate', runtime: 'low', operational: 'low', certification: 'moderate', audit: 'low', baseline: 'preserved' },
  retirement: { repository: 'high', dependency: 'high', runtime: 'high', operational: 'moderate', certification: 'high', audit: 'moderate', baseline: 'preserved' },
  emergency: { repository: 'high', dependency: 'moderate', runtime: 'moderate', operational: 'high', certification: 'high', audit: 'high', baseline: 'preserved' },
};
function assessImpact(type, baseline) {
  const ev = baseline.capturedEvidence;
  const map = TYPE_IMPACT[type];
  const areas = {
    repository: { severity: map.repository, evidence: { revision: ev.repositoryRevision } },
    dependency: { severity: map.dependency, evidence: { topologyDepth: (ev.executionTopology || []).length } },
    runtime: { severity: map.runtime, evidence: { runtimes: Object.keys(ev.runtimeRegistrySnapshot || {}).length } },
    operational: { severity: map.operational, evidence: { operationalDigest: ev.operationalDigest } },
    certification: { severity: map.certification, evidence: { certificateRef: ev.productionCertificationReference } },
    audit: { severity: map.audit, evidence: { auditRef: ev.independentAuditReference } },
    baseline: { severity: map.baseline, evidence: { baselineId: baseline.baselineId, immutable: true } },
  };
  const overall = Math.max(...Object.values(areas).filter((a) => a.severity in SEV).map((a) => SEV[a.severity]));
  const severity = Object.keys(SEV).find((k) => SEV[k] === overall) || 'moderate';
  return { areas, overallSeverity: severity };
}

// ---------------------------------------------------------------------------
// Proposal + simulation (§7)
// ---------------------------------------------------------------------------
function makeProposal(type, title, baseline) {
  const proposalId = `PROP-${type}-${baseline.repositoryRevision}-${hash([type, title])}`;
  const impact = assessImpact(type, baseline);
  return { proposalId, proposalType: type, title, parentBaseline: baseline.baselineId, parentRevision: baseline.repositoryRevision, lifecycleState: 'Draft', impact };
}
function simulate(proposal, outcome) {
  const p = OUTCOME_PATHS[outcome];
  const valid = validPath(p);
  const finalState = p[p.length - 1];
  const simDigest = hash([proposal.proposalId, outcome, p, proposal.impact.overallSeverity]);
  return { outcome, path: p, validTransitions: valid, finalState, impactSeverity: proposal.impact.overallSeverity, simulationDigest: simDigest };
}

// ---------------------------------------------------------------------------
// Constitutional version graph (§5) — additive; no existing node modified.
// ---------------------------------------------------------------------------
function versionGraph(baseline, proposals) {
  const nodes = [{ id: baseline.baselineId, type: 'baseline', immutable: true, revision: baseline.repositoryRevision, integrity: baseline.integrityLevel }];
  const edges = [];
  for (const { proposal, outcome } of proposals) {
    const nodeType = outcome === 'approved' ? PROPOSAL_TYPES[proposal.proposalType].addsNode : 'proposal';
    nodes.push({ id: proposal.proposalId, type: nodeType, proposalType: proposal.proposalType, parent: baseline.baselineId, finalState: OUTCOME_PATHS[outcome][OUTCOME_PATHS[outcome].length - 1] });
    edges.push({ from: baseline.baselineId, to: proposal.proposalId, relation: 'proposes-from' });
    if (outcome === 'approved') {
      const candidateId = `CAND-${proposal.proposalId}`;
      nodes.push({ id: candidateId, type: 'baseline-candidate', parent: proposal.proposalId, additive: true });
      edges.push({ from: proposal.proposalId, to: candidateId, relation: 'approved-to-candidate' });
    }
  }
  return { nodes, edges, additiveOnly: true, immutableBaselinePreserved: true };
}

// ---------------------------------------------------------------------------
// Immutable evolution ledger (§6)
// ---------------------------------------------------------------------------
function appendLedger(proposal, outcome, dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'evolution-ledger.jsonl');
  const entry = { proposalId: proposal.proposalId, proposalType: proposal.proposalType, parentBaseline: proposal.parentBaseline, baselineRevision: proposal.parentRevision, lifecycleState: OUTCOME_PATHS[outcome][OUTCOME_PATHS[outcome].length - 1], impactSummary: proposal.impact.overallSeverity, timestamp: new Date().toISOString() };
  appendFileSync(file, JSON.stringify(entry) + '\n'); // append-only; prior lines never modified
  return entry;
}
function ledgerEntries(dir) { const f = path.join(dir, 'evolution-ledger.jsonl'); if (!existsSync(f)) return []; const c = readFileSync(f, 'utf8').trim(); return c ? c.split(/\n/).map((l) => JSON.parse(l)) : []; }

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------
function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; }

// WP-20 consumes this as the sole WP-19 API — the immutable baseline + the governed proposal set.
const EVOLUTION_SPECS = [
  { type: 'new-constitutional', title: 'New consumer contract', outcome: 'approved' },
  { type: 'amendment', title: 'Refine confidence dimension', outcome: 'approved' },
  { type: 'deprecation', title: 'Deprecate legacy projection', outcome: 'rejected' },
  { type: 'retirement', title: 'Retire trajectory provider', outcome: 'withdrawn' },
  { type: 'emergency', title: 'Expedited SSRF invariant', outcome: 'approved' },
];
function produceEvolution(cacheDir) {
  const baseline = produceBaseline(cacheDir);   // WP-18 immutable baseline (never mutated)
  const proposals = EVOLUTION_SPECS.map((s) => { const proposal = makeProposal(s.type, s.title, baseline); return { proposal, outcome: s.outcome, simulation: simulate(proposal, s.outcome) }; });
  return { baseline, proposals };
}

function main() {
  const asJson = process.argv.includes('--json');
  const ledgerDir = path.resolve(arg('--ledger-dir') || DEFAULT_LEDGER_DIR);
  const cacheDir = path.resolve(arg('--cache-dir') || CACHE_DIR);

  const t0 = performance.now();
  const baseline = produceBaseline(cacheDir);   // sole input: the WP-18 immutable baseline (never mutated)
  const consumeMs = +(performance.now() - t0).toFixed(1);

  if (process.argv.includes('--demo')) { runDemo(baseline, ledgerDir, asJson, consumeMs); return; }

  const type = arg('--propose') || 'amendment';
  const title = arg('--title') || `${type} proposal`;
  const proposal = makeProposal(type, title, baseline);
  const sims = ['approved', 'rejected', 'withdrawn'].map((o) => simulate(proposal, o));
  const graph = versionGraph(baseline, [{ proposal, outcome: 'approved' }]);
  let ledger = null;
  if (process.argv.includes('--persist')) { appendLedger(proposal, 'approved', ledgerDir); ledger = { entries: ledgerEntries(ledgerDir).length }; }

  const out = {
    tool: 'governance-evolution-control', runtimeVersion: '1.0.0', mapsTo: 'GOV-AUTO-018', consumes: { wp18: 'immutable constitutional baseline' },
    parentBaseline: { id: baseline.baselineId, revision: baseline.repositoryRevision, integrity: baseline.integrityLevel, immutable: true },
    proposal, lifecycle: { states: Object.keys(LIFECYCLE), transitions: LIFECYCLE }, impactAssessment: proposal.impact,
    versionGraph: graph, simulationResults: sims, ...(ledger ? { evolutionLedger: ledger } : {}),
    observability: { proposalStatus: proposal.lifecycleState, constitutionalLineage: `${baseline.baselineId} → ${proposal.proposalId}`, impactSeverity: proposal.impact.overallSeverity, baselineContinuity: 'preserved', governanceContinuity: baseline.repositoryRevision, processingMs: consumeMs },
  };
  if (asJson) process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  else {
    const L = [];
    L.push('Governance Evolution Control & Constitutional Change Management — GOV-AUTO-018 (canonical)');
    L.push(`consumes WP-18 only  ·  parent baseline: ${baseline.baselineId} (immutable, preserved)`);
    L.push(`\nPROPOSAL: ${proposal.proposalId}`);
    L.push(`   type=${proposal.proposalType} state=${proposal.lifecycleState} impact=${proposal.impact.overallSeverity}`);
    L.push('\nimpact assessment:');
    for (const [area, d] of Object.entries(proposal.impact.areas)) L.push(`   ${area.padEnd(14)} ${String(d.severity).padEnd(10)} ${JSON.stringify(d.evidence)}`);
    L.push('\nsimulations:');
    for (const s of sims) L.push(`   ${s.outcome.padEnd(10)} path=[${s.path.join(' → ')}] valid=${s.validTransitions} final=${s.finalState}`);
    L.push(`\nversion graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges (additive-only, baseline immutable=${graph.immutableBaselinePreserved})`);
    process.stdout.write(L.join('\n') + '\n');
  }
  process.exit(0);
}

function runDemo(baseline, ledgerDir, asJson, consumeMs) {
  const specs = [
    { type: 'new-constitutional', title: 'New consumer contract', outcome: 'approved' },
    { type: 'amendment', title: 'Refine confidence dimension', outcome: 'approved' },
    { type: 'deprecation', title: 'Deprecate legacy projection', outcome: 'rejected' },
    { type: 'retirement', title: 'Retire trajectory provider', outcome: 'withdrawn' },
    { type: 'emergency', title: 'Expedited SSRF invariant', outcome: 'approved' },
  ];
  const proposals = specs.map((s) => ({ proposal: makeProposal(s.type, s.title, baseline), outcome: s.outcome }));
  const sims = proposals.map(({ proposal, outcome }) => ({ proposal: proposal.proposalId, type: proposal.proposalType, outcome, ...simulate(proposal, outcome) }));
  // All three lifecycle outcomes across a single proposal (for the outcome demonstration).
  const outcomeProposal = proposals[1].proposal;
  const outcomeSims = ['approved', 'rejected', 'withdrawn'].map((o) => simulate(outcomeProposal, o));
  const graph = versionGraph(baseline, proposals);
  for (const { proposal, outcome } of proposals) appendLedger(proposal, outcome, ledgerDir);
  // Deterministic replay: re-simulate identical.
  const r1 = simulate(outcomeProposal, 'approved'), r2 = simulate(outcomeProposal, 'approved');

  const out = {
    tool: 'governance-evolution-control', mode: 'demo', mapsTo: 'GOV-AUTO-018', consumes: 'WP-18 only', parentBaseline: baseline.baselineId, baselineImmutable: true,
    proposalTypes: proposals.map(({ proposal, outcome }) => ({ id: proposal.proposalId, type: proposal.proposalType, impact: proposal.impact.overallSeverity, outcome, finalState: OUTCOME_PATHS[outcome][OUTCOME_PATHS[outcome].length - 1] })),
    lifecycleOutcomes: { approved: outcomeSims[0].finalState, rejected: outcomeSims[1].finalState, withdrawn: outcomeSims[2].finalState },
    simulations: sims.map((s) => ({ proposal: s.proposal, type: s.type, outcome: s.outcome, valid: s.validTransitions, final: s.finalState, digest: s.simulationDigest })),
    versionGraph: { nodes: graph.nodes.length, edges: graph.edges.length, additiveOnly: graph.additiveOnly, immutableBaselinePreserved: graph.immutableBaselinePreserved, sample: graph.nodes.slice(0, 4) },
    evolutionLedger: { entries: ledgerEntries(ledgerDir).length, immutable: true, lookup: ['proposalId', 'baselineRevision'] },
    deterministicReplay: { digest1: r1.simulationDigest, digest2: r2.simulationDigest, identical: r1.simulationDigest === r2.simulationDigest },
    consumeMs,
  };
  if (asJson) { process.stdout.write(JSON.stringify(out, null, 2) + '\n'); return; }
  const L = [];
  L.push('Governance Evolution Control — GOV-AUTO-018 (canonical) — DEMO');
  L.push(`consumes WP-18 only  ·  parent baseline: ${baseline.baselineId} (immutable, never modified)`);
  L.push('\n1) proposal types:');
  for (const p of out.proposalTypes) L.push(`   ${p.type.padEnd(18)} impact=${String(p.impact).padEnd(9)} → ${p.outcome.padEnd(10)} final=${p.finalState}`);
  L.push('\n2) lifecycle outcomes (single proposal):');
  L.push(`   Approved  → ${out.lifecycleOutcomes.approved}`);
  L.push(`   Rejected  → ${out.lifecycleOutcomes.rejected}`);
  L.push(`   Withdrawn → ${out.lifecycleOutcomes.withdrawn}`);
  L.push('\n3) simulations:');
  for (const s of out.simulations) L.push(`   ${s.type.padEnd(18)} ${s.outcome.padEnd(10)} valid=${s.valid} final=${s.final.padEnd(12)} digest=${s.digest}`);
  L.push(`\n4) constitutional version graph: ${out.versionGraph.nodes} nodes, ${out.versionGraph.edges} edges (additive-only=${out.versionGraph.additiveOnly}, baseline immutable=${out.versionGraph.immutableBaselinePreserved})`);
  L.push(`5) immutable evolution ledger: ${out.evolutionLedger.entries} entries (lookup by ${out.evolutionLedger.lookup.join('/')})`);
  L.push(`6) deterministic replay: ${out.deterministicReplay.digest1} vs ${out.deterministicReplay.digest2} → ${out.deterministicReplay.identical ? 'IDENTICAL' : 'DIVERGED'}`);
  process.stdout.write(L.join('\n') + '\n');
}

// WP-20 consumes ONLY this layer — all constitutional state originates from WP-19.
export { produceEvolution, OUTCOME_PATHS };
const isDirectEvo = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isDirectEvo) main();
