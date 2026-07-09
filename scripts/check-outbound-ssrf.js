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
const SCAN_DIRS = ['backend', path.join('pages', 'api')];

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

// Identifiers that are NOT URLs even though they syntactically match (reduce
// false positives): request/response objects, options, etc. are never the URL.
const NON_URL_IDENTS = new Set(['options', 'opts', 'init', 'config', 'params', 'req', 'request', 'res', 'response']);

/**
 * Core detection: return the list of dynamic-URL outbound violations in a
 * single source string. Exported so the CI guard's behavior is unit-testable.
 */
function scanSource(src) {
  const lines = src.split(/\r?\n/);
  const hasLocalFetch = /\b(?:async\s+)?function\s+fetch\s*\(|(?:const|let|var)\s+fetch\s*=/.test(src);
  const constUrlVars = new Set();
  const assignRe = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*(?:`https?:|['"]https?:|`\$\{[A-Z][A-Z0-9_]*\})/g;
  let am;
  while ((am = assignRe.exec(src)) !== null) constUrlVars.add(am[1]);

  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    if (/\b(safeFetch|safeFetchBuffer|assertUrlSafe|observedFetch)\s*\(/.test(line)) continue;
    if (SUPPRESS_RE.test(line) || (i > 0 && SUPPRESS_RE.test(lines[i - 1]))) continue;
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

function isAllowlisted(file) {
  const rel = path.relative(ROOT, file);
  return ALLOWLIST.some((a) => rel === a);
}

function main() {
  const files = [];
  for (const d of SCAN_DIRS) walk(path.join(ROOT, d), files);

  const violations = [];
  for (const file of files) {
    if (isAllowlisted(file)) continue;
    const src = fs.readFileSync(file, 'utf8');
    const lines = src.split(/\r?\n/);
    for (const v of scanSource(src)) {
      violations.push({ file: path.relative(ROOT, file), line: v.line, call: v.call, arg: v.arg, text: (lines[v.line - 1] || '').trim().slice(0, 140) });
    }
  }

  const strict = String(process.env.SSRF_GUARD_STRICT ?? '1') !== '0';
  console.log('── outbound SSRF guard ──');
  console.log(`scanned: ${files.length} server files (backend/**, pages/api/**)`);
  if (violations.length === 0) {
    console.log('RESULT: PASS — no raw dynamic-URL outbound calls outside the SSRF layer.');
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
module.exports = { scanSource };
if (require.main === module) main();
