/**
 * gov intake — the governed entry layer.
 *
 * Hermetic: git work runs in throwaway repos under os.tmpdir(); Jira is an
 * injected fake (reader) or a fake `fetch` behind the real intake Jira client
 * (human apply); GOV_HOME, CLAUDE_PROJECTS_DIR and the live-session list are
 * temp dirs / fakes. No network, never launches `claude`, never reaches JEV,
 * and the only commits are the ones the test itself makes as "the human".
 */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { JevTransport } from '../../../scripts/jev-bjc/provider';
import { AC_FIELDS, STORY_FIELDS } from '../../../scripts/jev-jira/fields';
import type { JiraClient, JiraCredentials, JiraIssue, JiraPermissionProbe } from '../../../scripts/jev-jira/jiraClient';
import { STORY_AUTHORIZED_PATHS_FIELD, type JiraQuery } from '../../../scripts/jev-flow/jiraQuery';
import { validateRegistry } from '../../../scripts/jev-flow/registry';
import { GOV_EXIT, createIntakeProbe, runGov, type GovDeps } from '../../../scripts/jev-flow/cli';
import { bindSession, readBindings } from '../../../scripts/jev-flow/binding';
import {
  classifyIntake,
  deriveAuthorizedPaths,
  intakeLabel,
  loadIntakeRules,
  validateIntakeRules,
  type IntakeInput,
  type IntakeRules,
  type StoryCandidate,
} from '../../../scripts/jev-flow/intake';
import {
  AC_CREATE_FIELDS,
  GATE_FIELD_IDS,
  INTAKE_ROUTES,
  STORY_CREATE_FIELDS,
  assertIntakeFields,
  createFormProblems,
  createIntakeJira,
  resolveIntakeCredentials,
  routeAllowed,
} from '../../../scripts/jev-flow/intakeJira';
import { parseNulList, parsePorcelainZ, readLiveSessions, type LiveSession, type WorktreeState } from '../../../scripts/jev-flow/intakeProbe';
import { loadRegistry } from '../../../scripts/jev-flow/registry';
import { ADOPTION_CLASSIFICATION, canonicalHash, govLayout, type VerificationRegistry } from '../../../scripts/jev-flow/types';

jest.setTimeout(180000);

const STORY = 'OMNI-6';
const OTHER_STORY = 'OMNI-9';
const SID = '0f1e2d3c-4b5a-4968-8776-655443322110';
const SID2 = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const FIXED = new Date('2026-10-06T12:00:00.000Z');
// Built at runtime; never credential-shaped.
const READER_TOKEN = ['reader', 'test', 'value'].join('-');
const HUMAN_TOKEN = ['human', 'test', 'value'].join('-');
const HUMAN_EMAIL = 'human@example.invalid';
const C1 = 'a'.repeat(40);
const C2 = 'b'.repeat(40);

const REGISTRY: VerificationRegistry = validateRegistry({
  schema: 'gov-registry/1',
  entries: [
    { id: 't.pass', description: 'unit tests', argv: ['node', '-e', 'process.exit(0)'], evidence_kind: 'test_run', timeout_ms: 60000 },
    { id: 't.types', description: 'typecheck', argv: ['node', '-e', 'process.exit(0)'], evidence_kind: 'typecheck', timeout_ms: 60000 },
  ],
});

const RULES: IntakeRules = validateIntakeRules(
  {
    schema: 'gov-intake-rules/1',
    default_prohibited_paths: ['supabase/migrations/**', '.claude/settings*.json', '.env*'],
    verification_mappings: [{ paths: ['src/**'], registry_ids: ['t.pass', 't.types'] }],
  },
  REGISTRY,
);

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
  const args = ['commit', '-q', '--allow-empty', '-m', 'work'];
  if (trailers.length > 0) args.push('-m', trailers.join('\n'));
  sh(dir, ...args);
  return sh(dir, 'rev-parse', 'HEAD');
}

/** main with one commit; branch `feature/x` checked out (optionally with commits). */
function repo(featureFiles: Record<string, string> | null = null): string {
  const r = tmp('gov-intake-repo-');
  sh(r, 'init', '-q', '-b', 'main');
  sh(r, 'config', 'user.email', 'gov-test@example.invalid');
  sh(r, 'config', 'user.name', 'gov test');
  sh(r, 'config', 'commit.gpgsign', 'false');
  commit(r, { 'README.md': 'base\n' });
  sh(r, 'checkout', '-q', '-b', 'feature/x');
  if (featureFiles) commit(r, featureFiles);
  return r;
}

/** Everything that could change: HEAD, refs, index, stash, status and every file's bytes. */
function snapshot(r: string): string {
  const h = crypto.createHash('sha256');
  h.update(sh(r, 'rev-parse', 'HEAD'));
  h.update(sh(r, 'for-each-ref'));
  h.update(sh(r, 'status', '--porcelain=v1', '--untracked-files=all'));
  h.update(sh(r, 'stash', 'list'));
  h.update(fs.readFileSync(path.join(r, '.git', 'index')));
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name === '.git') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        h.update(p);
        h.update(fs.readFileSync(p));
      }
    }
  };
  walk(r);
  return h.digest('hex');
}

// ---------------------------------------------------------------- fake Jira (reader side)

const sel = (value: string, id: string) => ({ value, id });

function storyIssue(key: string, authorized: string, summary = 'Existing work'): JiraIssue {
  return {
    key,
    fields: {
      summary,
      issuetype: { id: '10005' },
      project: { id: '10033' },
      status: { id: '10036', name: 'In Progress' },
      updated: '2026-10-06T09:00:00.000+0000',
      [STORY_FIELDS.objective]: 'Do the work',
      [STORY_FIELDS.architecture]: null,
      [STORY_FIELDS.invariants]: null,
      [STORY_AUTHORIZED_PATHS_FIELD]: authorized,
      [STORY_FIELDS.prohibitedPaths]: 'src/secret/**',
      [STORY_FIELDS.verificationRequirements]: 't.pass\nt.types',
    },
  };
}

function acIssue(key: string, parent: string): JiraIssue {
  return {
    key,
    fields: {
      summary: `AC ${key}`,
      issuetype: { id: '10074' },
      project: { id: '10033' },
      status: { id: '10037', name: 'Open' },
      parent: { key: parent },
      updated: '2026-10-06T10:00:00.000+0000',
      [AC_FIELDS.acId]: 'AC-1',
      [AC_FIELDS.statement]: 'unit tests pass',
      [AC_FIELDS.kind]: sel('Deterministic', '10024'),
      [AC_FIELDS.evidenceKind]: sel('Test', '10026'),
      [AC_FIELDS.verification]: sel('UNVERIFIED', '10038'),
    },
  };
}

const READER_PERMS = { BROWSE_PROJECTS: true, EDIT_ISSUES: false, TRANSITION_ISSUES: false, CREATE_ISSUES: false, DELETE_ISSUES: false, ADMINISTER_PROJECTS: false, ADMINISTER: false };

class ReaderWorld {
  stories: JiraIssue[] = [];
  readonly calls: string[] = [];
  query(): JiraQuery {
    return {
      getStory: async (key) => {
        this.calls.push(`getStory ${key}`);
        const s = this.stories.find((x) => x.key === key);
        return s ? JSON.parse(JSON.stringify(s)) : null;
      },
      listAcceptanceCriteria: async (key) => {
        this.calls.push(`listAcs ${key}`);
        return [acIssue(`OMNI-${Number(key.slice(5)) + 100}`, key)];
      },
    };
  }
  client(c: JiraCredentials): JiraClient & JiraPermissionProbe {
    const world = this;
    return {
      async getMyPermissions() {
        return c.token === READER_TOKEN ? { ...READER_PERMS } : {};
      },
      async getIssue() {
        world.calls.push('getIssue');
        throw new Error('unexpected');
      },
      async updateAdvisoryFields() {
        world.calls.push('WRITE');
        throw new Error('intake must never write through the advisory client');
      },
    };
  }
}

// ---------------------------------------------------------------- fake Jira (human apply side, behind the real client)

interface ApplyServer {
  requests: Array<{ method: string; path: string; body: Record<string, unknown> | null }>;
  fetchImpl: typeof fetch;
  issues: Map<string, { type: string; fields: Record<string, unknown> }>;
}

interface ApplyServerOpts {
  accountType?: string;
  perms?: Record<string, boolean>;
  storyForm?: Array<{ fieldId: string; name: string; required?: boolean }>;
  acForm?: Array<{ fieldId: string; name: string; required?: boolean }>;
}

const DEFAULT_STORY_FORM = STORY_CREATE_FIELDS.filter((f) => f !== 'project' && f !== 'issuetype').map((fieldId) => ({ fieldId, name: fieldId }));
const DEFAULT_AC_FORM = AC_CREATE_FIELDS.filter((f) => f !== 'project' && f !== 'issuetype').map((fieldId) => ({ fieldId, name: fieldId }));

function applyServer(opts: ApplyServerOpts = {}): ApplyServer {
  const requests: ApplyServer['requests'] = [];
  const issues = new Map<string, { type: string; fields: Record<string, unknown> }>();
  let next = 200;
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const u = new URL(url);
    const p = u.pathname.replace(/^\/ex\/jira\/[^/]+/, '');
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    requests.push({ method: String(init.method), path: `${p}${u.search}`, body });
    if (p === '/rest/api/3/myself') return json(200, { accountId: 'acc-human-1', accountType: opts.accountType ?? 'atlassian', active: true, displayName: 'Test Human' });
    if (p === '/rest/api/3/mypermissions') {
      const perms = opts.perms ?? { BROWSE_PROJECTS: true, CREATE_ISSUES: true };
      return json(200, { permissions: Object.fromEntries(Object.entries(perms).map(([k, v]) => [k, { havePermission: v }])) });
    }
    const cm = /\/rest\/api\/3\/issue\/createmeta\/OMNI\/issuetypes\/(\d+)$/.exec(p);
    if (cm) {
      const form = (cm[1] === '10005' ? opts.storyForm ?? DEFAULT_STORY_FORM : opts.acForm ?? DEFAULT_AC_FORM).map((f) => ({ required: false, hasDefaultValue: false, ...f }));
      return json(200, { fields: form, total: form.length });
    }
    if (p === '/rest/api/3/search/jql') {
      const jql = u.searchParams.get('jql') ?? '';
      const label = /labels = "([^"]+)"/.exec(jql)?.[1];
      const parent = /parent = (OMNI-\d+)/.exec(jql)?.[1];
      const keys = [...issues.entries()]
        .filter(([, v]) => (label ? v.type === 'story' && (v.fields.labels as string[]).includes(label) : v.type === 'ac' && (v.fields.parent as { key: string }).key === parent))
        .map(([k]) => ({ key: k }));
      return json(200, { issues: keys, isLast: true });
    }
    const gi = /\/rest\/api\/2\/issue\/(OMNI-\d+)$/.exec(p);
    if (gi && init.method === 'GET') {
      const it = issues.get(gi[1]);
      return it ? json(200, { key: gi[1], fields: it.fields }) : json(404, {});
    }
    if (p === '/rest/api/2/issue' && init.method === 'POST') {
      const fields = (body as { fields: Record<string, unknown> }).fields;
      const key = `OMNI-${next++}`;
      issues.set(key, { type: (fields.issuetype as { id: string }).id === '10005' ? 'story' : 'ac', fields });
      return json(201, { key });
    }
    return json(500, {});
  }) as unknown as typeof fetch;
  return { requests, fetchImpl, issues };
}

// ---------------------------------------------------------------- harness

interface Ctx {
  reader: ReaderWorld;
  env: Record<string, string>;
  home: string;
  projects: string;
  live: LiveSession[];
  transport: jest.Mock;
  server: ApplyServer;
  interactive: boolean;
  typed: string | null;
  prompts: number;
  deps: Partial<GovDeps>;
}

function makeCtx(server: ApplyServer = applyServer()): Ctx {
  const reader = new ReaderWorld();
  const home = path.join(tmp('gov-intake-home-'), 'gov');
  const projects = tmp('gov-intake-projects-');
  const transport = jest.fn((): JevTransport => {
    throw new Error('JEV must not be reached from intake');
  });
  const ctx: Ctx = {
    reader,
    home,
    projects,
    live: [],
    transport,
    server,
    interactive: true,
    typed: null,
    prompts: 0,
    env: { GOV_HOME: home, CLAUDE_PROJECTS_DIR: projects, JEV_JIRA_IDENTITY: 'reader', JEV_READER_TOKEN: READER_TOKEN, GOV_INTAKE_EMAIL: HUMAN_EMAIL, GOV_INTAKE_TOKEN: HUMAN_TOKEN },
    deps: {},
  };
  ctx.deps = {
    jiraQuery: jest.fn(() => reader.query()),
    jiraClient: jest.fn((c: JiraCredentials) => reader.client(c)),
    transport,
    registry: REGISTRY,
    now: () => FIXED,
    newSessionId: () => SID2,
    intakeProbe: createIntakeProbe(),
    liveSessions: () => ctx.live,
    intakeReader: () => ({
      searchActiveStories: async () => {
        reader.calls.push('searchActiveStories');
        return JSON.parse(JSON.stringify(reader.stories));
      },
    }),
    intakeJira: (c) => createIntakeJira({ credentials: c, fetchImpl: ctx.server.fetchImpl }),
    intakeRules: () => RULES,
    isInteractive: () => ctx.interactive,
    prompt: async () => {
      ctx.prompts += 1;
      return ctx.typed ?? '';
    },
  };
  return ctx;
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
  return { code, out, err, result: line ? JSON.parse(line.slice('GOV_RESULT '.length)) : (null as unknown as Record<string, unknown>) };
}

function writeTranscript(ctx: Ctx, sid: string, cwd: string): void {
  const d = path.join(ctx.projects, 'C--some-project');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, `${sid}.jsonl`), `${JSON.stringify({ type: 'user', sessionId: sid, cwd, gitBranch: 'feature/x' })}\n`);
}

const auditLines = (ctx: Ctx) => {
  const f = path.join(ctx.home, 'intake', 'audit.jsonl');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>) : [];
};

/** Proposal for a clean repo with a committed src change and no Story. */
async function newWorkProposal(ctx: Ctx): Promise<{ r: string; hash: string }> {
  const r = repo({ 'src/feature.ts': 'export const f = 1;\n' });
  const out = await gov(ctx, ['intake', '--worktree', r, '--base', 'main', '--intent', 'Build the feature']);
  expect(out.result.classification).toBe('NEW_WORK');
  return { r, hash: out.result.proposal_hash as string };
}

// ================================================================ 1–9: classification (CLI, real git)

describe('gov intake — classification', () => {
  it('1. NEW_WORK: proposes a Story + deterministic ACs and creates nothing', async () => {
    const ctx = makeCtx();
    const { r, hash } = await newWorkProposal(ctx);
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    const stored = JSON.parse(fs.readFileSync(path.join(ctx.home, 'intake', 'proposals', `${hash.slice(7)}.json`), 'utf8'));
    expect(stored.label).toBe(intakeLabel(hash as `sha256:${string}`));
    expect(stored.proposal.story.authorized_paths).toEqual(['src/**']);
    expect(stored.proposal.story.verification_requirements).toEqual(['t.pass', 't.types']);
    expect(stored.proposal.story.prohibited_paths).toEqual(expect.arrayContaining(['supabase/migrations/**', '.env*', '.claude/settings*.json']));
    expect(stored.proposal.acceptance_criteria.map((a: { ac_id: string; kind: string; evidence_kind: string }) => [a.ac_id, a.kind, a.evidence_kind])).toEqual([
      ['AC-1', 'Deterministic', 'Test'],
      ['AC-2', 'Deterministic', 'Typecheck'],
    ]);
    expect(ctx.server.requests).toEqual([]); // nothing in Jira
    expect(readBindings(govLayout(ctx.env))).toEqual([]); // nothing bound
    expect(sh(r, 'rev-list', '--all', '--count')).toBe('2'); // nothing committed
    expect(auditLines(ctx).map((a) => [a.event, a.classification, a.proposal_hash])).toEqual([['classify', 'NEW_WORK', hash]]);
    // Deterministic: the same inputs give the same proposal hash.
    const again = await gov(ctx, ['intake', '--worktree', r, '--base', 'main', '--intent', 'Build the feature']);
    expect(again.result.proposal_hash).toBe(hash);
  });

  it('1b. NEW_WORK with judgment ACs and explicit scope on an untouched branch', async () => {
    const ctx = makeCtx();
    const r = repo();
    const out = await gov(ctx, ['intake', '--worktree', r, '--base', 'main', '--intent', 'New work', '--authorized', 'src/**', '--verification', 't.pass', '--judgment-ac', 'Easy to review']);
    expect(out.code).toBe(0);
    const stored = JSON.parse(fs.readFileSync(path.join(ctx.home, 'intake', 'proposals', `${(out.result.proposal_hash as string).slice(7)}.json`), 'utf8'));
    expect(stored.proposal.acceptance_criteria.map((a: { kind: string; evidence_kind: string }) => [a.kind, a.evidence_kind])).toEqual([
      ['Deterministic', 'Test'],
      ['Judgment', 'Manual'],
    ]);
  });

  it('2. EXISTING_STORY: a matching active Story is reused, never duplicated', async () => {
    const ctx = makeCtx();
    ctx.reader.stories = [storyIssue(STORY, 'src/**')];
    const r = repo({ 'src/feature.ts': 'x\n' });
    const out = await gov(ctx, ['intake', '--worktree', r, '--base', 'main']);
    expect(out.code).toBe(0);
    expect(out.result.classification).toBe('EXISTING_STORY');
    expect(out.result.story).toBe(STORY);
    expect(out.result.proposal_hash).toBeUndefined();
    expect(fs.existsSync(path.join(ctx.home, 'intake', 'proposals'))).toBe(false);
    expect(ctx.server.requests).toEqual([]);
  });

  it('3+4. a dirty worktree is PRE_GOVERNANCE_ADOPTION and stays byte/state identical', async () => {
    const ctx = makeCtx();
    const r = repo({ 'src/a.ts': 'a\n' });
    write(r, 'src/a.ts', 'a changed\n');
    write(r, 'src/new.ts', 'untracked\n');
    sh(r, 'add', 'src/a.ts'); // staged too
    write(r, 'src/a.ts', 'a changed again\n');
    writeTranscript(ctx, SID, 'C:\\virality');
    const before = snapshot(r);
    const out = await gov(ctx, ['intake', '--worktree', r, '--base', 'main', '--session', SID]);
    expect(out.code).toBe(0);
    expect(out.result.classification).toBe('PRE_GOVERNANCE_ADOPTION');
    expect(out.result.clean).toBe(false);
    expect(out.out.join('\n')).toContain('src/new.ts');
    expect(snapshot(r)).toBe(before);
    expect(readBindings(govLayout(ctx.env))).toEqual([]);
  });

  it('5+6. human baseline + intake --bind gives PRE_GOVERNANCE_ADOPTION_BASELINE; re-running is idempotent', async () => {
    const ctx = makeCtx();
    ctx.reader.stories = [storyIssue(STORY, 'src/**')];
    const r = repo({ 'src/a.ts': 'a\n' });
    write(r, 'src/a.ts', 'dirty\n');
    writeTranscript(ctx, SID, r);
    const adopt = await gov(ctx, ['intake', '--worktree', r, '--base', 'main', '--session', SID]);
    expect(adopt.result.classification).toBe('PRE_GOVERNANCE_ADOPTION');
    expect(adopt.result.story).toBe(STORY);
    expect(adopt.out.join('\n')).toContain(`Governed-By: ${STORY}`);
    // The human makes the baseline commit (intake never does).
    const baseline = commit(r, {}, `Governed-By: ${STORY}`);
    const bound = await gov(ctx, ['intake', '--worktree', r, '--base', 'main', '--session', SID, '--story', STORY, '--bind']);
    expect(bound.code).toBe(0);
    const ledger = readBindings(govLayout(ctx.env));
    expect(ledger).toHaveLength(1);
    expect(ledger[0].adoption).toEqual({ baseline_commit: baseline, classification: ADOPTION_CLASSIFICATION });
    expect(ledger[0].session_id).toBe(SID);
    // 6. idempotent resume: no second binding, Story or baseline.
    for (const extra of [[], ['--bind'], ['--session', SID]]) {
      const again = await gov(ctx, ['intake', '--worktree', r, '--base', 'main', ...extra]);
      expect(again.code).toBe(0);
      expect(again.result.classification).toBe('GOVERNED_RESUME');
    }
    expect(readBindings(govLayout(ctx.env))).toHaveLength(1);
    expect(sh(r, 'rev-parse', 'HEAD')).toBe(baseline);
    expect(ctx.server.requests).toEqual([]);
    expect(auditLines(ctx).some((a) => a.event === 'bind' && a.adoption_classification === ADOPTION_CLASSIFICATION)).toBe(true);
  });

  it('7. two Stories covering the work fail closed (AMBIGUOUS_STORY)', async () => {
    const ctx = makeCtx();
    ctx.reader.stories = [storyIssue(STORY, 'src/**'), storyIssue(OTHER_STORY, 'src/*.ts')];
    const r = repo({ 'src/a.ts': 'a\n' });
    const out = await gov(ctx, ['intake', '--worktree', r, '--base', 'main']);
    expect(out.code).toBe(GOV_EXIT.REFUSED);
    expect(out.result.refusal).toBe('AMBIGUOUS_STORY');
    expect(auditLines(ctx).map((a) => a.refusal)).toEqual(['AMBIGUOUS_STORY']);
  });

  it('8. two live sessions claiming one worktree fail closed (DUPLICATE_SESSION)', async () => {
    const ctx = makeCtx();
    const r = repo({ 'src/a.ts': 'a\n' });
    ctx.live = [
      { session_id: SID, cwd: r, status: 'busy', pid: 1 },
      { session_id: SID2, cwd: r.replace(/\\/g, '/').toUpperCase(), status: 'busy', pid: 2 },
    ];
    const out = await gov(ctx, ['intake', '--worktree', r, '--base', 'main', '--intent', 'x']);
    expect(out.result.refusal).toBe('DUPLICATE_SESSION');
    writeTranscript(ctx, SID, r);
    const withSession = await gov(ctx, ['intake', '--worktree', r, '--base', 'main', '--intent', 'x', '--session', SID]);
    expect(withSession.result.refusal).toBe('DUPLICATE_SESSION');
  });

  it('9. a session already bound to another Story fails closed (SESSION_BOUND_ELSEWHERE)', async () => {
    const ctx = makeCtx();
    const r = repo({ 'src/a.ts': 'a\n' });
    writeTranscript(ctx, SID, r);
    bindSession(govLayout(ctx.env), { story_key: OTHER_STORY, packet_hash: `sha256:${'c'.repeat(64)}`, session_id: SID, mode: 'new', worktree: 'C:/elsewhere', branch: 'b', base_commit: C1, session_file: null }, () => FIXED);
    const out = await gov(ctx, ['intake', '--worktree', r, '--base', 'main', '--intent', 'x', '--session', SID]);
    expect(out.result.refusal).toBe('SESSION_BOUND_ELSEWHERE');
  });

  it('16. a prohibited path fails closed', async () => {
    const ctx = makeCtx();
    const r = repo({ 'supabase/migrations/1_x.sql': 'select 1;\n' });
    const out = await gov(ctx, ['intake', '--worktree', r, '--base', 'main', '--intent', 'x']);
    expect(out.result.refusal).toBe('PROHIBITED_PATH_TOUCHED');
  });

  it('16b. a default-prohibited path fails closed even when an existing Story would authorize it', async () => {
    const ctx = makeCtx();
    ctx.reader.stories = [storyIssue(STORY, 'supabase/**\nsrc/**')];
    const r = repo({ 'supabase/migrations/1_x.sql': 'select 1;\n' });
    const out = await gov(ctx, ['intake', '--worktree', r, '--base', 'main']);
    expect(out.result.refusal).toBe('PROHIBITED_PATH_TOUCHED');
    expect(classifyIntake(input({ state: state({ changed_since_base: ['.env.local'] }), activeStories: [cand(STORY, ['*'])] }))).toMatchObject({ code: 'PROHIBITED_PATH_TOUCHED' });
  });

  it('17. no registry id for the changed paths fails closed', async () => {
    const ctx = makeCtx();
    const r = repo({ 'docs/notes.md': 'n\n' });
    const out = await gov(ctx, ['intake', '--worktree', r, '--base', 'main', '--intent', 'x']);
    expect(out.result.refusal).toBe('NO_REGISTRY_ID');
    const unknown = await gov(ctx, ['intake', '--worktree', r, '--base', 'main', '--intent', 'x', '--verification', 'no.such.id']);
    expect(unknown.result.refusal).toBe('NO_REGISTRY_ID');
  });

  it('dirty work with no owning session fails closed (AMBIGUOUS_OWNERSHIP)', async () => {
    const ctx = makeCtx();
    const r = repo();
    write(r, 'src/a.ts', 'a\n');
    const out = await gov(ctx, ['intake', '--worktree', r, '--base', 'main']);
    expect(out.result.refusal).toBe('AMBIGUOUS_OWNERSHIP');
  });
});

// ================================================================ pure classifier rules

function state(over: Partial<WorktreeState> = {}): WorktreeState {
  return { worktree: 'C:/w', branch: 'feature/x', head: C2, clean: true, dirty_files: [], base_ref: 'main', merge_base: C1, changed_since_base: ['src/a.ts'], ...over };
}

function input(over: Partial<IntakeInput> = {}): IntakeInput {
  return {
    state: state(),
    bindingsForWorktree: [],
    resumeCheck: null,
    sessionId: null,
    sessionBoundStory: null,
    liveSessions: [],
    explicitStoryKey: null,
    explicitStory: null,
    activeStories: [],
    options: { intent: 'Work', authorized: [], prohibited: [], verification: [], judgmentAcs: [] },
    rules: RULES,
    registry: REGISTRY,
    ...over,
  };
}

const cand = (key: string, authorized: string[], prohibited: string[] = []): StoryCandidate => ({ key, summary: key, authorized_paths: authorized, prohibited_paths: prohibited });

function binding(story: string, session = SID) {
  return { schema: 'gov-binding/1' as const, governance_version: 'gov-flow/1' as const, story_key: story, packet_hash: `sha256:${'d'.repeat(64)}` as `sha256:${string}`, session_id: session, mode: 'new' as const, worktree: 'C:/w', branch: 'feature/x', base_commit: C1, bound_at: FIXED.toISOString(), session_file: null };
}

describe('classifyIntake — first-match order and fail-closed rules', () => {
  it('GOVERNED_RESUME beats everything, even a dirty tree and a prohibited change', () => {
    const d = classifyIntake(input({ state: state({ clean: false, dirty_files: ['supabase/migrations/x.sql'] }), bindingsForWorktree: [binding(STORY)], resumeCheck: { packetIntact: true, descends: true }, activeStories: [cand(OTHER_STORY, ['**'])] }));
    expect(d.kind).toBe('GOVERNED_RESUME');
  });

  it('an invalid binding (packet or ancestry) or two Stories on one worktree is CONFLICTING_BINDINGS', () => {
    expect(classifyIntake(input({ bindingsForWorktree: [binding(STORY)], resumeCheck: { packetIntact: false, descends: true } }))).toMatchObject({ code: 'CONFLICTING_BINDINGS' });
    expect(classifyIntake(input({ bindingsForWorktree: [binding(STORY)], resumeCheck: { packetIntact: true, descends: false } }))).toMatchObject({ code: 'CONFLICTING_BINDINGS' });
    expect(classifyIntake(input({ bindingsForWorktree: [binding(STORY), binding(OTHER_STORY)], resumeCheck: { packetIntact: true, descends: true } }))).toMatchObject({ code: 'CONFLICTING_BINDINGS' });
    expect(classifyIntake(input({ bindingsForWorktree: [binding(STORY)], resumeCheck: { packetIntact: true, descends: true }, explicitStoryKey: OTHER_STORY }))).toMatchObject({ code: 'CONFLICTING_BINDINGS' });
    expect(classifyIntake(input({ bindingsForWorktree: [binding(STORY)], resumeCheck: { packetIntact: true, descends: true }, sessionId: SID2 }))).toMatchObject({ code: 'DUPLICATE_SESSION' });
  });

  it('EXISTING_STORY needs a clean tree; the same Story on a dirty tree is adoption', () => {
    const s = cand(STORY, ['src/**']);
    expect(classifyIntake(input({ activeStories: [s] })).kind).toBe('EXISTING_STORY');
    const dirty = classifyIntake(input({ state: state({ clean: false, dirty_files: ['src/b.ts'] }), activeStories: [s], sessionId: SID }));
    expect(dirty).toMatchObject({ kind: 'PRE_GOVERNANCE_ADOPTION', proposal: null });
  });

  it('NEW_WORK only when no Story fits; adoption proposals carry the owner session', () => {
    expect(classifyIntake(input()).kind).toBe('NEW_WORK');
    const d = classifyIntake(input({ state: state({ clean: false, dirty_files: ['src/b.ts'] }), sessionId: SID, options: { intent: null, authorized: [], prohibited: [], verification: [], judgmentAcs: [] } }));
    expect(d).toMatchObject({ kind: 'PRE_GOVERNANCE_ADOPTION' });
    if (d.kind === 'PRE_GOVERNANCE_ADOPTION') expect(d.proposal?.session_id).toBe(SID);
  });

  it('a live session whose cwd is the worktree owns uncommitted work when it is the only claimant', () => {
    const d = classifyIntake(input({ state: state({ clean: false, dirty_files: ['src/b.ts'] }), liveSessions: [{ session_id: SID, cwd: 'c:\\w', status: 'busy', pid: 1 }] }));
    expect(d).toMatchObject({ kind: 'PRE_GOVERNANCE_ADOPTION', owner: SID });
  });

  it('partial scope, explicit-Story scope gaps and Story-prohibited paths fail closed', () => {
    expect(classifyIntake(input({ state: state({ changed_since_base: ['src/a.ts', 'lib/b.ts'] }), activeStories: [cand(STORY, ['src/**'])] }))).toMatchObject({ code: 'PARTIAL_SCOPE_MATCH' });
    expect(classifyIntake(input({ explicitStoryKey: STORY, explicitStory: cand(STORY, ['lib/**']) }))).toMatchObject({ code: 'PARTIAL_SCOPE_MATCH' });
    expect(classifyIntake(input({ activeStories: [cand(STORY, ['src/**'], ['src/a.ts'])] }))).toMatchObject({ code: 'PROHIBITED_PATH_TOUCHED' });
    expect(classifyIntake(input({ explicitStoryKey: STORY, explicitStory: null }))).toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('new work needs an intent, establishable Authorized Paths and registry coverage', () => {
    const none = { intent: null, authorized: [], prohibited: [], verification: [], judgmentAcs: [] };
    expect(classifyIntake(input({ options: none }))).toMatchObject({ code: 'INTENT_REQUIRED' });
    expect(classifyIntake(input({ state: state({ changed_since_base: [] }) }))).toMatchObject({ code: 'AUTHORIZED_PATHS_UNKNOWN' });
    expect(classifyIntake(input({ options: { ...none, intent: 'x', authorized: ['lib/**'] } }))).toMatchObject({ code: 'AUTHORIZED_PATHS_UNKNOWN' });
    expect(classifyIntake(input({ state: state({ changed_since_base: [] }), options: { ...none, intent: 'x', authorized: ['src/**'] } }))).toMatchObject({ code: 'NO_REGISTRY_ID' });
    expect(classifyIntake(input({ options: { ...none, intent: 'x', prohibited: ['../x'] } }))).toMatchObject({ code: 'INVALID_INPUT' });
    expect(classifyIntake(input({ options: { ...none, intent: 'x', prohibited: ['src/**'] } }))).toMatchObject({ code: 'PROHIBITED_PATH_TOUCHED' });
  });

  it('derives Authorized Paths without authorizing broad directories wholesale', () => {
    expect(deriveAuthorizedPaths(['src/a/b.ts', 'src/a/c.ts', 'backend/services/x.ts', 'README.md', 'scripts/jev-flow/y.ts'])).toEqual([
      'README.md',
      'backend/services/x.ts',
      'scripts/jev-flow/**',
      'src/a/**',
    ]);
  });

  it('the shipped intake-rules.json validates against the shipped registry and prohibits the protected areas', () => {
    const rules = loadIntakeRules(loadRegistry());
    for (const p of ['supabase/migrations/**', '.claude/settings*.json', '.env*', 'vercel.json', 'railway.json', '.github/workflows/**']) expect(rules.default_prohibited_paths).toContain(p);
    expect(() => validateIntakeRules({ ...rules, verification_mappings: [{ paths: ['x/**'], registry_ids: ['no.such'] }] }, loadRegistry())).toThrow(/unknown registry id/);
  });
});

// ================================================================ 10–15, 19–20: --apply (human identity)

describe('gov intake --apply — human-applied creation', () => {
  it('creates the Story + ACs with allowlisted fields only; re-applying is idempotent on the label', async () => {
    const ctx = makeCtx();
    const { hash } = await newWorkProposal(ctx);
    ctx.typed = hash;
    const out = await gov(ctx, ['intake', '--apply', hash]);
    expect(out.code).toBe(0);
    expect(out.result.story).toBe('OMNI-200');
    expect(out.result.created_acs).toEqual(['OMNI-201', 'OMNI-202']);
    const posts = ctx.server.requests.filter((r) => r.method === 'POST');
    expect(posts).toHaveLength(3);
    // 20. protected fields are never sent; only POST /rest/api/2/issue writes.
    for (const p of posts) {
      expect(p.path).toBe('/rest/api/2/issue');
      const keys = Object.keys((p.body as { fields: Record<string, unknown> }).fields);
      for (const k of keys) expect(GATE_FIELD_IDS).not.toContain(k);
      const allowed = ((p.body as { fields: { issuetype: { id: string } } }).fields.issuetype.id === '10005' ? STORY_CREATE_FIELDS : AC_CREATE_FIELDS) as readonly string[];
      for (const k of keys) expect(allowed).toContain(k);
    }
    expect(ctx.server.requests.every((r) => r.method === 'GET' || r.method === 'POST')).toBe(true);
    expect(ctx.server.requests.some((r) => /transition/i.test(r.path))).toBe(false);
    const story = ctx.server.issues.get('OMNI-200')!;
    expect(story.fields.labels).toEqual([intakeLabel(hash as `sha256:${string}`)]);
    expect(ctx.transport).not.toHaveBeenCalled();
    const applied = auditLines(ctx).filter((a) => a.event === 'apply');
    expect(applied).toHaveLength(1);
    expect(applied[0]).toMatchObject({ story_key: 'OMNI-200', created_acs: ['OMNI-201', 'OMNI-202'], approved_by: { account_id: 'acc-human-1', display_name: 'Test Human' } });
    expect(JSON.stringify(auditLines(ctx))).not.toContain(HUMAN_TOKEN);

    const again = await gov(ctx, ['intake', '--apply', hash]);
    expect(again.code).toBe(0);
    expect(again.result.story).toBe('OMNI-200');
    expect(again.result.created_acs).toEqual([]);
    expect(again.result.reused_acs).toEqual(['OMNI-201', 'OMNI-202']);
    expect(ctx.server.requests.filter((r) => r.method === 'POST')).toHaveLength(3);
  });

  it('re-applying after a partial run creates only the missing ACs', async () => {
    const ctx = makeCtx();
    const { hash } = await newWorkProposal(ctx);
    ctx.typed = hash;
    expect((await gov(ctx, ['intake', '--apply', hash])).code).toBe(0);
    ctx.server.issues.delete('OMNI-202');
    const again = await gov(ctx, ['intake', '--apply', hash]);
    expect(again.result.created_acs).toEqual(['OMNI-203']);
    expect(again.result.reused_acs).toEqual(['OMNI-201']);
  });

  it('10. missing Create permission fails closed before any write', async () => {
    const ctx = makeCtx(applyServer({ perms: { BROWSE_PROJECTS: true, CREATE_ISSUES: false } }));
    const { hash } = await newWorkProposal(ctx);
    ctx.typed = hash;
    const out = await gov(ctx, ['intake', '--apply', hash]);
    expect(out.code).toBe(GOV_EXIT.REFUSED);
    expect(ctx.server.requests.some((r) => r.method === 'POST')).toBe(false);
  });

  it('11. a service account fails closed (by accountType, and by email before any request)', async () => {
    const ctx = makeCtx(applyServer({ accountType: 'app' }));
    const { hash } = await newWorkProposal(ctx);
    ctx.typed = hash;
    const out = await gov(ctx, ['intake', '--apply', hash]);
    expect(out.code).toBe(GOV_EXIT.REFUSED);
    expect(ctx.server.requests.some((r) => r.method === 'POST')).toBe(false);

    const ctx2 = makeCtx();
    const p2 = await newWorkProposal(ctx2);
    ctx2.typed = p2.hash;
    ctx2.env.GOV_INTAKE_EMAIL = 'svc-gov@serviceaccount.atlassian.com';
    expect((await gov(ctx2, ['intake', '--apply', p2.hash])).code).toBe(GOV_EXIT.REFUSED);
    ctx2.env.GOV_INTAKE_EMAIL = HUMAN_EMAIL;
    ctx2.env.GOV_INTAKE_TOKEN = READER_TOKEN; // a service token in the human slot
    expect((await gov(ctx2, ['intake', '--apply', p2.hash])).code).toBe(GOV_EXIT.REFUSED);
    expect(ctx2.server.requests).toEqual([]);
    expect(ctx2.prompts).toBe(0);
  });

  it('12. non-interactive --apply fails closed without prompting or calling Jira', async () => {
    const ctx = makeCtx();
    const { hash } = await newWorkProposal(ctx);
    ctx.typed = hash;
    ctx.interactive = false;
    const out = await gov(ctx, ['intake', '--apply', hash]);
    expect(out.code).toBe(GOV_EXIT.REFUSED);
    expect(ctx.prompts).toBe(0);
    expect(ctx.server.requests).toEqual([]);
  });

  it('13. a wrong typed hash fails closed before any Jira call', async () => {
    const ctx = makeCtx();
    const { hash } = await newWorkProposal(ctx);
    for (const typed of [hash.slice(0, 20), hash.replace(/.$/, (c) => (c === '0' ? '1' : '0')), hash.slice(7), '']) {
      ctx.typed = typed;
      expect((await gov(ctx, ['intake', '--apply', hash])).code).toBe(GOV_EXIT.REFUSED);
    }
    expect(ctx.server.requests).toEqual([]);
  });

  it('a tampered stored proposal is INTEGRITY_FAILED', async () => {
    const ctx = makeCtx();
    const { hash } = await newWorkProposal(ctx);
    const f = path.join(ctx.home, 'intake', 'proposals', `${hash.slice(7)}.json`);
    const stored = JSON.parse(fs.readFileSync(f, 'utf8'));
    stored.proposal.story.authorized_paths = ['**'];
    fs.writeFileSync(f, JSON.stringify(stored));
    ctx.typed = hash;
    expect((await gov(ctx, ['intake', '--apply', hash])).code).toBe(GOV_EXIT.INTEGRITY_FAILED);
    // A consistent forgery (content + label rewritten for the new content) is still refused.
    stored.label = intakeLabel(canonicalHash(stored.proposal));
    fs.writeFileSync(f, JSON.stringify(stored));
    expect((await gov(ctx, ['intake', '--apply', hash])).code).toBe(GOV_EXIT.INTEGRITY_FAILED);
    expect(ctx.server.requests).toEqual([]);
  });

  it('14. a disallowed Jira field is refused before it is sent', async () => {
    const server = applyServer();
    const client = createIntakeJira({ credentials: { mode: 'basic', email: HUMAN_EMAIL, token: HUMAN_TOKEN }, fetchImpl: server.fetchImpl });
    for (const bad of [AC_FIELDS.verification, AC_FIELDS.deterministicResult, AC_FIELDS.jevVerdict, STORY_FIELDS.gateResult, 'status', 'assignee']) {
      await expect(client.createIssue('ac', { summary: 's', [bad]: 'x' })).rejects.toThrow(/allowlist/);
      expect(() => assertIntakeFields('story', { summary: 's', [bad]: 'x' })).toThrow(/allowlist/);
    }
    expect(server.requests).toEqual([]);
  });

  it('15. a gate field on a create form fails closed and nothing is created', async () => {
    for (const gate of [
      { fieldId: STORY_FIELDS.gateResult, name: 'Gate Result' },
      { fieldId: 'customfield_19999', name: 'Deployment Authorized By' },
      { fieldId: AC_FIELDS.verification, name: 'Verification' },
    ]) {
      const ctx = makeCtx(applyServer({ storyForm: [...DEFAULT_STORY_FORM, gate] }));
      const { hash } = await newWorkProposal(ctx);
      ctx.typed = hash;
      const out = await gov(ctx, ['intake', '--apply', hash]);
      expect(out.code).toBe(GOV_EXIT.REFUSED);
      expect(ctx.server.requests.some((r) => r.method === 'POST')).toBe(false);
    }
    expect(createFormProblems('story', [...DEFAULT_STORY_FORM, { fieldId: 'customfield_1', name: 'Verification Requirements', required: false, hasDefaultValue: false }].map((f) => ({ required: false, hasDefaultValue: false, ...f })), ['summary'])).toEqual([]);
    const problems = createFormProblems('ac', [{ fieldId: 'customfield_9', name: 'Risk', required: true, hasDefaultValue: false }], ['summary']);
    expect(problems).toHaveLength(2);
    expect(problems.some((p) => /required field "Risk"/.test(p))).toBe(true);
    expect(problems.some((p) => /summary is not on the ac create form/.test(p))).toBe(true);
  });

  it('19. intake has no transition / edit / delete route', () => {
    expect(INTAKE_ROUTES.every((r) => !/transition/i.test(r.re.source))).toBe(true);
    for (const [m, p] of [
      ['POST', '/rest/api/2/issue/OMNI-1/transitions'],
      ['POST', '/rest/api/3/issue/OMNI-1/transitions'],
      ['PUT', '/rest/api/2/issue/OMNI-1'],
      ['DELETE', '/rest/api/2/issue/OMNI-1'],
      ['POST', '/rest/api/2/issue/OMNI-1/comment'],
      ['PUT', '/rest/api/2/issue/OMNI-1/assignee'],
      ['POST', '/rest/api/2/issueLink'],
    ]) {
      expect(routeAllowed(m, p)).toBe(false);
    }
    expect(routeAllowed('POST', '/rest/api/2/issue')).toBe(true);
  });

  it('resolveIntakeCredentials refuses provisioning / reader / advisory tokens and service accounts', () => {
    expect(resolveIntakeCredentials({ GOV_INTAKE_EMAIL: HUMAN_EMAIL, GOV_INTAKE_TOKEN: HUMAN_TOKEN }).ok).toBe(true);
    expect(resolveIntakeCredentials({}).ok).toBe(false);
    for (const env of ['JIRA_PROVISION_TOKEN', 'JEV_READER_TOKEN', 'JEV_ADVISORY_TOKEN']) {
      expect(resolveIntakeCredentials({ GOV_INTAKE_EMAIL: HUMAN_EMAIL, GOV_INTAKE_TOKEN: HUMAN_TOKEN, [env]: HUMAN_TOKEN }).ok).toBe(false);
    }
    expect(resolveIntakeCredentials({ GOV_INTAKE_EMAIL: 'x@SERVICEACCOUNT.atlassian.com', GOV_INTAKE_TOKEN: HUMAN_TOKEN }).ok).toBe(false);
  });
});

// ================================================================ 18: JEV boundary + probes

const FORBIDDEN_FROM_INTAKE = [
  'scripts/jev-bjc/provider.ts',
  'scripts/jev-bjc/judge.ts',
  'scripts/jev-bjc/combiner.ts',
  'scripts/jev-bjc/questions.ts',
  'scripts/jev-bjc/cli.ts',
  'scripts/jev-flow/judgeFlow.ts',
  'scripts/jev-flow/cli.ts',
  'scripts/jev-jira/orchestrator.ts',
  'scripts/jev-jira/writeback.ts',
  'scripts/jev-jira/context.ts',
  'scripts/jev-jira/cli.ts',
];
const REPO = path.resolve(__dirname, '../../..');

function importClosure(entry: string): Set<string> {
  const seen = new Set<string>();
  const visit = (file: string) => {
    const rel = path.relative(REPO, file).replace(/\\/g, '/');
    if (seen.has(rel)) return;
    seen.add(rel);
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/(?:import|export)[^'"]*?from\s+['"](\.[^'"]+)['"]|require\(\s*['"](\.[^'"]+)['"]\s*\)|import\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
      const spec = m[1] ?? m[2] ?? m[3];
      const base = path.resolve(path.dirname(file), spec);
      const hit = [`${base}.ts`, path.join(base, 'index.ts'), base].find((f) => fs.existsSync(f) && fs.statSync(f).isFile());
      if (hit && hit.endsWith('.ts')) visit(hit);
    }
  };
  visit(path.join(REPO, entry));
  return seen;
}

describe('JEV stays explicit-only — intake cannot reach it', () => {
  it('18. no intake module transitively imports JEV, BJC judgment, the write-back, the orchestrator or the gov CLI', () => {
    for (const entry of ['scripts/jev-flow/intake.ts', 'scripts/jev-flow/intakeJira.ts', 'scripts/jev-flow/intakeProbe.ts']) {
      const closure = importClosure(entry);
      for (const f of FORBIDDEN_FROM_INTAKE) expect({ entry, reaches: f, reached: closure.has(f) }).toEqual({ entry, reaches: f, reached: false });
      for (const f of closure) {
        const src = fs.readFileSync(path.join(REPO, f), 'utf8');
        expect({ f, spawnsClaude: /spawn\(\s*['"]claude/.test(src) }).toEqual({ f, spawnsClaude: false });
      }
    }
    for (const f of ['scripts/jev-flow/intake.ts', 'scripts/jev-flow/intakeJira.ts', 'scripts/jev-flow/intakeProbe.ts']) {
      const src = fs.readFileSync(path.join(REPO, f), 'utf8');
      expect(src).not.toMatch(/TYPESAFE|createTypeSafeTransport|resolveModel|judge\(|updateAdvisoryFields|transitions/);
      expect(src).not.toMatch(/['"](stash|reset|rebase|checkout|commit|add|push|merge)['"]/);
    }
  });

  it('the CLI intake path never builds a JEV transport or a BJC audit sink', async () => {
    const ctx = makeCtx();
    const bjc = jest.fn();
    ctx.deps.bjcAudit = bjc as unknown as GovDeps['bjcAudit'];
    const { hash } = await newWorkProposal(ctx);
    ctx.typed = hash;
    await gov(ctx, ['intake', '--apply', hash]);
    expect(ctx.transport).not.toHaveBeenCalled();
    expect(bjc).not.toHaveBeenCalled();
  });

  it('probes: porcelain parsing and the live-session registry', () => {
    expect(parsePorcelainZ(' M src/a.ts\0R  new.ts\0old.ts\0?? x y.ts\0')).toEqual(['new.ts', 'old.ts', 'src/a.ts', 'x y.ts']);
    expect(parseNulList('b.ts\0a\\c.ts\0b.ts\0')).toEqual(['a/c.ts', 'b.ts']);
    const dir = tmp('gov-intake-sessions-');
    fs.writeFileSync(path.join(dir, '10.json'), JSON.stringify({ pid: 10, sessionId: SID, cwd: 'c:\\virality', status: 'busy' }));
    fs.writeFileSync(path.join(dir, '11.json'), JSON.stringify({ pid: 11, sessionId: SID2, cwd: 'c:\\w' }));
    fs.writeFileSync(path.join(dir, '12.json'), '{corrupt');
    fs.writeFileSync(path.join(dir, '12.abc.key'), 'ignored');
    const live = readLiveSessions({ CLAUDE_SESSIONS_DIR: dir }, (pid) => pid === 10);
    expect(live).toEqual([{ session_id: SID, cwd: 'c:/virality', status: 'busy', pid: 10 }]);
  });
});
