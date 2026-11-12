#!/usr/bin/env node
/**
 * Floating-promise gate (e9 ruling, 2026-11-12): server code may not ADD a floating promise.
 *
 *   node --max-old-space-size=7168 scripts/ci/check-floating-promises.js            # gate
 *   node --max-old-space-size=7168 scripts/ci/check-floating-promises.js --update-baseline
 *
 * Rule and why both of its options matter: eslint.floating.config.cjs. Scope: backend/** (minus
 * tests), lib/**, pages/api/**. Type-aware, so it runs in its OWN CI job (~15-20 min), not in
 * `npm run lint`.
 *
 * ORDER, and why:
 *   1. SELF-CHECK. The known-defect fixture (backend/__lint_fixtures__/floatingVoidBuilderWrite.ts)
 *      MUST be flagged on its marked line. If the config lost checkThenables or ignoreVoid:false, or
 *      tsconfig.backend.json left the project list, the fixture is not flagged (or not analysed) and
 *      the gate FAILS rather than reporting a clean scan of a rule that cannot see the class.
 *   2. SCAN. Any file the parser could not analyse is a FAILURE, never a skip. Under the wrong
 *      tsconfig, 535 backend files were silently unanalysed while the count looked plausible.
 *   3. COMPARE against scripts/ci/floating-promises-baseline.json as a MULTISET of keys
 *      `<file>|<messageId>|<sha1 of the flagged statement's normalised text>`. No line numbers: an
 *      edit above a hit must not read as a new hit. A genuinely new hit in a file that already has
 *      some still raises that key's count. NET-NEW -> FAIL; RESOLVED -> pass (re-baseline to lock it).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ESLint } = require('eslint');

const ROOT = path.resolve(__dirname, '..', '..');
const CONFIG = path.join(ROOT, 'eslint.floating.config.cjs');
const BASELINE = path.join(__dirname, 'floating-promises-baseline.json');
const FIXTURE = path.join(ROOT, 'backend', '__lint_fixtures__', 'floatingVoidBuilderWrite.ts');
const FIXTURE_MARK = 'FLOATING-PROMISE-FIXTURE';
const RULE = '@typescript-eslint/no-floating-promises';

const SCAN_ROOTS = ['backend', 'lib', path.join('pages', 'api')];
const EXCLUDE_DIRS = new Set(['node_modules', '.next', 'dist', '__tests__', '__lint_fixtures__']);
const isExcludedFile = (rel) =>
  rel.startsWith('backend/tests/') || /\.(test|spec)\.tsx?$/.test(rel) || rel.endsWith('.d.ts');

const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');

function listFiles() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!EXCLUDE_DIRS.has(e.name)) walk(p); }
      else if (/\.tsx?$/.test(e.name) && !isExcludedFile(rel(p))) out.push(p);
    }
  };
  for (const r of SCAN_ROOTS) { const d = path.join(ROOT, r); if (fs.existsSync(d)) walk(d); }
  return out.sort();
}

/** The flagged statement's text, normalised (whitespace collapsed), from the reported line onward. */
function statementText(lines, line) {
  let text = '';
  for (let i = line - 1; i < lines.length && i < line + 7; i++) {
    text += ` ${lines[i]}`;
    if (/;\s*(\/\/.*)?$/.test(lines[i])) break;
  }
  return text.replace(/\s+/g, ' ').trim();
}

function keysFor(results) {
  const counts = new Map();
  const fatal = [];
  for (const r of results) {
    const file = rel(r.filePath);
    let lines = null;
    for (const m of r.messages) {
      if (m.fatal) { fatal.push(`${file}: ${m.message.split('\n')[0]}`); continue; }
      if (m.ruleId !== RULE) continue;
      lines = lines || fs.readFileSync(r.filePath, 'utf8').split(/\r?\n/);
      const hash = crypto.createHash('sha1').update(statementText(lines, m.line)).digest('hex').slice(0, 16);
      const key = `${file}|${m.messageId}|${hash}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return { counts, fatal };
}

async function main() {
  const update = process.argv.includes('--update-baseline');
  const eslint = new ESLint({ cwd: ROOT, overrideConfigFile: CONFIG, errorOnUnmatchedPattern: false });

  // 1. SELF-CHECK
  const [fx] = await eslint.lintFiles([FIXTURE]);
  const fxLines = fs.readFileSync(FIXTURE, 'utf8').split(/\r?\n/);
  const markLine = fxLines.findIndex((l) => l.includes(FIXTURE_MARK)) + 2; // the statement after the mark
  const fxFatal = fx.messages.filter((m) => m.fatal);
  const fxHit = fx.messages.some((m) => m.ruleId === RULE && m.line === markLine);
  if (fxFatal.length > 0 || !fxHit) {
    console.error('[floating-promises] SELF-CHECK FAILED: the known-defect fixture was not flagged.');
    if (fxFatal.length > 0) console.error(`  not analysed: ${fxFatal[0].message.split('\n')[0]}`);
    console.error('  The rule cannot see "a write that never executes". Check eslint.floating.config.cjs:');
    console.error('  ignoreVoid: false, checkThenables: true, and tsconfig.backend.json in parserOptions.project.');
    process.exit(2);
  }
  console.log(`[floating-promises] self-check OK: fixture flagged at line ${markLine}`);

  // 2. SCAN
  const files = listFiles();
  console.log(`[floating-promises] scanning ${files.length} server files (type-aware; this takes a while)`);
  const results = await eslint.lintFiles(files);
  const { counts, fatal } = keysFor(results);
  if (fatal.length > 0) {
    console.error(`[floating-promises] FAIL: ${fatal.length} file(s) could not be analysed (a skip is a failure):`);
    for (const f of fatal.slice(0, 20)) console.error(`  ${f}`);
    process.exit(2);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);

  if (update) {
    const sorted = Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
    fs.writeFileSync(BASELINE, `${JSON.stringify({ rule: RULE, total, keys: sorted }, null, 2)}\n`);
    console.log(`[floating-promises] baseline written: ${total} hit(s) in ${counts.size} key(s)`);
    return;
  }

  // 3. COMPARE
  if (!fs.existsSync(BASELINE)) {
    console.error('[floating-promises] FAIL: no baseline; run with --update-baseline in a dedicated commit');
    process.exit(2);
  }
  const base = new Map(Object.entries(JSON.parse(fs.readFileSync(BASELINE, 'utf8')).keys));
  const netNew = [];
  const resolved = [];
  for (const [k, n] of counts) { const b = base.get(k) || 0; if (n > b) netNew.push([k, n - b]); }
  for (const [k, b] of base) { const n = counts.get(k) || 0; if (b > n) resolved.push([k, b - n]); }
  console.log(`[floating-promises] ${total} hit(s); baseline ${[...base.values()].reduce((a, b) => a + b, 0)}`);
  if (resolved.length > 0) {
    console.log(`  resolved ${resolved.reduce((a, [, d]) => a + d, 0)} (re-baseline in a dedicated commit to lock the gain)`);
  }
  if (netNew.length > 0) {
    console.error(`[floating-promises] FAIL: ${netNew.reduce((a, [, d]) => a + d, 0)} NEW floating promise(s):`);
    for (const [k, d] of netNew) console.error(`  +${d}  ${k}`);
    console.error('  Await it, return it, or attach .catch/.then. A deliberate fire-and-forget needs a reviewed');
    console.error('  `// eslint-disable-next-line @typescript-eslint/no-floating-promises -- <reason>`.');
    process.exit(1);
  }
  console.log('[floating-promises] PASS: no new floating promises in server code');
}

main().catch((e) => { console.error('[floating-promises] ERROR', e && e.stack ? e.stack : e); process.exit(2); });
