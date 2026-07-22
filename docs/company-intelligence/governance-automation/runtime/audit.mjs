#!/usr/bin/env node
// Canonical Independent Repository Audit & Constitutional Compliance Verification Runtime — GOV-AUTO-016 (WP-17).
//
// The final independent verification layer. Where WP-16 certifies operational readiness, WP-17 verifies —
// external-audit style — that the platform's own certification is INDEPENDENTLY REPRODUCIBLE from
// repository evidence. It consumes ONLY WP-16 (the final production certification), invoking it twice and
// confirming the certificate, digests, readiness, and ledger evidence reproduce identically. It introduces
// NO new governance rules or decisions and invokes no earlier runtime directly. Deterministic; additive.
//
// Usage:
//   node audit.mjs                        # independent constitutional audit
//   node audit.mjs --demo                 # 3 decisions + 4 confidence levels + reproducibility + replay
//   node audit.mjs --json                 # machine-readable audit + verification + reproducibility + ledger
//   node audit.mjs --persist              # append an immutable audit record
//   node audit.mjs --cache-dir <dir> --ledger-dir <dir>

import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { produceCertification } from './production-cert.mjs';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..', '..', '..', '..');
const CACHE_DIR = path.join(REPO_ROOT, '.governance-orchestrator-cache');
const DEFAULT_LEDGER_DIR = path.join(REPO_ROOT, '.governance-audit');

function hash(str) { const s = typeof str === 'string' ? str : JSON.stringify(str); let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(16).padStart(8, '0'); }
const POINTS = { pass: 10, warn: 5, fail: 0 };
const isDigest = (d) => typeof d === 'string' && /^[0-9a-f]{8}$/.test(d);

// ---------------------------------------------------------------------------
// Reproducibility verification (§7) — two independent WP-16 productions, compared.
// ---------------------------------------------------------------------------
function reproducibility(a, b) {
  return {
    certificateReproducibility: a.cert.certificationDigest === b.cert.certificationDigest,
    digestReproducibility: a.cert.operationalDigest === b.cert.operationalDigest && a.evidence.assuranceDigest === b.evidence.assuranceDigest,
    readinessReproducibility: a.cert.readinessDecision === b.cert.readinessDecision && a.cert.readinessClassification === b.cert.readinessClassification,
    deploymentLedgerReproducibility: a.evidence.evidenceContinuity === b.evidence.evidenceContinuity,
    assuranceReproducibility: a.evidence.assuranceDigest === b.evidence.assuranceDigest,
  };
}

// ---------------------------------------------------------------------------
// Independent verification areas (§3) — ten areas from WP-16 evidence + reproducibility.
// ---------------------------------------------------------------------------
function verificationAreas(a, b, repro, overrides = {}) {
  const cert = a.cert, assess = Object.fromEntries(a.assessments.map((x) => [x.assessment, x.status]));
  const V = (area, status, evidence) => ({ area, status: overrides[area] || status, evidence, sourceRuntime: 'GOV-AUTO-015 (WP-16)' });
  const okAll = (o) => Object.values(o).every(Boolean);
  return [
    V('evidence-chain-completeness', Object.values(cert.evidenceDigests).every(isDigest) ? 'pass' : 'fail', { digests: Object.keys(cert.evidenceDigests).length }),
    V('certificate-reproducibility', repro.certificateReproducibility ? 'pass' : 'fail', { digest: cert.certificationDigest }),
    V('deployment-ledger-integrity', isDigest(cert.certificationDigest) && repro.deploymentLedgerReproducibility ? 'pass' : 'fail', { evidenceContinuity: a.evidence.evidenceContinuity }),
    V('assurance-continuity', isDigest(a.evidence.assuranceDigest) && repro.assuranceReproducibility ? 'pass' : 'fail', { assuranceDigest: a.evidence.assuranceDigest }),
    V('operational-continuity', cert.verificationSummary.operational ? 'pass' : 'fail', { operational: cert.verificationSummary.operational }),
    V('certification-continuity', cert.verificationSummary.certification ? 'pass' : 'fail', { certification: cert.verificationSummary.certification }),
    V('execution-determinism', repro.digestReproducibility ? 'pass' : 'fail', { operationalDigest: cert.operationalDigest }),
    V('runtime-registry-integrity', assess['governance-integrity'] === 'pass' ? 'pass' : (assess['governance-integrity'] === 'warn' ? 'warn' : 'fail'), { governanceIntegrity: assess['governance-integrity'] }),
    V('cache-integrity', okAll({ r: cert.verificationSummary.release, a: cert.verificationSummary.activation }) ? 'pass' : 'warn', { release: cert.verificationSummary.release, activation: cert.verificationSummary.activation }),
    V('constitutional-traceability', isDigest(cert.repositoryRevision) && a.evidence.repositoryRevision === b.evidence.repositoryRevision ? 'pass' : 'fail', { repositoryRevision: cert.repositoryRevision }),
  ];
}

// ---------------------------------------------------------------------------
// Audit engine (§2) + confidence classification (§4)
// ---------------------------------------------------------------------------
function decide(areas) {
  const fails = areas.filter((a) => a.status === 'fail'), warns = areas.filter((a) => a.status === 'warn');
  return fails.length ? 'Audit Failed' : warns.length ? 'Audit Passed With Findings' : 'Audit Passed';
}
function confidence(areas, repro) {
  const score = areas.reduce((s, a) => s + POINTS[a.status], 0);            // 0..100
  const allReproducible = Object.values(repro).every(Boolean);
  const level = (score >= 95 && allReproducible) ? 'Maximum' : score >= 85 ? 'High' : score >= 70 ? 'Moderate' : 'Limited';
  return { score, level, allReproducible };
}

// ---------------------------------------------------------------------------
// Independent audit report (§5)
// ---------------------------------------------------------------------------
function makeReport(a, areas, repro) {
  const decision = decide(areas);
  const conf = confidence(areas, repro);
  const auditDigest = hash([decision, conf.level, areas.map((x) => [x.area, x.status]), a.cert.certificationDigest]);
  return {
    auditId: `AUDIT-${conf.level}-${a.cert.repositoryRevision}-${auditDigest}`,
    auditDecision: decision, confidenceLevel: conf.level, confidenceScore: conf.score,
    repositoryRevision: a.cert.repositoryRevision, productionCertificateReference: a.cert.certificateId,
    evidenceDigests: { certification: a.cert.certificationDigest, operational: a.cert.operationalDigest, assurance: a.evidence.assuranceDigest, evidenceContinuity: a.evidence.evidenceContinuity },
    verificationSummary: Object.fromEntries(areas.map((x) => [x.area, x.status])),
    reproducibilitySummary: repro, auditDigest, auditTimestamp: new Date().toISOString(),
    auditSummary: `${decision} — ${conf.level} confidence (score ${conf.score}/100) for revision ${a.cert.repositoryRevision}`,
  };
}

// ---------------------------------------------------------------------------
// Immutable audit ledger (§6)
// ---------------------------------------------------------------------------
function appendLedger(report, dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'audit-ledger.jsonl');
  const entry = { auditId: report.auditId, decision: report.auditDecision, confidenceLevel: report.confidenceLevel, repositoryRevision: report.repositoryRevision, evidenceDigest: report.auditDigest, timestamp: new Date().toISOString() };
  appendFileSync(file, JSON.stringify(entry) + '\n'); // append-only; prior lines never modified
  return entry;
}
function ledgerEntries(dir) { const f = path.join(dir, 'audit-ledger.jsonl'); if (!existsSync(f)) return []; const c = readFileSync(f, 'utf8').trim(); return c ? c.split(/\n/).map((l) => JSON.parse(l)) : []; }

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------
function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; }

function audit(a, b, overrides = {}) {
  const repro = reproducibility(a, b);
  const areas = verificationAreas(a, b, repro, overrides);
  const report = makeReport(a, areas, repro);
  return { areas, repro, report };
}

// WP-18 consumes this as the sole WP-17 API — one call yields the full independent audit result.
function produceAudit(cacheDir) {
  const a = produceCertification(cacheDir);   // two independent WP-16 productions → reproducibility evidence
  const b = produceCertification(cacheDir);
  const { areas, repro, report } = audit(a, b);
  return { report, areas, repro, a, b };
}

function main() {
  const asJson = process.argv.includes('--json');
  const ledgerDir = path.resolve(arg('--ledger-dir') || DEFAULT_LEDGER_DIR);
  const cacheDir = path.resolve(arg('--cache-dir') || CACHE_DIR);

  const t0 = performance.now();
  const a = produceCertification(cacheDir);   // two independent WP-16 productions → reproducibility evidence
  const b = produceCertification(cacheDir);
  const consumeMs = +(performance.now() - t0).toFixed(1);

  if (process.argv.includes('--demo')) { runDemo(a, b, ledgerDir, asJson, consumeMs); return; }

  const { areas, repro, report } = audit(a, b);
  let ledger = null;
  if (process.argv.includes('--persist')) { appendLedger(report, ledgerDir); ledger = { entries: ledgerEntries(ledgerDir).length }; }

  const out = {
    tool: 'governance-independent-repository-audit', runtimeVersion: '1.0.0', mapsTo: 'GOV-AUTO-016', consumes: { wp16: 'final production certification' },
    auditReport: report, verificationReport: areas, reproducibilityReport: repro,
    ...(ledger ? { auditLedger: ledger } : {}),
    auditSummary: report.auditSummary,
    observability: { auditDecision: report.auditDecision, confidenceLevel: report.confidenceLevel, reproducibilityStatus: Object.values(repro).every(Boolean) ? 'reproducible' : 'not-reproducible', evidenceContinuity: report.evidenceDigests.evidenceContinuity, verificationCoverage: `${areas.length}/10`, auditMs: consumeMs },
  };
  if (asJson) process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  else {
    const L = [];
    L.push('Independent Repository Audit & Constitutional Compliance Verification — GOV-AUTO-016 (canonical)');
    L.push(`consumes WP-16 only  ·  revision: ${report.repositoryRevision}`);
    L.push(`\nAUDIT DECISION: ${report.auditDecision}   CONFIDENCE: ${report.confidenceLevel} (score ${report.confidenceScore}/100)`);
    L.push(`audit: ${report.auditId}   certificate: ${report.productionCertificateReference}`);
    L.push('\nverification areas:');
    for (const x of areas) L.push(`   ${x.status === 'fail' ? 'FAIL' : x.status === 'warn' ? 'WARN' : 'PASS'}  ${x.area}`);
    L.push('\nreproducibility: ' + Object.entries(repro).map(([k, v]) => `${k}=${v}`).join(' '));
    process.stdout.write(L.join('\n') + '\n');
  }
  process.exit(report.auditDecision === 'Audit Failed' ? 1 : 0);
}

function runDemo(a, b, ledgerDir, asJson, consumeMs) {
  const real = audit(a, b);                                                  // Audit Passed / Maximum
  const findings3 = audit(a, b, { 'cache-integrity': 'warn', 'runtime-registry-integrity': 'warn', 'deployment-ledger-integrity': 'warn' }); // High (85)
  const findings6 = audit(a, b, Object.fromEntries(['cache-integrity', 'runtime-registry-integrity', 'deployment-ledger-integrity', 'assurance-continuity', 'operational-continuity', 'certification-continuity'].map((k) => [k, 'warn']))); // Moderate (70)
  const findings8 = audit(a, b, Object.fromEntries(['cache-integrity', 'runtime-registry-integrity', 'deployment-ledger-integrity', 'assurance-continuity', 'operational-continuity', 'certification-continuity', 'execution-determinism', 'constitutional-traceability'].map((k) => [k, 'warn']))); // Limited (60)
  const failed = audit(a, b, { 'certificate-reproducibility': 'fail' });     // Audit Failed
  appendLedger(real.report, ledgerDir); appendLedger(findings3.report, ledgerDir);
  const r1 = audit(a, b), r2 = audit(a, b);

  const out = {
    tool: 'governance-independent-repository-audit', mode: 'demo', mapsTo: 'GOV-AUTO-016', consumes: 'WP-16 only', repositoryRevision: real.report.repositoryRevision,
    decisions: {
      AuditPassed: { decision: real.report.auditDecision, confidence: real.report.confidenceLevel, score: real.report.confidenceScore },
      AuditPassedWithFindings: { decision: findings3.report.auditDecision, confidence: findings3.report.confidenceLevel, score: findings3.report.confidenceScore },
      AuditFailed: { decision: failed.report.auditDecision, confidence: failed.report.confidenceLevel, score: failed.report.confidenceScore },
    },
    confidenceLevels: { Maximum: real.report.confidenceScore, High: findings3.report.confidenceScore, Moderate: findings6.report.confidenceScore, Limited: findings8.report.confidenceScore },
    levelAssignments: { Maximum: real.report.confidenceLevel, High: findings3.report.confidenceLevel, Moderate: findings6.report.confidenceLevel, Limited: findings8.report.confidenceLevel },
    auditReport: real.report,
    reproducibilityReport: real.repro,
    auditLedger: { entries: ledgerEntries(ledgerDir).length, immutable: true, lookup: ['auditId', 'repositoryRevision'] },
    deterministicReplay: { digest1: r1.report.auditDigest, digest2: r2.report.auditDigest, identical: r1.report.auditDigest === r2.report.auditDigest },
    consumeMs,
  };
  if (asJson) { process.stdout.write(JSON.stringify(out, null, 2) + '\n'); return; }
  const L = [];
  L.push('Independent Repository Audit — GOV-AUTO-016 (canonical) — DEMO');
  L.push(`consumes WP-16 only  ·  revision: ${real.report.repositoryRevision}`);
  L.push('\n1) audit decisions:');
  L.push(`   Audit Passed              → ${out.decisions.AuditPassed.decision} / ${out.decisions.AuditPassed.confidence} (score ${out.decisions.AuditPassed.score})`);
  L.push(`   Audit Passed With Findings → ${out.decisions.AuditPassedWithFindings.decision} / ${out.decisions.AuditPassedWithFindings.confidence} (score ${out.decisions.AuditPassedWithFindings.score})`);
  L.push(`   Audit Failed              → ${out.decisions.AuditFailed.decision} / ${out.decisions.AuditFailed.confidence} (score ${out.decisions.AuditFailed.score})`);
  L.push('\n2) confidence levels (objective scoring):');
  for (const [lvl, sc] of Object.entries(out.confidenceLevels)) L.push(`   ${lvl.padEnd(9)} score=${sc} → assigned ${out.levelAssignments[lvl]}`);
  L.push(`\n3) audit report: ${out.auditReport.auditId}`);
  L.push(`   decision=${out.auditReport.auditDecision} confidence=${out.auditReport.confidenceLevel} certificateRef=${out.auditReport.productionCertificateReference}`);
  L.push('\n4) reproducibility: ' + Object.entries(out.reproducibilityReport).map(([k, v]) => `${k}=${v}`).join(' '));
  L.push(`\n5) immutable audit ledger: ${out.auditLedger.entries} entries (lookup by ${out.auditLedger.lookup.join('/')})`);
  L.push(`6) deterministic replay: ${out.deterministicReplay.digest1} vs ${out.deterministicReplay.digest2} → ${out.deterministicReplay.identical ? 'IDENTICAL' : 'DIVERGED'}`);
  process.stdout.write(L.join('\n') + '\n');
}

// WP-18 consumes ONLY this layer — all baseline evidence originates from WP-17.
export { produceAudit };
const isDirectAudit = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isDirectAudit) main();
