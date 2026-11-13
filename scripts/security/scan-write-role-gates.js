#!/usr/bin/env node
/**
 * Write-role gate scan (reusable). Finds API routes that
 *   (a) can WRITE (handle POST/PUT/PATCH/DELETE),
 *   (b) are protected ONLY by a membership gate (any active member of the company passes), and
 *   (c) touch the object you name (tables / identifiers matched by --object),
 * but contain NO role gate. Each hit is a route where a view-only member (Viewer / Engager / VIEW_ONLY) may write.
 *
 * Usage (from the repo root of any worktree):
 *   node scripts/security/scan-write-role-gates.js                              # campaign defaults over pages/api
 *   node scripts/security/scan-write-role-gates.js --dir pages/api/outreach --dir pages/api/lead-intelligence \
 *        --object 'outreach|lead_|dispatch|approval|kill_switch'
 *   node scripts/security/scan-write-role-gates.js --dir pages/api/billing --dir pages/api/admin --dir pages/api/company \
 *        --object 'credit|wallet|billing|invoice|company|user_company_roles' --fail
 * Options:
 *   --dir <path>        folder to scan (repeatable; default pages/api)
 *   --object <regex>    object being written; matched against .from('<table>'), ownedDbTable('<table>') and identifiers
 *                       and the <object>Id / <object>_id identifiers (default: campaign -> campaign tables, campaignId,
 *                       campaign_id). Use '.' to drop the object filter entirely (every write route).
 *   --role-gate <regex> extra role-gate call names your area uses (alternation, no parens), added to the defaults
 *   --membership <regex> extra membership-only gate names, added to the defaults
 *   Recognised structurally (no flag needed): withRBAC(h, [..]) and withRBAC(h, CONST) with a same-file const array,
 *   requireTenantAccess(..., { requireRoleIn: [..] }). A role list that admits VIEW_ONLY / VIEWER / CONTENT_ENGAGER is
 *   NOT a write gate (reported with a note).
 *   --allow <file>      newline list of route paths (relative to the scanned dir root, '#' comments) reviewed as safe
 *   --json              machine-readable output
 *   --fail              exit 1 when any unallowed hit remains (use in a test / CI step)
 *
 * Limits (read before trusting an empty result): this is a TEXT scan. A role check done through a helper whose name
 * is not in the role-gate list is reported as a hit (false positive - add it with --role-gate after reading it). A route
 * that writes through a service without naming the object in the route file is MISSED (false negative). The scan always
 * prints how many files passed each filter, so "0 hits" is distinguishable from "nothing scanned".
 */
'use strict';
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const opt = { dirs: [], object: 'campaign', roleGate: '', membership: '', allow: null, json: false, fail: false };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  const next = () => {
    const v = args[++i];
    if (v === undefined) throw new Error(`${a} needs a value`);
    return v;
  };
  if (a === '--dir') opt.dirs.push(next());
  else if (a === '--object') opt.object = next();
  else if (a === '--role-gate') opt.roleGate = next();
  else if (a === '--membership') opt.membership = next();
  else if (a === '--allow') opt.allow = next();
  else if (a === '--json') opt.json = true;
  else if (a === '--fail') opt.fail = true;
  else if (a === '-h' || a === '--help') {
    console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]);
    process.exit(0);
  } else throw new Error(`unknown option ${a}`);
}
if (opt.dirs.length === 0) opt.dirs.push('pages/api');

const esc = (names) => names.map((n) => `${n}\\(`).join('|');
const ROLE_GATES = [
  'requireCampaignAccess', 'requireCampaignTenantAccess', 'enforceCampaignWriteRole', 'enforceRole', 'hasPermission',
  'isSuperAdmin', 'isPlatformSuperAdmin', 'enforceContentWriteRole',
];
// withOrgAccess -> assertOrgAccess -> requireTenantAccess with no requireRoleIn: membership-only (e1, 2026-11-13).
const MEMBERSHIP_GATES = [
  'enforceCompanyAccess', 'requireTenantAccess', 'requireCompanyAccess', 'requireCompanyContext', 'withOrgAccess', 'assertOrgAccess',
];
const ROLE = new RegExp([esc(ROLE_GATES), opt.roleGate ? `(?:${opt.roleGate})\\(` : null].filter(Boolean).join('|'));
// A role list that admits view-only roles is NOT a write gate.
const VIEW_ROLES = /Role\.(VIEW_ONLY|VIEWER|CONTENT_ENGAGER)\b|['"](VIEW_ONLY|VIEWER|CONTENT_ENGAGER)['"]/;
/**
 * withRBAC(<handler>, [inline list]) or withRBAC(<handler>, CONST) where CONST is a top-level const array in the same
 * file (e1); requireTenantAccess(..., { requireRoleIn: [...] }) (e1). Each counts only when its role list admits no
 * view-only role. Returns 'gated' | 'view-roles' | null.
 */
function structuralRoleGate(s) {
  let sawViewRoles = false;
  const lists = [];
  for (const m of s.matchAll(/withRBAC\(\s*[\w.]+\s*,\s*(\[[^\]]*\]|[A-Za-z_$][\w$]*)/g)) {
    if (m[1].startsWith('[')) lists.push(m[1]);
    else {
      const def = s.match(new RegExp(`^(?:export\\s+)?const\\s+${m[1]}\\b[^=]*=\\s*(\\[[^\\]]*\\])`, 'm'));
      if (def) lists.push(def[1]);
    }
  }
  // requireTenantAccess(req, res, id, { requireRoleIn }) and withOrgAccess(handler, _, { requireRoleIn }) (e1: its third
  // argument is passed through to requireTenantAccess); assertOrgAccess likewise.
  for (const m of s.matchAll(/(?:requireTenantAccess|withOrgAccess|assertOrgAccess)\([^;]*?requireRoleIn\s*:\s*(\[[^\]]*\]|[A-Za-z_$][\w$]*)/g)) {
    if (m[1].startsWith('[')) lists.push(m[1]);
    else {
      const def = s.match(new RegExp(`^(?:export\\s+)?const\\s+${m[1]}\\b[^=]*=\\s*(\\[[^\\]]*\\])`, 'm'));
      lists.push(def ? def[1] : '[]'); // an imported list: counted as a gate, but unverifiable here - read it
    }
  }
  for (const l of lists) {
    if (VIEW_ROLES.test(l)) sawViewRoles = true;
    else return 'gated';
  }
  return sawViewRoles ? 'view-roles' : null;
}
const MEMBERSHIP = new RegExp([esc(MEMBERSHIP_GATES), opt.membership ? `(?:${opt.membership})\\(` : null].filter(Boolean).join('|'));
const WRITE = /\b(POST|PUT|PATCH|DELETE)\b/;
const OBJ = opt.object === '.'
  ? /[\s\S]/
  : new RegExp(
      `\\.from\\(\\s*['"][a-z_]*(?:${opt.object})[a-z_]*['"]|ownedDbTable\\(\\s*['"][a-z_]*(?:${opt.object})[a-z_]*['"]|\\b(?:${opt.object})(?:Id|_id)s?\\b`,
      'i',
    );

const allow = new Set();
if (opt.allow) {
  for (const line of fs.readFileSync(opt.allow, 'utf8').split(/\r?\n/)) {
    const t = line.replace(/#.*/, '').trim();
    if (t) allow.add(t);
  }
}

const walk = (d) =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : /\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name) ? [path.join(d, e.name)] : [],
  );

const counts = { scanned: 0, write: 0, membershipOnlyCandidates: 0, objectMatched: 0, roleGated: 0 };
const hits = [];
const allowedHits = [];
for (const dir of opt.dirs) {
  if (!fs.existsSync(dir)) throw new Error(`no such dir: ${dir} (run from the repo root)`);
  for (const f of walk(dir)) {
    counts.scanned++;
    const s = fs.readFileSync(f, 'utf8');
    if (!WRITE.test(s)) continue;
    counts.write++;
    if (!MEMBERSHIP.test(s)) continue;
    counts.membershipOnlyCandidates++;
    if (!OBJ.test(s)) continue;
    counts.objectMatched++;
    const structural = structuralRoleGate(s);
    if (ROLE.test(s) || structural === 'gated') {
      counts.roleGated++;
      continue;
    }
    const rel = path.relative(process.cwd(), f).replace(/\\/g, '/');
    if (allow.has(rel)) allowedHits.push(rel);
    else hits.push(rel + (structural === 'view-roles' ? '  (role list admits a view-only role)' : ''));
  }
}
if (counts.scanned === 0) {
  console.error('scan-write-role-gates: scanned 0 files - wrong --dir or wrong cwd; an empty result here proves nothing');
  process.exit(2);
}
if (opt.json) console.log(JSON.stringify({ options: opt, counts, hits, allowedHits }, null, 2));
else {
  console.log(`scanned ${counts.scanned} | write-capable ${counts.write} | behind a membership gate ${counts.membershipOnlyCandidates} | touch /${opt.object}/ ${counts.objectMatched} | role-gated ${counts.roleGated}`);
  console.log(`UNGATED WRITE ROUTES: ${hits.length}${allowedHits.length ? ` (+${allowedHits.length} allow-listed)` : ''}`);
  for (const h of hits) console.log(`  ${h}`);
}
if (opt.fail && hits.length > 0) process.exit(1);
