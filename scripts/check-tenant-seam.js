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
  for (const m of section('TENANT_CHILD_TABLES').matchAll(/^\s{2}([a-z_][a-z0-9_]*): \{ via: '([a-z0-9_]+)', parent: '([a-z0-9_]+)', (?:parentKey: '([a-z0-9_]+)', )?tag: '([a-z]+)' \}/gm)) child.set(m[1], { via: m[2], parent: m[3], parentKey: m[4] || 'id', tag: m[5] });
  for (const m of section('GLOBAL_TABLES').matchAll(/^\s{2}([a-z_][a-z0-9_]*): "/gm)) global.add(m[1]);
  // A registry row the parsers above do not match would make its table invisible to every rule (lead_outreach_plans
  // was, via the digit in lead_signals_v1). Every entry row must be parsed; otherwise the gate refuses to run.
  const rowsIn = (name) => (section(name).match(/^\s{2}[a-z_][a-z0-9_]*: /gm) || []).length;
  for (const [name, got] of [['TENANT_TABLES', direct.size], ['TENANT_CHILD_TABLES', child.size], ['GLOBAL_TABLES', global.size]]) {
    if (rowsIn(name) !== got) throw new Error(`[tenant-seam] registry parse: ${name} has ${rowsIn(name)} rows but ${got} were parsed`);
  }
  // 05 (S1 review, NOTE 1): the generated type no longer proves a child's parent exists (a multi-hop parent is itself
  // a child, so the spec type widened to string). Re-prove it here, which also covers a hand-edit of the generated
  // file: every parent resolves to a direct or child table, and every chain ends at a direct table without a cycle.
  for (const [name, spec] of child) {
    const seen = new Set([name]);
    let p = spec.parent;
    for (let hop = 1; ; hop++) {
      if (direct.has(p)) break;
      if (!child.has(p)) throw new Error(`[tenant-seam] registry: ${name} has parent ${p}, which is neither a direct nor a child tenant table`);
      if (seen.has(p) || hop > 4) throw new Error(`[tenant-seam] registry: ${name}'s parent chain does not end at a direct table within 4 hops`);
      seen.add(p);
      p = child.get(p).parent;
    }
  }
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
/**
 * Provenance of a tenant predicate's VALUE (05: a safe-set, fail closed; never a request-pattern denylist).
 *  'safe'       literal, or derived from a resolved principal / tenant context (SAFE_SOURCES), directly or via
 *               ONE local binding (const/let x = …, const { x } = …) found before the call in the same file;
 *  'request'    derived from req.body / req.query / req.params (directly or via one binding);
 *  'unresolved' anything else (function parameters, other bindings, deeper flows) → R7, reviewed.
 */
const SAFE_SOURCES = /\b(enforceCompanyAccess(?:Uniform)?|resolveUserContext|requireCompanyAccess|requireTenantAccess|getUserCompanyRole|enforceRole|resolvePrincipal|tenantContextFor|systemTenantContext|getCompanyContext|resolveCompanyContext)\s*\(|\b(ctx|tenantCtx|tenantContext|access|principal|userContext|companyAccess)\.(companyId|company_id|organizationId|organization_id)\b|\bTENANT_CTX\b/;
const REQUEST = /\breq\.(body|query|params)\b|\brequest\.(body|query|params)\b/;
function classifyExpr(expr) {
  if (/^(['"`])[^'"`]*\1$/.test(expr) || /^\d+$/.test(expr)) return 'safe';
  if (REQUEST.test(expr)) return 'request';
  if (SAFE_SOURCES.test(expr)) return 'safe';
  return null;
}
/**
 * e9 ruling: a request-derived (or otherwise unresolved) value that has PASSED an access check binding it to the
 * principal earlier in the same file counts as SCOPED ('checked'); the check's offset is recorded. The check must
 * name the same value (the identifier, or the same req.* expression) among its arguments. withRBAC-wrapped
 * handlers bind req.query/req.body company ids by construction (scripts/check-withrbac-binding.js guards that).
 */
const ACCESS_CALL = /\b(enforceCompanyAccess(?:Uniform)?|requireTenantAccess|assertTenantAccess|requireCompanyAccess|enforceRole|getUserCompanyRole|enforceOrgAccess|requireOrgAccess)\s*\(([^;]{0,400})/g;
function accessCheckFor(token, before) {
  if (!token) return -1;
  const esc = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|[^\\w$.])${esc}(?![\\w$])`);
  let at = -1;
  for (const m of before.matchAll(ACCESS_CALL)) if (re.test(m[2])) at = m.index;
  return at;
}
function provenanceOf(valueExpr, code, callIdx) {
  const before = code.slice(Math.max(0, callIdx - 20000), callIdx);
  const offset = Math.max(0, callIdx - 20000);
  const checked = (token) => { const at = accessCheckFor(token, before); return at >= 0 ? { kind: 'checked', at: offset + at } : null; };
  const rbac = /\bwithRBAC\s*\(/.test(code);
  const direct = classifyExpr(valueExpr);
  if (direct === 'safe') return { kind: 'safe' };
  const root = (valueExpr.match(/^([A-Za-z_$][\w$]*)/) || [])[1];
  if (direct === 'request') return checked(valueExpr) || checked(root) || (rbac ? { kind: 'checked-rbac' } : { kind: 'request' });
  if (!root) return { kind: 'unresolved' };
  const esc = root.replace(/\$/g, '\\$');
  const decls = [
    new RegExp(`(?:const|let|var)\\s+${esc}\\s*(?::[^=]{1,80})?=\\s*([^;\\n]{1,240})`, 'g'),
    new RegExp(`(?:const|let|var)\\s*\\{[^}]*\\b${esc}\\b[^}]*\\}\\s*=\\s*([^;\\n]{1,240})`, 'g'),
  ];
  let last = null, lastIdx = -1;
  for (const re of decls) for (const m of before.matchAll(re)) if (m.index > lastIdx) { lastIdx = m.index; last = m[1]; }
  const hop = last == null ? null : classifyExpr(last.trim());
  if (hop === 'safe') return { kind: 'safe' };
  const chk = checked(root);
  if (chk) return chk;
  if (hop === 'request') return rbac ? { kind: 'checked-rbac' } : { kind: 'request' };
  return { kind: 'unresolved' };
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
      // 05: classify the VALUE by SOURCE with a safe-set, fail closed (one-hop trace through a local binding).
      const prov = predicated ? provenanceOf(valueExpr.trim(), code, m.index) : null;
      const provenance = prov ? prov.kind : null;
      const provenanceAt = prov && prov.at != null ? `${rel}:${lineAt(prov.at)}` : null;
      const requestSourced = provenance === 'request';
      // 05: an EMBEDDED select on a tenant chain escapes the predicate for outbound (belongs-to) embeds.
      const embed = /\.select\(\s*(['"`])((?:(?!\1).)*\()/.test(chain.replace(/->>?/g, ''));
      const base = { file: rel, line, table, kind, tag: spec.tag, area: areaOf(rel), mode: reg.direct.has(table) ? 'direct' : 'child', predicated, requestSourced, embed };
      base.provenance = provenance;
      if (provenanceAt) base.provenanceAt = provenanceAt;
      if (embed) findings.push({ rule: 'E', ...base });
      if (requestSourced) findings.push({ rule: 'R6', ...base });
      else if (provenance === 'unresolved') findings.push({ rule: 'R7', ...base });
      if (!marker) { findings.push({ rule: 'R1', ...base }); continue; }
      const e = allow.get(marker);
      if (!e || e.file !== rel || !e.tables.includes(table)) findings.push({ rule: 'R2', marker, ...base });
    }
    // R9: the job bootstrap resolveTenantOfRow is for background work only; in a request handler the tenant comes
    // from the principal. Allowed in pages/api only with an allow-listed `// cross-tenant: <id>` marker (webhooks).
    if (rel.startsWith('pages/api/')) {
      for (const m of code.matchAll(/\bresolveTenantOfRow\s*\(/g)) {
        const line = lineAt(m.index);
        let marker = null;
        for (let k = line - 1; k >= Math.max(1, line - 4); k--) {
          const mm = (rawLines[k - 1] || '').match(/\/\/\s*cross-tenant:\s*([a-z0-9][a-z0-9-]*)/i);
          if (mm) { marker = mm[1]; break; }
        }
        const e = marker && allow.get(marker);
        if (!e || e.file !== rel) findings.push({ rule: 'R9', file: rel, line, table: '-', kind: 'context', tag: 'pii', area: areaOf(rel), mode: '-' });
      }
    }
    // R10 (derive-then-authorize, e1/83 2026-11-13): ownerCompanyOfRow returns only the owning company. Its result
    // must be bound to a variable, and an access call (shape match, 05: (require|enforce|assert)Xxx( ) that takes that
    // variable must come BEFORE the first tenantContextFor / tenantTable / ownedDbTable use after it.
    if (rel.startsWith('pages/api/')) {
      for (const m of code.matchAll(/\bownerCompanyOfRow\s*\(/g)) {
        const line = lineAt(m.index);
        const head = code.slice(Math.max(0, code.lastIndexOf('\n', m.index) + 1), m.index);
        const bound = head.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?$/);
        const r10 = (why) => findings.push({ rule: 'R10', file: rel, line, table: '-', kind: 'context', tag: 'pii', area: areaOf(rel), mode: '-', why });
        if (!bound) { r10('result not bound to a variable'); continue; }
        const v = bound[1];
        const rest = code.slice(m.index);
        const esc = v.replace(/[$]/g, '\\$');
        const access = rest.search(new RegExp('\\b(?:require|enforce|assert)[A-Z]\\w*\\s*\\([^;]*\\b' + esc + '\\b'));
        const use = rest.slice(1).search(/\b(?:tenantContextFor|tenantTable|tenantChildTable|ownedDbTable|supabase\s*\.\s*from)\s*\(/);
        if (access < 0) r10(`no access check takes ${v}`);
        else if (use >= 0 && use + 1 < access) r10(`${v} is used before its access check`);
      }
    }
    for (const m of code.matchAll(/tenantContextFor\s*\(([^;]*?)\)/g)) {
      if (/req\.body/.test(m[1])) findings.push({ rule: 'R4', file: rel, line: lineAt(m.index), table: '-', kind: 'context', tag: 'pii', area: areaOf(rel), mode: '-' });
    }
  }
  stats.markersCoveringSeveralCalls = [...markerUse.values()].filter((n) => n > 1).length;
  return { findings, unclassified, files: files.length };
}

const stats = { windowCapHits: 0, markersCoveringSeveralCalls: 0 };
/**
 * W1 (e9 on C28): tenantTable(...) on a table whose tenant column holds NULL rows in prod, where hiding them is NOT
 * ruled correct, silently hides those rows. Warn with the C28 counts (never blocking; the reviewer decides).
 */
function nullsWarnings() {
  const reg = fs.readFileSync(path.join(ROOT, 'backend', 'db', 'tenantTables.ts'), 'utf8');
  const grab = (name) => { const m = reg.match(new RegExp(`export const ${name}[^=]*=\\s*([\\s\\S]*?);\\n`)); try { return m ? JSON.parse(m[1]) : null; } catch { return null; } };
  const nulls = grab('NULLS_IN_PROD') || {}, ok = new Set(grab('NULLS_HIDING_OK') || []);
  const files = []; for (const d of ['backend', 'pages', 'lib']) walk(path.join(ROOT, d), files);
  const out = [];
  for (const f of files) {
    const rel = path.relative(ROOT, f).replace(/\\/g, '/');
    const src = stripComments(fs.readFileSync(f, 'utf8'));
    for (const m of src.matchAll(/\btenantTable\(\s*'([a-z_][a-z0-9_]*)'/g)) {
      if (nulls[m[1]] && !ok.has(m[1])) out.push(`${rel}: tenantTable('${m[1]}') hides ${nulls[m[1]][0]} of ${nulls[m[1]][1]} prod rows (NULL tenant)`);
    }
  }
  return out;
}
// Pre-launch (owner 2026-11-12): all writes, money/pii/content reads, request-sourced predicates, embeds, and
// unclassified tables (unknown until classified).
const prelaunch = (f) => f.kind === 'write' || f.kind === 'context' || f.tag !== 'other' || f.rule === 'R6' || f.rule === 'E' || (f.rule === 'R7' && (f.kind === 'write' || f.tag !== 'other'));
const { findings, unclassified, files } = scan();
const by = (keyFn) => { const m = new Map(); for (const f of findings) { const k = keyFn(f); m.set(k, (m.get(k) || 0) + 1); } return [...m].sort((a, b) => b[1] - a[1]); };
console.log(`[tenant-seam] scanned ${files} files: ${findings.length} findings (${findings.filter(prelaunch).length} pre-launch), ${[...unclassified.values()].reduce((a, b) => a + b, 0)} unclassified sites over ${unclassified.size} tables`);
console.log(`  without ANY tenant predicate in the call chain: ${findings.filter((f) => f.rule === 'R1' && !f.predicated).length} (pre-launch ${findings.filter((f) => f.rule === 'R1' && !f.predicated && prelaunch(f)).length}; writes ${findings.filter((f) => f.rule === 'R1' && !f.predicated && f.kind === 'write').length})`);
{
  const p = findings.filter((f) => f.rule === 'R1' && f.predicated);
  const c = (v) => p.filter((f) => f.provenance === v).length;
  console.log(`  predicated sites by value provenance: safe ${c('safe')}, access-checked ${c('checked')}, withRBAC ${c('checked-rbac')}, request-unchecked ${c('request')} (R6), unresolved ${c('unresolved')} (R7, review; pre-launch ${findings.filter((f) => f.rule === 'R7' && prelaunch(f)).length})`);
}
console.log(`  request-sourced tenant predicates (R6): ${findings.filter((f) => f.rule === 'R6').length}; embedded selects on tenant chains (E): ${findings.filter((f) => f.rule === 'E').length}; unclassified-table sites (U): ${findings.filter((f) => f.rule === 'U').length}`);
{ const w = nullsWarnings(); console.log(`  W1 tenantTable on a nulls-in-prod table (C28): ${w.length}`); for (const x of w.slice(0, 20)) console.log('    WARN ' + x); }
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
