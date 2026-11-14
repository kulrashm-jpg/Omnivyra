#!/usr/bin/env node
/**
 * Actor-FK / CHECK parity for the T2 workflow (#28; reviewer virality-05).
 *
 * scripts/ci/check-actor-fk-compatibility.js reports ERROR findings against a
 * replayed catalog. origin/main itself carries such findings (9 on 2026-11-10, the
 * DEFECT-008 shape), so an absolute gate would fail on every branch. Like the jest
 * parity gate, this compares HEAD with BASE and fails only on what is NEW on HEAD.
 *
 * Input per side: the checker's `--json` output (one JSON document: findings[],
 * known_open[], stale_known[], counts, coverage). Structured fields, no text parsing.
 * Identity of a finding = `<rule> public.<table>.<column> [<constraint>]`.
 *
 * Three sets are compared, each failing on an entry present on HEAD and absent on BASE:
 *   - error findings      (a new contradiction);
 *   - known_open          (a contradiction acknowledged in set-null-known-defects.json.
 *                          Without this, moving a finding from ERROR to KNOWN OPEN would read
 *                          as "resolved on HEAD": the .skip() bypass in another form. The
 *                          acknowledgement lands on BASE only through a reviewed merge to main);
 *   - stale_known         (an acknowledgement that no longer reproduces; the checker counts
 *                          these as errors).
 * It also FAILS (exit 1) when either side cannot be compared:
 *   - the log is missing (the real-schema job for that side never reached the actor-FK step);
 *   - the log is not the checker's JSON, or the event/coverage is wrong (the checker misbehaved);
 *   - counts.error != error findings + stale_known (internal inconsistency: refuse to compare).
 *
 * SAME DETECTOR ON BOTH SIDES: the comparison is only meaningful if HEAD and BASE ran the same
 * checker. A HEAD edit that weakens a rule would make its finding vanish from all three HEAD sets
 * and read as "resolved". So --head-detector-sha / --base-detector-sha (sha256 of
 * scripts/ci/check-actor-fk-compatibility.js on each side) must match, unless --detector-ack
 * lists HEAD's sha with a reason (`<sha256> # <reason>`). That ack file is migration-class (#27).
 * The BASE hash is of the commit the base producer actually checked out (it records `git rev-parse
 * HEAD` beside base.json), never a recomputed merge base. An ack whose sha equals both sides is
 * STALE (the change is on main) and fails, so no line stands as a permanent pre-authorisation.
 *
 * BOUNDED GUARANTEE: this script and the workflow run from HEAD, so a HEAD edit to either can
 * defeat every check here. The root of trust is human review of those two files (#27
 * clarification 3), not this code.
 *
 * COUPLING: a broken BASE (main) blocks every HEAD branch until main is fixed. That is
 * deliberate (cannot compare != nothing new). Once main is green, re-run via workflow_dispatch.
 *
 * Usage: node scripts/ci/t2-actor-fk-parity.js --head <json> --base <json>
 *          --head-detector-sha <hex> --base-detector-sha <hex> [--detector-ack <file>]
 */
'use strict';
const fs = require('fs');

const ident = (f) => `${f.rule} public.${f.table}.${f.column} [${f.constraint || ''}]`;

function parseLog(file, label) {
  if (!file || !fs.existsSync(file)) {
    throw new Error(`${label}: no actor-FK result (${file}). The real-schema job for ${label} did not reach the actor-FK step: ` +
      `most likely its migration replay or suites failed; read the "Real-schema replay + suites (${label.toLowerCase()})" job` +
      (label === 'BASE' ? '. For BASE that is a defect on main: fix main, then re-run this workflow via workflow_dispatch.' : '.'));
  }
  let r;
  try { r = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
    throw new Error(`${label}: the actor-FK checker misbehaved: its output is not JSON (${e.message})`);
  }
  if (!r || r.event !== 'actor_fk_compatibility.check') throw new Error(`${label}: the actor-FK checker misbehaved: no actor_fk_compatibility.check event`);
  if (!Array.isArray(r.findings) || !Array.isArray(r.known_open) || !Array.isArray(r.stale_known) || !r.counts) {
    throw new Error(`${label}: the actor-FK checker misbehaved: findings/known_open/stale_known/counts missing`);
  }
  const tables = r.coverage && r.coverage.tables;
  if (!(tables > 0)) throw new Error(`${label}: the checker read ${tables} tables (not a replayed catalog)`);
  const errors = new Set(r.findings.filter((f) => f.severity === 'error').map(ident));
  const known = new Set(r.known_open.map(ident));
  const stale = new Set(r.stale_known.map(String));
  if (Number(r.counts.error) !== errors.size + stale.size) {
    throw new Error(`${label}: counts.error=${r.counts.error} but ${errors.size} error finding(s) + ${stale.size} stale acknowledgement(s) were listed; refusing to compare`);
  }
  return { errors, known, stale, tables };
}

const minus = (a, b) => [...a].filter((x) => !b.has(x)).sort();

function compare(head, base) {
  return {
    newErrors: minus(head.errors, base.errors),
    newKnown: minus(head.known, base.known),
    // Keep this. It is not noise: it also shuts PRE-registering an acknowledgement for a finding
    // a branch is about to introduce (an ack with no matching finding is stale on HEAD).
    newStale: minus(head.stale, base.stale),
    // Resolved = gone from errors on HEAD and NOT merely reclassified into known_open.
    resolved: minus(base.errors, head.errors).filter((x) => !head.known.has(x)),
    reclassified: minus(base.errors, head.errors).filter((x) => head.known.has(x)),
  };
}

/** Throws unless both detector hashes are present and equal, or HEAD's hash is acknowledged. Returns a note. */
function checkDetector(headSha, baseSha, ackFile) {
  const hex = /^[0-9a-f]{64}$/;
  // sha256 of empty input: what `git show <absent blob> | sha256sum` yields. Distrust the workflow.
  const EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  if (headSha === EMPTY || baseSha === EMPTY) {
    throw new Error('the detector blob was empty or absent on ' + (headSha === EMPTY ? 'HEAD' : 'BASE') + ' (sha256 of empty input); nothing was observed');
  }
  if (!hex.test(String(headSha || '')) || !hex.test(String(baseSha || ''))) {
    throw new Error(`detector hashes missing or malformed (head=${headSha}, base=${baseSha}); cannot prove both sides ran the same checker`);
  }
  const acks = new Map();
  if (ackFile && fs.existsSync(ackFile)) {
    fs.readFileSync(ackFile, 'utf8').split(/\r?\n/).forEach((raw, i) => {
      const line = raw.trim();
      if (!line || line.startsWith('#')) return;
      const m = line.match(/^([0-9a-f]{64})\s+#\s+(\S.*)$/);
      if (!m) throw new Error(`${ackFile}:${i + 1}: a detector-change acknowledgement is "<sha256> # <reason>"`);
      acks.set(m[1], m[2]);
    });
  }
  if (headSha === baseSha) {
    if (acks.has(headSha)) {
      throw new Error(`STALE DETECTOR ACK: ${ackFile} lists ${headSha}, which BASE already runs; prune the line`);
    }
    return `detector identical on both sides (${headSha})`;
  }
  if (acks.has(headSha)) return `detector CHANGED on HEAD (${headSha}), acknowledged: ${acks.get(headSha)}`;
  throw new Error(`check-actor-fk-compatibility.js differs between HEAD (${headSha}) and BASE (${baseSha}); ` +
    'a weakened rule would read as "resolved". If the change is intended and reviewed, list HEAD\'s sha256 with a reason in the --detector-ack file');
}

function main() {
  const args = process.argv.slice(2);
  const get = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  let head, base;
  try {
    process.stdout.write(checkDetector(get('--head-detector-sha'), get('--base-detector-sha'), get('--detector-ack')) + '\n');
    head = parseLog(get('--head'), 'HEAD');
    base = parseLog(get('--base'), 'BASE');
  } catch (e) {
    process.stderr.write(`ACTOR-FK PARITY FAILED: ${e.message}\n`);
    process.exitCode = 1;
    return;
  }
  const c = compare(head, base);
  process.stdout.write(JSON.stringify({
    event: 't2.actor_fk_parity', head_errors: head.errors.size, base_errors: base.errors.size,
    head_known_open: head.known.size, base_known_open: base.known.size,
    new_errors: c.newErrors.length, new_known_open: c.newKnown.length, new_stale: c.newStale.length,
    resolved_on_head: c.resolved.length, reclassified_on_head: c.reclassified.length,
  }) + '\n');
  const list = (t, ids) => { if (ids.length) process.stdout.write(`\n${t} (${ids.length}):\n` + ids.map((x) => '  ' + x).join('\n') + '\n'); };
  list('NEW ERROR ON HEAD', c.newErrors);
  list('NEW KNOWN-OPEN ACKNOWLEDGEMENT ON HEAD (an ERROR suppressed or reclassified; lands only via a reviewed merge to main)', c.newKnown);
  list('NEW STALE ACKNOWLEDGEMENT ON HEAD', c.newStale);
  list('RESOLVED ON HEAD (gone, not reclassified)', c.resolved);
  const bad = c.newErrors.length + c.newKnown.length + c.newStale.length;
  if (bad) {
    process.stderr.write(`ACTOR-FK PARITY FAILED: ${bad} entr(y/ies) on HEAD that are not on BASE\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`ACTOR-FK PARITY PASS: nothing new (${base.errors.size} error(s), ${base.known.size} known-open pre-existing on base)\n`);
  process.exitCode = 0;
}

if (require.main === module) main();
module.exports = { parseLog, compare, ident, checkDetector };
