#!/usr/bin/env node
/**
 * Semantic comparison of two catalog fingerprints produced by
 * scripts/release/catalog-fingerprint.sql (e.g. production vs a disposable
 * "expected" database where the committed migrations were applied).
 *
 *   node scripts/release/semantic-compare-catalog.js <left.tsv> <right.tsv>
 *        [--json] [--role-map from=to ...]
 *
 * Every fact is a line "section TAB object TAB property TAB value". Differences
 * are classified as:
 *   semantic — privileges, RLS flags, policies, function bodies/security,
 *              constraints, indexes, triggers, default privileges, existence.
 *   noise    — expected environment differences: owner names, ACL "is default"
 *              representation, physical column order, the PG17-only MAINTAIN
 *              privilege, server version.
 *   info     — migration-ledger rows and candidate scope (reported, not judged).
 *
 * Exit: 0 = no semantic difference, 1 = semantic differences, 2 = bad input.
 * Semantic equality is NOT byte identity of the SQL that was applied.
 *
 * Reads two local files only; never connects to a database.
 */
'use strict';

const fs = require('fs');

const FORMAT = 'catalog-fingerprint/1';
const NOISE_PROPERTIES = new Set(['owner', 'acl_is_default', 'column_order']);
const INFO_SECTIONS = new Set(['ledger', 'scope']);
const ACL_SECTIONS = new Set(['acl', 'fnacl', 'defacl', 'colacl']);

function unescapeValue(v) {
  return v.replace(/\\(\\|n|r|t)/g, (_, c) => ({ '\\': '\\', n: '\n', r: '\r', t: '\t' }[c]));
}

function applyRoleMap(token, roleMap) {
  if (!roleMap || roleMap.size === 0) return token;
  return token.split(':').map((part) => (roleMap.has(part) ? roleMap.get(part) : part)).join(':');
}

/** Parse fingerprint text into a Map key -> {section, object, property, value}. */
function parseFingerprint(text, { roleMap, label = 'input' } = {}) {
  const facts = new Map();
  const lines = text.split('\n');
  lines.forEach((raw, i) => {
    const line = raw.replace(/\r$/, '');
    if (line === '') return;
    const parts = line.split('\t');
    if (parts.length !== 4) {
      throw new Error(`${label}:${i + 1}: expected 4 TAB-separated fields, got ${parts.length}`);
    }
    const [section, object0, property0, value0] = parts;
    const object = applyRoleMap(object0, roleMap);
    const property = applyRoleMap(property0, roleMap);
    const value = unescapeValue(value0);
    const key = `${section}\t${object}\t${property}`;
    if (facts.has(key)) throw new Error(`${label}:${i + 1}: duplicate fact ${key.replace(/\t/g, ' | ')}`);
    facts.set(key, { section, object, property, value });
  });
  const fmt = facts.get('meta\tsession\tfingerprint_format');
  if (!fmt) throw new Error(`${label}: missing meta fingerprint_format (not a catalog fingerprint?)`);
  if (fmt.value !== FORMAT) throw new Error(`${label}: unsupported fingerprint format ${fmt.value}`);
  return facts;
}

function aclWithoutMaintain(v) {
  return v.split(',').filter((p) => p !== 'MAINTAIN' && p !== 'MAINTAIN*').join(',');
}

/** Classify one difference. left/right are fact values or undefined. */
function classify(section, property, left, right) {
  if (section === 'meta') return { cls: 'noise', reason: 'session/environment' };
  if (INFO_SECTIONS.has(section)) return { cls: 'info', reason: `${section} is reported, not judged` };
  if (NOISE_PROPERTIES.has(property)) return { cls: 'noise', reason: `${property} is environment-specific` };
  if (ACL_SECTIONS.has(section) && left !== undefined && right !== undefined
      && aclWithoutMaintain(left) === aclWithoutMaintain(right)) {
    return { cls: 'noise', reason: 'differs only by MAINTAIN (PostgreSQL 17+ privilege)' };
  }
  if (ACL_SECTIONS.has(section) && (left === undefined || right === undefined)) {
    const only = left === undefined ? right : left;
    if (aclWithoutMaintain(only) === '') return { cls: 'noise', reason: 'grant consists only of MAINTAIN' };
  }
  return { cls: 'semantic', reason: '' };
}

function compareFingerprints(leftText, rightText, opts = {}) {
  const left = parseFingerprint(leftText, { roleMap: opts.roleMap, label: opts.leftLabel || 'left' });
  const right = parseFingerprint(rightText, { roleMap: opts.roleMap, label: opts.rightLabel || 'right' });

  const scope = new Map();
  for (const facts of [left, right]) {
    for (const f of facts.values()) {
      if (f.section === 'scope' && f.property === 'candidates') scope.set(f.object, f.value);
    }
  }

  const keys = [...new Set([...left.keys(), ...right.keys()])].sort();
  const out = { semantic: [], noise: [], info: [], warnings: [] };
  for (const key of keys) {
    const l = left.get(key);
    const r = right.get(key);
    if (l && r && l.value === r.value) continue;
    const f = l || r;
    const { cls, reason } = classify(f.section, f.property, l && l.value, r && r.value);
    out[cls].push({
      section: f.section,
      object: f.object,
      property: f.property,
      kind: !l ? 'only_right' : !r ? 'only_left' : 'changed',
      left: l ? l.value : null,
      right: r ? r.value : null,
      candidates: scope.get(f.object) || (f.section === 'global' || f.section === 'defacl' ? 'close_anon' : ''),
      reason,
    });
  }

  for (const [name, facts] of [['left', left], ['right', right]]) {
    const ro = facts.get('meta\tsession\ttransaction_read_only');
    if (!ro || ro.value !== 'on') out.warnings.push(`${name}: fingerprint was not taken in a read-only transaction`);
  }
  const scopeDiff = out.info.filter((d) => d.section === 'scope');
  if (scopeDiff.length) out.warnings.push(`candidate scope differs (${scopeDiff.length}); fingerprints were made from different SQL versions`);

  out.equal = out.semantic.length === 0;
  out.counts = {
    left_facts: left.size,
    right_facts: right.size,
    semantic: out.semantic.length,
    noise: out.noise.length,
    info: out.info.length,
  };
  return out;
}

function fmtValue(v) {
  if (v === null) return '(absent)';
  const s = JSON.stringify(v);
  return s.length > 240 ? `${s.slice(0, 237)}...` : s;
}

function renderText(res, leftName, rightName) {
  const lines = [];
  lines.push(`left : ${leftName} (${res.counts.left_facts} facts)`);
  lines.push(`right: ${rightName} (${res.counts.right_facts} facts)`);
  lines.push(`semantic=${res.counts.semantic} noise=${res.counts.noise} info=${res.counts.info}`);
  for (const w of res.warnings) lines.push(`WARNING: ${w}`);
  for (const cls of ['semantic', 'noise', 'info']) {
    if (!res[cls].length) continue;
    lines.push('', `== ${cls.toUpperCase()} ==`);
    for (const d of res[cls]) {
      lines.push(`[${d.candidates || '-'}] ${d.section} ${d.object} ${d.property} (${d.kind})${d.reason ? ` — ${d.reason}` : ''}`);
      lines.push(`    left : ${fmtValue(d.left)}`);
      lines.push(`    right: ${fmtValue(d.right)}`);
    }
  }
  lines.push('', res.equal ? 'RESULT: SEMANTICALLY EQUAL (not a proof of byte-identical applied SQL)' : 'RESULT: SEMANTIC DIFFERENCES FOUND');
  return lines.join('\n') + '\n';
}

function parseArgs(argv) {
  const files = [];
  const roleMap = new Map();
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') json = true;
    else if (a === '--role-map') {
      const m = /^([^=:\s]+)=([^=:\s]+)$/.exec(argv[i + 1] || '');
      if (!m) throw new Error('--role-map expects from=to');
      roleMap.set(m[1], m[2]);
      i += 1;
    } else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else files.push(a);
  }
  if (files.length !== 2) throw new Error('usage: semantic-compare-catalog.js <left.tsv> <right.tsv> [--json] [--role-map from=to]');
  return { files, roleMap, json };
}

function main(argv) {
  let args;
  let res;
  try {
    args = parseArgs(argv);
    const [lf, rf] = args.files;
    res = compareFingerprints(fs.readFileSync(lf, 'utf8'), fs.readFileSync(rf, 'utf8'), {
      roleMap: args.roleMap, leftLabel: lf, rightLabel: rf,
    });
  } catch (e) {
    process.stderr.write(`semantic-compare-catalog: ${e.message}\n`);
    return 2;
  }
  process.stdout.write(args.json ? `${JSON.stringify(res, null, 2)}\n` : renderText(res, args.files[0], args.files[1]));
  return res.equal ? 0 : 1;
}

module.exports = { parseFingerprint, compareFingerprints, classify, renderText, FORMAT };

if (require.main === module) process.exitCode = main(process.argv.slice(2));
