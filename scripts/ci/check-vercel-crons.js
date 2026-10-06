#!/usr/bin/env node
/**
 * vercel.crons — every Vercel cron entry must be a real, scheduler-authenticated route.
 *
 * `vercel.json` `crons` make Vercel call an /api route on a schedule. The route-auth
 * gate (scripts/check-route-auth.js) inspects pages/api files but never reads
 * vercel.json, so a cron entry could point at a route that does not exist, or at
 * a route that is not authenticated as a scheduler endpoint. This check closes
 * that gap. For every cron entry:
 *
 *   1. `path` is an /api path with no query string, and is not duplicated;
 *   2. `schedule` is a 5-field cron expression;
 *   3. the path resolves to exactly one route file under pages/
 *      (<path>.ts | <path>.tsx | <path>/index.ts | <path>/index.tsx);
 *   4. that route can authenticate the scheduler: Vercel calls crons with
 *      `Authorization: Bearer $CRON_SECRET`, so the route source must reference
 *      `process.env.CRON_SECRET`, or be allowlisted in
 *      scripts/route-auth-allowlist.json as kind "machine-secret" naming CRON_SECRET.
 *      (General authentication of the route stays the route-auth gate's job.)
 *
 * Read-only: reads vercel.json, the route files and the allowlist.
 * Exit 0 = all entries valid; 1 = findings; 64 = usage.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const CRON_FIELD_RE = /^(\*|\d+|\d+-\d+)(\/\d+)?(,(\*|\d+|\d+-\d+)(\/\d+)?)*$/;

function isCronSchedule(s) {
  if (typeof s !== 'string') return false;
  const fields = s.trim().split(/\s+/);
  return fields.length === 5 && fields.every((f) => CRON_FIELD_RE.test(f));
}

/** Route files an /api path may resolve to (repo-relative, forward slashes). */
function candidateFiles(apiPath) {
  const base = `pages${apiPath}`;
  return [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`];
}

const CRON_SECRET_REF_RE = /process\.env\.CRON_SECRET\b|process\.env\[['"]CRON_SECRET['"]\]/;

/**
 * Pure check. `exists(rel)` reports whether a repo-relative file exists and
 * `read(rel)` returns its source. Returns { crons, findings[] }.
 */
function checkCrons(vercel, allowlist, exists, read) {
  const findings = [];
  const crons = vercel && Array.isArray(vercel.crons) ? vercel.crons : null;
  if (crons === null) return { crons: 0, findings: ['vercel.json has no "crons" array'] };
  const routes = allowlist && allowlist.routes && typeof allowlist.routes === 'object' ? allowlist.routes : null;
  if (routes === null) findings.push('route-auth allowlist has no "routes" object');
  const seen = new Set();
  crons.forEach((c, i) => {
    const where = `crons[${i}]`;
    const p = c && typeof c.path === 'string' ? c.path : null;
    if (p === null || !/^\/api\/[A-Za-z0-9/_\-[\]]+$/.test(p)) {
      findings.push(`${where}: path must be an /api path without a query string (got ${JSON.stringify(c && c.path)})`);
      return;
    }
    if (seen.has(p)) findings.push(`${where}: duplicate cron path ${p}`);
    seen.add(p);
    if (!isCronSchedule(c.schedule)) findings.push(`${where} ${p}: schedule ${JSON.stringify(c.schedule)} is not a 5-field cron expression`);
    const files = candidateFiles(p).filter((f) => exists(f));
    if (files.length === 0) {
      findings.push(`${where} ${p}: no route file (${candidateFiles(p).join(' | ')})`);
      return;
    }
    if (files.length > 1) {
      findings.push(`${where} ${p}: ambiguous route files ${files.join(', ')}`);
      return;
    }
    const entry = routes !== null ? routes[files[0]] : null;
    const allowlistedCron = !!entry && entry.kind === 'machine-secret' && Array.isArray(entry.env) && entry.env.includes('CRON_SECRET');
    let source = '';
    try {
      source = read(files[0]);
    } catch {
      source = '';
    }
    if (!allowlistedCron && !CRON_SECRET_REF_RE.test(source)) {
      findings.push(`${where} ${p}: ${files[0]} cannot authenticate the scheduler (no process.env.CRON_SECRET reference and no machine-secret/CRON_SECRET allowlist entry)`);
    }
  });
  return { crons: crons.length, findings };
}

function main(argv, root = ROOT, log = (s) => process.stdout.write(`${s}\n`)) {
  if (argv.length > 0) {
    log('usage: node scripts/ci/check-vercel-crons.js');
    return 64;
  }
  let vercel;
  let allowlist;
  try {
    vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
    allowlist = JSON.parse(fs.readFileSync(path.join(root, 'scripts', 'route-auth-allowlist.json'), 'utf8'));
  } catch (err) {
    log(`FAIL: cannot read vercel.json or the route-auth allowlist: ${err.message}`);
    return 1;
  }
  const { crons, findings } = checkCrons(
    vercel,
    allowlist,
    (rel) => fs.existsSync(path.join(root, rel)),
    (rel) => fs.readFileSync(path.join(root, rel), 'utf8'),
  );
  if (findings.length === 0) {
    log(`vercel.crons: PASS — ${crons} cron entr${crons === 1 ? 'y' : 'ies'}, each an existing route that authenticates the scheduler`);
    return 0;
  }
  log(`vercel.crons: FAIL — ${findings.length} finding(s) across ${crons} cron entr${crons === 1 ? 'y' : 'ies'}:`);
  for (const f of findings) log(`  - ${f}`);
  return 1;
}

module.exports = { isCronSchedule, candidateFiles, checkCrons, main };

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
