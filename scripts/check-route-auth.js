#!/usr/bin/env node
/**
 * ROUTE-AUTH-001 (STEP 3AH-85) — default-deny authentication gate for pages/api.
 *
 * WHY THIS EXISTS
 * ---------------
 * `createApiRoute` (lib/platform/routeFactory.ts) wraps every route in
 * observability and request context, but performs NO authentication, and
 * proxy.ts passes every /api request through ("API routes handle their own
 * auth"). Authentication and tenant authorization are therefore opt-in per
 * route. STEP 3AH-84 found live routes that read, wrote and deleted tenant data
 * with no authentication at all, because nothing machine-checked the opt-in.
 *
 * The older detector (check-tenant-authz.js) only fires when a route extracts a
 * `companyId`-style key AND calls supabase.from() in the route file, so routes
 * keyed by `campaignId`, `[id]`, `noteId`, `user_id`, or that delegate to a
 * service, were invisible to it. This gate closes that class structurally:
 *
 *   R1  AUTHENTICATION — every route must INVOKE an approved authentication
 *       primitive (provenance-checked: imported from the module that implements
 *       it, and called), directly or through a verified delegation chain; or be
 *       declared in scripts/route-auth-allowlist.json with a reviewed kind whose
 *       mechanical evidence is re-verified here on every run.
 *
 *   R2  TENANT BINDING — a route that takes an object/tenant identifier from the
 *       request (query/body key ending in Id/_id, or a dynamic [segment]) must
 *       invoke a TENANT- or PLATFORM-level primitive, not merely establish who
 *       the caller is. Routes whose ids are scoped to the caller's own user are
 *       declared `identity-scoped` in the allowlist with a reviewed reason.
 *
 *   R3  CAMPAIGN BINDING — a route keyed by a campaign id must bind the campaign
 *       to the authorized tenant: requireCampaignAccess /
 *       requireCampaignTenantAccess, or enforceCompanyAccess called WITH the
 *       campaignId (which, since ROUTE-AUTH-001, verifies ownership).
 *
 *   R4  FAIL-OPEN SHAPES — `const x = process.env.SECRET; if (x) { ...check... }`
 *       authenticates only when the operator remembered to set the secret. It is
 *       a violation wherever it appears in a route.
 *
 * WHAT DOES NOT COUNT
 * -------------------
 *   - a primitive's NAME in a comment, a string, or an unused import;
 *   - a same-named local function (e.g. a local `isSuperAdmin` that trusts
 *     user_metadata) — provenance is required for EVERY primitive;
 *   - delegation into an arbitrary service. Delegation is followed only into
 *     modules under backend/apiHandlers/ and non-route helper modules under
 *     pages/api/, and only through functions whose bodies themselves invoke an
 *     approved primitive (max depth 4).
 *
 * There is no grandfathered baseline. A route either authenticates, or its
 * allowlist entry says why not and passes that kind's mechanical check.
 *
 * Usage: node scripts/check-route-auth.js [--json] [--report]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const API_DIR = path.join(ROOT, 'pages', 'api');
const ALLOWLIST_PATH = path.join(ROOT, 'scripts', 'route-auth-allowlist.json');

// level: identity < tenant; platform = super-admin (any tenant, by design);
// machine = non-user credential (signed token bound by the issuer).
const PRIMITIVES = {
  // ── identity ──
  getSupabaseUserFromRequest: { from: /^backend\/services\/supabaseAuthService$/, level: 'identity' },
  resolveAuthenticatedUser: { from: /^backend\/services\/authResolver$/, level: 'identity' },
  resolveUserContext: { from: /^backend\/services\/userContextService$/, level: 'identity' },
  requireAuth: { from: /^backend\/middleware\/authMiddleware$/, level: 'identity' },
  requireAuthenticatedInternalUser: { from: /^backend\/services\/requestAccessService$/, level: 'identity' },
  requireMediaCaller: { from: /^backend\/services\/mediaAuthorization$/, level: 'identity' },
  resolvePrincipal: { from: /^backend\/security\/IdentityResolver$/, level: 'identity' },
  resolveSessionFromRequest: { from: /^backend\/security\/SessionAuthorityService$/, level: 'identity' },
  validateAuthToken: { from: /^backend\/services\/authResolver$/, level: 'identity' },
  // ── tenant ──
  enforceCompanyAccess: { from: /^backend\/services\/userContextService$/, level: 'tenant', campaignArg: true },
  requireTenantAccess: { from: /^backend\/security\/TenantGuard$/, level: 'tenant' },
  requireCampaignTenantAccess: { from: /^backend\/security\/TenantGuard$/, level: 'tenant', campaign: true },
  requireContentTenantAccess: { from: /^backend\/security\/TenantGuard$/, level: 'tenant' },
  withTenantGuard: { from: /^backend\/security\/(TenantGuard|withTenantGuard)$/, level: 'tenant' },
  requireCampaignAccess: { from: /^backend\/services\/campaignAccessService$/, level: 'tenant', campaign: true },
  requireCompanyAccess: { from: /^backend\/middleware\/authMiddleware$/, level: 'tenant' },
  // Delegates to enforceCompanyAccess and forwards campaignId (bound since ROUTE-AUTH-001).
  requireCompanyContext: { from: /^backend\/services\/companyContextGuardService$/, level: 'tenant', campaignArg: true },
  withOrgAccess: { from: /^backend\/middleware\/withOrgAccess$/, level: 'tenant' },
  assertOrgAccess: { from: /^backend\/services\/requestAccessService$/, level: 'tenant' },
  withRBAC: { from: /^backend\/middleware\/withRBAC$/, level: 'tenant' },
  enforceRole: { from: /^backend\/services\/rbacService$/, level: 'tenant' },
  requireCapability: { from: /^backend\/security\/requireCapability$/, level: 'tenant' },
  resolveCompanyAccess: { from: /^backend\/services\/contentArchitectService$/, level: 'tenant' },
  resolveCompanyId: { from: /^backend\/services\/reportsCompanyAccessService$/, level: 'tenant' },
  getUserCompanyRole: { from: /^backend\/services\/rbacService$/, level: 'tenant' },
  requireExtensionAuth: { from: /^backend\/middleware\/extensionAuthMiddleware$/, level: 'tenant' },
  // ── platform (super-admin) ──
  requireSuperAdmin: { from: /^backend\/middleware\/(authMiddleware|requireSuperAdmin)$/, level: 'platform' },
  requireSuperAdminUser: { from: /^backend\/services\/requestAccessService$/, level: 'platform' },
  requireSuperAdminGaAccess: { from: /^backend\/services\/superAdminGaAccess$/, level: 'platform' },
  getLegacySuperAdminSession: { from: /^backend\/services\/superAdminSession$/, level: 'platform' },
  // Signed, hard-expiring content-architect bridge session (SEC-001A/C).
  isContentArchitectSession: { from: /^backend\/services\/contentArchitectService$/, level: 'platform' },
  // ── machine ──
  verifyRpaAuthToken: { from: /^backend\/services\/rpaWorker\/rpaAuthTokens$/, level: 'machine' },
};

// Role/permission lookups keyed by an already-established userId. They
// authorize only in combination with an identity primitive in the same chain.
const AUTHZ_HELPERS = {
  isPlatformSuperAdmin: { from: /^backend\/services\/rbacService$/, level: 'platform' },
  isSuperAdmin: { from: /^backend\/services\/rbacService$/, level: 'platform' },
  getUserRole: { from: /^backend\/services\/rbacService$/, level: 'tenant' },
  getCompanyRoleIncludingInvited: { from: /^backend\/services\/(rbacService|rbacPrimitives)$/, level: 'tenant' },
  isFinanceAuditor: { from: /^backend\/services\/billing\/financeRbacService$/, level: 'platform' },
  isFinanceAdmin: { from: /^backend\/services\/billing\/financeRbacService$/, level: 'platform' },
  hasCommunityAiCapability: { from: /^backend\/services\/rbac\/communityAiCapabilities$/, level: 'tenant' },
};

const LEVEL_RANK = { none: 0, identity: 1, machine: 2, tenant: 3, platform: 4 };
const maxLevel = (a, b) => (LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b);

// Delegation is followed only into these roots (relative to ROOT).
const DELEGATION_ROOTS = [/^backend\/apiHandlers\//, /^pages\/api\//];
const MAX_DEPTH = 4;

const ALLOW_KINDS = new Set([
  'public', 'auth-flow', 'oauth-start', 'oauth-callback', 'machine-secret',
  'webhook-signature', 'machine-token', 'retired', 'identity-scoped', 'health',
  'redirect-shim', 'inline-binding',
]);

// ────────────────────────────────────────────────────────────── source utils ──

/** A `/` starts a regex literal (not division) when the preceding token cannot end an expression. */
function isRegexStart(out) {
  const m = out.match(/(\S+)\s*$/);
  if (!m) return true;
  const prev = m[1];
  if (/(?:^|[^\w$])(?:return|typeof|case|in|of|delete|void|throw|new|else|do)$/.test(prev)) return true;
  return /[(,=:[!&|?{};+\-*%<>~^]$/.test(prev);
}

/**
 * Remove comments (block + full-line + trailing) and blank string/regex
 * contents. With keepStrings, string literals are preserved (used for
 * allowlist evidence such as a table name) while comments are still removed.
 */
function executable(src, keepStrings = false) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
      continue;
    }
    if (c === '/' && d === '/') {
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      out += ' '.repeat(stop - i);
      i = stop;
      continue;
    }
    if (c === '/' && isRegexStart(out)) {
      // Regex literal: blank its body so quotes/slashes inside it never
      // desynchronise string or comment tracking (e.g. /Content for "([^"]+)"/).
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < n && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        else if (src[j] === '/' && !inClass) { closed = true; break; }
        j += 1;
      }
      if (closed) {
        out += '/' + ' '.repeat(j - i - 1) + '/';
        i = j + 1;
        continue;
      }
    }
    if (c === '\'' || c === '"' || c === '`') {
      // Keep the quotes, blank the body (template ${} kept as code).
      const q = c;
      out += q;
      i += 1;
      while (i < n && src[i] !== q) {
        if (src[i] === '\\') { out += keepStrings ? src.slice(i, i + 2) : '  '; i += 2; continue; }
        if (q === '`' && src[i] === '$' && src[i + 1] === '{') {
          let depth = 1; let j = i + 2;
          while (j < n && depth > 0) { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; j++; }
          out += src.slice(i, j);
          i = j;
          continue;
        }
        out += keepStrings || src[i] === '\n' ? src[i] : ' ';
        i += 1;
      }
      if (i < n) { out += q; i += 1; }
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/** Parse `import { a, b as c } from 'x'` and `import d from 'x'` → Map(local → { imported, spec }). */
function parseImports(src) {
  const map = new Map();
  for (const m of src.matchAll(/import\s+(?:type\s+)?([\s\S]*?)\s+from\s*['"]([^'"]+)['"]/g)) {
    const clause = m[1];
    const spec = m[2];
    if (/^type\s/.test(m[0].slice(6).trim())) continue;
    const named = clause.match(/\{([\s\S]*)\}/);
    if (named) {
      for (const part of named[1].split(',')) {
        const p = part.trim();
        if (!p || /^type\s/.test(p)) continue;
        const [imported, local] = p.split(/\s+as\s+/).map((x) => x.trim());
        map.set(local || imported, { imported, spec });
      }
    }
    const def = clause.replace(/\{[\s\S]*\}/, '').replace(/,/g, '').trim();
    if (def && !def.startsWith('*') && /^[A-Za-z_$][\w$]*$/.test(def)) map.set(def, { imported: 'default', spec });
  }
  return map;
}

/** Resolve an import specifier from a file to a repo-relative module id (no extension). */
function resolveSpec(fromRel, spec) {
  let target;
  if (spec.startsWith('@/')) target = spec.slice(2);
  else if (spec.startsWith('.')) target = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec));
  else return null;
  return target.replace(/\.(ts|tsx|js)$/, '');
}

function moduleFile(modId) {
  for (const ext of ['.ts', '.tsx', '.js']) {
    const f = path.join(ROOT, modId + ext);
    if (fs.existsSync(f)) return f;
  }
  for (const ext of ['.ts', '.tsx', '.js']) {
    const f = path.join(ROOT, modId, 'index' + ext);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

/** Top-level function bodies: name → body text (declaration to next top-level declaration). */
function topLevelFunctions(code) {
  const out = new Map();
  const re = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(|^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*(?:async\b|\(|function\b|[A-Za-z_$][\w$]*\s*=>)/gm;
  const hits = [];
  for (const m of code.matchAll(re)) hits.push({ name: m[1] || m[2], at: m.index });
  for (let k = 0; k < hits.length; k++) {
    const end = k + 1 < hits.length ? hits[k + 1].at : code.length;
    out.set(hits[k].name, code.slice(hits[k].at, end));
  }
  return out;
}

const callRe = (name) => new RegExp(`(?<![\\w$.])${name.replace(/\$/g, '\\$')}\\s*(?:<[^>()]*>)?\\s*\\(`);

// ───────────────────────────────────────────────────────── module analysis ──

const moduleCache = new Map();
function loadModule(modId) {
  if (moduleCache.has(modId)) return moduleCache.get(modId);
  const file = moduleFile(modId);
  let rec = null;
  if (file) {
    const raw = fs.readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    const code = executable(raw);
    rec = { rel, raw, code, imports: parseImports(raw), fns: topLevelFunctions(code) };
  }
  moduleCache.set(modId, rec);
  return rec;
}

/**
 * The authentication evidence reachable from `code` (a route file or a function
 * body) in the context of module `ctx` ({ rel, imports, fns }).
 * Returns { level, via: [chain strings], campaignBound, primitives:Set }.
 */
function evidenceIn(code, ctx, depth, seen) {
  const ev = { level: 'none', via: [], primitives: new Set(), campaignArg: false, authzOnly: 'none' };
  if (depth > MAX_DEPTH) return ev;
  // 1) direct primitive calls, provenance-checked
  for (const [local, imp] of ctx.imports) {
    if (!callRe(local).test(code)) continue;
    const target = resolveSpec(ctx.rel, imp.spec);
    const prim = PRIMITIVES[imp.imported];
    if (prim && target && prim.from.test(target)) {
      ev.level = maxLevel(ev.level, prim.level);
      ev.primitives.add(imp.imported);
      ev.via.push(imp.imported);
      if (prim.campaignArg && new RegExp(`${local}\\s*\\(\\s*\\{[^}]*\\bcampaignId\\b`).test(code)) ev.campaignArg = true;
      continue;
    }
    const helper = AUTHZ_HELPERS[imp.imported];
    if (helper && target && helper.from.test(target)) {
      ev.authzOnly = maxLevel(ev.authzOnly, helper.level);
      ev.primitives.add(imp.imported);
      continue;
    }
    // 2) delegation into an allowed root
    if (!target || !DELEGATION_ROOTS.some((r) => r.test(target))) continue;
    const mod = loadModule(target);
    if (!mod) continue;
    const fnName = imp.imported === 'default' ? null : imp.imported;
    const body = fnName ? mod.fns.get(fnName) : null;
    if (!body) continue;
    const key = `${mod.rel}#${fnName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const sub = evidenceIn(body, mod, depth + 1, seen);
    const subLevel = combine(sub);
    if (subLevel !== 'none') {
      ev.level = maxLevel(ev.level, subLevel);
      sub.primitives.forEach((p) => ev.primitives.add(p));
      ev.via.push(`${imp.imported}→${sub.via.join('+') || [...sub.primitives].join('+')}`);
      if (sub.campaignArg || [...sub.primitives].some((p) => PRIMITIVES[p] && PRIMITIVES[p].campaign)) ev.campaignArg = ev.campaignArg || sub.campaignArg;
    }
  }
  // 3) same-module helper functions called from this code
  for (const [name, body] of ctx.fns) {
    if (code === body) continue;
    if (!callRe(name).test(code)) continue;
    const key = `${ctx.rel}#${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const sub = evidenceIn(body, ctx, depth + 1, seen);
    if (combine(sub) !== 'none' || sub.authzOnly !== 'none') {
      ev.level = maxLevel(ev.level, sub.level);
      ev.authzOnly = maxLevel(ev.authzOnly, sub.authzOnly);
      sub.primitives.forEach((p) => ev.primitives.add(p));
      if (sub.via.length) ev.via.push(`${name}→${sub.via.join('+')}`);
      ev.campaignArg = ev.campaignArg || sub.campaignArg;
    }
  }
  return ev;
}

/** identity + a userId-keyed authz helper ⇒ the helper's level. */
function combine(ev) {
  if (ev.level === 'none') return 'none';
  if (ev.level === 'identity' && ev.authzOnly !== 'none') return maxLevel(ev.level, ev.authzOnly);
  return ev.level;
}

// ─────────────────────────────────────────────────────── request identifiers ──

const ID_KEY = /^(id|[A-Za-z][A-Za-z0-9]*Id|[a-z][a-z0-9]*(?:_[a-z0-9]+)*_id)$/;
const NOT_OBJECT_IDS = new Set(['requestId', 'correlationId', 'traceId', 'jobId', 'idempotencyKey', 'sessionId', 'messageId', 'clientId', 'installationId', 'nonceId', 'eventId', 'webhookId', 'external_id', 'externalId', 'provider_event_id', 'client_id', 'request_id', 'trace_id', 'session_id', 'event_id']);

function requestIdentifiers(code, rel) {
  const ids = new Set();
  const member = /(?:\breq\s*\.\s*(?:query|body)|\bquery|\bbody|\bparams)\s*\??\s*(?:\.\s*([A-Za-z_$][\w$]*)|\[\s*['"]([A-Za-z_$][\w$]*)['"]\s*\])/g;
  for (const m of code.matchAll(member)) {
    const k = m[1] || m[2];
    if (ID_KEY.test(k)) ids.add(k);
  }
  const destructure = /\{([^{}]*)\}\s*=\s*\(?\s*(?:req\s*\.\s*(?:query|body)|body|query|params)\b/g;
  for (const m of code.matchAll(destructure)) {
    for (const part of m[1].split(',')) {
      const k = part.trim().split(/[:=\s]/)[0];
      if (k && ID_KEY.test(k)) ids.add(k);
    }
  }
  const helperRead = /\(\s*req\s*,\s*['"]([A-Za-z_]+)['"]/g;
  for (const m of code.matchAll(helperRead)) if (ID_KEY.test(m[1])) ids.add(m[1]);
  for (const seg of rel.match(/\[\.{0,3}([^\]]+)\]/g) || []) {
    const k = seg.replace(/[[\].]/g, '');
    if (ID_KEY.test(k) || /id$/i.test(k)) ids.add(`[${k}]`);
  }
  for (const k of [...ids]) if (NOT_OBJECT_IDS.has(k.replace(/[[\]]/g, ''))) ids.delete(k);
  return [...ids].sort();
}

const CAMPAIGN_ID = /^(campaignId|campaign_id|\[campaignId\])$/;
function isCampaignKeyed(ids, rel) {
  if (ids.some((k) => CAMPAIGN_ID.test(k))) return true;
  return /^pages\/api\/campaigns\/\[(id|campaignId)\]/.test(rel);
}

// ───────────────────────────────────────────────────────────── fail-open (R4) ──

function matchBrace(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') { depth--; if (depth === 0) return i; }
  }
  return code.length - 1;
}

const REJECT = /status\s*\(\s*(?:401|403|500|503)\s*\)|\bthrow\b/;

/**
 * A secret-gated check that only runs when the secret is configured:
 *
 *   const s = process.env.X_SECRET;
 *   if (s) { if (hdr !== s) return res.status(401)...; }   // unset → no check
 *   if (s && hdr !== s) return res.status(401)...;          // unset → no check
 *
 * Not fail-open (not flagged): an `else` branch that rejects (e.g. in
 * production), an explicit `if (!s) reject`, or the allow-path shape
 * `if (s && hdr === s) return true` followed by a fallback authorization.
 */
function failOpenSecret(code) {
  const hits = new Set();
  const guards = [];
  for (const m of code.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*process\.env\.([A-Z0-9_]+)/g)) {
    if (/SECRET|TOKEN|KEY|PASSWORD/.test(m[2])) guards.push({ expr: m[1].replace(/\$/g, '\\$'), env: m[2] });
  }
  for (const m of code.matchAll(/process\.env\.([A-Z0-9_]*(?:SECRET|TOKEN|KEY|PASSWORD)[A-Z0-9_]*)/g)) {
    guards.push({ expr: `process\\.env\\.${m[1]}`, env: m[1] });
  }
  for (const g of guards) {
    const explicitDeny = new RegExp(`if\\s*\\(\\s*!\\s*${g.expr}\\b`).test(code);
    if (explicitDeny) continue;
    for (const m of code.matchAll(new RegExp(`if\\s*\\(\\s*${g.expr}\\s*\\)\\s*\\{`, 'g'))) {
      const open = m.index + m[0].length - 1;
      const close = matchBrace(code, open);
      if (!REJECT.test(code.slice(open, close + 1))) continue;
      const after = code.slice(close + 1).trimStart();
      if (/^else\b/.test(after)) {
        const elseOpen = after.indexOf('{');
        const elseBody = elseOpen > -1 && elseOpen < 120 ? after.slice(elseOpen, matchBrace(after, elseOpen) + 1) : after.slice(0, 200);
        if (REJECT.test(elseBody)) continue;
      }
      hits.add(g.env);
    }
    if (new RegExp(`if\\s*\\(\\s*${g.expr}\\s*&&[^)]*!==?`).test(code)) hits.add(g.env);
  }
  return [...hits];
}

// ─────────────────────────────────────────────────── per-method coverage ──
//
// STEP 3AH-91 (F1). R1 above is decided per FILE: a route whose GET branch
// authenticates and whose DELETE branch does not passes R1, because SOME code
// path invokes a primitive. R1-METHOD closes that blind spot for the two
// dispatch shapes this codebase uses:
//
//   if (req.method === 'GET') { ... }   /  if (method === 'POST') return fn(req, res);
//   switch (req.method) { case 'PUT': ... }
//
// For every such branch, an approved primitive must be reachable either from
// the SHARED code that runs before the branch (the prelude — everything in the
// handler before it that is not itself another method branch), from a wrapper
// around the handler (`withRBAC(handler)`), or from the branch body itself
// (directly, through a same-module function, or through verified delegation —
// the same evidenceIn() rules as R1, provenance included). A branch whose body
// only answers a fixed response (`return res.status(405).json(...)`, an OPTIONS
// preflight) is not a data path and is exempt. So is the fall-through code
// after the last branch when it is not reached by any uncovered method.

const VERB = '(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)';
const METHOD_EXPR = '(?:\\breq(?:uest)?\\s*\\.\\s*method|\\bmethod)(?:\\s*\\??\\.\\s*toUpperCase\\s*\\(\\s*\\))?';
const METHOD_EQ = new RegExp(`${METHOD_EXPR}\\s*===?\\s*['"]${VERB}['"]|['"]${VERB}['"]\\s*===?\\s*${METHOD_EXPR}`, 'g');
// Calls that only shape a fixed HTTP response — never a data path.
const BENIGN_CALLS = new Set(['status', 'json', 'end', 'send', 'setHeader', 'getHeader', 'removeHeader', 'writeHead', 'redirect',
  'stringify', 'String', 'Number', 'Boolean', 'now', 'toISOString', 'join', 'toUpperCase', 'toLowerCase', 'includes']);
const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'return', 'catch', 'function', 'typeof', 'await', 'new', 'else', 'do', 'case', 'in', 'of', 'void', 'throw', 'async', 'Error']);

function matchClose(code, open) {
  const o = code[open];
  const c = o === '(' ? ')' : o === '[' ? ']' : '}';
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === o) depth++;
    else if (code[i] === c) { depth--; if (depth === 0) return i; }
  }
  return code.length - 1;
}

/** End (exclusive) of the expression starting at `from`: stops at `;`, or `,`/closer at depth 0. */
function exprEnd(code, from) {
  let depth = 0;
  for (let i = from; i < code.length; i++) {
    const ch = code[i];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') { if (depth === 0) return i; depth--; }
    else if (depth === 0 && (ch === ';' || ch === ',')) return i;
    else if (depth === 0 && ch === '\n') {
      const rest = code.slice(i + 1).match(/^\s*(\S)/);
      if (!rest || !/[.?:&|+\-*/=>)\]]/.test(rest[1])) return i;
    }
  }
  return code.length;
}

/** If a function (declaration, expression or arrow) starts at `at`, return [bodyStart, bodyEnd). */
function functionAt(code, at) {
  const head = code.slice(at, at + 400);
  let m = head.match(/^(?:async\s+)?function\s*\*?\s*[A-Za-z_$]?[\w$]*\s*(?:<[^>(]*>)?\s*\(/);
  if (m) {
    const close = matchClose(code, at + m[0].length - 1);
    const open = code.indexOf('{', close);
    if (open < 0) return null;
    return [open, matchClose(code, open) + 1];
  }
  m = head.match(/^(?:async\s*)?(?:\(|[A-Za-z_$][\w$]*\s*=>)/);
  if (!m) return null;
  let p = at + m[0].length - 1;
  if (code[p] === '(') p = matchClose(code, p) + 1;
  const arrow = code.slice(p, p + 200).match(/^\s*(?::[^=]*?)?=>\s*/);
  if (!arrow) return null;
  const start = p + arrow[0].length;
  if (code[start] === '{') return [start, matchClose(code, start) + 1];
  return [start, exprEnd(code, start)];
}

/** Top-level-ish declaration of `name` in the module: [valueStart, valueEnd, isFunction]. */
function declarationOf(code, name) {
  const esc = name.replace(/\$/g, '\\$');
  const fn = new RegExp(`(?:^|[;\\n])\\s*(?:export\\s+)?(?:async\\s+)?function\\s*\\*?\\s*${esc}\\s*[(<]`, 'm').exec(code);
  if (fn) {
    const at = code.indexOf('function', fn.index);
    const asyncAt = code.lastIndexOf('async', at);
    const r = functionAt(code, asyncAt > fn.index ? asyncAt : at);
    if (r) return { range: r, fn: true };
  }
  const v = new RegExp(`(?:^|[;\\n])\\s*(?:export\\s+)?(?:const|let|var)\\s+${esc}\\s*(?::[^=\\n]+)?=\\s*`, 'm').exec(code);
  if (v) {
    const start = v.index + v[0].length;
    const f = functionAt(code, start);
    if (f) return { range: f, fn: true };
    return { range: [start, exprEnd(code, start)], fn: false };
  }
  return null;
}

/** Split the top-level arguments of the call whose `(` is at `open`. */
function callArgs(code, open) {
  const close = matchClose(code, open);
  const args = [];
  let i = open + 1;
  while (i < close) {
    while (i < close && /\s/.test(code[i])) i++;
    if (i >= close) break;
    const end = Math.min(exprEnd(code, i), close);
    args.push([i, end]);
    i = end + 1;
  }
  return args;
}

/** Does this code only produce a fixed response (no data access, no service call)? */
function isBenign(code) {
  for (const m of code.matchAll(/(?<![\w$])([A-Za-z_$][\w$]*)\s*(?:<[^>()]*>)?\s*\(/g)) {
    if (KEYWORDS.has(m[1]) || BENIGN_CALLS.has(m[1])) continue;
    return false;
  }
  return !/\bawait\b/.test(code);
}

/**
 * Resolve the default-exported handler to the function body that dispatches.
 * Returns { wrapper: [primitive names] } when a provenance-checked primitive
 * wraps the handler (it authenticates every method), { body: [s, e], ctx }
 * for the handler body, or null when the shape is not recognised (R1 still
 * applies at file level).
 */
function resolveHandler(code, ctx, range, depth = 0) {
  if (depth > 4 || !range) return null;
  const [s, e] = range;
  // A function body: this is the handler.
  const fn = functionAt(code, s);
  if (fn && fn[0] >= s && fn[1] <= e + 1) return { body: fn, code, ctx };
  // An identifier: follow its declaration (same module) or a delegated import.
  const text = code.slice(s, e).trim();
  const idm = text.match(/^([A-Za-z_$][\w$]*)$/);
  if (idm) {
    const d = declarationOf(code, idm[1]);
    if (d) return d.fn ? { body: d.range, code, ctx } : resolveHandler(code, ctx, d.range, depth + 1);
    const imp = ctx.imports.get(idm[1]);
    const target = imp && resolveSpec(ctx.rel, imp.spec);
    if (target && DELEGATION_ROOTS.some((r) => r.test(target))) {
      const mod = loadModule(target);
      if (mod && imp.imported !== 'default') {
        const md = declarationOf(mod.code, imp.imported);
        if (md) return md.fn ? { body: md.range, code: mod.code, ctx: mod } : resolveHandler(mod.code, mod, md.range, depth + 1);
      }
    }
    return null;
  }
  // A call `wrapper(handler, opts)`: a primitive wrapper authenticates every
  // method; any other wrapper (createApiRoute, withIdempotency, …) is
  // transparent, so follow its function-valued argument.
  const cm = /^([A-Za-z_$][\w$]*)\s*(?:<[^>()]*>)?\s*\(/.exec(code.slice(s, e));
  if (!cm) return null;
  const callee = cm[1];
  const imp = ctx.imports.get(callee);
  if (imp) {
    const prim = PRIMITIVES[imp.imported];
    const target = resolveSpec(ctx.rel, imp.spec);
    if (prim && target && prim.from.test(target)) return { wrapper: [imp.imported] };
  }
  const open = s + cm[0].length - 1;
  for (const [as, ae] of callArgs(code, open)) {
    const a = code.slice(as, ae).trim();
    if (!/^(?:async\b|function\b|\(|[A-Za-z_$][\w$]*\s*=>|[A-Za-z_$][\w$]*$|[A-Za-z_$][\w$]*\s*\()/.test(a)) continue;
    const r = resolveHandler(code, ctx, [as, ae], depth + 1);
    if (r) return r;
  }
  return null;
}

/**
 * Method branches of a handler body: [{ verbs, start, end, bodyStart }] in
 * source order. `strs` is the same source with string contents kept (the
 * verb lives in a string literal); offsets are identical to `code`.
 */
function methodBranches(code, strs, s, e) {
  const branches = [];
  // if (...method === 'X'...) <stmt | block>
  const ifRe = /\bif\s*\(/g;
  ifRe.lastIndex = s;
  let m;
  while ((m = ifRe.exec(code)) && m.index < e) {
    const open = m.index + m[0].length - 1;
    const close = matchClose(code, open);
    const cond = strs.slice(open, close + 1);
    const verbs = [];
    for (const v of cond.matchAll(METHOD_EQ)) verbs.push(v[1] || v[2]);
    // Only positive dispatch: `method !== 'X'` guards (405 early returns) are not branches.
    if (verbs.length === 0) continue;
    let bs = close + 1;
    while (bs < e && /\s/.test(code[bs])) bs++;
    const be = code[bs] === '{' ? matchClose(code, bs) + 1 : Math.min(exprEnd(code, bs) + 1, e);
    branches.push({ verbs: [...new Set(verbs)], start: m.index, bodyStart: bs, end: be });
  }
  // switch (method) { case 'X': ... }
  const swRe = new RegExp(`\\bswitch\\s*\\(\\s*${METHOD_EXPR}\\s*\\)\\s*\\{`, 'g');
  swRe.lastIndex = s;
  while ((m = swRe.exec(code)) && m.index < e) {
    const open = m.index + m[0].length - 1;
    const close = matchClose(code, open);
    const labels = [];
    const labRe = /\b(?:case\s*['"]([A-Z]+)['"]|default)\s*:/g;
    labRe.lastIndex = open + 1;
    let l;
    while ((l = labRe.exec(strs)) && l.index < close) {
      // Only labels at the switch's own depth.
      const seg = code.slice(open + 1, l.index);
      let depth = 0;
      for (const ch of seg) { if (ch === '{' || ch === '(' || ch === '[') depth++; else if (ch === '}' || ch === ')' || ch === ']') depth--; }
      if (depth === 0) labels.push({ verb: l[1] || 'default', at: l.index, bodyAt: l.index + l[0].length });
    }
    let pending = [];
    for (let k = 0; k < labels.length; k++) {
      const endAt = k + 1 < labels.length ? labels[k + 1].at : close;
      pending.push(labels[k].verb);
      if (!code.slice(labels[k].bodyAt, endAt).trim()) continue; // `case 'GET': case 'HEAD':` fall-through
      branches.push({ verbs: pending, start: labels[k].at, bodyStart: labels[k].bodyAt, end: endAt, switchCase: true });
      pending = [];
    }
  }
  // req.method === 'X' ? a(req, res) : b(req, res)
  const ternRe = new RegExp(`(?:${METHOD_EXPR}\\s*===?\\s*['"]${VERB}['"])\\s*\\?`, 'g');
  ternRe.lastIndex = s;
  while ((m = ternRe.exec(strs)) && m.index < e) {
    const qAt = m.index + m[0].length;
    let depth = 0;
    let colon = -1;
    for (let i = qAt; i < e; i++) {
      const ch = code[i];
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      else if (ch === ')' || ch === ']' || ch === '}') { if (depth === 0) break; depth--; }
      else if (depth === 0 && ch === ':') { colon = i; break; }
      else if (depth === 0 && ch === ';') break;
    }
    if (colon < 0) continue;
    const altEnd = Math.min(exprEnd(code, colon + 1), e);
    branches.push({ verbs: [m[1]], start: m.index, bodyStart: qAt, end: colon });
    branches.push({ verbs: [`not-${m[1]}`], start: colon, bodyStart: colon + 1, end: altEnd });
  }
  branches.sort((a, b) => a.start - b.start);
  // Drop branches nested inside an earlier branch (covered by the outer body's analysis).
  const top = [];
  for (const b of branches) if (!top.some((t) => b.start >= t.bodyStart && b.end <= t.end)) top.push(b);
  return top;
}

/**
 * R1-METHOD: returns [{ verbs, at }] of method branches that reach no
 * approved primitive, plus a summary for the report.
 */
function methodCoverage(rel, raw, code, ctx) {
  const exp = /export\s+default\s+/.exec(code);
  if (!exp) return { shape: 'none', uncovered: [] };
  const start = exp.index + exp[0].length;
  const range = /^(?:async\s+)?function\b/.test(code.slice(start)) ? [start, (functionAt(code, start) || [0, code.length])[1]] : [start, exprEnd(code, start)];
  const h = resolveHandler(code, ctx, range);
  if (!h) return { shape: 'unresolved', uncovered: [] };
  if (h.wrapper) return { shape: 'wrapper', wrapper: h.wrapper, uncovered: [] };
  const hcode = h.code;
  const hraw = h.ctx === ctx ? raw : h.ctx.raw;
  const strs = executable(hraw, true);
  const [s, e] = h.body;
  const branches = methodBranches(hcode, strs, s, e);
  if (branches.length === 0) return { shape: 'no-dispatch', uncovered: [] };
  const covered = (text) => combine(evidenceIn(text, h.ctx, 0, new Set())) !== 'none';
  const uncovered = [];
  const branchReport = [];
  let cursor = s;
  let shared = '';
  let sharedCovered = false;
  for (const b of branches) {
    if (b.start > cursor) {
      shared += hcode.slice(cursor, b.start) + '\n';
      if (!sharedCovered && covered(shared)) sharedCovered = true;
    }
    cursor = Math.max(cursor, b.end);
    const body = hcode.slice(b.bodyStart, b.end);
    const ok = sharedCovered || covered(body);
    const benign = !ok && isBenign(body);
    branchReport.push({ verbs: b.verbs, covered: ok || benign, via: ok ? (sharedCovered ? 'prelude' : 'branch') : (benign ? 'fixed-response' : 'none') });
    if (!ok && !benign) uncovered.push({ verbs: b.verbs, line: hcode.slice(0, b.start).split('\n').length, file: h.ctx.rel, body, imports: h.ctx.imports, idx: branchReport.length - 1 });
  }
  return { shape: 'dispatch', branches: branchReport, uncovered };
}

// ─────────────────────────────────────────────────────────────── allowlist ──

/**
 * Per-method exemptions (STEP 3AH-91, R1-METHOD): a route that authenticates
 * may still expose a reviewed branch without a primitive. Kinds and the
 * mechanical evidence each must keep showing on every run:
 *   public → the branch never writes (insert/update/upsert/delete/rpc);
 *   stub   → the branch has no data path at all: no await, no DB call, and
 *            no call into any imported module.
 */
function loadMethodExemptions(file = ALLOWLIST_PATH) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')).methodExemptions || {};
  } catch {
    return {};
  }
}

function verifyMethodExemption(ex, branch) {
  const errs = [];
  if (!ex || !ex.reason || String(ex.reason).trim().length < 20) errs.push('reason missing or too short');
  const body = branch.body;
  if (ex && ex.kind === 'public') {
    if (/\.(insert|update|upsert|delete|rpc)\s*\(/.test(body)) errs.push('public branch writes data');
  } else if (ex && ex.kind === 'stub') {
    if (/\bawait\b|\.from\s*\(|\.rpc\s*\(/.test(body)) errs.push('stub branch has a data path (await / DB call)');
    for (const local of branch.imports.keys()) if (callRe(local).test(body)) { errs.push(`stub branch calls imported ${local}`); break; }
  } else {
    errs.push(`unknown method-exemption kind "${ex && ex.kind}" (expected public|stub)`);
  }
  return errs;
}

function loadAllowlist(file = ALLOWLIST_PATH) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return raw.routes || {};
  } catch {
    return {};
  }
}

/** Mechanical evidence each allowlist kind must still show. Returns error strings. */
function verifyAllowEntry(entry, raw, code) {
  const errs = [];
  if (!entry || !ALLOW_KINDS.has(entry.kind)) return [`unknown allowlist kind "${entry && entry.kind}"`];
  if (!entry.reason || String(entry.reason).trim().length < 20) errs.push('allowlist reason missing or too short');
  switch (entry.kind) {
    case 'machine-secret': {
      const envs = entry.env || [];
      if (envs.length === 0) errs.push('machine-secret entry must name its env var(s)');
      for (const e of envs) if (!new RegExp(`process\\.env\\.${e}\\b|process\\.env\\[['"]${e}['"]\\]|config\\.${e}\\b`).test(raw)) errs.push(`machine-secret env ${e} not referenced`);
      break;
    }
    case 'webhook-signature':
      if (entry.verifier) {
        if (!callRe(entry.verifier).test(code)) errs.push(`webhook-signature verifier ${entry.verifier} not invoked`);
      } else if (!/(verify\w*Signature|constructEvent|timingSafeEqual|createHmac|verifyWebhook)/.test(code)) {
        errs.push('webhook-signature route has no signature verification call');
      }
      break;
    case 'oauth-callback':
      if (!/(decodeOAuthState|verifyOAuthState|parseState|decodeState|state)/.test(code)) errs.push('oauth-callback route never reads state');
      break;
    case 'retired':
      if (!/status\s*\(\s*410\s*\)/.test(code)) errs.push('retired route does not answer 410');
      if (/\.(insert|update|upsert|delete)\s*\(/.test(code)) errs.push('retired route still writes');
      break;
    case 'machine-token':
      if (!entry.verifier || !callRe(entry.verifier).test(code)) errs.push(`machine-token verifier ${entry.verifier} not invoked`);
      break;
    case 'identity-scoped':
    case 'inline-binding': {
      // A reviewed claim that the route binds its ids itself (e.g. derives the
      // company from campaign_versions, or filters every query by the caller's
      // user_id). The claim must name the code it relies on: `evidence` is a
      // regex that must match the route's EXECUTABLE source (comments and
      // strings blanked), so deleting the binding code fails the gate.
      if (!entry.evidence) { errs.push(`${entry.kind} entry must declare an "evidence" regex`); break; }
      let re;
      try { re = new RegExp(entry.evidence); } catch { errs.push(`${entry.kind} evidence is not a valid regex`); break; }
      if (!re.test(code)) errs.push(`${entry.kind} evidence /${entry.evidence}/ no longer matches the route`);
      break;
    }
    case 'redirect-shim':
      if (!/\bres\s*\.\s*redirect\s*\(/.test(code)) errs.push('redirect-shim does not redirect');
      if (/\.from\s*\(|\bownedDbTable\s*\(|\.rpc\s*\(/.test(code)) errs.push('redirect-shim touches the database');
      break;
    case 'public':
    case 'health':
      if (/\.(insert|update|upsert|delete)\s*\(/.test(code) && !entry.writes) errs.push(`${entry.kind} route writes data but the entry does not declare "writes"`);
      break;
    default:
      break;
  }
  return errs;
}

// ──────────────────────────────────────────────────────────────── analysis ──

function isRouteFile(raw) {
  return /export\s+default\b/.test(raw);
}

function analyzeRoute(rel, raw, allowlist, methodExemptions = {}) {
  const code = executable(raw);
  const ctx = { rel, imports: parseImports(raw), fns: topLevelFunctions(code) };
  const ev = evidenceIn(code, ctx, 0, new Set());
  const level = combine(ev);
  const ids = requestIdentifiers(code, rel);
  const campaignKeyed = isCampaignKeyed(ids, rel);
  const campaignBound = [...ev.primitives].some((p) => PRIMITIVES[p] && PRIMITIVES[p].campaign) || ev.campaignArg || level === 'platform';
  const failOpen = failOpenSecret(code);
  const entry = allowlist[rel] || null;
  const violations = [];

  if (failOpen.length) violations.push({ rule: 'R4', msg: `fail-open secret check (${failOpen.join(',')}): authenticates only when the env var is set` });

  // R1-METHOD (STEP 3AH-91): a file-level primitive does not cover a method
  // branch that never reaches it. Applies to every route that relies on R1
  // (no entry, or a binding claim — which still requires authentication).
  const methods = methodCoverage(rel, raw, code, ctx);
  const relaxed = entry && !(entry.kind === 'identity-scoped' || entry.kind === 'inline-binding');
  if (!relaxed && level !== 'none') {
    const exemptions = methodExemptions[rel] || {};
    for (const u of methods.uncovered) {
      const ex = u.verbs.map((v) => exemptions[v]).find(Boolean);
      if (ex) {
        const errs = verifyMethodExemption(ex, u);
        for (const err of errs) violations.push({ rule: 'ALLOWLIST', msg: `${u.verbs.join('/')} method exemption: ${err}` });
        methods.branches[u.idx].via = 'exempt';
        methods.branches[u.idx].covered = errs.length === 0;
        continue;
      }
      violations.push({ rule: 'R1-METHOD', msg: `${u.verbs.join('/')} branch (${u.file}:${u.line}) reaches no approved primitive — the file authenticates on another path only` });
    }
  }

  const bindingClaim = entry && (entry.kind === 'identity-scoped' || entry.kind === 'inline-binding');
  if (entry) {
    for (const e of verifyAllowEntry(entry, raw, executable(raw, true))) violations.push({ rule: 'ALLOWLIST', msg: e });
    // A binding claim never replaces authentication: the route must still
    // establish who the caller is through an approved primitive.
    if (bindingClaim && LEVEL_RANK[level] < LEVEL_RANK.identity) {
      violations.push({ rule: 'R1', msg: `${entry.kind} route invokes no authentication primitive` });
    }
  } else if (level === 'none') {
    violations.push({ rule: 'R1', msg: 'no approved authentication primitive invoked and not on the reviewed allowlist' });
  }

  // R2/R3 apply to authenticated routes without a reviewed entry. A reviewed
  // entry (public contract, machine credential, or a binding claim whose
  // evidence regex is re-verified above) is the documented exception.
  if (!entry && level !== 'none' && ids.length > 0 && LEVEL_RANK[level] < LEVEL_RANK.machine) {
    violations.push({ rule: 'R2', msg: `takes request identifier(s) ${ids.join(', ')} but only establishes identity (no tenant/platform binder)` });
  }
  if (!entry && campaignKeyed && level !== 'none' && !campaignBound) {
    violations.push({ rule: 'R3', msg: 'campaign-keyed route never binds the campaign to the authorized tenant' });
  }

  return {
    route: rel,
    level,
    via: ev.via,
    primitives: [...ev.primitives].sort(),
    ids,
    campaignKeyed,
    campaignBound,
    allow: entry ? entry.kind : null,
    methodShape: methods.shape,
    methodBranches: methods.branches || [],
    violations,
  };
}

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js)$/.test(e.name) && !/\.(test|spec)\.(ts|tsx|js)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(full);
  }
}

function scanRepo({ allowlistPath = ALLOWLIST_PATH } = {}) {
  const allowlist = loadAllowlist(allowlistPath);
  const methodExemptions = loadMethodExemptions(allowlistPath);
  const files = [];
  walk(API_DIR, files);
  const rows = [];
  const helpers = [];
  for (const f of files) {
    const rel = path.relative(ROOT, f).split(path.sep).join('/');
    const raw = fs.readFileSync(f, 'utf8');
    if (!isRouteFile(raw)) { helpers.push(rel); continue; }
    rows.push(analyzeRoute(rel, raw, allowlist, methodExemptions));
  }
  const known = new Set(rows.map((r) => r.route));
  const stale = Object.keys(allowlist).filter((k) => !known.has(k));
  // Binding claims the route no longer needs (it now passes on primitives alone).
  const redundant = rows
    .filter((r) => r.allow === 'inline-binding' || r.allow === 'identity-scoped')
    .filter((r) => analyzeRoute(r.route, fs.readFileSync(path.join(ROOT, r.route), 'utf8'), {}).violations.length === 0)
    .map((r) => r.route);
  // Method exemptions whose branch now reaches a primitive (or no longer exists).
  const staleMethodExemptions = [];
  for (const [route, verbs] of Object.entries(methodExemptions)) {
    const row = rows.find((r) => r.route === route);
    for (const verb of Object.keys(verbs)) {
      const still = row && row.methodBranches.some((b) => b.verbs.includes(verb) && b.via === 'exempt');
      if (!still) staleMethodExemptions.push(`${route} ${verb}`);
    }
  }
  return { rows, helpers, stale, redundant, staleMethodExemptions, allowlist, methodExemptions };
}

function main() {
  const { rows, helpers, stale, redundant, staleMethodExemptions } = scanRepo();
  const bad = rows.filter((r) => r.violations.length);
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify({ rows, helpers, stale, redundant, staleMethodExemptions }, null, 1));
    return;
  }
  const byLevel = rows.reduce((a, r) => ((a[r.allow ? `allow:${r.allow}` : r.level] = (a[r.allow ? `allow:${r.allow}` : r.level] || 0) + 1), a), {});
  console.log('── route-auth gate (ROUTE-AUTH-001) ──');
  console.log(`route files: ${rows.length}   helper modules (no default export): ${helpers.length}`);
  console.log(`classification: ${JSON.stringify(byLevel)}`);
  if (stale.length) {
    console.log(`\nSTALE allowlist entries (file no longer exists or is not a route):`);
    for (const s of stale) console.log(`  - ${s}`);
  }
  if (redundant.length) {
    console.log(`\nWARN: binding claims no longer needed (route passes on primitives) — remove from the allowlist:`);
    for (const s of redundant) console.log(`  - ${s}`);
  }
  if (staleMethodExemptions.length) {
    console.log(`\nWARN: method exemptions no longer needed (branch now reaches a primitive, or is gone) — remove them:`);
    for (const s of staleMethodExemptions) console.log(`  - ${s}`);
  }
  const dispatching = rows.filter((r) => r.methodShape === 'dispatch');
  const exempt = dispatching.reduce((n, r) => n + r.methodBranches.filter((b) => b.via === 'exempt').length, 0);
  console.log(`per-method (R1-METHOD): ${dispatching.length} route(s) dispatch by HTTP method; every branch checked; ${exempt} reviewed method exemption(s)`);
  if (bad.length === 0 && stale.length === 0) {
    console.log('\nRESULT: PASS — every route authenticates, binds its tenant, or is a verified allowlist entry.');
    return;
  }
  const byRule = {};
  for (const r of bad) for (const v of r.violations) (byRule[v.rule] = byRule[v.rule] || []).push(`${r.route}  — ${v.msg}`);
  for (const [rule, list] of Object.entries(byRule).sort()) {
    console.log(`\n${rule}: ${list.length}`);
    for (const l of (process.argv.includes('--report') ? list : list.slice(0, 200))) console.log(`  ${l}`);
  }
  console.log(`\nRESULT: FAIL — ${bad.length} route(s) with violations, ${stale.length} stale allowlist entr(y/ies).`);
  process.exit(1);
}

module.exports = { analyzeRoute, scanRepo, executable, parseImports, requestIdentifiers, failOpenSecret, verifyAllowEntry, verifyMethodExemption, methodCoverage, PRIMITIVES, loadAllowlist, loadMethodExemptions };
if (require.main === module) main();
