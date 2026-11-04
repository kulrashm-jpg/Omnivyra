#!/usr/bin/env node
/**
 * Pre-commit secret scan over STAGED ADDED LINES (SEC log-redaction / secret-scan programme).
 *
 * Reuses the SECRETS-GATE detector (scripts/check-secrets.js): the same PATTERNS, the same
 * placeholder recognition and the same fingerprint-pinned allowlist
 * (scripts/security/secrets-allowlist.json). The repo gate scans every tracked file in CI;
 * this script scans only what `git diff --cached` would add, so it is fast enough for a
 * pre-commit hook and catches a credential BEFORE it enters local history.
 *
 * Output: `file:line  [rule-id]` only. A matched value is NEVER printed.
 * Exit 0 = clean, 1 = possible credential(s) staged, 2 = could not run git.
 *
 * Install (founder action, per clone):
 *   printf '#!/bin/sh\nexec node scripts/security/scan-staged-secrets.js\n' > .git/hooks/pre-commit
 *   chmod +x .git/hooks/pre-commit
 */
'use strict';
const path = require('path');
const { execFileSync } = require('child_process');
const { scanText, loadAllowlist, isTrackedDotenv } = require('../check-secrets');

/**
 * Parse unified diff text (as produced by `git diff --cached -U0 --no-color`) into
 * [{ file, line, text }] for every ADDED line, with its line number in the new file.
 * Pure: no I/O.
 */
function parseAddedLines(diffText) {
  const out = [];
  const newFiles = new Set();
  let file = null;
  let lineNo = 0;
  for (const raw of String(diffText).split('\n')) {
    const l = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (l.startsWith('diff --git ')) { file = null; continue; }
    if (l.startsWith('+++ ')) {
      const target = l.slice(4).trim();
      file = target === '/dev/null' ? null : target.replace(/^"?b\//, '').replace(/"$/, '');
      if (file) newFiles.add(file);
      continue;
    }
    if (l.startsWith('--- ')) continue;
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l);
    if (hunk) { lineNo = Number(hunk[1]); continue; }
    if (!file) continue;
    if (l.startsWith('+')) { out.push({ file, line: lineNo, text: l.slice(1) }); lineNo++; continue; }
    if (l.startsWith(' ')) { lineNo++; continue; }
    // '-' lines and '\ No newline at end of file' do not advance the new-file counter.
  }
  return { added: out, files: [...newFiles] };
}

/**
 * Scan diff text. Returns [{ file, line, rule }] — never the matched value.
 * `allowlist` uses the same { file, pattern, fingerprint } entries as the repo gate.
 */
function scanDiff(diffText, { allowlist = [] } = {}) {
  const { added, files } = parseAddedLines(diffText);
  const findings = [];
  for (const f of files) if (isTrackedDotenv(f)) findings.push({ file: f, line: 0, rule: 'tracked-dotenv-file' });
  const used = new Set();
  for (const a of added) {
    if (a.text.length > 20000) continue; // minified bundles / data blobs (same limit as the repo gate)
    for (const hit of scanText(a.text, a.file, allowlist, used)) {
      findings.push({ file: a.file, line: a.line, rule: hit.pattern });
    }
  }
  return findings;
}

function stagedDiff(cwd) {
  return execFileSync('git', ['diff', '--cached', '-U0', '--no-color', '--no-ext-diff', '--diff-filter=ACMR'], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 256 << 20,
  });
}

function main() {
  const root = path.resolve(__dirname, '..', '..');
  let diff;
  try {
    diff = stagedDiff(root);
  } catch (err) {
    console.error(`scan-staged-secrets: could not read the staged diff (${err && err.code ? err.code : 'git error'}).`);
    process.exit(2);
  }
  const findings = scanDiff(diff, { allowlist: loadAllowlist() });
  if (!findings.length) return;
  console.error(`scan-staged-secrets: ${findings.length} possible credential(s) in staged changes — values are never printed:`);
  for (const f of findings) console.error(`  ${f.file}:${f.line}  [${f.rule}]`);
  console.error('Unstage and remove the value (and ROTATE it if it was ever real). For a reviewed synthetic');
  console.error('fixture, use an obvious placeholder or add a fingerprint entry to scripts/security/secrets-allowlist.json.');
  process.exit(1);
}

module.exports = { parseAddedLines, scanDiff };
if (require.main === module) main();
