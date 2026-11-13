#!/usr/bin/env node
/**
 * Lists every jest suite that LOADS the zod env config (config/env.schema.ts), directly or transitively.
 *
 * Why: main moved to zod 4 (env.schema uses .prefault). A worktree whose node_modules carries zod 3 fails every
 * such suite AT LOAD ("Test suite failed to run", 0 tests) - and a summary that only counts tests looks green.
 * This list lets any session check, in one pass, whether a "green" run actually ran the suites that matter.
 *
 * Method: a static import graph from each test file (import / export-from / require / jest.requireActual /
 * dynamic import(), relative and '@/' paths, .ts/.tsx/.js and index files; type-only imports are skipped - TS erases
 * them). It OVER-approximates on purpose: a
 * jest.mock factory can stop a module from loading at runtime, but a suite listed here MAY load config, and a
 * suite NOT listed cannot (no static path). Unresolvable specifiers are package imports and are not followed.
 *
 * Usage: node scripts/testing/list-config-loading-suites.js [outFile]
 *   prints "<count> of <total> suites load config/env.schema.ts" and writes one path per line to outFile (or stdout).
 *   --check <suitePath>  exits 0 if that suite loads config, 1 if not (used by the positive controls).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const TARGET = path.join(ROOT, 'config', 'env.schema.ts');
const TEST_ROOT = path.join(ROOT, 'backend');
const IGNORE = [/[\\/]node_modules[\\/]/, /[\\/]\.next[\\/]/, /[\\/]backend[\\/]tests[\\/]realschema[\\/]/, /[\\/]backend[\\/]tests[\\/]manual[\\/]/];
const EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

function listTests(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (IGNORE.some((re) => re.test(p + (e.isDirectory() ? path.sep : '')))) continue;
    if (e.isDirectory()) listTests(p, out);
    else if (/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

function resolveFile(base) {
  const tries = [base, ...EXT.map((x) => base + x), ...EXT.map((x) => path.join(base, 'index' + x))];
  for (const t of tries) {
    try { if (fs.statSync(t).isFile()) return t; } catch { /* next */ }
  }
  return null;
}

function resolveSpec(fromFile, spec) {
  if (spec.startsWith('@/')) return resolveFile(path.join(ROOT, spec.slice(2)));
  if (spec.startsWith('.')) return resolveFile(path.resolve(path.dirname(fromFile), spec));
  return null; // a package: not followed
}

const SPEC_RE = /(?:\bimport\s+(?:[^'"`;]*?\bfrom\s*)?|\bexport\s+[^'"`;]*?\bfrom\s*|\brequire\s*\(\s*|\bjest\.requireActual\s*\(\s*|\bimport\s*\(\s*)['"]([^'"]+)['"]/g;
const depsCache = new Map();
function depsOf(file) {
  if (depsCache.has(file)) return depsCache.get(file);
  let src = '';
  try { src = fs.readFileSync(file, 'utf8'); } catch { /* unreadable */ }
  const out = new Set();
  for (const m of src.matchAll(SPEC_RE)) {
    // `import type ...` / `export type ... from` are erased by TypeScript - they load nothing at runtime.
    if (/^(?:import|export)\s+type\b/.test(m[0])) continue;
    const r = resolveSpec(file, m[1]);
    if (r) out.add(r);
  }
  const deps = [...out];
  depsCache.set(file, deps);
  return deps;
}

const reachCache = new Map(); // file -> boolean (memoised; cycles resolved by the visiting set)
function reachesTarget(start) {
  const stack = [start];
  const seen = new Set();
  while (stack.length) {
    const f = stack.pop();
    if (f === TARGET) return true;
    if (seen.has(f)) continue;
    seen.add(f);
    if (reachCache.get(f) === true) return true;
    for (const d of depsOf(f)) if (!seen.has(d)) stack.push(d);
  }
  return false;
}

function main() {
  const args = process.argv.slice(2);
  if (!fs.existsSync(TARGET)) { console.error(`target not found: ${TARGET}`); process.exit(2); }
  if (args[0] === '--check') {
    const suite = path.resolve(ROOT, args[1]);
    process.exit(reachesTarget(suite) ? 0 : 1);
  }
  const tests = listTests(TEST_ROOT).sort();
  const hits = tests.filter((t) => { const r = reachesTarget(t); reachCache.set(t, r); return r; })
    .map((t) => path.relative(ROOT, t).replace(/\\/g, '/'));
  const body = hits.join('\n') + '\n';
  if (args[0]) fs.writeFileSync(args[0], body);
  else process.stdout.write(body);
  console.error(`${hits.length} of ${tests.length} suites load config/env.schema.ts (static, over-approximate)`);
}
main();
