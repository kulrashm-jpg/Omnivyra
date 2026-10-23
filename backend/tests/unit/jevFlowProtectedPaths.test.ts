/**
 * Protected-path enforcement after intake (harness certification gap B3 / N-07).
 *
 * A Story created by hand in Jira never passes through `gov intake`, so its own
 * Authorized Paths could reach supabase/migrations/**, .env*, vercel.json, … .
 * `gov verify` and `gov check-merge` now refuse any changed protected path that a
 * reviewed exact-path authorization (cited in the Story Invariants with its exact
 * digest, the line intake writes) does not list. Refusal only: nothing is granted.
 *
 * Hermetic: pure evaluator tests, then runVerification / runGov over throwaway git
 * repos under os.tmpdir() with GOV_HOME in a separate temp dir. No network, no Jira, no JEV.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bindSession } from '../../../scripts/jev-flow/binding';
import { GOV_EXIT, runGov, type GovDeps } from '../../../scripts/jev-flow/cli';
import { buildBundle, storeBundle } from '../../../scripts/jev-flow/evidence';
import { authorizationDigest, classifyIntake, validateIntakeRules, type IntakeInput, type IntakeRules } from '../../../scripts/jev-flow/intake';
import { storePacket } from '../../../scripts/jev-flow/packet';
import {
  AUTHORIZATION_INVARIANT_PREFIX,
  evaluateProtectedPaths,
  loadProtectedPathPolicy,
  parseCitedAuthorizations,
  protectedPathPolicy,
  type ProtectedPathPolicy,
} from '../../../scripts/jev-flow/protectedPaths';
import { loadRegistry, registryDigest, validateRegistry } from '../../../scripts/jev-flow/registry';
import { createGitProbe } from '../../../scripts/jev-flow/scope';
import { runVerification } from '../../../scripts/jev-flow/verify';
import {
  GOVERNANCE_VERSION,
  HUMAN_ONLY_RULES,
  PACKET_SCHEMA,
  govLayout,
  packetHash,
  type GovLayout,
  type GovernedPacket,
  type VerificationRegistry,
} from '../../../scripts/jev-flow/types';

jest.setTimeout(180000);

const STORY = 'OMNI-70';
const BRANCH = 'omni-70/b3';
const SID = '7b3d2c1a-0f9e-4d8c-a7b6-958473625140';
const FIXED = new Date('2026-10-08T12:00:00.000Z');
const MIG_A = 'supabase/migrations/20261201000000_b3_a.sql';
const MIG_B = 'supabase/migrations/20261202000000_b3_b.sql';
const MIG_OTHER = 'supabase/migrations/20261299000000_other.sql';

const REGISTRY: VerificationRegistry = validateRegistry({
  schema: 'gov-registry/1',
  entries: [
    { id: 't.pass', description: 'unit tests', argv: ['node', '-e', 'process.exit(0)'], evidence_kind: 'test_run', timeout_ms: 60000 },
    { id: 'rs.replay', description: 'migration replay', argv: ['node', '-e', 'process.exit(0)'], evidence_kind: 'test_run', timeout_ms: 60000 },
  ],
});

const DEFAULTS = ['supabase/migrations/**', '.claude/settings*.json', '.env*', 'vercel.json', 'railway.json', 'Dockerfile*', '.github/workflows/**'];
const AUTH = { id: 'b3-migrations', description: 'B3 Story migrations', paths: [MIG_A, MIG_B], required_verification: ['rs.replay'] };
const RULES: IntakeRules = validateIntakeRules(
  { schema: 'gov-intake-rules/1', default_prohibited_paths: DEFAULTS, verification_mappings: [{ paths: ['src/**'], registry_ids: ['t.pass'] }], protected_path_authorizations: [AUTH] },
  REGISTRY,
);
const POLICY: ProtectedPathPolicy = protectedPathPolicy(RULES);
const DIGEST = authorizationDigest(RULES.protected_path_authorizations[0]);
const CITE = `${AUTHORIZATION_INVARIANT_PREFIX}b3-migrations (${DIGEST}): only these exact protected files may change: ${MIG_A}, ${MIG_B}`;
const NO_AUTH_POLICY: ProtectedPathPolicy = { protected_patterns: DEFAULTS, authorizations: [] };

const evaluate = (changed: string[], invariants: string[] = [], registry_ids: string[] = ['t.pass', 'rs.replay'], policy = POLICY) =>
  evaluateProtectedPaths(changed, { invariants, registry_ids }, policy);

// ================================================================ pure evaluator

describe('evaluateProtectedPaths — refusal only, exact authorizations', () => {
  it('no protected path changed and nothing cited → ok', () => {
    expect(evaluate(['src/a.ts', 'scripts/x.ts'])).toEqual({ ok: true, protected_changed: [], unauthorized: [], problems: [] });
  });

  it.each([
    ['a migration', MIG_OTHER],
    ['an env file', '.env.local'],
    ['the root env file', '.env'],
    ['vercel.json', 'vercel.json'],
    ['railway.json', 'railway.json'],
    ['a Dockerfile', 'Dockerfile.worker'],
    ['a CI workflow', '.github/workflows/ci.yml'],
    ['Claude settings', '.claude/settings.local.json'],
  ])('N-07: %s changed with no cited authorization → unauthorized, not ok', (_label, p) => {
    const r = evaluate(['src/a.ts', p]);
    expect(r.ok).toBe(false);
    expect(r.protected_changed).toEqual([p]);
    expect(r.unauthorized).toEqual([p]);
  });

  it('a cited, digest-exact authorization lifts exactly its listed files', () => {
    expect(evaluate(['src/a.ts', MIG_A, MIG_B], [CITE])).toEqual({ ok: true, protected_changed: [MIG_A, MIG_B], unauthorized: [], problems: [] });
  });

  it('the authorization never reaches another protected file (exact paths, no pattern)', () => {
    const r = evaluate([MIG_A, MIG_OTHER, '.env.local'], [CITE]);
    expect(r.ok).toBe(false);
    expect(r.unauthorized).toEqual(['.env.local', MIG_OTHER]);
  });

  it('a hand-written citation of an id the reviewed rules do not define → UNKNOWN_AUTHORIZATION, nothing lifted', () => {
    const forged = `${AUTHORIZATION_INVARIANT_PREFIX}made-up (${DIGEST}): only these exact protected files may change: ${MIG_A}`;
    const r = evaluate([MIG_A], [forged]);
    expect(r.ok).toBe(false);
    expect(r.unauthorized).toEqual([MIG_A]);
    expect(r.problems).toEqual([expect.stringMatching(/^UNKNOWN_AUTHORIZATION made-up/)]);
  });

  it('a citation whose digest differs from the reviewed entry → AUTHORIZATION_DIGEST_MISMATCH, nothing lifted', () => {
    const stale = CITE.replace(DIGEST, `sha256:${'0'.repeat(64)}`);
    const r = evaluate([MIG_A], [stale]);
    expect(r.ok).toBe(false);
    expect(r.unauthorized).toEqual([MIG_A]);
    expect(r.problems).toEqual([expect.stringMatching(/^AUTHORIZATION_DIGEST_MISMATCH b3-migrations/)]);
  });

  it('a citation without the required verification in the packet → AUTHORIZATION_VERIFICATION_MISSING, nothing lifted', () => {
    const r = evaluate([MIG_A], [CITE], ['t.pass']);
    expect(r.ok).toBe(false);
    expect(r.unauthorized).toEqual([MIG_A]);
    expect(r.problems).toEqual(['AUTHORIZATION_VERIFICATION_MISSING b3-migrations: rs.replay']);
  });

  it('a citation must carry a full sha256 digest: a short or non-hex digest is malformed, not merely mismatched', () => {
    for (const digest of ['sha256:abc', `sha256:${'g'.repeat(64)}`, `sha256:${'a'.repeat(63)}`]) {
      const line = CITE.replace(DIGEST, digest);
      expect(parseCitedAuthorizations([line])).toEqual({ cited: [], malformed: [line] });
      const r = evaluate([MIG_A], [line]);
      expect(r.ok).toBe(false);
      expect(r.problems).toEqual([expect.stringMatching(/^malformed protected-path authorization invariant/)]);
    }
  });

  it('a malformed citation fails closed even when no protected path changed', () => {
    const r = evaluate(['src/a.ts'], [`${AUTHORIZATION_INVARIANT_PREFIX}b3-migrations covers everything`]);
    expect(r.ok).toBe(false);
    expect(r.unauthorized).toEqual([]);
    expect(r.problems).toEqual([expect.stringMatching(/^malformed protected-path authorization invariant/)]);
  });

  it('an unknown citation fails closed even when no protected path changed (a Story may not claim what was never reviewed)', () => {
    const r = evaluate(['src/a.ts'], [CITE], ['t.pass', 'rs.replay'], NO_AUTH_POLICY);
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual([expect.stringMatching(/^UNKNOWN_AUTHORIZATION b3-migrations/)]);
  });

  it('ordinary invariants are ignored; backslash paths are normalized', () => {
    expect(evaluate(['supabase\\migrations\\20261201000000_b3_a.sql'], ['No schema change', CITE]).ok).toBe(true);
    expect(parseCitedAuthorizations(['No route skips auth', CITE])).toEqual({ cited: [{ id: 'b3-migrations', digest: DIGEST }], malformed: [] });
  });

  it('a policy with no protected patterns would accept anything — the shipped policy is never empty', () => {
    expect(loadProtectedPathPolicy(loadRegistry()).protected_patterns.length).toBeGreaterThan(0);
  });
});

// ================================================================ policy loader

describe('loadProtectedPathPolicy — the reviewed rules of the tool checkout', () => {
  const dirs: string[] = [];
  afterAll(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
  const rulesFile = (value: unknown): string => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-b3-rules-'));
    dirs.push(d);
    const f = path.join(d, 'intake-rules.json');
    fs.writeFileSync(f, typeof value === 'string' ? value : JSON.stringify(value));
    return f;
  };

  it('the shipped rules load against the shipped registry: intake defaults are protected, no authorization is shipped', () => {
    const p = loadProtectedPathPolicy(loadRegistry());
    expect(p.protected_patterns).toEqual(expect.arrayContaining(['supabase/migrations/**', '.env*', 'vercel.json', '.github/workflows/**']));
    expect(p.authorizations).toEqual([]);
  });

  it('loads even when the registry lacks intake mapping ids (mappings play no part in enforcement)', () => {
    expect(loadProtectedPathPolicy(REGISTRY).protected_patterns.length).toBeGreaterThan(0);
  });

  it('fails closed on a missing file, invalid JSON, a non-object, a bad schema or an authorization with an unknown registry id', () => {
    expect(() => loadProtectedPathPolicy(REGISTRY, path.join(os.tmpdir(), 'gov-b3-no-such', 'intake-rules.json'))).toThrow();
    expect(() => loadProtectedPathPolicy(REGISTRY, rulesFile('{not json'))).toThrow();
    expect(() => loadProtectedPathPolicy(REGISTRY, rulesFile('[]'))).toThrow(/not an object/);
    expect(() => loadProtectedPathPolicy(REGISTRY, rulesFile({ schema: 'x', default_prohibited_paths: DEFAULTS }))).toThrow(/schema/);
    expect(() =>
      loadProtectedPathPolicy(
        REGISTRY,
        rulesFile({ schema: 'gov-intake-rules/1', default_prohibited_paths: DEFAULTS, protected_path_authorizations: [{ ...AUTH, required_verification: ['no.such'] }] }),
      ),
    ).toThrow(/unknown registry id/);
  });
});

// ================================================================ intake ↔ enforcement format

describe('intake and enforcement agree on the authorization line', () => {
  it('the invariant intake writes for an applied authorization is accepted by enforcement for exactly those files', () => {
    const input: IntakeInput = {
      state: { worktree: 'C:/w', branch: 'feature/b3', head: 'b'.repeat(40), clean: true, dirty_files: [], base_ref: 'main', merge_base: 'a'.repeat(40), changed_since_base: ['src/a.ts', MIG_A] },
      bindingsForWorktree: [],
      resumeCheck: null,
      sessionId: null,
      sessionBoundStory: null,
      liveSessions: [],
      explicitStoryKey: null,
      explicitStory: null,
      activeStories: [],
      options: { intent: 'B3 work', authorized: [], prohibited: [], verification: ['t.pass', 'rs.replay'], judgmentAcs: [], authorizations: ['b3-migrations'] },
      rules: RULES,
      registry: REGISTRY,
    };
    const d = classifyIntake(input);
    expect(d.kind).toBe('NEW_WORK');
    if (d.kind !== 'NEW_WORK') return;
    const story = d.proposal!.story;
    expect(story.invariants).toEqual([CITE]);
    expect(evaluate([MIG_A, MIG_B, 'src/a.ts'], story.invariants, story.verification_requirements)).toMatchObject({ ok: true, unauthorized: [], problems: [] });
    expect(evaluate([MIG_OTHER], story.invariants, story.verification_requirements).unauthorized).toEqual([MIG_OTHER]);
  });
});

// ================================================================ verify + check-merge over real git

const tmpDirs: string[] = [];
afterAll(() => tmpDirs.reverse().forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
function tmp(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}
function sh(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();
}
function write(dir: string, rel: string, text: string): void {
  const f = path.join(dir, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
}

interface Fx {
  repo: string;
  base: string;
  head: string;
  layout: GovLayout;
  home: string;
  packet: GovernedPacket;
  hash: ReturnType<typeof packetHash>;
}

/**
 * A governed Story whose Authorized Paths (written by hand, as in Jira) reach the
 * protected migrations directory — exactly gap B3 — and one governed commit touching `files`.
 */
function governed(files: string[], invariants: string[] = [], ids: string[] = ['t.pass', 'rs.replay']): Fx {
  const repo = tmp('gov-b3-repo-');
  sh(repo, 'init', '-q', '-b', 'main');
  sh(repo, 'config', 'user.email', 'gov-test@example.invalid');
  sh(repo, 'config', 'user.name', 'gov test');
  sh(repo, 'config', 'commit.gpgsign', 'false');
  write(repo, 'README.md', 'base\n');
  sh(repo, 'add', '-A');
  sh(repo, 'commit', '-q', '-m', 'base');
  const base = sh(repo, 'rev-parse', 'HEAD');
  sh(repo, 'checkout', '-q', '-b', BRANCH);
  const home = path.join(tmp('gov-b3-home-'), 'gov');
  const layout = govLayout({ GOV_HOME: home });
  const packet: GovernedPacket = {
    schema: PACKET_SCHEMA,
    governance_version: GOVERNANCE_VERSION,
    story: { key: STORY, summary: 's', status: 'In Progress', objective: 'o', architecture: null, invariants, updated: '2026-10-08T10:00:00.000+0000' },
    acceptance_criteria: [],
    scope: { authorized_paths: ['src/**', 'supabase/**', '.env*'], prohibited_paths: [] },
    verification: { registry_ids: ids, registry_digest: registryDigest(REGISTRY, ids) },
    base: { commit: base, branch: BRANCH, worktree: repo.replace(/\\/g, '/') },
    rules: [...HUMAN_ONLY_RULES],
  };
  const stored = storePacket(layout, packet);
  for (const f of files) write(repo, f, `change ${f}\n`);
  sh(repo, 'add', '-A');
  sh(repo, 'commit', '-q', '-m', 'work', '-m', `Governed-By: ${STORY}\nGov-Packet: ${stored.packet_hash}`);
  const head = sh(repo, 'rev-parse', 'HEAD');
  const bound = bindSession(
    layout,
    { story_key: STORY, packet_hash: stored.packet_hash, session_id: SID, mode: 'new', worktree: repo.replace(/\\/g, '/'), branch: BRANCH, base_commit: base, session_file: null, adoption: null },
    () => FIXED,
  );
  expect(bound.status).toBe('BOUND');
  return { repo, base, head, layout, home, packet, hash: stored.packet_hash };
}

const okRunner = () => jest.fn(async () => ({ exitCode: 0, output: Buffer.from('ok\n'), timedOut: false }));

describe('gov verify — B3 enforced after intake', () => {
  const verify = (fx: Fx, policy: ProtectedPathPolicy, runner = okRunner()) =>
    runVerification({ packet: fx.packet, packetHash: fx.hash, worktree: fx.repo, registry: REGISTRY, git: createGitProbe(), layout: fx.layout, runner, now: () => FIXED, protectedPolicy: policy }).then((r) => ({ r, runner }));

  it('a hand-made Story authorizing supabase/** cannot change a migration: SCOPE_VIOLATION, no command runs, no evidence stored', async () => {
    const fx = governed(['src/a.ts', MIG_A]);
    const { r, runner } = await verify(fx, POLICY);
    expect(r.status).toBe('SCOPE_VIOLATION');
    expect(r.message).toContain(MIG_A);
    expect(r.scope).toBeUndefined();
    expect(r.stored).toBeUndefined();
    expect(runner).not.toHaveBeenCalled();
    expect(fs.existsSync(fx.layout.evidenceDir(STORY))).toBe(false);
  });

  it('the same Story with a cited reviewed authorization verifies (the authorization is the only way through)', async () => {
    const fx = governed(['src/a.ts', MIG_A], [CITE]);
    const { r, runner } = await verify(fx, POLICY);
    expect(r.status).toBe('OK');
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it('a cited authorization whose required verification the Story dropped is refused', async () => {
    const fx = governed([MIG_A], [CITE], ['t.pass']);
    const { r, runner } = await verify(fx, POLICY);
    expect(r.status).toBe('SCOPE_VIOLATION');
    expect(r.message).toMatch(/AUTHORIZATION_VERIFICATION_MISSING/);
    expect(runner).not.toHaveBeenCalled();
  });

  it('without an injected policy verify loads the reviewed rules itself — enforcement cannot be skipped by omission', async () => {
    const fx = governed(['.env.local']);
    const runner = okRunner();
    const r = await runVerification({ packet: fx.packet, packetHash: fx.hash, worktree: fx.repo, registry: REGISTRY, git: createGitProbe(), layout: fx.layout, runner, now: () => FIXED });
    expect(r.status).toBe('SCOPE_VIOLATION');
    expect(r.message).toContain('.env.local');
    expect(runner).not.toHaveBeenCalled();
  });

  it('a policy that cannot be obtained refuses verify (REFUSED) before any command runs', async () => {
    const fx = governed(['src/a.ts']);
    const runner = okRunner();
    const input = { packet: fx.packet, packetHash: fx.hash, worktree: fx.repo, registry: REGISTRY, git: createGitProbe(), layout: fx.layout, runner, now: () => FIXED };
    Object.defineProperty(input, 'protectedPolicy', {
      enumerable: true,
      get() {
        throw new Error('rules unreadable');
      },
    });
    const r = await runVerification(input);
    expect(r.status).toBe('REFUSED');
    expect(r.message).toBe('protected-path policy unavailable: rules unreadable');
    expect(runner).not.toHaveBeenCalled();
    expect(fs.existsSync(fx.layout.evidenceDir(STORY))).toBe(false);
  });

  it('non-protected work is unaffected (no behaviour change for ordinary Stories)', async () => {
    const fx = governed(['src/a.ts']);
    const { r } = await verify(fx, POLICY);
    expect(r.status).toBe('OK');
  });
});

describe('gov verify / check-merge (CLI) — B3', () => {
  function deps(policy: ProtectedPathPolicy | (() => ProtectedPathPolicy)): Partial<GovDeps> {
    return {
      registry: REGISTRY,
      runner: okRunner(),
      now: () => FIXED,
      protectedPolicy: typeof policy === 'function' ? policy : () => policy,
    };
  }
  async function gov(fx: Fx, argv: string[], d: Partial<GovDeps>) {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runGov(argv, { GOV_HOME: fx.home }, { out: (t) => out.push(t), err: (t) => err.push(t) }, d);
    const line = out.filter((l) => l.startsWith('GOV_RESULT ')).pop();
    return { code, out, err, result: line ? (JSON.parse(line.slice('GOV_RESULT '.length)) as Record<string, unknown>) : null };
  }
  /** A bundle as an older gov (before B3) would have stored it: scope ok, deterministic PASS. */
  function preEnforcementBundle(fx: Fx): string {
    const bundle = buildBundle({
      story_key: STORY,
      packet_hash: fx.hash,
      worktree: fx.packet.base.worktree,
      branch: BRANCH,
      base_commit: fx.base,
      head_commit: fx.head,
      registry_digest: fx.packet.verification.registry_digest,
      scope: { ok: true, base_commit: fx.base, head_commit: fx.head, changed_paths: [MIG_A], outside_authorized: [], prohibited_touched: [] },
      items: [
        {
          id: 'EV-1', registry_id: 't.pass', evidence_kind: 'test_run', argv_digest: `sha256:${'1'.repeat(64)}`, exit_code: 0, result: 'PASS', timed_out: false,
          log_sha256: `sha256:${'2'.repeat(64)}`, log_bytes: 3, started_at: FIXED.toISOString(), finished_at: FIXED.toISOString(),
        },
      ],
      verified_at: FIXED.toISOString(),
    });
    return storeBundle(fx.layout, bundle).bundle_hash;
  }

  it('cmdVerify passes the injected policy: protected migration → exit 15, no command, no bundle', async () => {
    const fx = governed([MIG_A]);
    const d = deps(POLICY);
    const r = await gov(fx, ['verify', '--story', STORY, '--worktree', fx.repo], d);
    expect(r.code).toBe(GOV_EXIT.SCOPE_VIOLATION);
    expect(r.out.join('\n')).toMatch(/Verification: SCOPE_VIOLATION — protected-path violation \(protected path\(s\) without an exact reviewed authorization: supabase\/migrations\/20261201000000_b3_a\.sql\)/);
    expect(r.out.join('\n')).not.toMatch(/Scope: ok/);
    expect(d.runner).not.toHaveBeenCalled();
    expect(r.result?.bundle_hash).toBeUndefined();
  });

  it('cmdVerify enforces the policy gov resolved (not a second copy): a citation the injected policy reviews verifies', async () => {
    // The shipped rules carry no authorization, so this passes only if cmdVerify hands its policy to verify.
    const fx = governed([MIG_A], [CITE]);
    const d = deps(POLICY);
    const r = await gov(fx, ['verify', '--story', STORY, '--worktree', fx.repo], d);
    expect(r.code).toBe(GOV_EXIT.OK);
    expect(d.runner).toHaveBeenCalledTimes(2);
  });

  it('an unavailable policy refuses verify before anything runs (fail closed)', async () => {
    const fx = governed(['src/a.ts']);
    const d = deps(() => {
      throw new Error('rules unreadable');
    });
    const r = await gov(fx, ['verify', '--story', STORY, '--worktree', fx.repo], d);
    expect(r.code).toBe(GOV_EXIT.REFUSED);
    expect(r.err.join('\n')).toMatch(/protected-path policy unavailable: rules unreadable/);
    expect(d.runner).not.toHaveBeenCalled();
  });

  it('check-merge recomputes protected paths from git: a PASS bundle from before enforcement does not get through (exit 15)', async () => {
    const fx = governed([MIG_A]);
    const bundle = preEnforcementBundle(fx);
    const r = await gov(fx, ['check-merge', '--story', STORY, '--worktree', fx.repo, '--evidence', bundle], deps(POLICY));
    expect(r.code).toBe(GOV_EXIT.SCOPE_VIOLATION);
    expect(r.out.join('\n')).toMatch(/\[FAIL\] protected-paths: .*supabase\/migrations\/20261201000000_b3_a\.sql/);
    expect((r.result?.checks as Array<{ name: string; ok: boolean }>).find((c) => c.name === 'protected-paths')).toEqual({ name: 'protected-paths', ok: false });
  });

  it('check-merge passes protected-paths when the Story cites the reviewed authorization', async () => {
    const fx = governed([MIG_A], [CITE]);
    const bundle = preEnforcementBundle(fx);
    const r = await gov(fx, ['check-merge', '--story', STORY, '--worktree', fx.repo, '--evidence', bundle], deps(POLICY));
    expect(r.out.join('\n')).toMatch(/\[PASS\] protected-paths: 1 protected path\(s\) changed, each under an exact reviewed authorization/);
    expect(r.code).toBe(GOV_EXIT.OK);
  });

  it('check-merge fails closed (INTEGRITY_FAILED) when the policy cannot be loaded', async () => {
    const fx = governed(['src/a.ts']);
    const bundle = preEnforcementBundle(fx);
    const r = await gov(
      fx,
      ['check-merge', '--story', STORY, '--worktree', fx.repo, '--evidence', bundle],
      deps(() => {
        throw new Error('rules unreadable');
      }),
    );
    expect(r.code).toBe(GOV_EXIT.INTEGRITY_FAILED);
    expect(r.out.join('\n')).toMatch(/\[FAIL\] protected-paths: protected-path check unavailable: rules unreadable/);
  });

  it('enforcement only refuses: it never writes the worktree, git history, the ledger or Jira', async () => {
    const fx = governed([MIG_A]);
    const bundle = preEnforcementBundle(fx);
    const headBefore = sh(fx.repo, 'rev-parse', 'HEAD');
    const ledgerBefore = fs.readFileSync(fx.layout.bindingsFile, 'utf8');
    await gov(fx, ['verify', '--story', STORY, '--worktree', fx.repo], deps(POLICY));
    await gov(fx, ['check-merge', '--story', STORY, '--worktree', fx.repo, '--evidence', bundle], deps(POLICY));
    expect(sh(fx.repo, 'rev-parse', 'HEAD')).toBe(headBefore);
    expect(sh(fx.repo, 'status', '--porcelain')).toBe('');
    expect(fs.readFileSync(fx.layout.bindingsFile, 'utf8')).toBe(ledgerBefore);
  });
});
