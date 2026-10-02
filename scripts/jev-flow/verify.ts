/**
 * `gov verify`: run ONLY registry commands (D-4) against a clean, committed
 * governed worktree and store a hash-addressed evidence bundle under GOV_HOME.
 *
 * Fail closed: every precondition (packet integrity, worktree, branch, clean
 * tree, ancestry, registry drift, known ids, scope) is checked before any
 * command runs. Commands are spawned without a shell; argv[0] must be `node`
 * and is executed as process.execPath. Expected refusals never throw.
 */
import { execFile, spawn, type SpawnOptions } from 'node:child_process';
import path from 'node:path';
import { buildBundle, storeBundle, storeLog } from './evidence';
import { registryDigest, resolveEntries } from './registry';
import { evaluateScope } from './scope';
import {
  COMMIT_RE,
  canonicalHash,
  packetHash as computePacketHash,
  type EvidenceItem,
  type GitProbe,
  type GovLayout,
  type GovStatus,
  type GovernedPacket,
  type ScopeResult,
  type Sha256Ref,
  type StoredEvidenceBundle,
  type VerificationRegistry,
} from './types';

export interface CommandResult {
  exitCode: number;
  output: Buffer;
  timedOut: boolean;
}

export type CommandRunner = (argv: string[], opts: { cwd: string; timeoutMs: number }) => Promise<CommandResult>;

/** Captured stdout+stderr cap per command. */
export const MAX_CAPTURE_BYTES = 16 * 1024 * 1024;

export interface SpawnSpec {
  command: string;
  args: string[];
  options: SpawnOptions;
}

/** The exact spawn call the default runner makes (exported so tests can assert "no shell"). */
export function spawnSpec(argv: string[], opts: { cwd: string }): SpawnSpec {
  if (!Array.isArray(argv) || argv[0] !== 'node') throw new Error('runner: argv[0] must be "node"');
  return {
    command: process.execPath,
    args: argv.slice(1),
    options: {
      cwd: opts.cwd,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      // POSIX: own process group so a timeout kills the whole tree.
      detached: process.platform !== 'win32',
    },
  };
}

function killTree(pid: number | undefined): void {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { shell: false, windowsHide: true }, () => undefined);
    } else {
      process.kill(-pid, 'SIGKILL');
    }
  } catch {
    // already gone
  }
}

/** Real runner: spawn process.execPath with argv.slice(1), shell:false, kill on timeout, capture stdout+stderr. */
export const defaultRunner: CommandRunner = (argv, opts) =>
  new Promise((resolve) => {
    const spec = spawnSpec(argv, opts);
    const chunks: Buffer[] = [];
    let captured = 0;
    let truncated = false;
    let timedOut = false;
    let settled = false;
    const collect = (b: Buffer) => {
      if (captured >= MAX_CAPTURE_BYTES) {
        truncated = true;
        return;
      }
      const room = MAX_CAPTURE_BYTES - captured;
      const part = b.length > room ? b.subarray(0, room) : b;
      if (part.length < b.length) truncated = true;
      chunks.push(part);
      captured += part.length;
    };
    const finish = (exitCode: number, extra?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (extra) chunks.push(Buffer.from(extra, 'utf8'));
      if (truncated) chunks.push(Buffer.from(`\n[gov: output truncated at ${MAX_CAPTURE_BYTES} bytes]\n`, 'utf8'));
      resolve({ exitCode, output: Buffer.concat(chunks), timedOut });
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(spec.command, spec.args, spec.options);
    } catch (e) {
      resolve({ exitCode: -1, output: Buffer.from(`[gov: spawn failed: ${(e as Error).message}]\n`, 'utf8'), timedOut: false });
      return;
    }
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, opts.timeoutMs);
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', (e) => finish(-1, `\n[gov: spawn error: ${e.message}]\n`));
    child.on('close', (code) => finish(typeof code === 'number' ? code : -1));
  });

export interface VerifyInput {
  packet: GovernedPacket;
  packetHash: Sha256Ref;
  worktree: string;
  registry: VerificationRegistry;
  git: GitProbe;
  layout: GovLayout;
  runner?: CommandRunner;
  now?: () => Date;
}

export interface VerifyResult {
  status: GovStatus;
  message: string;
  scope?: ScopeResult;
  stored?: StoredEvidenceBundle;
}

/** Comparable worktree path: resolved, forward slashes, no trailing slash; case-folded on Windows. */
export function normalizeWorktree(p: string): string {
  const s = path.resolve(p).replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? s.toLowerCase() : s;
}

function refuse(status: GovStatus, message: string, scope?: ScopeResult): VerifyResult {
  return scope ? { status, message, scope } : { status, message };
}

export async function runVerification(input: VerifyInput): Promise<VerifyResult> {
  const { packet, worktree, registry, git, layout } = input;
  const runner = input.runner || defaultRunner;
  const now = input.now || (() => new Date());
  try {
    // 1. packet integrity
    let actualHash: Sha256Ref;
    try {
      actualHash = computePacketHash(packet);
    } catch {
      return refuse('INTEGRITY_FAILED', 'packet cannot be canonicalized');
    }
    if (actualHash !== input.packetHash) return refuse('INTEGRITY_FAILED', 'packet hash mismatch');
    const base = packet.base;
    if (!base || typeof base.commit !== 'string' || !COMMIT_RE.test(base.commit)) return refuse('REFUSED', 'packet base commit is not a full commit id');

    // 2. worktree, branch, clean tree, ancestry
    if (normalizeWorktree(worktree) !== normalizeWorktree(base.worktree)) {
      return refuse('REFUSED', `worktree does not match the packet worktree (${base.worktree})`);
    }
    const branch = await git.currentBranch(worktree);
    if (branch !== base.branch) return refuse('REFUSED', `current branch ${branch ?? '(detached)'} is not the packet branch ${base.branch}`);
    if (!(await git.isClean(worktree))) return refuse('REFUSED', 'dirty/uncommitted tree: commit or remove all staged, unstaged and untracked changes');
    const head = await git.headCommit(worktree);
    if (!COMMIT_RE.test(head)) return refuse('REFUSED', 'HEAD is not a full commit id');
    if (!(await git.isAncestor(worktree, base.commit, head))) return refuse('REFUSED', 'HEAD does not descend from the packet base commit');

    // 3. registry drift + known ids
    const ids = packet.verification.registry_ids;
    if (!Array.isArray(ids) || ids.length === 0) return refuse('REFUSED', 'packet lists no registry ids');
    if (registryDigest(registry, ids) !== packet.verification.registry_digest) {
      return refuse('STALE', 'verification registry changed since the packet was generated; regenerate the packet');
    }
    const resolved = resolveEntries(registry, ids);
    if (resolved.ok === false) return refuse('REFUSED', `unknown registry id(s): ${resolved.unknown.join(', ')}`);

    // 4. scope — no command runs on a violation
    const scope = evaluateScope(await git.changedPaths(worktree, base.commit, head), packet.scope, base.commit, head);
    if (scope.ok === false) {
      const parts: string[] = [];
      if (scope.prohibited_touched.length) parts.push(`prohibited: ${scope.prohibited_touched.join(', ')}`);
      if (scope.outside_authorized.length) parts.push(`outside authorized: ${scope.outside_authorized.join(', ')}`);
      return refuse('SCOPE_VIOLATION', `scope violation (${parts.join('; ')})`, scope);
    }

    // 5. run registry commands, in packet order
    const storyKey = packet.story.key;
    const items: EvidenceItem[] = [];
    for (const [i, entry] of resolved.entries.entries()) {
      const argv = [...entry.argv];
      const started_at = now().toISOString();
      let r: CommandResult;
      try {
        r = await runner(argv, { cwd: worktree, timeoutMs: entry.timeout_ms });
      } catch (e) {
        r = { exitCode: -1, output: Buffer.from(`[gov: runner error: ${(e as Error).message}]\n`, 'utf8'), timedOut: false };
      }
      const finished_at = now().toISOString();
      const log = storeLog(layout, storyKey, Buffer.isBuffer(r.output) ? r.output : Buffer.from(String(r.output ?? ''), 'utf8'));
      const exit_code = Number.isInteger(r.exitCode) ? r.exitCode : -1;
      const timed_out = r.timedOut === true;
      items.push({
        id: `EV-${i + 1}`,
        registry_id: entry.id,
        evidence_kind: entry.evidence_kind,
        argv_digest: canonicalHash(argv),
        exit_code,
        result: exit_code === 0 && !timed_out ? 'PASS' : 'FAIL',
        timed_out,
        log_sha256: log.sha256,
        log_bytes: log.bytes,
        started_at,
        finished_at,
      });
    }

    // 6. the commands must not have changed the tree or HEAD
    if (!(await git.isClean(worktree))) return refuse('REFUSED', 'verification commands left the tree dirty; no evidence recorded', scope);
    if ((await git.headCommit(worktree)) !== head) return refuse('REFUSED', 'HEAD moved during verification; no evidence recorded', scope);

    // 7. bundle (FAIL evidence is evidence)
    const bundle = buildBundle({
      story_key: storyKey,
      packet_hash: input.packetHash,
      worktree: base.worktree,
      branch: base.branch,
      base_commit: base.commit,
      head_commit: head,
      registry_digest: packet.verification.registry_digest,
      scope,
      items,
      verified_at: now().toISOString(),
    });
    const stored = storeBundle(layout, bundle);
    const failed = items.filter((it) => it.result === 'FAIL').map((it) => `${it.id} ${it.registry_id}`);
    if (bundle.deterministic_result === 'PASS') {
      return { status: 'OK', message: `verification PASS (${items.length} command(s)); bundle ${stored.bundle_hash}`, scope, stored };
    }
    return { status: 'VERIFICATION_FAILED', message: `verification FAIL: ${failed.join(', ')}; bundle ${stored.bundle_hash}`, scope, stored };
  } catch (e) {
    return refuse('ERROR', `verification error: ${(e as Error).message}`);
  }
}
