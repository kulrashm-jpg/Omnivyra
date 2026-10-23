#!/usr/bin/env node
/**
 * W6 — real-schema CI runner (Node port of scripts/ci/real-schema-ci.sh).
 *
 * Exists so the real-schema checks can be governed verification-registry
 * entries: the registry runs ONLY `node <script>` with an argv array and no
 * shell, so a bash runner cannot be a registry command. Same four steps, same
 * semantics as the bash runner:
 *
 *   1. bootstrap  - scripts/ci/schema-bootstrap.sql (Supabase roles/schemas/extensions)
 *   2. baseline   - supabase/_schema/baseline.sql restored LOOSELY: only
 *                   "already exists" collisions with the bootstrap are tolerated;
 *                   any other ERROR fails the run. Then a public-table floor
 *                   from supabase/_schema/baseline.json.
 *   3. replay     - every supabase/migrations/<14-digit>_*.sql newer than the
 *                   baseline's ledger position, applied STRICTLY (ON_ERROR_STOP)
 *                   in filename order. One failure fails the run.
 *   4. verify     - jest --config jest.realschema.config.js (skipped with --replay-only)
 *
 * Usage:
 *   node scripts/ci/real-schema-ci.js [--replay-only] [<jest path pattern>...]
 *   W6_DB_URL=postgres://... node scripts/ci/real-schema-ci.js   # existing DB (needs host psql)
 *
 * Nothing here touches production: no env file is loaded, the database is a
 * disposable container (removed at the end unless W6_KEEP=1), and a W6_DB_URL
 * that points at a managed Supabase host is refused before anything runs.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const MIGRATION_RE = /^(\d{14})_[^/\\]*\.sql$/;
/** Hosts that are never a disposable database. */
const MANAGED_HOST_RE = /(\.supabase\.co|\.supabase\.com|pooler\.supabase)/i;

// ---------------------------------------------------------------- pure helpers

/** argv → options. Unknown flags are an error (exit 64). */
function parseArgs(argv) {
  const out = { replayOnly: false, patterns: [], help: false, error: null };
  for (const a of argv) {
    if (a === '--replay-only') out.replayOnly = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a.startsWith('-')) out.error = `unknown option: ${a}`;
    else out.patterns.push(a);
  }
  if (out.replayOnly && out.patterns.length > 0) out.error = '--replay-only takes no jest patterns';
  return out;
}

/** Migration file names to replay: 14-digit version strictly greater than ledgerMax, sorted. */
function migrationsToReplay(fileNames, ledgerMax) {
  if (!/^\d{14}$/.test(String(ledgerMax))) throw new Error(`invalid ledgerMax: ${ledgerMax}`);
  return fileNames
    .filter((n) => {
      const m = MIGRATION_RE.exec(n);
      return m !== null && m[1] > ledgerMax;
    })
    .sort();
}

/** Restore stderr → { errors, unexpected[] }: an ERROR line not mentioning "already exists" is unexpected. */
function classifyRestoreErrors(stderr) {
  const lines = String(stderr).split(/\r?\n/).filter((l) => l.includes('ERROR:'));
  return { errors: lines.length, unexpected: lines.filter((l) => !/already exists/.test(l)) };
}

/** baseline.json → { tables, ledgerMax }; throws when either is missing/invalid. */
function parseBaselineMeta(text) {
  const meta = JSON.parse(text);
  const tables = Number(meta.tables);
  const ledgerMax = String(meta.ledgerMax);
  if (!Number.isInteger(tables) || tables <= 0) throw new Error('baseline.json: tables must be a positive integer');
  if (!/^\d{14}$/.test(ledgerMax)) throw new Error('baseline.json: ledgerMax must be a 14-digit version');
  return { tables, ledgerMax };
}

/** Database configuration from the environment; refuses a managed (production-like) host. */
function dbConfig(env) {
  const url = (env.W6_DB_URL || '').trim();
  if (url) {
    if (MANAGED_HOST_RE.test(url)) throw new Error('W6_DB_URL points at a managed Supabase host; the real-schema runner only uses disposable databases');
    return { mode: 'url', url };
  }
  return {
    mode: 'container',
    image: env.W6_PG_IMAGE || 'pgvector/pgvector:pg17',
    container: env.W6_CONTAINER || 'w6-real-schema',
    port: env.W6_PG_PORT || '5433',
    keep: Boolean(env.W6_KEEP),
  };
}

/** The psql invocation for the configured database (strict = ON_ERROR_STOP). */
function psqlInvocation(cfg, strict) {
  const tail = [...(strict ? ['-v', 'ON_ERROR_STOP=1'] : []), '-q'];
  if (cfg.mode === 'url') return { cmd: 'psql', args: [cfg.url, ...tail] };
  return { cmd: 'docker', args: ['exec', '-i', cfg.container, 'psql', '-U', 'postgres', '-d', 'w6', ...tail] };
}

function dbUrl(cfg) {
  return cfg.mode === 'url' ? cfg.url : `postgres://postgres:w6@127.0.0.1:${cfg.port}/w6`;
}

// ---------------------------------------------------------------- runner

function defaultExec(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    shell: false,
    windowsHide: true,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    input: opts.input,
    env: opts.env,
    cwd: opts.cwd,
    stdio: opts.inherit ? ['ignore', 'inherit', 'inherit'] : undefined,
  });
  return { status: r.status === null ? -1 : r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error || null };
}

function defaultSleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Runs the four steps. Returns the process exit code. `deps` is injectable so
 * the whole sequence is testable without Docker or Postgres.
 */
function run(argv, env, deps = {}) {
  const exec = deps.exec || defaultExec;
  const sleep = deps.sleep || defaultSleep;
  const log = deps.log || ((s) => process.stdout.write(`${s}\n`));
  const root = deps.root || ROOT;
  const readFile = deps.readFile || ((f) => fs.readFileSync(f, 'utf8'));
  const readDir = deps.readDir || ((d) => fs.readdirSync(d));
  const exists = deps.exists || ((f) => fs.existsSync(f));

  const opts = parseArgs(argv);
  if (opts.help) {
    log('usage: node scripts/ci/real-schema-ci.js [--replay-only] [<jest path pattern>...]');
    return 0;
  }
  if (opts.error) {
    log(`FAIL: ${opts.error}`);
    return 64;
  }
  const baselineFile = path.join(root, 'supabase', '_schema', 'baseline.sql');
  const metaFile = path.join(root, 'supabase', '_schema', 'baseline.json');
  const bootstrapFile = path.join(root, 'scripts', 'ci', 'schema-bootstrap.sql');
  for (const f of [baselineFile, metaFile, bootstrapFile]) {
    if (!exists(f)) {
      log(`FAIL: missing ${f}`);
      return 1;
    }
  }
  let cfg;
  let meta;
  try {
    cfg = dbConfig(env);
    meta = parseBaselineMeta(readFile(metaFile));
  } catch (err) {
    log(`FAIL: ${err.message}`);
    return 1;
  }

  const strict = psqlInvocation(cfg, true);
  const loose = psqlInvocation(cfg, false);
  const psql = (inv, input, extraArgs = []) => exec(inv.cmd, [...inv.args, ...extraArgs], { input });
  let ownContainer = false;
  const cleanup = () => {
    if (!ownContainer) return;
    if (cfg.keep) log(`  (W6_KEEP set — container '${cfg.container}' left running on port ${cfg.port})`);
    else exec('docker', ['rm', '-f', cfg.container]);
  };

  try {
    // 1. Database
    if (cfg.mode === 'url') {
      log('== Using supplied database (no container managed)');
    } else {
      log(`== Starting disposable PostgreSQL (${cfg.image})`);
      exec('docker', ['rm', '-f', cfg.container]);
      const started = exec('docker', ['run', '-d', '--name', cfg.container, '-e', 'POSTGRES_PASSWORD=w6', '-e', 'POSTGRES_DB=w6', '-p', `${cfg.port}:5432`, cfg.image]);
      if (started.status !== 0) {
        log(`FAIL: docker run failed: ${(started.stderr || String(started.error || '')).trim().slice(0, 300)}`);
        return 1;
      }
      ownContainer = true;
      let ready = false;
      for (let i = 1; i <= 60; i++) {
        if (exec('docker', ['exec', cfg.container, 'pg_isready', '-U', 'postgres', '-d', 'w6']).status === 0) {
          log(`  ready after ${i * 2}s`);
          ready = true;
          break;
        }
        sleep(2000);
      }
      if (!ready) {
        log('FAIL: database never became ready');
        return 1;
      }
    }
    const version = psql(strict, undefined, ['-tAc', 'select version()']);
    if (version.status !== 0) {
      log(`FAIL: cannot reach the database: ${version.stderr.trim().slice(0, 300)}`);
      return 1;
    }
    log(`  ${version.stdout.split(/\r?\n/)[0]}`);

    // 2. Bootstrap + baseline
    log('== Applying Supabase bootstrap');
    const boot = psql(strict, readFile(bootstrapFile));
    if (boot.status !== 0) {
      log(`FAIL: bootstrap failed: ${boot.stderr.trim().slice(0, 500)}`);
      return 1;
    }
    log('== Restoring governed schema baseline');
    const t0 = Date.now();
    const restore = psql(loose, readFile(baselineFile));
    const { errors, unexpected } = classifyRestoreErrors(restore.stderr);
    log(`  restored in ${Math.round((Date.now() - t0) / 1000)}s (errors: ${errors}, unexpected: ${unexpected.length})`);
    if (unexpected.length > 0) {
      for (const l of unexpected.slice(0, 20)) log(`  ${l}`);
      log(`FAIL: baseline restore produced ${unexpected.length} unexpected error(s)`);
      return 1;
    }
    const countSql = "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'";
    const counted = psql(strict, undefined, ['-tAc', countSql]);
    const tables = Number.parseInt(counted.stdout.trim(), 10);
    log(`  public tables: ${Number.isNaN(tables) ? '?' : tables}`);
    if (counted.status !== 0 || !Number.isInteger(tables) || tables < meta.tables) {
      log(`FAIL: expected >= ${meta.tables} tables, got ${Number.isNaN(tables) ? 'none' : tables}`);
      return 1;
    }

    // 3. Migration replay
    log(`== Replaying migrations newer than ledger position ${meta.ledgerMax}`);
    const migDir = path.join(root, 'supabase', 'migrations');
    const toReplay = migrationsToReplay(readDir(migDir), meta.ledgerMax);
    let replayed = 0;
    for (const name of toReplay) {
      const r = psql(strict, readFile(path.join(migDir, name)));
      if (r.status !== 0) {
        log(`  ${name.padEnd(64)}FAILED`);
        for (const l of `${r.stdout}\n${r.stderr}`.trim().split(/\r?\n/).slice(-5)) log(`      ${l}`);
        log(`FAIL: migration ${name} did not apply idempotently onto the baseline`);
        return 1;
      }
      log(`  ${name.padEnd(64)}ok`);
      replayed++;
    }
    log(`  replayed ${replayed} migration(s)`);
    if (opts.replayOnly) {
      log('== Summary (--replay-only)');
      log(`  public tables    : ${tables}`);
      log(`  migration replay : ${replayed} migration(s)`);
      return 0;
    }

    // 4. Invariant suite
    log('== Running real-schema invariant suite');
    const jest = exec(
      process.execPath,
      [path.join(root, 'node_modules', 'jest', 'bin', 'jest.js'), '--config', 'jest.realschema.config.js', '--runInBand', '--forceExit', ...opts.patterns],
      { cwd: root, env: { ...env, W6_DB_URL: dbUrl(cfg) }, inherit: true },
    );
    log('== Summary');
    log(`  public tables    : ${tables}`);
    log(`  migration replay : ${replayed} migration(s)`);
    return jest.status === 0 ? 0 : 1;
  } finally {
    cleanup();
  }
}

module.exports = { parseArgs, migrationsToReplay, classifyRestoreErrors, parseBaselineMeta, dbConfig, psqlInvocation, dbUrl, run };

if (require.main === module) {
  process.exitCode = run(process.argv.slice(2), process.env);
}
