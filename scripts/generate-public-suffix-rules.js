#!/usr/bin/env node
/**
 * generate-public-suffix-rules.js
 *
 * Turns the vendored Public Suffix List snapshot
 *   lib/shared/domain/publicSuffixList.dat        (upstream text, unmodified)
 *   lib/shared/domain/publicSuffixList.meta.json  (source URL, retrieval date, sha256)
 * into
 *   lib/shared/domain/publicSuffixRules.generated.ts
 *
 * Why a generated module and not an fs read: lib/shared/domain is documented
 * as safe for BOTH server and browser bundles, so the runtime must not need
 * `fs` or a path that survives Next.js output tracing.
 *
 * Refresh procedure (no npm dependency involved):
 *   1. curl -sSfL https://publicsuffix.org/list/public_suffix_list.dat \
 *        -o lib/shared/domain/publicSuffixList.dat
 *   2. update publicSuffixList.meta.json (retrievedAt, upstreamVersion,
 *      upstreamCommit, bytes, sha256)
 *   3. node scripts/generate-public-suffix-rules.js
 *
 * The script refuses to run when the .dat does not match the recorded sha256,
 * so the generated rules can never silently drift from the recorded snapshot.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { domainToASCII } = require('url');

const DOMAIN_DIR = path.join(__dirname, '..', 'lib', 'shared', 'domain');
const DAT_PATH = path.join(DOMAIN_DIR, 'publicSuffixList.dat');
const META_PATH = path.join(DOMAIN_DIR, 'publicSuffixList.meta.json');
const OUT_PATH = path.join(DOMAIN_DIR, 'publicSuffixRules.generated.ts');

const CHUNK_CHARS = 4000;

/** ASCII (punycode) form of a rule; keeps the `!` / `*.` markers intact. */
function toAsciiRule(rule) {
  let prefix = '';
  let body = rule;
  if (body.startsWith('!')) {
    prefix = '!';
    body = body.slice(1);
  } else if (body.startsWith('*.')) {
    prefix = '*.';
    body = body.slice(2);
  }
  const ascii = domainToASCII(body);
  if (!ascii) throw new Error(`Cannot convert PSL rule to ASCII: ${rule}`);
  return prefix + ascii;
}

/**
 * Parse the upstream text into a de-duplicated, sorted rule list. Both the
 * ICANN and the PRIVATE sections are kept (the PSL standard applies both).
 * Unicode (IDN) rules are emitted in BOTH their Unicode and punycode forms so
 * a host matches whichever form the caller holds.
 */
function parseRules(datText) {
  if (!datText.includes('// ===BEGIN ICANN DOMAINS===') ||
      !datText.includes('// ===BEGIN PRIVATE DOMAINS===')) {
    throw new Error('publicSuffixList.dat lacks the ICANN/PRIVATE section markers');
  }
  const rules = new Set();
  for (const rawLine of datText.split('\n')) {
    // Per the PSL format: a rule is the line up to the first whitespace.
    const line = rawLine.trim().split(/\s/)[0];
    if (!line || line.startsWith('//')) continue;
    const lower = line.toLowerCase();
    rules.add(lower);
    rules.add(toAsciiRule(lower));
  }
  for (const r of rules) {
    if (/\s/.test(r) || r.includes("'") || r.includes('\\')) {
      throw new Error(`Unexpected character in PSL rule: ${JSON.stringify(r)}`);
    }
  }
  return [...rules].sort();
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** Pure: build the generated module text from the .dat bytes + metadata. */
function buildRulesModule(datBuf, meta) {
  const actual = sha256(datBuf);
  if (actual !== meta.sha256) {
    throw new Error(
      `publicSuffixList.dat sha256 ${actual} does not match publicSuffixList.meta.json ${meta.sha256}`,
    );
  }
  if (datBuf.length !== meta.bytes) {
    throw new Error(`publicSuffixList.dat is ${datBuf.length} bytes; meta records ${meta.bytes}`);
  }
  const rules = parseRules(datBuf.toString('utf8'));
  const joined = rules.join(' ');
  const chunks = [];
  for (let i = 0; i < joined.length; i += CHUNK_CHARS) {
    chunks.push(joined.slice(i, i + CHUNK_CHARS));
  }
  const lines = [
    '/* eslint-disable */',
    '// GENERATED FILE - DO NOT EDIT. Regenerate with: node scripts/generate-public-suffix-rules.js',
    '//',
    '// Public Suffix List snapshot (Mozilla Public License 2.0, https://mozilla.org/MPL/2.0/).',
    `// Source:           ${meta.source}`,
    `// Retrieved:        ${meta.retrievedAt}`,
    `// Upstream version: ${meta.upstreamVersion}`,
    `// Upstream commit:  ${meta.upstreamCommit}`,
    `// Snapshot sha256:  ${meta.sha256} (${meta.bytes} bytes, lib/shared/domain/publicSuffixList.dat)`,
    `// Rules:            ${rules.length} (ICANN + PRIVATE sections; IDN rules in Unicode and punycode)`,
    '',
    'export const PUBLIC_SUFFIX_LIST_META = {',
    `  source: '${meta.source}',`,
    `  retrievedAt: '${meta.retrievedAt}',`,
    `  upstreamVersion: '${meta.upstreamVersion}',`,
    `  upstreamCommit: '${meta.upstreamCommit}',`,
    `  sha256: '${meta.sha256}',`,
    `  ruleCount: ${rules.length},`,
    '} as const;',
    '',
    '/** Space-separated PSL rules: plain, `*.` wildcard and `!` exception. */',
    'export const PUBLIC_SUFFIX_RULES: string =',
    chunks.map((c) => `  '${c}'`).join(' +\n') + ';',
    '',
  ];
  return lines.join('\n');
}

function main() {
  const datBuf = fs.readFileSync(DAT_PATH);
  const meta = JSON.parse(fs.readFileSync(META_PATH, 'utf8'));
  const out = buildRulesModule(datBuf, meta);
  fs.writeFileSync(OUT_PATH, out, 'utf8');
  console.log(`wrote ${path.relative(process.cwd(), OUT_PATH)} (${out.length} chars)`);
}

module.exports = { buildRulesModule, parseRules, DAT_PATH, META_PATH, OUT_PATH };

if (require.main === module) main();
