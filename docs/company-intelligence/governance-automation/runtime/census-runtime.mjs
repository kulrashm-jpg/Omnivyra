#!/usr/bin/env node
// Canonical Constitutional Census Runtime — realizes GOV-AUTO-002 (WP-03 / EXEC-GOV-001).
//
// THE single authoritative inventory of everything governed by the Constitutional Repository.
// It regenerates the census entirely from repository state on every run — nothing is manually
// curated. It REUSES WP-02's discovery/parse (imports the same buildModel from lib/repository-
// model.mjs → one traversal, no duplicate discovery) and can gate on WP-02's validation result.
//
// Doctrine: ONE census runtime, ONE registry (regenerated), NO duplicate inventory system.
// Read-only over the docs tree; dependency-free (Node built-ins only).
//
// Usage:
//   node census-runtime.mjs                       # human inventory summary
//   node census-runtime.mjs --json                # full machine-readable registry + inventory + findings
//   node census-runtime.mjs --out <file>          # persist the regenerated registry JSON
//   node census-runtime.mjs --baseline <file>     # emit a change report vs a prior registry JSON
//   node census-runtime.mjs --root <dir>          # census an alternate tree (used for change-detection demos)
//   node census-runtime.mjs --gate                # first run WP-02; refuse to census an invalid repository

import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { buildModel } from './lib/repository-model.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_ROOT = path.resolve(__dirname, '..', '..');
const WP02 = path.join(__dirname, 'validate-docs.mjs');

// ---------------------------------------------------------------------------
// Config-as-data (frozen): the required governed identifiers + deterministic metadata rules.
// ---------------------------------------------------------------------------
const REQUIRED_IDS = [
  'AUDIT-001', 'AUDIT-002', 'AUDIT-003', 'AUDIT-004', 'AUDIT-005',
  'DESIGN-001', 'DESIGN-002',
  'IMPLEMENTATION-001', 'IMPLEMENTATION-002A', 'IMPLEMENTATION-002B', 'IMPLEMENTATION-002C',
  'IMPLEMENTATION-002D', 'IMPLEMENTATION-002E', 'IMPLEMENTATION-002F', 'IMPLEMENTATION-002G',
  'IMPLEMENTATION-002H', 'IMPLEMENTATION-003',
  'ADR-001', 'ADR-002', 'ADR-003', 'ADR-004', 'ADR-005', 'ADR-006', 'ADR-007', 'ADR-008', 'ADR-009', 'ADR-010',
  'GOV-AUTO-001', 'GOV-AUTO-002', 'GOV-AUTO-003', 'GOV-AUTO-004', 'GOV-AUTO-005', 'GOV-AUTO-006', 'GOV-AUTO-007', 'GOV-AUTO-008',
  'GOV-IMPL-001', 'GOV-CERT-001', 'IMPLEMENT-GOV-001', 'EXEC-GOV-001', 'GOV-EXEC-WP01',
];
const VALID_LIFECYCLE = new Set(['Ratified', 'Specified', 'Template', 'Draft', 'Superseded', 'Archived', 'Withdrawn']);
const SEV_RANK = { BLOCK: 0, WARN: 1, INFO: 2 };

// documentType by path/id (deterministic).
function classifyType(rel, id) {
  const p = rel;
  if (p === 'dependency-manifest.yaml' || p === 'dependency-manifest.json') return 'manifest';
  if (/^architecture\/AUDIT-/.test(p)) return 'audit';
  if (/^architecture\/DESIGN-/.test(p)) return 'design';
  if (/^implementation\//.test(p)) return p.endsWith('README.md') ? 'navigation' : 'implementation-program';
  if (/^adr\//.test(p)) return /ADR-\d/.test(p) ? 'adr' : 'navigation';
  if (/^amendments\//.test(p)) return /AMENDMENT-\d+-template/.test(p) ? 'amendment-template' : (/AMENDMENT-/.test(p) ? 'amendment' : 'navigation');
  if (/^appendices\//.test(p) || /^governance-automation\/appendices\//.test(p)) return 'appendix';
  if (/^diagrams\//.test(p) || /^governance-automation\/diagrams\//.test(p)) return 'diagram';
  if (/^full\//.test(p)) return p.endsWith('README.md') ? 'navigation' : 'full-edition';
  if (/^governance-automation\/audit\//.test(p)) return 'governance-audit';
  if (/^governance-automation\/programs\//.test(p)) return 'governance-program';
  if (/^governance-automation\/realization\//.test(p)) return id === 'GOV-CERT-001' ? 'certification-program' : 'realization-program';
  if (/^governance-automation\/execution\/work-packages\//.test(p)) return 'work-package';
  if (/^governance-automation\/execution\//.test(p)) return id === 'EXEC-GOV-001' ? 'execution-program' : 'execution-audit';
  if (p === 'VERSION.md') return 'version';
  if (p === 'RATIFICATION.md') return 'ratification';
  if (p === 'LIFECYCLE.md') return 'lifecycle';
  if (p === 'HISTORY.md') return 'history';
  if (p === 'MAINTAINERS.md') return 'maintainers';
  if (/^RELEASE-NOTES-/.test(p)) return 'release';
  if (/VALIDATION/.test(p)) return 'validation-report';
  if (p === 'GOVERNANCE.md' || p === 'CONFORMANCE-CHECKLIST.md') return 'governance-framework';
  return 'navigation';
}

const CONSTITUTION_TYPES = new Set(['audit', 'design', 'implementation-program', 'adr', 'version', 'ratification', 'lifecycle', 'history', 'maintainers', 'release', 'validation-report', 'governance-framework', 'full-edition', 'appendix', 'diagram', 'navigation', 'manifest']);
const GA_TYPES = new Set(['governance-audit', 'governance-program', 'realization-program', 'certification-program', 'execution-program', 'execution-audit', 'work-package']);

function governingParent(rel, id, type) {
  if (type === 'adr' || type === 'amendment' || type === 'amendment-template') return 'DESIGN-002';
  if (type === 'governance-program') return 'GOV-IMPL-001';
  if (id === 'GOV-IMPL-001' || id === 'GOV-CERT-001') return 'AUDIT-005';
  if (id === 'IMPLEMENT-GOV-001' || id === 'EXEC-GOV-001') return 'GOV-IMPL-001';
  if (type === 'work-package') return 'EXEC-GOV-001';
  if (rel.startsWith('governance-automation/')) return 'AUDIT-005';
  return 'CONSTITUTION';
}

function lifecycleFor(type) {
  if (type === 'amendment-template') return 'Template';
  if (GA_TYPES.has(type)) return 'Specified';
  return 'Ratified';
}

// djb2 content hash (stable, dependency-free).
function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

// Parse the governance-automation relationships table → authoritative owner/deps/gate/classification per id.
function parseRelationships(docs) {
  const table = {};
  const rel = docs.get('governance-automation/appendices/relationships.md');
  if (!rel) return table;
  for (const line of rel.lines) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    // | [ID](link) | Depends on | Reuses | Constitution refs | Migration gate | Owner | Classification |
    const idm = cells[1] && cells[1].match(/\[([A-Z][A-Z0-9-]+)\]/);
    if (!idm) continue;
    table[idm[1]] = {
      dependsOn: cells[2] || '',
      reuses: cells[3] || '',
      gate: cells[5] || '',
      owner: cells[6] || '',
      classification: cells[7] || '',
    };
  }
  return table;
}

// Canonical id is derived PATH-FIRST: the filename is the authoritative registration key for the
// well-known constitutional artifact families (a Reference Edition may carry a prose H1 like
// "COMPANY-PROFILE-AUDIT-001" that differs from its canonical filename "AUDIT-001.md" — the
// filename wins). H1 is the fallback only when the path encodes no family id.
const FAMILY_RE = /\b(GOV-EXEC-WP\d{2}|GOV-AUTO-\d{3}|GOV-IMPL-\d{3}|GOV-CERT-\d{3}|IMPLEMENT-GOV-\d{3}|EXEC-GOV-\d{3}|IMPLEMENTATION-\d{3}[A-H]?|AUDIT-\d{3}|DESIGN-\d{3}|ADR-\d{3}|AMENDMENT-\d{3})\b/;
function extractId(doc, rel) {
  const base = rel.split('/').pop();
  const fm = base.match(FAMILY_RE);
  if (fm) return fm[1];
  if (doc.h1) {
    const m = doc.h1.text.replace(/^COMPANY-PROFILE-/, '').match(/^([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)\b/);
    if (m && /[0-9]/.test(m[1])) return m[1];
  }
  return `DOC:${rel}`;
}

function extractVersion(doc) {
  if (doc.h1) {
    const m = doc.h1.text.match(/\bv(\d+\.\d+(?:\.\d+)?)\b/);
    if (m) return m[1];
  }
  return '1.0.0';
}

function extractClassification(doc, relRow) {
  const m = doc.raw.match(/\*\*Classification:\*\*\s*([^.\n·|]+)/) || doc.raw.match(/Classification:\s*([A-Za-z][^.\n·|]+)/);
  if (m) return m[1].trim();
  if (relRow && relRow.classification) return relRow.classification;
  return '';
}

function extractDeps(doc, relRow) {
  const ids = new Set();
  const src = (relRow && relRow.dependsOn && relRow.dependsOn !== '—' ? relRow.dependsOn + ' ' : '') +
    (doc.footer ? (doc.footer.match(/\*\*Depends on:\*\*(.*?)(\*\*Reuses|\*\*Constitution|$)/s)?.[1] || '') : '');
  for (const m of src.matchAll(/\b(GOV-AUTO-\d{3}|GOV-IMPL-\d{3}|GOV-CERT-\d{3}|IMPLEMENT-GOV-\d{3}|EXEC-GOV-\d{3}|GOV-EXEC-WP\d{2}|AUDIT-\d{3}|DESIGN-\d{3}|ADR-\d{3}|IMPLEMENTATION-\d{3}[A-H]?)\b/g))
    ids.add(m[1]);
  return [...ids].sort();
}

// ---------------------------------------------------------------------------
// Registry generation (§2 census model)
// ---------------------------------------------------------------------------
function buildRegistry(model) {
  const { docs } = model;
  const relTable = parseRelationships(docs);
  const artifacts = [];
  for (const [rel, doc] of docs) {
    const isGoverned = doc.isMd || rel === 'dependency-manifest.yaml' || rel === 'dependency-manifest.json';
    if (!isGoverned) continue;                       // runtime code (.mjs) is tooling, not a governed document
    if (rel.startsWith('governance-automation/runtime/')) continue;
    const id = extractId(doc, rel);
    const type = classifyType(rel, id);
    const relRow = relTable[id];
    const owner = (relRow && relRow.owner && relRow.owner !== '—') ? relRow.owner
      : (GA_TYPES.has(type) ? 'Architecture Steward'
        : (['navigation', 'version', 'ratification', 'lifecycle', 'history', 'maintainers', 'release', 'governance-framework', 'validation-report', 'manifest'].includes(type) ? 'Maintainer' : 'Architecture Steward'));
    const lifecycleStage = lifecycleFor(type);
    const classification = type === 'manifest' ? 'Machine-Readable' : extractClassification(doc, relRow) || (lifecycleStage === 'Ratified' ? 'Ratified' : '');
    const dependsOnText = (relRow && relRow.dependsOn ? relRow.dependsOn.trim() : '');
    const declaresDependencies = !!(dependsOnText && dependsOnText !== '—') ||
      (doc.footer ? /\*\*Depends on:\*\*\s*\S/.test(doc.footer) : false);
    artifacts.push({
      canonicalId: id,
      documentType: type,
      edition: type === 'full-edition' ? 'full' : 'reference', // refined to 'sole' below when no full counterpart
      classification,
      version: extractVersion(doc),
      owner,
      lifecycleStage,
      location: rel,
      governingParent: governingParent(rel, id, type),
      dependencies: extractDeps(doc, relRow),
      declaresDependencies,
      status: lifecycleStage === 'Ratified' ? 'active' : (lifecycleStage === 'Template' ? 'template' : 'specified'),
      contentHash: hash(doc.raw),
    });
  }
  // Edition dimension (dual-document strategy): a Full Edition shares its Reference Edition's id.
  // Mark reference editions that have a full counterpart; mark the rest 'sole'.
  const fullIds = new Set(artifacts.filter((a) => a.edition === 'full').map((a) => a.canonicalId));
  for (const a of artifacts)
    if (a.edition === 'reference' && !fullIds.has(a.canonicalId)) a.edition = 'sole';
  artifacts.sort((a, b) => a.canonicalId.localeCompare(b.canonicalId) || a.location.localeCompare(b.location));
  return artifacts;
}

// ---------------------------------------------------------------------------
// Census rules (§3)
// ---------------------------------------------------------------------------
function runRules(artifacts) {
  const out = [];
  const F = (rule, mapsTo, severity, id, message, rec) => out.push({ rule, mapsTo, severity, artifact: id, message, recommendation: rec });

  // duplicate registrations — a canonical registration is a non-full edition; Full Editions
  // legitimately share their Reference Edition's id (dual-document strategy) and are keyed by edition.
  const byId = new Map();
  const canonical = artifacts.filter((a) => a.edition !== 'full');
  for (const a of canonical) {
    if (byId.has(a.canonicalId)) F('DUP-REG', '§3 duplicate', 'BLOCK', a.canonicalId, `Duplicate registration: ${a.canonicalId} at ${a.location} and ${byId.get(a.canonicalId)}`, 'Each canonical id must map to one canonical artifact.');
    else byId.set(a.canonicalId, a.location);
  }
  // every Full Edition must have a matching canonical Reference Edition
  for (const a of artifacts.filter((a) => a.edition === 'full'))
    if (!byId.has(a.canonicalId)) F('FULL-ORPHAN', '§3 orphan', 'BLOCK', a.canonicalId, `Full Edition ${a.location} has no Reference Edition`, 'Every Full Edition must archive a maintained Reference Edition.');
  // missing required artifacts
  for (const id of REQUIRED_IDS)
    if (!byId.has(id)) F('MISSING-REQ', '§3 missing', 'BLOCK', id, `Required governed artifact missing: ${id}`, 'Restore the artifact into the repository.');
  // per-artifact rules
  const ids = new Set(artifacts.map((a) => a.canonicalId));
  for (const a of artifacts) {
    if (!a.governingParent) F('ORPHAN', '§3 orphan', 'BLOCK', a.canonicalId, `Artifact has no governing parent`, 'Assign a governing parent.');
    if (GA_TYPES.has(a.documentType) && !a.classification) F('BAD-CLASS', '§3 invalid classification', 'WARN', a.canonicalId, `Governance program has no classification`, 'Add a **Classification:** line.');
    if (!a.owner) F('BAD-OWNER', '§3 invalid ownership', 'WARN', a.canonicalId, `No owner`, 'Assign an owner.');
    if (!VALID_LIFECYCLE.has(a.lifecycleStage)) F('BAD-LIFECYCLE', '§3 invalid lifecycle', 'BLOCK', a.canonicalId, `Invalid lifecycle stage ${a.lifecycleStage}`, 'Use a valid lifecycle stage.');
    if (!/^\d+\.\d+(\.\d+)?$/.test(a.version)) F('BAD-VERSION', '§3 invalid version', 'WARN', a.canonicalId, `Non-SemVer version ${a.version}`, 'Use MAJOR.MINOR[.PATCH].');
    if (GA_TYPES.has(a.documentType) && a.canonicalId !== 'AUDIT-005' && !a.declaresDependencies)
      F('NO-DEPS', '§3 missing dependency', 'WARN', a.canonicalId, `Governance program declares no dependencies`, 'Declare Depends-on, or confirm none apply.');
    for (const d of a.dependencies)
      if (!ids.has(d)) F('BAD-REL', '§3 inconsistent relationship', 'WARN', a.canonicalId, `Declared dependency ${d} is not a registered artifact`, 'Fix the dependency id or register the target.');
  }
  out.sort((x, y) => SEV_RANK[x.severity] - SEV_RANK[y.severity] || x.rule.localeCompare(y.rule) || String(x.artifact).localeCompare(String(y.artifact)));
  return out;
}

// ---------------------------------------------------------------------------
// Inventory (§6)
// ---------------------------------------------------------------------------
function tally(artifacts, key) {
  const m = {};
  for (const a of artifacts) { const k = a[key] || '(none)'; m[k] = (m[k] || 0) + 1; }
  return Object.fromEntries(Object.entries(m).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])));
}
function buildInventory(artifacts) {
  const dependencyGraph = {};
  for (const a of artifacts) if (a.dependencies.length) dependencyGraph[a.canonicalId] = a.dependencies;
  const amendmentRelationships = artifacts.filter((a) => a.documentType.startsWith('amendment')).map((a) => ({ id: a.canonicalId, target: a.governingParent }));
  const gaPrograms = artifacts.filter((a) => GA_TYPES.has(a.documentType));
  return {
    total: artifacts.length,
    byCategory: tally(artifacts, 'documentType'),
    byOwner: tally(artifacts, 'owner'),
    byLifecycle: tally(artifacts, 'lifecycleStage'),
    byVersion: tally(artifacts, 'version'),
    byStatus: tally(artifacts, 'status'),
    dependencyGraph,
    amendmentRelationships,
    governanceCoverage: {
      governancePrograms: gaPrograms.length,
      withOwner: gaPrograms.filter((a) => a.owner).length,
      withClassification: gaPrograms.filter((a) => a.classification).length,
      withDependencies: gaPrograms.filter((a) => a.dependencies.length).length,
    },
  };
}

// ---------------------------------------------------------------------------
// Change detection (§5)
// ---------------------------------------------------------------------------
function diffRegistries(baseArr, curArr) {
  const base = new Map(baseArr.map((a) => [a.canonicalId, a]));
  const cur = new Map(curArr.map((a) => [a.canonicalId, a]));
  const baseHash = new Map(baseArr.map((a) => [a.contentHash, a]));
  const added = [], removed = [], moved = [], renamed = [], metadataChanged = [];
  for (const [id, a] of cur) {
    if (!base.has(id)) {
      const prior = baseHash.get(a.contentHash);
      if (prior && !cur.has(prior.canonicalId)) renamed.push({ from: prior.canonicalId, to: id, location: a.location });
      else added.push({ canonicalId: id, location: a.location });
    } else {
      const b = base.get(id);
      if (b.location !== a.location) moved.push({ canonicalId: id, from: b.location, to: a.location });
      const changes = {};
      for (const k of ['classification', 'owner', 'version', 'documentType', 'lifecycleStage'])
        if (b[k] !== a[k]) changes[k] = { from: b[k], to: a[k] };
      if (Object.keys(changes).length) metadataChanged.push({ canonicalId: id, changes });
    }
  }
  const renamedFrom = new Set(renamed.map((r) => r.from));
  for (const [id, a] of base)
    if (!cur.has(id) && !renamedFrom.has(id)) removed.push({ canonicalId: id, location: a.location });
  const sort = (arr, k) => arr.sort((x, y) => String(x[k]).localeCompare(String(y[k])));
  return { added: sort(added, 'canonicalId'), removed: sort(removed, 'canonicalId'), moved: sort(moved, 'canonicalId'), renamed: sort(renamed, 'to'), metadataChanged: sort(metadataChanged, 'canonicalId') };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------
function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; }

function main() {
  const asJson = process.argv.includes('--json');
  const root = path.resolve(arg('--root') || DEFAULT_ROOT);
  const outFile = arg('--out');
  const baselineFile = arg('--baseline');

  if (process.argv.includes('--gate')) {
    try { execFileSync('node', [WP02, '--quiet'], { stdio: 'ignore' }); }
    catch { process.stderr.write('census: WP-02 validation FAILED — refusing to census an invalid repository.\n'); process.exit(2); }
  }

  const t0 = performance.now();
  const model = buildModel(root);
  const tDiscovery = +(performance.now() - t0).toFixed(1);

  const t1 = performance.now();
  const artifacts = buildRegistry(model);
  const findings = runRules(artifacts);
  const inventory = buildInventory(artifacts);
  const tCensus = +(performance.now() - t1).toFixed(1);

  const digestSrc = JSON.stringify(artifacts.map((a) => [a.canonicalId, a.documentType, a.classification, a.version, a.owner, a.lifecycleStage, a.location, a.governingParent, a.dependencies, a.status]));
  const digest = hash(digestSrc);

  const failures = findings.filter((f) => f.severity === 'BLOCK').length;
  const warnings = findings.filter((f) => f.severity === 'WARN').length;
  const mem = process.memoryUsage();
  const stats = {
    filesTraversed: model.fileCount, artifactsScanned: artifacts.length,
    discoveryMs: tDiscovery, censusMs: tCensus,
    rulesExecuted: 9, violations: failures, warnings,
    successfulRegistrations: artifacts.length - failures,
    heapUsedMB: +(mem.heapUsed / 1048576).toFixed(1),
    digest,
  };

  let changeReport = null;
  if (baselineFile) {
    const base = JSON.parse(readFileSync(baselineFile, 'utf8'));
    changeReport = diffRegistries(base.artifacts || base, artifacts);
  }

  const registry = {
    tool: 'constitutional-census-runtime', runtimeVersion: '1.0.0', mapsTo: 'GOV-AUTO-002',
    root: path.relative(process.cwd(), root).split(path.sep).join('/') || '.',
    generatedFrom: 'repository-inspection', stats, inventory, findings, artifacts,
    ...(changeReport ? { changeReport } : {}),
  };

  if (outFile) { writeFileSync(outFile, JSON.stringify(registry, null, 2)); }

  if (asJson) {
    process.stdout.write(JSON.stringify(registry, null, 2) + '\n');
  } else {
    const L = [];
    L.push('Constitutional Census Runtime — GOV-AUTO-002 (canonical)');
    L.push(`root: ${registry.root}  ·  digest: ${digest}`);
    L.push(`artifacts: ${artifacts.length}  files: ${model.fileCount}  discovery: ${tDiscovery}ms  census: ${tCensus}ms  heap: ${stats.heapUsedMB}MB`);
    L.push(`result: ${failures === 0 ? 'PASS' : 'FAIL'}   violations: ${failures}   warnings: ${warnings}   registered: ${stats.successfulRegistrations}`);
    L.push('\nby category:'); for (const [k, v] of Object.entries(inventory.byCategory)) L.push(`  ${String(v).padStart(3)}  ${k}`);
    L.push('by lifecycle:'); for (const [k, v] of Object.entries(inventory.byLifecycle)) L.push(`  ${String(v).padStart(3)}  ${k}`);
    L.push('by owner:'); for (const [k, v] of Object.entries(inventory.byOwner)) L.push(`  ${String(v).padStart(3)}  ${k}`);
    L.push('governance coverage:'); L.push(`  programs=${inventory.governanceCoverage.governancePrograms} owned=${inventory.governanceCoverage.withOwner} classified=${inventory.governanceCoverage.withClassification} with-deps=${inventory.governanceCoverage.withDependencies}`);
    if (findings.length) { L.push('\nfindings:'); for (const f of findings) L.push(`  [${f.severity}] ${f.rule} ${f.artifact}: ${f.message}`); }
    if (changeReport) {
      L.push('\nchange report vs baseline:');
      for (const k of ['added', 'removed', 'moved', 'renamed', 'metadataChanged']) L.push(`  ${k}: ${changeReport[k].length}`);
    }
    process.stdout.write(L.join('\n') + '\n');
  }
  process.exit(failures === 0 ? 0 : 1);
}

main();
