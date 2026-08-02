#!/usr/bin/env node
/**
 * AUTH-ENFORCEMENT Phase 1 (Task 3a) — route-policy inventory + validation CI gate.
 * Design: docs/security/AUTH-ENFORCEMENT-ARCHITECTURE.md v3 §5 (check:route-policy).
 *
 * Phase 1 modes shipped here:
 *   C-3: §4.1 validation findings reported as WARNINGS — never blocking.
 *   C-4: policy inventory artifact emitted per run (route file → declared? →
 *        category → tenant source) to artifacts/route-policy-inventory.json.
 *        This artifact is the durable "list every public endpoint" answer.
 *
 * Later phases (held dark, per the roadmap): ROUTE_POLICY_STRICT=1 promotes
 * findings to failures (C-2, Phase 2); C-1 (every route must declare) and C-5
 * (category-change diff alert) are Phase 2/3 work and NOT implemented here.
 *
 * Pattern-sibling of scripts/check-tenant-authz.js: plain node, deterministic,
 * read-only scan of pages/api/**, exported scan functions for unit tests.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SCAN_DIR = path.join(ROOT, 'pages', 'api');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts');
const ARTIFACT_PATH = path.join(ARTIFACT_DIR, 'route-policy-inventory.json');

const KNOWN_CATEGORIES = [
  'public', 'authenticated-user', 'tenant-scoped', 'company-scoped', 'admin',
  'super-admin', 'internal', 'worker-cron', 'webhook-receiver',
  'webhook-management', 'system-health',
];

const POLICY_RE = /\bpolicy\s*:\s*\{/;
const CATEGORY_RE = /\bcategory\s*:\s*['"]([a-z-]+)['"]/;
const VERSION_RE = /\bv\s*:\s*(\d+)/;
const TENANT_SOURCE_RE = /\b(companyIdFrom|tenantFrom)\s*:\s*['"]([^'"]+)['"]/;
const JUSTIFICATION_RE = /\bjustification\s*:\s*['"]([^'"]*)['"]/;
const SECRET_RE = /\bsecret\s*:\s*\{/;
const SIGNATURE_RE = /\bsignature\s*:\s*['"][^'"]+['"]/;
const REPLAY_RE = /\breplayWindowSec\s*:\s*\d+/;
const AUDIT_RE = /\baudit\s*:\s*true\b/;
const PLACEHOLDER_JUSTIFICATION_RE = /^(\s*|todo|tbd|placeholder|n\/a|none|x+|\.+)$/i;

/** Scan one route source. Returns the inventory row (+ §4.1 findings). */
function scanSource(src) {
  if (!POLICY_RE.test(src)) {
    return { declared: false, category: null, v: null, tenantSource: null, issues: [] };
  }
  const issues = [];
  const category = (src.match(CATEGORY_RE) || [])[1] || null;
  const vRaw = (src.match(VERSION_RE) || [])[1];
  const v = vRaw === undefined ? null : Number(vRaw);
  const tenantMatch = src.match(TENANT_SOURCE_RE);
  const tenantSource = tenantMatch ? tenantMatch[2] : null;

  const policyCount = (src.match(/\bpolicy\s*:\s*\{/g) || []).length;
  if (policyCount > 1) issues.push({ rule: 'V-9', message: 'more than one policy declaration in file' });
  if (v !== 1) issues.push({ rule: 'V-8', message: `unknown or missing policy schema version v=${v}` });
  if (!category || !KNOWN_CATEGORIES.includes(category)) {
    issues.push({ rule: 'V-8', message: `unknown category '${category}'` });
    return { declared: true, category, v, tenantSource, issues };
  }
  if (category === 'public') {
    if (tenantSource) issues.push({ rule: 'V-1', message: 'public policy carries a tenant source' });
    const just = (src.match(JUSTIFICATION_RE) || [])[1];
    if (just === undefined || PLACEHOLDER_JUSTIFICATION_RE.test(just)) {
      issues.push({ rule: 'V-10', message: 'public policy lacks a non-placeholder justification' });
    }
  }
  if (['tenant-scoped', 'company-scoped', 'admin', 'webhook-management'].includes(category) && !tenantSource) {
    issues.push({ rule: 'V-2', message: `${category} policy has no tenant source` });
  }
  if (['worker-cron', 'internal'].includes(category) && !SECRET_RE.test(src)) {
    issues.push({ rule: 'V-3', message: `${category} policy has no secret reference` });
  }
  if (category === 'webhook-receiver') {
    if (!SIGNATURE_RE.test(src)) issues.push({ rule: 'V-4', message: 'webhook-receiver policy has no signature scheme' });
    if (!REPLAY_RE.test(src)) issues.push({ rule: 'V-5', message: 'webhook-receiver policy has no replayWindowSec' });
  }
  if (category === 'super-admin' && !AUDIT_RE.test(src)) {
    issues.push({ rule: 'V-13', message: 'super-admin policy lacks audit: true' });
  }
  return { declared: true, category, v, tenantSource, issues };
}

// ── Task 3b Batch 1: declaration ↔ implementation consistency (drift; warn-only) ──
// The Batch-1 declarations are mechanically derivable from resolveCompanyAccess
// usage; these checks pin that derivation so FUTURE drift — helper changed or
// removed, or the companyId source moved — is reported. NEVER blocking (not
// even under ROUTE_POLICY_STRICT): drift promotion is a Phase 2 decision.

// resolveCompanyAccess(req, res, X) where X is `req.query.<field>` inline or a
// local variable assigned from `req.query.<field>`.
const RESOLVE_CALL_RE = /resolveCompanyAccess\s*\(\s*req\s*,\s*res\s*,\s*(?:\(?\s*req\s*\.\s*query\s*\.\s*([A-Za-z0-9_]+)|([A-Za-z0-9_$]+))/;

/** Trace the company id the helper consumes → { field, source } | null (no helper). */
function derivedCompanySource(src, relPath) {
  const m = src.match(RESOLVE_CALL_RE);
  if (!m) return null;
  let field = m[1] || null;
  if (!field && m[2]) {
    const decl = src.match(
      new RegExp(`(?:const|let|var)\\s+${m[2]}\\s*=\\s*\\(?\\s*req\\s*\\.\\s*query\\s*\\.\\s*([A-Za-z0-9_]+)`),
    );
    field = decl ? decl[1] : null;
  }
  if (!field) return { field: null, source: null };
  const isPathParam = typeof relPath === 'string' && relPath.includes(`[${field}]`);
  return { field, source: `${isPathParam ? 'path' : 'query'}.${field}` };
}

// ── Task 3b Batch 2a: public-declaration drift (PUB-DRIFT; warn-only) ────────
// Public declarations rest on architectural INTENT, not mechanical derivation
// (§3.7); these rules pin the intent's observable residue. Known limits per
// §4.2: service-layer indirection, column-emission changes, and store/view
// redefinition are NOT detectable here — human-review properties.

// Principal-authorization signals: the check-tenant-authz APPROVED helper set
// plus the identity resolvers themselves.
const AUTH_SIGNAL_HELPERS = [
  'enforceCompanyAccess', 'requireCapability', 'requireCampaignAccess',
  'assertTenantAccess', 'requireTenantAccess', 'enforceRole', 'requireCompanyRole',
  'withTenantGuard', 'getUserCompanyRole', 'getUserRole', 'hasPermission',
  'getCompanyRoleIncludingInvited', 'requireSuperAdmin', 'isPlatformSuperAdmin',
  'isSuperAdmin', 'requirePlatformSuperAdmin', 'resolveUserContext',
  'resolveCompanyAccess', 'isFinanceAuditor', 'requireCampaignCompanyMatch',
  'getSupabaseUserFromRequest', 'resolvePrincipal',
];
const AUTH_SIGNAL_RE = new RegExp(`\\b(?:${AUTH_SIGNAL_HELPERS.join('|')})\\s*\\(`);
const DB_READ_RE = /\b(?:supabase|serviceClient|adminClient|serviceRole\w*)\s*\.\s*from\s*\(|\bownedDbTable\s*\(/;
const PUBLISHED_FILTER_RE = /\.eq\(\s*['"]status['"]\s*,\s*['"]published['"]\s*\)/;
const PUBLIC_CACHE_RE = /Cache-Control[^\n]*(?:\bpublic\b|s-maxage)/;

// ── Task 3b Batch 2b: Contract Drift (design §3.7/§3.8; warn-only) ───────────
// Public Contract registry — mirror of the §3.7 table. CONTRACT-DRIFT-1 checks
// registry MEMBERSHIP (the mechanizable proxy); contract BEHAVIOR remains
// human-reviewed per §4.2.
const PUBLIC_CONTRACTS = [
  'Published Content',
  'Search Engine Content',
  'Embeddable Content',
  'Embeddable Configuration',
];
const CONTRACT_LABEL_RE = /Contract:\s*([^.]+)\./;
const FORM_ORIGIN_RE = /\bcheckFormOrigin\s*\(/;

/**
 * Drift warnings for a DECLARED route (undeclared routes are Phase-2 scope).
 * `row` may be passed to avoid a second scan.
 */
function checkPolicyDrift(src, relPath, row) {
  const scanned = row || scanSource(src);
  if (!scanned.declared) return [];
  const drift = [];
  const helper = derivedCompanySource(src, relPath);
  if (helper) {
    if (scanned.category !== 'company-scoped') {
      drift.push({
        rule: 'DRIFT-1',
        message: `resolveCompanyAccess present but declared category is '${scanned.category}' (expected 'company-scoped')`,
      });
    } else if (helper.source === null) {
      drift.push({
        rule: 'DRIFT-3',
        message: 'resolveCompanyAccess argument could not be traced to a request field — verify companyIdFrom manually',
      });
    } else if (scanned.tenantSource !== helper.source) {
      drift.push({
        rule: 'DRIFT-2',
        message: `declared companyIdFrom '${scanned.tenantSource}' but the helper consumes '${helper.source}'`,
      });
    }
  } else if (scanned.category === 'company-scoped') {
    drift.push({
      rule: 'DRIFT-4',
      message: "declared 'company-scoped' but no resolveCompanyAccess call found — helper changed or removed without updating the policy",
    });
  }

  if (scanned.category === 'public') {
    // DRIFT-1 already diagnoses resolveCompanyAccess-vs-public precisely;
    // PUB-DRIFT-1 covers every OTHER principal-authorization signal.
    if (!drift.some((d) => d.rule === 'DRIFT-1') && AUTH_SIGNAL_RE.test(src)) {
      drift.push({
        rule: 'PUB-DRIFT-1',
        message: "declared 'public' but a principal-authorization helper appears in the file — declaration stale or route no longer public",
      });
    }
    if (DB_READ_RE.test(src) && !PUBLISHED_FILTER_RE.test(src)) {
      drift.push({
        rule: 'PUB-DRIFT-2',
        message: "declared 'public' with in-file service-role DB reads and no status=published filter — published-only constraint may have been removed",
      });
    }
    // Contract Drift (v5 layer). CONTRACT-DRIFT-1: every public declaration
    // must name a registry contract.
    const justification = (src.match(JUSTIFICATION_RE) || [])[1] || '';
    const contractMatch = justification.match(CONTRACT_LABEL_RE);
    const contract = contractMatch ? contractMatch[1].trim() : null;
    if (!contract || !PUBLIC_CONTRACTS.includes(contract)) {
      drift.push({
        rule: 'CONTRACT-DRIFT-1',
        message: contract
          ? `justification names unknown Public Contract '${contract}' — not in the §3.7 registry`
          : 'public justification does not name a Public Contract (Contract: <name>.)',
      });
    }
    if (contract === 'Embeddable Configuration' && !FORM_ORIGIN_RE.test(src)) {
      drift.push({
        rule: 'FORM-DRIFT-1',
        message: 'Embeddable Configuration contract declared but no checkFormOrigin call found — Delivery Trust origin validation removed',
      });
      if (AUTH_SIGNAL_RE.test(src)) {
        drift.push({
          rule: 'FORM-DRIFT-2',
          message: 'origin validation appears REPLACED by principal authorization — the public declaration and its contract are both stale',
        });
      }
    }
  } else if (scanned.category && KNOWN_CATEGORIES.includes(scanned.category)) {
    if (PUBLIC_CACHE_RE.test(src)) {
      drift.push({
        rule: 'PUB-DRIFT-3',
        message: `declared '${scanned.category}' but the source emits a shared-cache directive (public/s-maxage) — INV-6 exposure risk`,
      });
    }
  }
  return drift;
}

function walk(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.ts$/.test(e.name) && !/\.(test|spec)\.ts$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(full);
  }
}

function scanRepo() {
  const files = [];
  walk(SCAN_DIR, files);
  const routes = files.map((file) => {
    const src = fs.readFileSync(file, 'utf8');
    const relFile = path.relative(ROOT, file).replace(/\\/g, '/');
    const row = scanSource(src);
    const drift = checkPolicyDrift(src, relFile, row);
    return { file: relFile, ...row, drift };
  });
  return routes;
}

/** C-4 inventory document. Deterministic apart from generatedAt. */
function buildInventory(routes, generatedAt) {
  return {
    schema: 1,
    generatedAt,
    totals: {
      routes: routes.length,
      declared: routes.filter((r) => r.declared).length,
      undeclared: routes.filter((r) => !r.declared).length,
      withIssues: routes.filter((r) => r.issues.length > 0).length,
      withDrift: routes.filter((r) => (r.drift || []).length > 0).length,
    },
    routes,
  };
}

function writeInventory(inventory, dir = ARTIFACT_DIR) {
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, 'route-policy-inventory.json');
  fs.writeFileSync(target, JSON.stringify(inventory, null, 2) + '\n');
  return target;
}

function main() {
  const routes = scanRepo();
  const inventory = buildInventory(routes, new Date().toISOString());
  const target = writeInventory(inventory);

  const findings = routes.filter((r) => r.issues.length > 0);
  // Phase 1 default is WARN (C-3). ROUTE_POLICY_STRICT=1 is the Phase 2 (C-2)
  // promotion switch — deliberately opposite of TENANT_AUTHZ_STRICT's default
  // because no blocking mode is approved yet.
  const strict = String(process.env.ROUTE_POLICY_STRICT ?? '0') === '1';

  console.log('── route-policy gate (Phase 1: warn + inventory) ──');
  console.log(`scanned: ${inventory.totals.routes} API route files under pages/api/**`);
  console.log(`declared policies: ${inventory.totals.declared}`);
  console.log(`undeclared routes: ${inventory.totals.undeclared}`);
  console.log(`inventory artifact: ${path.relative(ROOT, target).replace(/\\/g, '/')}`);

  if (findings.length > 0) {
    console.log(`\n${findings.length} declaration(s) with §4.1 findings:`);
    for (const f of findings) {
      for (const i of f.issues) console.log(`  [${i.rule}] ${f.file}: ${i.message}`);
    }
  }

  // Drift is ALWAYS warn-only — excluded from strict promotion by design
  // (Task 3b Batch 1); promotion is a Phase 2 decision.
  const drifted = routes.filter((r) => (r.drift || []).length > 0);
  if (drifted.length > 0) {
    console.log(`\n${drifted.length} declaration(s) drifting from their implementation (warn-only):`);
    for (const d of drifted) {
      for (const i of d.drift) console.log(`  [${i.rule}] ${d.file}: ${i.message}`);
    }
  }

  if (strict && findings.length > 0) {
    console.log(`\nRESULT: FAIL (${findings.length} finding(s)) — ROUTE_POLICY_STRICT=1.`);
    process.exit(1);
  }
  console.log(`\nRESULT: ${findings.length > 0 ? `WARN (${findings.length} finding(s), non-blocking in Phase 1)` : 'PASS'}.`);
  process.exit(0);
}

module.exports = { scanSource, scanRepo, buildInventory, writeInventory, checkPolicyDrift, derivedCompanySource, ARTIFACT_PATH };
if (require.main === module) main();
