#!/usr/bin/env node
/**
 * Deploy schedule gates (READ-ONLY). Called by scripts/predeploy-check.js; exit 1 = BLOCKED.
 *
 * Gate A, hold releasers stay unscheduled (e9, 2026-11-13, BLOCKING). credit-orphan-hold-reap and
 * monetization-reservation-reconcile release holds older than the TTL. A long job that runs past the 1h TTL would
 * have its hold released mid-run: free work, or a double settle. They stay unscheduled until migration
 * 20270217000053 and an in-flight-aware resolver ship.
 *
 * Gate B, no usage/invoice/ledger-export job (e9, 2026-11-13, BLOCKING). The live apply_credit_partial_confirm
 * writes execution_phase 'confirm_partial', which no reader at main counts. Any scheduled invoice-preparation,
 * usage-aggregation or ledger-export run would emit under-reported numbers until the confirm_partial sweep lands.
 *
 * Lifting either gate is a code change reviewed like any other. There is deliberately no env bypass.
 *
 * Scheduling surfaces scanned: vercel.json crons, railway.json, ALWAYS_RUN_JOBS (intentExecutionService.ts) and
 * the worker scheduler (backend/scheduler/cron.ts). Each surface must parse to a NON-EMPTY set, so a parse that
 * finds nothing can never report a pass.
 */
const fs = require('fs');
const path = require('path');

const HOLD_RELEASE_ROUTES = ['/api/cron/credit-orphan-hold-reap', '/api/cron/monetization-reservation-reconcile'];
const HOLD_RELEASE_NAME = /orphan-?hold-?reap|monetization-?reservation-?reconcil/i;
const USAGE_JOB_NAME = /invoice|usage-?aggregat|ledger-?export|billing-?export/i;

function vercelCronPaths(vercelJsonText) {
  const crons = JSON.parse(vercelJsonText).crons || [];
  return crons.map((c) => String(c.path || '').split('?')[0]);
}

function alwaysRunJobs(intentSrc) {
  const m = /const ALWAYS_RUN_JOBS = new Set\(\[([\s\S]*?)\]\)/.exec(intentSrc);
  if (!m) return [];
  const body = m[1].replace(/\/\/[^\n]*/g, '');
  return [...body.matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

function workerJobNames(cronSrc) {
  const names = new Set();
  for (const x of cronSrc.matchAll(/shouldRunCronJob\(\s*["']([^"']+)["']/g)) names.add(x[1]);
  for (const x of cronSrc.matchAll(/_INTERVAL_MS,\s*["']([^"']+)["']/g)) names.add(x[1]);
  return [...names];
}

/** Pure: returns { violations, errors }. errors = a surface that parsed to nothing (never a pass). */
function evaluate({ vercelJson, railwayJson, intentSrc, cronSrc }) {
  const violations = [];
  const errors = [];
  const paths = vercelCronPaths(vercelJson);
  const always = alwaysRunJobs(intentSrc);
  const worker = workerJobNames(cronSrc);
  if (paths.length === 0) errors.push('vercel.json: no crons parsed');
  if (always.length === 0) errors.push('ALWAYS_RUN_JOBS: no entries parsed');
  if (worker.length === 0) errors.push('cron.ts: no worker job names parsed');

  for (const p of paths) {
    if (HOLD_RELEASE_ROUTES.includes(p) || HOLD_RELEASE_NAME.test(p)) violations.push(`A: vercel.json schedules ${p}`);
    else if (USAGE_JOB_NAME.test(p)) violations.push(`B: vercel.json schedules ${p}`);
  }
  for (const r of HOLD_RELEASE_ROUTES) if (railwayJson.includes(r)) violations.push(`A: railway.json references ${r}`);
  if (USAGE_JOB_NAME.test(railwayJson)) violations.push('B: railway.json references a usage/invoice/export job');
  for (const [where, names] of [['ALWAYS_RUN_JOBS', always], ['cron.ts', worker]]) {
    for (const n of names) {
      if (HOLD_RELEASE_NAME.test(n)) violations.push(`A: ${where} runs ${n}`);
      else if (USAGE_JOB_NAME.test(n)) violations.push(`B: ${where} runs ${n}`);
    }
  }
  return { violations, errors, counts: { vercel: paths.length, alwaysRun: always.length, worker: worker.length } };
}

function main() {
  const root = process.argv[2] || process.cwd();
  const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
  const railwayPath = path.join(root, 'railway.json');
  const result = evaluate({
    vercelJson: read('vercel.json'),
    railwayJson: fs.existsSync(railwayPath) ? read('railway.json') : '',
    intentSrc: read('backend/services/intentExecutionService.ts'),
    cronSrc: read('backend/scheduler/cron.ts'),
  });
  const { vercel, alwaysRun, worker } = result.counts;
  process.stdout.write(`  schedule gates scanned: ${vercel} vercel crons, ${alwaysRun} ALWAYS_RUN_JOBS, ${worker} worker jobs\n`);
  if (result.errors.length || result.violations.length) {
    for (const e of result.errors) process.stdout.write(`  PARSE FAILURE: ${e}\n`);
    for (const v of result.violations) process.stdout.write(`  VIOLATION ${v}\n`);
    process.exit(1);
  }
  process.stdout.write('  schedule gates: OK (no hold releaser, no usage/invoice/export job scheduled)\n');
}

module.exports = { evaluate, vercelCronPaths, alwaysRunJobs, workerJobNames };
if (require.main === module) main();
