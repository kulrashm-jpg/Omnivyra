// Real executor bridge: runs harness/cpgAdapter.ts under the frozen resolver's tsx, one child process per company.
// Only this bridge reaches CPG; the harness decides whether it may be called.
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from './canonical.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const ADAPTER_PATH = join(ROOT, 'harness', 'cpgAdapter.ts');
export const ADAPTER_TIMEOUT_MS = 180_000;
// Pinned child environment: operating-system variables needed to start a process, nothing else from the operator's
// shell (no credentials, no rollout or cache overrides), plus CACHE_KILL_ALL so every cache namespace — including the
// Wikidata adapter's — is bypassed (§13.1: run cold). All other resolver behaviour is the code default at the frozen SHA.
export const OS_ENV_NAMES = Object.freeze(['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'windir', 'WINDIR', 'ComSpec', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']);
export const PINNED_ENV = Object.freeze({ CACHE_KILL_ALL: '1' });
export function adapterEnv(clone, parent = process.env) {
  const env = {};
  for (const k of OS_ENV_NAMES) if (parent[k] !== undefined) env[k] = parent[k];
  return { ...env, ...PINNED_ENV, CPG_U1_RESOLVER_CLONE: clone };
}

function tsxCli(clone) {
  const p = join(clone, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  if (!existsSync(p)) throw new Error(`the resolver clone has no installed dependencies (${p} missing) — install them at the frozen SHA`);
  return p;
}

export function runAdapter(clone, request) {
  return new Promise((resolve, reject) => {
    const child = execFile(process.execPath, [tsxCli(clone), ADAPTER_PATH], { cwd: clone, env: adapterEnv(clone), timeout: ADAPTER_TIMEOUT_MS, maxBuffer: 1 << 30 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`adapter failed: ${(stderr || err.message).slice(0, 500)}`));
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error('adapter output is not JSON')); }
    });
    child.stdin.end(JSON.stringify(request));
  });
}

/** Executor for the harness: identity recorded in every archive record. */
export function realExecutor({ clone, resolverSha }) {
  const undiciVersion = JSON.parse(readFileSync(join(clone, 'node_modules', 'undici', 'package.json'), 'utf8')).version;
  const identity = { kind: 'cpg-adapter', adapter: 'harness/cpgAdapter.ts', adapter_sha256: sha256(readFileSync(ADAPTER_PATH)), resolver_sha: resolverSha, node_version: process.version, undici_version: undiciVersion, bundled_undici_version: process.versions.undici ?? null,
    environment: { os_variables: OS_ENV_NAMES.filter((k) => process.env[k] !== undefined), pinned: PINNED_ENV } };
  return async ({ input }) => ({ ...(await runAdapter(clone, { mode: 'execute', input })), executor: identity });
}

export async function probeEnvironment(clone) {
  return runAdapter(clone, { mode: 'probe-environment' });
}

export async function replayRecord(clone, record) {
  return runAdapter(clone, { mode: 'replay', input: record.input, replay: record.replay });
}
