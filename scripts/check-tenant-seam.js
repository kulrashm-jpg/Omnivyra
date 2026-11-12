#!/usr/bin/env node
/**
 * Tenant-seam gate (plan S1, owner-approved 2026-11-12). WARN mode by default: it prints today's findings and
 * exits 0. Per-area or pre-launch BLOCK modes exit 1 on findings in scope.
 *
 * R1  ownedDbTable('<t>') / .from('<t>') on a TENANT table (direct or child, backend/db/tenantTables.ts) outside
 *     the seam, without a `// cross-tenant: <id>` marker within the 3 lines above → finding.
 * R2  a cross-tenant marker whose <id> is not in backend/db/crossTenantAllowList.ts, or whose entry does not
 *     name this file and table → finding (the allow-list cannot be self-granted inline).
 * R4  tenantContextFor(…) built from a request body (`req.body`) → finding (the context must come from the
 *     resolved principal).
 * U   a table touched in code that is in NONE of tenant / child / global → "unclassified" (the owning track
 *     classifies it in S2; reported, never blocking).
 * Detection runs on comment-stripped source (calls, not prose); markers are read from the raw lines.
 *
 * Scope tag per finding: kind = write (insert/update/upsert/delete in the call chain) | read, and the table's
 * pre-launch tag (money / pii / content / other). Owner ruling: ALL writes + money/pii/content reads are
 * pre-launch BLOCKING; 'other' reads are scheduled after launch.
 *
 * usage: node scripts/check-tenant-seam.js [--list <out.json>] [--block-area <area>] [--block-prelaunch] [--root <dir>]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const ROOT = path.resolve(arg('--root') || path.join(__dirname, '..'));

const AREAS = [
  ['outreach', /(^|\/)(outreach|whatsapp|email|engagement|community|leadOutreach)/i],
  ['creator', /(^|\/)creator/i],
  ['content', /(^|\/)(content|contents|blog|activity-workspace|daily_content|campaign-content)/i],
  ['media', /(^|\/)(media|assets?|images?|video|shared-media|storage)/i],
  ['leads', /(^|\/)(leads?|active-leads|leadIntelligence|lead-|prospect|leadIngestion|leadMapping)/i],
];
const areaOf = (rel) => (AREAS.find(([, re]) => re.test(rel)) || ['other'])[0];

function loadRegistry() {
  const src = fs.readFileSync(path.join(ROOT, 'backend', 'db', 'tenantTables.ts'), 'utf8');
  const section = (name) => { const i = src.indexOf(`export const ${name}`); const j = src.indexOf('\n}', i); return i < 0 ? '' : src.slice(i, j); };
  const direct = new Map(), child = new Map(), global = new Set();
  for (const m of section('TENANT_TABLES').matchAll(/^\s{2}([a-z_][a-z0-9_]*): \{ column: '([a-z_]+)', tag: '([a-z]+)' \}/gm)) direct.set(m[1], { column: m[2], tag: m[3] });
  for (const m of section('TENANT_CHILD_TABLES').matchAll(/^\s{2}([a-z_][a-z0-9_]*): \{ via: '([a-z_]+)', parent: '([a-z_]+)', tag: '([a-z]+)' \}/gm)) child.set(m[1], { via: m[2], parent: m[3], tag: m[4] });
  for (const m of section('GLOBAL_TABLES').matchAll(/^\s{2}([a-z_][a-z0-9_]*): "/gm)) global.add(m[1]);
  return { direct, child, global };
}
function loadAllowList() {
  const src = fs.readFileSync(path.join(ROOT, 'backend', 'db', 'crossTenantAllowList.ts'), 'utf8');
  const out = new Map();
  for (const m of src.matchAll(/id:\s*'([^']+)',\s*tables:\s*\[([^\]]*)\],\s*file:\s*'([^']+)'/g)) {
    out.set(m[1], { tables: [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]), file: m[3] });
  }
  return out;
}
/** Blank out comments and string contents EXCEPT single-quoted table literals right after a call paren. */
/** Blank out comments (keeping line structure). Linear; collects chars in an array. */
function stripComments(src) {
  const out = new Array(src.length);
  let i = 0, st = null;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (!st) {
      if (c === '/' && n === '/' && src[i - 1] !== ':') { st = 'line'; out[i] = ' '; out[i + 1] = ' '; i += 2; continue; }
      if (c === '/' && n === '*') { st = 'block'; out[i] = ' '; out[i + 1] = ' '; i += 2; continue; }
      out[i] = c; i++; continue;
    }
    if (st === 'line') { if (c === '\n') { st = null; out[i] = c; } else out[i] = ' '; i++; continue; }
    if (c === '*' && n === '/') { st = null; out[i] = ' '; out[i + 1] = ' '; i += 2; continue; }
    out[i] = c === '\n' ? '\n' : ' '; i++;
  }
  return out.join('');
}
function walk(dir, out) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!/^(node_modules|tests?|__tests__|\.next|fixtures)$/.test(e.name)) walk(p, out); }
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.(test|spec|d)\.tsx?$/.test(e.name)) out.push(p);
  }
}

function scan() {
  const reg = loadRegistry();
  const allow = loadAllowList();
  const files = [];
  for (const d of ['backend', 'pages', 'lib']) walk(path.join(ROOT, d), files);
  const findings = [], unclassified = new Map(), markerUse = new Map();
  const SEAM = new Set(['backend/db/tenantTable.ts', 'backend/db/writeOwner.ts']);
  for (const f of files) {
    const rel = path.relative(ROOT, f).replace(/\\/g, '/');
    if (SEAM.has(rel) || rel.startsWith('backend/tests/')) continue;
    const raw = fs.readFileSync(f, 'utf8');
    const code = stripComments(raw);
    const rawLines = raw.split('\n');
    const nl = [];
    for (let q = code.indexOf('\n'); q >= 0; q = code.indexOf('\n', q + 1)) nl.push(q);
    const lineAt = (idx) => { let lo = 0, hi = nl.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (nl[mid] < idx) lo = mid + 1; else hi = mid; } return lo + 1; };
    for (const m of code.matchAll(/(?:\bownedDbTable|\.from)\(\s*'([a-z_][a-z0-9_]*)'\s*\)/g)) {
      const table = m[1];
      if (reg.global.has(table)) continue;
      const spec = reg.direct.get(table) || reg.child.get(table);
      if (!spec) {
        unclassified.set(table, (unclassified.get(table) || 0) + 1);
        const kindU = /\.(insert|update|upsert|delete)\(/.test(code.slice(m.index, m.index + 600).split(/;\s*\n/)[0]) ? 'write' : 'read';
        findings.push({ rule: 'U', file: rel, line: lineAt(m.index), table, kind: kindU, tag: 'unclassified', area: areaOf(rel), mode: '-', predicated: false });
        continue;
      }
      const line = lineAt(m.index);
      const window = code.slice(m.index, m.index + 600);
      const term = window.search(/;\s*\n/);
      if (term < 0) stats.windowCapHits++; // 05: a chain longer than the window may hide its write verb
      const chain = term < 0 ? code.slice(m.index, m.index + 2000) : window.slice(0, term);
      const kind = /\.(insert|update|upsert|delete)\(/.test(chain) ? 'write' : 'read';
      // marker: within the 3 raw lines above the call line
      let marker = null, markerLine = 0;
      for (let k = line - 1; k >= Math.max(1, line - 4); k--) {
        const mm = (rawLines[k - 1] || '').match(/\/\/\s*cross-tenant:\s*([a-z0-9][a-z0-9-]*)/i);
        if (mm) { marker = mm[1]; markerLine = k; break; }
      }
      if (marker) { const key = `${rel}:${markerLine}`; markerUse.set(key, (markerUse.get(key) || 0) + 1); }
      // Tenant predicate by hand (.eq/.in/.match on the tenant column or the child's parent FK; or the column in
      // a payload). 05: PRESENCE is triage only; the VALUE's SOURCE decides safety. A predicate whose value is
      // reachable from req.body / req.query / params is a FINDING (R6), not a pass.
      const tcol = reg.direct.has(table) ? spec.column : spec.via;
      const predRe = new RegExp(`\\.(?:eq|in|match)\\(\\s*['"\`]${tcol}['"\`]\\s*,\\s*([^)]{0,160})\\)|\\b${tcol}\\s*:\\s*([^,}\\n]{0,160})`);
      const pm = chain.match(predRe);
      const predicated = !!pm;
      const valueExpr = pm ? (pm[1] || pm[2] || '') : '';
      const requestSourced = predicated && /\breq\.(body|query|params)\b|\bquery\.|\bbody\.|\bparams\./.test(valueExpr);
      // 05: an EMBEDDED select on a tenant chain escapes the predicate for outbound (belongs-to) embeds.
      const embed = /\.select\(\s*(['"`])((?:(?!\1).)*\()/.test(chain.replace(/->>?/g, ''));
      const base = { file: rel, line, table, kind, tag: spec.tag, area: areaOf(rel), mode: reg.direct.has(table) ? 'direct' : 'child', predicated, requestSourced, embed };
      if (embed) findings.push({ rule: 'E', ...base });
      if (requestSourced) findings.push({ rule: 'R6', ...base });
      if (!marker) { findings.push({ rule: 'R1', ...base }); continue; }
      const e = allow.get(marker);
      if (!e || e.file !== rel || !e.tables.includes(table)) findings.push({ rule: 'R2', marker, ...base });
    }
    for (const m of code.matchAll(/tenantContextFor\s*\(([^;]*?)\)/g)) {
      if (/req\.body/.test(m[1])) findings.push({ rule: 'R4', file: rel, line: lineAt(m.index), table: '-', kind: 'context', tag: 'pii', area: areaOf(rel), mode: '-' });
    }
  }
  stats.markersCoveringSeveralCalls = [...markerUse.values()].filter((n) => n > 1).length;
  return { findings, unclassified, files: files.length };
}

const stats = { windowCapHits: 0, markersCoveringSeveralCalls: 0 };
// Pre-launch (owner 2026-11-12): all writes, money/pii/content reads, request-sourced predicates, embeds, and
// unclassified tables (unknown until classified).
const prelaunch = (f) => f.kind === 'write' || f.kind === 'context' || f.tag !== 'other' || f.rule === 'R6' || f.rule === 'E';
const { findings, unclassified, files } = scan();
const by = (keyFn) => { const m = new Map(); for (const f of findings) { const k = keyFn(f); m.set(k, (m.get(k) || 0) + 1); } return [...m].sort((a, b) => b[1] - a[1]); };
console.log(`[tenant-seam] scanned ${files} files: ${findings.length} findings (${findings.filter(prelaunch).length} pre-launch), ${[...unclassified.values()].reduce((a, b) => a + b, 0)} unclassified sites over ${unclassified.size} tables`);
console.log(`  without ANY tenant predicate in the call chain: ${findings.filter((f) => f.rule === 'R1' && !f.predicated).length} (pre-launch ${findings.filter((f) => f.rule === 'R1' && !f.predicated && prelaunch(f)).length}; writes ${findings.filter((f) => f.rule === 'R1' && !f.predicated && f.kind === 'write').length})`);
console.log(`  request-sourced tenant predicates (R6): ${findings.filter((f) => f.rule === 'R6').length}; embedded selects on tenant chains (E): ${findings.filter((f) => f.rule === 'E').length}; unclassified-table sites (U): ${findings.filter((f) => f.rule === 'U').length}`);
console.log(`  window self-check: ${stats.windowCapHits} chains hit the 600-char window with no terminator (rescanned to 2000), ${stats.markersCoveringSeveralCalls} markers sit within 3 lines of more than one tenant call`);
console.log('  by area:', by((f) => f.area).map(([k, v]) => `${k}=${v}`).join(' '));
console.log('  by rule/kind/tag:', by((f) => `${f.rule}/${f.kind}/${f.tag}`).map(([k, v]) => `${k}=${v}`).join(' '));
// FROZEN BASELINE (owner: "block new" from day one). Keyed by rule|file|table|kind (line-insensitive), counted:
// a key whose count rises above the baseline is NEW. --write-baseline records today; --block-new enforces.
const keyOf = (f) => `${f.rule}|${f.file}|${f.table}|${f.kind}`;
const counts = new Map(); for (const f of findings) counts.set(keyOf(f), (counts.get(keyOf(f)) || 0) + 1);
const wb = arg('--write-baseline');
if (wb) { fs.writeFileSync(wb, JSON.stringify(Object.fromEntries([...counts].sort()), null, 0).replace(/,"/g, ',\n"') + '\n'); console.log(`  baseline written → ${wb} (${counts.size} keys, ${findings.length} findings)`); }
const bf = arg('--baseline');
if (bf) {
  const base = JSON.parse(fs.readFileSync(bf, 'utf8'));
  const added = [];
  for (const [k, n] of counts) if (n > (base[k] || 0)) added.push(`${k} (+${n - (base[k] || 0)})`);
  const gone = Object.keys(base).reduce((s, k) => s + Math.max(0, base[k] - (counts.get(k) || 0)), 0);
  console.log(`  vs baseline: ${added.length} keys grew, ${gone} findings resolved`);
  if (added.length) {
    for (const a of added.slice(0, 40)) console.log('    NEW ' + a);
    if (process.argv.includes('--block-new')) { console.error(`[tenant-seam] BLOCK: ${added.length} new unseamed sites since the frozen baseline (use tenantTable / tenantChildTable, or a cross-tenant marker)`); process.exit(1); }
  }
}
const out = arg('--list');
if (out) {
  fs.writeFileSync(out, JSON.stringify({ findings, unclassified: Object.fromEntries([...unclassified].sort((a, b) => b[1] - a[1])) }, null, 1));
  console.log(`  per-file list → ${out}`);
}
const area = arg('--block-area');
if (area) {
  const hit = findings.filter((f) => f.area === area);
  if (hit.length) { console.error(`[tenant-seam] BLOCK: ${hit.length} findings in area ${area}`); process.exit(1); }
}
if (process.argv.includes('--block-prelaunch')) {
  const hit = findings.filter(prelaunch);
  if (hit.length) { console.error(`[tenant-seam] BLOCK: ${hit.length} pre-launch findings`); process.exit(1); }
}
console.log('[tenant-seam] WARN mode: not blocking');
