#!/usr/bin/env node
/**
 * ROUTE-AUTH-001 (STEP 3AH-85) — complete pages/api entry-point inventory.
 *
 * Joins the authentication analysis of scripts/check-route-auth.js with a
 * caller trace: every `/api/...` path literal in the tracked repository is
 * extracted once and matched against each route's URL pattern (static segments
 * win over dynamic ones, as in Next.js routing). Callers are bucketed by where
 * they live, because "referenced from a test" and "referenced from the UI" are
 * very different evidence of liveness.
 *
 * Output (default): artifacts/route-auth-inventory.json (git-ignored; regenerate on demand).
 * The reviewed, human-readable inventory lives in docs/security/ROUTE_AUTH_001_3AH85.md.
 * Usage: node scripts/security/route-auth-inventory.js [--out <file>] [--print]
 *
 * Limitations (stated, not hidden): paths assembled at runtime from variables
 * (`'/api/' + name`) cannot be matched, and a path reached only from outside
 * this repository (third-party webhooks, the browser extension store build,
 * operator curl) leaves no in-repo trace. Absence of an in-repo caller is
 * therefore evidence of dormancy, never proof of deadness.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { scanRepo } = require('../check-route-auth');

const ROOT = path.resolve(__dirname, '..', '..');

function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 << 20 });
  return out.split('\0').filter(Boolean);
}

function bucketOf(rel) {
  if (/(^|\/)(__tests__|tests?)\//.test(rel) || /\.(test|spec)\.[tj]sx?$/.test(rel)) return 'tests';
  if (/\.md$|\.txt$|^docs\//i.test(rel)) return 'docs';
  if (rel === 'vercel.json') return 'cron';
  if (/^pages\/api\//.test(rel)) return 'api';
  if (/^(components|hooks|store|styles|public|features|modules|platform|shared|utils|variants|content|templates)\//.test(rel) || (/^pages\//.test(rel) && !/^pages\/api\//.test(rel))) return 'frontend';
  if (/^lib\//.test(rel)) return 'lib';
  if (/^wordpress-plugin\//.test(rel)) return 'wordpress-plugin';
  if (/^backend\/(workers|queue|scheduler)\//.test(rel) || /Dockerfile|railway\.json/.test(rel)) return 'worker';
  if (/^backend\//.test(rel)) return 'backend';
  if (/^(scripts|staging|monitoring|observability|telemetry)\//.test(rel)) return 'scripts';
  return 'other';
}

const TEXT_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|txt|php|html|yml|yaml|sh|ps1|sql)$/i;

function extractApiLiterals() {
  const refs = [];
  for (const rel of trackedFiles()) {
    if (!TEXT_EXT.test(rel) && rel !== 'vercel.json') continue;
    if (/^(node_modules|\.next)\//.test(rel) || /package-lock\.json$/.test(rel)) continue;
    let txt;
    try { txt = fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { continue; }
    if (txt.length > 4_000_000 || !txt.includes('/api/')) continue;
    const bucket = bucketOf(rel);
    for (const m of txt.matchAll(/\/api\/[A-Za-z0-9_\-/\[\].$:{}]*/g)) {
      let lit = m[0].replace(/\$\{[^}]*\}/g, ':x').replace(/[.]+$/, '').replace(/\/+$/, (s) => (s ? '/' : ''));
      if (lit.includes('{') || lit.includes('}')) lit = lit.replace(/[{}$]/g, '');
      refs.push({ lit, rel, bucket });
    }
  }
  return refs;
}

/** pages/api/a/[id]/index.ts → ['api','a',':id'] */
function routeSegments(rel) {
  const p = rel.replace(/^pages\//, '').replace(/\.(ts|tsx|js)$/, '').replace(/\/index$/, '');
  return p.split('/').map((s) => (/^\[\.\.\..+\]$/.test(s) ? '*' : /^\[.+\]$/.test(s) ? ':' + s.slice(1, -1) : s));
}

function matchScore(litSegs, routeSegs, prefix) {
  if (!prefix && litSegs.length !== routeSegs.length && routeSegs[routeSegs.length - 1] !== '*') return -1;
  if (prefix && litSegs.length >= routeSegs.length) return -1;
  let statics = 0;
  for (let i = 0; i < litSegs.length; i++) {
    const r = routeSegs[i];
    const l = litSegs[i];
    if (r === undefined) return -1;
    if (r === '*') return statics;
    if (r.startsWith(':')) continue;
    if (l !== r) return -1;
    statics++;
  }
  if (prefix && !(routeSegs[litSegs.length] || '').startsWith(':')) return -1;
  return statics;
}

function buildInventory() {
  const { rows, helpers, stale } = scanRepo();
  const refs = extractApiLiterals();
  const segsByRoute = new Map(rows.map((r) => [r.route, routeSegments(r.route)]));
  const callers = new Map(rows.map((r) => [r.route, {}]));
  for (const ref of refs) {
    const raw = ref.lit.split('?')[0];
    const prefix = raw.endsWith('/') && raw.length > 5;
    const litSegs = raw.replace(/^\//, '').replace(/\/$/, '').split('/').filter(Boolean);
    let best = -1;
    let winners = [];
    for (const [route, segs] of segsByRoute) {
      const s = matchScore(litSegs, segs, false);
      if (s > best) { best = s; winners = [route]; } else if (s === best && s >= 0) winners.push(route);
    }
    let kind = 'exact';
    if (best < 0 && prefix) {
      for (const [route, segs] of segsByRoute) {
        const s = matchScore(litSegs, segs, true);
        if (s > best) { best = s; winners = [route]; } else if (s === best && s >= 0) winners.push(route);
      }
      kind = 'prefix';
    }
    if (best < 0) continue;
    for (const w of winners) {
      if (ref.rel === w) continue; // a route mentioning its own path
      const c = callers.get(w);
      const key = `${ref.bucket}${kind === 'prefix' ? '~prefix' : ''}`;
      (c[key] = c[key] || new Set()).add(ref.rel);
    }
  }
  const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const cronPaths = new Set((vercel.crons || []).map((c) => c.path.split('?')[0]));

  return {
    generatedFrom: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
    helpers,
    staleAllowlist: stale,
    routes: rows.map((r) => {
      const c = callers.get(r.route);
      const url = '/' + segsByRoute.get(r.route).join('/');
      const flat = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, [...v].sort()]));
      return { ...r, url, vercelCron: cronPaths.has(url), callers: flat };
    }),
  };
}

function main() {
  const outIdx = process.argv.indexOf('--out');
  const out = outIdx > -1 ? process.argv[outIdx + 1] : path.join(ROOT, 'artifacts', 'route-auth-inventory.json');
  const inv = buildInventory();
  if (process.argv.includes('--print')) {
    process.stdout.write(JSON.stringify(inv, null, 1));
    return;
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(inv, null, 1) + '\n');
  console.log(`inventory: ${inv.routes.length} routes → ${path.relative(ROOT, out)}`);
}

module.exports = { buildInventory, routeSegments, matchScore };
if (require.main === module) main();
