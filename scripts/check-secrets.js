#!/usr/bin/env node
/**
 * SECRETS-GATE (STEP 3AH-91, F4) — blocking scan of TRACKED files for
 * high-confidence credential patterns.
 *
 * WHY: real credentials (a database password, a Railway token, provider keys)
 * reached this repository's history. History cannot be un-leaked by a gate —
 * rotation is the only remedy — but the next commit that adds one can be
 * stopped before it is pushed anywhere else.
 *
 * WHAT IT CATCHES (each a named pattern; see PATTERNS):
 *   OpenAI / Anthropic keys (sk-…, sk-proj-…, sk-ant-…), Supabase secret keys
 *   (sb_secret_…), Supabase JWTs whose payload says role=service_role, GitHub
 *   tokens (ghp_/gho_/ghu_/ghs_/ghr_/github_pat_), Slack tokens (xox[baprs]-),
 *   AWS access key ids (AKIA/ASIA…), PEM private keys, Stripe live secrets and
 *   webhook secrets (sk_live_/rk_live_/whsec_), postgres URLs with an inline
 *   password on a non-local host, RAILWAY_TOKEN / *_API_TOKEN assignments,
 *   32-byte hex *_ENCRYPTION_KEY assignments, and long literal Bearer tokens.
 *
 * WHAT IT NEVER DOES: print a matched value. Output is file:line + pattern
 * name only (plus, with --fingerprints, a truncated SHA-256 of the value so a
 * reviewer can pin an allowlist entry without ever seeing the secret).
 *
 * FALSE POSITIVES are handled in two layers:
 *   1. built-in placeholder recognition (values containing your/example/
 *      placeholder/dummy/fake/xxxx/changeme/redacted/<…>/${…}, a single
 *      repeated character, all-zero or sequential hex, localhost / docker
 *      service DB hosts, `whsec_local…`, and the public supabase-demo JWTs);
 *   2. scripts/security/secrets-allowlist.json — reviewed entries pinned by
 *      file + pattern + value fingerprint. An entry that no longer matches is
 *      reported as stale (exit 1), so the allowlist cannot silently widen.
 *
 * Usage: node scripts/check-secrets.js [--fingerprints] [--json]
 * Deterministic, read-only, no network. Exit 0 = clean; 1 = findings.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ALLOWLIST_PATH = path.join(ROOT, 'scripts', 'security', 'secrets-allowlist.json');
const MAX_BYTES = 2 * 1024 * 1024;
const BINARY_EXT = /\.(png|jpe?g|gif|webp|avif|ico|bmp|tiff?|pdf|zip|gz|tgz|br|woff2?|ttf|otf|eot|mp[34]|mov|webm|wav|ogg|psd|sketch|fig|wasm|node|jar|class|so|dylib|dll|exe|bin|lockb)$/i;

/** Placeholder words: a value containing one of these is a documented example, not a credential. */
const PLACEHOLDER_WORDS = /your|example|placeholder|dummy|fake|sample|changeme|change[_-]?me|redacted|replace|insert|xxxx|\*\*\*|<[^>]*>|\$\{|\{\{|todo|notreal|not[_-]?a[_-]?real|mock|test[_-]?(?:key|token|secret)|(?:^|[_-])local/i;

function isTrivial(v) {
  const core = v.replace(/^[A-Za-z]+[_-]+/, '');
  if (!core) return true;
  if (/^(.)\1+$/.test(core)) return true; // one repeated character
  if (/^0+$/.test(core.replace(/[^0-9a-f]/gi, '')) && /^[0-9a-f_-]+$/i.test(core)) return true; // all-zero
  const hex = core.toLowerCase();
  if (/^(0123456789abcdef)+/.test(hex) || /^(abcdef0123456789)+/.test(hex) || /^(1234567890)+/.test(hex)) return true; // sequential
  // An ascending run of 8+ (ABCDEFGH, abcdefgh, 01234567): hand-typed, never generated.
  let run = 1;
  for (let k = 1; k < core.length; k++) {
    run = core.charCodeAt(k) === core.charCodeAt(k - 1) + 1 ? run + 1 : 1;
    if (run >= 8) return true;
  }
  // Low-entropy repetition of a short unit (e.g. abcabcabc…).
  for (let u = 1; u <= 8; u++) if (core.length >= u * 4 && core === core.slice(0, u).repeat(Math.ceil(core.length / u)).slice(0, core.length)) return true;
  return false;
}

function b64urlJson(seg) {
  try {
    const s = seg.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(s + '='.repeat((4 - (s.length % 4)) % 4), 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

const LOCAL_HOST = /^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|::1|host\.docker\.internal|db|postgres|postgresql|supabase[_-]?db|database|pg)$/i;

/**
 * name → { re (global), check?(match, line) → true when it IS a real-looking credential }.
 * The capture group 1 (when present) is the secret part used for placeholder
 * tests and the fingerprint; otherwise the whole match.
 */
const PATTERNS = [
  { name: 'anthropic-api-key', re: /\b(sk-ant-(?:api|admin)\d{2}-[A-Za-z0-9_-]{20,})/g },
  { name: 'openai-api-key', re: /\b(sk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,})/g, check: (m) => !/^sk-ant-/.test(m) && /[0-9]/.test(m) && /[A-Za-z]{3}/.test(m) },
  { name: 'supabase-secret-key', re: /\b(sb_secret_[A-Za-z0-9_-]{20,})/g },
  {
    name: 'supabase-service-role-jwt',
    re: /\b(eyJ[A-Za-z0-9_-]{8,}\.(eyJ[A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{16,})/g,
    check: (m, line, groups) => {
      const payload = b64urlJson(groups[2]);
      if (!payload || payload.role !== 'service_role') return false;
      // The public, documented local-development key of every Supabase CLI install.
      if (payload.iss === 'supabase-demo') return false;
      return true;
    },
  },
  { name: 'github-token', re: /\b((?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,})/g },
  { name: 'github-fine-grained-pat', re: /\b(github_pat_[A-Za-z0-9_]{50,})/g },
  { name: 'slack-token', re: /\b(xox[baprs]-[A-Za-z0-9]{8,}-[A-Za-z0-9-]{8,})/g },
  { name: 'aws-access-key-id', re: /\b((?:AKIA|ASIA)[0-9A-Z]{16})\b/g },
  { name: 'private-key-pem', re: /(-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----)/g, check: (m, line) => !/['"`]\s*\+|replace\(|includes\(|startsWith\(|match\(|RegExp|\/-----BEGIN/.test(line) },
  { name: 'stripe-live-secret', re: /\b((?:sk|rk)_live_[A-Za-z0-9]{20,})/g },
  { name: 'webhook-signing-secret', re: /\b(whsec_[A-Za-z0-9+/=]{20,})/g },
  {
    name: 'postgres-url-with-password',
    re: /\b(postgres(?:ql)?:\/\/([^\s:/@'"`]+):([^\s@'"`]+)@([^\s:/'"`?]+))/g,
    check: (m, line, groups) => {
      const [, , user, pass, host] = groups;
      if (LOCAL_HOST.test(host)) return false;
      if (PLACEHOLDER_WORDS.test(pass) || PLACEHOLDER_WORDS.test(user) || PLACEHOLDER_WORDS.test(host)) return false;
      if (/^(?:password|pass|pw|postgres|secret|user|\$\w+|%[A-Z_]+%|\[[^\]]*\])$/i.test(pass)) return false;
      if (/^(?:host|hostname|server|HOST|db-host|dbhost)$/i.test(host)) return false;
      return true;
    },
  },
  { name: 'railway-token-assignment', re: /\bRAILWAY_(?:API_)?TOKEN\s*[=:]\s*['"]?([A-Za-z0-9][A-Za-z0-9_-]{19,})/g },
  {
    name: 'encryption-key-assignment',
    re: /\b[A-Z0-9_]*ENCRYPTION_KEY\s*[=:]\s*['"]?([0-9a-fA-F]{64})\b/g,
  },
  {
    name: 'bearer-literal',
    re: /\bBearer\s+([A-Za-z0-9._~+/-]{32,}=*)/g,
    check: (m, line) => !/\$\{/.test(m) && /[0-9]/.test(m) && /[A-Za-z]/.test(m),
  },
];

function loadAllowlist(file = ALLOWLIST_PATH) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')).entries || [];
  } catch {
    return [];
  }
}

const fingerprint = (v) => crypto.createHash('sha256').update(v).digest('hex').slice(0, 16);

/**
 * Scan one file's text. Returns [{ line, pattern, fp }] — never the value.
 * `rel` is used only for allowlist matching.
 */
function scanText(text, rel = '', allowlist = [], used = new Set()) {
  const out = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 20000) continue; // minified bundles / data blobs
    for (const p of PATTERNS) {
      p.re.lastIndex = 0;
      let m;
      while ((m = p.re.exec(line)) !== null) {
        const value = m[1] || m[0];
        if (p.name !== 'private-key-pem' && p.name !== 'supabase-service-role-jwt' && p.name !== 'postgres-url-with-password') {
          if (PLACEHOLDER_WORDS.test(value) || isTrivial(value)) continue;
        }
        if (p.check && !p.check(value, line, m)) continue;
        const fp = fingerprint(value);
        const entry = allowlist.find((a) => a.file === rel && a.pattern === p.name && a.fingerprint === fp);
        if (entry) { used.add(entry); continue; }
        out.push({ line: i + 1, pattern: p.name, fp });
      }
    }
  }
  return out;
}

function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 << 20 });
  return out.split('\0').filter(Boolean);
}

// A committed dotenv file is a credential store whatever its contents look like.
const DOTENV_FILE = /(?:^|\/)\.env(?:\.[\w-]+)*$/;
const DOTENV_OK = /\.(?:example|sample|template)$/;
const isTrackedDotenv = (rel) => DOTENV_FILE.test(rel) && !DOTENV_OK.test(rel);

// Cheap prefilter: a file with none of these substrings cannot match any pattern.
const TRIGGERS = /sk-|sb_secret_|eyJ|gh[pousr]_|github_pat_|xox[baprs]-|AKIA|ASIA|PRIVATE KEY|_live_|whsec_|postgres|RAILWAY_|ENCRYPTION_KEY|Bearer/;

function scanRepo({ allowlistPath = ALLOWLIST_PATH } = {}) {
  const allowlist = loadAllowlist(allowlistPath);
  const used = new Set();
  const findings = [];
  let scanned = 0;
  for (const rel of trackedFiles()) {
    if (isTrackedDotenv(rel)) { findings.push({ file: rel, line: 0, pattern: 'tracked-dotenv-file', fp: '-' }); continue; }
    if (BINARY_EXT.test(rel)) continue;
    const full = path.join(ROOT, rel);
    let st;
    try { st = fs.statSync(full); } catch { continue; } // deleted in the working tree
    if (!st.isFile() || st.size > MAX_BYTES) continue;
    const buf = fs.readFileSync(full);
    if (buf.includes(0)) continue; // binary
    scanned++;
    const text = buf.toString('utf8');
    if (!TRIGGERS.test(text)) continue;
    for (const f of scanText(text, rel, allowlist, used)) findings.push({ file: rel, ...f });
  }
  const stale = allowlist.filter((a) => !used.has(a));
  const badEntries = allowlist.filter((a) => !a.reason || String(a.reason).trim().length < 20 || !a.fingerprint || !a.file || !a.pattern);
  return { scanned, findings, stale, badEntries, allowlist };
}

function main() {
  const { scanned, findings, stale, badEntries, allowlist } = scanRepo();
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify({ scanned, findings, stale: stale.map((s) => `${s.file}:${s.pattern}`) }, null, 1));
    return;
  }
  const showFp = process.argv.includes('--fingerprints');
  console.log('── secret-pattern gate (SECRETS-GATE, STEP 3AH-91) ──');
  console.log(`tracked text files scanned: ${scanned}   patterns: ${PATTERNS.length}   reviewed allowlist entries: ${allowlist.length}`);
  let fail = false;
  if (findings.length) {
    fail = true;
    console.log(`\nPOSSIBLE CREDENTIALS (${findings.length}) — values are never printed:`);
    for (const f of findings) console.log(`  ${f.file}:${f.line}  [${f.pattern}]${showFp ? `  fp=${f.fp}` : ''}`);
    console.log('\nFix: remove the credential from the file AND rotate it (it is in git history the moment it is committed).');
    console.log('If it is a reviewed test placeholder, prefer an obvious placeholder value; otherwise add an entry to');
    console.log('scripts/security/secrets-allowlist.json ({ file, pattern, fingerprint, reason }) — run with --fingerprints.');
  }
  if (stale.length) {
    fail = true;
    console.log(`\nSTALE allowlist entries (${stale.length}) — no longer match; remove them:`);
    for (const s of stale) console.log(`  - ${s.file} [${s.pattern}]`);
  }
  if (badEntries.length) {
    fail = true;
    console.log(`\nINVALID allowlist entries (${badEntries.length}) — each needs file, pattern, fingerprint and a reason (>= 20 chars).`);
  }
  if (!fail) {
    console.log('\nRESULT: PASS — no high-confidence credential patterns in tracked files.');
    return;
  }
  console.log('\nRESULT: FAIL');
  process.exit(1);
}

module.exports = { scanText, scanRepo, PATTERNS, isTrivial, fingerprint, loadAllowlist, isTrackedDotenv };
if (require.main === module) main();
