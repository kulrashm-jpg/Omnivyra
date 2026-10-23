/**
 * gov lifecycle predicate engine (OMNI-44) — scripts/jev-flow/lifecycle.ts.
 *
 * Pure predicates only: every AC is evaluated on its own against the registry
 * id that proves it; every freshness dimension can make evidence STALE on its
 * own; missing or non-intact evidence never passes; stale evidence is never
 * current; Judgment ACs always stay with a human. Hermetic: no fs, git, Jira or JEV.
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildBundle } from '../../../scripts/jev-flow/evidence';
import { acSubmission, evaluateLifecycle, mapAcToRegistryId, policyDigest, type EvidenceUnderTest, type GovernedState } from '../../../scripts/jev-flow/lifecycle';
import { registryDigest, validateRegistry } from '../../../scripts/jev-flow/registry';
import {
  AC_LIFECYCLE_STATES,
  BINDING_SCHEMA,
  FRESHNESS_DIMENSIONS,
  GOVERNANCE_VERSION,
  HUMAN_ONLY_RULES,
  PACKET_SCHEMA,
  bundleHash,
  canonicalHash,
  packetHash,
  type EvidenceBundle,
  type EvidenceItem,
  type EvidenceKind,
  type FreshnessDimension,
  type GovernedPacket,
  type PacketAc,
  type SessionBinding,
  type Sha256Ref,
  type StoredEvidenceBundle,
  type StoredPacket,
} from '../../../scripts/jev-flow/types';

const STORY = 'OMNI-44';
const WORKTREE = 'C:/tmp/omni-44-lifecycle-reconcile';
const BRANCH = 'omni-44/lifecycle-reconcile';
const BASE = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const POLICY = policyDigest('# automation policy v1\n');

const REGISTRY = validateRegistry({
  schema: 'gov-registry/1',
  entries: [
    { id: 'jev.unit', description: 'unit', argv: ['node', 'x'], evidence_kind: 'test_run', timeout_ms: 1000 },
    { id: 'scripts.typecheck', description: 'tsc', argv: ['node', 'y'], evidence_kind: 'typecheck', timeout_ms: 1000 },
    { id: 'backend-tests.typecheck', description: 'tsc baseline', argv: ['node', 'z'], evidence_kind: 'typecheck', timeout_ms: 1000 },
  ],
});
const IDS = ['jev.unit', 'scripts.typecheck', 'backend-tests.typecheck'];
const KINDS: Record<string, EvidenceKind> = Object.fromEntries(REGISTRY.entries.map((e) => [e.id, e.evidence_kind]));

function ac(n: number, statement: string, kind: 'Deterministic' | 'Judgment', evidenceKind: string): PacketAc {
  return { key: `OMNI-${44 + n}`, ac_id: `AC-${n}`, statement, kind, evidence_kind: evidenceKind, status: 'Backlog', verification: null, updated: '2026-10-09T12:00:00.000Z' };
}

const ACS: PacketAc[] = [
  ac(1, 'Registry check jev.unit passes on the governed HEAD (unit).', 'Deterministic', 'Test'),
  ac(2, 'Registry check scripts.typecheck passes on the governed HEAD (tsc).', 'Deterministic', 'Typecheck'),
  ac(3, 'Registry check backend-tests.typecheck passes on the governed HEAD (baseline).', 'Deterministic', 'Typecheck'),
  ac(4, 'The reconcile output is understandable to a reviewer.', 'Judgment', 'Manual'),
];

function packetWith(acs: PacketAc[] = ACS): StoredPacket {
  const packet: GovernedPacket = {
    schema: PACKET_SCHEMA,
    governance_version: GOVERNANCE_VERSION,
    story: { key: STORY, summary: 'lifecycle', status: 'Backlog', objective: 'o', architecture: null, invariants: [], updated: '2026-10-09T12:00:00.000Z' },
    acceptance_criteria: acs,
    scope: { authorized_paths: ['scripts/jev-flow/lifecycle.ts'], prohibited_paths: [] },
    verification: { registry_ids: IDS, registry_digest: registryDigest(REGISTRY, IDS) },
    base: { commit: BASE, branch: BRANCH, worktree: WORKTREE },
    rules: [...HUMAN_ONLY_RULES],
  };
  return { packet, packet_hash: packetHash(packet) };
}

function item(n: number, registryId: string, over: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    id: `EV-${n}`,
    registry_id: registryId,
    evidence_kind: KINDS[registryId] ?? 'test_run',
    argv_digest: canonicalHash([registryId]),
    exit_code: 0,
    result: 'PASS',
    timed_out: false,
    log_sha256: `sha256:${String(n).repeat(64).slice(0, 64)}` as Sha256Ref,
    log_bytes: 10,
    started_at: '2026-10-09T12:00:00.000Z',
    finished_at: '2026-10-09T12:01:00.000Z',
    ...over,
  };
}

const ITEMS = () => IDS.map((id, i) => item(i + 1, id));

function bundleFor(stored: StoredPacket, items: EvidenceItem[] = ITEMS(), over: Partial<EvidenceBundle> = {}): StoredEvidenceBundle {
  const bundle = {
    ...buildBundle({
      story_key: STORY,
      packet_hash: stored.packet_hash,
      worktree: WORKTREE,
      branch: BRANCH,
      base_commit: BASE,
      head_commit: HEAD,
      registry_digest: stored.packet.verification.registry_digest,
      scope: { ok: true, base_commit: BASE, head_commit: HEAD, changed_paths: [], outside_authorized: [], prohibited_touched: [] },
      items,
      verified_at: '2026-10-09T12:02:00.000Z',
    }),
    ...over,
  };
  return { bundle, bundle_hash: bundleHash(bundle) };
}

function bindingFor(stored: StoredPacket, over: Partial<SessionBinding> = {}): SessionBinding {
  return {
    schema: BINDING_SCHEMA,
    governance_version: GOVERNANCE_VERSION,
    story_key: STORY,
    packet_hash: stored.packet_hash,
    session_id: 'd198d0cc-0c72-4b7b-baec-14d6c4122894',
    mode: 'new',
    worktree: WORKTREE,
    branch: BRANCH,
    base_commit: BASE,
    bound_at: '2026-10-09T11:00:00.000Z',
    session_file: null,
    ...over,
  };
}

function world(acs: PacketAc[] = ACS) {
  const packet = packetWith(acs);
  const state: GovernedState = {
    packet,
    packet_stale_reasons: [],
    binding: bindingFor(packet),
    head: HEAD,
    clean: true,
    registry_digest: registryDigest(REGISTRY, IDS),
    automation_policy_digest: POLICY,
    registry_kinds: KINDS,
  };
  const stored = bundleFor(packet);
  const evidence: EvidenceUnderTest = { stored, expected_bundle_hash: stored.bundle_hash, automation_policy_digest: POLICY };
  return { packet, state, stored, evidence };
}

const states = (r: ReturnType<typeof evaluateLifecycle>) => Object.fromEntries(r.per_ac.map((a) => [a.ac_id, a.state]));

// ---------------------------------------------------------------- states

describe('lifecycle states', () => {
  it('the state vocabulary is exactly the six states, never collapsed to PASS/FAIL', () => {
    expect([...AC_LIFECYCLE_STATES].sort()).toEqual(['CONFLICT', 'FAILED', 'INSUFFICIENT_EVIDENCE', 'NEEDS_HUMAN', 'STALE', 'VERIFIABLE']);
  });

  it('fresh, intact, all items PASS → each Deterministic AC VERIFIABLE on its own item; the Judgment AC NEEDS_HUMAN', () => {
    const w = world();
    const r = evaluateLifecycle(w.state, w.evidence);
    expect(r.integrity).toEqual({ ok: true, reason: null });
    expect(r.freshness.every((c) => c.fresh)).toBe(true);
    expect(states(r)).toEqual({ 'AC-1': 'VERIFIABLE', 'AC-2': 'VERIFIABLE', 'AC-3': 'VERIFIABLE', 'AC-4': 'NEEDS_HUMAN' });
    expect(r.per_ac.map((a) => a.deterministic?.item_id ?? null)).toEqual(['EV-1', 'EV-2', 'EV-3', null]);
    expect(r.per_ac.map((a) => a.registry_id)).toEqual(['jev.unit', 'scripts.typecheck', 'backend-tests.typecheck', null]);
    const judgment = r.per_ac[3];
    expect(judgment).toMatchObject({ human_decision_required: true, deterministic: null, reasons: ['HUMAN_JUDGMENT_REQUIRED'] });
    expect(r.per_ac.slice(0, 3).every((a) => a.human_decision_required === false)).toBe(true);
  });

  it('AC-specific: one failing item fails only the AC it proves, though the bundle-wide result is FAIL', () => {
    const w = world();
    const items = ITEMS();
    items[1] = item(2, 'scripts.typecheck', { exit_code: 2, result: 'FAIL' });
    const stored = bundleFor(w.packet, items);
    expect(stored.bundle.deterministic_result).toBe('FAIL');
    const r = evaluateLifecycle(w.state, { ...w.evidence, stored, expected_bundle_hash: stored.bundle_hash });
    expect(states(r)).toEqual({ 'AC-1': 'VERIFIABLE', 'AC-2': 'FAILED', 'AC-3': 'VERIFIABLE', 'AC-4': 'NEEDS_HUMAN' });
    expect(r.per_ac[1].reasons).toEqual(['ITEM_FAIL']);
  });

  it('a timed-out item → FAILED (ITEM_TIMED_OUT)', () => {
    const w = world();
    const items = ITEMS();
    items[0] = item(1, 'jev.unit', { exit_code: -1, result: 'FAIL', timed_out: true });
    const stored = bundleFor(w.packet, items);
    const r = evaluateLifecycle(w.state, { ...w.evidence, stored, expected_bundle_hash: stored.bundle_hash });
    expect(r.per_ac[0]).toMatchObject({ state: 'FAILED', reasons: ['ITEM_TIMED_OUT'] });
  });

  it('missing evidence never passes: no bundle → INSUFFICIENT_EVIDENCE (NO_EVIDENCE); Judgment still NEEDS_HUMAN', () => {
    const w = world();
    const r = evaluateLifecycle(w.state, { stored: null, automation_policy_digest: null });
    expect(states(r)).toEqual({ 'AC-1': 'INSUFFICIENT_EVIDENCE', 'AC-2': 'INSUFFICIENT_EVIDENCE', 'AC-3': 'INSUFFICIENT_EVIDENCE', 'AC-4': 'NEEDS_HUMAN' });
    expect(r.per_ac[0].reasons).toEqual(['NO_EVIDENCE']);
    expect(r.per_ac.every((a) => a.deterministic === null)).toBe(true);
  });

  it('a bundle with no item for the AC registry id → INSUFFICIENT_EVIDENCE (NO_ITEM_FOR_REGISTRY_ID)', () => {
    const w = world();
    const stored = bundleFor(w.packet, ITEMS().slice(0, 2));
    const r = evaluateLifecycle(w.state, { ...w.evidence, stored, expected_bundle_hash: stored.bundle_hash });
    expect(r.per_ac[2]).toMatchObject({ state: 'INSUFFICIENT_EVIDENCE', reasons: ['NO_ITEM_FOR_REGISTRY_ID'] });
    expect(r.per_ac[0].state).toBe('VERIFIABLE');
  });

  it('a bundle that did not come from a passing scope check → INSUFFICIENT_EVIDENCE (EVIDENCE_NOT_FROM_VERIFY)', () => {
    const w = world();
    const stored = bundleFor(w.packet, ITEMS(), { scope: { ok: false, base_commit: BASE, head_commit: HEAD, changed_paths: ['x'], outside_authorized: ['x'], prohibited_touched: [] } });
    const r = evaluateLifecycle(w.state, { ...w.evidence, stored, expected_bundle_hash: stored.bundle_hash });
    expect(r.per_ac[0]).toMatchObject({ state: 'INSUFFICIENT_EVIDENCE', reasons: ['EVIDENCE_NOT_FROM_VERIFY'] });
  });

  it.each([
    ['duplicate items for one registry id', () => [...ITEMS(), item(4, 'jev.unit')], 'DUPLICATE_ITEMS_FOR_REGISTRY_ID'],
    ['item kind disagrees with the registry', () => [item(1, 'jev.unit', { evidence_kind: 'build' }), ...ITEMS().slice(1)], 'ITEM_KIND_MISMATCH'],
    ['PASS recorded with a non-zero exit', () => [item(1, 'jev.unit', { exit_code: 1 }), ...ITEMS().slice(1)], 'ITEM_RESULT_DISAGREES_WITH_EXIT'],
    ['FAIL recorded with exit 0', () => [item(1, 'jev.unit', { result: 'FAIL' }), ...ITEMS().slice(1)], 'ITEM_RESULT_DISAGREES_WITH_EXIT'],
  ])('CONFLICT: %s', (_name, items, reason) => {
    const w = world();
    const stored = bundleFor(w.packet, items());
    const r = evaluateLifecycle(w.state, { ...w.evidence, stored, expected_bundle_hash: stored.bundle_hash });
    expect(r.per_ac[0]).toMatchObject({ state: 'CONFLICT', reasons: [reason], deterministic: null });
  });
});

// ---------------------------------------------------------------- integrity

describe('evidence integrity', () => {
  it('content changed after hashing → INSUFFICIENT_EVIDENCE (EVIDENCE_HASH_MISMATCH); freshness is not even evaluated', () => {
    const w = world();
    const tampered = JSON.parse(JSON.stringify(w.stored)) as StoredEvidenceBundle;
    tampered.bundle.items[0].result = 'FAIL';
    const r = evaluateLifecycle(w.state, { ...w.evidence, stored: tampered });
    expect(r.integrity).toEqual({ ok: false, reason: 'EVIDENCE_HASH_MISMATCH' });
    expect(r.freshness).toEqual([]);
    expect(r.per_ac.slice(0, 3).map((a) => [a.state, a.reasons])).toEqual(Array(3).fill(['INSUFFICIENT_EVIDENCE', ['EVIDENCE_HASH_MISMATCH']]));
  });

  it('a bundle that cannot be canonicalized → INSUFFICIENT_EVIDENCE (EVIDENCE_NOT_CANONICAL)', () => {
    const w = world();
    const broken = { bundle: { ...w.stored.bundle, verified_at: () => 1 } as unknown as EvidenceBundle, bundle_hash: w.stored.bundle_hash };
    expect(evaluateLifecycle(w.state, { ...w.evidence, stored: broken }).integrity.reason).toBe('EVIDENCE_NOT_CANONICAL');
  });
});

// ---------------------------------------------------------------- freshness

describe('freshness: every identity dimension invalidates on its own', () => {
  type Mut = (w: ReturnType<typeof world>) => EvidenceUnderTest | void;
  const cases: Array<[FreshnessDimension, string, Mut]> = [
    ['bundle_hash', 'a newer bundle is current', (w) => ({ ...w.evidence, expected_bundle_hash: `sha256:${'f'.repeat(64)}` })],
    ['head', 'HEAD moved', (w) => void (w.state.head = 'c'.repeat(40))],
    ['head', 'tree is dirty', (w) => void (w.state.clean = false)],
    ['head', 'HEAD unknown', (w) => void (w.state.head = null)],
    ['packet_hash', 'binding re-bound to a new packet', (w) => void (w.state.binding = bindingFor(w.packet, { packet_hash: `sha256:${'e'.repeat(64)}` }))],
    ['packet_hash', 'packet no longer matches Jira', (w) => void (w.state.packet_stale_reasons = ['Story OMNI-44 updated changed'])],
    ['registry_digest', 'registry drifted', (w) => void (w.state.registry_digest = `sha256:${'d'.repeat(64)}`)],
    ['registry_digest', 'registry unreadable', (w) => void (w.state.registry_digest = null)],
    ['automation_policy_digest', 'policy changed since verification', (w) => void (w.state.automation_policy_digest = policyDigest('# automation policy v2\n'))],
    ['automation_policy_digest', 'policy absent at the evidence HEAD', (w) => ({ ...w.evidence, automation_policy_digest: null })],
    ['automation_policy_digest', 'policy in force unreadable', (w) => void (w.state.automation_policy_digest = null)],
    ['binding', 'no binding', (w) => void (w.state.binding = null)],
    ['binding', 'binding on another branch', (w) => void (w.state.binding = bindingFor(w.packet, { branch: 'omni-44/other' }))],
    ['binding', 'binding on another worktree', (w) => void (w.state.binding = bindingFor(w.packet, { worktree: 'C:/tmp/elsewhere' }))],
  ];

  it.each(cases)('%s (%s) → every Deterministic AC STALE on exactly that dimension; a PASS is never current', (dim, _why, mutate) => {
    const w = world();
    const evidence = mutate(w) || w.evidence;
    const r = evaluateLifecycle(w.state, evidence);
    expect(r.freshness.filter((c) => !c.fresh).map((c) => c.dimension)).toEqual([dim]);
    for (const a of r.per_ac.slice(0, 3)) {
      expect(a).toMatchObject({ state: 'STALE', stale_dimensions: [dim], reasons: [`STALE_${dim.toUpperCase()}`], deterministic: null });
    }
    expect(r.per_ac[3].state).toBe('NEEDS_HUMAN');
  });

  it('covers all six dimensions, reported in a fixed order', () => {
    expect(FRESHNESS_DIMENSIONS).toEqual(['bundle_hash', 'head', 'packet_hash', 'registry_digest', 'automation_policy_digest', 'binding']);
    expect(new Set(cases.map((c) => c[0]))).toEqual(new Set(FRESHNESS_DIMENSIONS));
    const w = world();
    expect(evaluateLifecycle(w.state, w.evidence).freshness.map((c) => c.dimension)).toEqual([...FRESHNESS_DIMENSIONS]);
  });

  it('stale beats the item result: a FAILED item on stale evidence is STALE, not FAILED', () => {
    const w = world();
    const items = ITEMS();
    items[0] = item(1, 'jev.unit', { exit_code: 1, result: 'FAIL' });
    const stored = bundleFor(w.packet, items);
    w.state.head = 'c'.repeat(40);
    expect(evaluateLifecycle(w.state, { ...w.evidence, stored, expected_bundle_hash: stored.bundle_hash }).per_ac[0].state).toBe('STALE');
  });

  it('the freshness report says why: a dirty tree, an unknown tree state, a packet that no longer matches Jira', () => {
    const head = (clean: boolean | null) => {
      const w = world();
      w.state.clean = clean;
      return evaluateLifecycle(w.state, w.evidence).freshness.find((c) => c.dimension === 'head');
    };
    expect(head(false)).toMatchObject({ fresh: false, expected: `${HEAD} (dirty)` });
    expect(head(null)).toMatchObject({ fresh: false, expected: `${HEAD} (tree state unknown)` });
    const w = world();
    w.state.packet_stale_reasons = ['Acceptance Criterion OMNI-45 updated changed'];
    expect(evaluateLifecycle(w.state, w.evidence).freshness.find((c) => c.dimension === 'packet_hash')).toMatchObject({
      fresh: false,
      expected: `${w.packet.packet_hash} (packet no longer matches Jira)`,
      observed: w.packet.packet_hash,
    });
  });

  it('several moved dimensions are all reported', () => {
    const w = world();
    w.state.head = 'c'.repeat(40);
    w.state.binding = null;
    expect(evaluateLifecycle(w.state, w.evidence).per_ac[0].stale_dimensions).toEqual(['head', 'binding']);
  });

  it('policyDigest ignores CRLF vs LF (a Windows checkout and its git blob agree) but not content', () => {
    expect(policyDigest('a\r\nb\r\n')).toBe(policyDigest('a\nb\n'));
    expect(policyDigest('a\nb\n')).not.toBe(policyDigest('a\nc\n'));
    expect(policyDigest('x')).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------- AC → registry id

describe('AC-specific mapping to a registry id', () => {
  const map = (statement: string, evidenceKind: string, ids = IDS) => mapAcToRegistryId(ac(9, statement, 'Deterministic', evidenceKind), ids, KINDS);

  it('the gov-intake statement names the id', () => {
    expect(map('Registry check backend-tests.typecheck passes on the governed HEAD (x).', 'Typecheck')).toEqual({ ok: true, registry_id: 'backend-tests.typecheck', mapping: 'statement' });
  });

  it('without a statement id, the unique packet id producing the AC evidence kind', () => {
    expect(map('The unit tests pass', 'Test')).toEqual({ ok: true, registry_id: 'jev.unit', mapping: 'evidence_kind' });
  });

  it('two ids produce the kind and the statement names neither → NEEDS_HUMAN (never guessed)', () => {
    expect(map('Types check', 'Typecheck')).toEqual({ ok: false, state: 'NEEDS_HUMAN', reason: 'AC_REGISTRY_ID_AMBIGUOUS' });
  });

  it('no packet id produces the kind → NEEDS_HUMAN', () => {
    expect(map('It builds', 'Build')).toEqual({ ok: false, state: 'NEEDS_HUMAN', reason: 'AC_NO_REGISTRY_ID' });
  });

  it('a non-deterministic evidence kind → NEEDS_HUMAN', () => {
    expect(map('Lint passes', 'Lint')).toEqual({ ok: false, state: 'NEEDS_HUMAN', reason: 'AC_EVIDENCE_KIND_NOT_DETERMINISTIC' });
  });

  it('the statement names an id outside the packet → CONFLICT', () => {
    expect(map('Registry check other.check passes on the governed HEAD.', 'Test')).toEqual({ ok: false, state: 'CONFLICT', reason: 'AC_REGISTRY_ID_NOT_IN_PACKET' });
  });

  it('the statement names an id of another evidence kind → CONFLICT', () => {
    expect(map('Registry check jev.unit passes on the governed HEAD.', 'Typecheck')).toEqual({ ok: false, state: 'CONFLICT', reason: 'AC_EVIDENCE_KIND_MISMATCH' });
  });

  it('mapping outcomes flow into the AC state (NEEDS_HUMAN / CONFLICT) before any evidence is consulted', () => {
    const acs = [ac(1, 'Types check', 'Deterministic', 'Typecheck'), ac(2, 'Registry check nope.x passes', 'Deterministic', 'Test')];
    const w = world(acs);
    const r = evaluateLifecycle(w.state, { stored: null, automation_policy_digest: null });
    expect(r.per_ac.map((a) => [a.state, a.reasons[0], a.human_decision_required])).toEqual([
      ['NEEDS_HUMAN', 'AC_REGISTRY_ID_AMBIGUOUS', true],
      ['CONFLICT', 'AC_REGISTRY_ID_NOT_IN_PACKET', false],
    ]);
  });

  it('an unknown AC kind → NEEDS_HUMAN', () => {
    const w = world([{ ...ac(1, 'x', 'Deterministic', 'Test'), kind: 'Other' as 'Judgment' }]);
    expect(evaluateLifecycle(w.state, w.evidence).per_ac[0]).toMatchObject({ state: 'NEEDS_HUMAN', reasons: ['UNSUPPORTED_AC_KIND'] });
  });
});

// ---------------------------------------------------------------- determinism + purity

describe('deterministic and pure', () => {
  it('same inputs → identical result and hash; inputs are not mutated', () => {
    const w = world();
    const before = JSON.stringify({ s: w.state, e: w.evidence });
    const a = evaluateLifecycle(w.state, w.evidence);
    const b = evaluateLifecycle(w.state, w.evidence);
    expect(b).toEqual(a);
    expect(canonicalHash(b)).toBe(canonicalHash(a));
    expect(JSON.stringify({ s: w.state, e: w.evidence })).toBe(before);
  });

  it('ACs are reported in Jira key order whatever the packet order', () => {
    const w = world([...ACS].reverse());
    const r = evaluateLifecycle(w.state, { stored: null, automation_policy_digest: null });
    expect(r.per_ac.map((a) => a.ac_key)).toEqual(['OMNI-45', 'OMNI-46', 'OMNI-47', 'OMNI-48']);
  });

  it('lifecycle.ts has no I/O, clock, randomness, JEV or Jira dependency', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../../scripts/jev-flow/lifecycle.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(src).not.toMatch(/from 'node:(fs|child_process|http|https|net)'/);
    expect(src).not.toMatch(/\b(Date\.now|new Date|Math\.random|process\.env|readFileSync|writeFileSync|appendFileSync|fetch\s*\()/);
    expect(src).not.toMatch(/jev-bjc\/(judge|provider)|jev-jira|judgeFlow|writeAdvisoryFields/);
  });
});

// ---------------------------------------------------------------- submission

describe('per-AC submission values', () => {
  it('a Deterministic AC gets its own item; a Judgment AC never gets a bundle-wide PASS', () => {
    const w = world();
    expect(acSubmission(ACS[1], w.stored, w.packet, KINDS)).toEqual({ kind: 'deterministic', registry_id: 'scripts.typecheck', item_id: 'EV-2', result: 'PASS' });
    expect(acSubmission(ACS[3], w.stored, w.packet, KINDS)).toEqual({ kind: 'human', reason: 'HUMAN_JUDGMENT_REQUIRED' });
  });

  it('an AC whose item failed reports FAIL even when every other item passed; an ambiguous AC goes to a human', () => {
    const w = world();
    const items = ITEMS();
    items[2] = item(3, 'backend-tests.typecheck', { exit_code: 1, result: 'FAIL' });
    const stored = bundleFor(w.packet, items);
    expect(acSubmission(ACS[2], stored, w.packet, KINDS)).toMatchObject({ kind: 'deterministic', result: 'FAIL' });
    expect(acSubmission(ac(9, 'Types check', 'Deterministic', 'Typecheck'), stored, w.packet, KINDS)).toEqual({ kind: 'human', reason: 'AC_REGISTRY_ID_AMBIGUOUS' });
    expect(acSubmission(ACS[0], bundleFor(w.packet, ITEMS().slice(1)), w.packet, KINDS)).toEqual({ kind: 'none', reason: 'NO_ITEM_FOR_REGISTRY_ID' });
  });
});
