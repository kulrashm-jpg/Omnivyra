/**
 * gov reconcile (OMNI-44) — scripts/jev-flow/reconcile.ts.
 *
 * Read-only, dry-run reconciliation of stored evidence, the governed state and
 * Jira: the pure proposal rules (no-op, stale-evidence invalidation, conflict,
 * insufficient evidence, human decision), Jira-already-matches, evidence
 * integrity, determinism / idempotency, and no side effects. Hermetic: GOV_HOME
 * under os.tmpdir(), injected git / Jira ports, no network, no JEV.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AC_FIELDS } from '../../../scripts/jev-jira/fields';
import type { JiraIssue } from '../../../scripts/jev-jira/jiraClient';
import { bindSession } from '../../../scripts/jev-flow/binding';
import { buildBundle, storeBundle } from '../../../scripts/jev-flow/evidence';
import { policyDigest } from '../../../scripts/jev-flow/lifecycle';
import { storePacket } from '../../../scripts/jev-flow/packet';
import {
  acEvidenceReferenceLine,
  changeSetHash,
  currentBundle,
  governedStories,
  parseEvidenceReference,
  proposeAc,
  readStoredBundles,
  reconcileStory,
  runReconcile,
  type CitedEvidence,
  type JiraAcView,
  type ReconcilePorts,
} from '../../../scripts/jev-flow/reconcile';
import { registryDigest, validateRegistry } from '../../../scripts/jev-flow/registry';
import {
  GOVERNANCE_VERSION,
  HUMAN_ONLY_RULES,
  PACKET_SCHEMA,
  RECONCILE_DISPOSITIONS,
  canonicalHash,
  govLayout,
  type AcLifecycle,
  type EvidenceItem,
  type GitProbe,
  type GovLayout,
  type GovernedPacket,
  type PacketAc,
  type ReadinessResult,
  type Sha256Ref,
  type StoredEvidenceBundle,
  type StoredPacket,
} from '../../../scripts/jev-flow/types';

const STORY = 'OMNI-44';
const SID = 'd198d0cc-0c72-4b7b-baec-14d6c4122894';
const BASE = 'a'.repeat(40);
const HEAD_OLD = 'b'.repeat(40);
const HEAD_NEW = 'c'.repeat(40);
const BRANCH = 'omni-44/lifecycle-reconcile';
const POLICY_TEXT = '# automation policy v1\n';
const H = (c: string) => `sha256:${c.repeat(64)}` as Sha256Ref;

const REGISTRY = validateRegistry({
  schema: 'gov-registry/1',
  entries: [
    { id: 'jev.unit', description: 'unit', argv: ['node', 'x'], evidence_kind: 'test_run', timeout_ms: 1000 },
    { id: 'scripts.typecheck', description: 'tsc', argv: ['node', 'y'], evidence_kind: 'typecheck', timeout_ms: 1000 },
  ],
});
const IDS = ['jev.unit', 'scripts.typecheck'];

// ---------------------------------------------------------------- pure: proposeAc

function lc(over: Partial<AcLifecycle> = {}): AcLifecycle {
  return {
    ac_key: 'OMNI-45',
    ac_id: 'AC-1',
    kind: 'Deterministic',
    evidence_kind: 'Test',
    state: 'VERIFIABLE',
    reasons: ['ITEM_PASS'],
    registry_id: 'jev.unit',
    mapping: 'statement',
    deterministic: { bundle_hash: H('1'), head_commit: HEAD_NEW, item_id: 'EV-1', registry_id: 'jev.unit', result: 'PASS' },
    human_decision_required: false,
    stale_dimensions: [],
    ...over,
  };
}
const stale = (dims: AcLifecycle['stale_dimensions'] = ['head']) =>
  lc({ state: 'STALE', deterministic: null, stale_dimensions: dims, reasons: dims.map((d) => `STALE_${d.toUpperCase()}`) });
const judgment = () => lc({ ac_key: 'OMNI-48', ac_id: 'AC-4', kind: 'Judgment', evidence_kind: 'Manual', state: 'NEEDS_HUMAN', reasons: ['HUMAN_JUDGMENT_REQUIRED'], registry_id: null, mapping: null, deterministic: null, human_decision_required: true });
const jira = (over: Partial<JiraAcView> = {}): JiraAcView => ({ deterministic_result: null, evidence_references: null, verification: 'UNVERIFIED', jev_verdict: null, ...over });
const refLine = (hash: Sha256Ref, head: string, result = 'PASS') => `gov-evidence ${hash} head ${head.slice(0, 12)} jev.unit=${result}`;
const evaluated = (ac: AcLifecycle, hash: Sha256Ref, head: string, result = 'PASS', bundleStale = ac.stale_dimensions): CitedEvidence => ({
  status: 'evaluated',
  bundle_hash: hash,
  ac,
  recorded: parseEvidenceReference(refLine(hash, head, result)),
  bundle_stale: bundleStale,
});

describe('proposeAc — dispositions', () => {
  it('the disposition vocabulary distinguishes no-op, stale invalidation, conflict, insufficient evidence and human decisions', () => {
    expect([...RECONCILE_DISPOSITIONS].sort()).toEqual(['CONFLICT', 'HUMAN_DECISION', 'INSUFFICIENT_EVIDENCE', 'INVALIDATE_STALE_EVIDENCE', 'NO_OP']);
  });

  it('fresh PASS, nothing in Jira → HUMAN_DECISION RECORD_RESULT with the per-AC values', () => {
    const r = proposeAc(lc(), jira(), { status: 'none' });
    expect(r).toMatchObject({ disposition: 'HUMAN_DECISION', state: 'VERIFIABLE' });
    expect(r.reasons).toContain('RECORD_RESULT');
    expect(r.changes).toEqual([
      { field: 'Deterministic Result', current: null, proposed: 'PASS' },
      { field: 'Evidence References', current: null, proposed: refLine(H('1'), HEAD_NEW) },
    ]);
  });

  it('fresh FAIL, nothing in Jira → RECORD_RESULT proposes FAIL (failure is evidence too)', () => {
    const failed = lc({ state: 'FAILED', reasons: ['ITEM_FAIL'], deterministic: { ...lc().deterministic, result: 'FAIL' } });
    expect(proposeAc(failed, jira(), { status: 'none' }).changes[0]).toEqual({ field: 'Deterministic Result', current: null, proposed: 'FAIL' });
  });

  it('Jira already matches the current evidence → NO_OP with no change', () => {
    const current = lc();
    const r = proposeAc(current, jira({ deterministic_result: 'PASS', evidence_references: refLine(H('1'), HEAD_NEW) }), evaluated(current, H('1'), HEAD_NEW));
    expect(r).toMatchObject({ disposition: 'NO_OP', changes: [], reasons: ['JIRA_MATCHES_EVIDENCE'] });
  });

  it('Jira cites stale evidence and fresh evidence exists → INVALIDATE_STALE_EVIDENCE replacing it with the fresh values', () => {
    const r = proposeAc(lc(), jira({ deterministic_result: 'PASS', evidence_references: refLine(H('0'), HEAD_OLD), verification: 'VERIFIED' }), evaluated(stale(['bundle_hash', 'head']), H('0'), HEAD_OLD));
    expect(r.disposition).toBe('INVALIDATE_STALE_EVIDENCE');
    expect(r.reasons).toEqual(['FRESH_EVIDENCE_AVAILABLE', 'JIRA_CITES_STALE_EVIDENCE', 'STALE_BUNDLE_HASH', 'STALE_HEAD']);
    expect(r.changes).toEqual([
      { field: 'Evidence References', current: refLine(H('0'), HEAD_OLD), proposed: refLine(H('1'), HEAD_NEW) },
      { field: 'Verification', current: 'VERIFIED', proposed: 'UNVERIFIED' },
    ]);
  });

  it('Jira cites stale evidence and nothing is current → INVALIDATE proposing to clear (stale is never kept as current)', () => {
    const r = proposeAc(stale(), jira({ deterministic_result: 'PASS', evidence_references: refLine(H('0'), HEAD_OLD) }), evaluated(stale(), H('0'), HEAD_OLD));
    expect(r.disposition).toBe('INVALIDATE_STALE_EVIDENCE');
    expect(r.reasons).toContain('REVERIFY_REQUIRED');
    expect(r.changes).toEqual([
      { field: 'Deterministic Result', current: 'PASS', proposed: null },
      { field: 'Evidence References', current: refLine(H('0'), HEAD_OLD), proposed: null },
    ]);
  });

  it.each([
    ['Jira records FAIL against PASS evidence', jira({ deterministic_result: 'FAIL', evidence_references: refLine(H('1'), HEAD_NEW) }), 'PASS', 'JIRA_RESULT_DISAGREES_WITH_EVIDENCE'],
    ['the recorded reference lists a different item result', jira({ deterministic_result: 'PASS', evidence_references: refLine(H('1'), HEAD_NEW, 'FAIL') }), 'FAIL', 'JIRA_RESULT_DISAGREES_WITH_EVIDENCE'],
  ])('CONFLICT: %s', (_n, j, recorded, reason) => {
    const current = lc();
    expect(proposeAc(current, j, evaluated(current, H('1'), HEAD_NEW, recorded))).toMatchObject({ disposition: 'CONFLICT', reasons: [reason], changes: [] });
  });

  it('CONFLICT: Jira cites a bundle gov does not have, or one that fails integrity', () => {
    const j = jira({ deterministic_result: 'PASS', evidence_references: refLine(H('9'), HEAD_NEW) });
    expect(proposeAc(lc(), j, { status: 'unknown', bundle_hash: H('9') })).toMatchObject({ disposition: 'CONFLICT', reasons: ['JIRA_CITES_UNKNOWN_EVIDENCE'] });
    expect(proposeAc(lc(), j, { status: 'not_intact', bundle_hash: H('9') })).toMatchObject({ disposition: 'CONFLICT', reasons: ['JIRA_CITES_EVIDENCE_NOT_INTACT'] });
  });

  it('CONFLICT: Jira cites a bundle that has no item for this AC', () => {
    const missing = lc({ state: 'INSUFFICIENT_EVIDENCE', reasons: ['NO_ITEM_FOR_REGISTRY_ID'], deterministic: null });
    expect(proposeAc(lc(), jira({ deterministic_result: 'PASS', evidence_references: refLine(H('1'), HEAD_NEW) }), evaluated(missing, H('1'), HEAD_NEW)).disposition).toBe('CONFLICT');
  });

  it('CONFLICT: a bundle-wide result was recorded on a Judgment AC (the old submit behaviour) → propose clearing it', () => {
    const r = proposeAc(judgment(), jira({ deterministic_result: 'PASS', evidence_references: `gov-evidence ${H('1')} head ${HEAD_NEW.slice(0, 12)} jev.unit=PASS scripts.typecheck=PASS` }), evaluated(judgment(), H('1'), HEAD_NEW));
    expect(r).toMatchObject({ disposition: 'CONFLICT', reasons: ['BUNDLE_RESULT_ON_JUDGMENT_AC'], changes: [{ field: 'Deterministic Result', current: 'PASS', proposed: null }] });
  });

  it('Judgment AC: undecided → HUMAN_DECISION; decided by a human → NO_OP; gov never proposes a deterministic value for it', () => {
    expect(proposeAc(judgment(), jira(), { status: 'none' })).toMatchObject({ disposition: 'HUMAN_DECISION', changes: [] });
    expect(proposeAc(judgment(), jira({ verification: 'VERIFIED' }), { status: 'none' })).toMatchObject({ disposition: 'NO_OP', changes: [] });
  });

  it.each([
    ['current STALE, Jira empty', stale(), jira(), { status: 'none' } as CitedEvidence, 'INSUFFICIENT_EVIDENCE'],
    ['no evidence, Jira empty', lc({ state: 'INSUFFICIENT_EVIDENCE', reasons: ['NO_EVIDENCE'], deterministic: null }), jira(), { status: 'none' } as CitedEvidence, 'INSUFFICIENT_EVIDENCE'],
    ['mapping conflict', lc({ state: 'CONFLICT', reasons: ['AC_REGISTRY_ID_NOT_IN_PACKET'], deterministic: null }), jira(), { status: 'none' } as CitedEvidence, 'CONFLICT'],
    ['ambiguous mapping', lc({ state: 'NEEDS_HUMAN', reasons: ['AC_REGISTRY_ID_AMBIGUOUS'], deterministic: null, human_decision_required: true }), jira(), { status: 'none' } as CitedEvidence, 'HUMAN_DECISION'],
    ['Jira result with no evidence reference', lc(), jira({ deterministic_result: 'PASS' }), { status: 'none' } as CitedEvidence, 'HUMAN_DECISION'],
    ['Jira evidence that is not a gov reference', lc(), jira({ deterministic_result: 'PASS', evidence_references: 'CI run 42' }), { status: 'unrecognized' } as CitedEvidence, 'HUMAN_DECISION'],
  ])('%s → %s, no Jira change proposed', (_n, current, j, cited, disposition) => {
    expect(proposeAc(current, j, cited)).toMatchObject({ disposition, changes: [] });
  });

  it('Jira cites stale evidence for an AC that cannot be mapped to one registry id → still INVALIDATE_STALE_EVIDENCE (stale is never kept)', () => {
    const unmapped = lc({ state: 'NEEDS_HUMAN', reasons: ['AC_REGISTRY_ID_AMBIGUOUS'], deterministic: null, human_decision_required: true, registry_id: null, mapping: null });
    const j = jira({ deterministic_result: 'PASS', evidence_references: refLine(H('0'), HEAD_OLD), verification: 'VERIFIED' });
    const r = proposeAc(unmapped, j, evaluated(unmapped, H('0'), HEAD_OLD, 'PASS', ['head']));
    expect(r.disposition).toBe('INVALIDATE_STALE_EVIDENCE');
    expect(r.reasons).toEqual(['AC_REGISTRY_ID_AMBIGUOUS', 'JIRA_CITES_STALE_EVIDENCE', 'REVERIFY_REQUIRED', 'STALE_HEAD']);
    expect(r.changes).toEqual([
      { field: 'Deterministic Result', current: 'PASS', proposed: null },
      { field: 'Evidence References', current: refLine(H('0'), HEAD_OLD), proposed: null },
      { field: 'Verification', current: 'VERIFIED', proposed: 'UNVERIFIED' },
    ]);
    // the same AC citing FRESH evidence stays a human mapping decision
    expect(proposeAc(unmapped, j, evaluated(unmapped, H('0'), HEAD_OLD, 'PASS', []))).toMatchObject({ disposition: 'HUMAN_DECISION', changes: [] });
  });

  it('a Deterministic AC recorded VERIFIED with no recorded result and no evidence → CONFLICT (missing evidence never passes)', () => {
    for (const current of [stale(), lc({ state: 'INSUFFICIENT_EVIDENCE', reasons: ['NO_EVIDENCE'], deterministic: null }), lc()]) {
      expect(proposeAc(current, jira({ verification: 'VERIFIED' }), { status: 'none' })).toMatchObject({ disposition: 'CONFLICT', changes: [] });
      expect(proposeAc(current, jira({ verification: 'VERIFIED' }), { status: 'none' }).reasons).toContain('JIRA_VERIFIED_WITHOUT_RECORDED_RESULT');
    }
  });

  it('the JEV advisory verdict is reported but never changes the disposition or the proposal', () => {
    const a = proposeAc(lc(), jira(), { status: 'none' });
    const b = proposeAc(lc(), jira({ jev_verdict: 'FAIL' }), { status: 'none' });
    expect(b.jev_advisory).toBe('FAIL');
    expect({ ...b, jev_advisory: null }).toEqual(a);
  });
});

describe('evidence references', () => {
  it('parses the pinned gov form and the per-AC form; refuses anything else', () => {
    expect(parseEvidenceReference(`gov-evidence ${H('1')} head ${'c'.repeat(12)} jev.unit=PASS scripts.typecheck=FAIL`)).toEqual({
      bundle_hash: H('1'),
      head12: 'c'.repeat(12),
      items: { 'jev.unit': 'PASS', 'scripts.typecheck': 'FAIL' },
    });
    expect(parseEvidenceReference(acEvidenceReferenceLine(lc().deterministic))).toMatchObject({ bundle_hash: H('1'), items: { 'jev.unit': 'PASS' } });
    for (const bad of [null, '', 'CI run 42', `gov-evidence ${H('1')} head xyz`, `gov-evidence ${H('1')} head ${'c'.repeat(12)} a.b=PASS a.b=FAIL`]) {
      expect(parseEvidenceReference(bad)).toBeNull();
    }
  });
});

// ---------------------------------------------------------------- reconcileStory against a real GOV_HOME

const tmpDirs: string[] = [];
afterAll(() => {
  for (const d of tmpDirs.reverse()) fs.rmSync(d, { recursive: true, force: true });
});

function files(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[p] = `${fs.statSync(p).mtimeMs}:${fs.readFileSync(p, 'utf8')}`;
    }
  };
  walk(dir);
  return out;
}

const ACS: PacketAc[] = [
  { key: 'OMNI-45', ac_id: 'AC-1', statement: 'Registry check jev.unit passes on the governed HEAD (unit).', kind: 'Deterministic', evidence_kind: 'Test', status: 'Backlog', verification: null, updated: '2026-10-09T12:00:00.000Z' },
  { key: 'OMNI-46', ac_id: 'AC-2', statement: 'Reconcile output is reviewable.', kind: 'Judgment', evidence_kind: 'Manual', status: 'Backlog', verification: null, updated: '2026-10-09T12:00:00.000Z' },
];

interface Fixture {
  layout: GovLayout;
  worktree: string;
  stored: StoredPacket;
  ports: ReconcilePorts;
  jiraAcs: Record<string, Record<string, unknown>>;
  readiness: ReadinessResult;
  git: { head: string; clean: boolean };
  reads: string[];
}

function fixture(): Fixture {
  const home = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gov-reconcile-')), 'gov');
  tmpDirs.push(path.dirname(home));
  const layout = govLayout({ GOV_HOME: home });
  const worktree = path.join(path.dirname(home), 'wt').replace(/\\/g, '/');
  const packet: GovernedPacket = {
    schema: PACKET_SCHEMA,
    governance_version: GOVERNANCE_VERSION,
    story: { key: STORY, summary: 's', status: 'Backlog', objective: 'o', architecture: null, invariants: [], updated: '2026-10-09T12:00:00.000Z' },
    acceptance_criteria: ACS,
    scope: { authorized_paths: ['src/**'], prohibited_paths: [] },
    verification: { registry_ids: IDS, registry_digest: registryDigest(REGISTRY, IDS) },
    base: { commit: BASE, branch: BRANCH, worktree },
    rules: [...HUMAN_ONLY_RULES],
  };
  const stored = storePacket(layout, packet);
  bindSession(layout, { story_key: STORY, packet_hash: stored.packet_hash, session_id: SID, mode: 'new', worktree, branch: BRANCH, base_commit: BASE, session_file: null }, () => new Date('2026-10-09T11:00:00.000Z'));
  const readiness: ReadinessResult = { ready: true, story_key: STORY, findings: [], story: packet.story, acceptance_criteria: ACS, scope: packet.scope, verification: packet.verification };
  const f: Fixture = {
    layout,
    worktree,
    stored,
    readiness,
    git: { head: HEAD_NEW, clean: true },
    reads: [],
    jiraAcs: { 'OMNI-45': {}, 'OMNI-46': {} },
    ports: null,
  };
  const git = {
    headCommit: async () => f.git.head,
    isClean: async () => f.git.clean,
  } as unknown as GitProbe;
  f.ports = {
    layout,
    registry: REGISTRY,
    git,
    readCommitFile: async () => POLICY_TEXT,
    currentPolicyText: POLICY_TEXT,
    readiness: async () => JSON.parse(JSON.stringify(f.readiness)),
    readAc: async (key) => {
      f.reads.push(key);
      return acIssue(key, f.jiraAcs[key]);
    },
  };
  return f;
}

function acIssue(key: string, over: Record<string, unknown> = {}): JiraIssue {
  const a = ACS.find((x) => x.key === key);
  const sel = (value: string) => ({ value, id: `opt-${value}` });
  return {
    key,
    fields: {
      issuetype: { id: '10074' },
      project: { id: '10033' },
      status: { name: 'Backlog' },
      parent: { key: STORY },
      updated: '2026-10-09T12:00:00.000+0000',
      [AC_FIELDS.acId]: a.ac_id,
      [AC_FIELDS.statement]: a.statement,
      [AC_FIELDS.kind]: sel(a.kind),
      [AC_FIELDS.evidenceKind]: sel(a.evidence_kind),
      [AC_FIELDS.deterministicResult]: null,
      [AC_FIELDS.evidenceReferences]: null,
      [AC_FIELDS.verification]: sel('UNVERIFIED'),
      [AC_FIELDS.jevVerdict]: null,
      ...over,
    },
  };
}

function storeEvidence(f: Fixture, head: string, verifiedAt: string, items?: EvidenceItem[]): StoredEvidenceBundle {
  const its: EvidenceItem[] = items ?? IDS.map((id, i) => ({
    id: `EV-${i + 1}`,
    registry_id: id,
    evidence_kind: REGISTRY.entries[i].evidence_kind,
    argv_digest: canonicalHash([id]),
    exit_code: 0,
    result: 'PASS',
    timed_out: false,
    log_sha256: H(String(i + 1)),
    log_bytes: 3,
    started_at: verifiedAt,
    finished_at: verifiedAt,
  }));
  return storeBundle(f.layout, buildBundle({
    story_key: STORY,
    packet_hash: f.stored.packet_hash,
    worktree: f.worktree,
    branch: BRANCH,
    base_commit: BASE,
    head_commit: head,
    registry_digest: f.stored.packet.verification.registry_digest,
    scope: { ok: true, base_commit: BASE, head_commit: head, changed_paths: ['src/a.ts'], outside_authorized: [], prohibited_touched: [] },
    items: its,
    verified_at: verifiedAt,
  }));
}

const sel = (value: string) => ({ value, id: `opt-${value}` });
const binding = (f: Fixture) => governedStories(f.layout, null)[0].binding;

describe('reconcileStory (read-only gathering + proposals)', () => {
  it('Jira cites an older bundle at a previous HEAD → STALE on bundle hash + HEAD, INVALIDATE with the newer per-AC values', async () => {
    const f = fixture();
    const old = storeEvidence(f, HEAD_OLD, '2026-10-09T12:00:00.000Z');
    const fresh = storeEvidence(f, HEAD_NEW, '2026-10-09T13:00:00.000Z');
    f.jiraAcs['OMNI-45'] = { [AC_FIELDS.deterministicResult]: sel('PASS'), [AC_FIELDS.evidenceReferences]: `gov-evidence ${old.bundle_hash} head ${HEAD_OLD.slice(0, 12)} jev.unit=PASS scripts.typecheck=PASS` };
    const r = await reconcileStory(STORY, binding(f), f.ports);
    expect(r).toMatchObject({ error: null, bundle_hash: fresh.bundle_hash, integrity_failures: [] });
    expect(r.freshness.every((c) => c.fresh)).toBe(true);
    const [a1, a2] = r.per_ac;
    expect(a1).toMatchObject({ state: 'VERIFIABLE', disposition: 'INVALIDATE_STALE_EVIDENCE' });
    expect(a1.reasons).toEqual(['FRESH_EVIDENCE_AVAILABLE', 'JIRA_CITES_STALE_EVIDENCE', 'STALE_BUNDLE_HASH', 'STALE_HEAD']);
    expect(a1.changes).toEqual([{ field: 'Evidence References', current: expect.stringContaining(old.bundle_hash), proposed: `gov-evidence ${fresh.bundle_hash} head ${HEAD_NEW.slice(0, 12)} jev.unit=PASS` }]);
    expect(a2).toMatchObject({ state: 'NEEDS_HUMAN', disposition: 'HUMAN_DECISION', changes: [] });
    expect(f.reads).toEqual(['OMNI-45', 'OMNI-46']);
  });

  it('Jira already matching the current bundle → NO_OP for every AC, no change', async () => {
    const f = fixture();
    const fresh = storeEvidence(f, HEAD_NEW, '2026-10-09T13:00:00.000Z');
    f.jiraAcs['OMNI-45'] = { [AC_FIELDS.deterministicResult]: sel('PASS'), [AC_FIELDS.evidenceReferences]: `gov-evidence ${fresh.bundle_hash} head ${HEAD_NEW.slice(0, 12)} jev.unit=PASS` };
    f.jiraAcs['OMNI-46'] = { [AC_FIELDS.verification]: sel('VERIFIED') };
    const r = await reconcileStory(STORY, binding(f), f.ports);
    expect(r.per_ac.map((a) => [a.disposition, a.changes.length])).toEqual([['NO_OP', 0], ['NO_OP', 0]]);
  });

  it('the packet no longer matches Jira → STALE on the packet dimension (evidence for an outdated work order is not current)', async () => {
    const f = fixture();
    storeEvidence(f, HEAD_NEW, '2026-10-09T13:00:00.000Z');
    f.readiness.story = { ...f.readiness.story, updated: '2026-10-09T14:00:00.000Z' };
    const r = await reconcileStory(STORY, binding(f), f.ports);
    expect(r.freshness.filter((c) => !c.fresh).map((c) => c.dimension)).toEqual(['packet_hash']);
    expect(r.per_ac[0]).toMatchObject({ state: 'STALE', disposition: 'INSUFFICIENT_EVIDENCE' });
  });

  it('the automation policy at the evidence HEAD differs from the one in force → STALE on the policy dimension', async () => {
    const f = fixture();
    storeEvidence(f, HEAD_NEW, '2026-10-09T13:00:00.000Z');
    f.ports.readCommitFile = async () => '# automation policy v0\n';
    const r = await reconcileStory(STORY, binding(f), f.ports);
    expect(r.freshness.find((c) => c.dimension === 'automation_policy_digest')).toEqual({
      dimension: 'automation_policy_digest',
      fresh: false,
      expected: policyDigest(POLICY_TEXT),
      observed: policyDigest('# automation policy v0\n'),
    });
    expect(r.per_ac[0].state).toBe('STALE');
  });

  it('evidence integrity: a corrupted stored bundle is reported, never used, and Jira citing it is a CONFLICT', async () => {
    const f = fixture();
    const bad = storeEvidence(f, HEAD_NEW, '2026-10-09T13:00:00.000Z');
    const file = f.layout.evidenceFile(STORY, bad.bundle_hash);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('"PASS"', '"FAIL"'));
    f.jiraAcs['OMNI-45'] = { [AC_FIELDS.deterministicResult]: sel('PASS'), [AC_FIELDS.evidenceReferences]: `gov-evidence ${bad.bundle_hash} head ${HEAD_NEW.slice(0, 12)} jev.unit=PASS` };
    const r = await reconcileStory(STORY, binding(f), f.ports);
    expect(r.integrity_failures).toHaveLength(1);
    expect(r.integrity_failures[0]).toMatch(new RegExp(`^${bad.bundle_hash}: INTEGRITY_FAILED`));
    expect(r.bundle_hash).toBeNull();
    expect(r.per_ac[0]).toMatchObject({ state: 'INSUFFICIENT_EVIDENCE', disposition: 'CONFLICT', reasons: ['JIRA_CITES_EVIDENCE_NOT_INTACT'] });
  });

  it('readStoredBundles / currentBundle: every file re-hashed; the latest verified bundle is current', () => {
    const f = fixture();
    const a = storeEvidence(f, HEAD_OLD, '2026-10-09T12:00:00.000Z');
    const b = storeEvidence(f, HEAD_NEW, '2026-10-09T13:00:00.000Z');
    fs.writeFileSync(path.join(f.layout.evidenceDir(STORY), `${'0'.repeat(64)}.json`), '{not json');
    const { intact, failures } = readStoredBundles(f.layout, STORY);
    expect(intact.map((x) => x.bundle_hash).sort()).toEqual([a.bundle_hash, b.bundle_hash].sort());
    expect(failures).toEqual([`sha256:${'0'.repeat(64)}: INTEGRITY_FAILED: evidence file is not valid JSON`]);
    expect(currentBundle(intact).bundle_hash).toBe(b.bundle_hash);
    expect(currentBundle([...intact].reverse()).bundle_hash).toBe(b.bundle_hash);
    expect(readStoredBundles(f.layout, 'OMNI-999')).toEqual({ intact: [], failures: [] });
  });

  it('a Jira read failure ends the Story with an error and no partial proposals', async () => {
    const f = fixture();
    storeEvidence(f, HEAD_NEW, '2026-10-09T13:00:00.000Z');
    f.ports.readiness = async () => {
      throw new Error('JIRA_AUTH');
    };
    const r = await reconcileStory(STORY, binding(f), f.ports);
    expect(r).toMatchObject({ error: expect.stringContaining('JIRA_AUTH'), per_ac: [] });
  });

  it('no binding / an unusable packet → error, with the packet integrity failure reported', async () => {
    const f = fixture();
    expect((await reconcileStory('OMNI-99', null, f.ports)).error).toBe('no binding in the governance ledger');
    fs.writeFileSync(f.layout.packetFile(STORY, f.stored.packet_hash, 'json'), '{}');
    const r = await reconcileStory(STORY, binding(f), f.ports);
    expect(r.error).toMatch(/bound packet unusable/);
    expect(r.integrity_failures).toHaveLength(1);
  });
});

describe('runReconcile — deterministic, idempotent, side-effect free', () => {
  it('two runs over an unchanged world give the same report and change-set hash; GOV_HOME is byte- and mtime-identical', async () => {
    const f = fixture();
    storeEvidence(f, HEAD_NEW, '2026-10-09T13:00:00.000Z');
    const before = files(f.layout.home);
    const a = await runReconcile(null, f.ports);
    const b = await runReconcile([STORY], f.ports);
    expect(b).toEqual(a);
    expect(a.change_set_hash).toBe(changeSetHash(a.stories));
    expect(a).toMatchObject({ schema: 'gov-reconcile/1', dry_run: true });
    expect(files(f.layout.home)).toEqual(before);
  });

  it('a changed world gives a different change-set hash', async () => {
    const f = fixture();
    storeEvidence(f, HEAD_NEW, '2026-10-09T13:00:00.000Z');
    const a = await runReconcile(null, f.ports);
    f.git.head = HEAD_OLD;
    const b = await runReconcile(null, f.ports);
    expect(b.change_set_hash).not.toBe(a.change_set_hash);
  });

  it('governedStories: every Story in the ledger once, by key, with its latest binding', () => {
    const f = fixture();
    bindSession(f.layout, { story_key: 'OMNI-7', packet_hash: H('7'), session_id: '00000000-0000-4000-8000-000000000007', mode: 'new', worktree: '/w7', branch: 'b7', base_commit: BASE, session_file: null });
    bindSession(f.layout, { story_key: STORY, packet_hash: H('5'), session_id: SID, mode: 'new', worktree: f.worktree, branch: BRANCH, base_commit: BASE, session_file: null });
    const s = governedStories(f.layout, null);
    expect(s.map((x) => x.story)).toEqual(['OMNI-7', STORY]);
    expect(s[1].binding.packet_hash).toBe(H('5'));
    expect(governedStories(f.layout, ['OMNI-8']).map((x) => [x.story, x.binding])).toEqual([['OMNI-8', null]]);
  });

  it('reconcile.ts and lifecycle.ts have no write path: no fs writes, no ledger/evidence/packet store, no Jira write, no JEV, no apply', () => {
    for (const name of ['reconcile.ts', 'lifecycle.ts']) {
      const src = fs.readFileSync(path.resolve(__dirname, '../../../scripts/jev-flow', name), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect({ name, fsWrite: /\b(writeFileSync|appendFileSync|mkdirSync|renameSync|rmSync|unlinkSync|copyFileSync|createWriteStream|writeFile|appendFile)\b/.test(src) }).toEqual({ name, fsWrite: false });
      expect({ name, store: /\b(bindSession|storeBundle|storePacket|storeLog|storeProposal|appendIntakeAudit)\b/.test(src) }).toEqual({ name, store: false });
      expect({ name, jira: /\b(updateAdvisoryFields|writeAdvisoryFields|transitionIssue|createIssue)\b|method\s*:|jev-jira\/writeback/.test(src) }).toEqual({ name, jira: false });
      expect({ name, jev: /jev-bjc\/(judge|provider)|judgeFlow|runJudgeFlow/.test(src) }).toEqual({ name, jev: false });
      expect({ name, process: /child_process|\bexecFile\b|\bspawn\b/.test(src) }).toEqual({ name, process: false });
      expect({ name, apply: /\bapply[A-Z]\w*\s*\(|--apply/.test(src) }).toEqual({ name, apply: false });
    }
  });
});
