// Shared runtime invocation seam — the single point through which any governance runtime obtains
// another runtime's output. It is the mechanism the WP-12 orchestrator uses to become the single
// execution authority.
//
//   • STANDALONE (no GOV_ORCH_CACHE): behaves exactly like a direct spawn — identical output, so every
//     runtime's standalone business logic and digests are unchanged.
//   • ORCHESTRATED (GOV_ORCH_CACHE set to a session dir): reads a pre-populated cache entry instead of
//     spawning. Because the orchestrator populates the cache in topological order, a downstream runtime
//     always finds its upstream already cached — so NO runtime spawns another.
//
// This file moves *invocation* only; it contains no governance/business logic.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';

// runtime script basename → work-package id (data-driven; new runtimes add one line)
export const SCRIPT_WP = {
  'validate-docs.mjs': 'WP-02', 'census-runtime.mjs': 'WP-03', 'health-runtime.mjs': 'WP-04',
  'freeze-runtime.mjs': 'WP-05', 'graph-runtime.mjs': 'WP-06', 'drift-runtime.mjs': 'WP-07',
  'evidence-runtime.mjs': 'WP-08', 'release-runtime.mjs': 'WP-09', 'enforce-runtime.mjs': 'WP-10',
  'cert-runtime.mjs': 'WP-11',
};

export function wpOf(script) { return SCRIPT_WP[path.basename(script)] || path.basename(script); }
export function cacheKey(script, args = []) {
  return `${wpOf(script)}__${args.join(' ').replace(/[^A-Za-z0-9]+/g, '_')}`.replace(/_+$/, '') || wpOf(script);
}

function runProcess(script, args) {
  if (process.env.GOV_ORCH_SPAWNLOG) { try { appendFileSync(process.env.GOV_ORCH_SPAWNLOG, cacheKey(script, args) + '\n'); } catch { /* ignore */ } }
  const r = spawnSync('node', [script, '--json', ...args], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  if (!r.stdout || !r.stdout.trim()) throw new Error(`no JSON from ${path.basename(script)}: ${r.stderr || 'empty'}`);
  return JSON.parse(r.stdout);
}

// The canonical upstream-consumption call. Signature matches the old per-runtime consume(script, args).
export function invoke(script, args = []) {
  const cacheDir = process.env.GOV_ORCH_CACHE;
  if (!cacheDir) return runProcess(script, args);          // standalone: identical to a direct spawn
  const file = path.join(cacheDir, cacheKey(script, args) + '.json');
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')); // orchestrated cache hit → no spawn
  const result = runProcess(script, args);                 // orchestrated miss → run once, populate cache
  if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
  writeFileSync(file, JSON.stringify(result));
  return result;
}
