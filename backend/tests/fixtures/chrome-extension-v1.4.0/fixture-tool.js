#!/usr/bin/env node
/**
 * PL-18 (owner ruling 2026-11-13: minimum product code in this PUBLIC repo). Builds / verifies the extension fixture
 * as VERBATIM LINE EXCERPTS of the real extension source - only the lines the two suites assert on.
 *
 *   node fixture-tool.js <extensionSrcDir>            verify: rebuild from source and compare byte-for-byte
 *   node fixture-tool.js <extensionSrcDir> --write    (re)write the fixture files from source
 *
 * For every excerpt it prints the source line range and the md5 of those verbatim (LF) lines, and it checks the
 * WHOLE-FILE properties the suites can no longer see on an excerpt (both resolveDevLocalhostBase call sites guarded,
 * no unguarded call, manifest version) against the FULL source. Exit 0 = fixture matches source; 1 = mismatch.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EXCERPTS = {
  'background/serviceWorker.js': [[31, 31], [128, 128], [141, 180], [357, 357], [1047, 1047]],
  'core/commandProcessor.js': [[270, 304]],
  'core/apiClient.js': [[225, 225], [451, 480], [493, 493]],
};

const srcDir = process.argv[2];
const write = process.argv.includes('--write');
if (!srcDir) { console.error('usage: node fixture-tool.js <extensionSrcDir> [--write]'); process.exit(2); }
const here = __dirname;
const md5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex');
let ok = true;

for (const [rel, ranges] of Object.entries(EXCERPTS)) {
  const lines = fs.readFileSync(path.join(srcDir, rel), 'utf8').replace(/\r/g, '').split('\n');
  const parts = [`// VENDORED EXCERPTS of extension v1.4.0 ${rel} (test fixture only; see README.md). Not runnable.`];
  for (const [a, b] of ranges) {
    const chunk = lines.slice(a - 1, b).join('\n');
    parts.push(`// ---- ${rel} L${a}-${b} md5=${md5(chunk)}`);
    parts.push(chunk);
    console.log(`${rel} L${a}-${b} md5=${md5(chunk)}`);
  }
  const content = parts.join('\n') + '\n';
  const target = path.join(here, rel);
  if (write) { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content); }
  else if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== content) { console.log(`MISMATCH ${rel}`); ok = false; }
}

// manifest: only the field the suites read
const manifest = JSON.parse(fs.readFileSync(path.join(srcDir, 'manifest.json'), 'utf8'));
const manifestOut = JSON.stringify({ version: manifest.version }, null, 2) + '\n';
if (write) fs.writeFileSync(path.join(here, 'manifest.json'), manifestOut);
else if (fs.readFileSync(path.join(here, 'manifest.json'), 'utf8') !== manifestOut) { console.log('MISMATCH manifest.json'); ok = false; }
console.log(`manifest.json version=${manifest.version}`);

// whole-file properties, checked on the FULL source (an excerpt cannot prove "no other call site")
const sw = fs.readFileSync(path.join(srcDir, 'background/serviceWorker.js'), 'utf8');
const guarded = (sw.match(/isDevelopmentBuild\(\)\s*\?\s*await resolveDevLocalhostBase\(\)\s*:\s*null/g) || []).length;
const anyAwait = (sw.match(/await resolveDevLocalhostBase\(\)/g) || []).length;
const props = { guardedCallSites: guarded, awaitedCallSites: anyAwait, bareDevBase: /const devBase = await resolveDevLocalhostBase\(\);/.test(sw) };
console.log('whole-file:', JSON.stringify(props));
if (guarded !== 2 || anyAwait !== 2 || props.bareDevBase) { console.log('WHOLE-FILE PROPERTY FAILED'); ok = false; }

console.log(ok ? (write ? 'WRITTEN' : 'FIXTURE MATCHES SOURCE') : 'FIXTURE DOES NOT MATCH SOURCE');
process.exit(ok ? 0 : 1);
