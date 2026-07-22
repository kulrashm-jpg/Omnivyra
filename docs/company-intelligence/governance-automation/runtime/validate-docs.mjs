#!/usr/bin/env node
// Canonical Documentation Validation Runtime — realizes GOV-AUTO-001 (WP-02 / EXEC-GOV-001).
//
// This is THE single authoritative validator for the Company Intelligence constitutional
// documentation tree (docs/company-intelligence/**) and its governance-automation subtree.
// Doctrine: ONE runtime, MANY validators, ONE report, NO duplication. Read-only over the
// docs tree (freeze-safe — never mutates a document). Deterministic and repeatable.
//
// Reuse note: an audit of the repository (scripts/**, architecture-migration/tools/**) found
// NO existing markdown / link / documentation validator — every check:* / audit:* tool operates
// on product code or DB schema. This runtime therefore consolidates the previously by-hand
// link/orphan/duplicate/manifest checks into the one canonical tool; it introduces no competing
// pipeline and depends only on Node built-ins (fs, path, url, perf_hooks).
//
// Usage:
//   node validate-docs.mjs               # human report to stdout; exit 1 iff a BLOCK finding
//   node validate-docs.mjs --json        # machine-readable JSON report to stdout
//   node validate-docs.mjs --strict      # treat WARN as blocking too
//   node validate-docs.mjs --quiet       # suppress the per-finding listing (summary only)
//
// Extensibility (GOV-AUTO-001 §7 — additive, no core edit): every *.mjs in ./validators/ that
// default-exports { id, mapsTo, severity, run(model, ctx) -> finding[] } is loaded and executed
// after the built-in validators. A broken extension is reported as a WARN, never a crash.

import { statSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { buildModel } from './lib/repository-model.mjs'; // shared single-traversal discovery (reused by WP-03)

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ROOT = docs/company-intelligence  (this file lives at ROOT/governance-automation/runtime/)
const ROOT = path.resolve(__dirname, '..', '..');
const GA = path.join(ROOT, 'governance-automation');

// ---------------------------------------------------------------------------
// Config-as-data (frozen). Changing governance = editing these tables, not code.
// ---------------------------------------------------------------------------
const CONSTITUTION_ROOT_ENTRIES = new Set(['README.md', 'START-HERE.md']); // exempt from orphan
const CENSUS_RULES = [
  'writer_authority', 'confidence_writer', 'grounding_bypass',
  'conversation_loops_outside_engine', 'unregistered_llm_calls', 'inline_prompts',
  'direct_model_reads', 'direct_canonical_reads', 'unmanaged_learning',
];
const LIFECYCLE_STAGES = ['Draft', 'Review', 'Ratified', 'Superseded', 'Archived', 'Withdrawn'];
const REQUIRED_DIRS = [
  'architecture', 'implementation', 'adr', 'amendments', 'appendices', 'diagrams', 'full',
  'governance-automation',
  'governance-automation/audit', 'governance-automation/programs',
  'governance-automation/realization', 'governance-automation/execution',
  'governance-automation/execution/work-packages', 'governance-automation/diagrams',
  'governance-automation/appendices',
];
const REQUIRED_FILES = [
  'README.md', 'INDEX.md', 'START-HERE.md', 'GOVERNANCE.md', 'CONFORMANCE-CHECKLIST.md',
  'VERSION.md', 'RATIFICATION.md', 'LIFECYCLE.md', 'HISTORY.md', 'MAINTAINERS.md',
  'dependency-manifest.yaml', 'dependency-manifest.json',
  'governance-automation/README.md', 'governance-automation/INDEX.md',
];
const REQUIRED_ADRS = Array.from({ length: 10 }, (_, i) => `ADR-${String(i + 1).padStart(3, '0')}`);
// Governance-automation program docs must carry a canonical "# <ID> — <Title>" H1 + "**Related:**" footer.
const GA_PROGRAM_DIRS = ['audit', 'programs', 'realization', 'execution', 'execution/work-packages'];

const SEVERITY = { BLOCK: 'BLOCK', WARN: 'WARN', INFO: 'INFO' };
const SEV_RANK = { BLOCK: 0, WARN: 1, INFO: 2 };

// Discovery + parse-once shared model is provided by ./lib/repository-model.mjs (buildModel),
// the single traversal implementation reused by the WP-03 census — no duplicated discovery here.

// ---------------------------------------------------------------------------
// Finding helper
// ---------------------------------------------------------------------------
function finding(rule, mapsTo, severity, file, section, message, recommendation) {
  return { rule, mapsTo, severity, file: file || '(tree)', section: section || '-', message, recommendation };
}

// ---------------------------------------------------------------------------
// Validators. Each: (model) -> finding[]. Pure, read-only.
// ---------------------------------------------------------------------------

// STRUCTURE — required directories / files / canonical hierarchy (GOV-AUTO-001 §3 repository structure)
function vStructure({ docs }) {
  const out = [];
  for (const d of REQUIRED_DIRS) {
    const p = path.join(ROOT, d);
    if (!existsSync(p) || !statSync(p).isDirectory())
      out.push(finding('STRUCT-DIR', 'V-struct', SEVERITY.BLOCK, d, 'hierarchy',
        `Required directory missing: ${d}`, `Create ${d}/ per the canonical hierarchy.`));
  }
  for (const f of REQUIRED_FILES) {
    const p = path.join(ROOT, f);
    if (!existsSync(p) || !statSync(p).isFile())
      out.push(finding('STRUCT-FILE', 'V-struct', SEVERITY.BLOCK, f, 'hierarchy',
        `Required file missing: ${f}`, `Restore ${f}.`));
  }
  return out;
}

// V1 — Link integrity: every relative link resolves.
function v1Link({ mdRelPaths, docs }) {
  const out = [];
  for (const rel of mdRelPaths) {
    for (const link of docs.get(rel).links) {
      if (link.kind !== 'relative') continue;
      if (!link.exists)
        out.push(finding('V1-LINK', 'V1', SEVERITY.BLOCK, rel, `line ${link.line}`,
          `Broken link → ${link.target}`, `Fix the path or restore the target of ${link.target}.`));
    }
  }
  return out;
}

// V2 — Orphan / navigation: every md has >=1 inbound reference (roots exempt); flag unreachable + trapping cycles.
function v2Orphan({ mdRelPaths, docs }) {
  const out = [];
  for (const rel of mdRelPaths) {
    if (CONSTITUTION_ROOT_ENTRIES.has(rel)) continue; // ROOT/README.md, ROOT/START-HERE.md are human entry points
    if (docs.get(rel).inbound === 0)
      out.push(finding('V2-ORPHAN', 'V2', SEVERITY.BLOCK, rel, 'navigation',
        `Orphan document — 0 inbound references from any other document`,
        `Link ${rel} from its INDEX/README or the relevant relationships appendix.`));
  }
  // Reachability (informational): BFS from ROOT/README.md through resolved md links + dir READMEs.
  const start = 'README.md';
  const reached = new Set();
  const q = [start];
  while (q.length) {
    const cur = q.shift();
    if (reached.has(cur)) continue;
    reached.add(cur);
    const d = docs.get(cur);
    if (!d) continue;
    for (const link of d.links) if (link.targetRel && !reached.has(link.targetRel)) q.push(link.targetRel);
  }
  for (const rel of mdRelPaths)
    if (!reached.has(rel))
      out.push(finding('V2-UNREACHABLE', 'V2', SEVERITY.WARN, rel, 'navigation',
        `Not reachable by link-walk from ROOT/README.md (has inbound refs but no path from the entry point)`,
        `Ensure a navigable path from README.md reaches ${rel}.`));
  return out;
}

// V3 — Terminology / glossary single-source (non-blocking editorial).
function v3Terminology({ docs }) {
  const out = [];
  const glossaries = [...docs.keys()].filter((r) => r.endsWith('appendices/glossary.md'));
  if (!glossaries.some((r) => r === 'appendices/glossary.md'))
    out.push(finding('V3-GLOSSARY', 'V3', SEVERITY.WARN, 'appendices/glossary.md', 'terminology',
      `Constitution glossary not found at the canonical path`, `Provide appendices/glossary.md as the single-source glossary.`));
  return out;
}

// V4 — ADR completeness: ADR-001..010 + README present.
function v4Adr({ docs }) {
  const out = [];
  const adrFiles = [...docs.keys()].filter((r) => r.startsWith('adr/') && r.endsWith('.md'));
  if (!adrFiles.includes('adr/README.md'))
    out.push(finding('V4-ADR-README', 'V4', SEVERITY.BLOCK, 'adr/README.md', 'adr',
      `adr/README.md missing`, `Restore the ADR index.`));
  for (const id of REQUIRED_ADRS) {
    if (!adrFiles.some((r) => r.startsWith(`adr/${id}-`)))
      out.push(finding('V4-ADR', 'V4', SEVERITY.BLOCK, `adr/${id}-*.md`, 'adr',
        `Missing ADR ${id}`, `Restore ${id}.`));
  }
  return out;
}

// V5 — Amendment framework: README + template present; numbering contiguous from 001.
function v5Amendment({ docs }) {
  const out = [];
  const amdFiles = [...docs.keys()].filter((r) => r.startsWith('amendments/') && r.endsWith('.md'));
  if (!amdFiles.includes('amendments/README.md'))
    out.push(finding('V5-README', 'V5', SEVERITY.BLOCK, 'amendments/README.md', 'amendments',
      `amendments/README.md missing`, `Restore the amendment framework index.`));
  if (!amdFiles.some((r) => /amendments\/AMENDMENT-001-/.test(r)))
    out.push(finding('V5-TEMPLATE', 'V5', SEVERITY.BLOCK, 'amendments/AMENDMENT-001-*.md', 'amendments',
      `AMENDMENT-001 template missing`, `Restore the amendment template.`));
  // Contiguity of any real (non-template) amendments AMENDMENT-002..N
  const nums = amdFiles
    .map((r) => r.match(/AMENDMENT-(\d{3})-/))
    .filter(Boolean)
    .map((m) => Number(m[1]))
    .filter((n) => n >= 2)
    .sort((a, b) => a - b);
  for (let i = 0; i < nums.length; i++)
    if (nums[i] !== i + 2)
      out.push(finding('V5-GAP', 'V5', SEVERITY.BLOCK, 'amendments/', 'amendments',
        `Amendment numbering gap near AMENDMENT-${String(i + 2).padStart(3, '0')}`, `Amendments must be contiguous from 001.`));
  return out;
}

function currentVersion(docs) {
  const v = docs.get('VERSION.md');
  if (!v) return null;
  const m = v.raw.match(/Version\s+(\d+\.\d+\.\d+)/);
  return m ? m[1] : null;
}

// V6 — Version single-source: one current version, echoed by RATIFICATION.
function v6Version({ docs }) {
  const out = [];
  const ver = currentVersion(docs);
  if (!ver) {
    out.push(finding('V6-VERSION', 'V6', SEVERITY.BLOCK, 'VERSION.md', 'version',
      `Could not determine a single current version`, `State one MAJOR.MINOR.PATCH version in VERSION.md.`));
    return out;
  }
  const rat = docs.get('RATIFICATION.md');
  if (rat && !rat.raw.includes(ver))
    out.push(finding('V6-RATIFY', 'V6', SEVERITY.BLOCK, 'RATIFICATION.md', 'version',
      `RATIFICATION.md does not reference current version ${ver}`, `Align RATIFICATION.md to ${ver}.`));
  return out;
}

// V7 — Lifecycle: LIFECYCLE.md present and names the six stages.
function v7Lifecycle({ docs }) {
  const out = [];
  const lc = docs.get('LIFECYCLE.md');
  if (!lc) return [finding('V7-FILE', 'V7', SEVERITY.BLOCK, 'LIFECYCLE.md', 'lifecycle', `LIFECYCLE.md missing`, `Restore the lifecycle policy.`)];
  for (const stage of LIFECYCLE_STAGES)
    if (!lc.raw.includes(stage))
      out.push(finding('V7-STAGE', 'V7', SEVERITY.WARN, 'LIFECYCLE.md', 'lifecycle',
        `Lifecycle stage not documented: ${stage}`, `Document the ${stage} stage.`));
  return out;
}

// V8 — Release notes exist for the current version.
function v8Release({ docs }) {
  const out = [];
  const ver = currentVersion(docs);
  if (!ver) return out; // V6 already blocked
  const rn = `RELEASE-NOTES-v${ver}.md`;
  if (!docs.has(rn))
    out.push(finding('V8-RELEASE', 'V8', SEVERITY.BLOCK, rn, 'release',
      `Release notes missing for current version ${ver}`, `Add ${rn}.`));
  return out;
}

// V9 — Traceability: matrix present with rows (no orphan findings surface).
function v9Traceability({ docs }) {
  const out = [];
  const tm = docs.get('appendices/traceability-matrix.md');
  if (!tm) return [finding('V9-FILE', 'V9', SEVERITY.BLOCK, 'appendices/traceability-matrix.md', 'traceability', `Traceability matrix missing`, `Restore the finding→closure matrix.`)];
  const rows = tm.lines.filter((l) => l.trim().startsWith('|') && l.includes('|', 1)).length;
  if (rows < 3)
    out.push(finding('V9-EMPTY', 'V9', SEVERITY.BLOCK, 'appendices/traceability-matrix.md', 'traceability',
      `Traceability matrix has no closure rows`, `Every audit finding must trace to invariant→program→gate→status.`));
  return out;
}

// V10 — Manifest: JSON valid, YAML present, top-level key parity, census rules present.
function v10Manifest({ docs }) {
  const out = [];
  const jsonDoc = docs.get('dependency-manifest.json');
  const yamlDoc = docs.get('dependency-manifest.yaml');
  if (!jsonDoc) out.push(finding('V10-JSON-FILE', 'V10', SEVERITY.BLOCK, 'dependency-manifest.json', 'manifest', `Manifest JSON missing`, `Restore the machine-readable manifest.`));
  if (!yamlDoc) out.push(finding('V10-YAML-FILE', 'V10', SEVERITY.BLOCK, 'dependency-manifest.yaml', 'manifest', `Manifest YAML missing`, `Restore the manifest YAML.`));
  if (!jsonDoc || !yamlDoc) return out;

  let json;
  try { json = JSON.parse(jsonDoc.raw); }
  catch (e) {
    return [finding('V10-JSON-PARSE', 'V10', SEVERITY.BLOCK, 'dependency-manifest.json', 'manifest', `Manifest JSON does not parse: ${e.message}`, `Fix the JSON syntax.`)];
  }
  const jsonKeys = Object.keys(json).sort();
  // Top-level YAML keys: lines at column 0 of the form `key:` (comments/indented lines excluded).
  const yamlKeys = [...new Set(
    yamlDoc.lines
      .map((l) => l.match(/^([A-Za-z_][A-Za-z0-9_]*):/))
      .filter(Boolean)
      .map((m) => m[1]),
  )].sort();
  const missingInYaml = jsonKeys.filter((k) => !yamlKeys.includes(k));
  const missingInJson = yamlKeys.filter((k) => !jsonKeys.includes(k));
  if (missingInYaml.length || missingInJson.length)
    out.push(finding('V10-PARITY', 'V10', SEVERITY.BLOCK, 'dependency-manifest.{yaml,json}', 'manifest',
      `YAML↔JSON top-level key divergence — only-in-JSON: [${missingInYaml}] only-in-YAML: [${missingInJson}]`,
      `The two manifest encodings must expose the same top-level keys.`));
  for (const rule of CENSUS_RULES)
    if (!jsonDoc.raw.includes(rule))
      out.push(finding('V10-CENSUS', 'V10', SEVERITY.BLOCK, 'dependency-manifest.json', 'manifest',
        `Census rule absent from manifest: ${rule}`, `The nine census rules are permanent manifest data.`));
  return out;
}

// V11 — Constitutional consistency: version string agrees across VERSION/RATIFICATION/README/release-notes.
function v11Consistency({ docs }) {
  const out = [];
  const ver = currentVersion(docs);
  if (!ver) return out;
  for (const f of ['README.md', 'RATIFICATION.md', `RELEASE-NOTES-v${ver}.md`]) {
    const d = docs.get(f);
    if (d && !d.raw.includes(ver))
      out.push(finding('V11-VERSION', 'V11', SEVERITY.BLOCK, f, 'consistency',
        `${f} does not reference the current constitutional version ${ver}`, `Reconcile ${f} to ${ver}.`));
  }
  return out;
}

// STANDARDS — governance-automation program docs carry canonical header + Related footer + unique ids.
function vStandards({ docs }) {
  const out = [];
  const seenIds = new Map();
  for (const [rel, d] of docs) {
    if (!d.isMd) continue;
    const inGaProgram = GA_PROGRAM_DIRS.some((sub) => rel.startsWith(`governance-automation/${sub}/`));
    if (!inGaProgram) continue;
    // Header: "# <ID> — <Title> ..." on the H1.
    if (!d.h1)
      out.push(finding('STD-H1', 'V-standards', SEVERITY.BLOCK, rel, 'header', `No H1 heading`, `Add a "# <ID> — <Title>" header.`));
    else {
      const idm = d.h1.text.match(/^([A-Z0-9-]+)\s+—\s+/);
      if (!idm)
        out.push(finding('STD-HEADER', 'V-standards', SEVERITY.WARN, rel, `line ${d.h1.line}`,
          `H1 is not the canonical "# <ID> — <Title>" form`, `Use "# <ID> — <Title>".`));
      else {
        const id = idm[1];
        if (seenIds.has(id))
          out.push(finding('STD-DUP-ID', 'V-standards', SEVERITY.BLOCK, rel, 'header',
            `Duplicate program identifier ${id} (also in ${seenIds.get(id)})`, `Program identifiers must be globally unique.`));
        else seenIds.set(id, rel);
      }
    }
    // Footer: a "**Related:**" line.
    if (!d.footer)
      out.push(finding('STD-FOOTER', 'V-standards', SEVERITY.WARN, rel, 'footer',
        `Missing "**Related:**" footer`, `Add the canonical Related · Depends on · Reuses · Constitution refs · Migration gate · Classification footer.`));
  }
  return out;
}

const BUILTIN_VALIDATORS = [
  { id: 'STRUCTURE', mapsTo: 'V-struct', run: vStructure },
  { id: 'V1-LINK', mapsTo: 'V1', run: v1Link },
  { id: 'V2-ORPHAN', mapsTo: 'V2', run: v2Orphan },
  { id: 'V4-ADR', mapsTo: 'V4', run: v4Adr },
  { id: 'V5-AMENDMENT', mapsTo: 'V5', run: v5Amendment },
  { id: 'V6-VERSION', mapsTo: 'V6', run: v6Version },
  { id: 'V10-MANIFEST', mapsTo: 'V10', run: v10Manifest },
  { id: 'V9-TRACEABILITY', mapsTo: 'V9', run: v9Traceability },
  { id: 'V3-TERMINOLOGY', mapsTo: 'V3', run: v3Terminology },
  { id: 'V7-LIFECYCLE', mapsTo: 'V7', run: v7Lifecycle },
  { id: 'V8-RELEASE', mapsTo: 'V8', run: v8Release },
  { id: 'V11-CONSISTENCY', mapsTo: 'V11', run: v11Consistency },
  { id: 'STANDARDS', mapsTo: 'V-standards', run: vStandards },
];

// ---------------------------------------------------------------------------
// Extensibility (§7): load additive external validators from ./validators/*.mjs
// ---------------------------------------------------------------------------
async function loadExtensions() {
  const dir = path.join(__dirname, 'validators');
  const extensions = [];
  const warnings = [];
  if (!existsSync(dir)) return { extensions, warnings };
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.mjs')) continue;
    try {
      const mod = await import(pathToFileURL(path.join(dir, name)).href);
      const v = mod.default;
      if (v && typeof v.run === 'function' && v.id) extensions.push(v);
      else warnings.push(finding('EXT-SHAPE', 'V-ext', SEVERITY.WARN, `validators/${name}`, 'extension',
        `Extension does not export { id, run }`, `Default-export { id, mapsTo, severity, run(model) }.`));
    } catch (e) {
      warnings.push(finding('EXT-LOAD', 'V-ext', SEVERITY.WARN, `validators/${name}`, 'extension',
        `Extension failed to load: ${e.message}`, `Fix or remove the extension.`));
    }
  }
  return { extensions, warnings };
}

// ---------------------------------------------------------------------------
// Orchestration + report
// ---------------------------------------------------------------------------
function sortFindings(a, b) {
  return SEV_RANK[a.severity] - SEV_RANK[b.severity]
    || a.rule.localeCompare(b.rule)
    || a.file.localeCompare(b.file)
    || a.section.localeCompare(b.section)
    || a.message.localeCompare(b.message);
}

async function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const strict = argv.includes('--strict');
  const quiet = argv.includes('--quiet');

  const t0 = performance.now();
  const model = buildModel(ROOT);
  const { extensions, warnings: extWarn } = await loadExtensions();

  const findings = [...extWarn];
  const rulesExecuted = [];
  for (const v of [...BUILTIN_VALIDATORS, ...extensions]) {
    rulesExecuted.push(v.id);
    try {
      const res = v.run(model, { ROOT, GA }) || [];
      for (const f of res) findings.push(f);
    } catch (e) {
      findings.push(finding(v.id, v.mapsTo || '-', SEVERITY.WARN, '(runtime)', 'validator',
        `Validator ${v.id} threw: ${e.message}`, `Investigate the validator; other validators still ran.`));
    }
  }
  findings.sort(sortFindings);

  const durationMs = +(performance.now() - t0).toFixed(1);
  const failures = findings.filter((f) => f.severity === SEVERITY.BLOCK).length;
  const warns = findings.filter((f) => f.severity === SEVERITY.WARN).length;
  const documentsScanned = model.mdRelPaths.length;
  const blocking = strict ? failures + warns : failures;

  // Deterministic digest over findings only (excludes timing) — proves repeatability.
  const digestSource = JSON.stringify(findings.map((f) => [f.rule, f.file, f.section, f.message]));
  let h = 5381;
  for (let i = 0; i < digestSource.length; i++) h = ((h * 33) ^ digestSource.charCodeAt(i)) >>> 0;
  const digest = h.toString(16).padStart(8, '0');

  const stats = {
    documentsScanned,
    filesTraversed: model.fileCount,
    rulesExecuted: rulesExecuted.length,
    ruleIds: rulesExecuted,
    failures, warnings: warns,
    successes: rulesExecuted.length - new Set(findings.filter((f) => f.severity === SEVERITY.BLOCK).map((f) => f.rule.split('-')[0])).size,
    durationMs,
    digest,
  };

  if (asJson) {
    process.stdout.write(JSON.stringify({
      tool: 'documentation-validation-runtime',
      runtimeVersion: '1.0.0',
      mapsTo: 'GOV-AUTO-001',
      root: 'docs/company-intelligence',
      result: blocking === 0 ? 'PASS' : 'FAIL',
      stats,
      findings,
    }, null, 2) + '\n');
  } else {
    const L = [];
    L.push('Documentation Validation Runtime — GOV-AUTO-001 (canonical)');
    L.push(`root: docs/company-intelligence  ·  digest: ${digest}`);
    L.push(`documents: ${documentsScanned}  files: ${model.fileCount}  rules: ${rulesExecuted.length}  duration: ${durationMs}ms`);
    L.push(`result: ${blocking === 0 ? 'PASS' : 'FAIL'}   failures(BLOCK): ${failures}   warnings(WARN): ${warns}`);
    if (!quiet && findings.length) {
      L.push('');
      for (const f of findings)
        L.push(`  [${f.severity}] ${f.rule} (${f.mapsTo})  ${f.file}:${f.section}\n        ${f.message}\n        ↳ ${f.recommendation}`);
    }
    if (!findings.length) L.push('\n  no findings — clean.');
    process.stdout.write(L.join('\n') + '\n');
  }

  process.exit(blocking === 0 ? 0 : 1);
}

main();
