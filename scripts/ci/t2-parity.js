#!/usr/bin/env node
/**
 * T2 parity gate (owner decision #28; reviewer virality-05).
 *
 * Compares the whole-repo jest run on HEAD with the same run on the BASE ref, by
 * TEST NAME, never by count. A test is identified as `<repo-relative file>::<fullName>`;
 * a suite that fails to run at all is `<file>::<suite failed to run>`. Skipped/pending
 * tests did not run, so they are in neither the executed nor the failing set.
 *
 * FAILS (exit 1) when:
 *   - any shard result is missing or unreadable on either side (expected --shards per side);
 *   - either side executed fewer than --min-tests tests (a total-collapse trip: 0 tests is
 *     a verification failure, not a pass);
 *   - HEAD executed more than --max-drop-pct percent fewer tests than BASE (relative,
 *     measured in the same run, so it never goes stale);
 *   - the set of test identities present on BOTH sides is empty (vacuous comparison);
 *   - any test or suite fails on HEAD that did not fail on BASE (including a new test);
 *   - any test that RAN on BASE does not run on HEAD (deleted, renamed or `.skip()`ed),
 *     unless it is listed in the acknowledgement file (--ack). This closes the cheapest
 *     way to turn red green: skipping a failing test. A test is only reported "fixed"
 *     if it still runs on HEAD.
 *
 * Usage: node scripts/ci/t2-parity.js --head <dir> --base <dir> [--shards 4]
 *          [--min-tests 1000] [--max-drop-pct 2] [--ack scripts/ci/t2-acknowledged-removals.txt]
 * The ack file lists one test identity per line, each followed by ` # <reason>`; blank
 * lines and lines starting with # are ignored. An entry without a reason is rejected.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SUITE_FAILED = '<suite failed to run>';

function parseArgs(argv) {
  const a = { shards: 4, minTests: 1000, maxDropPct: 2, ack: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--head') { a.head = v; i++; }
    else if (k === '--base') { a.base = v; i++; }
    else if (k === '--shards') { a.shards = Number(v); i++; }
    else if (k === '--min-tests') { a.minTests = Number(v); i++; }
    else if (k === '--max-drop-pct') { a.maxDropPct = Number(v); i++; }
    else if (k === '--ack') { a.ack = v; i++; }
    else if (k === '--quarantine') { a.quarantine = v; i++; }
  }
  return a;
}

/**
 * QUARANTINE (e9 ruling 2026-11-12: flaky tests get a reason + owner, never a retry loop). One line per test:
 *   <jest test id> # <FLAKY-ID> owner=<track> track=<where the fix is logged> expires=<YYYY-MM-DD> reason=<why>
 * The FLAKY- anchor is LOAD-BEARING (05): the id part is a lazy match, and only the anchor forces it past a " # "
 * inside a test NAME; a looser marker would truncate the id and silently produce a dead entry.
 * Lifetime (05): every entry must expire. While listed, the gate gives that test NO regression protection, so a
 * passed expiry STOPS EXCUSING (the failure counts again) and is warned; an entry matching no HEAD-only failure
 * (stale: fixed, renamed or gone) is warned.
 * A quarantined test still RUNS on both sides; if it fails ONLY on HEAD it is reported as QUARANTINED instead of a
 * new failure. It never excuses a removal and never hides anything else. A malformed line refuses the run.
 */
function readQuarantine(file) {
  const out = new Map();
  if (!file) return out;
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((raw, i) => {
    const line = raw.replace(/\r$/, '').trim();
    if (!line || line.startsWith('#')) return;
    const m = line.match(/^(.*?)\s+#\s+(FLAKY-[A-Z0-9-]+)\s+owner=(\S+)\s+track=(\S+)\s+expires=(\d{4}-\d{2}-\d{2})\s+reason=(\S.*)$/);
    if (!m) throw new Error(`${file}:${i + 1}: quarantine lines need "<id> # FLAKY-<ID> owner=<track> track=<log> expires=<YYYY-MM-DD> reason=<why>"`);
    if (Number.isNaN(Date.parse(m[5] + 'T00:00:00Z'))) throw new Error(`${file}:${i + 1}: expires is not a valid date`);
    if (out.has(m[1])) throw new Error(`${file}:${i + 1}: duplicate quarantine id`);
    out.set(m[1], { flaky: m[2], owner: m[3], track: m[4], expires: m[5], reason: m[6] });
  });
  return out;
}

/** Read one side: returns { files, executed:Set, failed:Set, total } or throws with a reason. */
function readSide(dir, shards, label) {
  if (!dir || !fs.existsSync(dir)) throw new Error(`${label}: results directory missing (${dir})`);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  if (files.length !== shards) throw new Error(`${label}: expected ${shards} shard result(s), found ${files.length} (${files.join(', ') || 'none'})`);
  const executed = new Set();
  const failed = new Set();
  let total = 0;
  for (const f of files) {
    let j;
    try { j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { throw new Error(`${label}: ${f} is not valid jest JSON (${e.message})`); }
    if (!j || !Array.isArray(j.testResults)) throw new Error(`${label}: ${f} has no testResults`);
    for (const suite of j.testResults) {
      const file = String(suite.name || '').replace(/\\/g, '/');
      const asserts = Array.isArray(suite.assertionResults) ? suite.assertionResults : [];
      if (asserts.length === 0 && suite.status === 'failed') {
        const id = `${file}::${SUITE_FAILED}`;
        executed.add(id);
        failed.add(id);
        continue;
      }
      for (const t of asserts) {
        if (t.status === 'pending' || t.status === 'skipped' || t.status === 'todo' || t.status === 'disabled') continue;
        const id = `${file}::${t.fullName || [...(t.ancestorTitles || []), t.title].join(' ')}`;
        executed.add(id);
        total += 1;
        if (t.status === 'failed') failed.add(id);
      }
    }
  }
  return { files, executed, failed, total };
}

/** Parse the acknowledgement file: Map<id, reason>. Throws on an entry without a reason. */
function readAck(file) {
  // Two forms (virality-05):
  //   <old id> # <reason>                -- a genuine removal (the test is gone; reason says why)
  //   <old id> -> <new id> # <reason>    -- a rename/rewrite: counts ONLY if <new id> actually runs on HEAD,
  //                                         so an ack can never excuse a test that silently vanished.
  // An optional leading "[track] " tag attributes the entry (virality-05), so stale warnings can be grouped:
  // entries owned by other tracks are expected to be stale on a given branch; one owned by this branch is a prune.
  // Map<oldId, { reason, replacement | null, track }>.
  //
  // Both ids are VALIDATED as jest ids (<path>.test|spec.<ext>::<name>). A test NAME may itself contain " -> "
  // (state transitions), so the line is split at whichever " -> " leaves BOTH sides valid; exactly one such split
  // must exist, otherwise the line is refused by number (no plausible-looking wrong ids).
  // .spec.* too (virality-05): the typecheck projects exclude **/*.spec.ts alongside **/*.test.ts, so spec files
  // are an expected pattern; without this a renamed/removed spec test could never be acknowledged.
  const JEST_ID = /^[^\s:]+\.(?:test|spec)\.(?:ts|tsx|js|jsx)::\S.*$/;
  const acks = new Map();
  if (!file || !fs.existsSync(file)) return acks;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((raw, i) => {
    let line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const where = `${file}:${i + 1}`;
    let track = 'untagged';
    const tag = line.match(/^\[([A-Za-z0-9_.-]+)\]\s+(.*)$/);
    if (tag) { track = tag[1]; line = tag[2]; }
    const m = line.match(/^(.*?)\s+#\s+(\S.*)$/);
    if (!m) throw new Error(`${where}: an acknowledged removal needs a reason ("<test id> # <reason>" or "<old id> -> <new id> # <reason>")`);
    const lhs = m[1].trim();
    const reason = m[2].trim();
    if (/\s->\s*$/.test(lhs)) throw new Error(`${where}: a rename needs both ids ("<old id> -> <new id> # <reason>")`);
    const parts = lhs.split(' -> ');
    if (parts.length === 1) {
      if (!JEST_ID.test(lhs)) throw new Error(`${where}: "${lhs}" is not a jest test id (<path>.test|spec.<ext>::<name>)`);
      acks.set(lhs, { reason, replacement: null, track });
      return;
    }
    const splits = [];
    for (let k = 1; k < parts.length; k++) {
      const oldId = parts.slice(0, k).join(' -> ').trim();
      const newId = parts.slice(k).join(' -> ').trim();
      if (JEST_ID.test(oldId) && JEST_ID.test(newId)) splits.push([oldId, newId]);
    }
    if (splits.length === 0) {
      // No arrow split yields two ids: it may be a plain id whose NAME contains " -> ".
      if (JEST_ID.test(lhs)) { acks.set(lhs, { reason, replacement: null, track }); return; }
      throw new Error(`${where}: no split of "<old id> -> <new id>" leaves two jest test ids`);
    }
    if (splits.length > 1) throw new Error(`${where}: ambiguous rename: ${splits.length} different " -> " splits each leave two jest test ids`);
    acks.set(splits[0][0], { reason, replacement: splits[0][1], track });
  });
  return acks;
}

function compare(head, base, opts = {}) {
  const minTests = opts.minTests ?? 1000;
  const maxDropPct = opts.maxDropPct ?? 2;
  const acks = opts.acks || new Map();
  const problems = [];
  if (head.total < minTests) problems.push(`HEAD executed ${head.total} tests, below the floor of ${minTests} (a run that executes nothing must not pass)`);
  if (base.total < minTests) problems.push(`BASE executed ${base.total} tests, below the floor of ${minTests}`);
  if (base.total > 0 && head.total < base.total * (1 - maxDropPct / 100)) {
    problems.push(`HEAD executed ${head.total} tests vs ${base.total} on BASE: a drop of more than ${maxDropPct}%`);
  }
  const common = [...head.executed].filter((id) => base.executed.has(id));
  if (common.length === 0) problems.push('the set of tests present on BOTH sides is EMPTY: the comparison would be vacuous (check the base checkout and the shard paths)');
  const quarantine = opts.quarantine || new Map();
  const headOnly = [...head.failed].filter((id) => !base.failed.has(id)).sort();
  // 05: an EXPIRED entry stops excusing - the failure counts again at the deadline (protection restored automatically).
  const today = (opts.today || new Date().toISOString().slice(0, 10));
  const excused = (id) => quarantine.has(id) && !(quarantine.get(id).expires < today);
  const newFailures = headOnly.filter((id) => !excused(id));
  const quarantinedFailures = headOnly.filter((id) => excused(id));
  const staleQuarantine = [...quarantine.keys()].filter((id) => !headOnly.includes(id)).sort();
  const expiredQuarantine = [...quarantine.entries()].filter(([, q]) => q.expires < today).map(([id]) => id).sort();
  const removed = [...base.executed].filter((id) => !head.executed.has(id)).sort();
  // A rename ack is honoured only if its replacement actually runs on HEAD.
  const replacementMissing = removed
    .filter((id) => acks.has(id) && acks.get(id).replacement && !head.executed.has(acks.get(id).replacement))
    .map((id) => `${id} -> ${acks.get(id).replacement}`);
  if (replacementMissing.length) {
    problems.push(`${replacementMissing.length} rename acknowledgement(s) name a replacement that does NOT run on HEAD:\n    ${replacementMissing.join('\n    ')}`);
  }
  const honoured = (id) => acks.has(id) && (!acks.get(id).replacement || head.executed.has(acks.get(id).replacement));
  const removedUnacked = removed.filter((id) => !honoured(id));
  const removedAcked = removed.filter((id) => honoured(id));
  const fixedOnHead = [...base.failed].filter((id) => !head.failed.has(id) && head.executed.has(id)).sort();
  const preExisting = [...head.failed].filter((id) => base.failed.has(id)).sort();
  // Acknowledgements that match nothing removed are stale: harmless, so a warning, not a failure.
  const staleAcks = [...acks.keys()].filter((id) => !removed.includes(id)).sort();
  return { problems, newFailures, quarantinedFailures, staleQuarantine, expiredQuarantine, removedUnacked, removedAcked, staleAcks, fixedOnHead, preExisting, common: common.length };
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  let head, base, acks, quarantine;
  try {
    head = readSide(a.head, a.shards, 'HEAD');
    base = readSide(a.base, a.shards, 'BASE');
    acks = readAck(a.ack);
    quarantine = readQuarantine(a.quarantine);
  } catch (e) {
    process.stderr.write(`T2 PARITY FAILED: ${e.message}\n`);
    process.exitCode = 1;
    return;
  }
  const r = compare(head, base, { minTests: a.minTests, maxDropPct: a.maxDropPct, acks, quarantine });
  const out = {
    event: 't2.parity',
    head_tests: head.total, base_tests: base.total, common_tests: r.common,
    head_failing: head.failed.size, base_failing: base.failed.size,
    new_failures: r.newFailures.length, quarantined_failures: r.quarantinedFailures.length, stale_quarantine: r.staleQuarantine.length, expired_quarantine: r.expiredQuarantine.length, removed_unacknowledged: r.removedUnacked.length, removed_acknowledged: r.removedAcked.length,
    stale_acknowledgements: r.staleAcks.length, fixed_on_head: r.fixedOnHead.length, pre_existing_failures: r.preExisting.length,
  };
  process.stdout.write(JSON.stringify(out) + '\n');
  const list = (title, ids) => { if (ids.length) process.stdout.write(`\n${title} (${ids.length}):\n` + ids.map((x) => '  ' + x).join('\n') + '\n'); };
  list('ONLY FAILING ON HEAD', r.newFailures);
  list('QUARANTINED (failed only on HEAD; known flaky, NOT counted)', r.quarantinedFailures.map((id) => { const q = quarantine.get(id); return `${id}   # ${q.flaky} owner=${q.owner} track=${q.track}`; }));
  list('RAN ON BASE, DOES NOT RUN ON HEAD (deleted, renamed or skipped; not acknowledged)', r.removedUnacked);
  list('RAN ON BASE, DOES NOT RUN ON HEAD (acknowledged)', r.removedAcked.map((id) => {
    const a = acks.get(id);
    return a.replacement ? `${id}   -> ${a.replacement}   # ${a.reason}` : `${id}   # ${a.reason}`;
  }));
  list('FIXED ON HEAD (failed on base, runs and passes on head)', r.fixedOnHead);
  list('WARNING: QUARANTINE EXPIRED (no longer excused: a HEAD-only failure of it counts again; fix it, or renew with a reason)', r.expiredQuarantine.map((id) => `${id}   # ${quarantine.get(id).flaky} expired ${quarantine.get(id).expires}`));
  list('WARNING: STALE QUARANTINE (no HEAD-only failure of this test in this run; if it stays quiet, remove the entry)', r.staleQuarantine.map((id) => `${id}   # ${quarantine.get(id).flaky}`));
  // Grouped by owning track (virality-05): "N stale, owned by other tracks" is expected on a shared overlay; a
  // stale entry owned by the track whose branch this is, is a prune.
  const byTrack = new Map();
  for (const id of r.staleAcks) {
    const t = acks.get(id).track;
    if (!byTrack.has(t)) byTrack.set(t, []);
    byTrack.get(t).push(id);
  }
  for (const [t, ids] of [...byTrack.entries()].sort()) {
    list(`WARNING: STALE ACKNOWLEDGEMENTS, track [${t}] (match no removed test here; prune only if [${t}] is this branch's track)`, ids);
  }
  const failed = r.problems.length || r.newFailures.length || r.removedUnacked.length;
  if (failed) {
    for (const p of r.problems) process.stderr.write(`T2 PARITY FAILED: ${p}\n`);
    if (r.newFailures.length) process.stderr.write(`T2 PARITY FAILED: ${r.newFailures.length} test(s) fail on HEAD that do not fail on BASE\n`);
    if (r.removedUnacked.length) process.stderr.write(`T2 PARITY FAILED: ${r.removedUnacked.length} test(s) ran on BASE and do not run on HEAD; restore them or list them with a reason in the --ack file\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`T2 PARITY PASS: no new failures, no unacknowledged removals (${r.preExisting.length} pre-existing failure(s) on both sides)\n`);
  process.exitCode = 0;
}

if (require.main === module) main();
module.exports = { readSide, readAck, readQuarantine, compare, SUITE_FAILED };
