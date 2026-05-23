#!/usr/bin/env node
/**
 * Planner contract enforcement-readiness evaluator (READ-ONLY).
 *
 * Purpose:
 *   Aggregate `planner_contract_violation` + `planner_legacy_contract_usage`
 *   events from a structured-log feed and emit a single canonical
 *   `planner_enforcement_readiness` event summarizing whether it's safe
 *   to promote PLANNER_CONTRACT_ENFORCEMENT_MODE to `strict`.
 *
 * Inputs:
 *   - JSONL log lines on stdin, OR
 *   - `--input <file>` path to a JSONL log file
 *   Each line should be a structured event from
 *   `observability/runtime/structuredTelemetry.ts`.
 *
 * Outputs:
 *   stdout: the single canonical `planner_enforcement_readiness` event,
 *           JSON-encoded on one line. Pipe to your log collector.
 *   stderr: human-readable summary for operator review.
 *
 * Exit codes:
 *   0 — analysis completed (regardless of strict_safe verdict)
 *   2 — environmental failure (bad input)
 *
 * The verdict (strict_safe) is INFORMATION ONLY. Promotion to strict
 * remains a human decision. See docs/planner-compatibility-retirement.md
 * for the promotion protocol.
 *
 * Governance contract (per docs/governance-tooling-guarantees.md):
 *   - Read-only: never writes to logs, database, or filesystem
 *     (other than stdout/stderr).
 *   - Deterministic: same input → same output.
 *   - Idempotent: safe to run repeatedly.
 *   - No mutation: never alters telemetry, env, or schema state.
 */

const fs = require('fs');
const readline = require('readline');

const DEFAULT_WINDOW_DAYS = 7;

function parseArgs(argv) {
  const args = { input: null, windowDays: DEFAULT_WINDOW_DAYS };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--input' && argv[i + 1]) {
      args.input = argv[++i];
    } else if (arg === '--window-days' && argv[i + 1]) {
      const n = parseInt(argv[++i], 10);
      if (Number.isFinite(n) && n > 0) args.windowDays = n;
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        'usage: evaluate-enforcement-readiness.js [--input <file>] [--window-days N]\n' +
        '       cat events.jsonl | evaluate-enforcement-readiness.js\n',
      );
      process.exit(0);
    }
  }
  return args;
}

async function readLines(inputPath) {
  const stream = inputPath ? fs.createReadStream(inputPath, 'utf8') : process.stdin;
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const lines = [];
  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed) lines.push(trimmed);
  }
  return lines;
}

function parseLine(line) {
  try {
    const obj = JSON.parse(line);
    if (obj && typeof obj === 'object' && typeof obj.event === 'string') {
      return obj;
    }
  } catch {
    // Non-JSON lines are ignored — they're freeform diagnostics, not
    // structured events. The taxonomy only counts envelope events.
  }
  return null;
}

function withinWindow(eventTimestamp, windowMs, now) {
  if (!eventTimestamp || typeof eventTimestamp !== 'string') return true;
  const t = Date.parse(eventTimestamp);
  if (!Number.isFinite(t)) return true;
  return now - t <= windowMs;
}

async function main() {
  const args = parseArgs(process.argv);
  const windowMs = args.windowDays * 24 * 60 * 60 * 1000;
  const now = Date.now();

  let lines;
  try {
    lines = await readLines(args.input);
  } catch (e) {
    process.stderr.write(JSON.stringify({
      event: 'enforcement_readiness.error',
      reason: 'input_read_failed',
      message: e && e.message ? e.message : String(e),
    }) + '\n');
    process.exit(2);
  }

  // Counters segmented by category. Keep flat — flat is queryable.
  const violationsByCaller     = new Map();
  const violationsByDeployment = new Map();
  const violationsByPlannerMode = new Map();
  const legacyCallers          = new Map();
  let totalViolations          = 0;
  let normalizedSuccessfully   = 0;
  let normalizationFailed      = 0;
  let totalLegacyUsage         = 0;

  const bump = (map, key) => {
    const k = key ?? '<unknown>';
    map.set(k, (map.get(k) ?? 0) + 1);
  };

  for (const line of lines) {
    const ev = parseLine(line);
    if (!ev) continue;
    if (!withinWindow(ev.timestamp, windowMs, now)) continue;

    if (ev.event === 'planner_contract_violation') {
      totalViolations++;
      if (ev.normalized === true) normalizedSuccessfully++;
      else if (ev.normalized === false) normalizationFailed++;
      bump(violationsByCaller, ev.caller);
      bump(violationsByDeployment, ev.deployment_id);
      bump(violationsByPlannerMode, ev.planner_mode);
    } else if (ev.event === 'planner_legacy_contract_usage') {
      totalLegacyUsage++;
      bump(legacyCallers, ev.caller);
    }
  }

  // Readiness verdict. strict-safe ONLY when ALL three are zero in
  // the evaluation window. Single boolean — human-readable, no
  // ambiguity.
  const strictSafe =
    totalViolations === 0 &&
    totalLegacyUsage === 0 &&
    normalizationFailed === 0;

  // Emit the canonical event. Reuses the envelope from the runtime
  // helper would be ideal, but this script runs offline against
  // logs — we can't import WORKER_PROVENANCE because the worker may
  // not be running. So we construct the envelope manually with
  // best-effort provenance from env (operators piping logs from a
  // specific deployment can set these for attribution).
  const envelope = {
    event: 'planner_enforcement_readiness',
    severity: 'info',
    deployment_id: process.env.RAILWAY_DEPLOYMENT_ID ?? process.env.VERCEL_DEPLOYMENT_ID ?? null,
    git_sha: process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    worker_pid: process.pid,
    run_id: null,
    planner_stage: 'enforcement-readiness-check',
    timestamp: new Date(now).toISOString(),
    evaluation_window_days: args.windowDays,
    strict_safe: strictSafe,
    violation_count_window: totalViolations,
    normalization_failed_count: normalizationFailed,
    normalized_successfully_count: normalizedSuccessfully,
    legacy_usage_count_window: totalLegacyUsage,
    remaining_legacy_callers: legacyCallers.size,
    violations_by_caller: Object.fromEntries(violationsByCaller),
    violations_by_deployment: Object.fromEntries(violationsByDeployment),
    violations_by_planner_mode: Object.fromEntries(violationsByPlannerMode),
    legacy_callers: Object.fromEntries(legacyCallers),
  };

  process.stdout.write(JSON.stringify(envelope) + '\n');

  // Human-readable summary on stderr so operators see the verdict
  // immediately without parsing JSON.
  process.stderr.write('\n── enforcement readiness ──\n');
  process.stderr.write(`window:                       ${args.windowDays}d\n`);
  process.stderr.write(`strict_safe:                  ${strictSafe ? 'YES' : 'NO'}\n`);
  process.stderr.write(`contract violations (total):  ${totalViolations}\n`);
  process.stderr.write(`  normalized successfully:    ${normalizedSuccessfully}\n`);
  process.stderr.write(`  normalization failed:       ${normalizationFailed}\n`);
  process.stderr.write(`legacy field usage (total):   ${totalLegacyUsage}\n`);
  process.stderr.write(`remaining legacy callers:     ${legacyCallers.size}\n`);
  if (!strictSafe) {
    process.stderr.write('\nblockers:\n');
    if (totalViolations > 0)        process.stderr.write(`  - resolve ${totalViolations} contract violations\n`);
    if (normalizationFailed > 0)    process.stderr.write(`  - resolve ${normalizationFailed} normalization failures\n`);
    if (totalLegacyUsage > 0)       process.stderr.write(`  - migrate ${legacyCallers.size} legacy-field caller(s)\n`);
  } else {
    process.stderr.write('\nVerdict: STRICT-SAFE for the evaluated window.\n');
    process.stderr.write('Promotion is a HUMAN DECISION — see docs/planner-compatibility-retirement.md §Enforcement-mode promotion path.\n');
  }

  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(JSON.stringify({
    event: 'enforcement_readiness.error',
    reason: 'unhandled',
    message: err && err.message ? err.message : String(err),
  }) + '\n');
  process.exit(2);
});
