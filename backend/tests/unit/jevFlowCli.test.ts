/**
 * gov CLI (Track 5) — the governance matrix end-to-end through runGov.
 * Hermetic: Jira, JEV and the BJC audit are injected fakes; git work runs in
 * throwaway repos under os.tmpdir(); GOV_HOME and CLAUDE_PROJECTS_DIR are temp
 * dirs. No network, never launches `claude`, never touches real transcripts.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemoryAuditSink } from '../../../scripts/jev-bjc/audit';
import type { JevTransport, ProviderReply } from '../../../scripts/jev-bjc/provider';
import { AC_FIELDS, ADVISORY_WRITE_FIELDS, STORY_FIELDS } from '../../../scripts/jev-jira/fields';
import { JiraClientError, assertAdvisoryOnly, type JiraClient, type JiraCredentials, type JiraIssue, type JiraPermissionProbe } from '../../../scripts/jev-jira/jiraClient';
import { STORY_AUTHORIZED_PATHS_FIELD, type JiraQuery } from '../../../scripts/jev-flow/jiraQuery';
import { validateRegistry } from '../../../scripts/jev-flow/registry';
import { GOV_EXIT, evidenceReferenceLine, runGov, type GovDeps } from '../../../scripts/jev-flow/cli';
import { loadBundle } from '../../../scripts/jev-flow/evidence';
import { govLayout, type VerificationRegistry } from '../../../scripts/jev-flow/types';

jest.setTimeout(180000);

const STORY = 'OMNI-10';
const SID = '0f1e2d3c-4b5a-4968-8776-655443322110';
const FIXED = new Date('2026-10-01T12:00:00.000Z');
// Built at runtime; never credential-shaped.
const READER_TOKEN = ['reader', 'test', 'value'].join('-');
const ADVISORY_TOKEN = ['advisory', 'test', 'value'].join('-');
const CLI_FILE = path.resolve(__dirname, '../../../scripts/jev-flow/cli.ts');

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

/** Temp repo with one commit on main; returns repo + base commit. */
function makeRepo(): { repo: string; base: string } {
  const repo = tmp('gov-cli-repo-');
  sh(repo, 'init', '-q', '-b', 'main');
  sh(repo, 'config', 'user.email', 'gov-test@example.invalid');
  sh(repo, 'config', 'user.name', 'gov test');
  sh(repo, 'config', 'commit.gpgsign', 'false');
  write(repo, 'README.md', 'base\n');
  sh(repo, 'add', '-A');
  sh(repo, 'commit', '-q', '-m', 'base');
  return { repo, base: sh(repo, 'rev-parse', 'HEAD') };
}

function commit(dir: string, files: Record<string, string>, ...trailers: string[]): string {
  for (const [rel, text] of Object.entries(files)) write(dir, rel, text);
  sh(dir, 'add', '-A');
  const args = ['commit', '-q', '-m', 'work'];
  if (trailers.length > 0) args.push('-m', trailers.join('\n'));
  sh(dir, ...args);
  return sh(dir, 'rev-parse', 'HEAD');
}

function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p));
    else out.push(p);
  }
  return out.sort();
}

function snapshot(dir: string): Record<string, string> {
  return Object.fromEntries(listFiles(dir).map((f) => [f, `${fs.statSync(f).mtimeMs}:${fs.readFileSync(f, 'utf8')}`]));
}

// ---------------------------------------------------------------- fake Jira

const sel = (value: string, id = `opt-${value}`) => ({ value, id });
const OPTION_VALUES: Record<string, string> = { '10044': 'PASS', '10045': 'FAIL', '10046': 'INSUFFICIENT_EVIDENCE', '10047': 'CONFLICT', '10048': 'NOT_RUN' };

function storyIssue(over: Record<string, unknown> = {}): JiraIssue {
  return {
    key: STORY,
    fields: {
      summary: 'Health route hardening',
      issuetype: { id: '10005' },
      project: { id: '10033' },
      status: { id: '10036', name: 'In Progress' },
      updated: '2026-10-01T09:00:00.000+0000',
      [STORY_FIELDS.objective]: 'Harden the health route',
      [STORY_FIELDS.architecture]: 'Route handler only',
      [STORY_FIELDS.invariants]: 'No route skips auth\nNo schema change',
      [STORY_AUTHORIZED_PATHS_FIELD]: 'src/**',
      [STORY_FIELDS.prohibitedPaths]: 'src/secret/**',
      [STORY_FIELDS.verificationRequirements]: 't.pass\nt.types',
      ...over,
    },
  };
}

function acIssue(key: string, over: Record<string, unknown> = {}): JiraIssue {
  const deterministic = key === 'OMNI-11';
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
      ...over,
    },
  };
}

const PERMS: Record<string, Record<string, boolean>> = {
  [READER_TOKEN]: { BROWSE_PROJECTS: true, EDIT_ISSUES: false, TRANSITION_ISSUES: false, CREATE_ISSUES: false, DELETE_ISSUES: false, ADMINISTER_PROJECTS: false, ADMINISTER: false },
  [ADVISORY_TOKEN]: { BROWSE_PROJECTS: true, EDIT_ISSUES: true, TRANSITION_ISSUES: false, CREATE_ISSUES: false, DELETE_ISSUES: false, ADMINISTER_PROJECTS: false, ADMINISTER: false },
};

class World {
  story: JiraIssue = storyIssue();
  acs: JiraIssue[] = [acIssue('OMNI-11'), acIssue('OMNI-12')];
  readonly tokensUsed: string[] = [];
  readonly reads: string[] = [];
  readonly updates: Array<{ key: string; fields: Record<string, unknown> }> = [];
  /** Any method other than the read/four-field set would be recorded here. */
  readonly otherCalls: string[] = [];

  query(): JiraQuery {
    return {
      getStory: async (key) => (key === this.story.key ? clone(this.story) : null),
      listAcceptanceCriteria: async () => this.acs.map(clone),
    };
  }

  client(c: JiraCredentials): JiraClient & JiraPermissionProbe {
    this.tokensUsed.push(c.token);
    const world = this;
    const base: JiraClient & JiraPermissionProbe = {
      async getMyPermissions() {
        return { ...(PERMS[c.token] ?? {}) };
      },
      async getIssue(key) {
        world.reads.push(key);
        const issue = world.acs.find((a) => a.key === key) ?? (key === world.story.key ? world.story : null);
        if (!issue) throw new JiraClientError('JIRA_NOT_FOUND', 'Jira returned HTTP 404');
        return clone(issue);
      },
      async updateAdvisoryFields(key, fields) {
        assertAdvisoryOnly(fields);
        world.updates.push({ key, fields: clone(fields) });
        const issue = world.acs.find((a) => a.key === key);
        for (const [k, v] of Object.entries(fields)) {
          issue.fields[k] = v && typeof v === 'object' ? { id: (v as { id: string }).id, value: OPTION_VALUES[(v as { id: string }).id] } : v;
        }
      },
    };
    return new Proxy(base, {
      get(target, prop) {
        if (typeof prop === 'string' && !(prop in target) && prop !== 'then') world.otherCalls.push(prop);
        return (target as unknown as Record<string | symbol, unknown>)[prop];
      },
    });
  }
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

function reply(ac = 'SUPPORTS'): ProviderReply {
  return {
    answers: {
      ac: { choice: ac, confidence: 0.9 },
      inv_0: { choice: 'HOLDS', confidence: 0.8 },
      inv_1: { choice: 'HOLDS', confidence: 0.8 },
      bundle_consistency: { noul: 0.95 },
    },
    model: 'jev-1.13.0',
  };
}

function fakeTransport(): JevTransport & { calls: number } {
  const t = {
    calls: 0,
    async send() {
      t.calls += 1;
      return reply();
    },
  };
  return t;
}

// ---------------------------------------------------------------- harness

interface Env {
  env: Record<string, string>;
  home: string;
  projects: string;
}

function makeEnv(over: Record<string, string> = {}): Env {
  const home = path.join(tmp('gov-cli-home-'), 'gov');
  const projects = tmp('gov-cli-projects-');
  return {
    home,
    projects,
    env: { GOV_HOME: home, CLAUDE_PROJECTS_DIR: projects, JEV_JIRA_IDENTITY: 'reader', JEV_READER_TOKEN: READER_TOKEN, ...over },
  };
}

interface Ctx {
  world: World;
  e: Env;
  transport: JevTransport & { calls: number };
  audit: MemoryAuditSink;
  deps: Partial<GovDeps> & { jiraQuery: jest.Mock; jiraClient: jest.Mock; runner: jest.Mock; createWorktree?: jest.Mock };
}

function makeCtx(over: Partial<GovDeps> = {}): Ctx {
  const world = new World();
  const e = makeEnv();
  const transport = fakeTransport();
  const audit = new MemoryAuditSink();
  const deps = {
    jiraQuery: jest.fn(() => world.query()),
    jiraClient: jest.fn((c: JiraCredentials) => world.client(c)),
    transport: () => transport,
    bjcAudit: () => audit,
    registry: REGISTRY,
    runner: jest.fn(async () => ({ exitCode: 0, output: Buffer.from('ok\n'), timedOut: false })),
    now: () => FIXED,
    newSessionId: () => SID,
    ...over,
  } as Ctx['deps'];
  return { world, e, transport, audit, deps };
}

interface RunOut {
  code: number;
  out: string[];
  err: string[];
  result: Record<string, unknown>;
}

async function gov(ctx: Ctx, argv: string[], env: Record<string, string | undefined> = ctx.e.env): Promise<RunOut> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runGov(argv, env, { out: (t) => out.push(t), err: (t) => err.push(t) }, ctx.deps);
  const line = out.filter((l) => l.startsWith('GOV_RESULT ')).pop();
  return { code, out, err, result: line ? JSON.parse(line.slice('GOV_RESULT '.length)) : null };
}

function ledger(e: Env): Array<Record<string, unknown>> {
  const f = govLayout(e.env).bindingsFile;
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : [];
}

/** `gov start` against a fresh temp repo with the REAL default createWorktree. */
async function startGoverned(ctx: Ctx): Promise<{ repo: string; base: string; worktree: string; packetHash: string }> {
  const { repo, base } = makeRepo();
  const root = tmp('gov-cli-wt-');
  const r = await gov(ctx, ['start', '--story', STORY, '--slug', 'health', '--repo', repo, '--base', 'main', '--worktree-root', root]);
  expect(r.code).toBe(0);
  return { repo, base, worktree: path.join(root, 'omni-10-health'), packetHash: r.result.packet_hash as string };
}

const trailers = (packetHash: string, story = STORY) => [`Governed-By: ${story}`, `Gov-Packet: ${packetHash}`];

/** start + a governed commit + verify. */
async function verifiedFlow(ctx: Ctx, files: Record<string, string> = { 'src/health.ts': 'export const ok = 1;\n' }, trailerFn = trailers) {
  const g = await startGoverned(ctx);
  const head = commit(g.worktree, files, ...trailerFn(g.packetHash));
  const v = await gov(ctx, ['verify', '--story', STORY, '--worktree', g.worktree]);
  return { ...g, head, verify: v, bundleHash: v.result.bundle_hash as string };
}

// ---------------------------------------------------------------- start

describe('gov start', () => {
  it('ready Story → worktree requested, packet stored, binding mode new, start command printed (never launched)', async () => {
    const createWorktree = jest.fn(async () => undefined);
    const ctx = makeCtx({ createWorktree });
    const { repo, base } = makeRepo();
    const root = tmp('gov-cli-wt-');
    const r = await gov(ctx, ['start', '--story', STORY, '--slug', 'health', '--repo', repo, '--base', 'main', '--worktree-root', root]);
    expect(r.code).toBe(0);
    const worktree = path.join(root, 'omni-10-health');
    expect(createWorktree).toHaveBeenCalledTimes(1);
    expect(createWorktree).toHaveBeenCalledWith(path.resolve(repo), worktree, 'omni-10/health', base);
    const layout = govLayout(ctx.e.env);
    const hash = r.result.packet_hash as `sha256:${string}`;
    const md = layout.packetFile(STORY, hash, 'md');
    expect(fs.existsSync(layout.packetFile(STORY, hash, 'json'))).toBe(true);
    expect(fs.existsSync(md)).toBe(true);
    expect(r.result).toMatchObject({ status: 'OK', story: STORY, base_commit: base, branch: 'omni-10/health', session_id: SID, packet_md: md });
    const l = ledger(ctx.e);
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ story_key: STORY, session_id: SID, mode: 'new', session_file: null, base_commit: base, packet_hash: hash });
    const text = r.out.join('\n');
    expect(text).toContain(`Base commit: ${base}`);
    expect(text).toContain(`--session-id ${SID}`);
    expect(text).toContain(`@${md}`);
    expect(text).toContain('cmd /c mklink /J');
    expect(text).toContain('\\node_modules');
    expect(r.out[r.out.length - 1]).toMatch(/^GOV_RESULT \{/);
    // Only reader identity, preflighted.
    expect(ctx.world.tokensUsed).toEqual([READER_TOKEN]);
  });

  it('Story with no AC → NOT_READY 10; no worktree, nothing under GOV_HOME', async () => {
    const createWorktree = jest.fn(async () => undefined);
    const ctx = makeCtx({ createWorktree });
    ctx.world.acs = [];
    const { repo } = makeRepo();
    const r = await gov(ctx, ['start', '--story', STORY, '--slug', 'health', '--repo', repo, '--base', 'main', '--worktree-root', tmp('gov-cli-wt-')]);
    expect(r.code).toBe(GOV_EXIT.NOT_READY);
    expect(r.code).toBe(10);
    expect(r.err.join('\n')).toContain('NO_ACCEPTANCE_CRITERIA');
    expect(createWorktree).not.toHaveBeenCalled();
    expect(listFiles(ctx.e.home)).toEqual([]);
  });

  it('Story referencing a registry id absent from the registry → NOT_READY 10', async () => {
    const createWorktree = jest.fn(async () => undefined);
    const ctx = makeCtx({ createWorktree });
    ctx.world.story = storyIssue({ [STORY_FIELDS.verificationRequirements]: 't.pass\nnot.in.registry' });
    const { repo } = makeRepo();
    const r = await gov(ctx, ['start', '--story', STORY, '--slug', 'health', '--repo', repo, '--base', 'main', '--worktree-root', tmp('gov-cli-wt-')]);
    expect(r.code).toBe(10);
    expect(r.err.join('\n')).toContain('UNKNOWN_REGISTRY_ID');
    expect(createWorktree).not.toHaveBeenCalled();
    expect(listFiles(ctx.e.home)).toEqual([]);
  });

  it('identity: missing / wrong identity or an over-privileged reader token → REFUSED 11 before any Jira read', async () => {
    const createWorktree = jest.fn(async () => undefined);
    const ctx = makeCtx({ createWorktree });
    const { repo } = makeRepo();
    const args = ['start', '--story', STORY, '--slug', 'health', '--repo', repo, '--base', 'main', '--worktree-root', tmp('gov-cli-wt-')];
    const noId = await gov(ctx, args, { ...ctx.e.env, JEV_JIRA_IDENTITY: undefined });
    expect(noId.code).toBe(11);
    const adv = await gov(ctx, args, { ...ctx.e.env, JEV_JIRA_IDENTITY: 'advisory', JEV_ADVISORY_TOKEN: ADVISORY_TOKEN });
    expect(adv.code).toBe(11);
    const over = await gov(ctx, args, { ...ctx.e.env, JEV_READER_TOKEN: ADVISORY_TOKEN });
    expect(over.code).toBe(11);
    expect(over.err.join('\n')).toContain('EDIT_ISSUES must NOT be granted');
    expect(ctx.deps.jiraQuery).not.toHaveBeenCalled();
    expect(createWorktree).not.toHaveBeenCalled();
    for (const r of [noId, adv, over]) expect([...r.out, ...r.err].join('\n')).not.toContain(ADVISORY_TOKEN);
  });

  it('refuses an existing worktree path or branch; bad slug / missing flags are usage 64', async () => {
    const createWorktree = jest.fn(async () => undefined);
    const ctx = makeCtx({ createWorktree });
    const { repo } = makeRepo();
    const root = tmp('gov-cli-wt-');
    fs.mkdirSync(path.join(root, 'omni-10-health'));
    const exists = await gov(ctx, ['start', '--story', STORY, '--slug', 'health', '--repo', repo, '--base', 'main', '--worktree-root', root]);
    expect(exists.code).toBe(11);
    sh(repo, 'branch', 'omni-10/other');
    const branch = await gov(ctx, ['start', '--story', STORY, '--slug', 'other', '--repo', repo, '--base', 'main', '--worktree-root', root]);
    expect(branch.code).toBe(11);
    const badBase = await gov(ctx, ['start', '--story', STORY, '--slug', 'third', '--repo', repo, '--base', 'no-such-ref', '--worktree-root', root]);
    expect(badBase.code).toBe(11);
    expect(createWorktree).not.toHaveBeenCalled();
    expect((await gov(ctx, ['start', '--story', STORY, '--slug', 'Bad_Slug', '--repo', repo])).code).toBe(64);
    expect((await gov(ctx, ['start', '--story', 'OMNI-0', '--slug', 'ok-slug', '--repo', repo])).code).toBe(64);
    expect((await gov(ctx, ['nope'])).code).toBe(64);
    expect((await gov(ctx, [])).code).toBe(64);
  });
});

// ---------------------------------------------------------------- attach

function writeTranscript(e: Env, cwd: string | null): string {
  const d = path.join(e.projects, 'C--some-project');
  fs.mkdirSync(d, { recursive: true });
  const f = path.join(d, `${SID}.jsonl`);
  const lines = [JSON.stringify({ type: 'queue-operation' }), JSON.stringify({ type: 'user', sessionId: SID, ...(cwd ? { cwd } : {}), gitBranch: 'feature/x' })];
  fs.writeFileSync(f, `${lines.join('\n')}\n`);
  return f;
}

function featureRepo(): { repo: string; base: string } {
  const { repo, base } = makeRepo();
  sh(repo, 'checkout', '-q', '-b', 'feature/x');
  commit(repo, { 'src/a.ts': 'a\n' });
  return { repo, base };
}

describe('gov attach', () => {
  it('attaches an existing transcript read-only (bytes unchanged) and prints resume steps', async () => {
    const ctx = makeCtx();
    const { repo, base } = featureRepo();
    const file = writeTranscript(ctx.e, 'C:\\work\\repo');
    const before = fs.readFileSync(file);
    const mtime = fs.statSync(file).mtimeMs;
    const r = await gov(ctx, ['attach', '--story', STORY, '--session', SID, '--worktree', repo, '--base', 'main']);
    expect(r.code).toBe(0);
    expect(fs.readFileSync(file).equals(before)).toBe(true);
    expect(fs.statSync(file).mtimeMs).toBe(mtime);
    expect(r.result).toMatchObject({ status: 'OK', base_commit: base, branch: 'feature/x', binding: 'BOUND' });
    const l = ledger(ctx.e);
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ mode: 'attach', session_id: SID, base_commit: base });
    expect((l[0].session_file as { sha256: string }).sha256).toBe(r.result.transcript_sha256);
    const text = r.out.join('\n');
    expect(text).toContain('cd "C:\\work\\repo"');
    expect(text).toContain(`claude --resume ${SID}`);
    expect(text).toContain(`@${r.result.packet_md}`);
  });

  it('attach twice is idempotent: ALREADY_BOUND, one ledger line (second run reuses the bound base)', async () => {
    const ctx = makeCtx();
    const { repo } = featureRepo();
    writeTranscript(ctx.e, null);
    const first = await gov(ctx, ['attach', '--story', STORY, '--session', SID, '--worktree', repo, '--base', 'main', '--fork']);
    expect(first.code).toBe(0);
    expect(first.out.join('\n')).toContain("original directory");
    expect(first.out.join('\n')).toContain('--fork-session');
    const second = await gov(ctx, ['attach', '--story', STORY, '--session', SID, '--worktree', repo]);
    expect(second.code).toBe(0);
    expect(second.result.binding).toBe('ALREADY_BOUND');
    expect(second.result.packet_hash).toBe(first.result.packet_hash);
    expect(ledger(ctx.e)).toHaveLength(1);
  });

  it('dirty repo, non-descending HEAD, no --base, missing transcript → REFUSED 11 with no packet/binding written', async () => {
    const ctx = makeCtx();
    writeTranscript(ctx.e, 'C:\\work\\repo');
    const layout = govLayout(ctx.e.env);

    const dirty = featureRepo();
    write(dirty.repo, 'src/uncommitted.ts', 'x\n');
    const r1 = await gov(ctx, ['attach', '--story', STORY, '--session', SID, '--worktree', dirty.repo, '--base', 'main']);
    expect(r1.code).toBe(11);
    expect(r1.err.join('\n')).toMatch(/dirty/);

    // main moves on; the feature branch no longer descends from main.
    const diverged = featureRepo();
    sh(diverged.repo, 'checkout', '-q', 'main');
    commit(diverged.repo, { 'other.txt': 'main moved\n' });
    sh(diverged.repo, 'checkout', '-q', 'feature/x');
    const r2 = await gov(ctx, ['attach', '--story', STORY, '--session', SID, '--worktree', diverged.repo, '--base', 'main']);
    expect(r2.code).toBe(11);
    expect(r2.err.join('\n')).toMatch(/does not descend/);

    const clean = featureRepo();
    const r3 = await gov(ctx, ['attach', '--story', STORY, '--session', SID, '--worktree', clean.repo]);
    expect(r3.code).toBe(11);
    expect(r3.err.join('\n')).toMatch(/never inferred/);

    sh(clean.repo, 'checkout', '-q', '--detach');
    const r4 = await gov(ctx, ['attach', '--story', STORY, '--session', SID, '--worktree', clean.repo, '--base', 'main']);
    expect(r4.code).toBe(11);
    expect(r4.err.join('\n')).toMatch(/detached/);

    const other = '11111111-2222-4333-8444-555555555555';
    const r5 = await gov(ctx, ['attach', '--story', STORY, '--session', other, '--worktree', clean.repo, '--base', 'main']);
    expect(r5.code).toBe(11);

    expect(fs.existsSync(layout.bindingsFile)).toBe(false);
    expect(fs.existsSync(layout.packetsDir(STORY))).toBe(false);
  });

  it('not-ready Story → 10 before the transcript is even looked up', async () => {
    const ctx = makeCtx();
    ctx.world.acs = [];
    const { repo } = featureRepo();
    const r = await gov(ctx, ['attach', '--story', STORY, '--session', SID, '--worktree', repo, '--base', 'main']);
    expect(r.code).toBe(10);
    expect(listFiles(ctx.e.home)).toEqual([]);
  });
});

// ---------------------------------------------------------------- packet / staleness

async function startFake(ctx: Ctx) {
  ctx.deps.createWorktree = jest.fn(async () => undefined);
  const { repo } = makeRepo();
  const root = tmp('gov-cli-wt-');
  const r = await gov(ctx, ['start', '--story', STORY, '--slug', 'health', '--repo', repo, '--base', 'main', '--worktree-root', root]);
  expect(r.code).toBe(0);
  return { worktree: path.join(root, 'omni-10-health'), packetHash: r.result.packet_hash as string };
}

describe('gov packet', () => {
  it('fresh packet → 0 and read-only', async () => {
    const ctx = makeCtx();
    const s = await startFake(ctx);
    const before = snapshot(ctx.e.home);
    const r = await gov(ctx, ['packet', '--story', STORY, '--worktree', s.worktree]);
    expect(r.code).toBe(0);
    expect(r.result.packet_hash).toBe(s.packetHash);
    expect(snapshot(ctx.e.home)).toEqual(before);
  });

  it('Story field change → STALE 12', async () => {
    const ctx = makeCtx();
    const s = await startFake(ctx);
    ctx.world.story = storyIssue({ updated: '2026-10-01T11:30:00.000+0000', [STORY_FIELDS.objective]: 'Changed objective' });
    const r = await gov(ctx, ['packet', '--story', STORY, '--worktree', s.worktree]);
    expect(r.code).toBe(12);
    expect(r.err.join('\n')).toContain('updated changed');
  });

  it('AC change → STALE 12; scope change → STALE 12', async () => {
    const ctx = makeCtx();
    const s = await startFake(ctx);
    ctx.world.acs = [acIssue('OMNI-11', { updated: '2026-10-01T11:00:00.000+0000' }), acIssue('OMNI-12')];
    expect((await gov(ctx, ['packet', '--story', STORY, '--worktree', s.worktree])).code).toBe(12);
    ctx.world.acs = [acIssue('OMNI-11'), acIssue('OMNI-12')];
    ctx.world.story = storyIssue({ [STORY_AUTHORIZED_PATHS_FIELD]: 'src/**\nlib/**' });
    const r = await gov(ctx, ['packet', '--story', STORY, '--worktree', s.worktree]);
    expect(r.code).toBe(12);
    expect(r.err.join('\n')).toContain('Scope');
  });

  it('registry drift after the packet → STALE 12', async () => {
    const ctx = makeCtx();
    const s = await startFake(ctx);
    ctx.deps.registry = validateRegistry({ ...REGISTRY, entries: REGISTRY.entries.map((e) => (e.id === 't.pass' ? { ...e, timeout_ms: 1234 } : e)) });
    const r = await gov(ctx, ['packet', '--story', STORY, '--worktree', s.worktree]);
    expect(r.code).toBe(12);
    expect(r.err.join('\n')).toContain('registry digest changed');
  });

  it('--regenerate stores a new packet for the same base and re-binds the same session', async () => {
    const ctx = makeCtx();
    const s = await startFake(ctx);
    ctx.world.story = storyIssue({ updated: '2026-10-01T11:30:00.000+0000' });
    const r = await gov(ctx, ['packet', '--story', STORY, '--worktree', s.worktree, '--regenerate']);
    expect(r.code).toBe(0);
    expect(r.result.packet_hash).not.toBe(s.packetHash);
    expect(r.result.previous_packet_hash).toBe(s.packetHash);
    const l = ledger(ctx.e);
    expect(l).toHaveLength(2);
    expect(l[1]).toMatchObject({ session_id: SID, packet_hash: r.result.packet_hash, base_commit: l[0].base_commit, mode: 'new' });
    expect((await gov(ctx, ['packet', '--story', STORY, '--worktree', s.worktree])).code).toBe(0);
  });

  it('no binding for story+worktree → REFUSED 11', async () => {
    const ctx = makeCtx();
    const r = await gov(ctx, ['packet', '--story', STORY, '--worktree', tmp('gov-cli-none-')]);
    expect(r.code).toBe(11);
  });
});

// ---------------------------------------------------------------- verify

describe('gov verify', () => {
  it('governed commit → OK 0 with EV lines and a bundle hash', async () => {
    const ctx = makeCtx();
    const f = await verifiedFlow(ctx);
    expect(f.verify.code).toBe(0);
    expect(f.bundleHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    const text = f.verify.out.join('\n');
    expect(text).toContain('EV-1 t.pass exit=0 PASS log=sha256:');
    expect(text).toContain('EV-2 t.types exit=0 PASS');
    expect(text).toContain('Scope: ok (1 changed, 0 outside authorized, 0 prohibited)');
    expect(ctx.deps.runner).toHaveBeenCalledTimes(2);
    // Only `gov start` read Jira; verify never does.
    expect(ctx.deps.jiraQuery).toHaveBeenCalledTimes(1);
  });

  it('a failing registry command → VERIFICATION_FAILED 14', async () => {
    const ctx = makeCtx();
    ctx.deps.runner = jest.fn(async () => ({ exitCode: 1, output: Buffer.from('fail\n'), timedOut: false }));
    const f = await verifiedFlow(ctx);
    expect(f.verify.code).toBe(14);
    expect(f.verify.result.deterministic_result).toBe('FAIL');
  });

  it('dirty tracked change / untracked file → REFUSED 11, no command run', async () => {
    const ctx = makeCtx();
    const g = await startGoverned(ctx);
    commit(g.worktree, { 'src/health.ts': 'x\n' }, ...trailers(g.packetHash));
    write(g.worktree, 'src/health.ts', 'modified\n');
    expect((await gov(ctx, ['verify', '--story', STORY, '--worktree', g.worktree])).code).toBe(11);
    sh(g.worktree, 'checkout', '--', 'src/health.ts');
    write(g.worktree, 'src/untracked.ts', 'new\n');
    expect((await gov(ctx, ['verify', '--story', STORY, '--worktree', g.worktree])).code).toBe(11);
    expect(ctx.deps.runner).not.toHaveBeenCalled();
  });

  it('change outside authorized paths → SCOPE_VIOLATION 15', async () => {
    const ctx = makeCtx();
    const f = await verifiedFlow(ctx, { 'docs/readme.md': 'x\n' });
    expect(f.verify.code).toBe(15);
    expect(f.verify.out.join('\n')).toContain('outside authorized: docs/readme.md');
    expect(ctx.deps.runner).not.toHaveBeenCalled();
  });

  it('prohibited path → SCOPE_VIOLATION 15', async () => {
    const ctx = makeCtx();
    const f = await verifiedFlow(ctx, { 'src/secret/key.ts': 'x\n' });
    expect(f.verify.code).toBe(15);
    expect(f.verify.out.join('\n')).toContain('prohibited: src/secret/key.ts');
  });

  it('tampered packet file → INTEGRITY_FAILED 13', async () => {
    const ctx = makeCtx();
    const g = await startGoverned(ctx);
    commit(g.worktree, { 'src/health.ts': 'x\n' }, ...trailers(g.packetHash));
    const file = govLayout(ctx.e.env).packetFile(STORY, g.packetHash as `sha256:${string}`, 'json');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('Harden the health route', 'Harden nothing'));
    expect((await gov(ctx, ['verify', '--story', STORY, '--worktree', g.worktree])).code).toBe(13);
    expect(ctx.deps.runner).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------- judge

describe('gov judge', () => {
  it('reader identity: judges every AC, never writes, never transitions', async () => {
    const ctx = makeCtx();
    const f = await verifiedFlow(ctx);
    const r = await gov(ctx, ['judge', '--story', STORY, '--worktree', f.worktree, '--evidence', f.bundleHash, '--invoked-by', 'human:tester']);
    expect(r.code).toBe(0);
    expect(r.out.join('\n')).toContain('OMNI-11 AC-1: deterministic PASS');
    expect(r.out.join('\n')).toContain('write-back SKIPPED');
    expect(ctx.transport.calls).toBe(2);
    expect(ctx.world.updates).toEqual([]);
    expect(ctx.world.otherCalls).toEqual([]);
    expect(ctx.world.tokensUsed.every((t) => t === READER_TOKEN)).toBe(true);
    expect(ctx.audit.records).toHaveLength(2);
  });

  it('--write-back with the advisory identity writes only the four JEV fields', async () => {
    const ctx = makeCtx();
    const f = await verifiedFlow(ctx);
    const env = { ...ctx.e.env, JEV_JIRA_IDENTITY: 'advisory', JEV_ADVISORY_TOKEN: ADVISORY_TOKEN };
    const r = await gov(ctx, ['judge', '--story', STORY, '--worktree', f.worktree, '--evidence', f.bundleHash, '--invoked-by', 'claude-code:s1', '--write-back'], env);
    expect(r.code).toBe(0);
    expect(ctx.world.updates.map((u) => u.key)).toEqual(['OMNI-11', 'OMNI-12']);
    for (const u of ctx.world.updates) expect(Object.keys(u.fields).sort()).toEqual([...ADVISORY_WRITE_FIELDS].sort());
    expect(ctx.world.otherCalls).toEqual([]);
    expect(ctx.world.tokensUsed[ctx.world.tokensUsed.length - 1]).toBe(ADVISORY_TOKEN);
    expect([...r.out, ...r.err].join('\n')).not.toContain(ADVISORY_TOKEN);
  });

  it('--write-back with the reader identity → REFUSED 11, nothing judged or written', async () => {
    const ctx = makeCtx();
    const f = await verifiedFlow(ctx);
    const r = await gov(ctx, ['judge', '--story', STORY, '--worktree', f.worktree, '--evidence', f.bundleHash, '--invoked-by', 'human:t', '--write-back']);
    expect(r.code).toBe(11);
    expect(ctx.transport.calls).toBe(0);
    expect(ctx.world.updates).toEqual([]);
  });

  it('missing --evidence → 64; unknown evidence hash → 11; tampered evidence → 13', async () => {
    const ctx = makeCtx();
    const f = await verifiedFlow(ctx);
    expect((await gov(ctx, ['judge', '--story', STORY, '--worktree', f.worktree, '--invoked-by', 'human:t'])).code).toBe(64);
    const unknown = `sha256:${'0'.repeat(64)}`;
    expect((await gov(ctx, ['judge', '--story', STORY, '--worktree', f.worktree, '--evidence', unknown, '--invoked-by', 'human:t'])).code).toBe(11);
    const file = govLayout(ctx.e.env).evidenceFile(STORY, f.bundleHash as `sha256:${string}`);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('"exit_code":0', '"exit_code":7'));
    expect((await gov(ctx, ['judge', '--story', STORY, '--worktree', f.worktree, '--evidence', f.bundleHash, '--invoked-by', 'human:t'])).code).toBe(13);
    expect(ctx.transport.calls).toBe(0);
  });

  it('no JEV transport → JUDGMENT_UNAVAILABLE 16', async () => {
    const ctx = makeCtx({ transport: () => null });
    const f = await verifiedFlow(ctx);
    const r = await gov(ctx, ['judge', '--story', STORY, '--worktree', f.worktree, '--evidence', f.bundleHash, '--invoked-by', 'human:t']);
    expect(r.code).toBe(16);
  });
});

// ---------------------------------------------------------------- submit

describe('gov submit', () => {
  it('prints the pinned human Record Result values; no Jira call, no file written', async () => {
    const ctx = makeCtx();
    const f = await verifiedFlow(ctx);
    ctx.deps.jiraQuery.mockClear();
    ctx.deps.jiraClient.mockClear();
    const before = snapshot(ctx.e.home);
    const r = await gov(ctx, ['submit', '--story', STORY, '--evidence', f.bundleHash, '--worktree', f.worktree]);
    expect(r.code).toBe(0);
    expect(ctx.deps.jiraQuery).not.toHaveBeenCalled();
    expect(ctx.deps.jiraClient).not.toHaveBeenCalled();
    expect(snapshot(ctx.e.home)).toEqual(before);
    const head12 = f.head.slice(0, 12);
    const refs = `gov-evidence ${f.bundleHash} head ${head12} t.pass=PASS t.types=PASS`;
    expect(evidenceReferenceLine(loadBundle(govLayout(ctx.e.env), STORY, f.bundleHash as `sha256:${string}`))).toBe(refs);
    expect(r.out.slice(0, -1)).toEqual([
      `gov submit ${STORY}: values for a HUMAN to record in Jira (gov writes nothing)`,
      `Evidence bundle: ${f.bundleHash} (deterministic PASS, head ${f.head}, packet ${f.packetHash})`,
      '',
      'OMNI-11 AC-1 — Jira transition "Record Result":',
      '  Kind: Deterministic',
      '  Deterministic Result: PASS',
      '  Evidence Kind: Test',
      `  Evidence References: ${refs}`,
      '',
      'OMNI-12 AC-2 — Jira transition "Record Result":',
      '  Kind: Judgment',
      '  Deterministic Result: PASS',
      '  Evidence Kind: Manual',
      `  Evidence References: ${refs}`,
      '',
      'Verification / Disposition (Jira transition "Record Verification") is the human\'s decision; gov does not record it.',
    ]);
    expect(r.result).toMatchObject({ status: 'OK', bundle_hash: f.bundleHash, packet_hash: f.packetHash, deterministic_result: 'PASS' });
  });

  it('unknown evidence → 11; wrong worktree → 11', async () => {
    const ctx = makeCtx();
    const f = await verifiedFlow(ctx);
    expect((await gov(ctx, ['submit', '--story', STORY, '--evidence', `sha256:${'1'.repeat(64)}`])).code).toBe(11);
    expect((await gov(ctx, ['submit', '--story', STORY, '--evidence', f.bundleHash, '--worktree', tmp('gov-cli-other-')])).code).toBe(11);
  });
});

// ---------------------------------------------------------------- check-merge

describe('gov check-merge', () => {
  it('fully governed branch (trailers on every commit, PASS bundle at HEAD) → 0', async () => {
    const ctx = makeCtx();
    const f = await verifiedFlow(ctx);
    const r = await gov(ctx, ['check-merge', '--story', STORY, '--worktree', f.worktree, '--evidence', f.bundleHash]);
    expect(r.code).toBe(0);
    expect(r.out.filter((l) => l.includes('[FAIL]'))).toEqual([]);
    expect(r.out.filter((l) => l.includes('[PASS]'))).toHaveLength(9);
  });

  it('commits without trailers → 13', async () => {
    const ctx = makeCtx();
    const f = await verifiedFlow(ctx, undefined, () => []);
    expect(f.verify.code).toBe(0);
    const r = await gov(ctx, ['check-merge', '--story', STORY, '--worktree', f.worktree, '--evidence', f.bundleHash]);
    expect(r.code).toBe(13);
    expect(r.out.join('\n')).toMatch(/\[FAIL\] trailers: .*missing Governed-By/);
  });

  it('wrong Gov-Packet trailer → 13', async () => {
    const ctx = makeCtx();
    const f = await verifiedFlow(ctx, undefined, () => trailers(`sha256:${'9'.repeat(64)}`));
    const r = await gov(ctx, ['check-merge', '--story', STORY, '--worktree', f.worktree, '--evidence', f.bundleHash]);
    expect(r.code).toBe(13);
    expect(r.out.join('\n')).toMatch(/missing Gov-Packet/);
  });

  it('wrong / tampered evidence hash → 13; HEAD moved after verify → 13; no binding → 11; FAIL bundle → 14', async () => {
    const ctx = makeCtx();
    const f = await verifiedFlow(ctx);
    expect((await gov(ctx, ['check-merge', '--story', STORY, '--worktree', f.worktree, '--evidence', `sha256:${'2'.repeat(64)}`])).code).toBe(13);
    commit(f.worktree, { 'src/later.ts': 'y\n' }, ...trailers(f.packetHash));
    const moved = await gov(ctx, ['check-merge', '--story', STORY, '--worktree', f.worktree, '--evidence', f.bundleHash]);
    expect(moved.code).toBe(13);
    expect(moved.out.join('\n')).toMatch(/\[FAIL\] head/);
    expect((await gov(ctx, ['check-merge', '--story', STORY, '--worktree', tmp('gov-cli-none-'), '--evidence', f.bundleHash])).code).toBe(11);

    const ctx2 = makeCtx();
    ctx2.deps.runner = jest.fn(async () => ({ exitCode: 2, output: Buffer.from('no\n'), timedOut: false }));
    const f2 = await verifiedFlow(ctx2);
    expect(f2.verify.code).toBe(14);
    expect((await gov(ctx2, ['check-merge', '--story', STORY, '--worktree', f2.worktree, '--evidence', f2.bundleHash])).code).toBe(14);
  });
});

// ---------------------------------------------------------------- static guarantees

describe('gov cli — static', () => {
  const src = fs.readFileSync(CLI_FILE, 'utf8');

  it('registers no hooks and has no Jira transition / write path of its own', () => {
    for (const token of ['PreToolUse', 'PostToolUse', 'SessionStart', 'UserPromptSubmit', '/transitions', 'transitionIssue']) {
      expect(src).not.toContain(token);
    }
    expect(src).not.toMatch(/\b(POST|PUT|PATCH|DELETE)\b/);
    expect(src).not.toMatch(/\bfetch\s*\(/);
    expect(src).not.toMatch(/updateAdvisoryFields/);
  });

  it('never launches claude or runs a shell', () => {
    expect(src).not.toMatch(/(spawn|execFile|exec)\(\s*['"]claude/);
    expect(src).not.toMatch(/shell:\s*true/);
    expect(src).not.toMatch(/mklink[^\n]*execFile|execFile[^\n]*mklink/);
  });

  it('exit-code map is fixed', () => {
    expect(GOV_EXIT).toEqual({
      OK: 0, NOT_READY: 10, REFUSED: 11, STALE: 12, INTEGRITY_FAILED: 13, VERIFICATION_FAILED: 14, SCOPE_VIOLATION: 15, JUDGMENT_UNAVAILABLE: 16, ERROR: 70,
    });
  });
});
