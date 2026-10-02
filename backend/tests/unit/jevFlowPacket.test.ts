/**
 * gov packet: build, hash, render, store/load integrity, staleness.
 * No network; GOV_HOME is a fresh temp dir per test.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AC_FIELDS, STORY_FIELDS } from '../../../scripts/jev-jira/fields';
import type { JiraIssue } from '../../../scripts/jev-jira/jiraClient';
import { STORY_AUTHORIZED_PATHS_FIELD } from '../../../scripts/jev-flow/jiraQuery';
import { evaluateReadiness } from '../../../scripts/jev-flow/readiness';
import { buildPacket, detectStale, loadPacket, renderPacketMarkdown, storePacket } from '../../../scripts/jev-flow/packet';
import { HUMAN_ONLY_RULES, govLayout, packetHash, type GovLayout, type PacketBase, type VerificationRegistry } from '../../../scripts/jev-flow/types';

const REPO = path.resolve(__dirname, '../../..');
const REGISTRY = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts', 'jev-flow', 'verification-registry.json'), 'utf8')) as VerificationRegistry;
// Built at runtime so no credential-shaped literal exists in the source.
const FAKE_JIRA_TOKEN = ['ATATT3x', 'Z'.repeat(40)].join('');
const FAKE_OPENAI_KEY = ['sk', 'Q'.repeat(30)].join('-');
const BASE: PacketBase = { commit: 'a'.repeat(40), branch: 'gov/OMNI-10', worktree: 'C:\\tmp\\gov-omni-10' };

const sel = (value: string, id = `opt-${value}`) => ({ value, id });

function storyFields(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    summary: 'Health route hardening',
    issuetype: { id: '10005' },
    project: { id: '10033' },
    status: { id: '10036', name: 'In Progress' },
    updated: '2026-10-01T09:00:00.000+0000',
    [STORY_FIELDS.objective]: 'Harden the health route',
    [STORY_FIELDS.architecture]: 'Route handler only',
    [STORY_FIELDS.invariants]: 'No route skips auth\nNo schema change',
    [STORY_AUTHORIZED_PATHS_FIELD]: 'pages/api/health/**',
    [STORY_FIELDS.prohibitedPaths]: 'supabase/**',
    [STORY_FIELDS.verificationRequirements]: 'jev.unit\nscripts.typecheck',
    ...over,
  };
}
const story = (over: Record<string, unknown> = {}): JiraIssue => ({ key: 'OMNI-10', fields: storyFields(over) });

function acFields(n: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
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
    ...over,
  };
}
const ac = (n: number, over: Record<string, unknown> = {}): JiraIssue => ({ key: `OMNI-${n}`, fields: acFields(n, over) });

function ready(s: JiraIssue = story(), acs: JiraIssue[] = [ac(11), ac(12)], registry = REGISTRY) {
  const r = evaluateReadiness('OMNI-10', s, acs, registry);
  if (!r.ready) throw new Error(`fixture not ready: ${JSON.stringify(r.findings)}`);
  return r;
}

/** Deep copy with object keys in reverse order (same JSON value, different key order). */
function reverseKeys<T>(v: T): T {
  if (Array.isArray(v)) return v.map(reverseKeys) as unknown as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).reverse().map((k) => [k, reverseKeys((v as Record<string, unknown>)[k])])) as T;
  return v;
}

let home: string;
let layout: GovLayout;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-packet-'));
  layout = govLayout({ GOV_HOME: home });
});
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

describe('buildPacket', () => {
  it('builds from a READY result; normalizes the worktree; carries the human-only rules', () => {
    const p = buildPacket(ready(), BASE);
    expect(p.schema).toBe('gov-packet/1');
    expect(p.governance_version).toBe('gov-flow/1');
    expect(p.base).toEqual({ commit: 'a'.repeat(40), branch: 'gov/OMNI-10', worktree: 'C:/tmp/gov-omni-10' });
    expect(p.rules).toEqual([...HUMAN_ONLY_RULES]);
    expect(p.acceptance_criteria.map((a) => a.ac_id)).toEqual(['AC-11', 'AC-12']);
  });

  it('refuses a NOT_READY result and a bad base commit', () => {
    expect(() => buildPacket(evaluateReadiness('OMNI-10', story(), [], REGISTRY), BASE)).toThrow(/not ready/);
    expect(() => buildPacket(ready(), { ...BASE, commit: 'abc1234' })).toThrow(/40-hex/);
    expect(() => buildPacket(ready(), { ...BASE, commit: 'A'.repeat(40) })).toThrow(/40-hex/);
  });
});

describe('packet hash', () => {
  it('same input → same hash, also when raw Jira JSON keys are reordered', () => {
    const a = packetHash(buildPacket(ready(), BASE));
    const b = packetHash(buildPacket(ready(), BASE));
    const c = packetHash(buildPacket(ready(reverseKeys(story()), [ac(12), ac(11)].map(reverseKeys), reverseKeys(REGISTRY)), BASE));
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it.each<[string, () => string]>([
    ['story summary', () => packetHash(buildPacket(ready(story({ summary: 'Other' })), BASE))],
    ['story updated', () => packetHash(buildPacket(ready(story({ updated: '2026-10-02T00:00:00.000+0000' })), BASE))],
    ['objective', () => packetHash(buildPacket(ready(story({ [STORY_FIELDS.objective]: 'x' })), BASE))],
    ['invariants', () => packetHash(buildPacket(ready(story({ [STORY_FIELDS.invariants]: 'only one' })), BASE))],
    ['authorized paths', () => packetHash(buildPacket(ready(story({ [STORY_AUTHORIZED_PATHS_FIELD]: 'pages/**' })), BASE))],
    ['prohibited paths', () => packetHash(buildPacket(ready(story({ [STORY_FIELDS.prohibitedPaths]: '' })), BASE))],
    ['registry ids', () => packetHash(buildPacket(ready(story({ [STORY_FIELDS.verificationRequirements]: 'jev.unit' })), BASE))],
    ['AC statement', () => packetHash(buildPacket(ready(story(), [ac(11, { [AC_FIELDS.statement]: 'changed' }), ac(12)]), BASE))],
    ['AC updated', () => packetHash(buildPacket(ready(story(), [ac(11, { updated: '2026-10-03T00:00:00.000+0000' }), ac(12)]), BASE))],
    ['AC verification', () => packetHash(buildPacket(ready(story(), [ac(11, { [AC_FIELDS.verification]: sel('VERIFIED') }), ac(12)]), BASE))],
    ['AC set', () => packetHash(buildPacket(ready(story(), [ac(11)]), BASE))],
    ['base commit', () => packetHash(buildPacket(ready(), { ...BASE, commit: 'b'.repeat(40) }))],
    ['base branch', () => packetHash(buildPacket(ready(), { ...BASE, branch: 'gov/other' }))],
    ['base worktree', () => packetHash(buildPacket(ready(), { ...BASE, worktree: 'C:/tmp/other' }))],
    [
      'registry entry',
      () => {
        const reg = JSON.parse(JSON.stringify(REGISTRY)) as VerificationRegistry;
        reg.entries[0].timeout_ms += 1;
        return packetHash(buildPacket(ready(story(), [ac(11), ac(12)], reg), BASE));
      },
    ],
  ])('mutating %s changes the hash', (_name, mutated) => {
    expect(mutated()).not.toBe(packetHash(buildPacket(ready(), BASE)));
  });
});

describe('renderPacketMarkdown', () => {
  it('is deterministic and carries the work order', () => {
    const p = buildPacket(ready(), BASE);
    const stored = { packet: p, packet_hash: packetHash(p) };
    const md = renderPacketMarkdown(stored);
    expect(renderPacketMarkdown(JSON.parse(JSON.stringify(stored)))).toBe(md);
    for (const needle of [
      'OMNI-10',
      'Health route hardening',
      'Harden the health route',
      'Route handler only',
      'No schema change',
      '`pages/api/health/**`',
      '`supabase/**`',
      '### OMNI-11 — AC-11',
      'Statement 12',
      'Evidence kind: Test',
      '`jev.unit`',
      '`scripts.typecheck`',
      'a'.repeat(40),
      'gov/OMNI-10',
      'C:/tmp/gov-omni-10',
      stored.packet_hash,
      `Governed-By: OMNI-10`,
      `Gov-Packet: ${stored.packet_hash}`,
      'gov verify',
      ...HUMAN_ONLY_RULES,
    ]) {
      expect(md).toContain(needle);
    }
    expect(md).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
  });
});

describe('storePacket / loadPacket', () => {
  it('writes <hash>.json and <hash>.md under GOV_HOME, idempotently, and loads them back', () => {
    const p = buildPacket(ready(), BASE);
    const stored = storePacket(layout, p);
    const json = layout.packetFile('OMNI-10', stored.packet_hash, 'json');
    const md = layout.packetFile('OMNI-10', stored.packet_hash, 'md');
    expect(json.startsWith(home)).toBe(true);
    expect(fs.existsSync(json) && fs.existsSync(md)).toBe(true);
    const bytes = fs.readFileSync(json, 'utf8');
    expect(storePacket(layout, buildPacket(ready(), BASE))).toEqual(stored);
    expect(fs.readFileSync(json, 'utf8')).toBe(bytes);
    expect(loadPacket(layout, 'OMNI-10', stored.packet_hash)).toEqual(stored);
  });

  it('throws if an existing file for the same hash has different bytes', () => {
    const stored = storePacket(layout, buildPacket(ready(), BASE));
    fs.writeFileSync(layout.packetFile('OMNI-10', stored.packet_hash, 'md'), 'tampered');
    expect(() => storePacket(layout, buildPacket(ready(), BASE))).toThrow(/different content/);
  });

  it.each([FAKE_JIRA_TOKEN, `token=${FAKE_JIRA_TOKEN}`, FAKE_OPENAI_KEY])('refuses credential-shaped text in an AC Statement (%#) and writes nothing', (secret) => {
    const r = ready(story(), [ac(11, { [AC_FIELDS.statement]: `Call the API with ${secret}` }), ac(12)]);
    expect(() => storePacket(layout, buildPacket(r, BASE))).toThrow(/credential-shaped/);
    let message = '';
    try {
      storePacket(layout, buildPacket(r, BASE));
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).not.toContain(secret);
    expect(fs.existsSync(path.join(home, 'packets'))).toBe(false);
  });

  it('a fresh store contains no credential-shaped text', () => {
    const stored = storePacket(layout, buildPacket(ready(), BASE));
    const all = ['json', 'md'].map((ext) => fs.readFileSync(layout.packetFile('OMNI-10', stored.packet_hash, ext as 'json' | 'md'), 'utf8')).join('\n');
    expect(all).not.toMatch(/ATATT|Bearer |sk-/);
  });

  it('loadPacket detects tampering, wrong hash and wrong story', () => {
    const stored = storePacket(layout, buildPacket(ready(), BASE));
    const file = layout.packetFile('OMNI-10', stored.packet_hash, 'json');
    const tampered = JSON.parse(fs.readFileSync(file, 'utf8'));
    tampered.packet.scope.authorized_paths.push('**');
    fs.writeFileSync(file, JSON.stringify(tampered));
    expect(() => loadPacket(layout, 'OMNI-10', stored.packet_hash)).toThrow(/integrity/);
    expect(() => loadPacket(layout, 'OMNI-10', `sha256:${'0'.repeat(64)}`)).toThrow(/not found/);
    expect(() => loadPacket(layout, 'OMNI-10', 'sha256:xyz' as `sha256:${string}`)).toThrow(/invalid packet hash/);

    const other = storePacket(layout, buildPacket(ready(story({ summary: 'v2' })), BASE));
    const misplaced = layout.packetFile('OMNI-11', other.packet_hash, 'json');
    fs.mkdirSync(path.dirname(misplaced), { recursive: true });
    fs.copyFileSync(layout.packetFile('OMNI-10', other.packet_hash, 'json'), misplaced);
    expect(() => loadPacket(layout, 'OMNI-11', other.packet_hash)).toThrow(/wrong story/);
  });
});

describe('detectStale', () => {
  const packet = () => buildPacket(ready(), BASE);

  it('fresh readiness → no reasons', () => {
    expect(detectStale(packet(), ready())).toEqual([]);
  });

  it('Story updated', () => {
    expect(detectStale(packet(), ready(story({ updated: '2026-10-02T00:00:00.000+0000' })))).toEqual([
      'Story OMNI-10 updated changed (2026-10-01T09:00:00.000+0000 -> 2026-10-02T00:00:00.000+0000)',
    ]);
  });

  it('AC added / removed / updated', () => {
    expect(detectStale(packet(), ready(story(), [ac(11), ac(12), ac(13)]))).toEqual(['Acceptance Criterion OMNI-13 added']);
    expect(detectStale(packet(), ready(story(), [ac(11)]))).toEqual(['Acceptance Criterion OMNI-12 removed']);
    expect(detectStale(packet(), ready(story(), [ac(11), ac(12, { updated: '2026-10-05T00:00:00.000+0000' })]))).toEqual([
      'Acceptance Criterion OMNI-12 updated changed (2026-10-01T10:00:00.000+0000 -> 2026-10-05T00:00:00.000+0000)',
    ]);
  });

  it('registry entry drift and registry id change', () => {
    const reg = JSON.parse(JSON.stringify(REGISTRY)) as VerificationRegistry;
    reg.entries.find((e) => e.id === 'jev.unit').argv.push('--runInBand');
    expect(detectStale(packet(), ready(story(), [ac(11), ac(12)], reg))).toEqual(['Verification registry digest changed']);
    expect(detectStale(packet(), ready(story({ [STORY_FIELDS.verificationRequirements]: 'jev.unit' })))).toEqual([
      'Verification registry digest changed',
      'Verification registry ids changed',
    ]);
  });

  it('scope change and no-longer-ready', () => {
    expect(detectStale(packet(), ready(story({ [STORY_FIELDS.prohibitedPaths]: 'supabase/**\nlib/**' })))).toEqual([
      'Scope (authorized / prohibited paths) changed',
    ]);
    expect(detectStale(packet(), evaluateReadiness('OMNI-10', story({ status: { id: '10039', name: 'Verified' } }), [ac(11), ac(12)], REGISTRY))).toEqual([
      'Story OMNI-10 is no longer ready (STORY_NOT_ACTIVE)',
    ]);
  });
});
