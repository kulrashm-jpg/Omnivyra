/**
 * gov intake — reviewed exact-path protected-path authorizations.
 *
 * `--authorize-protected <id>` lifts a DEFAULT prohibition only for the exact
 * files a reviewed intake-rules entry lists, only when the proposal carries the
 * entry's required verification, and never for user- or Story-level
 * prohibitions. Without the flag, behaviour (and proposal hashes) are unchanged.
 * Hermetic: pure classifier tests plus the CLI over a throwaway git repo.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { JiraClient, JiraCredentials, JiraPermissionProbe } from '../../../scripts/jev-jira/jiraClient';
import { validateRegistry } from '../../../scripts/jev-flow/registry';
import { GOV_EXIT, createIntakeProbe, runGov, type GovDeps } from '../../../scripts/jev-flow/cli';
import { readBindings } from '../../../scripts/jev-flow/binding';
import { authorizationDigest, classifyIntake, loadIntakeRules, patternsMayOverlap, validateIntakeRules, type IntakeInput, type IntakeRules } from '../../../scripts/jev-flow/intake';
import { loadRegistry } from '../../../scripts/jev-flow/registry';
import { canonicalHash, govLayout, type IntakeProposal, type VerificationRegistry } from '../../../scripts/jev-flow/types';
import type { WorktreeState } from '../../../scripts/jev-flow/intakeProbe';

jest.setTimeout(180000);

const C1 = 'a'.repeat(40);
const C2 = 'b'.repeat(40);
const MIG_A = 'supabase/migrations/20261101000000_pi_a.sql';
const MIG_B = 'supabase/migrations/20261102000000_pi_b.sql';
const MIG_OTHER = 'supabase/migrations/20261199000000_other.sql';

const REGISTRY: VerificationRegistry = validateRegistry({
  schema: 'gov-registry/1',
  entries: [
    { id: 't.pass', description: 'unit tests', argv: ['node', '-e', 'process.exit(0)'], evidence_kind: 'test_run', timeout_ms: 60000 },
    { id: 'rs.replay', description: 'migrations replay', argv: ['node', '-e', 'process.exit(0)'], evidence_kind: 'test_run', timeout_ms: 60000 },
    { id: 'schema.lint', description: 'schema lint', argv: ['node', '-e', 'process.exit(0)'], evidence_kind: 'test_run', timeout_ms: 60000 },
  ],
});

const BASE_RULES = {
  schema: 'gov-intake-rules/1',
  default_prohibited_paths: ['supabase/migrations/**', '.env*', 'vercel.json'],
  verification_mappings: [{ paths: ['src/**'], registry_ids: ['t.pass'] }],
};
const AUTH_PI = { id: 'pi-migrations', description: 'PI Story migrations', paths: [MIG_A, MIG_B], required_verification: ['rs.replay', 'schema.lint'] };
const AUTH_VERCEL = { id: 'pi-activation', description: 'PI sweeper cron', paths: ['vercel.json'], required_verification: ['t.pass'] };
const RULES: IntakeRules = validateIntakeRules({ ...BASE_RULES, protected_path_authorizations: [AUTH_PI, AUTH_VERCEL] }, REGISTRY);

function state(over: Partial<WorktreeState> = {}): WorktreeState {
  return { worktree: 'C:/w', branch: 'feature/x', head: C2, clean: true, dirty_files: [], base_ref: 'main', merge_base: C1, changed_since_base: ['src/a.ts', MIG_A], ...over };
}
const opts = (over: Partial<IntakeInput['options']> = {}): IntakeInput['options'] => ({ intent: 'PI work', authorized: [], prohibited: [], verification: [], judgmentAcs: [], ...over });
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
    options: opts(),
    rules: RULES,
    registry: REGISTRY,
    ...over,
  };
}
const FULL_VR = ['t.pass', 'rs.replay', 'schema.lint'];

// ================================================================ rules validation

describe('protected_path_authorizations — rules validation', () => {
  const v = (auths: unknown) => () => validateIntakeRules({ ...BASE_RULES, protected_path_authorizations: auths }, REGISTRY);

  it('absent means none; the shipped rules carry none and still validate against the shipped registry', () => {
    expect(validateIntakeRules(BASE_RULES, REGISTRY).protected_path_authorizations).toEqual([]);
    expect(loadIntakeRules(loadRegistry()).protected_path_authorizations).toEqual([]);
  });

  it('rejects wildcards, directories, paths that need no authorization, unknown registry ids, duplicates and empties', () => {
    expect(v([{ ...AUTH_PI, paths: ['supabase/migrations/*.sql'] }])).toThrow(/no wildcards/);
    expect(v([{ ...AUTH_PI, paths: ['supabase/migrations/**'] }])).toThrow(/no wildcards/);
    expect(v([{ ...AUTH_PI, paths: ['supabase/migrations/'] }])).toThrow(/no wildcards/);
    expect(v([{ ...AUTH_PI, paths: ['src/a.ts'] }])).toThrow(/not under a default prohibited path/);
    expect(v([{ ...AUTH_PI, paths: ['../supabase/migrations/x.sql'] }])).toThrow(/invalid path/);
    expect(v([{ ...AUTH_PI, required_verification: ['no.such'] }])).toThrow(/unknown registry id/);
    expect(v([{ ...AUTH_PI, required_verification: [] }])).toThrow(/required_verification/);
    expect(v([{ ...AUTH_PI, paths: [] }])).toThrow(/paths/);
    expect(v([{ ...AUTH_PI, paths: [MIG_A, MIG_A] }])).toThrow(/duplicate path/);
    expect(v([AUTH_PI, AUTH_PI])).toThrow(/duplicate authorization id/);
    expect(v([{ ...AUTH_PI, id: 'Bad Id' }])).toThrow(/authorization id/);
    expect(v([{ ...AUTH_PI, description: ' ' }])).toThrow(/description/);
    expect(v({})).toThrow(/must be an array/);
  });
});

// ================================================================ classification

describe('--authorize-protected — classification', () => {
  it('without the flag, a changed migration is refused exactly as before', () => {
    expect(classifyIntake(input({ options: opts({ verification: FULL_VR }) }))).toMatchObject({ code: 'PROHIBITED_PATH_TOUCHED', details: [MIG_A] });
  });

  it('with the flag, only the exact authorized files are lifted; the proposal authorizes them exactly and records the authorization', () => {
    const d = classifyIntake(input({ options: opts({ verification: FULL_VR, authorizations: ['pi-migrations'] }) }));
    expect(d.kind).toBe('NEW_WORK');
    if (d.kind !== 'NEW_WORK') return;
    const s = d.proposal!.story;
    expect(s.authorized_paths).toEqual(['src/**', MIG_A, MIG_B]); // exact files, never supabase/migrations/**
    expect(s.authorized_paths).not.toContain('supabase/migrations/**');
    expect(s.prohibited_paths).toEqual(['.env*', 'vercel.json']); // the generic pattern is dropped ONLY because exact files replace it
    const pi = RULES.protected_path_authorizations.find((a) => a.id === 'pi-migrations')!;
    expect(d.proposal!.protected_authorizations).toEqual([{ id: 'pi-migrations', digest: authorizationDigest(pi) }]);
    expect(s.invariants).toEqual([`Protected-path authorization pi-migrations (${authorizationDigest(pi)}): only these exact protected files may change: ${MIG_A}, ${MIG_B}`]);
  });

  it('an unauthorized protected path is still refused even with the flag (another migration, a non-lifted default)', () => {
    expect(classifyIntake(input({ state: state({ changed_since_base: [MIG_A, MIG_OTHER] }), options: opts({ verification: FULL_VR, authorizations: ['pi-migrations'] }) }))).toMatchObject({
      code: 'PROHIBITED_PATH_TOUCHED',
      details: [MIG_OTHER],
    });
    expect(classifyIntake(input({ state: state({ changed_since_base: [MIG_A, '.env.local'] }), options: opts({ verification: FULL_VR, authorizations: ['pi-migrations'] }) }))).toMatchObject({
      code: 'PROHIBITED_PATH_TOUCHED',
      details: ['.env.local'],
    });
  });

  it('user --prohibited and Story prohibitions are never lifted', () => {
    expect(classifyIntake(input({ options: opts({ verification: FULL_VR, authorizations: ['pi-migrations'], prohibited: [MIG_A] }) }))).toMatchObject({ code: 'PROHIBITED_PATH_TOUCHED' });
    const story = { key: 'OMNI-30', summary: 's', authorized_paths: ['src/**', MIG_A], prohibited_paths: ['supabase/migrations/**'] };
    expect(classifyIntake(input({ explicitStoryKey: 'OMNI-30', explicitStory: story, options: opts({ authorizations: ['pi-migrations'] }) }))).toMatchObject({ code: 'PROHIBITED_PATH_TOUCHED' });
  });

  it('an unknown authorization id refuses, before anything else', () => {
    expect(classifyIntake(input({ options: opts({ verification: FULL_VR, authorizations: ['pi-migrations', 'no-such'] }) }))).toMatchObject({ code: 'UNKNOWN_AUTHORIZATION', details: ['no-such'] });
  });

  it('the authorization\'s required verification must be in the proposal (explicit or derived)', () => {
    expect(classifyIntake(input({ options: opts({ verification: ['t.pass'], authorizations: ['pi-migrations'] }) }))).toMatchObject({
      code: 'AUTHORIZATION_VERIFICATION_MISSING',
      details: ['pi-migrations: rs.replay', 'pi-migrations: schema.lint'],
    });
    // Derived from the path mappings (t.pass only) — still refused, never silently added.
    expect(classifyIntake(input({ state: state({ changed_since_base: ['src/a.ts'] }), options: opts({ authorizations: ['pi-migrations'] }) }))).toMatchObject({ code: 'AUTHORIZATION_VERIFICATION_MISSING' });
  });

  it('an authorized glob that could reach into the dropped protected area is refused', () => {
    for (const glob of ['supabase/**', 'supabase/migrations/**', 'supabase/migrations/2026*']) {
      expect(classifyIntake(input({ options: opts({ verification: FULL_VR, authorizations: ['pi-migrations'], authorized: ['src/**', MIG_A, glob] }) }))).toMatchObject({
        code: 'PROHIBITED_PATH_TOUCHED',
        details: [glob],
      });
    }
    // Explicit exact authorized files are fine.
    expect(classifyIntake(input({ options: opts({ verification: FULL_VR, authorizations: ['pi-migrations'], authorized: ['src/**', MIG_A] }) })).kind).toBe('NEW_WORK');
  });

  it('works for a non-migration protected file (vercel.json for an activation Story)', () => {
    const d = classifyIntake(input({ state: state({ changed_since_base: ['vercel.json'] }), options: opts({ verification: ['t.pass'], authorizations: ['pi-activation'] }) }));
    expect(d.kind).toBe('NEW_WORK');
    if (d.kind === 'NEW_WORK') {
      expect(d.proposal!.story.authorized_paths).toEqual(['vercel.json']);
      expect(d.proposal!.story.prohibited_paths).toEqual(['.env*', 'supabase/migrations/**']);
    }
    expect(classifyIntake(input({ state: state({ changed_since_base: ['vercel.json'] }), options: opts({ verification: ['t.pass'] }) }))).toMatchObject({ code: 'PROHIBITED_PATH_TOUCHED' });
  });

  it('an existing Story that authorizes the exact migration is matched only with the flag', () => {
    const story = { key: 'OMNI-31', summary: 's', authorized_paths: ['src/**', MIG_A, MIG_B], prohibited_paths: ['.env*'] };
    expect(classifyIntake(input({ activeStories: [story] }))).toMatchObject({ code: 'PROHIBITED_PATH_TOUCHED' });
    expect(classifyIntake(input({ activeStories: [story], options: opts({ authorizations: ['pi-migrations'] }) }))).toMatchObject({ kind: 'EXISTING_STORY', story: { key: 'OMNI-31' } });
  });

  it('without the flag the proposal is byte-identical to the pre-authorization shape (no new key, same hash)', () => {
    const d = classifyIntake(input({ state: state({ changed_since_base: ['src/a.ts'] }) }));
    expect(d.kind).toBe('NEW_WORK');
    if (d.kind !== 'NEW_WORK') return;
    const p = d.proposal as IntakeProposal;
    expect('protected_authorizations' in p).toBe(false);
    expect(p.story.invariants).toEqual([]);
    const withEmptyFlag = classifyIntake(input({ state: state({ changed_since_base: ['src/a.ts'] }), options: opts({ authorizations: [] }) }));
    expect(withEmptyFlag.kind === 'NEW_WORK' && canonicalHash(withEmptyFlag.proposal)).toBe(canonicalHash(p));
  });

  it('patternsMayOverlap is conservative', () => {
    expect(patternsMayOverlap('supabase/**', 'supabase/migrations/**')).toBe(true);
    expect(patternsMayOverlap('supabase/migrations/2026*', 'supabase/migrations/**')).toBe(true);
    expect(patternsMayOverlap('src/**', 'supabase/migrations/**')).toBe(false);
    expect(patternsMayOverlap(MIG_A, 'supabase/migrations/**')).toBe(true);
    expect(patternsMayOverlap('src/a.ts', 'supabase/migrations/**')).toBe(false);
    expect(patternsMayOverlap('vercel.json', 'vercel.json')).toBe(true);
  });
});

// ================================================================ CLI flag + audit

const tmpDirs: string[] = [];
afterAll(() => {
  for (const d of tmpDirs.reverse()) fs.rmSync(d, { recursive: true, force: true });
});
function tmp(p: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), p));
  tmpDirs.push(d);
  return d;
}
const sh = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8', windowsHide: true }).trim();
function repoWith(files: Record<string, string>): string {
  const r = tmp('gov-auth-repo-');
  sh(r, 'init', '-q', '-b', 'main');
  sh(r, 'config', 'user.email', 't@example.invalid');
  sh(r, 'config', 'user.name', 't');
  sh(r, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(r, 'README.md'), 'x\n');
  sh(r, 'add', '-A');
  sh(r, 'commit', '-q', '-m', 'base');
  sh(r, 'checkout', '-q', '-b', 'feature/x');
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(r, rel)), { recursive: true });
    fs.writeFileSync(path.join(r, rel), text);
  }
  sh(r, 'add', '-A');
  sh(r, 'commit', '-q', '-m', 'work');
  return r;
}

const READER = ['reader', 'test', 'value'].join('-');
function cliCtx() {
  const home = path.join(tmp('gov-auth-home-'), 'gov');
  const env = { GOV_HOME: home, CLAUDE_PROJECTS_DIR: tmp('gov-auth-proj-'), JEV_JIRA_IDENTITY: 'reader', JEV_READER_TOKEN: READER };
  const deps: Partial<GovDeps> = {
    registry: REGISTRY,
    now: () => new Date('2026-10-06T12:00:00.000Z'),
    jiraClient: (c: JiraCredentials) =>
      ({
        getMyPermissions: async () =>
          c.token === READER ? { BROWSE_PROJECTS: true, EDIT_ISSUES: false, TRANSITION_ISSUES: false, CREATE_ISSUES: false, DELETE_ISSUES: false, ADMINISTER_PROJECTS: false, ADMINISTER: false } : {},
        getIssue: async () => {
          throw new Error('unexpected');
        },
        updateAdvisoryFields: async () => {
          throw new Error('intake never writes');
        },
      }) as JiraClient & JiraPermissionProbe,
    intakeReader: () => ({ searchActiveStories: async () => [] }),
    intakeProbe: createIntakeProbe(),
    liveSessions: () => [],
    intakeRules: () => RULES,
    transport: () => {
      throw new Error('JEV must not be reached');
    },
  };
  return { env, deps, home };
}
async function gov(c: ReturnType<typeof cliCtx>, argv: string[]) {
  const out: string[] = [];
  const code = await runGov(argv, c.env, { out: (t) => out.push(t), err: (t) => out.push(t) }, c.deps);
  const line = out.filter((l) => l.startsWith('GOV_RESULT ')).pop();
  return { code, out, result: line ? JSON.parse(line.slice('GOV_RESULT '.length)) : null };
}

describe('--authorize-protected — CLI', () => {
  it('stores a proposal that records the authorization, and audits the id; without the flag it refuses', async () => {
    const r = repoWith({ 'src/a.ts': 'a\n', [MIG_A]: 'select 1;\n' });
    const c = cliCtx();
    const refused = await gov(c, ['intake', '--worktree', r, '--base', 'main', '--intent', 'PI', '--verification', 't.pass', '--verification', 'rs.replay', '--verification', 'schema.lint']);
    expect(refused.code).toBe(GOV_EXIT.REFUSED);
    expect(refused.result.refusal).toBe('PROHIBITED_PATH_TOUCHED');
    const ok = await gov(c, ['intake', '--worktree', r, '--base', 'main', '--intent', 'PI', '--verification', 't.pass', '--verification', 'rs.replay', '--verification', 'schema.lint', '--authorize-protected', 'pi-migrations']);
    expect(ok.code).toBe(0);
    expect(ok.result.classification).toBe('NEW_WORK');
    expect(ok.result.protected_authorizations).toEqual(['pi-migrations']);
    const stored = JSON.parse(fs.readFileSync(path.join(c.home, 'intake', 'proposals', `${(ok.result.proposal_hash as string).slice(7)}.json`), 'utf8'));
    expect(stored.proposal.protected_authorizations.map((a: { id: string }) => a.id)).toEqual(['pi-migrations']);
    expect(stored.proposal.story.authorized_paths).toEqual(['src/**', MIG_A, MIG_B]);
    const audit = fs.readFileSync(path.join(c.home, 'intake', 'audit.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(audit.map((a) => [a.event, a.protected_authorizations])).toEqual([
      ['refused', []],
      ['classify', ['pi-migrations']],
    ]);
    expect(readBindings(govLayout(c.env))).toEqual([]);
    expect(sh(r, 'status', '--porcelain')).toBe('');
  });

  it('an unknown id or a valueless flag is refused / usage', async () => {
    const r = repoWith({ 'src/a.ts': 'a\n' });
    const c = cliCtx();
    expect((await gov(c, ['intake', '--worktree', r, '--base', 'main', '--intent', 'x', '--authorize-protected', 'nope'])).result.refusal).toBe('UNKNOWN_AUTHORIZATION');
    expect((await gov(c, ['intake', '--worktree', r, '--base', 'main', '--intent', 'x', '--authorize-protected'])).code).toBe(64);
  });
});
