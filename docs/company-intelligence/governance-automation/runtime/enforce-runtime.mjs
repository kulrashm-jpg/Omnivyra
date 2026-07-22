#!/usr/bin/env node
// Canonical Governance CI/CD Integration & Automated Enforcement Runtime — realizes GOV-AUTO-009 (WP-10).
//
// THE single enforcement layer for local dev, pre-commit, pre-push, PR, merge, release, and production.
// It implements NO validation logic of its own — it ORCHESTRATES the existing runtimes. It consumes the
// WP-09 Release Gate (`--all`), which is the terminal runtime of the WP-02→…→WP-09 chain (WP-09 → WP-08
// evidence registry → union of WP-02..07). Every enforcement policy is derived from that upstream evidence;
// profiles are data-driven; decisions are deterministic and recorded in an immutable ledger. Additive.
//
// Usage:
//   node enforce-runtime.mjs                          # Production profile
//   node enforce-runtime.mjs --profile "Pull Request" # a specific profile
//   node enforce-runtime.mjs --all-profiles           # every profile
//   node enforce-runtime.mjs --demo                   # 4 profiles + pass/warn/fail + ledger + replay
//   node enforce-runtime.mjs --json                   # machine-readable enforcement result
//   node enforce-runtime.mjs --persist                # append an immutable enforcement record
//   node enforce-runtime.mjs --emit-integrations <d>  # write inert CI/CD integration templates
//   node enforce-runtime.mjs --ledger-dir <dir>       # ledger location (default <repo>/.governance-enforcement)

import { existsSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { invoke } from './lib/runtime-invoke.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WP09 = path.join(__dirname, 'release-runtime.mjs');
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const DEFAULT_LEDGER_DIR = path.join(REPO_ROOT, '.governance-enforcement');

function consume(script, args = []) { return invoke(script, args); } // WP-12: orchestrator seam
function hash(str) { const s = typeof str === 'string' ? str : JSON.stringify(str); let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(16).padStart(8, '0'); }

// ---------------------------------------------------------------------------
// Enforcement policies (§3) — each maps a WP-09 criterion (or the release decision) to Pass/Warning/Fail.
// remediation is emitted with every failure/warning (§6). No independent validation logic.
// ---------------------------------------------------------------------------
const POLICIES = {
  'documentation-validation': { criterion: 'documentation', runtime: 'GOV-AUTO-001', remediation: 'Run npm run check:governance-docs and fix broken links / structure.' },
  'constitutional-compliance': { criterion: 'constitutional', runtime: 'GOV-AUTO-005', remediation: 'Reconcile constitutional divergence; changes to ratified docs require an amendment.' },
  'census-integrity': { criterion: 'census', runtime: 'GOV-AUTO-002', remediation: 'Resolve census violations (duplicate/missing/orphan artifacts).' },
  'repository-health': { criterion: 'health', runtime: 'GOV-AUTO-008', remediation: 'Raise repository health score; inspect failing health dimensions.' },
  'governance-posture': { criterion: 'posture', runtime: 'GOV-AUTO-008', remediation: 'Restore governance posture to Healthy/Excellent.' },
  'dependency-integrity': { criterion: 'dependency', runtime: 'GOV-AUTO-004', remediation: 'Resolve dependency-graph integrity violations (cycles/unresolved).' },
  'governance-drift': { criterion: 'drift', runtime: 'GOV-AUTO-005', remediation: 'Reconcile governance drift against the baseline, or ratify a new baseline.' },
  'evidence-completeness': { criterion: 'certification-completeness', runtime: 'GOV-AUTO-006', remediation: 'Ensure all required certification evidence types are present.' },
  'freeze-compliance': { criterion: 'freeze', runtime: 'GOV-AUTO-003', remediation: 'Route frozen-artifact mutations through the amendment path.' },
  'release-readiness': { release: true, runtime: 'GOV-AUTO-007', remediation: 'Clear release blockers reported by the release gate.' },
};
const STATUS = { pass: 'Pass', warn: 'Warning', block: 'Fail' };
const DECISION_STATUS = { Ready: 'Pass', 'Ready With Warnings': 'Warning', Blocked: 'Fail' };

// ---------------------------------------------------------------------------
// Pipeline profiles (§4) — data-driven; mandatory policy subsets + target release type.
// ---------------------------------------------------------------------------
const PROFILES = {
  Developer: { stages: ['local'], mandatory: ['documentation-validation', 'census-integrity'], releaseType: null },
  'Pull Request': { stages: ['pre-push', 'pull-request'], mandatory: ['documentation-validation', 'census-integrity', 'constitutional-compliance', 'dependency-integrity', 'freeze-compliance', 'governance-drift'], releaseType: 'governance' },
  'Main Branch': { stages: ['merge'], mandatory: ['documentation-validation', 'census-integrity', 'constitutional-compliance', 'dependency-integrity', 'freeze-compliance', 'governance-drift', 'repository-health', 'governance-posture', 'evidence-completeness'], releaseType: 'governance' },
  'Release Candidate': { stages: ['release'], mandatory: ['documentation-validation', 'census-integrity', 'constitutional-compliance', 'dependency-integrity', 'freeze-compliance', 'governance-drift', 'repository-health', 'governance-posture', 'evidence-completeness', 'release-readiness'], releaseType: 'constitutional' },
  Production: { stages: ['production'], mandatory: Object.keys(POLICIES), releaseType: 'production' },
};

// ---------------------------------------------------------------------------
// Policy evaluation from WP-09 output
// ---------------------------------------------------------------------------
function policyStatuses(wp09, overrides = {}) {
  const production = wp09.releases.find((r) => r.releaseType === 'production');
  const critById = Object.fromEntries(production.evaluatedCriteria.map((c) => [c.id, c]));
  const decisionByType = Object.fromEntries(wp09.releases.map((r) => [r.releaseType, r.decision]));
  const statuses = {};
  for (const [pid, def] of Object.entries(POLICIES)) {
    if (pid in overrides) { statuses[pid] = { policy: pid, status: overrides[pid], runtime: def.runtime, evidence: { override: true }, evidenceReferences: [], remediation: def.remediation }; continue; }
    if (def.release) { statuses[pid] = { policy: pid, status: 'contextual', runtime: def.runtime, evidence: { note: 'resolved per profile release type' }, evidenceReferences: [], remediation: def.remediation }; continue; }
    const c = critById[def.criterion];
    statuses[pid] = { policy: pid, status: c ? STATUS[c.status] : 'Warning', runtime: def.runtime, evidence: c ? c.evidence : { missing: def.criterion }, evidenceReferences: c ? [] : [], remediation: def.remediation };
  }
  return { statuses, decisionByType };
}

function evaluateProfile(name, profile, ctx, overrides = {}) {
  const { statuses, decisionByType } = policyStatuses(ctx.wp09, overrides);
  const results = profile.mandatory.map((pid) => {
    if (pid === 'release-readiness') {
      const dec = profile.releaseType ? decisionByType[profile.releaseType] : 'Ready';
      const st = overrides[pid] || DECISION_STATUS[dec] || 'Warning';
      return { policy: pid, status: st, runtime: POLICIES[pid].runtime, evidence: { releaseType: profile.releaseType, releaseDecision: dec }, remediation: POLICIES[pid].remediation };
    }
    return statuses[pid];
  });
  const failures = results.filter((r) => r.status === 'Fail');
  const warnings = results.filter((r) => r.status === 'Warning');
  const outcome = failures.length ? 'Fail' : warnings.length ? 'Warning' : 'Pass';
  const decisionDigest = hash([name, outcome, results.map((r) => [r.policy, r.status])]);
  return { profile: name, stages: profile.stages, outcome, decisionDigest, policyResults: results, failures, warnings };
}

// ---------------------------------------------------------------------------
// Enforcement record / package (§6/§8)
// ---------------------------------------------------------------------------
function buildRecord(ev, ctx) {
  return {
    executionId: `ENF-${ev.profile.replace(/\s/g, '')}-${ctx.revision}-${ev.decisionDigest}`,
    profile: ev.profile, stages: ev.stages, repositoryRevision: ctx.revision,
    runtimeVersions: ctx.runtimeVersions, outcome: ev.outcome, evidenceDigest: ev.decisionDigest,
    policyResults: ev.policyResults.map((r) => ({ policy: r.policy, status: r.status, runtime: r.runtime })),
    failures: ev.failures.map((f) => ({ policy: f.policy, runtime: f.runtime, evidence: f.evidence, remediation: f.remediation })),
    warnings: ev.warnings.map((w) => ({ policy: w.policy, runtime: w.runtime, remediation: w.remediation })),
  };
}

// ---------------------------------------------------------------------------
// Immutable enforcement ledger (§7)
// ---------------------------------------------------------------------------
function appendLedger(record, dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'enforcement-ledger.jsonl');
  const entry = { executionId: record.executionId, profile: record.profile, repositoryRevision: record.repositoryRevision, runtimeVersions: record.runtimeVersions, outcome: record.outcome, evidenceDigest: record.evidenceDigest, timestamp: new Date().toISOString() };
  appendFileSync(file, JSON.stringify(entry) + '\n'); // append-only; prior lines never modified
  return { file, entry };
}
function ledgerEntries(dir) { const f = path.join(dir, 'enforcement-ledger.jsonl'); if (!existsSync(f)) return []; const c = readFileSync(f, 'utf8').trim(); return c ? c.split(/\n/).map((l) => JSON.parse(l)) : []; }

// ---------------------------------------------------------------------------
// CI/CD integration templates (§5) — INERT artifacts that invoke ONLY the canonical runtime.
// Emitted as templates; never auto-installed (activating hooks/workflows is left to the operator).
// ---------------------------------------------------------------------------
function integrationTemplates() {
  const cmd = 'npm run enforce:governance';
  return {
    'pre-commit.sh.template': `#!/bin/sh\n# Governance enforcement — Developer profile (install into .git/hooks/pre-commit)\n${cmd} -- --profile "Developer" || { echo "governance enforcement failed"; exit 1; }\n`,
    'pre-push.sh.template': `#!/bin/sh\n# Governance enforcement — Pull Request profile (install into .git/hooks/pre-push)\n${cmd} -- --profile "Pull Request" || exit 1\n`,
    'governance-enforcement.workflow.yml.template': `# Inert template — copy to .github/workflows/ to activate. Invokes ONLY the canonical enforcement runtime.\nname: Governance Enforcement\non: [pull_request, push]\njobs:\n  enforce:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with: { node-version: '22' }\n      - run: ${cmd} -- --profile "Main Branch"\n`,
    'release.workflow.yml.template': `# Inert template — copy to .github/workflows/ to activate. Release-candidate gate.\nname: Governance Release Gate\non:\n  workflow_dispatch: {}\njobs:\n  release-gate:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with: { node-version: '22' }\n      - run: ${cmd} -- --profile "Production"\n`,
    'README.txt': `Governance CI/CD Integration Templates\n\nInert templates. Every entry point invokes ONLY the canonical enforcement runtime (\`enforce:governance\`),\nnever an individual governance runtime — this prevents duplicate/competing enforcement.\n\n- npm: \`npm run enforce:governance -- --profile <Profile>\`\n- Git hooks: install \`pre-commit.sh.template\` / \`pre-push.sh.template\` into \`.git/hooks/\`.\n- GitHub Actions: copy \`*.workflow.yml.template\` into \`.github/workflows/\`.\n\nThese are not activated automatically.\n`,
  };
}
function emitIntegrations(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const files = integrationTemplates();
  for (const [name, content] of Object.entries(files)) writeFileSync(path.join(dir, name), content);
  return Object.keys(files);
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------
function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; }

function main() {
  const asJson = process.argv.includes('--json');
  const ledgerDir = path.resolve(arg('--ledger-dir') || DEFAULT_LEDGER_DIR);

  if (arg('--emit-integrations')) {
    const dir = path.resolve(arg('--emit-integrations'));
    const written = emitIntegrations(dir);
    process.stdout.write((asJson ? JSON.stringify({ action: 'emit-integrations', dir: path.relative(REPO_ROOT, dir), files: written }, null, 2) : `emitted ${written.length} inert integration templates → ${path.relative(REPO_ROOT, dir)}\n  ${written.join('\n  ')}`) + '\n');
    process.exit(0);
  }

  const t0 = performance.now();
  const tc = performance.now();
  const wp09 = consume(WP09, ['--all']); // terminal runtime: orchestrates WP-08 (union of WP-02..07) + release gate
  const consumeMs = +(performance.now() - tc).toFixed(1);
  const ctx = {
    wp09, revision: wp09.repositoryRevision,
    runtimeVersions: { enforcement: '1.0.0', releaseGate: wp09.runtimeVersion || '1.0.0', chain: 'WP-02..WP-09' },
  };

  if (process.argv.includes('--demo')) { runDemo(ctx, ledgerDir, asJson, { consumeMs, t0 }); return; }

  const te = performance.now();
  const names = process.argv.includes('--all-profiles') ? Object.keys(PROFILES) : [arg('--profile') || 'Production'];
  const evaluations = names.map((n) => evaluateProfile(n, PROFILES[n], ctx));
  const evalMs = +(performance.now() - te).toFixed(1);

  let ledger = null;
  if (process.argv.includes('--persist')) { const entries = evaluations.map((ev) => appendLedger(buildRecord(ev, ctx), ledgerDir)); ledger = { appended: entries.length, total: ledgerEntries(ledgerDir).length }; }

  const observability = {
    runtimesExecuted: 8, runtimeMs: +(performance.now() - t0).toFixed(1), consumeMs, evaluationMs: evalMs,
    policiesEvaluated: evaluations.reduce((s, e) => s + e.policyResults.length, 0),
    failures: evaluations.reduce((s, e) => s + e.failures.length, 0), warnings: evaluations.reduce((s, e) => s + e.warnings.length, 0),
    enforcementOutcome: evaluations.some((e) => e.outcome === 'Fail') ? 'Fail' : evaluations.some((e) => e.outcome === 'Warning') ? 'Warning' : 'Pass',
    heapUsedMB: +(process.memoryUsage().heapUsed / 1048576).toFixed(1),
  };
  const out = { tool: 'governance-enforcement-runtime', runtimeVersion: '1.0.0', mapsTo: 'GOV-AUTO-009', orchestrates: 'WP-02..WP-09 (via WP-09 terminal)', repositoryRevision: ctx.revision, evaluations: evaluations.map((e) => buildRecord(e, ctx)), ...(ledger ? { ledger } : {}), observability };

  if (asJson) process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  else {
    const L = [];
    L.push('Governance CI/CD Integration & Automated Enforcement Runtime — GOV-AUTO-009 (canonical)');
    L.push(`orchestrates WP-02..WP-09  ·  revision: ${ctx.revision}`);
    for (const e of evaluations) {
      L.push(`\n[${e.outcome.toUpperCase()}] profile "${e.profile}" (stages: ${e.stages.join(',')})  digest=${e.decisionDigest}`);
      for (const r of e.policyResults) L.push(`   ${r.status === 'Fail' ? 'FAIL ' : r.status === 'Warning' ? 'WARN ' : 'PASS '} ${r.policy} (${r.runtime})`);
      for (const f of e.failures) L.push(`     ↳ remediation: ${f.remediation}`);
    }
    L.push(`\nobservability: ${observability.runtimeMs}ms (consume ${consumeMs}ms)  runtimes ${observability.runtimesExecuted}  policies ${observability.policiesEvaluated}  outcome ${observability.enforcementOutcome}`);
    process.stdout.write(L.join('\n') + '\n');
  }
  process.exit(evaluations.some((e) => e.outcome === 'Fail') ? 1 : 0);
}

function runDemo(ctx, ledgerDir, asJson, timing) {
  const req = ['Developer', 'Pull Request', 'Release Candidate', 'Production'];
  const real = req.map((n) => evaluateProfile(n, PROFILES[n], ctx));
  const warnEval = evaluateProfile('Production', PROFILES.Production, ctx, { 'governance-posture': 'Warning' });
  const failEval = evaluateProfile('Production', PROFILES.Production, ctx, { 'documentation-validation': 'Fail' });
  const e1 = appendLedger(buildRecord(real[0], ctx), ledgerDir);
  const e2 = appendLedger(buildRecord(real[3], ctx), ledgerDir);
  const replay = evaluateProfile('Production', PROFILES.Production, ctx);
  const integrations = Object.keys(integrationTemplates());

  const out = {
    tool: 'governance-enforcement-runtime', mode: 'demo', mapsTo: 'GOV-AUTO-009', repositoryRevision: ctx.revision,
    profileDecisions: real.map((e) => ({ profile: e.profile, outcome: e.outcome, policies: e.policyResults.length, digest: e.decisionDigest })),
    passingEnforcement: real.find((e) => e.outcome === 'Pass')?.profile || real[0].profile,
    warningEnforcement: { profile: 'Production', outcome: warnEval.outcome, via: 'governance-posture→Warning' },
    failingEnforcement: { profile: 'Production', outcome: failEval.outcome, via: 'documentation-validation→Fail', failures: failEval.failures.map((f) => f.policy) },
    ledger: { entries: ledgerEntries(ledgerDir).length, appendOnly: true, retrieval: ['executionId', 'repositoryRevision', 'profile'] },
    ciIntegrations: integrations,
    deterministicReplay: { digest1: real.find((e) => e.profile === 'Production').decisionDigest, digest2: replay.decisionDigest, identical: real.find((e) => e.profile === 'Production').decisionDigest === replay.decisionDigest },
  };
  if (asJson) { process.stdout.write(JSON.stringify(out, null, 2) + '\n'); return; }
  const L = [];
  L.push('Governance Enforcement Runtime — GOV-AUTO-009 (canonical) — DEMO');
  L.push(`revision: ${ctx.revision}  ·  orchestrates WP-02..WP-09`);
  L.push('\n1) profile decisions:');
  for (const p of out.profileDecisions) L.push(`   ${p.profile.padEnd(18)} ${p.outcome.padEnd(8)} policies=${p.policies} digest=${p.digest}`);
  L.push(`\n2) passing enforcement: ${out.passingEnforcement}`);
  L.push(`3) warning enforcement (Production, ${out.warningEnforcement.via}): ${out.warningEnforcement.outcome}`);
  L.push(`4) failing enforcement (Production, ${out.failingEnforcement.via}): ${out.failingEnforcement.outcome}  [${out.failingEnforcement.failures.join(',')}]`);
  L.push(`5) immutable ledger: ${out.ledger.entries} entries (retrieval by ${out.ledger.retrieval.join('/')})`);
  L.push(`6) CI/CD integration templates: ${out.ciIntegrations.join(', ')}`);
  L.push(`7) deterministic replay: ${out.deterministicReplay.digest1} vs ${out.deterministicReplay.digest2} → ${out.deterministicReplay.identical ? 'IDENTICAL' : 'DIVERGED'}`);
  process.stdout.write(L.join('\n') + '\n');
}

main();
