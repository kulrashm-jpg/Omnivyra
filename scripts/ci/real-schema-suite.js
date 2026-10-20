#!/usr/bin/env node
/**
 * Registry entrypoint for ONE named set of real-schema suites.
 *
 * The verification registry runs `node <args>` with no shell and no
 * environment, so it cannot call scripts/ci/real-schema-ci.sh, which selects
 * suites only through the W6_ONLY environment variable. This wrapper is that
 * missing seam and nothing more: it validates the requested suite files,
 * proves with Jest's own resolution (`--listTests`) that the selection is
 * EXACTLY those files, then delegates to the hardened bash harness with
 * W6_ONLY set. Provisioning, ownership checks, replay and cleanup stay in the
 * bash harness; none of it is re-implemented here.
 *
 *   node scripts/ci/real-schema-suite.js <suite> [<suite> ...]          # run
 *   node scripts/ci/real-schema-suite.js --list <suite> [<suite> ...]   # selection only
 *
 * A <suite> is an exact repo-relative file: backend/tests/realschema/<name>.test.ts.
 * Prefixes, globs and regexes are refused, so `li3_contact_governance` can never
 * also select `li3d_governance_writer`.
 *
 * Exit codes: 0 ok · 2 a requested suite does not exist · 3 selection mismatch ·
 * 4 no safe bash · 64 usage · otherwise the harness's own exit code.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const HARNESS = path.join('scripts', 'ci', 'real-schema-ci.sh');
const SUITE_RE = /^backend\/tests\/realschema\/([A-Za-z0-9][A-Za-z0-9_]*)\.test\.ts$/;
const MAX_SUITES = 20;
const USAGE = 'usage: real-schema-suite.js [--list] <backend/tests/realschema/<name>.test.ts> ...';

/** argv → { list, suites } or { error }. Pure. */
function parseArgs(argv) {
  const list = argv[0] === '--list';
  const rest = list ? argv.slice(1) : argv;
  if (rest.length === 0) return { error: 'at least one suite is required' };
  if (rest.length > MAX_SUITES) return { error: `at most ${MAX_SUITES} suites` };
  const names = [];
  for (const a of rest) {
    const m = SUITE_RE.exec(a);
    if (!m) return { error: `not an exact real-schema suite path: ${JSON.stringify(a)}` };
    if (names.includes(m[1])) return { error: `duplicate suite: ${a}` };
    names.push(m[1]);
  }
  return { list, suites: rest.slice(), names };
}

/** Anchored Jest path regex matching exactly these suite names, under either separator. Pure. */
function buildPattern(names) {
  return `(^|[\\\\/])backend[\\\\/]tests[\\\\/]realschema[\\\\/](${names.join('|')})\\.test\\.ts$`;
}

/** Repo-relative POSIX form of a path Jest printed. Pure. */
function toRepoRelative(p, root) {
  return path.relative(root, p).split(path.sep).join('/');
}

/**
 * Git Bash on Windows, derived from `git --exec-path`. Never a bare `bash`
 * from PATH there: it can resolve to WSL (System32) or a WindowsApps stub,
 * which would run the harness in a different environment.
 */
function resolveBash(deps) {
  if (deps.platform !== 'win32') return 'bash';
  const r = deps.spawnSync('git', ['--exec-path'], { encoding: 'utf8', shell: false, windowsHide: true });
  if (r.status !== 0 || !r.stdout) return null;
  const gitRoot = path.resolve(r.stdout.trim(), '..', '..', '..');
  for (const rel of [path.join('bin', 'bash.exe'), path.join('usr', 'bin', 'bash.exe')]) {
    const candidate = path.join(gitRoot, rel);
    if (deps.existsSync(candidate)) return candidate;
  }
  return null;
}

/** Files Jest would run for `pattern` under the real-schema config, repo-relative and sorted. */
function listSelected(pattern, deps) {
  const jest = path.join(deps.root, 'node_modules', 'jest', 'bin', 'jest.js');
  const r = deps.spawnSync(process.execPath, [jest, '--config', 'jest.realschema.config.js', '--listTests', '--testPathPattern', pattern], {
    cwd: deps.root, encoding: 'utf8', shell: false, windowsHide: true,
  });
  if (r.status !== 0) return null;
  return r.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((p) => toRepoRelative(p, deps.root)).sort();
}

function run(argv, env, deps = {}) {
  const d = {
    root: ROOT, platform: process.platform, spawnSync, existsSync: fs.existsSync,
    out: (s) => process.stdout.write(`${s}\n`), err: (s) => process.stderr.write(`${s}\n`),
    ...deps,
  };
  const parsed = parseArgs(argv);
  if (parsed.error) {
    d.err(`${parsed.error}\n${USAGE}`);
    return 64;
  }
  const missing = parsed.suites.filter((s) => !d.existsSync(path.join(d.root, s)));
  if (missing.length > 0) {
    d.err(`suite not found: ${missing.join(', ')}`);
    return 2;
  }
  const pattern = buildPattern(parsed.names);
  const expected = parsed.suites.slice().sort();
  const selected = listSelected(pattern, d);
  if (selected === null || selected.join('\n') !== expected.join('\n')) {
    d.err(`selection mismatch: expected [${expected.join(', ')}], jest selected [${(selected || ['<listTests failed>']).join(', ')}]`);
    return 3;
  }
  d.out(`selected ${selected.length} suite(s): ${selected.join(', ')}`);
  if (parsed.list) return 0;

  const bash = resolveBash(d);
  if (!bash) {
    d.err('no safe bash: Git Bash was not found next to git (WSL/WindowsApps bash is never used)');
    return 4;
  }
  const r = d.spawnSync(bash, [HARNESS], {
    cwd: d.root, env: { ...env, W6_ONLY: pattern }, stdio: 'inherit', shell: false, windowsHide: true,
  });
  return typeof r.status === 'number' ? r.status : 1;
}

module.exports = { parseArgs, buildPattern, toRepoRelative, resolveBash, listSelected, run, SUITE_RE, HARNESS };

if (require.main === module) {
  process.exitCode = run(process.argv.slice(2), process.env);
}
