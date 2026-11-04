#!/usr/bin/env node
/**
 * Non-regression TypeScript baseline guard.
 *
 * Runs the honest multi-project runner (scripts/typecheck-all.js — all 3
 * projects, non-incremental, full output) and compares the TOTAL error count
 * against the committed baseline in scripts/typecheck-baseline.json.
 *
 *   actual >  baseline  -> FAIL (regression — new type errors introduced)
 *   actual == baseline  -> PASS
 *   actual <  baseline  -> PASS, and report that the baseline can be lowered
 *                          (intentionally NOT auto-edited — must be a
 *                           deliberate, reviewed commit)
 *
 * A count is only meaningful if every project's compiler run COMPLETED. A tsc
 * killed by an out-of-memory error prints no diagnostics, so its project
 * contributes 0 errors and the total drops below baseline — which used to
 * read as "debt reduced" and PASS. The run is therefore validated first
 * (`evaluateRun`) and an invalid run is a FAIL whatever the arithmetic says:
 *
 *   spawn error / output buffer overflow / killed by a signal /
 *     no exit status                                              -> invalid
 *   runner exit status other than 0 or 1                          -> invalid
 *   crash marker in the output (FATAL ERROR, heap out of memory,
 *     Debug Failure, Maximum call stack size exceeded)            -> invalid
 *   a project whose compiler was killed by a signal or failed to
 *     spawn (typecheck-all prints "FAILED (signal …)")            -> invalid
 *   a project section without its result line, or no summary
 *     line, or a summary that disagrees with the sections         -> invalid
 *   a project that exited 0 but printed diagnostics               -> invalid
 *   a project that exited 1/2 (tsc "diagnostics present") but
 *     printed none, or exited with any other status (3 invalid
 *     project, 4 cycle, 134 / 3221226505 crash)                   -> invalid
 *
 * typecheck-all.js exits 1 whenever any project has errors, so the runner's
 * own status cannot tell a crash from ordinary debt; the per-project result
 * lines it prints can.
 *
 * This never fakes a green status: the complete typecheck-all output is
 * streamed through, and the baseline can only be tightened, never relaxed
 * automatically. Blanket `any`/`@ts-ignore`/suppressions to game the count
 * are out of contract (see baseline json note).
 */
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const baselineFile = path.join(__dirname, 'typecheck-baseline.json');

const DIAG = /error TS\d+/;
const CRASH_MARKERS = [
  /FATAL ERROR/,
  /heap out of memory/i,
  /Debug Failure/,
  /Maximum call stack size exceeded/,
];
// tsc ExitStatus: 1 = DiagnosticsPresent_OutputsSkipped, 2 = DiagnosticsPresent_OutputsGenerated.
const DIAGNOSTIC_EXIT_STATUSES = new Set([1, 2]);
// The section, result and summary lines typecheck-all.js prints around each project.
const SECTION_START = /^=== typecheck: (.+) ===$/;
const SECTION_END = /^--- (.+): (?:OK|FAILED \((?:exit (-?\d+)|((?:signal|error) [^)]*))\)) ---$/;
const SUMMARY = /^typecheck summary: (\d+)\/(\d+) projects clean$/;

function countDiagnostics(text) {
  return (text.match(/error TS\d+/g) || []).length;
}

/** Validates a spawnSync result of typecheck-all.js; a total is returned only for a complete run. */
function evaluateRun(run) {
  const r = run || {};
  const output = `${typeof r.stdout === 'string' ? r.stdout : ''}${typeof r.stderr === 'string' ? r.stderr : ''}`;
  const invalid = (reason) => ({ valid: false, reason, output });

  if (r.error) return invalid(`runner could not run (${r.error.code || r.error.name || 'spawn error'})`);
  if (r.signal) return invalid(`runner was killed by signal ${r.signal}`);
  if (typeof r.status !== 'number' || !Number.isInteger(r.status)) return invalid('runner produced no exit status');
  if (r.status !== 0 && r.status !== 1) return invalid(`runner exited with status ${r.status}`);

  const lines = output.split(/\r?\n/);
  const crash = CRASH_MARKERS.find((re) => lines.some((l) => !DIAG.test(l) && re.test(l)));
  if (crash) return invalid(`compiler crashed (output matches ${crash})`);

  const projects = [];
  let current = null;
  let summary = null;
  for (const line of lines) {
    const start = line.match(SECTION_START);
    if (start) {
      if (current) return invalid(`project ${current.name} has no result line`);
      current = { name: start[1], diagnostics: 0 };
      continue;
    }
    const end = line.match(SECTION_END);
    if (end) {
      if (!current || current.name !== end[1]) return invalid(`result line for ${end[1]} without its section`);
      if (end[3]) return invalid(`${end[1]} compiler did not finish (${end[3]})`);
      current.status = end[2] === undefined ? 0 : Number(end[2]);
      projects.push(current);
      current = null;
      continue;
    }
    const sum = line.match(SUMMARY);
    if (sum) {
      summary = { clean: Number(sum[1]), total: Number(sum[2]) };
      continue;
    }
    if (current) current.diagnostics += countDiagnostics(line);
  }
  if (current) return invalid(`project ${current.name} has no result line`);
  if (projects.length === 0) return invalid('runner reported no projects');
  if (!summary) return invalid('runner printed no summary line');
  const clean = projects.filter((p) => p.status === 0).length;
  if (summary.total !== projects.length || summary.clean !== clean) {
    return invalid(`summary ${summary.clean}/${summary.total} disagrees with ${clean}/${projects.length} project results`);
  }
  if ((clean === projects.length) !== (r.status === 0)) {
    return invalid(`runner exit status ${r.status} disagrees with the project results`);
  }

  for (const p of projects) {
    if (p.status === 0) {
      if (p.diagnostics !== 0) return invalid(`${p.name} exited 0 but printed ${p.diagnostics} diagnostic(s)`);
    } else if (DIAGNOSTIC_EXIT_STATUSES.has(p.status)) {
      if (p.diagnostics === 0) return invalid(`${p.name} exited ${p.status} (diagnostics present) but no diagnostic could be parsed`);
    } else {
      return invalid(`${p.name} exited with status ${p.status}, which is not a completed type check`);
    }
  }

  return { valid: true, output, projects, total: countDiagnostics(output) };
}

/** Turns a run and the baseline number into the guard's report text and exit code. */
function decide(run, baseline) {
  const evaluated = evaluateRun(run);
  if (!evaluated.valid) {
    return {
      exitCode: 1,
      text:
        `\n── typecheck baseline guard ──\n` +
        `baseline: ${baseline}\n` +
        `RESULT: FAIL — the type check did not complete: ${evaluated.reason}. ` +
        `An incomplete run cannot be compared with the baseline.\n`,
    };
  }

  const actual = evaluated.total;
  const head =
    `\n── typecheck baseline guard ──\n` +
    `baseline: ${baseline}\n` +
    `actual:   ${actual}\n`;

  if (actual > baseline) {
    return {
      exitCode: 1,
      text:
        head +
        `RESULT: FAIL — ${actual - baseline} new TypeScript error(s) above baseline. ` +
        `Fix them or, if intentional and reviewed, justify before adjusting the baseline.\n`,
    };
  }

  if (actual < baseline) {
    return {
      exitCode: 0,
      text:
        head +
        `RESULT: PASS — debt reduced by ${baseline - actual}. ` +
        `Lower "baseline" in scripts/typecheck-baseline.json to ${actual} in a dedicated commit to lock the gain.\n`,
    };
  }

  return { exitCode: 0, text: head + `RESULT: PASS — at baseline, no regression.\n` };
}

module.exports = { evaluateRun, decide, countDiagnostics };

if (require.main === module) {
  const { baseline } = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));

  // The default 1 MiB spawnSync buffer would cut a large error listing short
  // (ENOBUFS); evaluateRun rejects that, so give the full output room.
  const run = spawnSync(
    process.execPath,
    [path.join(__dirname, 'typecheck-all.js')],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  );

  process.stdout.write(`${run.stdout || ''}${run.stderr || ''}`);

  const result = decide(run, baseline);
  process.stdout.write(result.text);
  // Set the exit code and let stdout drain: exiting immediately can cut a
  // large piped output short, verdict line included.
  process.exitCode = result.exitCode;
}
