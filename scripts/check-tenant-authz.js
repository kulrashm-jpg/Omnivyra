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
  // AUTHZ-DETECTOR-PARITY-001 — thin wrappers over binders already approved
  // above. Both are PROVENANCE-GATED (see PROVENANCE_REQUIRED): the name alone
  // never clears a route.
  //   requireCompanyContext (companyContextGuardService): rejects a missing
  //   companyId with 400, then delegates to enforceCompanyAccess, which allows
  //   only when assertTenantAccess reports an active membership in an active
  //   org, and answers 401/403/503 itself otherwise.
  //   withOrgAccess (backend/middleware): resolves the org, calls assertOrgAccess
  //   -> requireTenantAccess, returns early unless it passes, and exposes the
  //   authorized org as req.orgAccess.orgId.
  'requireCompanyContext', 'withOrgAccess',
  // REPORTS-BINDER-PARITY-001 — the consolidated reports binder
  // (backend/services/reportsCompanyAccessService). Verifies an ACTIVE
  // membership in the requested company and returns the row's own company_id,
  // so the request value never reaches a sink. Certified by
  // REPORTS-BATCH-SEC-001 (70 tests) before extraction.
  //
  // PROVENANCE IS LOAD-BEARING HERE, not a formality: `resolveCompanyId` is an
  // overloaded name in this repo. lib/content/contentApiHelpers exports a
  // resolveCompanyId(req) used by 13 content routes, and campaigns/
  // performance-insights and settings/execution-config each define their own
  // with different signatures. None of those authorizes anything. Crediting the
  // bare name would clear all of them.
  'resolveCompanyId',
];
const APPROVED_RE = new RegExp(`\\b(?:${APPROVED.join('|')})\\s*\\(`);

/*
 * AUTHZ-DETECTOR-PARITY-001 — recognize the two thin wrappers over binders this
 * detector ALREADY credits, without becoming name-credulous.
 *
 *   requireCompanyContext -> enforceCompanyAccess (already approved)
 *   withOrgAccess         -> assertOrgAccess -> requireTenantAccess (both already approved)
 *
 * Neither addition widens what is authorized; each closes a gap where the
 * detector credited the callee but not the one-line wrapper around it, which is
 * why four independently-audited routes could not leave the baseline.
 *
 * Two precision rules keep the addition from becoming a textual free pass. They
 * exist because the sibling guard (check-orgaccess-binding) shipped a false-SAFE
 * by crediting a wrapper on name/containment alone:
 *
 *   PROVENANCE — these two names count only when imported from the module that
 *   actually implements them, AND actually called. A local look-alike
 *   (`async function requireCompanyContext() { return true }`) is not the
 *   primitive and does not clear a route.
 *
 * SCOPE OF THE PRECISION RULES — deliberately limited to the two names added
 * here. Applying provenance/shadowing to the pre-existing binder list was tried
 * and produced a FALSE POSITIVE: pages/api/super-admin/creator-operations.ts
 * defines its own `isSuperAdmin` that verifies the token via
 * supabase.auth.getUser and 403s unless user_metadata.is_super_admin — a
 * legitimate implementation, not a look-alike. Tightening the older names is a
 * separate change with its own route-level evidence; it is not smuggled in here,
 * and no existing route changes classification because of this file.
 */
const PROVENANCE_REQUIRED = {
  requireCompanyContext: /companyContextGuardService/,
  withOrgAccess: /middleware\/withOrgAccess/,
  resolveCompanyId: /reportsCompanyAccessService/,
};

/** Does this source DEFINE `name` itself (rather than import the real one)? */
function definesLocally(src, name) {
  return new RegExp(
    `(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(` +
    `|(?:const|let|var)\\s+${name}\\s*=\\s*(?:async\\s*)?(?:\\(|function\\b)`
  ).test(src);
}

/** Is `name` imported from a module path matching `pathRe`? */
function importedFrom(src, name, pathRe) {
  const re = new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*['"]([^'"]+)['"]`);
  const m = re.exec(src);
  return !!(m && pathRe.test(m[1]));
}

/**
 * The approved binder this source actually invokes, or null.
 * Requires a CALL (an unused import authorizes nothing), rejects a name the file
 * defines itself, and for the provenance-gated names requires the canonical import.
 */
function approvedBinderInvoked(src) {
  for (const name of APPROVED) {
    if (!new RegExp(`\\b${name}\\s*\\(`).test(src)) continue;
    const prov = PROVENANCE_REQUIRED[name];
    if (prov) {
      /*
       * Provenance-gated: must be the real import, not a same-file look-alike.
       *
       * definesLocally is defence in depth and is REDUNDANT today — mutation
       * testing confirmed removing it changes nothing, because a local
       * definition has no canonical import and so already fails provenance, and
       * a file cannot both import and declare the same binding. It is kept so
       * the local-look-alike case stays closed if provenance is ever relaxed.
       */
      if (definesLocally(src, name)) continue;
      if (!importedFrom(src, name, prov)) continue;
    }
    return name;
  }
  return null;
}

// Tenant id pulled FROM THE REQUEST (caller-supplied). Two shapes:
//   req.query.companyId / req.body.company_id / query.companyId / body['org_id']
//   const { companyId } = req.query|body   (destructuring)
const TENANT_KEYS = 'companyId|company_id|organizationId|organization_id|orgId|org_id|workspaceId|workspace_id|teamId|team_id';
const REQ_MEMBER_RE = new RegExp(`(?:req\\s*\\.\\s*(?:query|body)|\\bquery|\\bbody)\\s*(?:\\.\\s*(?:${TENANT_KEYS})\\b|\\[\\s*['"](?:${TENANT_KEYS})['"])`);
const REQ_DESTRUCTURE_RE = new RegExp(`\\{[^}]*\\b(?:${TENANT_KEYS})\\b[^}]*\\}\\s*=\\s*req\\s*\\.\\s*(?:query|body)`);

// Raw service-role DB access.
const DB_RE = /\b(?:supabase|serviceClient|adminClient|serviceRole\w*)\s*\.\s*from\s*\(|\bownedDbTable\s*\(|\bwriteOwner\b/;

const SUPPRESS_RE = /\/\/\s*authz-ok:/;

/*
 * AUTHZ-PUBLIC-CLASSIFICATION-001 — "intentionally public" as a first-class
 * classification instead of undifferentiated debt.
 *
 * Two independently audited routes (PUBLIC-BLOGS-SEC-001) sat in the
 * grandfathered baseline indistinguishable from genuinely unaudited routes,
 * because this detector had no way to say "unauthenticated ON PURPOSE, and the
 * public contract is actually satisfied". That made the baseline number mean
 * less each time it was used.
 *
 * A DECLARATION IS NOT A CERTIFICATION. `policy: { category: 'public' }` on its
 * own proves nothing — treating it as an exemption would be a self-service
 * authorization bypass. Certification is earned by passing the EXISTING public
 * validator in check-route-policy.js, which is reused wholesale rather than
 * reimplemented here:
 *
 *   V-1  public policy must not carry a tenant source
 *   V-8/9/10  schema version, single declaration, non-placeholder justification
 *   DRIFT-1 / PUB-DRIFT-1  no principal-authorization helper (declaration stale)
 *   PUB-DRIFT-2  service-role reads must carry the status=published filter
 *   PUB-DRIFT-4  no broad select('*') projection
 *   PUB-DRIFT-5  no writes
 *   CONTRACT-DRIFT-1  the justification must name a registered Public Contract
 *
 * Those rules are warn-only in the route-policy inventory. Consuming them here
 * makes them BLOCKING for any route that claims to be public: a public route
 * that fails one is a PUBLIC-VIOLATION and fails the build, which is strictly
 * stronger than the previous behaviour where it was simply baselined debt.
 */
let routePolicy = null;
try {
  // eslint-disable-next-line global-require
  routePolicy = require('./check-route-policy.js');
} catch {
  routePolicy = null; // validator unavailable → no route can be certified public
}

/**
 * @returns null when the file declares no public policy; otherwise the
 * certification verdict for that public route.
 */
/*
 * PROVENANCE — the policy regexes are textual, so a declaration written inside
 * a header comment, or pasted into a doc block as an example, would otherwise
 * read as a real one. Two cheap guards close that:
 *
 *   1. comment-only lines are removed before scanning (this is how a fake
 *      declaration realistically appears — inside a JSDoc block);
 *   2. the declaration must sit inside the createApiRoute(...) call that
 *      actually mounts the route, which is where all four real ones live.
 *
 * A route cannot certify itself by talking about a policy; it has to pass one
 * to the factory. Same lesson as the withOrgAccess wrapper false-SAFE.
 */
function executableSource(src) {
  return src
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
    })
    .join('\n');
}

function publicCertification(src, relPath) {
  if (!routePolicy || typeof routePolicy.scanSource !== 'function') return null;

  const code = executableSource(src);
  // The factory is imported under an alias (`createApiRoute as __createApiRoute`),
  // so the call site is `__createApiRoute(`. No \b anchor: `_` is a word
  // character, so \bcreateApiRoute would never match the aliased call.
  const factoryAt = code.search(/createApiRoute\s*\(/);
  const mounted = factoryAt !== -1 && /\bpolicy\s*:\s*\{/.test(code.slice(factoryAt));
  if (!mounted) return null; // no declaration the route factory actually receives

  const row = routePolicy.scanSource(code);
  if (!row.declared || row.category !== 'public') return null;

  // Fail closed: ANY policy issue or drift finding withdraws certification.
  const failures = [
    ...(row.issues || []),
    ...(routePolicy.checkPolicyDrift(code, relPath, row) || []),
  ].map((f) => f.rule);

  return failures.length === 0
    ? { certified: true }
    : { certified: false, failures: [...new Set(failures)] };
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

/** Decide whether a single source string is a tenant-authz violation. */
function scanSource(src, relPath) {
  if (SUPPRESS_RE.test(src)) return { violation: false, reason: 'suppressed' };

  /*
   * A public route answers to the PUBLIC contract, not to tenant authorization
   * — there is no principal to authorize. This is not a bypass: the public
   * rules above are applied instead, and failing them is a violation here.
   */
  const pub = publicCertification(src, relPath);
  if (pub) {
    return pub.certified
      ? { violation: false, reason: 'public_certified', classification: 'PUBLIC-CERTIFIED' }
      : {
          violation: true,
          reason: 'public_policy_violation',
          classification: 'PUBLIC-VIOLATION',
          failures: pub.failures,
        };
  }

  const extractsTenant = REQ_MEMBER_RE.test(src) || REQ_DESTRUCTURE_RE.test(src);
  if (!extractsTenant) return { violation: false, reason: 'no_request_tenant_id' };
  const doesDb = DB_RE.test(src);
  if (!doesDb) return { violation: false, reason: 'no_service_role_db' };
  const binder = approvedBinderInvoked(src);
  if (binder) return { violation: false, reason: 'authorized', binder };
  /*
   * Fail closed. A name that LOOKS approved but was defined here, imported
   * without being called, or imported from somewhere other than the module that
   * implements it, lands here rather than clearing the route — the detector says
   * it could not establish authorization, which is what the baseline is for.
   */
  if (APPROVED_RE.test(src)) {
    return { violation: true, reason: 'authz_binder_not_established' };
  }
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
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    if (scanSource(src, rel).violation) violators.push(path.relative(ROOT, file));
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
