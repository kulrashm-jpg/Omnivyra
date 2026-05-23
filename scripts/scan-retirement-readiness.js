#!/usr/bin/env node
/**
 * Compatibility retirement readiness scanner (READ-ONLY).
 *
 * Purpose:
 *   Enumerate every `TODO(remove-after-<token>)` annotation in the
 *   codebase, cross-reference against
 *   `docs/planner-cleanup-inventory.md`, and emit two structured
 *   events:
 *
 *     * `compatibility_layer_age` — once per discovered token,
 *       reporting days_active (via git blame) and site count.
 *     * `compatibility_retirement_readiness` — once per token,
 *       reporting ready_for_removal and any blockers.
 *
 * Inputs (no arguments required):
 *   - The current working directory's git repository.
 *   - docs/planner-cleanup-inventory.md as the canonical inventory.
 *
 * Outputs:
 *   stdout: one JSON-encoded structured event per line. Pipe to log
 *           collector.
 *   stderr: human-readable summary table.
 *
 * Exit codes:
 *   0 — scan succeeded (regardless of readiness verdicts)
 *   2 — environmental failure (git unavailable, inventory missing)
 *
 * Governance contract (per docs/governance-tooling-guarantees.md):
 *   read-only; deterministic against repo state; no mutation of code,
 *   git, or telemetry stream. Safe to run repeatedly.
 *
 * Discovery contract:
 *   The script only counts MEANINGFUL annotations. It excludes
 *   matches inside its own source (this file) and inside docs/
 *   so the inventory-doc's example annotations don't show up as
 *   live transitional code.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const TODO_REGEX = /TODO\(remove-after-([a-z0-9-]+)\)/g;
const INVENTORY_PATH = path.join(process.cwd(), 'docs', 'planner-cleanup-inventory.md');

// Self-exclusion: this script + the inventory doc + the retirement
// strategy doc all CONTAIN example annotations. They are not live
// transitional code sites.
const EXCLUDE_PATHS = [
  path.normalize('scripts/scan-retirement-readiness.js'),
  path.normalize('docs/planner-cleanup-inventory.md'),
  path.normalize('docs/planner-compatibility-retirement.md'),
  path.normalize('docs/telemetry-taxonomy.md'),
];

function shellOk(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    return null;
  }
}

function listGitFiles() {
  // Use git ls-files so we honor .gitignore and don't scan node_modules.
  const out = shellOk('git ls-files');
  if (!out) return null;
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

function scanFile(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }
  const hits = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    TODO_REGEX.lastIndex = 0;
    const matches = [...lines[i].matchAll(TODO_REGEX)];
    for (const m of matches) {
      hits.push({ file: filePath, line: i + 1, token: m[1] });
    }
  }
  return hits;
}

function gitBlameDate(filePath, lineNumber) {
  // git log -L "<line>,<line>:<path>" --pretty=%aI -- <path> returns
  // ISO author dates oldest→newest. We want the OLDEST commit that
  // touched that line — that approximates when the TODO was added.
  // We use --reverse and -n 1 to grab the first.
  // NOTE: git -L doesn't accept --reverse directly; use the -L range
  // form and take the last entry, which corresponds to the original
  // introduction.
  const out = shellOk(`git log -L ${lineNumber},${lineNumber}:"${filePath.replace(/"/g, '\\"')}" --pretty=format:%aI --no-patch`);
  if (!out) return null;
  const dates = out.split('\n').map((s) => s.trim()).filter(Boolean);
  if (dates.length === 0) return null;
  // The earliest date is the bottom of the list (git log orders new→old).
  return dates[dates.length - 1];
}

function loadInventoryTokens() {
  if (!fs.existsSync(INVENTORY_PATH)) return null;
  const text = fs.readFileSync(INVENTORY_PATH, 'utf8');
  // Pull every `remove-after-<token>` mentioned in inventory headers
  // or table cells. Use the same regex shape so the comparison is
  // exact. We don't try to parse the markdown structure beyond that
  // — the token is the join key.
  const seen = new Set();
  for (const match of text.matchAll(/remove-after-([a-z0-9-]+)/g)) {
    seen.add(match[1]);
  }
  return seen;
}

function emitEvent(event, severity, payload) {
  const envelope = {
    event,
    severity,
    deployment_id: process.env.RAILWAY_DEPLOYMENT_ID ?? process.env.VERCEL_DEPLOYMENT_ID ?? null,
    git_sha: process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    worker_pid: process.pid,
    run_id: null,
    planner_stage: 'retirement-readiness-scan',
    timestamp: new Date().toISOString(),
    ...payload,
  };
  process.stdout.write(JSON.stringify(envelope) + '\n');
}

function main() {
  const files = listGitFiles();
  if (!files) {
    process.stderr.write(JSON.stringify({
      event: 'retirement_readiness.error',
      reason: 'git_unavailable',
      message: 'git ls-files failed — run from the project root inside a git repo.',
    }) + '\n');
    process.exit(2);
  }

  const inventoryTokens = loadInventoryTokens();
  if (!inventoryTokens) {
    process.stderr.write(JSON.stringify({
      event: 'retirement_readiness.error',
      reason: 'inventory_missing',
      message: `expected docs/planner-cleanup-inventory.md`,
    }) + '\n');
    process.exit(2);
  }

  // Collect all hits, excluding self/doc references.
  const sitesByToken = new Map();
  for (const file of files) {
    if (EXCLUDE_PATHS.some((p) => path.normalize(file) === p)) continue;
    const hits = scanFile(file);
    for (const hit of hits) {
      if (!sitesByToken.has(hit.token)) sitesByToken.set(hit.token, []);
      sitesByToken.get(hit.token).push(hit);
    }
  }

  // Per-token analysis. Emit age + readiness events. Cross-reference
  // against inventory:
  //   - in code AND in inventory → tracked, emit normally
  //   - in code, NOT in inventory → orphan; emit with warn severity
  //   - in inventory, NOT in code → already retired (or not yet
  //     introduced); skip (operator can also remove from inventory)
  const allTokens = new Set([...sitesByToken.keys(), ...inventoryTokens]);

  process.stderr.write('\n── retirement readiness scan ──\n');
  process.stderr.write('token                                       sites  age(d)  inventory\n');
  process.stderr.write('─'.repeat(75) + '\n');

  for (const token of [...allTokens].sort()) {
    const sites = sitesByToken.get(token) ?? [];
    const inInventory = inventoryTokens.has(token);

    // Age: oldest blame date across all sites.
    let oldestDateIso = null;
    for (const site of sites) {
      const d = gitBlameDate(site.file, site.line);
      if (d && (!oldestDateIso || d < oldestDateIso)) oldestDateIso = d;
    }
    const daysActive = oldestDateIso
      ? Math.floor((Date.now() - Date.parse(oldestDateIso)) / 86400000)
      : null;

    // Emit age event (one per token).
    emitEvent('compatibility_layer_age', 'info', {
      token,
      days_active: daysActive,
      sites_count: sites.length,
      inventory_entry_present: inInventory,
      oldest_site: oldestDateIso,
    });

    // Emit readiness event. Token is retirement-ready only when:
    //   - it has an inventory entry (so removal criteria are documented), AND
    //   - it has zero remaining code sites (every shim deleted)
    const readyForRemoval = inInventory && sites.length === 0;
    const blockingReasons = [];
    if (!inInventory) blockingReasons.push('orphan_no_inventory_entry');
    if (sites.length > 0) blockingReasons.push(`${sites.length}_remaining_code_sites`);

    const severity = !inInventory ? 'warn' : 'info';
    emitEvent('compatibility_retirement_readiness', severity, {
      token,
      ready_for_removal: readyForRemoval,
      sites_count: sites.length,
      blocking_callers: sites.map((s) => `${s.file}:${s.line}`),
      blocking_reasons: blockingReasons,
      outstanding_telemetry_events: token === 'weekly-capacity-cutover'
        ? 'planner_legacy_contract_usage (legacy_field:content_capacity)'
        : token === 'strict-mode-stable'
        ? 'planner_contract_violation (severity:error)'
        : null,
    });

    process.stderr.write(
      token.padEnd(44) +
      String(sites.length).padStart(5) +
      String(daysActive ?? '?').padStart(8) +
      '  ' +
      (inInventory ? '✓ documented' : '✗ ORPHAN — add to inventory') +
      '\n',
    );
  }

  process.stderr.write('\nLegend: sites = live code sites (excluding docs).\n');
  process.stderr.write('         age   = days since oldest annotation was committed.\n');
  process.stderr.write('         inv   = inventory entry presence in docs/planner-cleanup-inventory.md.\n');
  process.stderr.write('\nNote: this scan is READ-ONLY. To retire a token, follow the protocol in\n');
  process.stderr.write('      docs/planner-cleanup-inventory.md §"How to remove an entry".\n');

  process.exit(0);
}

try {
  main();
} catch (err) {
  process.stderr.write(JSON.stringify({
    event: 'retirement_readiness.error',
    reason: 'unhandled',
    message: err && err.message ? err.message : String(err),
  }) + '\n');
  process.exit(2);
}
