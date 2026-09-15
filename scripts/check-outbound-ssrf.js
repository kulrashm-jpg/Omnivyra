#!/usr/bin/env node
/**
 * HARDEN-005A — outbound-SSRF CI guard.
 *
 * Fails the build when server-side code performs an outbound request with a
 * DYNAMIC URL (a bare variable / member expression) via a raw client instead of
 * the centralized SSRF layer (lib/security/safeFetch).
 *
 * What it flags:
 *   - fetch(<identifier>)                    e.g. fetch(url), fetch(input.sourceUrl)
 *   - axios.get|post|put|patch|delete|request|head(<identifier>)
 *   - http(s).request(<identifier>)
 * where the first argument is a variable (NOT a string/template literal).
 *
 * What it ALLOWS (by design — the rule targets user/DB-controlled URLs):
 *   - Constant URLs: string literals and template literals (fixed host built
 *     from constants/env; interpolation is normally path/params, and flagging
 *     every `${BASE}/x` call would be noise, not signal).
 *   - The centralized wrappers: safeFetch / safeFetchBuffer / assertUrlSafe,
 *     and observedFetch (observability wrapper).
 *   - Trusted SDKs (openai, @supabase, stripe, googleapis, etc.) — they are not
 *     matched because they are not raw fetch/axios calls.
 *   - Files on the ALLOWLIST below (the SSRF layer itself + audited fixed-host
 *     clients) and any line carrying a `// ssrf-ok: <reason>` suppression
 *     comment (on the call line or the line above).
 *
 * Scope: backend/** and pages/api/** (server-side). Client bundles (browser
 * fetch of relative /api paths) are not an SSRF surface and are out of scope.
 *
 * Usage: node scripts/check-outbound-ssrf.js
 * Env:   SSRF_GUARD_STRICT=0 to warn instead of fail (default: fail).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
// STEP 3AH-91 (F3): lib/** is scanned too (server modules only — see
// isBrowserOnly), because server code imports lib helpers that fetch.
const SCAN_DIRS = ['backend', path.join('pages', 'api'), 'lib'];

// Files/dirs allowed to use raw fetch/axios/undici with any argument shape.
// Each entry is documented: it is the SSRF layer itself, or an audited path
// whose host is a trusted constant that the variable merely carries.
const ALLOWLIST = [
  // The centralized SSRF layer + observability wrapper (they ARE the wrappers).
  'lib/security/safeFetch.ts',
  'lib/security/ssrfGuard.ts',
  'backend/observability/externalObservability.ts',
  // Pre-existing SSRF-guarded dispatcher (undici SafeAgent — blocks private IPs).
  'backend/services/domainCanonicalService.ts',
  'backend/services/domainVerificationService.ts',
].map((p) => p.replace(/\//g, path.sep));

// Known, OPEN findings the scanner now sees (STEP 3AH-91). They are NOT
// "ssrf-ok" — each is a tracked vulnerability owned by a remediation
// workstream. Listing one keeps it visible on every run without failing
// unrelated PRs; the line must keep matching `contains`, and an entry that no
// longer matches prints a WARN asking for its removal (i.e. it was fixed).
// (Empty since STEP 3AH-91 integration: the only entry — propose-frequency-rebalance's
// fetch to the caller-supplied Origin — was fixed by SEC-E, which removed the outbound
// call entirely.)
const KNOWN_OPEN = [];

// Suppression comment token (with a required reason after the colon).
const SUPPRESS_RE = /\/\/\s*ssrf-ok:/;

// Raw-client call patterns whose FIRST argument is a bare identifier/member
// expression (i.e. a variable), which is the dynamic-URL signature.
const IDENT = '[A-Za-z_$][\\w$]*(?:\\s*[.?!]?\\.\\s*[A-Za-z_$][\\w$]*|\\s*\\[[^\\]]+\\])*';
const PATTERNS = [
  { name: 'fetch', re: new RegExp(`(?<![.\\w])fetch\\s*\\(\\s*(${IDENT})\\s*[,)]`) },
  { name: 'axios', re: new RegExp(`\\baxios\\s*\\.\\s*(?:get|post|put|patch|delete|request|head)\\s*\\(\\s*(${IDENT})\\s*[,)]`) },
  { name: 'http.request', re: new RegExp(`\\bhttps?\\s*\\.\\s*request\\s*\\(\\s*(${IDENT})\\s*[,)]`) },
];

// The same raw clients called with a TEMPLATE LITERAL first argument (the
// match ends just after the opening backtick).
const TEMPLATE_PATTERNS = [
  { name: 'fetch', re: /(?<![.\w])fetch\s*\(\s*`/ },
  { name: 'axios', re: /\baxios\s*\.\s*(?:get|post|put|patch|delete|request|head)\s*\(\s*`/ },
  { name: 'http.request', re: /\bhttps?\s*\.\s*(?:request|get)\s*\(\s*`/ },
];

// Identifiers that are NOT URLs even though they syntactically match (reduce
// false positives): request/response objects, options, etc. are never the URL.
const NON_URL_IDENTS = new Set(['options', 'opts', 'init', 'config', 'params', 'req', 'request', 'res', 'response']);

/**
 * Core detection: return the list of dynamic-URL outbound violations in a
 * single source string. Exported so the CI guard's behavior is unit-testable.
 */
// A trusted base inside `${…}`: an UPPER_SNAKE constant or an env var
// (operator configuration), optionally with a literal fallback.
const TRUSTED_BASE_EXPR = /^\s*(?:[A-Z][A-Z0-9_]*|process\.env\.[A-Z0-9_]+|process\.env\[['"][A-Z0-9_]+['"]\])(?:\s*(?:\|\||\?\?)\s*(?:['"][^'"]*['"]|[A-Z][A-Z0-9_]*|process\.env\.[A-Z0-9_]+))*\s*$/;

/**
 * STEP 3AH-91 (F3): is the HOST of a URL built by this template literal (the
 * text after the opening backtick) fixed? Relative same-origin paths, a
 * literal scheme://host, and a leading `${CONST}` / `${process.env.X}` /
 * `${knownConstVar}` base are fixed; `https://${host}/…` and `${url}/…`
 * are dynamic.
 */
function templateHostIsFixed(tpl, constUrlVars) {
  if (/^\/(?!\/)/.test(tpl) || tpl.startsWith('`')) return true; // same-origin path / empty
  const scheme = tpl.match(/^[a-z][a-z0-9+.-]*:\/\/([^/`?#]*)/i);
  if (scheme) return !scheme[1].includes('${') && scheme[1].length > 0;
  if (tpl.startsWith('${')) {
    let depth = 1; let j = 2;
    while (j < tpl.length && depth > 0) { if (tpl[j] === '{') depth++; else if (tpl[j] === '}') depth--; j++; }
    const expr = tpl.slice(2, j - 1);
    if (TRUSTED_BASE_EXPR.test(expr)) return true;
    // A known fixed-host const, or a same-file zero-arg function returning only constants.
    if (/^\s*[A-Za-z_$][\w$]*(?:\(\s*\))?\s*$/.test(expr) && constUrlVars.has(expr.replace(/\s+/g, ''))) return true;
    return false;
  }
  return true; // literal text without a scheme (e.g. a relative path segment)
}

/** `const x = <value>`: does the value fix the URL's host? (string/template literal with a literal host, or a trusted base). */
function valueFixesHost(value, constUrlVars) {
  const v = value.trim();
  if (/^['"]/.test(v)) {
    const q = v[0];
    const lit = v.slice(1, v.indexOf(q, 1) < 0 ? undefined : v.indexOf(q, 1));
    const m = lit.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i);
    return Boolean(m && m[1].length > 0);
  }
  if (v.startsWith('`')) {
    const body = v.slice(1);
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(body) || body.startsWith('${')) return templateHostIsFixed(body, constUrlVars);
    return false;
  }
  return false;
}

function scanSource(src) {
  const lines = src.split(/\r?\n/);
  const hasLocalFetch = /\b(?:async\s+)?function\s+fetch\s*\(|(?:const|let|var)\s+fetch\s*=/.test(src);
  const constUrlVars = new Set();
  // Only `const` (a `let` can be reassigned to anything), and only when the
  // value fixes the host: `const u = \`https://${host}/x\`` or
  // `const u = 'https://' + host` does NOT qualify (STEP 3AH-91).
  const assignRe = /\bconst\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*([`'"][^\n]*)/g;
  for (let pass = 0; pass < 2; pass++) {
    let am;
    assignRe.lastIndex = 0;
    while ((am = assignRe.exec(src)) !== null) {
      const value = am[2];
      if (/^['"]/.test(value)) {
        // `'https://' + host` — the literal must carry the whole host.
        const q = value[0];
        const close = value.indexOf(q, 1);
        const rest = close < 0 ? '' : value.slice(close + 1).trim();
        if (valueFixesHost(value, constUrlVars) && (!rest.startsWith('+') || /^[a-z][a-z0-9+.-]*:\/\/[^/?#'"]+\//i.test(value.slice(1, close)))) constUrlVars.add(am[1]);
      } else if (valueFixesHost(value, constUrlVars)) {
        constUrlVars.add(am[1]);
      }
    }
  }

  // `function baseUrl() { return live ? PROD_BASE : SANDBOX_BASE; }` — a
  // zero-arg function whose only statement returns trusted constants.
  const fnRe = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(\s*\)\s*(?::\s*string\s*)?\{\s*return\s+([^;{}]+);\s*\}/g;
  let fm;
  while ((fm = fnRe.exec(src)) !== null) {
    const expr = fm[2].trim();
    const tern = expr.match(/^[^?]+\?\s*([^:]+?)\s*:\s*(.+)$/);
    const isConst = (e) => TRUSTED_BASE_EXPR.test(e) || constUrlVars.has(e.trim());
    if (isConst(expr) || (tern && isConst(tern[1]) && isConst(tern[2]))) constUrlVars.add(`${fm[1]}()`);
  }

  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    if (/\b(safeFetch|safeFetchBuffer|assertUrlSafe|observedFetch)\s*\(/.test(line)) continue;
    if (SUPPRESS_RE.test(line) || (i > 0 && SUPPRESS_RE.test(lines[i - 1]))) continue;
    let flagged = false;
    for (const { name, re } of PATTERNS) {
      if (name === 'fetch' && hasLocalFetch) continue;
      const m = re.exec(line);
      if (!m) continue;
      const before = line.slice(0, m.index);
      const backticks = (before.match(/`/g) || []).length;
      if (backticks % 2 === 1 || before.includes('//')) continue;
      if (!/(?:await|return|=>|[=(,:?]|\|\||&&)\s*$/.test(before)) continue;
      const arg = m[1].trim();
      const head = arg.split(/[.[]/)[0];
      if (NON_URL_IDENTS.has(head)) continue;
      if (constUrlVars.has(head)) continue;
      out.push({ line: i + 1, call: name, arg });
      flagged = true;
      break;
    }
    if (flagged) continue;
    // STEP 3AH-91 (F3): a template literal whose HOST is dynamic
    // (`https://${host}/x`, `${baseUrl}/x`) is the same dynamic-URL signature.
    for (const { name, re } of TEMPLATE_PATTERNS) {
      if (name === 'fetch' && hasLocalFetch) continue;
      const m = re.exec(line);
      if (!m) continue;
      const before = line.slice(0, m.index);
      const backticks = (before.match(/`/g) || []).length;
      if (backticks % 2 === 1 || before.includes('//')) continue;
      if (!/(?:await|return|=>|[=(,:?]|\|\||&&)\s*$/.test(before)) continue;
      const tpl = line.slice(m.index + m[0].length);
      if (templateHostIsFixed(tpl, constUrlVars)) continue;
      out.push({ line: i + 1, call: name, arg: '`' + tpl.split('`')[0].slice(0, 60) + '`' });
      break;
    }
  }
  return out;
}

function walk(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name === 'tests' || e.name === '__tests__') continue;
      walk(full, out);
    } else if (/\.(ts|tsx|js)$/.test(e.name) && !/\.(test|spec)\.[tj]sx?$/.test(e.name) && !/\.d\.ts$/.test(e.name)) {
      out.push(full);
    }
  }
}

/**
 * lib/** also holds browser-only modules that fetch same-origin /api paths
 * (not an SSRF surface: the browser, not our server, issues the request).
 * A lib module is browser-only when it declares 'use client', lives under
 * lib/client/ or lib/hooks/, or imports a browser-only dependency (react,
 * next/router, next/navigation, the browser Supabase client). Everything
 * else in lib/** is treated as server-reachable and scanned.
 */
function isBrowserOnly(rel, src) {
  const r = rel.split(path.sep).join('/');
  if (!r.startsWith('lib/')) return false;
  if (/^lib\/(client|hooks)\//.test(r)) return true;
  if (/^\s*['"]use client['"]/m.test(src)) return true;
  return /from\s+['"](?:react|react-dom|next\/router|next\/navigation|[^'"]*supabaseBrowser)['"]/.test(src);
}

function isAllowlisted(file) {
  const rel = path.relative(ROOT, file);
  return ALLOWLIST.some((a) => rel === a);
}

function main() {
  const files = [];
  for (const d of SCAN_DIRS) walk(path.join(ROOT, d), files);

  const violations = [];
  const knownHits = [];
  let browserOnly = 0;
  for (const file of files) {
    if (isAllowlisted(file)) continue;
    const src = fs.readFileSync(file, 'utf8');
    if (isBrowserOnly(path.relative(ROOT, file), src)) { browserOnly++; continue; }
    const lines = src.split(/\r?\n/);
    for (const v of scanSource(src)) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      const text = (lines[v.line - 1] || '').trim();
      const known = KNOWN_OPEN.find((k) => k.file === rel && text.includes(k.contains));
      if (known) { known.hit = true; knownHits.push({ rel, line: v.line, known }); continue; }
      violations.push({ file: path.relative(ROOT, file), line: v.line, call: v.call, arg: v.arg, text: text.slice(0, 140) });
    }
  }

  const strict = String(process.env.SSRF_GUARD_STRICT ?? '1') !== '0';
  console.log('── outbound SSRF guard ──');
  console.log(`scanned: ${files.length - browserOnly} server files (backend/**, pages/api/**, lib/**); ${browserOnly} browser-only lib module(s) skipped`);
  for (const h of knownHits) console.log(`KNOWN OPEN (tracked, not a pass): ${h.rel}:${h.line} — ${h.known.finding}`);
  for (const k of KNOWN_OPEN.filter((x) => !x.hit)) console.log(`WARN: known-open entry no longer matches (fixed?) — remove it: ${k.file} (${k.finding})`);
  if (violations.length === 0) {
    console.log(`RESULT: PASS — no raw dynamic-URL outbound calls outside the SSRF layer${knownHits.length ? ` (${knownHits.length} known open finding(s) tracked above)` : ''}.`);
    process.exit(0);
  }

  console.log(`\nFound ${violations.length} raw dynamic-URL outbound call(s) that bypass lib/security/safeFetch:\n`);
  for (const v of violations) {
    console.log(`  ${v.file}:${v.line}  [${v.call}(${v.arg})]`);
    console.log(`      ${v.text}`);
  }
  console.log('\nFix: route the URL through safeFetch/safeFetchBuffer (or assertUrlSafe');
  console.log('for axios/SDK paths that must keep their mechanics). If the URL is a');
  console.log('proven trusted constant carried by a variable, add a `// ssrf-ok: <reason>`');
  console.log('comment on the call line (or the line above) explaining why.');

  if (strict) {
    console.log(`\nRESULT: FAIL (${violations.length} violation(s)). Set SSRF_GUARD_STRICT=0 to warn only.`);
    process.exit(1);
  }
  console.log(`\nRESULT: WARN (${violations.length} violation(s)) — SSRF_GUARD_STRICT=0.`);
  process.exit(0);
}

// Export the detection core for unit tests; run as CLI when invoked directly.
module.exports = { scanSource, templateHostIsFixed, isBrowserOnly };
if (require.main === module) main();
