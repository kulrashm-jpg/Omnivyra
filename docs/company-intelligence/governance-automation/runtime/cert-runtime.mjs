#!/usr/bin/env node
// Canonical Governance Self-Certification & Repository Accreditation Runtime — realizes GOV-AUTO-010 (WP-11).
//
// THE single certification authority for the repository. It consumes ONLY WP-09 (release gate) and WP-10
// (enforcement) — every earlier runtime's evidence arrives transitively (WP-10→WP-09→WP-08→WP-02..07),
// so no earlier runtime is invoked directly and nothing is re-computed. It derives 10 certification
// criteria from that upstream evidence, computes an objective accreditation level (Bronze/Silver/Gold/
// Platinum), issues a deterministic certification decision + machine-readable certificate, and records
// immutable certification history. Additive; single-runtime doctrine.
//
// Usage:
//   node cert-runtime.mjs                        # repository certification
//   node cert-runtime.mjs --release              # release certification
//   node cert-runtime.mjs --demo                 # 3 decisions + 4 levels + certificates + ledger + replay
//   node cert-runtime.mjs --json                 # machine-readable certificate
//   node cert-runtime.mjs --persist              # append an immutable certification record
//   node cert-runtime.mjs --ledger-dir <dir>     # ledger location (default <repo>/.governance-certification)

import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { invoke } from './lib/runtime-invoke.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WP09 = path.join(__dirname, 'release-runtime.mjs');
const WP10 = path.join(__dirname, 'enforce-runtime.mjs');
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const DEFAULT_LEDGER_DIR = path.join(REPO_ROOT, '.governance-certification');

function consume(script, args = []) { return invoke(script, args); } // WP-12: orchestrator seam
function hash(str) { const s = typeof str === 'string' ? str : JSON.stringify(str); let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(16).padStart(8, '0'); }

// ---------------------------------------------------------------------------
// Certification criteria (§4) — each derived from WP-09 / WP-10 evidence.
// ---------------------------------------------------------------------------
const CRITERIA_DEFS = [
  { id: 'constitutional-compliance', runtime: 'GOV-AUTO-005', from: 'wp09:constitutional' },
  { id: 'documentation-quality', runtime: 'GOV-AUTO-001', from: 'wp09:documentation' },
  { id: 'repository-health', runtime: 'GOV-AUTO-008', from: 'wp09:health' },
  { id: 'governance-maturity', runtime: 'GOV-AUTO-008', from: 'computed:maturity' },
  { id: 'enforcement-status', runtime: 'GOV-AUTO-009', from: 'wp10:production' },
  { id: 'release-readiness', runtime: 'GOV-AUTO-007', from: 'wp09:release-production' },
  { id: 'evidence-completeness', runtime: 'GOV-AUTO-006', from: 'wp09:certification-completeness' },
  { id: 'dependency-integrity', runtime: 'GOV-AUTO-004', from: 'wp09:dependency' },
  { id: 'governance-drift', runtime: 'GOV-AUTO-005', from: 'wp09:drift' },
  { id: 'continuous-compliance', runtime: 'GOV-AUTO-005', from: 'wp09:compliance' },
];
const CRIT_STATUS = { pass: 'pass', warn: 'warn', block: 'fail' };
const DEC_STATUS = { Ready: 'pass', 'Ready With Warnings': 'warn', Blocked: 'fail' };
const ENF_STATUS = { Pass: 'pass', Warning: 'warn', Fail: 'fail' };
const POINTS = { pass: 10, warn: 5, fail: 0 };

function buildCriteria(wp09, wp10, overrides = {}) {
  const production = wp09.releases.find((r) => r.releaseType === 'production');
  const critById = Object.fromEntries(production.evaluatedCriteria.map((c) => [c.id, c]));
  const passing = production.evaluatedCriteria.filter((c) => c.status === 'pass').length;
  const maturity = Math.round((passing / production.evaluatedCriteria.length) * 100);
  const prodEnforcement = (wp10.evaluations.find((e) => e.profile === 'Production') || {}).outcome || 'Warning';

  return CRITERIA_DEFS.map((def) => {
    let status, evidence;
    if (def.id in overrides) { status = overrides[def.id]; evidence = { override: true }; }
    else if (def.from.startsWith('wp09:') && def.from !== 'wp09:release-production') {
      const c = critById[def.from.split(':')[1]];
      status = c ? CRIT_STATUS[c.status] : 'warn'; evidence = c ? c.evidence : { missing: def.from };
    } else if (def.from === 'wp09:release-production') { status = DEC_STATUS[production.decision] || 'warn'; evidence = { releaseDecision: production.decision }; }
    else if (def.from === 'wp10:production') { status = ENF_STATUS[prodEnforcement] || 'warn'; evidence = { enforcementOutcome: prodEnforcement }; }
    else if (def.from === 'computed:maturity') { status = maturity >= 90 ? 'pass' : maturity >= 70 ? 'warn' : 'fail'; evidence = { governanceMaturity: maturity }; }
    return { criterion: def.id, originatingRuntime: def.runtime, status, supportingEvidence: evidence, accreditationImpact: POINTS[status] };
  });
}

// ---------------------------------------------------------------------------
// Accreditation engine (§3) — objective scoring → level.
// ---------------------------------------------------------------------------
function accredit(criteria) {
  const score = criteria.reduce((s, c) => s + c.accreditationImpact, 0); // 0..100
  const level = score >= 95 ? 'Platinum' : score >= 85 ? 'Gold' : score >= 70 ? 'Silver' : score >= 50 ? 'Bronze' : 'None';
  return { score, level };
}

// ---------------------------------------------------------------------------
// Certification decision engine (§2)
// ---------------------------------------------------------------------------
function certify(criteria) {
  const fails = criteria.filter((c) => c.status === 'fail');
  const warns = criteria.filter((c) => c.status === 'warn');
  const decision = fails.length ? 'Certification Denied' : warns.length ? 'Certified With Conditions' : 'Certified';
  return { decision, fails, warns };
}

// ---------------------------------------------------------------------------
// Certificate generation (§5)
// ---------------------------------------------------------------------------
function makeCertificate(kind, criteria, wp09, wp10, evidenceDigests) {
  const { score, level } = accredit(criteria);
  const { decision } = certify(criteria);
  const effLevel = decision === 'Certification Denied' ? 'None' : level;
  const decisionDigest = hash([kind, decision, effLevel, criteria.map((c) => [c.criterion, c.status])]);
  return {
    certificateId: `CERT-${kind}-${effLevel}-${wp09.repositoryRevision}-${decisionDigest}`,
    kind, accreditationLevel: effLevel, accreditationScore: score, certificationDecision: decision,
    repositoryRevision: wp09.repositoryRevision, certificationTimestamp: new Date().toISOString(),
    supportingEvidence: criteria.map((c) => ({ criterion: c.criterion, status: c.status, originatingRuntime: c.originatingRuntime, evidence: c.supportingEvidence })),
    evidenceDigests, decisionDigest,
    certificationValidity: { boundTo: 'repositoryRevision', revision: wp09.repositoryRevision, note: 'valid while the repository revision is unchanged; re-certify on any change' },
    certificationSummary: `${decision} — ${effLevel} (score ${score}/100) for revision ${wp09.repositoryRevision}`,
  };
}

// ---------------------------------------------------------------------------
// Immutable certification ledger (§6)
// ---------------------------------------------------------------------------
function appendLedger(cert, runtimeVersions, dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'certification-ledger.jsonl');
  const entry = { certificateId: cert.certificateId, accreditationLevel: cert.accreditationLevel, repositoryRevision: cert.repositoryRevision, runtimeVersions, evidenceDigest: cert.decisionDigest, decision: cert.certificationDecision, timestamp: new Date().toISOString() };
  appendFileSync(file, JSON.stringify(entry) + '\n'); // append-only; prior lines never modified
  return entry;
}
function ledgerEntries(dir) { const f = path.join(dir, 'certification-ledger.jsonl'); if (!existsSync(f)) return []; const c = readFileSync(f, 'utf8').trim(); return c ? c.split(/\n/).map((l) => JSON.parse(l)) : []; }

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------
function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; }

function main() {
  const asJson = process.argv.includes('--json');
  const ledgerDir = path.resolve(arg('--ledger-dir') || DEFAULT_LEDGER_DIR);

  const t0 = performance.now();
  const tc = performance.now();
  const wp09 = consume(WP09, ['--all']);          // release gate (terminal of WP-02..08 chain)
  const wp10 = consume(WP10, ['--all-profiles']); // enforcement (orchestrates WP-09)
  const consumeMs = +(performance.now() - tc).toFixed(1);

  const runtimeVersions = { certification: '1.0.0', releaseGate: wp09.runtimeVersion || '1.0.0', enforcement: wp10.runtimeVersion || '1.0.0', chain: 'WP-02..WP-10' };
  const evidenceDigests = { repositoryRevision: wp09.repositoryRevision, releaseProduction: wp09.releases.find((r) => r.releaseType === 'production').decisionDigest, enforcementProduction: (wp10.evaluations.find((e) => e.profile === 'Production') || {}).evidenceDigest };

  if (process.argv.includes('--demo')) { runDemo(wp09, wp10, evidenceDigests, runtimeVersions, ledgerDir, asJson, t0); return; }

  const te = performance.now();
  const kind = process.argv.includes('--release') ? 'release' : 'repository';
  const criteria = buildCriteria(wp09, wp10);
  const cert = makeCertificate(kind, criteria, wp09, wp10, evidenceDigests);
  const certifyMs = +(performance.now() - te).toFixed(1);

  let history = null;
  if (process.argv.includes('--persist')) { appendLedger(cert, runtimeVersions, ledgerDir); history = { entries: ledgerEntries(ledgerDir).length }; }

  const observability = {
    criteriaEvaluated: criteria.length, evidenceConsumed: 2, certificationMs: certifyMs, runtimeMs: +(performance.now() - t0).toFixed(1), consumeMs,
    accreditationLevel: cert.accreditationLevel, certificationOutcome: cert.certificationDecision,
    heapUsedMB: +(process.memoryUsage().heapUsed / 1048576).toFixed(1),
  };
  const out = { tool: 'governance-certification-runtime', runtimeVersion: '1.0.0', mapsTo: 'GOV-AUTO-010', consumes: { wp09: 'GOV-AUTO-007 release gate', wp10: 'GOV-AUTO-009 enforcement' }, certificate: cert, criteria, ...(history ? { history } : {}), observability };

  if (asJson) process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  else {
    const L = [];
    L.push('Governance Self-Certification & Repository Accreditation Runtime — GOV-AUTO-010 (canonical)');
    L.push(`consumes: WP-09 + WP-10 only  ·  revision: ${wp09.repositoryRevision}`);
    L.push(`\nCERTIFICATION: ${cert.certificationDecision}   ACCREDITATION: ${cert.accreditationLevel} (score ${cert.accreditationScore}/100)`);
    L.push(`certificate: ${cert.certificateId}`);
    L.push('\ncriteria:');
    for (const c of criteria) L.push(`   ${c.status === 'fail' ? 'FAIL' : c.status === 'warn' ? 'WARN' : 'PASS'}  ${c.criterion} (${c.originatingRuntime})`);
    L.push(`\nobservability: ${observability.runtimeMs}ms (consume ${consumeMs}ms)  criteria ${criteria.length}  outcome ${cert.certificationDecision}`);
    process.stdout.write(L.join('\n') + '\n');
  }
  process.exit(cert.certificationDecision === 'Certification Denied' ? 1 : 0);
}

function runDemo(wp09, wp10, evidenceDigests, runtimeVersions, ledgerDir, asJson, t0) {
  const mk = (overrides) => { const cr = buildCriteria(wp09, wp10, overrides); return { cert: makeCertificate('repository', cr, wp09, wp10, evidenceDigests), criteria: cr }; };
  // Real: all pass → Certified / Platinum.
  const real = mk({});
  // Certified With Conditions / Gold: 3 non-critical warns (score 85).
  const gold = mk({ 'governance-drift': 'warn', 'evidence-completeness': 'warn', 'governance-maturity': 'warn' });
  // Silver: 6 warns (score 70).
  const silver = mk({ 'governance-drift': 'warn', 'evidence-completeness': 'warn', 'governance-maturity': 'warn', 'repository-health': 'warn', 'continuous-compliance': 'warn', 'release-readiness': 'warn' });
  // Bronze: 10 warns (score 50).
  const bronze = mk(Object.fromEntries(CRITERIA_DEFS.map((d) => [d.id, 'warn'])));
  // Certification Denied: one criterion fails.
  const denied = mk({ 'constitutional-compliance': 'fail' });
  // Release certificate.
  const releaseCert = makeCertificate('release', buildCriteria(wp09, wp10), wp09, wp10, evidenceDigests);
  // Immutable ledger + deterministic replay.
  const e1 = appendLedger(real.cert, runtimeVersions, ledgerDir);
  const e2 = appendLedger(releaseCert, runtimeVersions, ledgerDir);
  const replay = makeCertificate('repository', buildCriteria(wp09, wp10), wp09, wp10, evidenceDigests);

  const out = {
    tool: 'governance-certification-runtime', mode: 'demo', mapsTo: 'GOV-AUTO-010', repositoryRevision: wp09.repositoryRevision,
    decisions: {
      Certified: { level: real.cert.accreditationLevel, score: real.cert.accreditationScore, decision: real.cert.certificationDecision, digest: real.cert.decisionDigest },
      CertifiedWithConditions: { level: gold.cert.accreditationLevel, score: gold.cert.accreditationScore, decision: gold.cert.certificationDecision },
      CertificationDenied: { level: denied.cert.accreditationLevel, score: denied.cert.accreditationScore, decision: denied.cert.certificationDecision },
    },
    accreditationLevels: { Platinum: real.cert.accreditationScore, Gold: gold.cert.accreditationScore, Silver: silver.cert.accreditationScore, Bronze: bronze.cert.accreditationScore },
    levelAssignments: { Platinum: real.cert.accreditationLevel, Gold: gold.cert.accreditationLevel, Silver: silver.cert.accreditationLevel, Bronze: bronze.cert.accreditationLevel },
    certificates: { repository: real.cert, release: releaseCert },
    ledger: { entries: ledgerEntries(ledgerDir).length, appendOnly: true, lookup: ['certificateId', 'repositoryRevision'] },
    deterministicReplay: { digest1: real.cert.decisionDigest, digest2: replay.decisionDigest, identical: real.cert.decisionDigest === replay.decisionDigest },
    observability: { runtimeMs: +(performance.now() - t0).toFixed(1), evidenceConsumed: 2 },
  };
  if (asJson) { process.stdout.write(JSON.stringify(out, null, 2) + '\n'); return; }
  const L = [];
  L.push('Governance Self-Certification Runtime — GOV-AUTO-010 (canonical) — DEMO');
  L.push(`revision: ${wp09.repositoryRevision}  ·  consumes WP-09 + WP-10 only`);
  L.push('\n1) certification decisions:');
  L.push(`   Certified                 → ${out.decisions.Certified.decision} / ${out.decisions.Certified.level} (score ${out.decisions.Certified.score})`);
  L.push(`   Certified With Conditions → ${out.decisions.CertifiedWithConditions.decision} / ${out.decisions.CertifiedWithConditions.level} (score ${out.decisions.CertifiedWithConditions.score})`);
  L.push(`   Certification Denied      → ${out.decisions.CertificationDenied.decision} / ${out.decisions.CertificationDenied.level} (score ${out.decisions.CertificationDenied.score})`);
  L.push('\n2) accreditation levels (objective scoring):');
  for (const [lvl, sc] of Object.entries(out.accreditationLevels)) L.push(`   ${lvl.padEnd(9)} score=${sc} → assigned ${out.levelAssignments[lvl]}`);
  L.push(`\n3) certificates: repository=${out.certificates.repository.certificateId}`);
  L.push(`                 release=${out.certificates.release.certificateId}`);
  L.push(`4) immutable ledger: ${out.ledger.entries} entries (lookup by ${out.ledger.lookup.join('/')})`);
  L.push(`5) deterministic replay: ${out.deterministicReplay.digest1} vs ${out.deterministicReplay.digest2} → ${out.deterministicReplay.identical ? 'IDENTICAL' : 'DIVERGED'}`);
  process.stdout.write(L.join('\n') + '\n');
}

main();
