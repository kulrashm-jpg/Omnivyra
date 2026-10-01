/**
 * gov CLI — existing-work adoption (PRE_GOVERNANCE_ADOPTION_BASELINE).
 *
 * `gov attach` without --base and without an earlier binding adopts a clean
 * HEAD that carries exactly `Governed-By: <STORY>` and no `Gov-Packet`
 * trailer; `gov check-merge` then inspects only the commits after that
 * baseline. Hermetic: Jira and JEV are injected fakes; git work runs in
 * throwaway repos under os.tmpdir(); GOV_HOME and CLAUDE_PROJECTS_DIR are temp
 * dirs. No network, never launches `claude`, never creates a commit itself.
 *
 * Track A dependency: until binding.ts persists `SessionBinding.adoption`,
 * `withAdoptionPersisted` writes the field into the temp ledger exactly as
 * Track A will (and asserts it when Track A already persisted it), so the
 * check-merge semantics are exercised either way. Tests whose title starts
 * with "[Track A]" assert the persisted ledger field itself and only pass
 * after the Track A binding.ts integration.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemoryAuditSink } from '../../../scripts/jev-bjc/audit';
import type { JevTransport } from '../../../scripts/jev-bjc/provider';
import { AC_FIELDS, STORY_FIELDS } from '../../../scripts/jev-jira/fields';
import type { JiraClient, JiraCredentials, JiraIssue, JiraPermissionProbe } from '../../../scripts/jev-jira/jiraClient';
import { STORY_AUTHORIZED_PATHS_FIELD, type JiraQuery } from '../../../scripts/jev-flow/jiraQuery';
import { validateRegistry } from '../../../scripts/jev-flow/registry';
import { GOV_EXIT, runGov, type GovDeps } from '../../../scripts/jev-flow/cli';
import { buildPacket } from '../../../scripts/jev-flow/packet';
import { checkReadiness } from '../../../scripts/jev-flow/readiness';
import { ADOPTION_CLASSIFICATION, govLayout, packetHash, type VerificationRegistry } from '../../../scripts/jev-flow/types';

jest.setTimeout(180000);

const STORY = 'OMNI-6';
const OTHER_STORY = 'OMNI-9';
const SID = '0f1e2d3c-4b5a-4968-8776-655443322110';
const FIXED = new Date('2026-10-01T12:00:00.000Z');
// Built at runtime; never credential-shaped.
const READER_TOKEN = ['reader', 'test', 'value'].join('-');

const REGISTRY: VerificationRegistry = validateRegistry({
  schema: 'gov-registry/1',
  entries: [
    { id: 't.pass', description: 'unit tests', argv: ['node', '-e', 'process.exit(0)'], evidence_kind: 'test_run', timeout_ms: 60000 },
    { id: 't.types', description: 'typecheck', argv: ['node', '-e', 'process.exit(0)'], evidence_kind: 'typecheck', timeout_ms: 60000 },
  ],
});

// ---------------------------------------------------------------- temp dirs + git

const tmpDirs: string[] = [];
function tmp(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tmpDirs.reverse()) fs.rmSync(d, { recursive: true, force: true });
});

function sh(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();
}

function write(dir: string, rel: string, text: string): void {
  const f = path.join(dir, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
}

function commit(dir: string, files: Record<string, string>, ...trailers: string[]): string {
  for (const [rel, text] of Object.entries(files)) write(dir, rel, text);
  sh(dir, 'add', '-A');
  const args = ['commit', '-q', '-m', 'work'];
  if (trailers.length > 0) args.push('-m', trailers.join('\n'));
  sh(dir, ...args);
  return sh(dir, 'rev-parse', 'HEAD');
}

/**
 * Temp repo: a pre-governance commit on main, then branch feature/adopt with
 * the human's existing work committed with `baselineTrailers` (HEAD).
 */
function adoptRepo(baselineTrailers: string[] = [`Governed-By: ${STORY}`]): { repo: string; preGov: string; baseline: string } {
  const repo = tmp('gov-adopt-repo-');
  sh(repo, 'init', '-q', '-b', 'main');
  sh(repo, 'config', 'user.email', 'gov-test@example.invalid');
  sh(repo, 'config', 'user.name', 'gov test');
  sh(repo, 'config', 'commit.gpgsign', 'false');
  const preGov = commit(repo, { 'README.md': 'base\n' });
  sh(repo, 'checkout', '-q', '-b', 'feature/adopt');
  // Pre-governance work outside the authorized scope: never inspected.
  commit(repo, { 'docs/old.md': 'old\n' });
  const baseline = commit(repo, { 'src/existing.ts': 'export const existing = 1;\n' }, ...baselineTrailers);
  return { repo, preGov, baseline };
}

const commitCount = (repo: string) => sh(repo, 'rev-list', '--all', '--count');

// ---------------------------------------------------------------- fake Jira / JEV

const sel = (value: string, id: string) => ({ value, id });

function storyIssue(): JiraIssue {
  return {
    key: STORY,
    fields: {
      summary: 'Adopted health work',
      issuetype: { id: '10005' },
      project: { id: '10033' },
      status: { id: '10036', name: 'In Progress' },
      updated: '2026-10-01T09:00:00.000+0000',
      [STORY_FIELDS.objective]: 'Harden the health route',
      [STORY_FIELDS.architecture]: 'Route handler only',
      [STORY_FIELDS.invariants]: 'No route skips auth',
      [STORY_AUTHORIZED_PATHS_FIELD]: 'src/**',
      [STORY_FIELDS.prohibitedPaths]: 'src/secret/**',
      [STORY_FIELDS.verificationRequirements]: 't.pass\nt.types',
    },
  };
}

function acIssue(key: string, deterministic: boolean): JiraIssue {
  return {
    key,
    fields: {
      summary: `AC ${key}`,
      issuetype: { id: '10074' },
      project: { id: '10033' },
      status: { id: '10037', name: 'Open' },
      parent: { key: STORY },
      updated: '2026-10-01T10:00:00.000+0000',
      [AC_FIELDS.acId]: deterministic ? 'AC-1' : 'AC-2',
      [AC_FIELDS.statement]: deterministic ? 'The health route unit tests pass' : 'The change is easy to review',
      [AC_FIELDS.kind]: deterministic ? sel('Deterministic', '10024') : sel('Judgment', '10025'),
      [AC_FIELDS.evidenceKind]: deterministic ? sel('Test', '10026') : sel('Manual', '10029'),
      [AC_FIELDS.deterministicResult]: null,
      [AC_FIELDS.evidenceReferences]: null,
      [AC_FIELDS.verification]: sel('UNVERIFIED', '10038'),
      [AC_FIELDS.jevVerdict]: null,
      [AC_FIELDS.jevConfidence]: null,
      [AC_FIELDS.jevModel]: null,
      [AC_FIELDS.jevInputHash]: null,
      [AC_FIELDS.jevAdvisoryDisposition]: null,
    },
  };
}

const READER_PERMS = { BROWSE_PROJECTS: true, EDIT_ISSUES: false, TRANSITION_ISSUES: false, CREATE_ISSUES: false, DELETE_ISSUES: false, ADMINISTER_PROJECTS: false, ADMINISTER: false };

class World {
  story = storyIssue();
  acs = [acIssue('OMNI-7', true), acIssue('OMNI-8', false)];
  readonly tokensUsed: string[] = [];
  /** Every Jira client call other than the permission preflight (reads and writes alike). */
  readonly clientCalls: string[] = [];

  query(): JiraQuery {
    return {
      getStory: async (key) => (key === this.story.key ? JSON.parse(JSON.stringify(this.story)) : null),
      listAcceptanceCriteria: async () => JSON.parse(JSON.stringify(this.acs)),
    };
  }

  client(c: JiraCredentials): JiraClient & JiraPermissionProbe {
    this.tokensUsed.push(c.token);
    const world = this;
    const base = {
      async getMyPermissions() {
        return c.token === READER_TOKEN ? { ...READER_PERMS } : {};
      },
    };
    return new Proxy(base, {
      get(target, prop) {
        if (typeof prop === 'string' && prop !== 'getMyPermissions' && prop !== 'then') {
          world.clientCalls.push(prop);
          return async () => {
            throw new Error(`unexpected Jira call: ${prop}`);
          };
        }
        return (target as unknown as Record<string | symbol, unknown>)[prop];
      },
    }) as unknown as JiraClient & JiraPermissionProbe;
  }
}

// ---------------------------------------------------------------- harness

interface Ctx {
  world: World;
  env: Record<string, string>;
  home: string;
  projects: string;
  transport: JevTransport & { calls: number };
  transportFactory: jest.Mock;
  audit: MemoryAuditSink;
  deps: Partial<GovDeps>;
}

function makeCtx(): Ctx {
  const world = new World();
  const home = path.join(tmp('gov-adopt-home-'), 'gov');
  const projects = tmp('gov-adopt-projects-');
  const transport = {
    calls: 0,
    async send() {
      transport.calls += 1;
      throw new Error('JEV must not be called');
    },
  } as JevTransport & { calls: number };
  const transportFactory = jest.fn(() => transport);
  const audit = new MemoryAuditSink();
  const deps: Partial<GovDeps> = {
    jiraQuery: jest.fn(() => world.query()),
    jiraClient: jest.fn((c: JiraCredentials) => world.client(c)),
    transport: transportFactory,
    bjcAudit: () => audit,
    registry: REGISTRY,
    runner: jest.fn(async () => ({ exitCode: 0, output: Buffer.from('ok\n'), timedOut: false })),
    now: () => FIXED,
    newSessionId: () => SID,
    createWorktree: jest.fn(async () => {
      throw new Error('attach/check-merge must never create a worktree');
    }),
  };
  return {
    world,
    home,
    projects,
    transport,
    transportFactory,
    audit,
    deps,
    env: { GOV_HOME: home, CLAUDE_PROJECTS_DIR: projects, JEV_JIRA_IDENTITY: 'reader', JEV_READER_TOKEN: READER_TOKEN },
  };
}

interface RunOut {
  code: number;
  out: string[];
  err: string[];
  result: Record<string, unknown>;
}

async function gov(ctx: Ctx, argv: string[]): Promise<RunOut> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runGov(argv, ctx.env, { out: (t) => out.push(t), err: (t) => err.push(t) }, ctx.deps);
  const line = out.filter((l) => l.startsWith('GOV_RESULT ')).pop();
  return { code, out, err, result: line ? JSON.parse(line.slice('GOV_RESULT '.length)) : null };
}

function writeTranscript(ctx: Ctx): string {
  const d = path.join(ctx.projects, 'C--some-project');
  fs.mkdirSync(d, { recursive: true });
  const f = path.join(d, `${SID}.jsonl`);
  const lines = [JSON.stringify({ type: 'queue-operation' }), JSON.stringify({ type: 'user', sessionId: SID, cwd: 'C:\\work\\repo', gitBranch: 'feature/adopt' })];
  fs.writeFileSync(f, `${lines.join('\n')}\n`);
  return f;
}

function ledger(ctx: Ctx): Array<Record<string, unknown>> {
  const f = govLayout(ctx.env).bindingsFile;
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : [];
}

/**
 * Track A bridge: if binding.ts persisted `adoption`, assert it; otherwise
 * write it into the temp ledger exactly as Track A will. Returns true when
 * Track A had already persisted it.
 */
function withAdoptionPersisted(ctx: Ctx, baseline: string): boolean {
  const f = govLayout(ctx.env).bindingsFile;
  const recs = ledger(ctx);
  const expected = { baseline_commit: baseline, classification: ADOPTION_CLASSIFICATION };
  let persisted = true;
  for (const r of recs) {
    if (r.story_key !== STORY) continue;
    if (r.adoption === undefined || r.adoption === null) {
      persisted = false;
      r.adoption = expected;
    } else {
      expect(r.adoption).toEqual(expected);
    }
  }
  if (!persisted) fs.writeFileSync(f, recs.map((r) => `${JSON.stringify(r)}\n`).join(''));
  return persisted;
}

function rewriteAdoption(ctx: Ctx, adoption: unknown): void {
  const f = govLayout(ctx.env).bindingsFile;
  const recs = ledger(ctx).map((r) => ({ ...r, adoption }));
  fs.writeFileSync(f, recs.map((r) => `${JSON.stringify(r)}\n`).join(''));
}

async function attachAdopt(ctx: Ctx, repo: string): Promise<RunOut> {
  return gov(ctx, ['attach', '--story', STORY, '--session', SID, '--worktree', repo]);
}

/** Adoption attach (+ Track A bridge), optional later commits, then verify. */
async function adoptedFlow(ctx: Ctx, later: (packet: string) => string[][] = () => []) {
  const a = adoptRepo();
  writeTranscript(ctx);
  const att = await attachAdopt(ctx, a.repo);
  expect(att.code).toBe(0);
  withAdoptionPersisted(ctx, a.baseline);
  const packet = att.result.packet_hash as string;
  let i = 0;
  for (const trailers of later(packet)) commit(a.repo, { [`src/later${i++}.ts`]: `export const v = ${i};\n` }, ...trailers);
  const v = await gov(ctx, ['verify', '--story', STORY, '--worktree', a.repo]);
  expect(v.code).toBe(0);
  return { ...a, attach: att, packet, verify: v, bundle: v.result.bundle_hash as string };
}

const good = (packet: string, story = STORY) => [`Governed-By: ${story}`, `Gov-Packet: ${packet}`];
const checkMerge = (ctx: Ctx, repo: string, bundle: string) => gov(ctx, ['check-merge', '--story', STORY, '--worktree', repo, '--evidence', bundle]);

// ---------------------------------------------------------------- attach

describe('gov attach — existing-work adoption', () => {
  it('(1) dirty tree → REFUSED 11 even for a valid baseline HEAD; nothing written', async () => {
    const ctx = makeCtx();
    const a = adoptRepo();
    writeTranscript(ctx);
    write(a.repo, 'src/uncommitted.ts', 'x\n');
    const r = await attachAdopt(ctx, a.repo);
    expect(r.code).toBe(GOV_EXIT.REFUSED);
    expect(r.err.join('\n')).toMatch(/dirty/);
    const layout = govLayout(ctx.env);
    expect(fs.existsSync(layout.bindingsFile)).toBe(false);
    expect(fs.existsSync(layout.packetsDir(STORY))).toBe(false);
    expect(r.result.adoption_baseline).toBeUndefined();
  });

  it('(2) clean HEAD with Governed-By and no Gov-Packet, no --base, no prior binding → OK, baseline = HEAD printed and in GOV_RESULT', async () => {
    const ctx = makeCtx();
    const a = adoptRepo();
    writeTranscript(ctx);
    const r = await attachAdopt(ctx, a.repo);
    expect(r.code).toBe(0);
    expect(r.result).toMatchObject({ status: 'OK', base_commit: a.baseline, adoption_baseline: a.baseline, branch: 'feature/adopt', binding: 'BOUND' });
    const text = r.out.join('\n');
    expect(text).toContain(`Adoption baseline: ${a.baseline} (PRE_GOVERNANCE_ADOPTION_BASELINE)`);
    expect(text).toContain(`Base commit: ${a.baseline}`);
    expect(text).toContain(`Governed-By: ${STORY}`);
    expect(text).toContain(`Gov-Packet: ${r.result.packet_hash}`);
    const l = ledger(ctx);
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ mode: 'attach', base_commit: a.baseline, story_key: STORY });
  });

  it('--worktree defaults to the current directory', async () => {
    const ctx = makeCtx();
    const a = adoptRepo();
    writeTranscript(ctx);
    const cwd = process.cwd();
    let r: RunOut;
    try {
      process.chdir(a.repo);
      r = await gov(ctx, ['attach', '--story', STORY, '--session', SID]);
    } finally {
      process.chdir(cwd);
    }
    expect(r.code).toBe(0);
    expect(r.result.adoption_baseline).toBe(a.baseline);
    expect(path.resolve(r.result.worktree as string).toLowerCase()).toBe(path.resolve(a.repo).toLowerCase());
    expect((await gov(ctx, ['attach', '--story', STORY, '--session', SID, '--worktree'])).code).toBe(64);
  });

  it('(3) HEAD without Governed-By / for another Story / with a Gov-Packet → REFUSED 11 with adoption guidance; nothing written', async () => {
    const cases: string[][] = [[], [`Governed-By: ${OTHER_STORY}`], [`Governed-By: ${STORY}`, `Gov-Packet: sha256:${'a'.repeat(64)}`], [`Governed-By: ${STORY}`, `Governed-By: ${OTHER_STORY}`]];
    for (const trailers of cases) {
      const ctx = makeCtx();
      const a = adoptRepo(trailers);
      writeTranscript(ctx);
      const r = await attachAdopt(ctx, a.repo);
      expect(r.code).toBe(11);
      const msg = r.err.join('\n');
      expect(msg).toContain(`Governed-By: ${STORY}`);
      expect(msg).toMatch(/NO "Gov-Packet" trailer/);
      expect(msg).toContain('--base');
      expect(msg).toContain('PRE_GOVERNANCE_ADOPTION_BASELINE');
      expect(r.result.adoption_baseline).toBeUndefined();
      const layout = govLayout(ctx.env);
      expect(fs.existsSync(layout.bindingsFile)).toBe(false);
      expect(fs.existsSync(layout.packetsDir(STORY))).toBe(false);
    }
  });

  it('(9) adoption packet hash equals buildPacket(readiness, {commit: HEAD, branch, worktree}) computed independently', async () => {
    const ctx = makeCtx();
    const a = adoptRepo();
    writeTranscript(ctx);
    const r = await attachAdopt(ctx, a.repo);
    expect(r.code).toBe(0);
    const readiness = await checkReadiness(STORY, { query: ctx.world.query(), registry: REGISTRY });
    const independent = packetHash(buildPacket(readiness, { commit: a.baseline, branch: 'feature/adopt', worktree: path.resolve(a.repo).replace(/\\/g, '/') }));
    expect(r.result.packet_hash).toBe(independent);
    const stored = JSON.parse(fs.readFileSync(govLayout(ctx.env).packetFile(STORY, independent as `sha256:${string}`, 'json'), 'utf8'));
    expect(JSON.stringify(stored)).not.toContain('adoption');
    expect(JSON.stringify(stored)).not.toContain(ADOPTION_CLASSIFICATION);
  });

  it('(10) transcript bytes and mtime unchanged across an adoption attach', async () => {
    const ctx = makeCtx();
    const a = adoptRepo();
    const file = writeTranscript(ctx);
    const before = fs.readFileSync(file);
    const mtime = fs.statSync(file).mtimeMs;
    const r = await attachAdopt(ctx, a.repo);
    expect(r.code).toBe(0);
    expect(fs.readFileSync(file).equals(before)).toBe(true);
    expect(fs.statSync(file).mtimeMs).toBe(mtime);
  });

  it('(13) --base path is ordinary attach: no adoption baseline even when HEAD would qualify', async () => {
    const ctx = makeCtx();
    const a = adoptRepo();
    writeTranscript(ctx);
    const r = await gov(ctx, ['attach', '--story', STORY, '--session', SID, '--worktree', a.repo, '--base', 'main']);
    expect(r.code).toBe(0);
    expect(r.result.base_commit).toBe(a.preGov);
    expect(r.result.adoption_baseline).toBeUndefined();
    expect(r.out.join('\n')).not.toContain('Adoption baseline');
    const l = ledger(ctx);
    expect(l[0].adoption ?? null).toBeNull();
  });

  it('(14) re-attach without --base reuses the prior base and adoption (ALREADY_BOUND, same packet)', async () => {
    const ctx = makeCtx();
    const a = adoptRepo();
    writeTranscript(ctx);
    const first = await attachAdopt(ctx, a.repo);
    expect(first.code).toBe(0);
    withAdoptionPersisted(ctx, a.baseline);
    commit(a.repo, { 'src/next.ts': 'n\n' }, ...good(first.result.packet_hash as string));
    const second = await attachAdopt(ctx, a.repo);
    expect(second.code).toBe(0);
    expect(second.result).toMatchObject({ binding: 'ALREADY_BOUND', base_commit: a.baseline, adoption_baseline: a.baseline, packet_hash: first.result.packet_hash });
    expect(ledger(ctx)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- check-merge

describe('gov check-merge — adopted Story', () => {
  it('(4) HEAD == baseline with PASS evidence at HEAD → 0 (zero governed commits allowed)', async () => {
    const ctx = makeCtx();
    const f = await adoptedFlow(ctx);
    const r = await checkMerge(ctx, f.repo, f.bundle);
    expect(r.code).toBe(0);
    expect(r.out.filter((l) => l.includes('[FAIL]'))).toEqual([]);
    expect(r.out.filter((l) => l.includes('[PASS]'))).toHaveLength(10);
    const text = r.out.join('\n');
    expect(text).toContain(`[PASS] adoption-baseline: baseline ${f.baseline.slice(0, 12)} PRE_GOVERNANCE_ADOPTION_BASELINE`);
    expect(text).toContain(`baseline ${f.baseline.slice(0, 12)} PRE_GOVERNANCE_ADOPTION_BASELINE; 0 governed commit(s)`);
    expect(r.result).toMatchObject({ status: 'OK', adoption_baseline: f.baseline, governed_commits: 0 });
  });

  it('(5) baseline + later commits with correct trailers → 0; pre-baseline commits are not inspected', async () => {
    const ctx = makeCtx();
    const f = await adoptedFlow(ctx, (p) => [good(p), good(p)]);
    const r = await checkMerge(ctx, f.repo, f.bundle);
    expect(r.code).toBe(0);
    expect(r.out.join('\n')).toContain('2 governed commit(s)');
    expect(r.result.governed_commits).toBe(2);
  });

  it('(6) later commit missing Gov-Packet → 13', async () => {
    const ctx = makeCtx();
    const f = await adoptedFlow(ctx, (p) => [good(p), [`Governed-By: ${STORY}`]]);
    const r = await checkMerge(ctx, f.repo, f.bundle);
    expect(r.code).toBe(GOV_EXIT.INTEGRITY_FAILED);
    expect(r.out.join('\n')).toMatch(/\[FAIL\] trailers: .*missing Gov-Packet/);
  });

  it('(7) wrong Gov-Packet → 13 (also when a wrong value sits beside the right one)', async () => {
    const ctx = makeCtx();
    const wrong = `sha256:${'9'.repeat(64)}`;
    const f = await adoptedFlow(ctx, () => [good(wrong)]);
    expect((await checkMerge(ctx, f.repo, f.bundle)).code).toBe(13);

    const ctx2 = makeCtx();
    const f2 = await adoptedFlow(ctx2, (p) => [[...good(p), `Gov-Packet: ${wrong}`]]);
    expect((await checkMerge(ctx2, f2.repo, f2.bundle)).code).toBe(13);
  });

  it('(8) wrong Governed-By → 13', async () => {
    const ctx = makeCtx();
    const f = await adoptedFlow(ctx, (p) => [good(p, OTHER_STORY)]);
    const r = await checkMerge(ctx, f.repo, f.bundle);
    expect(r.code).toBe(13);
    expect(r.out.join('\n')).toMatch(/missing Governed-By: OMNI-6/);
  });

  it('tampered adoption record (baseline != base, bad classification, non-commit) → 13 fail-closed', async () => {
    for (const adoption of [
      { baseline_commit: '0'.repeat(40), classification: ADOPTION_CLASSIFICATION },
      { baseline_commit: 'BASELINE', classification: 'SOMETHING_ELSE' },
      { baseline_commit: 'not-a-commit', classification: ADOPTION_CLASSIFICATION },
    ]) {
      const ctx = makeCtx();
      const f = await adoptedFlow(ctx);
      rewriteAdoption(ctx, adoption.baseline_commit === 'BASELINE' ? { ...adoption, baseline_commit: f.baseline } : adoption);
      const r = await checkMerge(ctx, f.repo, f.bundle);
      expect(r.code).toBe(13);
      expect(r.out.join('\n')).toMatch(/\[FAIL\] adoption-baseline/);
    }
  });

  it('(11) no commit is ever created: rev-list --all count and HEAD identical across attach, verify, check-merge', async () => {
    const ctx = makeCtx();
    const a = adoptRepo();
    writeTranscript(ctx);
    const count = commitCount(a.repo);
    const head = sh(a.repo, 'rev-parse', 'HEAD');
    const att = await attachAdopt(ctx, a.repo);
    expect(att.code).toBe(0);
    withAdoptionPersisted(ctx, a.baseline);
    const v = await gov(ctx, ['verify', '--story', STORY, '--worktree', a.repo]);
    expect(v.code).toBe(0);
    expect((await checkMerge(ctx, a.repo, v.result.bundle_hash as string)).code).toBe(0);
    expect(commitCount(a.repo)).toBe(count);
    expect(sh(a.repo, 'rev-parse', 'HEAD')).toBe(head);
    expect(sh(a.repo, 'status', '--porcelain')).toBe('');
  });

  it('(12) no Jira write, no JEV call: only the reader preflight is used', async () => {
    const ctx = makeCtx();
    const f = await adoptedFlow(ctx, (p) => [good(p)]);
    expect((await checkMerge(ctx, f.repo, f.bundle)).code).toBe(0);
    expect(ctx.world.clientCalls).toEqual([]);
    expect(new Set(ctx.world.tokensUsed)).toEqual(new Set([READER_TOKEN]));
    expect(ctx.transport.calls).toBe(0);
    expect(ctx.transportFactory).not.toHaveBeenCalled();
    expect(ctx.audit.records).toHaveLength(0);
    expect(ctx.deps.createWorktree).not.toHaveBeenCalled();
  });

  it('non-adopted binding is unchanged: --base attach on the same repo still needs >=1 commit with both trailers', async () => {
    const ctx = makeCtx();
    const a = adoptRepo();
    writeTranscript(ctx);
    const att = await gov(ctx, ['attach', '--story', STORY, '--session', SID, '--worktree', a.repo, '--base', 'main']);
    expect(att.code).toBe(0);
    const v = await gov(ctx, ['verify', '--story', STORY, '--worktree', a.repo]);
    // docs/old.md is outside src/** — the ordinary (non-adopted) path inspects the whole base..HEAD range.
    expect(v.code).toBe(GOV_EXIT.SCOPE_VIOLATION);
  });
});

// ---------------------------------------------------------------- Track A (binding.ts persistence)

describe('[Track A] ledger persistence of SessionBinding.adoption', () => {
  it('[Track A] adoption attach persists {baseline_commit, classification} on the ledger record', async () => {
    const ctx = makeCtx();
    const a = adoptRepo();
    writeTranscript(ctx);
    expect((await attachAdopt(ctx, a.repo)).code).toBe(0);
    expect(ledger(ctx)[0].adoption).toEqual({ baseline_commit: a.baseline, classification: ADOPTION_CLASSIFICATION });
  });

  it('[Track A] re-attach reuses the persisted adoption without any ledger bridge', async () => {
    const ctx = makeCtx();
    const a = adoptRepo();
    writeTranscript(ctx);
    expect((await attachAdopt(ctx, a.repo)).code).toBe(0);
    const second = await attachAdopt(ctx, a.repo);
    expect(second.code).toBe(0);
    expect(second.result.adoption_baseline).toBe(a.baseline);
  });

  it('[Track A] check-merge on an unbridged adoption attach → 0 at the baseline', async () => {
    const ctx = makeCtx();
    const a = adoptRepo();
    writeTranscript(ctx);
    expect((await attachAdopt(ctx, a.repo)).code).toBe(0);
    const v = await gov(ctx, ['verify', '--story', STORY, '--worktree', a.repo]);
    expect(v.code).toBe(0);
    expect((await checkMerge(ctx, a.repo, v.result.bundle_hash as string)).code).toBe(0);
  });
});
