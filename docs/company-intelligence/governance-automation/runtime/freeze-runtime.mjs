#!/usr/bin/env node
// Canonical Governance Freeze & Repository Mutation Guard Runtime — realizes GOV-AUTO-003 (WP-05).
//
// THE single authority that decides whether a governance artifact may be mutated. It performs NO
// discovery, parsing, validation, or census generation — it CONSUMES the canonical outputs of
// WP-03 (Constitutional Census registry → each artifact's state/metadata) and WP-04 (governance
// posture; WP-04 already encapsulates WP-02's validation result). Every decision is deterministic,
// evidence-based, and appended to an immutable ledger. Additive; single-runtime doctrine.
//
// Usage:
//   node freeze-runtime.mjs --demo                 # evaluate the canonical scenario suite
//   node freeze-runtime.mjs --request '<json>'     # evaluate one mutation request
//   node freeze-runtime.mjs --requests <file>      # evaluate a JSON array of requests
//   node freeze-runtime.mjs --json                 # machine-readable evaluation report
//   node freeze-runtime.mjs --ledger <path>        # ledger location (default <repo>/.governance-ledger/mutation-ledger.jsonl)
//   node freeze-runtime.mjs --no-ledger            # evaluate without appending to the ledger
//
// Request shape: { operation, target(id|path), changes?{version,owner,canonicalId,lifecycleStage,dependencies},
//                  viaAmendment?, newPath?, artifact?{...for create...} }

import { existsSync, mkdirSync, appendFileSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { invoke } from './lib/runtime-invoke.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WP03 = path.join(__dirname, 'census-runtime.mjs');
const WP04 = path.join(__dirname, 'health-runtime.mjs');
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const DEFAULT_LEDGER = path.join(REPO_ROOT, '.governance-ledger', 'mutation-ledger.jsonl');

// ---------------------------------------------------------------------------
// Reuse: consume WP-03 registry + WP-04 posture (stdout captured even on non-zero exit).
// ---------------------------------------------------------------------------
function consume(script, args = []) { return invoke(script, args); } // WP-12: orchestrator seam
function hash(str) { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0; return h.toString(16).padStart(8, '0'); }

// ---------------------------------------------------------------------------
// Governance Freeze Model (§2) — every artifact resolves to exactly one state.
// ---------------------------------------------------------------------------
const CONSTITUTIONAL_CORE = new Set(['version', 'ratification', 'lifecycle', 'adr', 'governance-framework', 'maintainers', 'history']);
function stateOf(a) {
  if (a.edition === 'full') return 'Frozen';                       // archival editions are immutable
  switch (a.lifecycleStage) {
    case 'Template': return 'Draft';
    case 'Specified': return 'Active';
    case 'Superseded': return 'Superseded';
    case 'Archived': return 'Archived';
    case 'Ratified':
      return (CONSTITUTIONAL_CORE.has(a.documentType) || a.canonicalId === 'DESIGN-002') ? 'Ratified' : 'Frozen';
    default: return 'Active';
  }
}
const STATE_RANK = { Draft: 0, Active: 1, Ratified: 2, Frozen: 2, Superseded: 3, Archived: 4 };
const IMMUTABLE_STATES = new Set(['Ratified', 'Frozen']);
// Permitted lifecycle transitions (freeze model). Direct edits to immutable states are not here — they
// require the amendment path. `restore` is the only backward transition, and only Archived→Active.
const PERMITTED_TRANSITIONS = {
  Draft: ['Draft', 'Active'],
  Active: ['Active', 'Ratified', 'Frozen', 'Superseded', 'Archived'],
  Ratified: ['Superseded', 'Archived'],   // amendment-gated
  Frozen: ['Superseded', 'Archived'],     // amendment-gated
  Superseded: ['Archived'],
  Archived: ['Active'],                    // restore only
};

// ---------------------------------------------------------------------------
// Policy engine (§3) — ordered, deterministic rules. Each returns a verdict or null.
// verdict: { rule, policy, decision: 'Deny'|'Warn'|'Allow', rationale, evidence }
// ---------------------------------------------------------------------------
const semverGte = (a, b) => {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { const x = pa[i] || 0, y = pb[i] || 0; if (x !== y) return x > y; }
  return true;
};

function buildPolicies() {
  return [
    // P1 unknown target (any non-create op must reference a registered artifact)
    { id: 'P1-target-exists', map: '§3 target resolution', run: (req, t) =>
      (req.operation !== 'create' && !t) ? deny('P1-target-exists', '§3 target resolution', `Target '${req.target}' is not a registered governed artifact`, { target: req.target }) : null },
    // P2 duplicate registration (create with an existing canonical id)
    { id: 'P2-duplicate', map: '§5 duplicate registration', run: (req, t, ctx) => {
      if (req.operation !== 'create') return null;
      const id = req.artifact?.canonicalId || req.target;
      return ctx.registry.has(id) ? deny('P2-duplicate', '§5 duplicate registration', `create would duplicate existing id ${id}`, { id }) : null;
    } },
    // P3 constitutional immutability (edit/delete/rename/move of an immutable-state artifact, without amendment)
    { id: 'P3-constitutional-immutability', map: '§4 constitutional protection / §5 frozen modification', run: (req, t, ctx) => {
      if (!t) return null;
      const st = stateOf(t);
      if (['update', 'delete', 'rename', 'move', 'version'].includes(req.operation) && IMMUTABLE_STATES.has(st) && !ctx.amendmentValid(req))
        return deny('P3-constitutional-immutability', '§4 constitutional protection', `${req.operation} of ${st.toLowerCase()} artifact ${t.canonicalId} requires a ratified amendment`, { state: st, artifact: t.canonicalId, documentType: t.documentType });
      return null;
    } },
    // P4 identifier mutation (canonical ids are immutable)
    { id: 'P4-identifier-mutation', map: '§5 identifier mutation', run: (req, t) => {
      if (!t) return null;
      const newId = req.changes?.canonicalId;
      if ((req.operation === 'rename' || req.operation === 'update') && newId && newId !== t.canonicalId)
        return deny('P4-identifier-mutation', '§5 identifier mutation', `canonical id ${t.canonicalId} may not change to ${newId}`, { from: t.canonicalId, to: newId });
      return null;
    } },
    // P5 version regression
    { id: 'P5-version-regression', map: '§5 version regression', run: (req, t) => {
      if (!t) return null;
      const nv = req.changes?.version || (req.operation === 'version' ? req.version : null);
      if (nv && !semverGte(nv, t.version) )
        return deny('P5-version-regression', '§5 version regression', `version ${nv} regresses from current ${t.version}`, { from: t.version, to: nv });
      return null;
    } },
    // P6 ownership removal
    { id: 'P6-ownership-removal', map: '§5 ownership removal', run: (req, t) => {
      if (!t) return null;
      if (req.operation === 'update' && 'owner' in (req.changes || {}) && !String(req.changes.owner || '').trim())
        return deny('P6-ownership-removal', '§5 ownership removal', `ownership may not be removed from ${t.canonicalId}`, { currentOwner: t.owner });
      return null;
    } },
    // P7 lifecycle regression (backward transition, except restore)
    { id: 'P7-lifecycle-regression', map: '§5 lifecycle regression', run: (req, t) => {
      if (!t) return null;
      const target = req.changes?.lifecycleStage;
      if (!target) return null;
      const from = stateOf(t), toRank = STATE_RANK[target] ?? STATE_RANK[stateFromLifecycle(target)];
      if (req.operation !== 'restore' && toRank < STATE_RANK[from])
        return deny('P7-lifecycle-regression', '§5 lifecycle regression', `${from} → ${target} is a backward lifecycle transition`, { from, to: target });
      return null;
    } },
    // P8 dependency removal
    { id: 'P8-dependency-removal', map: '§5 dependency removal', run: (req, t) => {
      if (!t || !Array.isArray(req.changes?.dependencies)) return null;
      const removed = (t.dependencies || []).filter((d) => !req.changes.dependencies.includes(d));
      if (!removed.length) return null;
      const st = stateOf(t);
      return IMMUTABLE_STATES.has(st)
        ? deny('P8-dependency-removal', '§5 dependency removal', `removing declared dependencies ${removed} from an immutable artifact requires an amendment`, { removed })
        : warn('P8-dependency-removal', '§5 dependency removal', `removing declared dependencies ${removed} — verify no consumer breaks`, { removed });
    } },
    // P9 amendment path (supersede/archive of immutable artifact requires a valid amendment)
    { id: 'P9-amendment-path', map: '§4 approved mutation path / §5 amendment violation', run: (req, t, ctx) => {
      if (!t) return null;
      const st = stateOf(t);
      if (['supersede', 'archive'].includes(req.operation) && IMMUTABLE_STATES.has(st)) {
        if (!ctx.amendmentValid(req)) return deny('P9-amendment-path', '§5 amendment violation', `${req.operation} of ${t.canonicalId} requires a valid contiguous amendment (next: AMENDMENT-${String(ctx.nextAmendment).padStart(3, '0')})`, { provided: req.viaAmendment || null, expected: `AMENDMENT-${String(ctx.nextAmendment).padStart(3, '0')}` });
        return warn('P9-amendment-path', '§4 approved mutation path', `${req.operation} of ${t.canonicalId} permitted via ${req.viaAmendment}; recording constitutional change`, { viaAmendment: req.viaAmendment });
      }
      return null;
    } },
    // P10 amendment numbering (creating an amendment must be contiguous)
    { id: 'P10-amendment-numbering', map: '§5 amendment violation', run: (req, t, ctx) => {
      if (req.operation !== 'create') return null;
      const id = req.artifact?.canonicalId || req.target;
      const m = String(id).match(/^AMENDMENT-(\d{3})$/);
      if (!m) return null;
      const n = Number(m[1]);
      return n !== ctx.nextAmendment
        ? deny('P10-amendment-numbering', '§5 amendment violation', `amendment ${id} is non-contiguous (expected AMENDMENT-${String(ctx.nextAmendment).padStart(3, '0')})`, { expected: ctx.nextAmendment })
        : null;
    } },
    // P11 orphan creation (create/move that yields no governing parent)
    { id: 'P11-orphan-creation', map: '§5 orphan creation', run: (req, t) => {
      if (req.operation === 'create' && req.artifact && !req.artifact.governingParent)
        return warn('P11-orphan-creation', '§5 orphan creation', `created artifact declares no governing parent — will be flagged by WP-02/WP-03`, { artifact: req.artifact.canonicalId });
      return null;
    } },
    // P12 additive baseline (create/update in Draft/Active is the permitted, low-risk path)
    { id: 'P12-additive-baseline', map: '§3 additive mutation', run: (req, t) => {
      if (['create'].includes(req.operation) && (!t || !IMMUTABLE_STATES.has(stateOf(t))))
        return allow('P12-additive-baseline', '§3 additive mutation', `additive ${req.operation} in a non-frozen area`, {});
      if (req.operation === 'update' && t && !IMMUTABLE_STATES.has(stateOf(t)))
        return allow('P12-additive-baseline', '§3 additive mutation', `additive update to ${stateOf(t)} artifact ${t.canonicalId}`, { state: stateOf(t) });
      return null;
    } },
    // P13 restore (Archived→Active) is allowed with a warning
    { id: 'P13-restore', map: '§3 restore', run: (req, t) => {
      if (req.operation === 'restore' && t && stateOf(t) === 'Archived')
        return warn('P13-restore', '§3 restore', `restoring archived ${t.canonicalId} to Active`, {});
      return null;
    } },
  ];
}
function deny(rule, policy, rationale, evidence) { return { rule, policy, decision: 'Deny', rationale, evidence }; }
function warn(rule, policy, rationale, evidence) { return { rule, policy, decision: 'Warn', rationale, evidence }; }
function allow(rule, policy, rationale, evidence) { return { rule, policy, decision: 'Allow', rationale, evidence }; }
function stateFromLifecycle(s) { return ({ Template: 'Draft', Specified: 'Active', Ratified: 'Ratified', Superseded: 'Superseded', Archived: 'Archived' })[s] || 'Active'; }

// ---------------------------------------------------------------------------
// Evaluation (§3 + §6 evidence)
// ---------------------------------------------------------------------------
function evaluate(req, ctx, policies) {
  const t = ctx.registry.get(req.target) || ctx.byPath.get(req.target) || null;
  const fired = [];
  for (const p of policies) {
    let v = null;
    try { v = p.run(req, t, ctx); } catch (e) { v = warn(p.id, p.map, `policy error: ${e.message}`, {}); }
    if (v) fired.push(v);
  }
  const denies = fired.filter((f) => f.decision === 'Deny');
  const warns = fired.filter((f) => f.decision === 'Warn');
  const decision = denies.length ? 'Deny' : (warns.length ? 'Allow With Warning' : 'Allow');
  const rationale = denies.length ? denies.map((d) => d.rationale) : (warns.length ? warns.map((w) => w.rationale) : ['permitted by policy']);
  const evidence = {
    requestedOperation: req.operation,
    affectedArtifacts: t ? [{ id: t.canonicalId, location: t.location, state: stateOf(t), version: t.version }] : [{ target: req.target, state: 'none' }],
    governingPolicies: [...new Set(fired.map((f) => f.policy))],
    evaluatedRules: fired.map((f) => ({ rule: f.rule, decision: f.decision, rationale: f.rationale, evidence: f.evidence })),
    decision, rationale,
  };
  // Deterministic evidence digest — excludes any timestamp.
  const evidenceDigest = hash(JSON.stringify([req.operation, req.target, req.changes || null, req.viaAmendment || null, decision, evidence.evaluatedRules.map((r) => [r.rule, r.decision])]));
  return { ...evidence, evidenceDigest };
}

// ---------------------------------------------------------------------------
// Append-only ledger (§7)
// ---------------------------------------------------------------------------
function ledgerCount(file) {
  if (!existsSync(file)) return 0;
  const c = readFileSync(file, 'utf8').trim();
  return c ? c.split(/\n/).length : 0;
}
function appendLedger(file, result, seq) {
  if (!existsSync(path.dirname(file))) mkdirSync(path.dirname(file), { recursive: true });
  const entry = {
    id: `MUT-${String(seq).padStart(6, '0')}-${result.evidenceDigest}`,
    timestamp: new Date().toISOString(),
    operation: result.requestedOperation,
    target: result.affectedArtifacts[0]?.id || result.affectedArtifacts[0]?.target,
    decision: result.decision,
    evidenceDigest: result.evidenceDigest,
  };
  appendFileSync(file, JSON.stringify(entry) + '\n');   // append-only; never rewrites prior lines
  return entry;
}

// ---------------------------------------------------------------------------
// Extension model (§9): additive policies from ./policies/*.mjs
// ---------------------------------------------------------------------------
function loadPolicyExtensions() {
  const dir = path.join(__dirname, 'policies');
  const extra = [];
  if (!existsSync(dir)) return extra;
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.mjs')) continue;
    try { const m = pathToFileURL(path.join(dir, name)).href; extra.push({ href: m }); } catch { /* ignore */ }
  }
  return extra;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------
function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; }

const DEMO_REQUESTS = [
  { label: 'allowed (additive create)', operation: 'create', target: 'GOV-AUTO-009', artifact: { canonicalId: 'GOV-AUTO-009', governingParent: 'GOV-IMPL-001' } },
  { label: 'denied (edit ratified constitution)', operation: 'update', target: 'DESIGN-002', changes: { classification: 'Revised' } },
  { label: 'warning (dependency removal on active spec)', operation: 'update', target: 'GOV-AUTO-005', changes: { dependencies: [] } },
  { label: 'constitutional protection (delete ADR)', operation: 'delete', target: 'ADR-004' },
  { label: 'frozen artifact rejection (edit audit)', operation: 'update', target: 'AUDIT-001', changes: { owner: 'someone' } },
  { label: 'version regression', operation: 'version', target: 'GOV-AUTO-002', version: '0.9.0' },
  { label: 'approved constitutional path (supersede via amendment)', operation: 'supersede', target: 'DESIGN-002', viaAmendment: 'AMENDMENT-002' },
  { label: 'amendment violation (non-contiguous supersede)', operation: 'supersede', target: 'ADR-003', viaAmendment: 'AMENDMENT-007' },
];

async function main() {
  const asJson = process.argv.includes('--json');
  const noLedger = process.argv.includes('--no-ledger');
  const ledgerFile = path.resolve(arg('--ledger') || DEFAULT_LEDGER);

  const t0 = performance.now();
  const tc = performance.now();
  const wp03 = consume(WP03);
  const wp04 = consume(WP04);
  const consumeMs = +(performance.now() - tc).toFixed(1);

  // Build context from consumed registries (no discovery here).
  const registry = new Map();
  const byPath = new Map();
  for (const a of wp03.artifacts) { if (a.edition !== 'full') registry.set(a.canonicalId, a); byPath.set(a.location, a); }
  const amendmentNums = wp03.artifacts.map((a) => (a.canonicalId.match(/^AMENDMENT-(\d{3})$/) || [])[1]).filter(Boolean).map(Number);
  const nextAmendment = (amendmentNums.length ? Math.max(...amendmentNums) : 0) + 1;
  const ctx = {
    registry, byPath, nextAmendment,
    posture: wp04.posture, validation: wp04.sources?.documentationValidation,
    amendmentValid: (req) => !!req.viaAmendment && req.viaAmendment === `AMENDMENT-${String(nextAmendment).padStart(3, '0')}`,
  };

  const policies = buildPolicies();
  // (extension seam present; discovered policy files would be appended here)
  loadPolicyExtensions();

  let requests = [];
  if (process.argv.includes('--demo')) requests = DEMO_REQUESTS;
  else if (arg('--requests')) requests = JSON.parse(readFileSync(path.resolve(arg('--requests')), 'utf8'));
  else if (arg('--request')) requests = [JSON.parse(arg('--request'))];
  else requests = DEMO_REQUESTS;

  const tp = performance.now();
  const results = requests.map((r) => ({ label: r.label, request: r, ...evaluate(r, ctx, policies) }));
  const policyMs = +(performance.now() - tp).toFixed(1);

  let seq = noLedger ? null : ledgerCount(ledgerFile);
  const ledgerEntries = [];
  if (!noLedger) for (const r of results) ledgerEntries.push(appendLedger(ledgerFile, r, seq++));

  const approvals = results.filter((r) => r.decision === 'Allow').length;
  const warnings = results.filter((r) => r.decision === 'Allow With Warning').length;
  const denials = results.filter((r) => r.decision === 'Deny').length;

  const report = {
    tool: 'governance-freeze-runtime', runtimeVersion: '1.0.0', mapsTo: 'GOV-AUTO-003',
    consumes: { wp03: 'GOV-AUTO-002 census', wp04: 'GOV-AUTO-008 posture (encapsulates WP-02)' },
    posture: ctx.posture.classification, upstreamValidation: ctx.validation,
    observability: {
      requestsEvaluated: results.length, approvals, warnings, denials,
      consumeMs, policyMs, runtimeMs: +(performance.now() - t0).toFixed(1),
      heapUsedMB: +(process.memoryUsage().heapUsed / 1048576).toFixed(1),
      policiesRegistered: policies.length, ledger: noLedger ? null : path.relative(REPO_ROOT, ledgerFile),
    },
    evaluations: results,
    ...(ledgerEntries.length ? { ledgerEntries } : {}),
  };

  if (asJson) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  else {
    const L = [];
    L.push('Governance Freeze & Mutation Guard Runtime — GOV-AUTO-003 (canonical)');
    L.push(`consumes: WP-03 census + WP-04 posture (${report.posture})  ·  policies: ${policies.length}`);
    L.push(`\nrequests: ${results.length}   allow: ${approvals}   allow-with-warning: ${warnings}   deny: ${denials}`);
    L.push('');
    for (const r of results) {
      const tag = r.decision === 'Deny' ? 'DENY' : (r.decision === 'Allow With Warning' ? 'WARN' : 'ALLOW');
      L.push(`  [${tag.padEnd(5)}] ${r.label}`);
      L.push(`          op=${r.requestedOperation} target=${r.request.target}  digest=${r.evidenceDigest}`);
      L.push(`          ${r.rationale.join('; ')}`);
    }
    if (ledgerEntries.length) { L.push(`\nledger (append-only): +${ledgerEntries.length} entries → ${report.observability.ledger}`); L.push(`  first: ${ledgerEntries[0].id}`); }
    L.push(`\nobservability: ${report.observability.runtimeMs}ms (consume ${consumeMs}ms, policy ${policyMs}ms)  heap ${report.observability.heapUsedMB}MB`);
    process.stdout.write(L.join('\n') + '\n');
  }
  process.exit(0); // the guard reports decisions; it does not fail the process on a Deny verdict
}

main();
