/**
 * gov adoption / existing-chat SAFETY invariants (Track C).
 *
 * These tests pin properties that must hold both before and after the
 * existing-work adoption change (PRE_GOVERNANCE_ADOPTION_BASELINE):
 *   1. no gov module writes git history (only `git worktree add`, from `gov start`);
 *   2. no automatic JEV and no Claude Code hook registration;
 *   3. no Jira write anywhere in the entry path (only judgeFlow's Phase 2 write-back);
 *   4. existing transcripts are byte-, size- and mtime-identical after discovery,
 *      fingerprinting and attach-binding (with and without an `adoption` field);
 *   5. GOV_HOME is never inside a git work tree and nothing is written under the worktree;
 *   6. the packet carries no adoption-specific field, so adoption cannot move packet hashes.
 *
 * Hermetic: static scans of scripts/jev-flow/*.ts plus fake projects dirs, fake
 * worktrees and GOV_HOME under os.tmpdir(). No network, no `claude`, no git
 * process, never reads real ~/.claude transcripts.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as ts from 'typescript';
import { AC_FIELDS, STORY_FIELDS } from '../../../scripts/jev-jira/fields';
import type { JiraIssue } from '../../../scripts/jev-jira/jiraClient';
import { STORY_AUTHORIZED_PATHS_FIELD } from '../../../scripts/jev-flow/jiraQuery';
import { evaluateReadiness } from '../../../scripts/jev-flow/readiness';
import { buildPacket, storePacket } from '../../../scripts/jev-flow/packet';
import { bindSession, readBindings, type BindInput } from '../../../scripts/jev-flow/binding';
import { claudeProjectsDir, findSessionFile, fingerprintSession } from '../../../scripts/jev-flow/session';
import { spawnSpec } from '../../../scripts/jev-flow/verify';
import {
  ADOPTION_CLASSIFICATION,
  canonicalHash,
  govLayout,
  insideGitWorkTree,
  packetHash,
  type GovernedPacket,
  type PacketBase,
  type VerificationRegistry,
} from '../../../scripts/jev-flow/types';

const REPO = path.resolve(__dirname, '../../..');
const FLOW_DIR = path.join(REPO, 'scripts', 'jev-flow');
const REGISTRY = JSON.parse(fs.readFileSync(path.join(FLOW_DIR, 'verification-registry.json'), 'utf8')) as VerificationRegistry;

const FLOW_FILES: string[] = fs
  .readdirSync(FLOW_DIR, { withFileTypes: true })
  .filter((d) => d.isFile() && d.name.endsWith('.ts'))
  .map((d) => d.name)
  .sort();

function src(name: string): string {
  return fs.readFileSync(path.join(FLOW_DIR, name), 'utf8');
}
function parse(name: string, text: string = src(name)): ts.SourceFile {
  return ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}
/** Source with comments removed (so prose that says "no PreToolUse hook" is not a finding). */
function code(name: string): string {
  return ts.createPrinter({ removeComments: true }).printFile(parse(name));
}
function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node);
  node.forEachChild((c) => walk(c, visit));
}
function enclosingFunction(node: ts.Node): ts.SignatureDeclaration | null {
  let cur = node.parent;
  while (cur) {
    if (ts.isFunctionLike(cur)) return cur as ts.SignatureDeclaration;
    cur = cur.parent;
  }
  return null;
}
function functionName(fn: ts.SignatureDeclaration | null): string | null {
  if (!fn) return null;
  if ((ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn)) && fn.name) return fn.name.getText();
  const p = fn.parent;
  if (p && ts.isVariableDeclaration(p)) return p.name.getText();
  if (p && ts.isPropertyAssignment(p)) return p.name.getText();
  return null;
}
/** Names of all enclosing functions, innermost first. */
function functionChain(node: ts.Node): string[] {
  const out: string[] = [];
  let fn = enclosingFunction(node);
  while (fn) {
    out.push(functionName(fn) ?? '<anonymous>');
    fn = enclosingFunction(fn);
  }
  return out;
}
function paramIndex(fn: ts.SignatureDeclaration | null, ident: string): number {
  if (!fn) return -1;
  return fn.parameters.findIndex((p) => ts.isIdentifier(p.name) && p.name.text === ident);
}
/** Nearest enclosing function (walking outward) that declares `ident` as a parameter. */
function paramOwner(node: ts.Node, ident: string): { fn: ts.SignatureDeclaration; index: number } | null {
  let fn = enclosingFunction(node);
  while (fn) {
    const index = paramIndex(fn, ident);
    if (index >= 0) return { fn, index };
    fn = enclosingFunction(fn);
  }
  return null;
}
function literalText(n: ts.Node | undefined): string | null {
  if (n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n))) return n.text;
  return null;
}

// ---------------------------------------------------------------- git-call analyzer

const PROCESS_FNS = new Set(['execFile', 'execFileSync', 'spawn', 'spawnSync', 'exec', 'execSync', 'fork']);
const SHELL_FNS = new Set(['exec', 'execSync']);
const READ_SUBCOMMANDS = new Set([
  'rev-parse',
  'status',
  'diff',
  'rev-list',
  'log',
  'merge-base',
  'symbolic-ref',
  'show',
  'for-each-ref',
  'interpret-trailers',
]);
const FORBIDDEN_SUBCOMMANDS = [
  'commit',
  'push',
  'merge',
  'reset',
  'checkout',
  'switch',
  'restore',
  'stash',
  'rebase',
  'tag',
  'am',
  'apply',
  'cherry-pick',
  'revert',
  'update-ref',
  'branch',
  'notes',
  'fetch',
  'pull',
  'clean',
  'rm',
  'mv',
  'add',
  'gc',
  'config',
  'filter-branch',
  'replace',
];

interface GitCall {
  file: string;
  subcommand: string;
  functions: string[];
}
interface Analysis {
  calls: GitCall[];
  unclassified: string[];
  /** Process launches of a non-git command (literal), e.g. taskkill. */
  otherCommands: string[];
  /** `git` string literals not used as the command of a process call. */
  strayGitLiterals: string[];
}

function sub(file: string, n: ts.Node): string {
  const sf = n.getSourceFile();
  const { line } = sf.getLineAndCharacterOfPosition(n.getStart());
  return `${file}:${line + 1}: ${n.getText().slice(0, 120)}`;
}

/** Classifies a git argv literal; returns the subcommand, a wrapper-param forward, or null (unclassifiable). */
function classifyArgv(
  arr: ts.ArrayLiteralExpression,
): { kind: 'sub'; name: string } | { kind: 'forward'; fn: ts.SignatureDeclaration; index: number } | null {
  const els = arr.elements;
  let i = 0;
  while (i < els.length) {
    const t = literalText(els[i]);
    if (t === '-C' || t === '-c') {
      i += 2;
      continue;
    }
    break;
  }
  const head = els[i];
  if (!head) return null;
  const t = literalText(head);
  if (t !== null) {
    if (t === 'worktree') {
      const t2 = literalText(els[i + 1]);
      return t2 === null ? null : { kind: 'sub', name: `worktree ${t2}` };
    }
    return { kind: 'sub', name: t };
  }
  if (ts.isSpreadElement(head) && ts.isIdentifier(head.expression)) {
    const owner = paramOwner(arr, head.expression.text);
    if (owner) return { kind: 'forward', fn: owner.fn, index: owner.index };
  }
  return null;
}

function analyzeGit(file: string, text: string): Analysis {
  const sf = parse(file, text);
  const out: Analysis = { calls: [], unclassified: [], otherCommands: [], strayGitLiterals: [] };
  const gitCommandLiterals = new Set<ts.Node>();
  /** wrapper function name -> index of its argv parameter */
  const wrappers = new Map<string, number>();

  const handleArgv = (call: ts.CallExpression, arg: ts.Expression | undefined, record: boolean): void => {
    if (arg && ts.isArrayLiteralExpression(arg)) {
      const c = classifyArgv(arg);
      if (c && c.kind === 'sub') {
        if (record) out.calls.push({ file, subcommand: c.name, functions: functionChain(call) });
        return;
      }
      if (c && c.kind === 'forward') {
        const name = functionName(c.fn);
        if (name) {
          wrappers.set(name, c.index);
          return;
        }
      }
    } else if (arg && ts.isIdentifier(arg)) {
      const owner = paramOwner(call, arg.text);
      const name = owner ? functionName(owner.fn) : null;
      if (owner && name) {
        wrappers.set(name, owner.index);
        return;
      }
    }
    if (record) out.unclassified.push(sub(file, call));
  };

  // Fixpoint over wrapper discovery; the final pass records.
  let prev = -1;
  for (let pass = 0; pass < 10 && wrappers.size !== prev; pass++) {
    prev = wrappers.size;
    walk(sf, (n) => {
      if (!ts.isCallExpression(n)) return;
      const callee = n.expression;
      const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : null;
      if (name && PROCESS_FNS.has(name) && ts.isIdentifier(callee)) {
        const cmd = literalText(n.arguments[0]);
        if (cmd === 'git') {
          gitCommandLiterals.add(n.arguments[0]);
          handleArgv(n, n.arguments[1], false);
        }
      } else if (ts.isIdentifier(callee) && wrappers.has(callee.text)) {
        handleArgv(n, n.arguments[wrappers.get(callee.text)], false);
      }
    });
  }
  walk(sf, (n) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      if (n.text === 'git' && !gitCommandLiterals.has(n)) out.strayGitLiterals.push(sub(file, n));
      return;
    }
    if (!ts.isCallExpression(n)) return;
    const callee = n.expression;
    const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : null;
    if (name && PROCESS_FNS.has(name) && (ts.isIdentifier(callee) || /child_process|cp\b/.test(callee.getText()))) {
      if (SHELL_FNS.has(name)) {
        out.unclassified.push(`shell exec: ${sub(file, n)}`);
        return;
      }
      const cmd = literalText(n.arguments[0]);
      if (cmd === 'git') {
        const arg = n.arguments[1];
        // A wrapper's own execFile (argv forwarded from its parameter) is accounted for at its callers.
        const fwdOwner = arg && ts.isIdentifier(arg) ? paramOwner(n, arg.text) : null;
        const fwdArr = arg && ts.isArrayLiteralExpression(arg) ? classifyArgv(arg) : null;
        const isForward =
          (fwdOwner && wrappers.has(functionName(fwdOwner.fn) ?? '')) ||
          (fwdArr && fwdArr.kind === 'forward' && wrappers.has(functionName(fwdArr.fn) ?? ''));
        if (!isForward) handleArgv(n, arg, true);
      } else if (cmd !== null) {
        out.otherCommands.push(cmd);
      } else {
        out.unclassified.push(`dynamic command: ${sub(file, n)}`);
      }
      return;
    }
    if (ts.isIdentifier(callee) && wrappers.has(callee.text)) {
      const arg = n.arguments[wrappers.get(callee.text)];
      const owner = arg && ts.isIdentifier(arg) ? paramOwner(n, arg.text) : null;
      if (owner && wrappers.has(functionName(owner.fn) ?? '')) return;
      handleArgv(n, arg, true);
    }
  });
  return out;
}

/** The single dynamic-command process launch in jev-flow: verify.ts runner, whose command is spawnSpec().command. */
const ALLOWED_DYNAMIC = [/^dynamic command: verify\.ts:\d+: spawn\(spec\.command, spec\.args, spec\.options\)$/];

describe('1. no gov module writes git history', () => {
  const all: Analysis = { calls: [], unclassified: [], otherCommands: [], strayGitLiterals: [] };
  for (const f of FLOW_FILES) {
    const a = analyzeGit(f, src(f));
    all.calls.push(...a.calls);
    all.unclassified.push(...a.unclassified);
    all.otherCommands.push(...a.otherCommands);
    all.strayGitLiterals.push(...a.strayGitLiterals);
  }
  const unexplained = all.unclassified.filter((u) => !ALLOWED_DYNAMIC.some((re) => re.test(u)));

  it('every git invocation is structurally located and classified (no dynamic subcommand, no shell exec)', () => {
    expect(unexplained).toEqual([]);
    expect(all.strayGitLiterals).toEqual([]);
    // Sanity: the analyzer actually found the probe + start calls.
    expect(all.calls.length).toBeGreaterThanOrEqual(8);
    expect(new Set(all.calls.map((c) => c.file))).toEqual(new Set(['cli.ts', 'scope.ts']));
  });

  it('git subcommands are read-only, plus exactly one `worktree add` inside createWorktree', () => {
    const writes = all.calls.filter((c) => !READ_SUBCOMMANDS.has(c.subcommand));
    expect(writes.map((c) => `${c.file}:${c.subcommand}`)).toEqual(['cli.ts:worktree add']);
    expect(writes[0].functions[0]).toBe('createWorktree');
    expect(writes[0].functions).toContain('defaultGovDeps');
    for (const bad of FORBIDDEN_SUBCOMMANDS) {
      expect(all.calls.filter((c) => c.subcommand === bad || c.subcommand.startsWith(`${bad} `))).toEqual([]);
    }
  });

  it('createWorktree is invoked only from the `start` command path', () => {
    const sf = parse('cli.ts');
    const sites: string[][] = [];
    walk(sf, (n) => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'createWorktree') {
        sites.push(functionChain(n));
      }
    });
    expect(sites.length).toBeGreaterThanOrEqual(1);
    for (const chain of sites) expect(chain[chain.length - 1]).toBe('cmdStart');
  });

  it('the only other process launches are taskkill and the node-only verification runner', () => {
    expect([...new Set(all.otherCommands)]).toEqual(['taskkill']);
    expect(spawnSpec(['node', 'x.js'], { cwd: os.tmpdir() }).command).toBe(process.execPath);
    expect(spawnSpec(['node', 'x.js'], { cwd: os.tmpdir() }).options.shell).toBe(false);
    expect(() => spawnSpec(['git', 'commit', '-m', 'x'], { cwd: os.tmpdir() })).toThrow();
  });

  it('no git library is imported by any gov module', () => {
    for (const f of FLOW_FILES) {
      expect(src(f)).not.toMatch(/from ['"](simple-git|isomorphic-git|nodegit|dugite)['"]|require\(['"](simple-git|isomorphic-git|nodegit|dugite)['"]\)/);
    }
  });

  it('analyzer self-check: detects write subcommands and unclassifiable argv in synthetic sources', () => {
    const synthetic = [
      "import { execFile } from 'node:child_process';",
      "function runGit(args: string[]) { return execFile('git', args, () => undefined); }",
      "function wrap(dir: string, args: string[]) { return execFile('git', ['-C', dir, ...args], () => undefined); }",
      "export function a() { return runGit(['-C', 'x', 'commit', '-m', 'y']); }",
      "export function b() { return wrap('x', ['push', 'origin']); }",
      "export function c(v: string[]) { const w = v; return runGit(w); }",
      "export function d(s: string) { return execFile('git', [s], () => undefined); }",
    ].join('\n');
    const a = analyzeGit('synthetic.ts', synthetic);
    expect(a.calls.map((c) => c.subcommand).sort()).toEqual(['commit', 'push']);
    expect(a.unclassified.length).toBe(2);
  });
});

// ---------------------------------------------------------------- 2. no automatic JEV / no hooks

interface ImportRec {
  file: string;
  spec: string;
  names: string[];
  typeOnly: boolean;
}
function importsOf(file: string): ImportRec[] {
  const out: ImportRec[] = [];
  const sf = parse(file);
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
      const clause = st.importClause;
      const names: string[] = [];
      if (clause?.name) names.push(clause.name.text);
      const nb = clause?.namedBindings;
      if (nb && ts.isNamedImports(nb)) for (const e of nb.elements) names.push(e.isTypeOnly ? `type ${e.name.text}` : e.name.text);
      if (nb && ts.isNamespaceImport(nb)) names.push(`* as ${nb.name.text}`);
      out.push({ file, spec: st.moduleSpecifier.text, names, typeOnly: !!clause?.isTypeOnly });
    }
    if (ts.isExportDeclaration(st) && st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)) {
      out.push({ file, spec: st.moduleSpecifier.text, names: ['<re-export>'], typeOnly: !!st.isTypeOnly });
    }
  }
  return out;
}

describe('2. no automatic JEV and no hook registration', () => {
  const imports = FLOW_FILES.flatMap(importsOf);

  it('only judgeFlow.ts imports jev-bjc/judge', () => {
    const hits = imports.filter((i) => /jev-bjc\/judge$/.test(i.spec)).map((i) => i.file);
    expect(hits).toEqual(['judgeFlow.ts']);
  });

  it('jev-bjc/provider is imported only by judgeFlow.ts (type-only) and cli.ts (transport factory names only)', () => {
    const hits = imports.filter((i) => /jev-bjc\/provider$/.test(i.spec));
    expect(hits.map((h) => h.file).sort()).toEqual(['cli.ts', 'judgeFlow.ts']);
    const jf = hits.find((h) => h.file === 'judgeFlow.ts');
    expect(jf.typeOnly || jf.names.every((n) => n.startsWith('type '))).toBe(true);
    const cli = hits.find((h) => h.file === 'cli.ts');
    const allowed = new Set(['createTypeSafeTransport', 'resolveApiKey', 'type JevTransport']);
    for (const n of cli.names) expect(allowed.has(n)).toBe(true);
  });

  it('no dynamic import/require of JEV modules anywhere in jev-flow', () => {
    for (const f of FLOW_FILES) expect(code(f)).not.toMatch(/(require|import)\s*\(\s*['"`][^'"`]*jev-bjc/);
  });

  it('cli.ts constructs a transport only inside the lazy `transport` factory and invokes it only from cmdJudge', () => {
    const sf = parse('cli.ts');
    const construct: string[][] = [];
    const invoke: string[][] = [];
    const judgeRuns: string[][] = [];
    walk(sf, (n) => {
      if (!ts.isCallExpression(n)) return;
      const e = n.expression;
      if (ts.isIdentifier(e) && (e.text === 'createTypeSafeTransport' || e.text === 'resolveApiKey')) construct.push(functionChain(n));
      if (ts.isPropertyAccessExpression(e) && e.name.text === 'transport') invoke.push(functionChain(n));
      if (ts.isIdentifier(e) && e.text === 'runJudgeFlow') judgeRuns.push(functionChain(n));
    });
    expect(construct.length).toBeGreaterThanOrEqual(1);
    for (const chain of construct) expect(chain).toEqual(['transport', 'defaultGovDeps']);
    expect(invoke.length).toBeGreaterThanOrEqual(1);
    for (const chain of invoke) expect(chain[chain.length - 1]).toBe('cmdJudge');
    expect(judgeRuns.length).toBe(1);
    expect(judgeRuns[0][judgeRuns[0].length - 1]).toBe('cmdJudge');
  });

  it('runJudgeFlow is referenced only by cli.ts (and defined in judgeFlow.ts)', () => {
    const users = FLOW_FILES.filter((f) => f !== 'judgeFlow.ts' && /\brunJudgeFlow\b/.test(code(f)));
    expect(users).toEqual(['cli.ts']);
  });

  it('no module contains Claude Code hook tokens or settings writes', () => {
    const HOOK_RE = /\b(PreToolUse|PostToolUse|SessionStart|SessionEnd|UserPromptSubmit|SubagentStop|PreCompact|subagent_type)\b/;
    for (const f of FLOW_FILES) {
      const c = code(f);
      expect({ f, hit: HOOK_RE.exec(c)?.[0] ?? null }).toEqual({ f, hit: null });
      expect({ f, stop: /['"`]Stop['"`]|\bStop\s*:/.test(c) }).toEqual({ f, stop: false });
      expect({ f, hooks: /['"`]hooks['"`]|\bhooks\s*:/.test(c) }).toEqual({ f, hooks: false });
      expect({ f, settings: /settings(\.local)?\.json/.test(c) }).toEqual({ f, settings: false });
    }
  });
});

// ---------------------------------------------------------------- 3. no Jira write in the entry path

describe('3. no Jira write in the entry path', () => {
  const ENTRY = ['jiraQuery.ts', 'readiness.ts', 'packet.ts', 'binding.ts', 'session.ts'];

  it.each(ENTRY)('%s has no PUT/POST/PATCH/DELETE and no advisory/transition write', (f) => {
    const c = code(f);
    expect(c).not.toMatch(/['"`](PUT|POST|PATCH|DELETE)['"`]/);
    expect(c).not.toMatch(/\b(updateAdvisoryFields|writeAdvisoryFields|buildAdvisoryUpdate|transitionIssue|updateIssue|editIssue)\b/);
    expect(c).not.toMatch(/\/transitions\b/);
    expect(importsOf(f).filter((i) => /jev-jira\/writeback$/.test(i.spec))).toEqual([]);
  });

  it('jiraQuery.ts issues GET only', () => {
    const methods = [...code('jiraQuery.ts').matchAll(/method\s*:\s*['"`](\w+)['"`]/g)].map((m) => m[1]);
    expect(methods.length).toBeGreaterThanOrEqual(1);
    expect(new Set(methods)).toEqual(new Set(['GET']));
  });

  it('the only Jira write in jev-flow is Phase 2 writeAdvisoryFields in judgeFlow.ts', () => {
    const writebackImporters = FLOW_FILES.flatMap(importsOf).filter((i) => /jev-jira\/writeback$/.test(i.spec));
    expect(writebackImporters.map((i) => i.file)).toEqual(['judgeFlow.ts']);
    for (const f of FLOW_FILES) {
      const c = code(f);
      expect({ f, direct: /\bupdateAdvisoryFields\b/.test(c) }).toEqual({ f, direct: false });
      if (f !== 'judgeFlow.ts') expect({ f, wb: /\bwriteAdvisoryFields\b/.test(c) }).toEqual({ f, wb: false });
      expect({ f, verbs: /method\s*:\s*['"`](PUT|POST|PATCH|DELETE)['"`]/.test(c) }).toEqual({ f, verbs: false });
    }
    const sf = parse('judgeFlow.ts');
    let calls = 0;
    walk(sf, (n) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'writeAdvisoryFields') calls++;
    });
    expect(calls).toBe(1);
  });
});

// ---------------------------------------------------------------- shared fixtures (4–6)

const tmpDirs: string[] = [];
function tmp(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

/** Recursive listing: relative path -> size (files) or 'dir'. */
function snapshot(dir: string): Record<string, number | 'dir'> {
  const out: Record<string, number | 'dir'> = {};
  const rec = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      const rel = path.relative(dir, p).split(path.sep).join('/');
      if (e.isDirectory()) {
        out[rel] = 'dir';
        rec(p);
      } else out[rel] = fs.statSync(p).size;
    }
  };
  rec(dir);
  return out;
}

const COMMIT = 'c'.repeat(40);
const FIXED_NOW = () => new Date('2026-10-01T12:00:00.000Z');
const sel = (value: string, id = `opt-${value}`) => ({ value, id });

function readyFixture() {
  const story: JiraIssue = {
    key: 'OMNI-10',
    fields: {
      summary: 'Health route hardening',
      issuetype: { id: '10005' },
      project: { id: '10033' },
      status: { id: '10036', name: 'In Progress' },
      updated: '2026-10-01T09:00:00.000+0000',
      [STORY_FIELDS.objective]: 'Harden the health route',
      [STORY_FIELDS.architecture]: 'Route handler only',
      [STORY_FIELDS.invariants]: 'No route skips auth',
      [STORY_AUTHORIZED_PATHS_FIELD]: 'pages/api/health/**',
      [STORY_FIELDS.prohibitedPaths]: 'supabase/**',
      [STORY_FIELDS.verificationRequirements]: 'jev.unit',
    },
  };
  const ac = (n: number): JiraIssue => ({
    key: `OMNI-${n}`,
    fields: {
      summary: `AC ${n}`,
      issuetype: { id: '10074' },
      project: { id: '10033' },
      status: { id: '10037', name: 'Open' },
      parent: { key: 'OMNI-10' },
      updated: '2026-10-01T10:00:00.000+0000',
      [AC_FIELDS.acId]: `AC-${n}`,
      [AC_FIELDS.statement]: `Statement ${n}`,
      [AC_FIELDS.kind]: sel('Deterministic'),
      [AC_FIELDS.evidenceKind]: sel('Test'),
      [AC_FIELDS.verification]: sel('UNVERIFIED'),
    },
  });
  const r = evaluateReadiness('OMNI-10', story, [ac(11), ac(12)], REGISTRY);
  if (!r.ready) throw new Error(`fixture not ready: ${JSON.stringify(r.findings)}`);
  return r;
}

/** A fake repository/worktree: a directory with a `.git` entry (dir or gitlink file). */
function fakeWorktree(gitlink = false): string {
  const wt = tmp('gov-adopt-wt-');
  if (gitlink) fs.writeFileSync(path.join(wt, '.git'), 'gitdir: /nowhere/.git/worktrees/x\n');
  else fs.mkdirSync(path.join(wt, '.git'));
  fs.writeFileSync(path.join(wt, 'README.md'), 'existing work\n');
  return wt;
}

// ---------------------------------------------------------------- 4. transcript immutability

describe('4. existing transcripts are immutable at the session layer', () => {
  const SID_A = '11111111-2222-4333-8444-555555555555';
  const SID_B = '66666666-7777-4888-9999-aaaaaaaaaaaa';

  function realisticTranscript(cwd: string, branch: string): Buffer {
    const lines = [
      JSON.stringify({ type: 'summary', summary: 'earlier chat', leafUuid: 'x' }),
      '{this is not json',
      JSON.stringify({ type: 'user', sessionId: SID_A, message: { role: 'user', content: 'hello' } }),
      JSON.stringify({ type: 'user', cwd, gitBranch: branch, version: '2.0.0', message: { role: 'user', content: 'do the thing' } }),
      JSON.stringify({ type: 'assistant', cwd: 'C:\\elsewhere', gitBranch: 'other', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } }),
      JSON.stringify({ type: 'tool_result', content: 'P'.repeat(1024 * 1024) }),
      '',
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'unicode \u00e9\u4e2d\ud83d\ude00' } }),
    ];
    // Mixed line endings and no trailing newline, exactly as a live transcript might be.
    return Buffer.from(lines.slice(0, 4).join('\n') + '\r\n' + lines.slice(4).join('\n'), 'utf8');
  }

  function setup() {
    const projects = tmp('gov-adopt-projects-');
    const wt = fakeWorktree();
    const slugA = path.join(projects, 'C--tmp-existing-chat');
    const slugB = path.join(projects, 'C--tmp-other-chat');
    fs.mkdirSync(slugA);
    fs.mkdirSync(slugB);
    const fileA = path.join(slugA, `${SID_A}.jsonl`);
    const fileB = path.join(slugB, `${SID_B}.jsonl`);
    fs.writeFileSync(fileA, realisticTranscript(wt, 'feature/existing'));
    fs.writeFileSync(fileB, realisticTranscript(wt, 'feature/existing'));
    // Subagent transcript beside it (ignored by discovery, must also stay untouched).
    fs.mkdirSync(path.join(slugA, SID_A, 'subagents'), { recursive: true });
    fs.writeFileSync(path.join(slugA, SID_A, 'subagents', 'agent-1.jsonl'), '{"type":"user"}\n');
    const past = new Date('2026-09-01T00:00:00.000Z');
    for (const f of [fileA, fileB]) fs.utimesSync(f, past, past);
    const home = tmp('gov-adopt-home-');
    return { projects, wt, fileA, fileB, env: { CLAUDE_PROJECTS_DIR: projects }, layout: govLayout({ GOV_HOME: home }), home };
  }

  function state(file: string) {
    const st = fs.statSync(file);
    return { bytes: fs.readFileSync(file), size: st.size, mtimeMs: st.mtimeMs, mode: st.mode };
  }

  it('find + fingerprint + attach-bind (with and without adoption) leaves transcripts and the projects dir unchanged', () => {
    const s = setup();
    const before = { a: state(s.fileA), b: state(s.fileB), tree: snapshot(s.projects) };

    const fileA = findSessionFile(SID_A, s.env);
    const fileB = findSessionFile(SID_B, s.env);
    expect(fileA).toBe(path.resolve(s.fileA));
    expect(fileB).toBe(path.resolve(s.fileB));
    const fpA = fingerprintSession(fileA);
    const fpB = fingerprintSession(fileB);
    expect(fpA.bytes).toBe(before.a.size);
    expect(fpA.sha256).toBe(fpB.sha256);
    expect(fpA.cwd).toBe(s.wt);
    expect(fpA.git_branch).toBe('feature/existing');

    const base: Omit<BindInput, 'session_id' | 'session_file'> = {
      story_key: 'OMNI-10',
      packet_hash: canonicalHash({ packet: 'adopt' }),
      mode: 'attach',
      worktree: s.wt,
      branch: 'feature/existing',
      base_commit: COMMIT,
    };
    const plain = bindSession(s.layout, { ...base, session_id: SID_A, session_file: fpA }, FIXED_NOW);
    expect(plain.status).toBe('BOUND');
    const adoptInput = {
      ...base,
      session_id: SID_B,
      session_file: fpB,
      adoption: { baseline_commit: COMMIT, classification: ADOPTION_CLASSIFICATION },
    } as BindInput;
    const adopted = bindSession(s.layout, adoptInput, FIXED_NOW);
    // Ledger content for `adoption` is owned by another track; only require a non-error outcome.
    expect(['BOUND', 'REFUSED']).toContain(adopted.status);
    // Re-fingerprint (a second read) and re-bind idempotently.
    expect(fingerprintSession(fileA).sha256).toBe(fpA.sha256);
    expect(bindSession(s.layout, { ...base, session_id: SID_A, session_file: fpA }, FIXED_NOW).status).toBe('ALREADY_BOUND');

    const after = { a: state(s.fileA), b: state(s.fileB), tree: snapshot(s.projects) };
    expect(after.a.bytes.equals(before.a.bytes)).toBe(true);
    expect(after.b.bytes.equals(before.b.bytes)).toBe(true);
    expect(after.a.size).toBe(before.a.size);
    expect(after.b.size).toBe(before.b.size);
    expect(after.a.mtimeMs).toBe(before.a.mtimeMs);
    expect(after.b.mtimeMs).toBe(before.b.mtimeMs);
    expect(after.a.mode).toBe(before.a.mode);
    expect(after.tree).toEqual(before.tree);
    // The ledger lives under GOV_HOME only, and still parses.
    expect(fs.existsSync(s.layout.bindingsFile)).toBe(true);
    expect(path.relative(s.home, s.layout.bindingsFile).startsWith('..')).toBe(false);
    expect(readBindings(s.layout).length).toBeGreaterThanOrEqual(1);
    // Nothing was written into the worktree either.
    expect(snapshot(s.wt)).toEqual({ '.git': 'dir', 'README.md': 14 });
  });

  it('session.ts has no filesystem write API and opens transcripts read-only', () => {
    const c = code('session.ts');
    expect(c).not.toMatch(
      /\b(writeFile|writeFileSync|appendFile|appendFileSync|mkdir|mkdirSync|rename|renameSync|unlink|unlinkSync|utimes|utimesSync|futimes|futimesSync|copyFile|copyFileSync|rm|rmSync|truncate|truncateSync|ftruncate|createWriteStream|chmod|chmodSync|symlink|link)\s*\(/,
    );
    const opens = [...c.matchAll(/openSync\(([^)]*)\)/g)].map((m) => m[1]);
    for (const args of opens) expect(args).toMatch(/,\s*['"]r['"]\s*$/);
    expect(c).not.toMatch(/child_process|execFile|spawn\(/);
  });
});

// ---------------------------------------------------------------- 5. GOV_HOME outside any work tree; no writes under the worktree

describe('5. GOV_HOME is never inside a git work tree; packets/bindings never land in the worktree', () => {
  it('govLayout refuses GOV_HOME at or under a git work tree (directory or gitlink .git)', () => {
    for (const gitlink of [false, true]) {
      const wt = fakeWorktree(gitlink);
      const before = snapshot(wt);
      expect(insideGitWorkTree(wt)).toBe(true);
      expect(() => govLayout({ GOV_HOME: wt })).toThrow(/outside any git work tree/);
      expect(() => govLayout({ GOV_HOME: path.join(wt, '.gov') })).toThrow(/outside any git work tree/);
      expect(() => govLayout({ GOV_HOME: path.join(wt, 'deep', 'nested', 'gov') })).toThrow(/outside any git work tree/);
      // Refusal creates nothing.
      expect(snapshot(wt)).toEqual(before);
    }
    expect(() => govLayout({ GOV_HOME: REPO })).toThrow(/outside any git work tree/);
    expect(() => govLayout({ GOV_HOME: path.join(REPO, 'scripts', 'jev-flow') })).toThrow(/outside any git work tree/);
  });

  it('a projects dir placed inside a work tree cannot be used as GOV_HOME', () => {
    const wt = fakeWorktree();
    const projects = path.join(wt, '.claude', 'projects');
    expect(() => govLayout({ GOV_HOME: projects })).toThrow(/outside any git work tree/);
    expect(fs.existsSync(path.join(wt, '.claude'))).toBe(false);
  });

  it('the default transcript dir does not derive from the cwd / repository', () => {
    const dir = claudeProjectsDir({});
    expect(dir).toBe(path.resolve(path.join(os.homedir(), '.claude', 'projects')));
    expect(path.relative(REPO, dir).startsWith('..')).toBe(true);
  });

  it('every layout path resolves under GOV_HOME', () => {
    const home = tmp('gov-adopt-home-');
    const l = govLayout({ GOV_HOME: home });
    const h = canonicalHash({ x: 1 });
    const paths = [l.packetsDir('OMNI-10'), l.packetFile('OMNI-10', h, 'json'), l.packetFile('OMNI-10', h, 'md'), l.bindingsFile, l.evidenceDir('OMNI-10'), l.evidenceFile('OMNI-10', h), l.logFile('OMNI-10', h)];
    for (const p of paths) {
      const rel = path.relative(home, p);
      expect(rel.startsWith('..') || path.isAbsolute(rel)).toBe(false);
    }
  });

  it('storePacket + bindSession (attach, with adoption) write only under GOV_HOME, never under the worktree', () => {
    const wt = fakeWorktree();
    const home = tmp('gov-adopt-home-');
    const layout = govLayout({ GOV_HOME: home });
    const wtBefore = snapshot(wt);
    const pbase: PacketBase = { commit: COMMIT, branch: 'feature/existing', worktree: wt };
    const stored = storePacket(layout, buildPacket(readyFixture(), pbase));
    const projects = tmp('gov-adopt-projects-');
    const sid = '12345678-1234-4234-8234-123456789abc';
    fs.mkdirSync(path.join(projects, 'slug'));
    fs.writeFileSync(path.join(projects, 'slug', `${sid}.jsonl`), `${JSON.stringify({ cwd: wt, gitBranch: 'feature/existing' })}\n`);
    const fp = fingerprintSession(findSessionFile(sid, { CLAUDE_PROJECTS_DIR: projects }));
    bindSession(
      layout,
      {
        story_key: 'OMNI-10',
        packet_hash: stored.packet_hash,
        session_id: sid,
        mode: 'attach',
        worktree: wt,
        branch: 'feature/existing',
        base_commit: COMMIT,
        session_file: fp,
        adoption: { baseline_commit: COMMIT, classification: ADOPTION_CLASSIFICATION },
      } as BindInput,
      FIXED_NOW,
    );
    expect(snapshot(wt)).toEqual(wtBefore);
    const written = Object.keys(snapshot(home));
    expect(written).toEqual(expect.arrayContaining(['bindings.jsonl', 'packets', 'packets/OMNI-10']));
    expect(written.some((p) => p.endsWith('.json'))).toBe(true);
  });
});

// ---------------------------------------------------------------- 6. packet schema carries no adoption field

describe('6. the packet carries no adoption-specific field', () => {
  const PACKET_KEYS = ['acceptance_criteria', 'base', 'governance_version', 'rules', 'schema', 'scope', 'story', 'verification'];

  function allKeys(v: unknown, out: Set<string> = new Set()): Set<string> {
    if (Array.isArray(v)) v.forEach((x) => allKeys(x, out));
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        out.add(k);
        allKeys(x, out);
      }
    }
    return out;
  }

  it('buildPacket output keys are exactly the GovernedPacket keys', () => {
    const p = buildPacket(readyFixture(), { commit: COMMIT, branch: 'gov/OMNI-10', worktree: 'C:\\tmp\\gov-omni-10' });
    expect(Object.keys(p).sort()).toEqual(PACKET_KEYS);
    expect(Object.keys(p.base).sort()).toEqual(['branch', 'commit', 'worktree']);
  });

  it('no nested packet key mentions adoption / baseline / pre-governance', () => {
    const p = buildPacket(readyFixture(), { commit: COMMIT, branch: 'gov/OMNI-10', worktree: 'C:\\tmp\\gov-omni-10' });
    const keys = [...allKeys(p)];
    expect(keys.filter((k) => /adopt|baseline|pre_?governance|classification/i.test(k))).toEqual([]);
    expect(JSON.stringify(p)).not.toContain(ADOPTION_CLASSIFICATION);
  });

  it('packet hash depends only on the packet: identical inputs hash identically, and binding with adoption does not alter stored packet bytes', () => {
    const home = tmp('gov-adopt-home-');
    const layout = govLayout({ GOV_HOME: home });
    const pbase: PacketBase = { commit: COMMIT, branch: 'gov/OMNI-10', worktree: 'C:\\tmp\\gov-omni-10' };
    const p1: GovernedPacket = buildPacket(readyFixture(), pbase);
    const p2: GovernedPacket = buildPacket(readyFixture(), pbase);
    expect(packetHash(p1)).toBe(packetHash(p2));
    const stored = storePacket(layout, p1);
    expect(stored.packet_hash).toBe(packetHash(p1));
    const jsonFile = layout.packetFile('OMNI-10', stored.packet_hash, 'json');
    const mdFile = layout.packetFile('OMNI-10', stored.packet_hash, 'md');
    const before = [fs.readFileSync(jsonFile), fs.readFileSync(mdFile)];
    bindSession(
      layout,
      {
        story_key: 'OMNI-10',
        packet_hash: stored.packet_hash,
        session_id: '99999999-8888-4777-8666-555555555555',
        mode: 'attach',
        worktree: pbase.worktree,
        branch: pbase.branch,
        base_commit: COMMIT,
        session_file: { path: 'C:\\x.jsonl', sha256: canonicalHash({ t: 1 }), bytes: 1, cwd: null, git_branch: null },
        adoption: { baseline_commit: COMMIT, classification: ADOPTION_CLASSIFICATION },
      } as BindInput,
      FIXED_NOW,
    );
    expect(fs.readFileSync(jsonFile).equals(before[0])).toBe(true);
    expect(fs.readFileSync(mdFile).equals(before[1])).toBe(true);
    expect(storePacket(layout, p2).packet_hash).toBe(stored.packet_hash);
  });

  it('packet.ts and the packetHash formula reference no adoption type', () => {
    expect(code('packet.ts')).not.toMatch(/\b(adoption|AdoptionBaseline|ADOPTION_CLASSIFICATION)\b/);
    const types = parse('types.ts');
    let packetIface: ts.InterfaceDeclaration | null = null;
    walk(types, (n) => {
      if (ts.isInterfaceDeclaration(n) && n.name.text === 'GovernedPacket') packetIface = n;
    });
    expect(packetIface).not.toBeNull();
    const members = (packetIface as ts.InterfaceDeclaration).members.map((m) => m.name.getText()).sort();
    expect(members).toEqual(PACKET_KEYS);
  });
});
