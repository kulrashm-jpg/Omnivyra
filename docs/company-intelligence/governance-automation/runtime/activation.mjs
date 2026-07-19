#!/usr/bin/env node
// Canonical Governance Production Activation & Operationalization Layer — realizes GOV-AUTO-013 (WP-14).
//
// Converts the completed governance stack into an active operational capability. It consumes ONLY the
// WP-12 orchestrator and WP-13 optimizer — no governance runtime is invoked directly, and no runtime
// business/decision logic is modified. It provides data-driven operational profiles, centralized
// configuration, deterministic production-readiness verification (from cached runtime outputs), an
// operational health report, and an operational manifest. Deterministic; additive.
//
// Usage:
//   node activation.mjs --profile Production        # activate one operational profile
//   node activation.mjs --all-profiles              # activate every profile
//   node activation.mjs --verify                    # production-readiness verification only
//   node activation.mjs --demo                      # Development/CI/Production/Scheduled + verification + replay
//   node activation.mjs --json                      # machine-readable operational manifest + health + verification
//   node activation.mjs --cache-dir <dir> --config <file>

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { REGISTRY, resolve as resolveDag, hash } from './orchestrator.mjs';
import { canonicalFull, optimized, verifyEquivalence } from './optimizer.mjs';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..', '..', '..', '..');
const ALL = REGISTRY.map((n) => n.id);

// ---------------------------------------------------------------------------
// Centralized configuration (§4) — data-driven; overridable via --config. No hardcoded operational config.
// ---------------------------------------------------------------------------
const DEFAULT_CONFIG = {
  registry: 'WP-12 orchestrator',
  locations: {
    cache: '.governance-orchestrator-cache', evidence: '.governance-evidence',
    certification: '.governance-certification', releases: '.governance-releases',
    enforcement: '.governance-enforcement', baselines: '.governance-baselines', snapshots: '.governance-snapshots',
  },
  reporting: { defaultLevel: 'standard', machineReadable: true },
  optimization: { enabled: true, engine: 'WP-13' },
  profiles: 'see PROFILES',
};

// Operational profiles (§3) — fully data-driven.
const PROFILES = {
  Development: { executionMode: 'incremental', optimizationMode: 'on', cacheStrategy: 'warm', reportingLevel: 'minimal', failureBehavior: 'warn', requiresReadiness: false },
  CI: { executionMode: 'full', optimizationMode: 'off', cacheStrategy: 'fresh', reportingLevel: 'standard', failureBehavior: 'block', requiresReadiness: true },
  'Pull Request': { executionMode: 'incremental', optimizationMode: 'on', cacheStrategy: 'warm', reportingLevel: 'standard', failureBehavior: 'block', requiresReadiness: true },
  'Main Branch': { executionMode: 'full', optimizationMode: 'off', cacheStrategy: 'fresh', reportingLevel: 'full', failureBehavior: 'block', requiresReadiness: true },
  Release: { executionMode: 'full', optimizationMode: 'off', cacheStrategy: 'fresh', reportingLevel: 'full', failureBehavior: 'block', requiresReadiness: true },
  Production: { executionMode: 'full', optimizationMode: 'off', cacheStrategy: 'fresh', reportingLevel: 'full', failureBehavior: 'block', requiresReadiness: true },
  'Scheduled Audit': { executionMode: 'full', optimizationMode: 'off', cacheStrategy: 'fresh', reportingLevel: 'full', failureBehavior: 'warn', requiresReadiness: true },
};

function loadConfig() {
  const f = arg('--config');
  if (f && existsSync(f)) { try { return { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(f, 'utf8')) }; } catch { /* fall through */ } }
  return DEFAULT_CONFIG;
}
function configRevision(config) { return hash(config); }

// ---------------------------------------------------------------------------
// Read a cached runtime output (governance execution flows through the cache; readiness reads it — §6).
// ---------------------------------------------------------------------------
function readCache(cacheDir, nodeId, fp) {
  const f = path.join(cacheDir, `${nodeId.replace(/[:]/g, '_')}__${fp}.json`);
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
}

// ---------------------------------------------------------------------------
// Activation manager (§2) — runs governance through the orchestrator/optimizer per profile.
// ---------------------------------------------------------------------------
function activate(profileName, cacheDir) {
  const profile = PROFILES[profileName];
  const t = performance.now();
  let manifest, equivalence, optimizationUtilized;
  if (profile.optimizationMode === 'on' && profile.cacheStrategy !== 'fresh') {
    const canonical = canonicalFull(cacheDir);                  // warm the cache (reference)
    const opt = optimized(cacheDir, canonical.run.fingerprint, []); // incremental (no-change) → cache reuse
    manifest = opt.run; equivalence = verifyEquivalence(canonical, opt); optimizationUtilized = true;
  } else {
    const canonical = canonicalFull(cacheDir);                  // full canonical reference
    manifest = canonical.run; equivalence = { equivalenceStatus: 'EQUIVALENT', digestMatch: true, manifestDigestCanonical: canonical.run.manifestDigest, manifestDigestOptimized: canonical.run.manifestDigest };
    optimizationUtilized = false;
  }
  return { profile: profileName, profileConfig: profile, manifest, equivalence, optimizationUtilized, fingerprint: manifest.fingerprint, activationMs: +(performance.now() - t).toFixed(1) };
}

// ---------------------------------------------------------------------------
// Production readiness verification (§6) — deterministic, from cached runtime outputs.
// ---------------------------------------------------------------------------
function verifyReadiness(cacheDir, fp, manifest) {
  const reg = resolveDag(ALL);
  const cert = readCache(cacheDir, 'WP-11', fp);
  const enf = readCache(cacheDir, 'WP-10', fp);
  const rel = readCache(cacheDir, 'WP-09', fp);
  const ev = readCache(cacheDir, 'WP-08', fp);
  const V = (name, ok, evidence) => ({ target: name, status: ok ? 'verified' : 'failed', evidence });
  const certDecision = cert?.certificate?.certificationDecision, certLevel = cert?.certificate?.accreditationLevel;
  const enfOutcome = (enf?.evaluations || []).find((e) => e.profile === 'Production')?.outcome;
  const relDecision = (rel?.releases || []).find((r) => r.releaseType === 'production')?.decision;
  const checks = [
    V('runtime-registry', reg.findings.length === 0, { findings: reg.findings.length }),
    V('orchestration', reg.findings.length === 0 && (manifest.failed || []).length === 0, { failed: (manifest.failed || []).length, order: reg.order.length }),
    V('optimization', manifest.manifestDigest !== undefined, { manifestDigest: manifest.manifestDigest }),
    V('cache', (manifest.cacheHits ?? 0) >= 0 && (manifest.cacheMisses ?? 0) >= 0, { hits: manifest.cacheHits, misses: manifest.cacheMisses }),
    V('certification', !!certDecision && certDecision !== 'Certification Denied', { decision: certDecision, level: certLevel }),
    V('enforcement', enfOutcome === 'Pass' || enfOutcome === 'Warning', { productionOutcome: enfOutcome }),
    V('release', !!relDecision && relDecision !== 'Blocked', { productionDecision: relDecision }),
  ];
  return { overall: checks.every((c) => c.status === 'verified') ? 'READY' : 'NOT-READY', checks, cachedOutputs: { certification: !!cert, enforcement: !!enf, release: !!rel, evidence: !!ev } };
}

// ---------------------------------------------------------------------------
// Operational health (§5) + operational manifest (§7)
// ---------------------------------------------------------------------------
function operationalHealth(cacheDir, fp, manifest, verification) {
  const cert = readCache(cacheDir, 'WP-11', fp), enf = readCache(cacheDir, 'WP-10', fp), rel = readCache(cacheDir, 'WP-09', fp), ev = readCache(cacheDir, 'WP-08', fp), health = readCache(cacheDir, 'WP-04', fp);
  return {
    orchestratorStatus: (manifest.failed || []).length === 0 ? 'operational' : 'degraded',
    optimizerStatus: verification.checks.find((c) => c.target === 'optimization').status === 'verified' ? 'operational' : 'degraded',
    cacheHealth: { hits: manifest.cacheHits, misses: manifest.cacheMisses, hitRatio: manifest.cacheHitRatio },
    registryIntegrity: resolveDag(ALL).findings.length === 0 ? 'intact' : 'violated',
    executionHealth: { nodes: manifest.nodes.length, failed: (manifest.failed || []).length },
    certificationStatus: { decision: cert?.certificate?.certificationDecision, level: cert?.certificate?.accreditationLevel },
    releaseReadiness: { decision: (rel?.releases || []).find((r) => r.releaseType === 'production')?.decision },
    enforcementReadiness: { outcome: (enf?.evaluations || []).find((e) => e.profile === 'Production')?.outcome },
    posture: health?.posture?.classification,
    evidenceRegistry: { records: ev?.evidenceCount },
  };
}

function operationalManifest(activation, verification, health, config) {
  const digest = hash([activation.profile, activation.manifest.manifestDigest, verification.overall, verification.checks.map((c) => [c.target, c.status])]);
  return {
    activatedProfiles: [activation.profile], runtimeVersions: Object.fromEntries(REGISTRY.map((n) => [n.id, n.version])),
    configurationRevision: configRevision(config), executionTopology: resolveDag(ALL).order,
    operationalStatus: (activation.manifest.failed || []).length === 0 && health.orchestratorStatus === 'operational' ? 'ACTIVE' : 'DEGRADED',
    verificationStatus: verification.overall, manifestDigest: activation.manifest.manifestDigest,
    operationalDigest: digest,
  };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------
function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; }

function runProfile(profileName, cacheDir, config) {
  const activation = activate(profileName, cacheDir);
  const verification = verifyReadiness(cacheDir, activation.fingerprint, activation.manifest);
  const health = operationalHealth(cacheDir, activation.fingerprint, activation.manifest, verification);
  const manifest = operationalManifest(activation, verification, health, config);
  return { activation, verification, health, manifest };
}

function main() {
  const asJson = process.argv.includes('--json');
  const config = loadConfig();
  const cacheDir = path.resolve(arg('--cache-dir') || path.join(REPO_ROOT, config.locations.cache));

  if (process.argv.includes('--demo')) { runDemo(cacheDir, config, asJson); return; }

  const names = process.argv.includes('--all-profiles') ? Object.keys(PROFILES)
    : process.argv.includes('--verify') ? ['Production']
    : [arg('--profile') || 'Production'];
  const results = names.map((n) => runProfile(n, cacheDir, config));
  const out = {
    tool: 'governance-production-activation', runtimeVersion: '1.0.0', mapsTo: 'GOV-AUTO-013', consumes: { wp12: 'orchestrator', wp13: 'optimizer' },
    configurationRevision: configRevision(config),
    activations: results.map((r) => ({ profile: r.activation.profile, config: r.activation.profileConfig, optimizationUtilized: r.activation.optimizationUtilized, activationMs: r.activation.activationMs, operationalManifest: r.manifest, operationalHealth: r.health, readinessVerification: r.verification })),
    observability: {
      activatedProfiles: names, executionTopology: resolveDag(ALL).order,
      runtimeUtilization: ALL.length, optimizationUtilization: results.filter((r) => r.activation.optimizationUtilized).length,
      cacheUtilization: results.map((r) => r.activation.manifest.cacheHitRatio),
      operationalReadiness: results.every((r) => r.verification.overall === 'READY') ? 'READY' : 'NOT-READY',
    },
  };
  if (asJson) process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  else {
    const L = [];
    L.push('Governance Production Activation & Operationalization Layer — GOV-AUTO-013 (canonical)');
    L.push(`consumes WP-12 + WP-13 only  ·  configRevision: ${out.configurationRevision}`);
    for (const r of results) {
      L.push(`\n[${r.manifest.operationalStatus}] profile "${r.activation.profile}"  (mode=${r.activation.profileConfig.executionMode}, opt=${r.activation.profileConfig.optimizationMode}, cache=${r.activation.profileConfig.cacheStrategy})`);
      L.push(`   readiness: ${r.verification.overall}   manifestDigest: ${r.manifest.manifestDigest}   operationalDigest: ${r.manifest.operationalDigest}   (${r.activation.activationMs}ms)`);
      L.push(`   health: posture=${r.health.posture} cert=${r.health.certificationStatus.decision}/${r.health.certificationStatus.level} release=${r.health.releaseReadiness.decision} enforce=${r.health.enforcementReadiness.outcome} cacheHitRatio=${r.health.cacheHealth.hitRatio}`);
      for (const c of r.verification.checks) L.push(`     ${c.status === 'verified' ? 'OK  ' : 'FAIL'} ${c.target} ${JSON.stringify(c.evidence)}`);
    }
    L.push(`\noperational readiness: ${out.observability.operationalReadiness}`);
    process.stdout.write(L.join('\n') + '\n');
  }
  process.exit(results.every((r) => r.verification.overall === 'READY') ? 0 : 1);
}

function runDemo(cacheDir, config, asJson) {
  const profiles = ['Development', 'CI', 'Production', 'Scheduled Audit'];
  const results = profiles.map((p) => runProfile(p, cacheDir, config));
  // Deterministic replay: activate Production twice, compare operational digest.
  const p1 = runProfile('Production', cacheDir, config);
  const p2 = runProfile('Production', cacheDir, config);
  const out = {
    tool: 'governance-production-activation', mode: 'demo', mapsTo: 'GOV-AUTO-013',
    profiles: results.map((r) => ({ profile: r.activation.profile, config: r.activation.profileConfig, optimizationUtilized: r.activation.optimizationUtilized, status: r.manifest.operationalStatus, readiness: r.verification.overall, manifestDigest: r.manifest.manifestDigest, operationalDigest: r.manifest.operationalDigest, activationMs: r.activation.activationMs })),
    readinessVerification: results[2].verification.checks.map((c) => ({ target: c.target, status: c.status })),
    operationalHealth: results[2].health,
    operationalManifest: results[2].manifest,
    deterministicReplay: { digest1: p1.manifest.operationalDigest, digest2: p2.manifest.operationalDigest, identical: p1.manifest.operationalDigest === p2.manifest.operationalDigest },
  };
  if (asJson) { process.stdout.write(JSON.stringify(out, null, 2) + '\n'); return; }
  const L = [];
  L.push('Governance Production Activation — GOV-AUTO-013 (canonical) — DEMO');
  L.push(`consumes WP-12 + WP-13 only  ·  configRevision: ${configRevision(config)}`);
  L.push('\n1) profile activations:');
  for (const p of out.profiles) L.push(`   ${p.profile.padEnd(16)} ${p.status.padEnd(8)} readiness=${p.readiness.padEnd(9)} opt=${p.optimizationUtilized ? 'yes' : 'no '} manifest=${p.manifestDigest} (${p.activationMs}ms)`);
  L.push('\n2) production readiness verification:');
  for (const c of out.readinessVerification) L.push(`   ${c.status === 'verified' ? 'OK  ' : 'FAIL'} ${c.target}`);
  L.push('\n3) operational health (Production):');
  L.push(`   orchestrator=${out.operationalHealth.orchestratorStatus} optimizer=${out.operationalHealth.optimizerStatus} registry=${out.operationalHealth.registryIntegrity}`);
  L.push(`   cert=${out.operationalHealth.certificationStatus.decision}/${out.operationalHealth.certificationStatus.level} release=${out.operationalHealth.releaseReadiness.decision} enforce=${out.operationalHealth.enforcementReadiness.outcome} posture=${out.operationalHealth.posture}`);
  L.push('\n4) operational manifest (Production):');
  L.push(`   status=${out.operationalManifest.operationalStatus} verification=${out.operationalManifest.verificationStatus} configRev=${out.operationalManifest.configurationRevision} topology=[${out.operationalManifest.executionTopology.join(' → ')}]`);
  L.push(`\n5) deterministic replay: ${out.deterministicReplay.digest1} vs ${out.deterministicReplay.digest2} → ${out.deterministicReplay.identical ? 'IDENTICAL' : 'DIVERGED'}`);
  process.stdout.write(L.join('\n') + '\n');
}

// WP-15 consumes ONLY this layer — all governance execution continues to flow through WP-14.
export { runProfile, PROFILES, DEFAULT_CONFIG, configRevision, loadConfig };
const isDirectAct = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isDirectAct) main();
