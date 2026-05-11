#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = process.cwd();
const ignoredDirs = new Set([
  '.git',
  '.next',
  '.playwright-browsers',
  'coverage',
  'dist',
  'node_modules',
  'test-results',
]);
const scannedExtensions = new Set(['.js', '.jsx', '.ts', '.tsx']);
const storageAllowlist = new Set([
  path.normalize('tests/auth/authTestHarness.ts'),
  path.normalize('utils/authStorage.ts'),
]);

const failures = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (scannedExtensions.has(path.extname(entry.name))) scanFile(full);
  }
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function rel(file) {
  return path.relative(root, file).replace(/\\/g, '/');
}

function addFailure(file, message) {
  failures.push(`${rel(file)}: ${message}`);
}

function scanFile(file) {
  const relative = path.normalize(path.relative(root, file));
  const source = fs.readFileSync(file, 'utf8');
  const uncommented = stripComments(source);

  if (relative === path.normalize('pages/auth/callback.tsx')) {
    if (/\.auth\.getSession\s*\(/.test(uncommented)) {
      addFailure(file, 'auth callback must not call auth.getSession() as verification fallback');
    }
    if (!/exchangeCodeForSession\s*\(/.test(uncommented) && !/setSession\s*\(/.test(uncommented)) {
      addFailure(file, 'auth callback must establish session only from token exchange or explicit hash token setSession');
    }
    if (!/verification_invalid_or_expired/.test(uncommented)) {
      addFailure(file, 'auth callback must fail closed to verification_invalid_or_expired');
    }
    if (!/clearBrowserAuthState\s*\(/.test(uncommented)) {
      addFailure(file, 'auth callback failures must clear browser auth state');
    }
  }

  if (!storageAllowlist.has(relative)) {
    const forbiddenStorage = [
      /localStorage\.setItem\s*\(\s*['"]selected_company_id['"]/,
      /localStorage\.getItem\s*\(\s*['"]selected_company_id['"]/,
      /localStorage\.setItem\s*\(\s*['"]company_id['"]/,
      /localStorage\.getItem\s*\(\s*['"]company_id['"]/,
    ];
    for (const pattern of forbiddenStorage) {
      if (pattern.test(uncommented)) {
        addFailure(file, 'feature code must not read/write global selected_company_id or company_id localStorage keys; use user-scoped helpers');
      }
    }
  }
}

walk(root);

if (failures.length > 0) {
  console.error('Auth integrity invariant check failed:\n');
  for (const failure of failures) console.error(`- ${failure}`);
  console.error('\nSee docs/AUTH-INTEGRITY-RULES.md for allowed patterns and rationale.');
  process.exit(1);
}

console.log('Auth integrity invariants passed.');
