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

// ─────────────────────────────────────────────────────────────── allowlist ──

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

function analyzeRoute(rel, raw, allowlist) {
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
  const files = [];
  walk(API_DIR, files);
  const rows = [];
  const helpers = [];
  for (const f of files) {
    const rel = path.relative(ROOT, f).split(path.sep).join('/');
    const raw = fs.readFileSync(f, 'utf8');
    if (!isRouteFile(raw)) { helpers.push(rel); continue; }
    rows.push(analyzeRoute(rel, raw, allowlist));
  }
  const known = new Set(rows.map((r) => r.route));
  const stale = Object.keys(allowlist).filter((k) => !known.has(k));
  // Binding claims the route no longer needs (it now passes on primitives alone).
  const redundant = rows
    .filter((r) => r.allow === 'inline-binding' || r.allow === 'identity-scoped')
    .filter((r) => analyzeRoute(r.route, fs.readFileSync(path.join(ROOT, r.route), 'utf8'), {}).violations.length === 0)
    .map((r) => r.route);
  return { rows, helpers, stale, redundant, allowlist };
}

function main() {
  const { rows, helpers, stale, redundant } = scanRepo();
  const bad = rows.filter((r) => r.violations.length);
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify({ rows, helpers, stale, redundant }, null, 1));
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

module.exports = { analyzeRoute, scanRepo, executable, parseImports, requestIdentifiers, failOpenSecret, verifyAllowEntry, PRIMITIVES, loadAllowlist };
if (require.main === module) main();
