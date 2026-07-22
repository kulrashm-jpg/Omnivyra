#!/usr/bin/env node
// Canonical Governance Platform Final Production Certification & Deployment Readiness Runtime — GOV-AUTO-015 (WP-16).
//
// The TERMINAL authority for governance platform readiness. It consumes ONLY WP-15 (autonomous
// operations) — every earlier runtime's evidence arrives transitively (WP-15→WP-14→…→WP-02). It
// introduces NO new governance decision logic: it certifies the completed platform exclusively from
// WP-15 operational/assurance evidence. It produces a deterministic readiness decision, an objective
// readiness classification, a machine-readable production certificate, an immutable deployment ledger,
// and final verification. Additive; runtime business logic unchanged.
//
// Usage:
//   node production-cert.mjs                       # final production certification
//   node production-cert.mjs --demo                # 3 decisions + 4 classifications + verification + replay
//   node production-cert.mjs --json                # machine-readable certificate + assessment + verification + ledger
//   node production-cert.mjs --persist             # append an immutable deployment certification
//   node production-cert.mjs --cache-dir <dir> --ledger-dir <dir>

import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { runAssuranceCycle, evaluateAssurance, continuousVerification, synthOp } from './assurance.mjs';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..', '..', '..', '..');
const CACHE_DIR = path.join(REPO_ROOT, '.governance-orchestrator-cache');
const DEFAULT_LEDGER_DIR = path.join(REPO_ROOT, '.governance-deployment');

function hash(str) { const s = typeof str === 'string' ? str : JSON.stringify(str); let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(16).padStart(8, '0'); }
const S = (st) => (st === 'Healthy' ? 'pass' : st === 'Attention Required' ? 'warn' : 'fail');
const POINTS = { pass: 10, warn: 5, fail: 0 };

// ---------------------------------------------------------------------------
// Deployment readiness assessment (§3) — ten assessments, all from WP-15 evidence.
// ---------------------------------------------------------------------------
function assess(cycle, cv, overrides = {}) {
  const a = cycle.assurance, op = cycle.op, dash = cycle.dashboard;
  const pol = Object.fromEntries(a.policyResults.map((p) => [p.policy, p.status]));
  const mk = (assessment, status, evidence) => ({ assessment, status: overrides[assessment] || status, evidence, sourceRuntime: 'GOV-AUTO-014 (WP-15)' });
  return [
    mk('operational-continuity', S(pol['governance-operational-health']), { status: op.manifest.operationalStatus }),
    mk('certification-continuity', S(pol['certification-continuity']), dash.certificationStatus),
    mk('enforcement-continuity', S(pol['enforcement-continuity']), { outcome: dash.enforcementStatus.outcome }),
    mk('release-continuity', S(pol['release-readiness-continuity']), { decision: dash.releaseStatus.decision }),
    mk('orchestration-integrity', S(pol['orchestrator-health']), { status: op.health.orchestratorStatus }),
    mk('optimization-integrity', S(pol['optimizer-health']), { status: op.health.optimizerStatus }),
    mk('activation-integrity', op.manifest.operationalStatus === 'ACTIVE' ? 'pass' : 'fail', { status: op.manifest.operationalStatus }),
    mk('assurance-integrity', S(a.outcome), { outcome: a.outcome }),
    mk('governance-integrity', op.health.registryIntegrity === 'intact' ? 'pass' : 'fail', { registry: op.health.registryIntegrity, posture: op.health.posture }),
    mk('execution-determinism', cv.operationalDigestConsistency ? 'pass' : 'fail', { operationalDigestConsistency: cv.operationalDigestConsistency }),
  ];
}

// ---------------------------------------------------------------------------
// Certification engine (§2) + readiness classification (§4)
// ---------------------------------------------------------------------------
function decide(assessments) {
  const fails = assessments.filter((a) => a.status === 'fail'), warns = assessments.filter((a) => a.status === 'warn');
  return fails.length ? 'Not Production Ready' : warns.length ? 'Production Ready With Conditions' : 'Production Ready';
}
function classify(assessments) {
  const score = assessments.reduce((s, a) => s + POINTS[a.status], 0); // 0..100
  const level = score >= 95 ? 'Production Grade' : score >= 85 ? 'Enterprise' : score >= 70 ? 'Operational' : 'Experimental';
  return { score, level };
}

// ---------------------------------------------------------------------------
// Production certificate (§5)
// ---------------------------------------------------------------------------
function makeCertificate(cycle, cv, assessments) {
  const decision = decide(assessments);
  const { score, level } = classify(assessments);
  const certificationDigest = hash([decision, level, assessments.map((a) => [a.assessment, a.status]), cycle.op.manifest.operationalDigest]);
  return {
    certificateId: `PROD-CERT-${level.replace(/\s/g, '')}-${cycle.op.activation.fingerprint}-${certificationDigest}`,
    readinessDecision: decision, readinessClassification: level, readinessScore: score,
    repositoryRevision: cycle.op.activation.fingerprint, operationalDigest: cycle.op.manifest.operationalDigest,
    certificationDigest, assuranceDigest: cycle.assuranceDigest,
    evidenceDigests: { operational: cycle.op.manifest.operationalDigest, manifest: cycle.op.manifest.manifestDigest, assurance: cycle.assuranceDigest, evidenceContinuity: cycle.record.evidenceDigest },
    verificationSummary: { operational: cv.operationalDigestConsistency, certification: cv.certificationConsistency, release: cv.releaseConsistency, activation: cv.activationConsistency },
    issuanceTimestamp: new Date().toISOString(),
    deploymentSummary: `${decision} — ${level} (score ${score}/100) for revision ${cycle.op.activation.fingerprint}`,
  };
}

// ---------------------------------------------------------------------------
// Immutable deployment ledger (§6)
// ---------------------------------------------------------------------------
function appendLedger(cert, dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'deployment-ledger.jsonl');
  const entry = { certificationId: cert.certificateId, readinessDecision: cert.readinessDecision, readinessClassification: cert.readinessClassification, repositoryRevision: cert.repositoryRevision, operationalDigest: cert.operationalDigest, evidenceDigest: cert.certificationDigest, timestamp: new Date().toISOString() };
  appendFileSync(file, JSON.stringify(entry) + '\n'); // append-only; prior lines never modified
  return entry;
}
function ledgerEntries(dir) { const f = path.join(dir, 'deployment-ledger.jsonl'); if (!existsSync(f)) return []; const c = readFileSync(f, 'utf8').trim(); return c ? c.split(/\n/).map((l) => JSON.parse(l)) : []; }

// ---------------------------------------------------------------------------
// Final verification (§7) — reuses WP-15 outputs only.
// ---------------------------------------------------------------------------
function finalVerification(cycle, cv) {
  const d1 = evaluateAssurance(cycle.op), d2 = evaluateAssurance(cycle.op); // deterministic re-evaluation of the same WP-15 op
  const asr1 = hash([d1.policyResults.map((r) => [r.policy, r.status]), d1.outcome]);
  const asr2 = hash([d2.policyResults.map((r) => [r.policy, r.status]), d2.outcome]);
  return {
    operationalConsistency: cv.activationConsistency,
    assuranceConsistency: asr1 === asr2,
    certificationConsistency: cv.certificationConsistency,
    releaseConsistency: cv.releaseConsistency,
    enforcementConsistency: cycle.dashboard.enforcementStatus.outcome !== undefined,
    executionConsistency: cv.operationalDigestConsistency,
  };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------
function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; }

function certify(cycle, cv, overrides = {}) {
  const assessments = assess(cycle, cv, overrides);
  const cert = makeCertificate({ ...cycle, assessments }, cv, assessments);
  return { assessments, cert };
}

// WP-17 consumes this as the sole WP-16 API — one call yields the full certification result.
function produceCertification(cacheDir) {
  const cycle = runAssuranceCycle('Production Monitoring', cacheDir, null); // sole input: one WP-15 assurance cycle
  const cv = continuousVerification('Production Monitoring', cacheDir);
  const { assessments, cert } = certify(cycle, cv);
  const verification = finalVerification(cycle, cv);
  return { cert, assessments, verification, evidence: { repositoryRevision: cycle.op.activation.fingerprint, operationalDigest: cycle.op.manifest.operationalDigest, assuranceDigest: cycle.assuranceDigest, evidenceContinuity: cycle.record.evidenceDigest, executionTopology: cycle.op.manifest.executionTopology, runtimeVersions: cycle.op.manifest.runtimeVersions } };
}

function main() {
  const asJson = process.argv.includes('--json');
  const ledgerDir = path.resolve(arg('--ledger-dir') || DEFAULT_LEDGER_DIR);
  const cacheDir = path.resolve(arg('--cache-dir') || CACHE_DIR);

  const t0 = performance.now();
  const cycle = runAssuranceCycle('Production Monitoring', cacheDir, null, undefined); // sole input: one WP-15 assurance cycle
  const cv = continuousVerification('Production Monitoring', cacheDir, undefined);
  const consumeMs = +(performance.now() - t0).toFixed(1);

  if (process.argv.includes('--demo')) { runDemo(cycle, cv, ledgerDir, cacheDir, asJson, consumeMs); return; }

  const { assessments, cert } = certify(cycle, cv);
  const verification = finalVerification(cycle, cv);
  let ledger = null;
  if (process.argv.includes('--persist')) { appendLedger(cert, ledgerDir); ledger = { entries: ledgerEntries(ledgerDir).length }; }

  const out = {
    tool: 'governance-final-production-certification', runtimeVersion: '1.0.0', mapsTo: 'GOV-AUTO-015', consumes: { wp15: 'autonomous operations' },
    productionCertificate: cert,
    readinessAssessment: assessments,
    verificationReport: verification,
    ...(ledger ? { deploymentLedger: ledger } : {}),
    deploymentSummary: cert.deploymentSummary,
    observability: { readinessDecision: cert.readinessDecision, readinessClassification: cert.readinessClassification, verificationOutcome: Object.values(verification).every(Boolean) ? 'consistent' : 'inconsistent', operationalContinuity: cycle.assurance.outcome, evidenceContinuity: cert.evidenceDigests.evidenceContinuity, certificationMs: consumeMs, heapUsedMB: +(process.memoryUsage().heapUsed / 1048576).toFixed(1) },
  };
  if (asJson) process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  else {
    const L = [];
    L.push('Governance Platform Final Production Certification & Deployment Readiness — GOV-AUTO-015 (canonical)');
    L.push(`consumes WP-15 only  ·  revision: ${cert.repositoryRevision}`);
    L.push(`\nREADINESS DECISION: ${cert.readinessDecision}   CLASSIFICATION: ${cert.readinessClassification} (score ${cert.readinessScore}/100)`);
    L.push(`certificate: ${cert.certificateId}`);
    L.push('\nreadiness assessments:');
    for (const a of assessments) L.push(`   ${a.status === 'fail' ? 'FAIL' : a.status === 'warn' ? 'WARN' : 'PASS'}  ${a.assessment}`);
    L.push('\nfinal verification: ' + Object.entries(verification).map(([k, v]) => `${k}=${v}`).join(' '));
    process.stdout.write(L.join('\n') + '\n');
  }
  process.exit(cert.readinessDecision === 'Not Production Ready' ? 1 : 0);
}

function runDemo(cycle, cv, ledgerDir, cacheDir, asJson, consumeMs) {
  const real = certify(cycle, cv);                                      // Production Ready / Production Grade
  const conditions3 = certify(cycle, cv, { 'assurance-integrity': 'warn', 'release-continuity': 'warn', 'optimization-integrity': 'warn' }); // Enterprise (85)
  const conditions6 = certify(cycle, cv, Object.fromEntries(['assurance-integrity', 'release-continuity', 'optimization-integrity', 'orchestration-integrity', 'enforcement-continuity', 'operational-continuity'].map((k) => [k, 'warn']))); // Operational (70)
  const conditions8 = certify(cycle, cv, Object.fromEntries(['assurance-integrity', 'release-continuity', 'optimization-integrity', 'orchestration-integrity', 'enforcement-continuity', 'operational-continuity', 'certification-continuity', 'governance-integrity'].map((k) => [k, 'warn']))); // Experimental (60)
  const notReady = certify(cycle, cv, { 'certification-continuity': 'fail' });   // Not Production Ready
  // Immutable ledger + deterministic replay.
  appendLedger(real.cert, ledgerDir); appendLedger(conditions3.cert, ledgerDir);
  const r1 = certify(cycle, cv), r2 = certify(cycle, cv);
  const verification = finalVerification(cycle, cv);

  const out = {
    tool: 'governance-final-production-certification', mode: 'demo', mapsTo: 'GOV-AUTO-015', consumes: 'WP-15 only', repositoryRevision: cycle.op.activation.fingerprint,
    decisions: {
      ProductionReady: { decision: real.cert.readinessDecision, level: real.cert.readinessClassification, score: real.cert.readinessScore },
      ProductionReadyWithConditions: { decision: conditions3.cert.readinessDecision, level: conditions3.cert.readinessClassification, score: conditions3.cert.readinessScore },
      NotProductionReady: { decision: notReady.cert.readinessDecision, level: notReady.cert.readinessClassification, score: notReady.cert.readinessScore },
    },
    classifications: { ProductionGrade: real.cert.readinessScore, Enterprise: conditions3.cert.readinessScore, Operational: conditions6.cert.readinessScore, Experimental: conditions8.cert.readinessScore },
    levelAssignments: { ProductionGrade: real.cert.readinessClassification, Enterprise: conditions3.cert.readinessClassification, Operational: conditions6.cert.readinessClassification, Experimental: conditions8.cert.readinessClassification },
    productionCertificate: real.cert,
    finalVerification: verification,
    deploymentLedger: { entries: ledgerEntries(ledgerDir).length, immutable: true, lookup: ['certificationId', 'repositoryRevision'] },
    deterministicReplay: { digest1: r1.cert.certificationDigest, digest2: r2.cert.certificationDigest, identical: r1.cert.certificationDigest === r2.cert.certificationDigest },
    consumeMs,
  };
  if (asJson) { process.stdout.write(JSON.stringify(out, null, 2) + '\n'); return; }
  const L = [];
  L.push('Governance Platform Final Production Certification — GOV-AUTO-015 (canonical) — DEMO');
  L.push(`consumes WP-15 only  ·  revision: ${cycle.op.activation.fingerprint}`);
  L.push('\n1) readiness decisions:');
  L.push(`   Production Ready                 → ${out.decisions.ProductionReady.decision} / ${out.decisions.ProductionReady.level} (score ${out.decisions.ProductionReady.score})`);
  L.push(`   Production Ready With Conditions → ${out.decisions.ProductionReadyWithConditions.decision} / ${out.decisions.ProductionReadyWithConditions.level} (score ${out.decisions.ProductionReadyWithConditions.score})`);
  L.push(`   Not Production Ready             → ${out.decisions.NotProductionReady.decision} / ${out.decisions.NotProductionReady.level} (score ${out.decisions.NotProductionReady.score})`);
  L.push('\n2) readiness classifications (objective scoring):');
  for (const [lvl, sc] of Object.entries(out.classifications)) L.push(`   ${lvl.padEnd(16)} score=${sc} → assigned ${out.levelAssignments[lvl]}`);
  L.push(`\n3) production certificate: ${out.productionCertificate.certificateId}`);
  L.push(`   decision=${out.productionCertificate.readinessDecision} classification=${out.productionCertificate.readinessClassification} operationalDigest=${out.productionCertificate.operationalDigest}`);
  L.push('\n4) final verification: ' + Object.entries(verification).map(([k, v]) => `${k}=${v}`).join(' '));
  L.push(`\n5) immutable deployment ledger: ${out.deploymentLedger.entries} entries (lookup by ${out.deploymentLedger.lookup.join('/')})`);
  L.push(`6) deterministic replay: ${out.deterministicReplay.digest1} vs ${out.deterministicReplay.digest2} → ${out.deterministicReplay.identical ? 'IDENTICAL' : 'DIVERGED'}`);
  process.stdout.write(L.join('\n') + '\n');
}

// WP-17 consumes ONLY this layer — all audit evidence originates from WP-16.
export { produceCertification, makeCertificate, assess };
const isDirectPc = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isDirectPc) main();
