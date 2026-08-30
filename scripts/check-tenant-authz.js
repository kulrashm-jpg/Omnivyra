#!/usr/bin/env node
/**
 * HARDEN-007 — tenant-isolation authorization CI guard.
 *
 * The platform uses the Supabase SERVICE-ROLE client, so database RLS is
 * intentionally bypassed and tenant isolation depends on APPLICATION-LAYER
 * authorization. That is fail-open: one API route that reads tenant-owned data
 * by a caller-supplied tenant id, without a membership/authorization check, can
 * expose another tenant's data.
 *
 * This guard makes that class of mistake fail the build. It flags an API route
 * when ALL of these hold:
 *   1. it EXTRACTS a tenant id from the REQUEST (the caller says which tenant —
 *      req.query/body .companyId / company_id / organizationId / organization_id
 *      / orgId / workspaceId / teamId, incl. destructuring), AND
 *   2. it performs RAW service-role DB access (supabase.from / ownedDbTable /
 *      writeOwner), AND
 *   3. it contains NO approved tenant-authorization call (see APPROVED below).
 *
 * Approved authorization mechanisms (any call in the file clears it):
 *   enforceCompanyAccess, requireCapability, requireCampaignAccess,
 *   assertTenantAccess, requireTenantAccess, enforceRole, requireCompanyRole,
 *   withTenantGuard (the HARDEN-007 higher-order wrapper).
 *
 * A per-file suppression `// authz-ok: <reason>` documents a proven-safe route
 * (e.g. it derives the tenant id from the authenticated session, not the
 * request, or the table is not tenant-owned). False positives are DOCUMENTED,
 * never silently ignored.
 *
 * Baseline: the existing debt (routes already matching the pattern) is
 * grandfathered in scripts/tenant-authz-baseline.json. The gate FAILS only on a
 * NEW violation (a file not on the baseline), which is exactly "the build must
 * fail when a new API route accesses tenant data without authorization." Fixing
 * a baseline route (adding a guard / suppression) lets you delete it from the
 * baseline; the guard reports drift both ways.
 *
 * Scope: pages/api/** (the tenant-facing entrypoints; service-layer files are
 * reached THROUGH routes that enforce). Usage: node scripts/check-tenant-authz.js
 * Env: TENANT_AUTHZ_STRICT=0 warns instead of failing (default: fail).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SCAN_DIR = path.join(ROOT, 'pages', 'api');
const BASELINE_PATH = path.join(ROOT, 'scripts', 'tenant-authz-baseline.json');

const APPROVED = [
  // Canonical tenant-access guards.
  'enforceCompanyAccess', 'requireCapability', 'requireCampaignAccess',
  'assertTenantAccess', 'requireTenantAccess', 'enforceRole', 'requireCompanyRole',
  // Documented shim over assertTenantAccess (authMiddleware): verifies an
  // active role in the requested company, 403s otherwise, super-admin bypass.
  'requireCompanyAccess', 'requireCampaignTenantAccess',
  // Pass-through shim over requireTenantAccess (requestAccessService): it calls
  // requireTenantAccess and returns null on refusal, adding no bypass of its
  // own. Certified against company/billing/{ledger,summary} by
  // companyBillingTenantBinding.test.ts (COMPANY-BILLING-BATCH-SEC-001).
  'assertOrgAccess',
  // Thin wrapper that unconditionally calls enforceRole with the request's
  // companyId and returns early unless it passes (backend/middleware/withRBAC).
  'withRBAC',
  'withTenantGuard',
  // RBAC membership/role helpers — a role lookup for the requested company IS a
  // tenant-authorization check (rbacService).
  'getUserCompanyRole', 'getUserRole', 'hasPermission', 'getCompanyRoleIncludingInvited',
  // Platform-admin gates — a super-admin legitimately accesses any tenant, so a
  // super-admin check authorizes the route by design.
  'requireSuperAdmin', 'isPlatformSuperAdmin', 'isSuperAdmin', 'requirePlatformSuperAdmin',
  // The context resolver used internally by enforceCompanyAccess.
  'resolveUserContext',
  // Other confirmed tenant/role access resolvers used by specific route families.
  'resolveCompanyAccess', 'isFinanceAuditor', 'requireCampaignCompanyMatch',
];
const APPROVED_RE = new RegExp(`\\b(?:${APPROVED.join('|')})\\s*\\(`);

// Tenant id pulled FROM THE REQUEST (caller-supplied). Two shapes:
//   req.query.companyId / req.body.company_id / query.companyId / body['org_id']
//   const { companyId } = req.query|body   (destructuring)
const TENANT_KEYS = 'companyId|company_id|organizationId|organization_id|orgId|org_id|workspaceId|workspace_id|teamId|team_id';
const REQ_MEMBER_RE = new RegExp(`(?:req\\s*\\.\\s*(?:query|body)|\\bquery|\\bbody)\\s*(?:\\.\\s*(?:${TENANT_KEYS})\\b|\\[\\s*['"](?:${TENANT_KEYS})['"])`);
const REQ_DESTRUCTURE_RE = new RegExp(`\\{[^}]*\\b(?:${TENANT_KEYS})\\b[^}]*\\}\\s*=\\s*req\\s*\\.\\s*(?:query|body)`);

// Raw service-role DB access.
const DB_RE = /\b(?:supabase|serviceClient|adminClient|serviceRole\w*)\s*\.\s*from\s*\(|\bownedDbTable\s*\(|\bwriteOwner\b/;

const SUPPRESS_RE = /\/\/\s*authz-ok:/;

function walk(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.ts$/.test(e.name) && !/\.(test|spec)\.ts$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(full);
  }
}

/** Decide whether a single source string is a tenant-authz violation. */
function scanSource(src) {
  if (SUPPRESS_RE.test(src)) return { violation: false, reason: 'suppressed' };
  const extractsTenant = REQ_MEMBER_RE.test(src) || REQ_DESTRUCTURE_RE.test(src);
  if (!extractsTenant) return { violation: false, reason: 'no_request_tenant_id' };
  const doesDb = DB_RE.test(src);
  if (!doesDb) return { violation: false, reason: 'no_service_role_db' };
  const hasAuthz = APPROVED_RE.test(src);
  if (hasAuthz) return { violation: false, reason: 'authorized' };
  return { violation: true, reason: 'tenant_data_no_authz' };
}

function loadBaseline() {
  try {
    const raw = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
    return new Set((raw.grandfathered || []).map((p) => p.replace(/\//g, path.sep)));
  } catch {
    return new Set();
  }
}

function scanRepo() {
  const files = [];
  walk(SCAN_DIR, files);
  const violators = [];
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    if (scanSource(src).violation) violators.push(path.relative(ROOT, file));
  }
  return { files, violators };
}

function main() {
  const write = process.argv.includes('--write-baseline');
  const { files, violators } = scanRepo();

  if (write) {
    const payload = {
      _comment: 'HARDEN-007 tenant-authz grandfathered debt. New routes NOT on this list that access tenant data without an approved authorization call fail CI. Fix a route (add enforceCompanyAccess/requireCapability/etc. or a documented `// authz-ok:` comment) then delete it here.',
      grandfathered: violators.map((v) => v.replace(/\\/g, '/')).sort(),
    };
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(payload, null, 2) + '\n');
    console.log(`── tenant-authz guard ──\nwrote baseline: ${violators.length} grandfathered route(s).`);
    process.exit(0);
  }

  const baseline = loadBaseline();
  const strict = String(process.env.TENANT_AUTHZ_STRICT ?? '1') !== '0';
  const newViolations = violators.filter((v) => !baseline.has(v.replace(/\//g, path.sep)) && !baseline.has(v));
  const fixed = [...baseline].filter((b) => !violators.some((v) => v.replace(/\//g, path.sep) === b || v === b));

  console.log('── tenant-authz guard ──');
  console.log(`scanned: ${files.length} API route files under pages/api/**`);
  console.log(`grandfathered debt (baseline): ${baseline.size}`);
  console.log(`currently matching pattern: ${violators.length}`);

  if (fixed.length > 0) {
    console.log(`\n${fixed.length} baseline route(s) no longer match (fixed — remove from baseline):`);
    for (const f of fixed.slice(0, 40)) console.log(`  - ${f.replace(/\\/g, '/')}`);
  }

  if (newViolations.length === 0) {
    console.log('\nRESULT: PASS — no NEW tenant-authz violations.');
    process.exit(0);
  }

  console.log(`\nFound ${newViolations.length} NEW route(s) that read tenant-owned data by a request-supplied`);
  console.log('tenant id via the service-role client WITHOUT an approved authorization call:\n');
  for (const v of newViolations) console.log(`  ${v.replace(/\\/g, '/')}`);
  console.log('\nFix: call an approved guard early in the handler — enforceCompanyAccess({ req, res, companyId }),');
  console.log('requireCapability(...), requireCampaignAccess(...), or wrap the handler in withTenantGuard(...).');
  console.log('If the route is provably safe (tenant id derived from the authenticated session, not the request,');
  console.log('or the table is not tenant-owned), add a documented `// authz-ok: <reason>` comment.');

  if (strict) {
    console.log(`\nRESULT: FAIL (${newViolations.length} new violation(s)). Set TENANT_AUTHZ_STRICT=0 to warn only.`);
    process.exit(1);
  }
  console.log(`\nRESULT: WARN (${newViolations.length} new violation(s)) — TENANT_AUTHZ_STRICT=0.`);
  process.exit(0);
}

module.exports = { scanSource, scanRepo };
if (require.main === module) main();
