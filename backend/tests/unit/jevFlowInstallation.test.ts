/**
 * OMNI-13 — governed Claude adoption layer installation.
 *
 * The repository-root CLAUDE.md and the user-invoked /gov project skill
 * (.claude/skills/gov/SKILL.md) are explicit guidance only. These tests pin
 * that they are installed (not drafts), that every gov invocation they show is
 * accepted by the real CLI, that they document the governed entry points and
 * existing-work adoption, and that nothing registers a hook or any automatic
 * interception. Read-only: no network, no git writes, nothing launched.
 */
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(__dirname, '../../..');
const CLAUDE_MD = path.join(REPO, 'CLAUDE.md');
const SKILL_MD = path.join(REPO, '.claude', 'skills', 'gov', 'SKILL.md');
const CLI_TS = path.join(REPO, 'scripts', 'jev-flow', 'cli.ts');

const read = (f: string) => fs.readFileSync(f, 'utf8');
const HOOK_EVENTS = ['PreToolUse', 'PostToolUse', 'SessionStart', 'SessionEnd', 'UserPromptSubmit', 'Notification', 'SubagentStop', 'PreCompact'];

/** Verb → { all flags, required flags } parsed from the CLI's own USAGE text. */
function cliSpec(): Record<string, { all: Set<string>; required: Set<string> }> {
  const usage = /const USAGE = \[([\s\S]*?)\]\.join/.exec(read(CLI_TS));
  if (!usage) throw new Error('cli.ts USAGE not found');
  const spec: Record<string, { all: Set<string>; required: Set<string> }> = {};
  for (const m of usage[1].matchAll(/'\s+([a-z-]+)\s+(--.*?)',?$/gm)) {
    const optional = new Set([...m[2].matchAll(/\[(--[a-z-]+)/g)].map((x) => x[1]));
    const all = new Set([...m[2].matchAll(/(--[a-z-]+)/g)].map((x) => x[1]));
    spec[m[1]] = { all, required: new Set([...all].filter((f) => !optional.has(f))) };
  }
  return spec;
}

/** Full gov invocations (those naming --story) shown in a document. */
function invocations(text: string): Array<{ verb: string; flags: string[]; raw: string }> {
  return [...text.matchAll(/gov ([a-z-]+)((?: \[?--[a-z-]+(?: [^\s`|\]]+)?\]?)+)/g)]
    .filter((m) => m[2].includes('--story'))
    .map((m) => ({ verb: m[1], flags: [...m[2].matchAll(/(--[a-z-]+)/g)].map((x) => x[1]), raw: m[0] }));
}

describe('OMNI-13 AC-1 — CLAUDE.md installed', () => {
  it('exists at the repository root, is not a draft, and carries the governed-workflow sections', () => {
    expect(fs.existsSync(CLAUDE_MD)).toBe(true);
    const text = read(CLAUDE_MD);
    expect(text).not.toMatch(/DRAFT/);
    for (const heading of ['## Governed engineering work', '## Evidence and authority', '## Human-only actions', '## Prohibited']) {
      expect(text).toContain(heading);
    }
  });

  it('documents new work, existing-work adoption and the authority model', () => {
    const text = read(CLAUDE_MD);
    for (const phrase of [
      'gov start',
      '--repo',
      'gov attach',
      'PRE_GOVERNANCE_ADOPTION_BASELINE',
      'Governed-By: OMNI-n',
      'Gov-Packet',
      'Adoption never creates commits, writes Jira, invokes JEV or modifies Claude',
      'Deterministic evidence is authoritative',
      'JEV is advisory only',
      'evidence-only Story',
      'never merges',
      'Merging, releasing and deploying',
    ]) {
      expect(text).toContain(phrase);
    }
  });
});

describe('OMNI-13 AC-2 — /gov skill installed', () => {
  it('exists with frontmatter name "gov" and a user-invoked description, not a draft', () => {
    expect(fs.existsSync(SKILL_MD)).toBe(true);
    const text = read(SKILL_MD);
    expect(text).not.toMatch(/DRAFT/);
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    expect(fm).not.toBeNull();
    const front = (fm as RegExpExecArray)[1];
    expect(front).toMatch(/^name: gov$/m);
    expect(front).toMatch(/^description: User-invoked\./m);
    expect(Object.keys(Object.fromEntries(front.split(/\r?\n/).map((l) => [l.split(':')[0].trim(), true])))).toEqual(['name', 'description']);
  });

  it('keeps the human boundary: never write-back, transition, merge, release, deploy or create the adoption baseline', () => {
    const text = read(SKILL_MD);
    for (const phrase of ['Run `gov judge --write-back`.', 'Transition Jira', 'Merge, release or deploy.', 'Never create that commit yourself.', 'Create the adoption-baseline commit']) {
      expect(text).toContain(phrase);
    }
  });
});

describe('OMNI-13 AC-3 — every documented gov invocation matches the real CLI', () => {
  const spec = cliSpec();

  it('the CLI usage text was parsed for every verb', () => {
    expect(Object.keys(spec).sort()).toEqual(['attach', 'check-merge', 'judge', 'packet', 'start', 'submit', 'verify']);
    expect([...spec.start.required]).toEqual(expect.arrayContaining(['--story', '--slug', '--repo']));
  });

  it.each([
    ['CLAUDE.md', CLAUDE_MD],
    ['SKILL.md', SKILL_MD],
  ])('%s: only accepted flags, all required flags present', (_name, file) => {
    const found = invocations(read(file));
    expect(found.length).toBeGreaterThan(0);
    for (const inv of found) {
      expect(spec[inv.verb]).toBeDefined();
      const unknown = inv.flags.filter((f) => !spec[inv.verb].all.has(f));
      const missing = [...spec[inv.verb].required].filter((r) => !inv.flags.includes(r));
      expect({ invocation: inv.raw, unknown, missing }).toEqual({ invocation: inv.raw, unknown: [], missing: [] });
    }
  });

  it('gov start is documented with --repo in both files', () => {
    for (const file of [CLAUDE_MD, SKILL_MD]) {
      const starts = invocations(read(file)).filter((i) => i.verb === 'start');
      expect(starts.length).toBeGreaterThan(0);
      for (const s of starts) expect(s.flags).toContain('--repo');
    }
  });
});

describe('OMNI-13 AC-4 — no hooks', () => {
  it('no .claude/settings*.json declares a hooks key', () => {
    const dir = path.join(REPO, '.claude');
    const settings = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^settings.*\.json$/.test(f)) : [];
    for (const f of settings) {
      const json = JSON.parse(read(path.join(dir, f))) as Record<string, unknown>;
      expect({ file: f, hasHooks: Object.prototype.hasOwnProperty.call(json, 'hooks') }).toEqual({ file: f, hasHooks: false });
    }
  });

  it('there is no hooks directory and the skill registers no hook', () => {
    expect(fs.existsSync(path.join(REPO, '.claude', 'hooks'))).toBe(false);
    const skill = read(SKILL_MD);
    expect(skill).not.toMatch(/^hooks\s*:/m);
    for (const event of HOOK_EVENTS) expect(skill).not.toContain(event);
  });

  it('the skill directory contains only SKILL.md (no scripts it could auto-run)', () => {
    expect(fs.readdirSync(path.dirname(SKILL_MD))).toEqual(['SKILL.md']);
  });
});

describe('OMNI-13 AC-5 — no automatic or hidden interception', () => {
  it('neither file references a hook event or claims automatic invocation', () => {
    for (const file of [CLAUDE_MD, SKILL_MD]) {
      const text = read(file);
      for (const event of HOOK_EVENTS) expect(text).not.toContain(event);
      expect(text).not.toMatch(/automatically (runs|invokes|intercepts)|on every (prompt|session)/i);
    }
  });

  it('both files state the explicit-only model', () => {
    expect(read(CLAUDE_MD)).toContain('There are no hooks and no automatic routing');
    expect(read(SKILL_MD)).toMatch(/^description: User-invoked\. .*Use only when the user asks for governed work or types \/gov\.$/m);
  });
});
