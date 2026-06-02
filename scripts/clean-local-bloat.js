#!/usr/bin/env node
/**
 * Remove local-only generated bulk that should not accumulate between dev runs.
 *
 * This intentionally skips tracked files so it cannot erase source assets or
 * historical fixtures. Use `--dry-run` to inspect what would be removed.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = process.cwd();
const dryRun = process.argv.includes('--dry-run');
const includeBrowsers = process.argv.includes('--include-browsers') || process.env.CLEAN_PLAYWRIGHT_BROWSERS === '1';
const trackedFiles = new Set(
  (() => {
    try {
      return execSync('git ls-files -z', { cwd: root })
        .toString('utf8')
        .split('\0')
        .filter(Boolean)
        .map((item) => item.replace(/\\/g, '/'));
    } catch {
      return [];
    }
  })(),
);

function rel(p) {
  return path.relative(root, p).replace(/\\/g, '/');
}

function exists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function isTracked(file) {
  return trackedFiles.has(rel(file));
}

function shouldDeleteFile(file) {
  return exists(file) && !isTracked(file);
}

function removePath(target, removed) {
  if (!exists(target)) return;
  if (dryRun) {
    removed.push(rel(target));
    return;
  }
  fs.rmSync(target, { recursive: true, force: true });
  removed.push(rel(target));
}

const SKIP_WALK_DIRS = new Set([
  '.git',
  'node_modules',
  '.next',
  '.vercel',
  '.playwright-browsers',
]);

function walk(dir, visit) {
  if (!exists(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_WALK_DIRS.has(entry.name)) continue;
      walk(full, visit);
    } else if (entry.isFile()) {
      visit(full);
    }
  }
}

const removed = [];

// Oversized local logs and runtime state.
for (const target of [
  path.join(root, '.worker-bootstrap.log'),
  path.join(root, 'logs'),
  path.join(root, 'coverage'),
]) {
  removePath(target, removed);
}

// Generated TypeScript/build metadata.
walk(root, (file) => {
  if (/\.tsbuildinfo$/i.test(file) && shouldDeleteFile(file)) {
    removePath(file, removed);
  }
});

// Generated architecture analysis blobs. Keep tracked markdown/reports intact.
const architectureReports = path.join(root, 'architecture-migration', 'reports');
const oversizedReportNames = new Set([
  'call-graph.json',
  'unsafe-propagation-semantic.json',
  'import-graph.json',
  'enforcement-trust-validation.json',
  'authority-graph.json',
  'severity-tier-findings.json',
  'boundary-leaks-risk.json',
]);
walk(architectureReports, (file) => {
  if (oversizedReportNames.has(path.basename(file)) && shouldDeleteFile(file)) {
    removePath(file, removed);
  }
});

// Future visual-check screenshots should be untracked due to .gitignore.
for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  if (!/^tmp.*\.png$/i.test(entry.name)) continue;
  const full = path.join(root, entry.name);
  if (shouldDeleteFile(full)) removePath(full, removed);
}

// Playwright browsers are large but expensive to redownload, so only remove
// when explicitly requested.
if (includeBrowsers) {
  removePath(path.join(root, '.playwright-browsers'), removed);
}

if (removed.length > 0) {
  console.log(`${dryRun ? 'Would remove' : 'Removed'} ${removed.length} local bloat item(s):`);
  removed.slice(0, 30).forEach((item) => console.log(` - ${item}`));
  if (removed.length > 30) console.log(` - ...and ${removed.length - 30} more`);
} else {
  console.log('No local bloat cleanup needed.');
}
