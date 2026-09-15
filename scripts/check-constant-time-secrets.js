#!/usr/bin/env node
/**
 * STEP 3AH-91 (W2F-2) — constant-time secret comparison gate.
 *
 * WHY
 * ---
 * `===` / `!==` on strings returns at the first differing byte, so the
 * response time of an endpoint that compares a caller-presented credential
 * with a secret leaks how much of a guessed prefix is right. SEC-C (C4) added
 * backend/security/constantTimeEqual.ts and converted 38 endpoints; nothing
 * stopped the next endpoint from writing `if (req.headers['x-secret'] !==
 * process.env.X_SECRET)` again. This gate does.
 *
 * WHAT IT FLAGS (pages/api/** and backend/**, tests excluded)
 * ---------------------------------------------------------
 * A strict (in)equality `a === b` / `a !== b` where one operand is
 * SECRET-DERIVED and the other is not a literal:
 *   - `process.env.X` / `process.env['X']` / `config.X` where X names a
 *     credential (SECRET, TOKEN, KEY, PASSWORD, PASSPHRASE, SALT, HMAC,
 *     SIGNATURE; `NEXT_PUBLIC_*` and `*PUBLIC_KEY*` excluded);
 *   - a variable assigned from such a value, from another secret-derived
 *     variable, or from an HMAC/signature derivation (`createHmac(…)`,
 *     `sign…(…)`, `…Hmac(…)`, `…Signature(…)`) — tracked to a fixpoint, so
 *     `const s = process.env.X_SECRET ?? ''; const bearer = \`Bearer ${s}\``
 *     taints `bearer` too;
 *   - an operand whose own name says it is one: `…secret`, `…Secret`,
 *     `…hmac`, `…Hmac` (e.g. `cfg.secret`, `f.hmac`). `signature` is not a
 *     name signal (often a content fingerprint); an HMAC-derived expected
 *     signature is caught through its derivation instead.
 *   Variable taint is LEXICALLY SCOPED to the declaring block.
 *
 * KNOWN_OPEN below lists confirmed findings in files owned by another
 * workstream: printed on every run (not a pass), WARN when no longer matched.
 *
 * NOT FLAGGED: comparisons with a literal (`=== ''`, `=== undefined`,
 * `=== null`, numbers, booleans, a template/string without `${}`), `typeof`
 * checks, and `.length`/`.size` comparisons. A reviewed line may carry
 * `// ct-ok: <reason>` (on the line or the line above) — e.g. a chain-link
 * compare of two stored values that is not a credential check.
 *
 * Fix: `constantTimeEqual(presented, expected)` / `bearerTokenMatches(header,
 * secret)` from backend/security/constantTimeEqual (fail closed, exact match),
 * or `crypto.timingSafeEqual` on equal-length buffers.
 *
 * Usage: node scripts/check-constant-time-secrets.js [--json]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { executable } = require('./check-route-auth.js');

const ROOT = path.resolve(__dirname, '..');
const SCAN_DIRS = [path.join('pages', 'api'), 'backend'];
// The helper itself (it is the one place the comparison is made).
const SKIP_FILES = new Set(['backend/security/constantTimeEqual.ts']);

const SUPPRESS_RE = /\/\/\s*ct-ok:\s*\S/;

const SECRET_WORD = /(SECRET|TOKEN|KEY|PASSWORD|PASSPHRASE|SALT|HMAC|SIGNATURE)/;
const NOT_SECRET_NAME = /^NEXT_PUBLIC_|PUBLIC_KEY|_KEY_ID$|KEYWORDS?|MAX_TOKENS|TOKENS?_(?:LIMIT|BUDGET|PER|MAX)|_TTL|_URL$|_PATH$|_FILE$|_MODE$|_ENABLED$|_EXPIRY|_EXPIRES|_INDEX(?:_|$)/;
const secretEnvName = (n) => SECRET_WORD.test(n) && !NOT_SECRET_NAME.test(n);

const SECRET_SOURCE_RES = [
  /process\.env\.([A-Z0-9_]+)/g,
  /process\.env\[\s*['"]([A-Z0-9_]+)['"]\s*\]/g,
  /\bconfig\.([A-Z0-9_]+)/g,
];
const DERIVATION = /\bcreateHmac\s*\(|\bsign[A-Z]\w*\s*\(|\w*(?:Hmac|HMAC)\w*\s*\(|\w*Signature\w*\s*\(/;
// An operand whose last identifier names a credential. (`signature` is NOT a
// name signal: it is as often a content fingerprint — an HMAC-derived expected
// signature is caught by DERIVATION instead.)
const SECRET_NAMED = /(?:^|[^\w$])[\w$]*(?:secret|Secret|SECRET|hmac|Hmac|HMAC)\s*!?\s*\)*\s*$/;

function hasSecretEnv(text) {
  for (const re of SECRET_SOURCE_RES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) if (secretEnvName(m[1])) return true;
  }
  return false;
}

/** [open, close] of the innermost `{…}` block enclosing `pos` (the whole file at top level). */
function enclosingBlock(code, pos) {
  let depth = 0;
  let open = -1;
  for (let i = pos - 1; i >= 0; i--) {
    const c = code[i];
    if (c === '}') depth++;
    else if (c === '{') { if (depth === 0) { open = i; break; } depth--; }
  }
  if (open < 0) return [0, code.length];
  let d = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') d++;
    else if (code[i] === '}') { d--; if (d === 0) return [open, i]; }
  }
  return [open, code.length];
}

const identRe = (name) => new RegExp(`(?<![\\w$.])${name.replace(/\$/g, '\\$')}(?![\\w$])`);

/**
 * Secret-derived variables, lexically scoped: [{ name, lo, hi, re }] — the
 * binding counts only inside the block that declares it (a `const key =
 * process.env.X_KEY` in one function does not taint `key` in another).
 * Fixpoint over simple assignments.
 */
function taintedVars(code) {
  const tainted = [];
  const assigns = [];
  const re = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n;]+)?=(?!=)\s*([^;\n]*)/g;
  let m;
  while ((m = re.exec(code))) assigns.push({ name: m[1], value: m[2], at: m.index });
  const add = (name, at) => {
    const [lo, hi] = enclosingBlock(code, at);
    tainted.push({ name, lo, hi, re: identRe(name) });
  };
  // `const { A_SECRET, b: c } = process.env`
  for (const d of code.matchAll(/\b(?:const|let|var)\s*\{([^{}]*)\}\s*=\s*process\.env\b/g)) {
    for (const part of d[1].split(',')) {
      const [key, local] = part.split(':').map((x) => x && x.trim().split(/\s*=/)[0].trim());
      if (key && secretEnvName(key)) add(local || key, d.index);
    }
  }
  const done = new Set();
  for (let pass = 0; pass < 4; pass++) {
    let grew = false;
    for (const a of assigns) {
      if (done.has(a)) continue;
      const v = a.value;
      const viaVar = tainted.some((t) => a.at >= t.lo && a.at <= t.hi && t.re.test(v));
      if (hasSecretEnv(v) || DERIVATION.test(v) || viaVar) { add(a.name, a.at); done.add(a); grew = true; }
    }
    if (!grew) break;
  }
  return tainted;
}

function matchBack(code, close) {
  const c = code[close];
  const o = c === ')' ? '(' : c === ']' ? '[' : '{';
  let depth = 0;
  for (let i = close; i >= 0; i--) {
    if (code[i] === c) depth++;
    else if (code[i] === o) { depth--; if (depth === 0) return i; }
  }
  return 0;
}
function matchFwd(code, open) {
  const o = code[open];
  const c = o === '(' ? ')' : o === '[' ? ']' : '}';
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === o) depth++;
    else if (code[i] === c) { depth--; if (depth === 0) return i; }
  }
  return code.length - 1;
}

/** The operand immediately left of index `at` (exclusive): member/call chain or a parenthesised group. */
function leftOperand(code, at) {
  let i = at - 1;
  while (i >= 0 && /\s/.test(code[i])) i--;
  const end = i + 1;
  for (;;) {
    if (i < 0) break;
    const ch = code[i];
    if (ch === '!') { i--; continue; } // non-null assertion `x!`
    if (ch === ')' || ch === ']') { i = matchBack(code, i) - 1; continue; }
    if (ch === '\'' || ch === '"' || ch === '`') {
      const q = ch; let j = i - 1;
      while (j >= 0 && code[j] !== q) j--;
      i = j - 1; break;
    }
    if (/[\w$]/.test(ch)) {
      while (i >= 0 && /[\w$]/.test(code[i])) i--;
      if (i >= 0 && code[i] === '.') { i--; if (i >= 0 && code[i] === '?') i--; continue; }
      break;
    }
    break;
  }
  const s = i + 1;
  return { s, e: end, typeof: /\btypeof\s*$/.test(code.slice(Math.max(0, s - 12), s)) };
}

/** The operand immediately right of index `at`: { s, e, typeof }. */
function rightOperand(code, at) {
  let i = at;
  while (i < code.length && /\s/.test(code[i])) i++;
  if (/^typeof\b/.test(code.slice(i, i + 7))) return { s: i, e: i + 6, typeof: true };
  const aw = /^(?:await|new)\s+/.exec(code.slice(i, i + 12));
  if (aw) i += aw[0].length;
  const start = i;
  const ch = code[i];
  if (ch === '\'' || ch === '"' || ch === '`') {
    let j = i + 1;
    while (j < code.length && code[j] !== ch) {
      if (ch === '`' && code[j] === '$' && code[j + 1] === '{') { j = matchFwd(code, j + 1) + 1; continue; }
      j++;
    }
    return { s: start, e: j + 1, typeof: false };
  }
  if (ch === '(') i = matchFwd(code, i) + 1;
  else if (/[\w$-]/.test(ch)) { i++; while (i < code.length && /[\w$.]/.test(code[i])) i++; }
  else return { s: start, e: start, typeof: false };
  for (;;) {
    if (code[i] === '!' && code[i + 1] !== '=') { i++; continue; }
    if (code[i] === '?' && code[i + 1] === '.') { i += 2; continue; }
    if (code[i] === '.') { i++; while (i < code.length && /[\w$]/.test(code[i])) i++; continue; }
    if (code[i] === '[' || code[i] === '(') { i = matchFwd(code, i) + 1; continue; }
    if (/[\w$]/.test(code[i])) { while (i < code.length && /[\w$]/.test(code[i])) i++; continue; }
    break;
  }
  return { s: start, e: i, typeof: false };
}

function isLiteral(op) {
  const t = op.trim().replace(/^\(+|\)+$/g, '').trim();
  if (!t) return true;
  if (/^typeof\b/.test(t)) return true;
  if (/^(?:undefined|null|true|false|NaN|-?\d[\d_.eE]*n?)$/.test(t)) return true;
  if (/^(['"]).*\1$/s.test(t)) return true;
  if (/^`[^`]*`$/s.test(t) && !t.includes('${')) return true;
  if (/\.(?:length|size|type|kind|status|code|name|constructor)\s*$/.test(t)) return true;
  return false;
}

function isSecretOperand(op, tainted, pos = 0) {
  if (hasSecretEnv(op)) return true;
  if (SECRET_NAMED.test(op)) return true;
  if (DERIVATION.test(op)) return true;
  for (const t of tainted) if (pos >= t.lo && pos <= t.hi && t.re.test(op)) return true;
  return false;
}

/** Violations in one source string: [{ line, left, op, right }]. Exported for fixtures. */
function scanSource(src) {
  // `blank`: comments removed, string contents blanked (operators/braces inside
  // strings never count). `strs`: same offsets, string contents kept (env
  // bracket names, literal operands).
  const blank = executable(src);
  const strs = executable(src, true);
  const rawLines = src.split(/\r?\n/);
  const tainted = taintedVars(strs);
  const out = [];
  const re = /[^=!<>]([!=]==)(?!=)/g;
  let m;
  while ((m = re.exec(blank))) {
    const opAt = m.index + 1;
    const lr = leftOperand(blank, opAt);
    const rr = rightOperand(blank, opAt + 3);
    const left = lr.typeof ? 'typeof' : strs.slice(lr.s, lr.e).trim();
    const right = rr.typeof ? 'typeof' : strs.slice(rr.s, rr.e).trim();
    if (isLiteral(left) || isLiteral(right)) continue;
    if (!isSecretOperand(left, tainted, opAt) && !isSecretOperand(right, tainted, opAt)) continue;
    const line = blank.slice(0, opAt).split('\n').length;
    if (SUPPRESS_RE.test(rawLines[line - 1] || '') || (line > 1 && SUPPRESS_RE.test(rawLines[line - 2] || ''))) continue;
    out.push({ line, left: left.slice(0, 60), op: m[1], right: right.slice(0, 60) });
  }
  return out;
}

function walk(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', 'dist', 'tests', '__tests__', '__mocks__', 'fixtures'].includes(e.name)) continue;
      walk(full, out);
    } else if (/\.(ts|tsx|js)$/.test(e.name) && !/\.(test|spec)\.[tj]sx?$/.test(e.name) && !/\.d\.ts$/.test(e.name)) {
      out.push(full);
    }
  }
}

// A file can only produce a finding if it mentions a secret source, a
// secret-named operand or a derivation (every taint starts at one of these).
const PREFILTER = /process\.env|\bconfig\.[A-Z]|[sS]ecret|SECRET|[hH]mac|HMAC|\bsign[A-Z]|Signature/;

/**
 * Known, OPEN findings (confirmed timing-unsafe credential compares in files
 * owned by another workstream). NOT a pass: printed on every run; each entry
 * must keep matching (file + the operands), and an entry that no longer
 * matches prints a WARN asking for its removal (it was fixed).
 */
const KNOWN_OPEN = [
  { file: 'pages/api/super-admin/login.ts', left: 'providedPass', right: 'expectedPass', finding: 'SEC91-W2F-2a (super-admin password compared with !==)', owner: 'SEC-B' },
  { file: 'pages/api/super-admin/content-architect-login.ts', left: 'p', right: 'expectedPass', finding: 'SEC91-W2F-2b (content-architect password compared with !==)', owner: 'SEC-B' },
  { file: 'backend/services/contentArchitectSecurityService.ts', left: 'passwordHash', right: 'expectedHash', finding: 'SEC91-W2F-2c (unsalted SHA-256 password digests compared with !==)', owner: 'SEC-B' },
];

function scanRepo(root = ROOT, knownOpen = KNOWN_OPEN) {
  const files = [];
  for (const d of SCAN_DIRS) walk(path.join(root, d), files);
  const violations = [];
  const known = [];
  const hit = new Set();
  let scanned = 0;
  for (const f of files) {
    const rel = path.relative(root, f).split(path.sep).join('/');
    if (SKIP_FILES.has(rel)) continue;
    scanned++;
    const src = fs.readFileSync(f, 'utf8');
    if (!/[!=]==/.test(src) || !PREFILTER.test(src)) continue;
    for (const v of scanSource(src)) {
      const k = knownOpen.find((x) => x.file === rel && x.left === v.left && x.right === v.right);
      if (k) { hit.add(k); known.push({ file: rel, ...v, finding: k.finding, owner: k.owner }); continue; }
      violations.push({ file: rel, ...v });
    }
  }
  const staleKnown = knownOpen.filter((k) => !hit.has(k));
  return { scanned, violations, known, staleKnown };
}

function main() {
  const { scanned, violations, known, staleKnown } = scanRepo();
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify({ scanned, violations, known, staleKnown }, null, 1));
    process.exit(violations.length ? 1 : 0);
  }
  console.log('── constant-time secret comparison gate (W2F-2) ──');
  console.log(`scanned: ${scanned} files (pages/api/**, backend/**; tests excluded)`);
  for (const k of known) console.log(`KNOWN OPEN (tracked, not a pass): ${k.file}:${k.line}  ${k.left} ${k.op} ${k.right} — ${k.finding} → ${k.owner}`);
  for (const k of staleKnown) console.log(`WARN: known-open entry no longer matches (fixed?) — remove it: ${k.file} (${k.finding})`);
  if (violations.length === 0) {
    console.log(`RESULT: PASS — no ===/!== comparison against a secret-derived value${known.length ? ` (${known.length} known open finding(s) tracked above)` : ''}.`);
    return;
  }
  console.log(`\nFound ${violations.length} timing-unsafe secret comparison(s):\n`);
  for (const v of violations) console.log(`  ${v.file}:${v.line}  ${v.left} ${v.op} ${v.right}`);
  console.log('\nFix: constantTimeEqual(presented, expected) / bearerTokenMatches(header, secret)');
  console.log('from backend/security/constantTimeEqual (exact match, fails closed). If the');
  console.log('compare is not a credential check, add `// ct-ok: <reason>` on the line or the line above.');
  console.log(`\nRESULT: FAIL (${violations.length} violation(s)).`);
  process.exit(1);
}

module.exports = { KNOWN_OPEN, scanSource, scanRepo, taintedVars, leftOperand, rightOperand, isLiteral, isSecretOperand };
if (require.main === module) main();
