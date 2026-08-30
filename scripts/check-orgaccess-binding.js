#!/usr/bin/env node
/**
 * ORGACCESS-BINDING-SEC-001 — structural guard for the withOrgAccess
 * identifier-mismatch class.
 *
 * The class this catches, demonstrated four times in production code
 * (checkout/create-order, checkout/verify, checkout/close, usage/track):
 *
 *     withOrgAccess authorizes organization A
 *     handler operates on organization B (re-derived from the request)
 *     nothing binds A to B
 *
 * WHY THE PRECEDENCE MATTERS — AND WHY IT DIFFERS FROM withRBAC
 *
 * withOrgAccess resolves the organization it authorizes as:
 *
 *     req.query.org_id || body.org_id || body.organization_id || body.companyId
 *
 * Two consequences, both of which produced real defects:
 *
 *   1. QUERY FIRST. A handler reading a BODY organization can diverge, because
 *      a query org_id the handler never looks at wins the authorization. That
 *      is checkout/{create-order,verify,close}.
 *
 *   2. THE BODY ITSELF IS ORDERED. org_id beats organization_id beats
 *      companyId. So a handler whose own preference differs from the
 *      resolver's diverges with NO query string at all. That is usage/track,
 *      which preferred body.companyId while the resolver prefers body.org_id.
 *
 * Because of (2) this guard is stricter than the withRBAC one: ANY body-derived
 * organization in the handler is suspicious, not merely a body/query mismatch.
 * A handler reading ONLY req.query.org_id is safe — that is the resolver's first
 * branch, so the value it uses is definitionally the value authorized.
 *
 * SAFE is established by recognising PATTERNS, never route or service names:
 *   1. binds req.orgAccess              — the organization actually authorized
 *   2. calls an approved access primitive — authorizes its own operative org
 *   3. reads the guard-seeded request context org — server-owned
 *   4. compares the resource org to the authorized org and denies on mismatch
 *   5. super-admin-only                 — already authorized for every tenant
 *   6. reads only the query org         — matches the resolver's first branch
 *   7. derives no org and reaches no tenant sink, in the route or one level down
 *
 * LIMITATIONS, stated rather than hidden:
 *   - Service tracing is exactly ONE level. When a tenant-named parameter is
 *     handed onward past that depth, safety cannot be established, so the
 *     result is SUSPICIOUS rather than SAFE.
 *   - Only statically resolvable relative imports are followed; anything else
 *     is reported UNKNOWN rather than assumed safe.
 *   - Fails closed: an unrecognised pattern that touches a tenant table is
 *     UNKNOWN, never silently SAFE.
 *   - Routes that do not use withOrgAccess are check-tenant-authz.js's and
 *     check-withrbac-binding.js's concern.
 */

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const API_DIR = path.join(ROOT, 'pages', 'api');
const BASELINE = path.join(ROOT, 'scripts', 'orgaccess-binding-baseline.json');

/**
 * Approved access primitives. Each independently authorizes the organization
 * the handler operates on, so a re-derivation downstream of one is bound.
 */
const APPROVED_BINDERS = [
  'assertOrgAccess',
  'requireTenantAccess',
  'assertTenantAccess',
  'requireCompanyAccess',
  'enforceCompanyAccess',
  'requireCompanyContext',
  'withTenantGuard',
  'requireCampaignTenantAccess',
  // A role lookup against the NAMED organization is itself an authorization of
  // it — the same reasoning check-tenant-authz.js applies.
  'requireCompanyRole',
  'getUserCompanyRole',
];

/**
 * One level of transitivity, body-precise: a backend export whose OWN body
 * calls an approved binder is itself a binder. Slicing each export's own body
 * matters — file-level matching would mark every export of a module that merely
 * contains a binder somewhere, producing false SAFEs, which is a far worse
 * failure for this guard than a false alarm.
 */
/**
 * The wrapper itself can NEVER be credited as a binder.
 *
 * withOrgAccess calls assertOrgAccess, so naive transitive discovery promotes
 * withOrgAccess to a "binder" — and since every scanned route calls it, every
 * route classifies SAFE. That is the exact false-SAFE this guard exists to
 * prevent: the wrapper's authorization is precisely the thing the handler may
 * diverge from. backend/middleware is excluded from discovery for the same
 * reason, and the name is denied explicitly in case it is re-exported.
 */
const NEVER_BINDERS = new Set(['withOrgAccess']);

function discoverTransitiveBinders(seed) {
  const found = new Set();
  const dirs = [path.join(ROOT, 'backend', 'services')];
  const seedRe = new RegExp(`\\b(?:${seed.join('|')})\\s*\\(`);
  const declRe = /export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)|export\s+const\s+([A-Za-z0-9_]+)\s*=\s*(?:async\s*)?\(/g;

  for (const d of dirs) {
    if (!fs.existsSync(d)) continue;
    for (const f of walk(d)) {
      const src = fs.readFileSync(f, 'utf8');
      if (!seedRe.test(src)) continue;
      const decls = [...src.matchAll(declRe)];
      for (let i = 0; i < decls.length; i++) {
        const name = decls[i][1] || decls[i][2];
        const start = decls[i].index;
        const end = i + 1 < decls.length ? decls[i + 1].index : src.length;
        if (!NEVER_BINDERS.has(name) && seedRe.test(src.slice(start, end))) found.add(name);
      }
    }
  }
  return [...found];
}
let BINDER_RE = new RegExp(`\\b(?:${APPROVED_BINDERS.join('|')})\\s*\\(`);

/** Binding to the organization withOrgAccess authorized. */
const ORG_ACCESS_RE = /\borgAccess\s*(?:\??\.)\s*(?:orgId|userId|superAdmin)\b|\borgAccess\b[^\n]{0,40}\borgId\b/;

/**
 * The guard seeds the request context with the org it validated
 * (requireTenantAccess -> seedRequestContextFromRequest{ orgId }). Reading it
 * back is server-owned, not caller-controlled.
 */
const CONTEXT_ORG_RE = /getRequestContext\s*\(\s*\)\s*(?:\??\.)\s*orgId\b/;

/**
 * An organization identifier re-derived from the request BODY. Suspicious even
 * without a query string, because the resolver's own body precedence
 * (org_id > organization_id > companyId) may differ from the handler's.
 */
const BODY_ORG_RE = [
  /\{[^}]*\b(?:org_?id|organization_?id|company_?id)\b[^}]*\}\s*=\s*(?:req\.)?body/i,
  /(?:req\.)?body\s*\??\.\s*(?:org_?id|organization_?id|company_?id)\b/i,
];

/** An organization read back off a resource row instead of from the wrapper. */
const ROW_ORG_RE = [
  /\.\s*organization_id\b(?!\s*[,:])/,
  /\bselect\(\s*['"][^'"]*\borganization_id\b/,
];

/** Tenant-scoped tables keyed by organization. */
const TENANT_TABLES = [
  'credit_purchases', 'credit_transactions', 'credit_packages', 'invoices',
  'invoice_line_items', 'usage_events', 'usage_daily_rollups', 'organizations',
  'companies', 'v_reservation_health', 'billing_profiles', 'org_subscriptions',
  'payment_orders', 'wallets', 'credit_wallets',
];
const TENANT_TABLE_RE = new RegExp(
  `(?:\\.from|ownedDbTable)\\(\\s*['"](?:${TENANT_TABLES.join('|')})['"]`
);

/** A resource selected by a caller-supplied id. */
const SELECT_BY_ID_RE = /\.eq\(\s*['"]id['"]\s*,/;

/**
 * The resource's organization is COMPARED to the authorized one and the request
 * denied on mismatch — e.g. invoices/[id]/pdf, which reads the row's
 * organization_id only to prove it equals the authorized org.
 */
const EQUALITY_BINDING_RE = /organization_?[Ii]d\s*!==|!==\s*\w*[Oo]rg(?:anization)?_?[Ii]d\b/;

/**
 * ...unless the comparison is CONDITIONED ON ITS OWN TRUTHINESS:
 *
 *     if (orgId && orgId !== row.organization_id) return 403;
 *
 * An empty derived value skips the check entirely, which is how a route can
 * look bound while staying exploitable. A real binding denies when the
 * identifier is absent, so this shape must not be credited.
 */
const TRUTHINESS_GUARDED_RE = /if\s*\(\s*([A-Za-z_$][\w$]*)\s*&&\s*\1\s*!==/;

/** Super-admin gates: a super admin is legitimately authorized for any tenant. */
const SUPER_ADMIN_ONLY_RE = /\b(?:requireSuperAdmin|requirePlatformSuperAdmin)\s*\(/;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, out);
    else if (/\.tsx?$/.test(e.name)) out.push(f);
  }
  return out;
}

/* ─────────────────────────────────────────────────────────────────────────
 * One level of service tracing — the route may show no tenant sink of its own
 * while handing a caller-controlled value to a service that resolves the
 * tenant itself.
 * ───────────────────────────────────────────────────────────────────────── */

const TAINT_SOURCE_RE = /req\s*\.\s*(?:query|body)\s*\??\s*(?:\.\s*[A-Za-z_$][\w$]*|\[)/;
const TENANT_PARAM_RE = /^(?:company_?id|org(?:anization)?_?id|tenant_?id)$/i;
const INERT_CALLS = new Set([
  'String', 'Number', 'Boolean', 'JSON', 'Array', 'Object', 'parseInt', 'parseFloat',
  'encodeURIComponent', 'decodeURIComponent', 'console', 'expect', 'trim', 'toString',
  'require', 'slice', 'includes',
]);

function collectTaintedLocals(src) {
  const tainted = new Set();
  for (const m of src.matchAll(/const\s*\{([^}]*)\}\s*=\s*req\s*\.\s*(?:body|query)\b/g)) {
    for (const part of m[1].split(',')) {
      const name = part.split(':').pop().split('=')[0].trim();
      if (name) tainted.add(name);
    }
  }
  for (const m of src.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]*)/g)) {
    if (TAINT_SOURCE_RE.test(m[2])) tainted.add(m[1]);
  }
  // A local derived from an already-tainted `body` object counts too.
  for (const m of src.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]*)/g)) {
    if (/\bbody\s*\??\./.test(m[2]) && tainted.has('body')) tainted.add(m[1]);
  }
  for (const m of src.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*[;\n]/g)) {
    if (tainted.has(m[2])) tainted.add(m[1]);
  }
  return tainted;
}

function collectImports(src, routeFile) {
  const map = new Map();
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"](\.[^'"]+)['"]/g)) {
    const base = path.resolve(path.dirname(routeFile), m[2]);
    let file = null;
    for (const cand of [base + '.ts', base + '.tsx', path.join(base, 'index.ts')]) {
      if (fs.existsSync(cand)) { file = cand; break; }
    }
    if (!file) continue;
    for (const part of m[1].split(',')) {
      const name = part.replace(/\s+as\s+.*/, '').trim();
      if (name) map.set(name, file);
    }
  }
  return map;
}

function resolveFunction(file, name) {
  const src = fs.readFileSync(file, 'utf8');
  const re = new RegExp(
    `export\\s+(?:async\\s+)?function\\s+${name}\\s*\\(|export\\s+const\\s+${name}\\s*=\\s*(?:async\\s*)?\\(`
  );
  const m = re.exec(src);
  if (!m) return null;

  let i = src.indexOf('(', m.index);
  let depth = 0, end = i;
  for (; end < src.length; end++) {
    if (src[end] === '(') depth++;
    else if (src[end] === ')') { depth--; if (depth === 0) break; }
  }
  const paramSrc = src.slice(i + 1, end);
  const params = [];
  let d = 0, cur = '';
  for (const ch of paramSrc) {
    if ('({['.includes(ch)) d++;
    if (')}]'.includes(ch)) d--;
    if (ch === ',' && d === 0) { params.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) params.push(cur);
  const names = params.map(p => {
    const t = p.split(':')[0].split('=')[0].trim();
    return /^[A-Za-z_$][\w$]*$/.test(t) ? t : null;
  });

  const after = src.slice(end);
  const nextExport = after.search(/\nexport\s/);
  return { params: names, body: nextExport === -1 ? after : after.slice(0, nextExport) };
}

function paramReachesTenantSink(body, param) {
  if (!param) return { hit: false };
  const p = param.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const direct = [
    [new RegExp(`\\.eq\\(\\s*['"]organization_id['"]\\s*,\\s*${p}\\b`), `.eq('organization_id', ${param})`],
    [new RegExp(`\\.in\\(\\s*['"]organization_id['"]\\s*,\\s*${p}\\b`), `.in('organization_id', ${param})`],
    [new RegExp(`organization_id\\s*:\\s*${p}\\b`), `organization_id: ${param} (insert/update payload)`],
    [new RegExp(`company_?[Ii]d\\s*:\\s*${p}\\b`), `companyId: ${param} (tenant attribution)`],
    [new RegExp(`\\.eq\\(\\s*['"]id['"]\\s*,\\s*${p}\\b[\\s\\S]{0,200}?organization_id`), `resource selected by ${param} in a tenant table`],
  ];
  for (const [re, label] of direct) if (re.test(body)) return { hit: true, sink: label };

  if (TENANT_TABLE_RE.test(body) && new RegExp(`\\b${p}\\b`).test(body)) {
    return { hit: true, sink: `${param} used in a body that queries a tenant table` };
  }

  // Handed onward past our depth limit. Restricted to TENANT-NAMED parameters:
  // "the value goes somewhere we cannot follow" is only a finding when the value
  // is a tenant identifier, otherwise the guard manufactures alarms.
  if (TENANT_PARAM_RE.test(param)) {
    const onward = [...body.matchAll(/([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/g)]
      .find(c => !INERT_CALLS.has(c[1]) && new RegExp(`\\b${p}\\b`).test(c[2]));
    if (onward) return { hit: true, sink: `passed onward to ${onward[1]}() — beyond one level` };
  }
  return { hit: false };
}

function traceServiceCalls(src, routeFile) {
  if (!routeFile) return null;
  const tainted = collectTaintedLocals(src);
  if (!tainted.size) return null;
  const imports = collectImports(src, routeFile);
  if (!imports.size) return null;

  for (const call of src.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/g)) {
    const fnName = call[1];
    if (!imports.has(fnName) || INERT_CALLS.has(fnName)) continue;

    const args = call[2].split(',').map(a => a.trim());
    for (let i = 0; i < args.length; i++) {
      if (!tainted.has(args[i])) continue;
      const fn = resolveFunction(imports.get(fnName), fnName);
      if (!fn) return { chain: `${args[i]} -> ${fnName}() [implementation not statically resolvable]`, unknown: true };
      const param = fn.params[i];
      if (!param) return { chain: `${args[i]} -> ${fnName}() arg ${i} [destructured parameter, not traceable]`, unknown: true };
      const r = paramReachesTenantSink(fn.body, param);
      if (r.hit) return { chain: `req input -> ${args[i]} -> ${fnName}(arg ${i} = ${param}) -> ${r.sink}` };
    }
  }
  return null;
}

function classify(src, routeFile) {
  // A truthiness-guarded comparison must be judged BEFORE the binding rules,
  // otherwise a route that looks bound is credited for a check it skips.
  if (TRUTHINESS_GUARDED_RE.test(src)) {
    return { cls: 'SUSPICIOUS', why: 'the ownership comparison is skipped when the derived identifier is empty' };
  }
  if (ORG_ACCESS_RE.test(src)) return { cls: 'SAFE', why: 'binds req.orgAccess (the authorized organization)' };
  if (BINDER_RE.test(src)) return { cls: 'SAFE', why: 'approved org-access primitive' };
  if (CONTEXT_ORG_RE.test(src)) return { cls: 'SAFE', why: 'reads the guard-seeded request-context org (server-owned)' };
  if (SUPER_ADMIN_ONLY_RE.test(src)) return { cls: 'SAFE', why: 'super-admin-only (authorized for all tenants)' };

  const bodyOrg = BODY_ORG_RE.some(r => r.test(src));

  /*
   * An equality check only BINDS when the value compared against is itself
   * bound. checkout/verify compared the purchase's organization_id to an org
   * re-derived from the body — so an attacker naming the victim in the body
   * satisfied the comparison against the victim's own row and passed. Crediting
   * that shape produced a false SAFE for a route that was actively exploitable,
   * so the comparison is credited only when no body-derived org is in play.
   */
  if (!bodyOrg && EQUALITY_BINDING_RE.test(src)) {
    return { cls: 'SAFE', why: 'resource organization compared to the authorized organization' };
  }

  const rowOrg = ROW_ORG_RE.some(r => r.test(src));
  const tenantSink = TENANT_TABLE_RE.test(src);
  const resourceById = SELECT_BY_ID_RE.test(src) && tenantSink;

  if (bodyOrg) {
    return {
      cls: 'SUSPICIOUS',
      why: 'derives the organization from the BODY; the resolver prefers the QUERY and orders body keys org_id > organization_id > companyId, so the two can diverge',
    };
  }
  if (rowOrg && tenantSink) {
    return { cls: 'SUSPICIOUS', why: 'reads the organization off a resource row instead of the authorized organization' };
  }
  if (resourceById) {
    return { cls: 'SUSPICIOUS', why: 'selects a tenant resource by caller-supplied id with no ownership binding' };
  }
  if (/req\.query\s*\??\.\s*org_id/.test(src)) {
    // Query-only cannot diverge: it IS the resolver's first branch, so the org
    // the handler uses is the org the wrapper authorized.
    return { cls: 'SAFE', why: 'reads only the query org_id — matches the resolver precedence' };
  }

  const traced = traceServiceCalls(src, routeFile);
  if (traced) {
    return {
      cls: traced.unknown ? 'UNKNOWN' : 'SUSPICIOUS',
      why: `caller-controlled input reaches a tenant operation one service level down: ${traced.chain}`,
    };
  }

  if (!tenantSink) return { cls: 'SAFE', why: 'no org derivation and no tenant sink, in the route or one service level down' };
  return { cls: 'UNKNOWN', why: 'touches a tenant table but the binding could not be established' };
}

function main() {
  const transitive = discoverTransitiveBinders(APPROVED_BINDERS);
  BINDER_RE = new RegExp(`\\b(?:${[...APPROVED_BINDERS, ...transitive].join('|')})\\s*\\(`);

  const files = walk(API_DIR).filter(f => fs.readFileSync(f, 'utf8').includes('withOrgAccess'));
  const rows = files.map(f => {
    const rel = path.relative(ROOT, f).split(path.sep).join('/');
    return { rel, ...classify(fs.readFileSync(f, 'utf8'), f) };
  });

  const counts = rows.reduce((a, r) => ((a[r.cls] = (a[r.cls] || 0) + 1), a), {});
  console.log('\n── withOrgAccess identifier-binding guard ──');
  console.log(`scanned: ${rows.length} withOrgAccess consumers under pages/api/**`);
  console.log(`SAFE: ${counts.SAFE || 0}  SUSPICIOUS: ${counts.SUSPICIOUS || 0}  UNKNOWN: ${counts.UNKNOWN || 0}`);

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
    console.log('\nFix: bind the operative organization to req.orgAccess.orgId (the organization');
    console.log('withOrgAccess authorized), or authorize the resource with an approved primitive');
    console.log('before any read, write, provider call or tenant attribution.');
    console.log('\nRESULT: FAIL — a handler may operate on an organization the wrapper did not authorize.');
    process.exit(1);
  }
  console.log('\nRESULT: PASS — every withOrgAccess consumer binds its operative organization.');
}

if (require.main === module) main();
module.exports = { classify };
