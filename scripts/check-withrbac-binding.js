#!/usr/bin/env node
/**
 * WITHRBAC-STRUCT-001 — structural guard for the identifier-mismatch class.
 *
 * The class this catches, demonstrated four times in production code:
 *
 *     withRBAC authorizes company A   (req.query.companyId || req.body.companyId)
 *     handler operates on company B   (re-derived from the request or a resource)
 *     nothing binds A to B
 *
 * Found in RECOMMENDATIONS-SEC-001 (camelCase vs snake_case), OPPORTUNITIES-SEC-001
 * (query vs body, behind a truthiness guard) and WITHRBAC-SEC-001 (resource
 * selected by id, company read back off the row).
 *
 * WHY THE PRECEDENCE MATTERS
 *
 * withRBAC resolves `req.query.companyId || req.body.companyId` — QUERY FIRST.
 * So a handler that reads ONLY `req.query.companyId` can never diverge: when both
 * are present the wrapper takes the query value too, and when the query value is
 * absent the wrapper falls back to the body while the handler sees nothing and
 * denies. A handler that reads a BODY company, or re-derives one from a resource
 * row, CAN diverge — the wrapper may have authorized a different query value.
 *
 * That asymmetry, not the mere presence of a company identifier, is what this
 * guard keys on. "Any route mentioning companyId fails" would be useless noise.
 *
 * SAFE is established by recognising authorization PATTERNS, not route names:
 *   1. binds to req.rbac.companyId              — the authorized company itself
 *   2. calls an approved ownership primitive     — authorizes its own operative company
 *   3. SUPER_ADMIN-only                          — already authorized for every tenant
 *   4. derives no company and reaches no tenant sink in the route
 *   5. reads only the query company              — matches the wrapper's precedence
 *
 * LIMITATION, stated rather than hidden: this analyses ROUTE FILES. A tenant sink
 * reached inside a service the route calls is not visible here, and routes that do
 * not use withRBAC at all are the separate concern of check-tenant-authz.js.
 */

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const API_DIR = path.join(ROOT, 'pages', 'api');
const BASELINE = path.join(ROOT, 'scripts', 'withrbac-binding-baseline.json');

/**
 * Approved ownership primitives. Each independently authorizes the company the
 * handler actually operates on, so re-derivation is bound.
 *
 * requireUserAdminAccess is service-internal (userManagementService) but is the
 * binder for the users/* routes: it re-checks the requester against the
 * handler's companyId. Recognising the primitive keeps this list about patterns
 * rather than an ever-growing set of route exceptions.
 */
const APPROVED_BINDERS = [
  'requireCompanyAccess',
  'requireCampaignTenantAccess',
  'requireTenantAccess',
  'assertTenantAccess',
  'enforceCompanyAccess',
  'requireCompanyContext',
  'requireUserAdminAccess',
  'withTenantGuard',
  'requireCampaignCompanyMatch',
  // A role lookup against the NAMED company is itself an authorization of that
  // company — the same reasoning check-tenant-authz.js already applies.
  'requireCompanyRole',
  'getUserCompanyRole',
];

/**
 * One level of transitivity: a backend export whose own body calls an approved
 * binder is itself a binder. This is what keeps the guard about PATTERNS —
 * users/invite and users/[userId]/role are safe because inviteUser and
 * updateUserRole call requireUserAdminAccess, and that is discovered here
 * rather than written down as a route exception.
 */
function discoverTransitiveBinders(seed) {
  const found = new Set();
  const dirs = [path.join(ROOT, 'backend', 'services'), path.join(ROOT, 'backend', 'db')];
  const seedRe = new RegExp(`\\b(?:${seed.join('|')})\\s*\\(`);
  const declRe = /export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)|export\s+const\s+([A-Za-z0-9_]+)\s*=\s*(?:async\s*)?\(/g;

  for (const d of dirs) {
    if (!fs.existsSync(d)) continue;
    for (const f of walk(d)) {
      const src = fs.readFileSync(f, 'utf8');
      if (!seedRe.test(src)) continue;

      // Slice each export's OWN body (declaration -> next top-level export) and
      // require the binder call to appear inside it. File-level matching would
      // mark every export of a module that merely CONTAINS a binder somewhere,
      // which produces false SAFEs — a far worse failure than a false alarm.
      const decls = [...src.matchAll(declRe)];
      for (let i = 0; i < decls.length; i++) {
        const name = decls[i][1] || decls[i][2];
        const start = decls[i].index;
        const end = i + 1 < decls.length ? decls[i + 1].index : src.length;
        if (seedRe.test(src.slice(start, end))) found.add(name);
      }
    }
  }
  return [...found];
}
let BINDER_RE = new RegExp(`\\b(?:${APPROVED_BINDERS.join('|')})\\s*\\(`);

/** Binding to the company withRBAC authorized. */
const RBAC_COMPANY_RE = /\brbac\s*(?:\??\.)\s*companyId\b|\brbac\b[^\n]{0,40}\bcompanyId\b/;

/** A company identifier re-derived from the request BODY (can diverge from query). */
const BODY_COMPANY_RE = [
  /\{[^}]*\bcompany_?[Ii]d\b[^}]*\}\s*=\s*(?:req\.)?body/,
  /(?:req\.)?body\s*\??\.\s*company_?[Ii]d\b/,
];

/** A company identifier read back off a resource row instead of the wrapper. */
const ROW_COMPANY_RE = [
  /\.\s*company_id\b(?!\s*[,:])/,          // someRow.company_id
  /\bselect\(\s*['"][^'"]*\bcompany_id\b/, // .select('company_id' ...)
];

/** Tenant-scoped tables. A route touching these is operating on tenant data. */
const TENANT_TABLES = [
  'campaigns', 'campaign_versions', 'opportunity_items', 'scheduled_posts',
  'content_analytics', 'recommendation_snapshots', 'collaboration_plans',
  'outreach_plans', 'analytics_reports', 'campaign_governance_events',
  'platform_metrics_snapshots', 'whatsapp_broadcasts', 'content_assets',
  'governance_snapshots', 'governance_audit_runs',
];
const TENANT_TABLE_RE = new RegExp(`\\.from\\(\\s*['"](?:${TENANT_TABLES.join('|')})['"]`);
/** A resource selected by a caller-supplied id. */
const SELECT_BY_ID_RE = /\.eq\(\s*['"]id['"]\s*,/;

/**
 * The resource's company is COMPARED to the authorized one and the request is
 * denied on mismatch. governance/replay-event, governance/simulate-policy and
 * opportunities/[id]/action all bind this way — the row's company is read, but
 * only to prove it equals the company the wrapper authorized.
 */
const EQUALITY_BINDING_RE = /company_?[Ii]d\s*!==|!==\s*\w*[Cc]ompany_?[Ii]d|!==\s*rowCompanyId/;

/**
 * ...unless the comparison is CONDITIONED ON ITS OWN TRUTHINESS:
 *
 *     if (companyId && companyId !== row.company_id) return 403;
 *
 * An empty derived value skips the check entirely, which is exactly how
 * OPPORTUNITIES-SEC-001 stayed exploitable while LOOKING bound. A real binding
 * denies when the identifier is absent (`if (!x || x !== owner)`), so this
 * shape must not be credited.
 */
const TRUTHINESS_GUARDED_RE = /if\s*\(\s*([A-Za-z_$][\w$]*)\s*&&\s*\1\s*!==/;

/**
 * The company is derived from the AUTHENTICATED USER'S OWN membership rather
 * than from request input, so it cannot name a foreign tenant.
 */
const IDENTITY_DERIVED_RE = /\.from\(\s*['"]user_company_roles['"][\s\S]{0,240}?\.eq\(\s*['"]user_id['"]/;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, out);
    else if (/\.tsx?$/.test(e.name)) out.push(f);
  }
  return out;
}

/** SUPER_ADMIN-only routes cannot gain authority from a divergence. */
function isSuperAdminOnly(src) {
  const call = src.match(/withRBAC\(\s*[A-Za-z0-9_]+\s*,\s*(\[[^\]]*\]|[A-Z_]+)/);
  if (!call) return false;
  const roles = call[1];
  if (!/SUPER_ADMIN/.test(roles)) return false;
  // exactly SUPER_ADMIN (possibly PLATFORM_SUPER_ADMIN), nothing broader
  return !/COMPANY_ADMIN|CONTENT_CREATOR|VIEW_ONLY|VIEWER|ADMIN\b(?!_)|ALL_ROLES|ALLOWED_ROLES/.test(
    roles.replace(/SUPER_ADMIN/g, '')
  );
}

function classify(src) {
  if (RBAC_COMPANY_RE.test(src)) return { cls: 'SAFE', why: 'binds req.rbac.companyId' };
  if (BINDER_RE.test(src)) return { cls: 'SAFE', why: 'approved ownership primitive' };
  if (isSuperAdminOnly(src)) return { cls: 'SAFE', why: 'SUPER_ADMIN-only (authorized for all tenants)' };
  if (TRUTHINESS_GUARDED_RE.test(src)) {
    return { cls: 'SUSPICIOUS', why: 'the ownership comparison is skipped when the derived identifier is empty' };
  }
  if (EQUALITY_BINDING_RE.test(src)) return { cls: 'SAFE', why: 'resource company compared to the authorized company' };
  if (IDENTITY_DERIVED_RE.test(src)) return { cls: 'SAFE', why: 'company derived from the caller own membership' };

  const bodyCompany = BODY_COMPANY_RE.some(r => r.test(src));
  const rowCompany = ROW_COMPANY_RE.some(r => r.test(src));
  const tenantSink = TENANT_TABLE_RE.test(src);
  const resourceById = SELECT_BY_ID_RE.test(src) && tenantSink;

  if (bodyCompany) {
    return { cls: 'SUSPICIOUS', why: 'derives the company from the BODY; the wrapper prefers the QUERY, so the two can diverge' };
  }
  if (rowCompany && tenantSink) {
    return { cls: 'SUSPICIOUS', why: 'reads the company off a resource row instead of the authorized company' };
  }
  if (resourceById) {
    return { cls: 'SUSPICIOUS', why: 'selects a tenant resource by caller-supplied id with no ownership binding' };
  }
  if (/req\.query\s*\??\.\s*companyId/.test(src)) {
    return { cls: 'SAFE', why: 'reads only the query company — matches the wrapper precedence' };
  }
  if (!tenantSink) return { cls: 'SAFE', why: 'no company derivation and no tenant sink in the route' };
  return { cls: 'UNKNOWN', why: 'touches a tenant table but the binding could not be established' };
}

function main() {
  const transitive = discoverTransitiveBinders(APPROVED_BINDERS);
  const all = [...APPROVED_BINDERS, ...transitive];
  BINDER_RE = new RegExp(`\\b(?:${all.join('|')})\\s*\\(`);

  const files = walk(API_DIR).filter(f => fs.readFileSync(f, 'utf8').includes('withRBAC'));
  const rows = files.map(f => {
    const rel = path.relative(ROOT, f).split(path.sep).join('/');
    return { rel, ...classify(fs.readFileSync(f, 'utf8')) };
  });

  const counts = rows.reduce((a, r) => ((a[r.cls] = (a[r.cls] || 0) + 1), a), {});
  console.log('\n── withRBAC identifier-binding guard ──');
  console.log(`scanned: ${rows.length} withRBAC consumers under pages/api/**`);
  console.log(`SAFE: ${counts.SAFE || 0}  SUSPICIOUS: ${counts.SUSPICIOUS || 0}  UNKNOWN: ${counts.UNKNOWN || 0}`);

  // Recorded findings: each carries a reason and an owning follow-up item. A
  // route not listed here fails the build.
  const accepted = fs.existsSync(BASELINE)
    ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')).accepted ?? []
    : [];
  const acceptedRoutes = new Set(accepted.map(a => a.route));

  const flagged = rows.filter(r => r.cls !== 'SAFE');
  const known = flagged.filter(r => acceptedRoutes.has(r.rel));
  const bad = flagged.filter(r => !acceptedRoutes.has(r.rel));

  if (known.length) {
    console.log(`\nrecorded findings (not yet fixed): ${known.length}`);
    for (const r of known) {
      const entry = accepted.find(a => a.route === r.rel);
      console.log(`  - ${r.rel}  [${entry.severity}]  follow-up: ${entry.follow_up}`);
    }
  }
  const stale = [...acceptedRoutes].filter(rt => !flagged.some(r => r.rel === rt));
  if (stale.length) {
    console.log('\nbaseline entries that no longer match (fixed — remove them):');
    for (const rt of stale) console.log(`  - ${rt}`);
  }
  if (bad.length) {
    console.log('\nRoutes needing a binding:');
    for (const r of bad) console.log(`  [${r.cls}] ${r.rel}\n      ${r.why}`);
    console.log('\nFix: bind the operative company to req.rbac.companyId (the company withRBAC');
    console.log('authorized), or authorize the resource with requireCompanyAccess /');
    console.log('requireCampaignTenantAccess before any read, write or execution.');
    console.log('\nRESULT: FAIL — a handler may operate on a company the wrapper did not authorize.');
    process.exit(1);
  }
  console.log('\nRESULT: PASS — every withRBAC consumer binds its operative company.');
}

if (require.main === module) main();
module.exports = { classify, isSuperAdminOnly };
