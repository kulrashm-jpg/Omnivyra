#!/usr/bin/env node
'use strict';
/*
 * recovery-intake.js — byte-level intake of SQL text recovered from the Supabase SQL Editor.
 *
 * Usage:
 *   node scripts/release/recovery-intake.js <artifact-id> <recovered-file>
 *        [--source "<history|snippet:Private|Shared|Favorites> / <name or entry>"]
 *        [--observed-at "<run timestamp as displayed by the dashboard>"]
 *        [--exported-at "<UTC export time>"] [--author "<as displayed>"]
 *        [--repo <worktree root>] [--out <evidence.json>]
 *
 * artifact-id: fix3 | close_anon | revoke8
 *
 * Read-only on inputs. Writes ONE new file (the evidence JSON); refuses to overwrite.
 * Verdicts are textual only:
 *   BYTE_IDENTICAL                       sha256 equal to the committed file
 *   IDENTICAL_AFTER_EOL_NORMALIZATION    equal after CRLF->LF and leading-BOM strip only
 *   DIFFERENT                            anything else (line list, max 50 entries)
 *   NO_REFERENCE_TEXT                    revoke8: nothing committed to compare with
 *   REFERENCE_HASH_MISMATCH              the committed reference file does not match its
 *                                        pinned sha256 (wrong checkout or edited file); no
 *                                        comparison is made — fix the checkout, never the pin
 * This tool NEVER assesses semantic equivalence; that is a catalog question (B1/C1).
 *
 * Exit: 0 BYTE_IDENTICAL, 10 IDENTICAL_AFTER_EOL_NORMALIZATION, 11 DIFFERENT,
 *       12 NO_REFERENCE_TEXT, 3 REFERENCE_HASH_MISMATCH, 2 usage/input error.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TOOL_VERSION = '1.0.0';
// Repo root = two levels above scripts/release/.
const DEFAULT_REPO = path.resolve(__dirname, '..', '..');
const ARTIFACTS = {
  fix3: {
    reference: 'supabase/migrations/20261212000000_content_quality_collaboration_tenant_consistent.sql',
    pinned_sha256: '581926201d268d5bde34b6a6b7be4ee118bac3ed8d62ef88756e7030b2d445d5',
  },
  close_anon: {
    reference: 'supabase/migrations/20261026000000_close_anon_rls_exposure.sql',
    pinned_sha256: '62e2371990ee020d255c9415bf3a76a7063e64f874b42d92364d3d37a589fc82',
  },
  revoke8: { reference: null, pinned_sha256: null },
};
const MAX_DIFF_ENTRIES = 50;
const MAX_SNIPPET = 160;

function die(msg, code) { process.stderr.write('recovery-intake: ' + msg + '\n'); process.exit(code); }

function parseArgs(argv) {
  const pos = []; const opt = {};
  const known = new Set(['source', 'observed-at', 'exported-at', 'author', 'repo', 'out']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      if (!known.has(k)) die('unknown option --' + k, 2);
      if (i + 1 >= argv.length) die('option --' + k + ' needs a value', 2);
      opt[k] = argv[++i];
    } else pos.push(a);
  }
  if (pos.length !== 2) die('usage: recovery-intake.js <fix3|close_anon|revoke8> <recovered-file> [options]', 2);
  return { artifact: pos[0], file: pos[1], opt };
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function profile(buf) {
  let crlf = 0, lf = 0, loneCr = 0, nonAscii = 0;
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b === 0x0d) { if (buf[i + 1] === 0x0a) { crlf++; i++; } else loneCr++; }
    else if (b === 0x0a) lf++;
    else if (b >= 0x80) nonAscii++;
  }
  const bom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  const last = buf.length ? buf[buf.length - 1] : null;
  let utf8Valid = true;
  try { new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (_) { utf8Valid = false; }
  const text = buf.toString('utf8');
  return {
    bytes: buf.length,
    sha256: sha256(buf),
    bom_utf8: bom,
    crlf_count: crlf,
    lf_only_count: lf,
    lone_cr_count: loneCr,
    eol_style: crlf && lf ? 'MIXED' : crlf ? 'CRLF' : lf ? 'LF' : loneCr ? 'CR' : 'NONE',
    trailing_newline: last === 0x0a,
    non_ascii_bytes: nonAscii,
    nbsp_count: (text.match(/\u00a0/g) || []).length,
    utf8_valid: utf8Valid,
  };
}

function normalize(buf) {
  let s = buf;
  if (s.length >= 3 && s[0] === 0xef && s[1] === 0xbb && s[2] === 0xbf) s = s.subarray(3);
  // CRLF -> LF only. Lone CR is left alone on purpose.
  return Buffer.from(s.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
}

// LCS line diff on normalized text; returns entries {op:'-'|'+', ref_line, rec_line, text}.
function lineDiff(refBuf, recBuf) {
  const split = (b) => { const s = b.toString('utf8'); const a = s.split('\n'); if (a.length && a[a.length - 1] === '') a.pop(); return a; };
  const A = split(refBuf), B = split(recBuf);
  // trim common prefix/suffix to keep the DP small
  let pre = 0; while (pre < A.length && pre < B.length && A[pre] === B[pre]) pre++;
  let suf = 0; while (suf < A.length - pre && suf < B.length - pre && A[A.length - 1 - suf] === B[B.length - 1 - suf]) suf++;
  const a = A.slice(pre, A.length - suf), b = B.slice(pre, B.length - suf);
  const n = a.length, m = b.length;
  const total = [];
  if (n * m > 60e6) { // fallback: positional comparison (very large divergent block)
    for (let i = 0; i < Math.max(n, m); i++) {
      if (a[i] !== b[i]) {
        if (i < n) total.push({ op: '-', ref_line: pre + i + 1, rec_line: null, text: a[i] });
        if (i < m) total.push({ op: '+', ref_line: null, rec_line: pre + i + 1, text: b[i] });
      }
    }
    return { entries: total, ref_lines: A.length, rec_lines: B.length, method: 'positional-fallback' };
  }
  const W = m + 1;
  const dp = new Uint32Array((n + 1) * W);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i * W + j] = a[i] === b[j] ? dp[(i + 1) * W + j + 1] + 1 : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { i++; j++; }
    else if (i < n && (j >= m || dp[(i + 1) * W + j] >= dp[i * W + j + 1])) { total.push({ op: '-', ref_line: pre + i + 1, rec_line: null, text: a[i] }); i++; }
    else { total.push({ op: '+', ref_line: null, rec_line: pre + j + 1, text: b[j] }); j++; }
  }
  return { entries: total, ref_lines: A.length, rec_lines: B.length, method: 'lcs' };
}

function main() {
  const { artifact, file, opt } = parseArgs(process.argv.slice(2));
  const spec = ARTIFACTS[artifact];
  if (!spec) die('artifact-id must be one of: ' + Object.keys(ARTIFACTS).join(', '), 2);
  let recBuf;
  try { recBuf = fs.readFileSync(file); } catch (e) { die('cannot read recovered file: ' + e.message, 2); }
  const st = fs.statSync(file);

  const record = {
    schema: 'omnivyra.release-gate.recovered-sql-intake/v1',
    tool: { name: 'recovery-intake.js', version: TOOL_VERSION },
    artifact_id: artifact,
    intake_at_utc: new Date().toISOString(),
    provenance: {
      source: opt.source || null,
      observed_at_as_displayed: opt['observed-at'] || null,
      exported_at_utc: opt['exported-at'] || null,
      author_as_displayed: opt.author || null,
      missing_provenance_fields: ['source', 'observed-at', 'exported-at'].filter((k) => !opt[k]),
    },
    recovered: { path: path.resolve(file), file_mtime_utc: st.mtime.toISOString(), ...profile(recBuf) },
    reference: null,
    verdict: null,
    differences: null,
    semantic_equivalence: 'NOT_ASSESSED_BY_THIS_TOOL',
    notes: [
      'Textual comparison only. Equal text does not prove equal end state (dynamic EXECUTE / branch-on-catalog); unequal text does not prove unequal end state.',
      'Browser copy/paste may rewrite line endings or characters; IDENTICAL_AFTER_EOL_NORMALIZATION is the expected best case for clipboard exports.',
    ],
  };

  let exitCode;
  if (!spec.reference) {
    record.verdict = 'NO_REFERENCE_TEXT';
    record.notes.push('No committed text exists for this artifact. The recovered file, with this record, becomes the reference; it must not be edited or reconstructed.');
    exitCode = 12;
  } else {
    const repo = opt.repo || DEFAULT_REPO;
    const refPath = path.join(repo, spec.reference);
    let refBuf;
    try { refBuf = fs.readFileSync(refPath); } catch (e) { die('cannot read reference ' + refPath + ': ' + e.message, 2); }
    const refProf = profile(refBuf);
    record.reference = { path: refPath, pinned_sha256: spec.pinned_sha256, pinned_hash_matches: refProf.sha256 === spec.pinned_sha256, ...refProf };
    if (!record.reference.pinned_hash_matches) {
      record.verdict = 'REFERENCE_HASH_MISMATCH';
      exitCode = 3;
    } else if (refProf.sha256 === record.recovered.sha256) {
      record.verdict = 'BYTE_IDENTICAL';
      exitCode = 0;
    } else {
      const nRef = normalize(refBuf), nRec = normalize(recBuf);
      record.normalized = { rules: ['strip leading UTF-8 BOM', 'CRLF -> LF'], reference_sha256: sha256(nRef), recovered_sha256: sha256(nRec) };
      if (nRef.equals(nRec)) {
        record.verdict = 'IDENTICAL_AFTER_EOL_NORMALIZATION';
        exitCode = 10;
      } else {
        record.verdict = 'DIFFERENT';
        const d = lineDiff(nRef, nRec);
        record.differences = {
          method: d.method,
          reference_lines: d.ref_lines,
          recovered_lines: d.rec_lines,
          differing_line_entries: d.entries.length,
          truncated: d.entries.length > MAX_DIFF_ENTRIES,
          entries: d.entries.slice(0, MAX_DIFF_ENTRIES).map((e) => ({ ...e, text: e.text.length > MAX_SNIPPET ? e.text.slice(0, MAX_SNIPPET) + '…' : e.text })),
        };
        if (d.entries.length === 0) record.differences.explanation = 'All lines equal after normalization; the difference is trailing newline / lone CR only.';
        exitCode = 11;
      }
    }
  }

  const out = opt.out || path.resolve('intake-' + artifact + '-' + record.recovered.sha256.slice(0, 12) + '.json');
  if (fs.existsSync(out)) die('refusing to overwrite existing evidence file ' + out, 2);
  fs.writeFileSync(out, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });

  const r = record.recovered;
  const lines = [
    'artifact     : ' + artifact,
    'recovered    : ' + r.path,
    '  bytes/sha  : ' + r.bytes + '  ' + r.sha256,
    '  eol        : ' + r.eol_style + ' (CRLF ' + r.crlf_count + ', LF ' + r.lf_only_count + ', loneCR ' + r.lone_cr_count + ') BOM=' + r.bom_utf8 + ' trailingNL=' + r.trailing_newline + ' utf8=' + r.utf8_valid + ' nbsp=' + r.nbsp_count,
  ];
  if (record.reference) lines.push('reference    : ' + record.reference.path, '  bytes/sha  : ' + record.reference.bytes + '  ' + record.reference.sha256 + (record.reference.pinned_hash_matches ? '  (pinned OK)' : '  (PINNED HASH MISMATCH)'));
  else lines.push('reference    : none (no reference text)');
  lines.push('VERDICT      : ' + record.verdict + '   [semantic equivalence: not assessed]');
  if (record.differences) {
    lines.push('differences  : ' + record.differences.differing_line_entries + ' line entries' + (record.differences.truncated ? ' (first 50 shown)' : ''));
    for (const e of record.differences.entries) lines.push('  ' + e.op + (e.op === '-' ? ' ref L' + e.ref_line : ' rec L' + e.rec_line) + ': ' + e.text);
    if (record.differences.explanation) lines.push('  ' + record.differences.explanation);
  }
  if (record.provenance.missing_provenance_fields.length) lines.push('WARNING      : provenance missing: ' + record.provenance.missing_provenance_fields.join(', '));
  lines.push('evidence     : ' + out);
  process.stdout.write(lines.join('\n') + '\n');
  process.exit(exitCode);
}

main();
