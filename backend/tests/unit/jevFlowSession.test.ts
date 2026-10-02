/**
 * gov Track 3 — Claude session discovery + session↔Story binding ledger.
 * Hermetic: a fake projects dir and fake transcripts under os.tmpdir(); never
 * touches real Claude transcripts, never launches `claude`, no network.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildResumeInstructions,
  buildStartCommand,
  claudeProjectsDir,
  findSessionFile,
  fingerprintSession,
  newSessionId,
} from '../../../scripts/jev-flow/session';
import { bindSession, findBySession, findByStory, latestForStory, readBindings, type BindInput } from '../../../scripts/jev-flow/binding';
import { BINDING_SCHEMA, GOVERNANCE_VERSION, SESSION_ID_RE, canonicalHash, govLayout, type GovLayout } from '../../../scripts/jev-flow/types';

const SID = '0f1e2d3c-4b5a-4968-8776-655443322110';
const SID2 = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const COMMIT = 'a'.repeat(40);
const PKT1 = canonicalHash({ packet: 1 });
const PKT2 = canonicalHash({ packet: 2 });
const FIXED_NOW = () => new Date('2026-10-01T12:00:00.000Z');

const tmpDirs: string[] = [];
function tmp(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

function fakeProjects(): { dir: string; env: Record<string, string> } {
  const dir = tmp('gov-projects-');
  return { dir, env: { CLAUDE_PROJECTS_DIR: dir } };
}

function writeTranscript(projectsDir: string, slug: string, sessionId: string, lines: string[]): string {
  const d = path.join(projectsDir, slug);
  fs.mkdirSync(d, { recursive: true });
  const f = path.join(d, `${sessionId}.jsonl`);
  fs.writeFileSync(f, lines.join('\n') + '\n');
  return f;
}

const TRANSCRIPT_LINES = [
  JSON.stringify({ type: 'queue-operation', operation: 'enqueue' }),
  'this is { not json',
  JSON.stringify({ type: 'file-history-snapshot', snapshot: {} }),
  JSON.stringify([1, 2, 3]),
  JSON.stringify({ type: 'user', sessionId: SID, cwd: 'C:\\work\\repo', gitBranch: 'feature/x', message: { role: 'user', content: 'hi' } }),
  JSON.stringify({ type: 'assistant', sessionId: SID, cwd: 'C:\\other', gitBranch: 'other' }),
];

function govFor(): GovLayout {
  return govLayout({ GOV_HOME: path.join(tmp('gov-home-'), 'gov') });
}

function input(over: Partial<BindInput> = {}): BindInput {
  return {
    story_key: 'OMNI-7',
    packet_hash: PKT1,
    session_id: SID,
    mode: 'new',
    worktree: 'C:/tmp/gov-omni-7',
    branch: 'gov/OMNI-7',
    base_commit: COMMIT,
    session_file: null,
    ...over,
  };
}

describe('claudeProjectsDir', () => {
  it('honours CLAUDE_PROJECTS_DIR and defaults to ~/.claude/projects', () => {
    const { dir, env } = fakeProjects();
    expect(claudeProjectsDir(env)).toBe(path.resolve(dir));
    expect(claudeProjectsDir({})).toBe(path.join(os.homedir(), '.claude', 'projects'));
  });
});

describe('findSessionFile', () => {
  it('rejects non-UUID and traversal input before touching the filesystem', () => {
    const { env } = fakeProjects();
    for (const bad of ['', 'abc', `../${SID}`, `${SID}/../x`, '..\\..\\etc', SID.toUpperCase(), `${SID}.jsonl`, `x/${SID}`]) {
      expect(() => findSessionFile(bad, env)).toThrow(/invalid session id/);
    }
  });

  it('returns null when absent (including a missing projects dir)', () => {
    const { dir, env } = fakeProjects();
    expect(findSessionFile(SID, env)).toBeNull();
    writeTranscript(dir, 'c--repo', SID2, ['{}']);
    expect(findSessionFile(SID, env)).toBeNull();
    expect(findSessionFile(SID, { CLAUDE_PROJECTS_DIR: path.join(dir, 'does-not-exist') })).toBeNull();
  });

  it('finds the top-level transcript and ignores subagent transcripts', () => {
    const { dir, env } = fakeProjects();
    const f = writeTranscript(dir, 'c--repo', SID, TRANSCRIPT_LINES);
    const sub = path.join(dir, 'c--repo', SID, 'subagents');
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, `${SID}.jsonl`), '{}\n');
    expect(findSessionFile(SID, env)).toBe(f);
  });

  it('throws when the same session id exists under two project slugs', () => {
    const { dir, env } = fakeProjects();
    writeTranscript(dir, 'c--repo', SID, ['{}']);
    writeTranscript(dir, 'c--tmp-wt', SID, ['{}']);
    expect(() => findSessionFile(SID, env)).toThrow(/ambiguous/);
  });
});

describe('fingerprintSession', () => {
  it('hashes exact bytes and extracts cwd/gitBranch from the first line that has them', () => {
    const { dir } = fakeProjects();
    const f = writeTranscript(dir, 'c--repo', SID, TRANSCRIPT_LINES);
    const fp = fingerprintSession(f);
    const bytes = fs.readFileSync(f);
    const expected = `sha256:${require('node:crypto').createHash('sha256').update(bytes).digest('hex')}`;
    expect(fp).toEqual({ path: path.resolve(f), sha256: expected, bytes: bytes.length, cwd: 'C:\\work\\repo', git_branch: 'feature/x' });
  });

  it('returns nulls when no line carries cwd/gitBranch, tolerating garbage', () => {
    const { dir } = fakeProjects();
    const f = writeTranscript(dir, 'c--repo', SID, ['garbage', '{"type":"queue-operation"}', 'null', '']);
    const fp = fingerprintSession(f);
    expect(fp.cwd).toBeNull();
    expect(fp.git_branch).toBeNull();
  });

  it('takes cwd and gitBranch independently and stops scanning after 200 lines', () => {
    const { dir } = fakeProjects();
    const f1 = writeTranscript(dir, 'a', SID, [JSON.stringify({ cwd: '/w' }), JSON.stringify({ gitBranch: 'b' })]);
    expect(fingerprintSession(f1)).toMatchObject({ cwd: '/w', git_branch: 'b' });
    const filler = Array.from({ length: 200 }, () => '{"type":"x"}');
    const f2 = writeTranscript(dir, 'b', SID2, [...filler, JSON.stringify({ cwd: '/late', gitBranch: 'late' })]);
    expect(fingerprintSession(f2)).toMatchObject({ cwd: null, git_branch: null });
  });
});

describe('attach leaves the transcript untouched', () => {
  it('fingerprint + bind keep the transcript byte-for-byte identical (bytes and mtime)', () => {
    const { dir, env } = fakeProjects();
    const f = writeTranscript(dir, 'c--repo', SID, TRANSCRIPT_LINES);
    const past = new Date('2026-01-01T00:00:00.000Z');
    fs.utimesSync(f, past, past);
    const before = fs.readFileSync(f);
    const mtimeBefore = fs.statSync(f).mtimeMs;
    const dirListingBefore = fs.readdirSync(path.dirname(f)).sort();

    const found = findSessionFile(SID, env);
    const fp = fingerprintSession(found);
    const layout = govFor();
    const res = bindSession(layout, input({ mode: 'attach', session_file: fp, worktree: fp.cwd, branch: fp.git_branch }), FIXED_NOW);
    expect(res.status).toBe('BOUND');
    expect(res.binding.session_file).toEqual(fp);

    expect(Buffer.compare(fs.readFileSync(f), before)).toBe(0);
    expect(fs.statSync(f).mtimeMs).toBe(mtimeBefore);
    expect(fs.readdirSync(path.dirname(f)).sort()).toEqual(dirListingBefore);
    expect(fingerprintSession(f).sha256).toBe(fp.sha256);
    // the only file written is the ledger, under GOV_HOME
    expect(fs.readdirSync(layout.home)).toEqual(['bindings.jsonl']);
  });
});

describe('bindSession ledger', () => {
  it('binds once and is idempotent (second call ALREADY_BOUND, one ledger line)', () => {
    const layout = govFor();
    const first = bindSession(layout, input(), FIXED_NOW);
    expect(first.status).toBe('BOUND');
    expect(first.binding).toEqual({
      schema: BINDING_SCHEMA,
      governance_version: GOVERNANCE_VERSION,
      ...input(),
      bound_at: '2026-10-01T12:00:00.000Z',
    });
    const second = bindSession(layout, input(), () => new Date('2026-10-02T00:00:00.000Z'));
    expect(second.status).toBe('ALREADY_BOUND');
    expect(second.binding).toEqual(first.binding);
    expect(fs.readFileSync(layout.bindingsFile, 'utf8').trim().split('\n')).toHaveLength(1);
  });

  it('mode new stores session_file null', () => {
    const layout = govFor();
    const res = bindSession(layout, input({ session_id: newSessionId() }), FIXED_NOW);
    expect(res.status).toBe('BOUND');
    expect(res.binding.mode).toBe('new');
    expect(res.binding.session_file).toBeNull();
    expect(readBindings(layout)[0].session_file).toBeNull();
  });

  it('refuses binding a session to a different Story (one session governs one Story)', () => {
    const layout = govFor();
    expect(bindSession(layout, input(), FIXED_NOW).status).toBe('BOUND');
    const res = bindSession(layout, input({ story_key: 'OMNI-8' }), FIXED_NOW);
    expect(res.status).toBe('REFUSED');
    expect(res.binding).toBeNull();
    expect(res.message).toMatch(/OMNI-7/);
    expect(readBindings(layout)).toHaveLength(1);
  });

  it('re-binds the same session/Story to a regenerated packet (append) and lookups return the latest', () => {
    const layout = govFor();
    bindSession(layout, input(), FIXED_NOW);
    const res = bindSession(layout, input({ packet_hash: PKT2 }), () => new Date('2026-10-01T13:00:00.000Z'));
    expect(res.status).toBe('BOUND');
    expect(readBindings(layout)).toHaveLength(2);
    expect(findBySession(layout, SID).packet_hash).toBe(PKT2);
    expect(findByStory(layout, 'OMNI-7').map((b) => b.packet_hash)).toEqual([PKT1, PKT2]);
    expect(latestForStory(layout, 'OMNI-7').packet_hash).toBe(PKT2);
    expect(findBySession(layout, SID2)).toBeNull();
    expect(latestForStory(layout, 'OMNI-9')).toBeNull();
    expect(findByStory(layout, 'OMNI-9')).toEqual([]);
  });

  it('keeps several sessions per Story', () => {
    const layout = govFor();
    bindSession(layout, input(), FIXED_NOW);
    bindSession(layout, input({ session_id: SID2 }), FIXED_NOW);
    expect(findByStory(layout, 'OMNI-7').map((b) => b.session_id)).toEqual([SID, SID2]);
    expect(latestForStory(layout, 'OMNI-7').session_id).toBe(SID2);
  });

  it('validates formats and writes nothing on refusal', () => {
    const layout = govFor();
    const bad: Partial<BindInput>[] = [
      { story_key: 'PROJ-1' },
      { session_id: '../etc' },
      { packet_hash: 'sha256:abc' as BindInput['packet_hash'] },
      { base_commit: 'abc' },
      { mode: 'attach', session_file: null },
    ];
    for (const over of bad) expect(bindSession(layout, input(over), FIXED_NOW).status).toBe('REFUSED');
    expect(fs.existsSync(layout.bindingsFile)).toBe(false);
  });

  it('a corrupt ledger line throws instead of being skipped', () => {
    const layout = govFor();
    bindSession(layout, input(), FIXED_NOW);
    fs.appendFileSync(layout.bindingsFile, 'not json\n');
    expect(() => readBindings(layout)).toThrow(/corrupt binding ledger line 2/);
    expect(() => bindSession(layout, input({ session_id: SID2 }), FIXED_NOW)).toThrow(/corrupt/);
  });

  it('GOV_HOME inside a git work tree is refused by govLayout', () => {
    const repo = tmp('gov-repo-');
    fs.mkdirSync(path.join(repo, '.git'));
    expect(() => govLayout({ GOV_HOME: path.join(repo, 'gov') })).toThrow(/outside any git work tree/);
  });
});

describe('newSessionId', () => {
  it('is a fresh lowercase UUID', () => {
    const a = newSessionId();
    expect(a).toMatch(SESSION_ID_RE);
    expect(newSessionId()).not.toBe(a);
  });
});

describe('buildStartCommand', () => {
  it('uses --session-id and an @packet first turn; never --append-system-prompt', () => {
    const packet = path.join('C:/gov home', 'packets', 'OMNI-7', `${'b'.repeat(64)}.md`);
    const cmd = buildStartCommand({ sessionId: SID, worktree: 'C:/tmp/gov-omni-7', packetMarkdownPath: packet, storyKey: 'OMNI-7' });
    expect(cmd.cwd).toBe('C:/tmp/gov-omni-7');
    expect(cmd.argv).toEqual([
      'claude',
      '--session-id',
      SID,
      '--add-dir',
      path.dirname(packet),
      `@${packet} Implement OMNI-7 within the authorized paths in this governed packet.`,
    ]);
    expect(cmd.argv.join(' ')).not.toContain('--append-system-prompt');
    expect(cmd.display).not.toContain('--append-system-prompt');
    expect(cmd.display).toContain(`"${path.dirname(packet)}"`);
    expect(cmd.display).toContain(`--session-id ${SID}`);
  });

  it('rejects invalid ids', () => {
    expect(() => buildStartCommand({ sessionId: 'x', worktree: '/w', packetMarkdownPath: '/p.md', storyKey: 'OMNI-7' })).toThrow();
    expect(() => buildStartCommand({ sessionId: SID, worktree: '/w', packetMarkdownPath: '/p.md', storyKey: 'bad' })).toThrow();
  });
});

describe('buildResumeInstructions', () => {
  const packet = '/home/u/.omnivyra/gov/packets/OMNI-7/x.md';

  it('cds to the recorded cwd, resumes, then hands the packet as a user turn', () => {
    const { steps } = buildResumeInstructions({ sessionId: SID, sessionCwd: 'C:\\work\\my repo', packetMarkdownPath: packet, fork: false });
    expect(steps[0]).toBe('cd "C:\\work\\my repo"');
    expect(steps[1]).toBe(`claude --resume ${SID}`);
    expect(steps[2]).toBe(`In the resumed conversation, type: @${packet}`);
    // --append-system-prompt is only ever mentioned as NOT used
    for (const s of steps.filter((x) => x.includes('--append-system-prompt'))) {
      expect(s).toMatch(/not used/);
      expect(s.startsWith('claude')).toBe(false);
    }
    expect(steps.some((s) => /ignored|ignores/.test(s))).toBe(true);
  });

  it('adds --fork-session when forking', () => {
    const { steps } = buildResumeInstructions({ sessionId: SID, sessionCwd: '/w', packetMarkdownPath: packet, fork: true });
    expect(steps[1]).toBe(`claude --resume ${SID} --fork-session`);
  });

  it('no step modifies the transcript and invalid ids are rejected', () => {
    const { steps } = buildResumeInstructions({ sessionId: SID, sessionCwd: '/w', packetMarkdownPath: packet, fork: false });
    expect(steps.join('\n')).not.toMatch(/\.jsonl|\b(rm|mv|del|sed|echo)\b/);
    expect(() => buildResumeInstructions({ sessionId: '../x', sessionCwd: '/w', packetMarkdownPath: packet, fork: false })).toThrow();
  });
});
