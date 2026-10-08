/**
 * `gov audit-branch` — read-only detection of non-governed commits
 * (harness certification N-14, owner decision A1(b): detection only, no new authority).
 *
 * Hermetic: pure classification, then runGov over throwaway git repos under
 * os.tmpdir() with GOV_HOME in a separate temp dir. No network, no Jira, no JEV.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as ts from 'typescript';
import { AUDIT_COMMIT_CLASSES, auditBranch, auditVerdict, classifyCommit, type AuditedCommit } from '../../../scripts/jev-flow/auditBranch';
import { bindSession } from '../../../scripts/jev-flow/binding';
import { GOV_EXIT, runGov } from '../../../scripts/jev-flow/cli';
import { storePacket } from '../../../scripts/jev-flow/packet';
import { registryDigest, validateRegistry } from '../../../scripts/jev-flow/registry';
import {
  ADOPTION_CLASSIFICATION,
  GOVERNANCE_VERSION,
  HUMAN_ONLY_RULES,
  PACKET_SCHEMA,
  govLayout,
  type GitProbe,
  type GovernedPacket,
} from '../../../scripts/jev-flow/types';

jest.setTimeout(180000);

const STORY = 'OMNI-80';
const SID = '8a7b6c5d-4e3f-4a2b-9c1d-0e9f8a7b6c5d';
const PKT = `sha256:${'a'.repeat(64)}`;
const C = (n: number) => String(n).repeat(40).slice(0, 40);
const yes = { packetIntact: () => true, isAdoptionBaseline: () => true };
const no = { packetIntact: () => false, isAdoptionBaseline: () => false };

// ================================================================ pure classification

describe('classifyCommit — trailers only, fail closed', () => {
  it('N-14: plain work (no trailer) is UNGOVERNED, whatever the lookups say', () => {
    expect(classifyCommit(C(1), {}, yes).classification).toBe('UNGOVERNED');
    expect(classifyCommit(C(1), { 'Co-Authored-By': ['Claude'] }, yes).classification).toBe('UNGOVERNED');
  });

  it('both trailers + packet stored intact → GOVERNED; packet not stored → GOVERNED_UNVERIFIED_PACKET', () => {
    const t = { 'Governed-By': [STORY], 'Gov-Packet': [PKT] };
    expect(classifyCommit(C(1), t, yes)).toMatchObject({ classification: 'GOVERNED', story: STORY, packet_hash: PKT });
    expect(classifyCommit(C(1), t, no)).toMatchObject({ classification: 'GOVERNED_UNVERIFIED_PACKET', story: STORY, packet_hash: PKT });
  });

  it('Governed-By alone is an ADOPTION_BASELINE only when the ledger records it; otherwise MALFORMED', () => {
    const t = { 'Governed-By': [STORY] };
    expect(classifyCommit(C(1), t, yes).classification).toBe('ADOPTION_BASELINE');
    expect(classifyCommit(C(1), t, no).classification).toBe('MALFORMED');
  });

  it.each([
    ['Gov-Packet without Governed-By', { 'Gov-Packet': [PKT] }],
    ['two Stories', { 'Governed-By': [STORY, 'OMNI-81'], 'Gov-Packet': [PKT] }],
    ['an invalid Story key', { 'Governed-By': ['PROJ-1'], 'Gov-Packet': [PKT] }],
    ['two packets', { 'Governed-By': [STORY], 'Gov-Packet': [PKT, `sha256:${'b'.repeat(64)}`] }],
    ['a packet that is not sha256:<hex>', { 'Governed-By': [STORY], 'Gov-Packet': ['sha256:XYZ'] }],
  ])('%s → MALFORMED (even when every lookup would succeed)', (_label, t) => {
    expect(classifyCommit(C(1), t as Record<string, string[]>, yes).classification).toBe('MALFORMED');
  });

  it('duplicate identical trailer values are one value', () => {
    expect(classifyCommit(C(1), { 'Governed-By': [STORY, STORY], 'Gov-Packet': [PKT, PKT] }, yes).classification).toBe('GOVERNED');
  });

  it('verdict: none → NO_COMMITS; any UNGOVERNED/MALFORMED → UNGOVERNED_DETECTED; else any unverified → UNVERIFIABLE; else ALL_GOVERNED', () => {
    const c = (classification: AuditedCommit['classification']): AuditedCommit => ({ commit: C(1), classification, story: null, packet_hash: null, detail: '' });
    expect(auditVerdict([])).toBe('NO_COMMITS');
    expect(auditVerdict([c('GOVERNED'), c('ADOPTION_BASELINE')])).toBe('ALL_GOVERNED');
    expect(auditVerdict([c('GOVERNED'), c('GOVERNED_UNVERIFIED_PACKET')])).toBe('UNVERIFIABLE');
    expect(auditVerdict([c('GOVERNED_UNVERIFIED_PACKET'), c('UNGOVERNED')])).toBe('UNGOVERNED_DETECTED');
    expect(auditVerdict([c('MALFORMED')])).toBe('UNGOVERNED_DETECTED');
  });
});

describe('auditBranch — uses only the injected read-only probe', () => {
  it('classifies base..head in order and counts every class; git errors propagate', async () => {
    const trailers: Record<string, Record<string, string[]>> = {
      [C(1)]: {},
      [C(2)]: { 'Governed-By': [STORY], 'Gov-Packet': [PKT] },
      [C(3)]: { 'Governed-By': [STORY] },
    };
    const calls: string[] = [];
    const git = {
      commitsBetween: async (_w: string, base: string, head: string) => {
        calls.push(`commitsBetween ${base}..${head}`);
        return [C(1), C(2), C(3)];
      },
      commitTrailers: async (_w: string, c: string) => {
        calls.push(`commitTrailers ${c}`);
        return trailers[c];
      },
    } as unknown as GitProbe;
    const r = await auditBranch({ git, worktree: 'W', base: C(9), head: C(3), packetIntact: () => true, isAdoptionBaseline: (_s, c) => c === C(3) });
    expect(r.commits.map((x) => x.classification)).toEqual(['UNGOVERNED', 'GOVERNED', 'ADOPTION_BASELINE']);
    expect(r.counts).toEqual({ GOVERNED: 1, GOVERNED_UNVERIFIED_PACKET: 0, ADOPTION_BASELINE: 1, MALFORMED: 0, UNGOVERNED: 1 });
    expect(Object.keys(r.counts)).toEqual([...AUDIT_COMMIT_CLASSES]);
    expect(r.verdict).toBe('UNGOVERNED_DETECTED');
    expect(calls).toEqual([`commitsBetween ${C(9)}..${C(3)}`, `commitTrailers ${C(1)}`, `commitTrailers ${C(2)}`, `commitTrailers ${C(3)}`]);
    const broken = { commitsBetween: async () => { throw new Error('git missing'); } } as unknown as GitProbe;
    await expect(auditBranch({ git: broken, worktree: 'W', base: C(9), head: C(3), ...no })).rejects.toThrow('git missing');
  });
});

// ================================================================ CLI over real git

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
function commit(repo: string, file: string, ...trailers: string[]): string {
  fs.writeFileSync(path.join(repo, file), `${file} ${Date.now()} ${Math.random()}\n`);
  sh(repo, 'add', '-A');
  const args = ['commit', '-q', '-m', `work on ${file}`];
  if (trailers.length > 0) args.push('-m', trailers.join('\n'));
  sh(repo, ...args);
  return sh(repo, 'rev-parse', 'HEAD');
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
const snapshot = (dir: string) => Object.fromEntries(listFiles(dir).filter((f) => !f.includes(`${path.sep}.git${path.sep}`)).map((f) => [f, `${fs.statSync(f).mtimeMs}:${fs.readFileSync(f, 'utf8')}`]));

const REGISTRY = validateRegistry({
  schema: 'gov-registry/1',
  entries: [{ id: 't.pass', description: 'unit tests', argv: ['node', '-e', 'process.exit(0)'], evidence_kind: 'test_run', timeout_ms: 60000 }],
});

function world() {
  const repo = tmp('gov-audit-repo-');
  sh(repo, 'init', '-q', '-b', 'main');
  sh(repo, 'config', 'user.email', 'gov-test@example.invalid');
  sh(repo, 'config', 'user.name', 'gov test');
  sh(repo, 'config', 'commit.gpgsign', 'false');
  const base = commit(repo, 'README.md');
  sh(repo, 'checkout', '-q', '-b', 'omni-80/audit');
  const home = path.join(tmp('gov-audit-home-'), 'gov');
  const layout = govLayout({ GOV_HOME: home });
  const packet: GovernedPacket = {
    schema: PACKET_SCHEMA,
    governance_version: GOVERNANCE_VERSION,
    story: { key: STORY, summary: 's', status: 'In Progress', objective: 'o', architecture: null, invariants: [], updated: '2026-10-08T10:00:00.000+0000' },
    acceptance_criteria: [],
    scope: { authorized_paths: ['src/**'], prohibited_paths: [] },
    verification: { registry_ids: ['t.pass'], registry_digest: registryDigest(REGISTRY, ['t.pass']) },
    base: { commit: base, branch: 'omni-80/audit', worktree: repo.replace(/\\/g, '/') },
    rules: [...HUMAN_ONLY_RULES],
  };
  const stored = storePacket(layout, packet);
  return { repo, base, home, layout, packetHash: stored.packet_hash };
}

async function gov(home: string, argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runGov(argv, { GOV_HOME: home }, { out: (t) => out.push(t), err: (t) => err.push(t) }, { registry: REGISTRY });
  const line = out.filter((l) => l.startsWith('GOV_RESULT ')).pop();
  return { code, out, err, result: line ? (JSON.parse(line.slice('GOV_RESULT '.length)) as Record<string, unknown>) : null };
}

describe('gov audit-branch (CLI)', () => {
  it('N-14: plain Claude work on a branch is detected, never treated as governed (exit 13, UNGOVERNED_DETECTED)', async () => {
    const w = world();
    commit(w.repo, 'a.ts', `Governed-By: ${STORY}`, `Gov-Packet: ${w.packetHash}`);
    const plain = commit(w.repo, 'b.ts', 'Co-Authored-By: Claude <noreply@anthropic.com>');
    const r = await gov(w.home, ['audit-branch', '--worktree', w.repo, '--base', 'main']);
    expect(r.code).toBe(GOV_EXIT.INTEGRITY_FAILED);
    expect(r.result).toMatchObject({ verb: 'audit-branch', status: 'INTEGRITY_FAILED', verdict: 'UNGOVERNED_DETECTED', base_commit: w.base });
    expect(r.result?.counts).toEqual({ GOVERNED: 1, GOVERNED_UNVERIFIED_PACKET: 0, ADOPTION_BASELINE: 0, MALFORMED: 0, UNGOVERNED: 1 });
    expect(r.out).toContain(`  ${plain.slice(0, 12)} UNGOVERNED — no Governed-By or Gov-Packet trailer`);
  });

  it('every commit governed by an intact stored packet → OK (ALL_GOVERNED)', async () => {
    const w = world();
    commit(w.repo, 'a.ts', `Governed-By: ${STORY}`, `Gov-Packet: ${w.packetHash}`);
    commit(w.repo, 'b.ts', `Governed-By: ${STORY}`, `Gov-Packet: ${w.packetHash}`);
    const r = await gov(w.home, ['audit-branch', '--worktree', w.repo, '--base', 'main']);
    expect(r.code).toBe(GOV_EXIT.OK);
    expect(r.result).toMatchObject({ verdict: 'ALL_GOVERNED' });
  });

  it('a recorded adoption baseline is ADOPTION_BASELINE; the same trailer without a ledger record is MALFORMED', async () => {
    const w = world();
    const baseline = commit(w.repo, 'a.ts', `Governed-By: ${STORY}`);
    let r = await gov(w.home, ['audit-branch', '--worktree', w.repo, '--base', 'main']);
    expect(r.result).toMatchObject({ verdict: 'UNGOVERNED_DETECTED' });
    expect(r.out.join('\n')).toMatch(/MALFORMED — Governed-By: OMNI-80 without Gov-Packet, and no binding records it as an adoption baseline/);
    // The same commit recorded as another Story's baseline does not make it OMNI-80's baseline.
    const other = bindSession(
      w.layout,
      {
        story_key: 'OMNI-81', packet_hash: w.packetHash, session_id: '9b8c7d6e-5f4a-4b3c-8d2e-1f0a9b8c7d6e', mode: 'attach', worktree: w.repo.replace(/\\/g, '/'), branch: 'omni-80/audit',
        base_commit: baseline,
        session_file: { path: path.join(w.home, 'other-transcript.jsonl'), sha256: `sha256:${'e'.repeat(64)}`, bytes: 1, cwd: w.repo, git_branch: 'omni-80/audit' },
        adoption: { baseline_commit: baseline, classification: ADOPTION_CLASSIFICATION },
      },
      () => new Date('2026-10-08T12:00:00Z'),
    );
    expect(other.status).toBe('BOUND');
    r = await gov(w.home, ['audit-branch', '--worktree', w.repo, '--base', 'main']);
    expect(r.result).toMatchObject({ verdict: 'UNGOVERNED_DETECTED' });
    const bound = bindSession(
      w.layout,
      {
        story_key: STORY, packet_hash: w.packetHash, session_id: SID, mode: 'attach', worktree: w.repo.replace(/\\/g, '/'), branch: 'omni-80/audit',
        base_commit: baseline,
        session_file: { path: path.join(w.home, 'fake-transcript.jsonl'), sha256: `sha256:${'d'.repeat(64)}`, bytes: 1, cwd: w.repo, git_branch: 'omni-80/audit' },
        adoption: { baseline_commit: baseline, classification: ADOPTION_CLASSIFICATION },
      },
      () => new Date('2026-10-08T12:00:00Z'),
    );
    expect(bound.status).toBe('BOUND');
    r = await gov(w.home, ['audit-branch', '--worktree', w.repo, '--base', 'main']);
    expect(r.code).toBe(GOV_EXIT.OK);
    expect(r.result).toMatchObject({ verdict: 'ALL_GOVERNED' });
  });

  it('a packet this GOV_HOME does not hold (or a tampered one) is UNVERIFIABLE, never GOVERNED (exit 13)', async () => {
    const w = world();
    commit(w.repo, 'a.ts', `Governed-By: ${STORY}`, `Gov-Packet: sha256:${'c'.repeat(64)}`);
    let r = await gov(w.home, ['audit-branch', '--worktree', w.repo, '--base', 'main']);
    expect(r.code).toBe(GOV_EXIT.INTEGRITY_FAILED);
    expect(r.result).toMatchObject({ verdict: 'UNVERIFIABLE' });
    const w2 = world();
    commit(w2.repo, 'a.ts', `Governed-By: ${STORY}`, `Gov-Packet: ${w2.packetHash}`);
    const f = w2.layout.packetFile(STORY, w2.packetHash, 'json');
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('"summary":"s"', '"summary":"tampered"'));
    r = await gov(w2.home, ['audit-branch', '--worktree', w2.repo, '--base', 'main']);
    expect(r.result).toMatchObject({ verdict: 'UNVERIFIABLE' });
  });

  it('a packet stored for a different Story does not make the commit GOVERNED', async () => {
    const w = world();
    commit(w.repo, 'a.ts', 'Governed-By: OMNI-81', `Gov-Packet: ${w.packetHash}`);
    const r = await gov(w.home, ['audit-branch', '--worktree', w.repo, '--base', 'main']);
    expect(r.result).toMatchObject({ verdict: 'UNVERIFIABLE' });
  });

  it('no commits after the base → OK (NO_COMMITS)', async () => {
    const w = world();
    const r = await gov(w.home, ['audit-branch', '--worktree', w.repo, '--base', 'main']);
    expect(r.code).toBe(GOV_EXIT.OK);
    expect(r.result).toMatchObject({ verdict: 'NO_COMMITS' });
  });

  it('usage and refusals: no --worktree → 64; an unresolvable base → REFUSED; GOV_HOME inside a work tree → REFUSED', async () => {
    const w = world();
    expect((await gov(w.home, ['audit-branch'])).code).toBe(64);
    expect((await gov(w.home, ['audit-branch', '--worktree', w.repo, '--base', 'no-such-ref'])).code).toBe(GOV_EXIT.REFUSED);
    expect((await gov(path.join(w.repo, '.gov'), ['audit-branch', '--worktree', w.repo, '--base', 'main'])).code).toBe(GOV_EXIT.REFUSED);
  });

  it('detection only: the worktree, git refs/HEAD and every GOV_HOME file are unchanged, in every outcome', async () => {
    const w = world();
    commit(w.repo, 'a.ts', `Governed-By: ${STORY}`, `Gov-Packet: ${w.packetHash}`);
    commit(w.repo, 'b.ts');
    const before = { wt: snapshot(w.repo), home: snapshot(w.home), head: sh(w.repo, 'rev-parse', 'HEAD'), refs: sh(w.repo, 'for-each-ref') };
    await gov(w.home, ['audit-branch', '--worktree', w.repo, '--base', 'main']);
    await gov(w.home, ['audit-branch', '--worktree', w.repo, '--base', 'HEAD']);
    expect({ wt: snapshot(w.repo), home: snapshot(w.home), head: sh(w.repo, 'rev-parse', 'HEAD'), refs: sh(w.repo, 'for-each-ref') }).toEqual(before);
    expect(sh(w.repo, 'status', '--porcelain')).toBe('');
  });
});

// ================================================================ static authority boundary

describe('audit-branch has no write, Jira, JEV or process surface', () => {
  const FLOW = path.resolve(__dirname, '../../../scripts/jev-flow');
  const src = fs.readFileSync(path.join(FLOW, 'auditBranch.ts'), 'utf8');
  const code = ts.createPrinter({ removeComments: true }).printFile(ts.createSourceFile('auditBranch.ts', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS));

  it('auditBranch.ts imports only the shared gov contract types (no fs, process, network, Jira, JEV or BJC module)', () => {
    const imports = [...code.matchAll(/from ['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(imports).toEqual(['./types']);
    expect(code).not.toMatch(/child_process|node:fs|require\(|fetch\(|https?:|writeFile|appendFile|mkdir|unlink|rmSync/);
  });

  it('cmdAuditBranch never calls a writer: no bind, store, append, write-back, transport, worktree creation or Jira client', () => {
    const cli = fs.readFileSync(path.join(FLOW, 'cli.ts'), 'utf8');
    const start = cli.indexOf('async function cmdAuditBranch');
    const end = cli.indexOf('\n}\n', start);
    expect(start).toBeGreaterThan(0);
    const body = cli.slice(start, end);
    expect(body).not.toMatch(/bindSession|storePacket|storeBundle|storeLog|appendIntakeAudit|storeProposal|writeFile|appendFile|mkdir|createWorktree|jiraClient|jiraQuery|transport|preflightIdentity|runJudgeFlow|runVerification|runner/);
    expect(body).toMatch(/readBindings\(layout\)/);
    expect(body).toMatch(/loadPacket\(layout/);
  });

  it('audit-branch stays outside the pinned 7-verb USAGE (it governs no Story) and is listed in its own usage block', () => {
    const cli = fs.readFileSync(path.join(FLOW, 'cli.ts'), 'utf8');
    const usage = /const USAGE = \[([\s\S]*?)\]\.join/.exec(cli)![1];
    expect(usage).not.toMatch(/audit-branch/);
    expect(cli).toMatch(/const AUDIT_USAGE = '  audit-branch --worktree <path> \[--base <ref>\]/);
  });
});
