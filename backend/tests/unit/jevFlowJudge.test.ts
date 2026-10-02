/**
 * gov judge (Track 4) — packet + evidence bundle → BJC → optional advisory write-back.
 * No network: Git, Jira and JEV are injected fakes (Phase 2 patterns).
 */
import fs from 'node:fs';
import path from 'node:path';
import { bjcRequestSchema } from '../../../scripts/jev-bjc/contract';
import { MemoryAuditSink } from '../../../scripts/jev-bjc/audit';
import { BjcTransportError, type JevTransport, type ProviderReply, type ProviderRequestBody } from '../../../scripts/jev-bjc/provider';
import { AC_FIELDS, ADVISORY_WRITE_FIELDS, JEV_VERDICT_OPTIONS } from '../../../scripts/jev-jira/fields';
import { JiraClientError, assertAdvisoryOnly, type JiraClient, type JiraIssue } from '../../../scripts/jev-jira/jiraClient';
import { AC_FETCH_FIELDS } from '../../../scripts/jev-jira/context';
import { buildGovBjcRequest, runJudgeFlow, type JudgeFlowInput } from '../../../scripts/jev-flow/judgeFlow';
import {
  BINDING_SCHEMA,
  EVIDENCE_SCHEMA,
  GOVERNANCE_VERSION,
  HUMAN_ONLY_RULES,
  JUDGE_SCHEMA,
  PACKET_SCHEMA,
  bundleHash,
  canonicalHash,
  hashHex,
  packetHash,
  type DeterministicResult,
  type EvidenceBundle,
  type EvidenceItem,
  type GitProbe,
  type GovernedPacket,
  type PacketAc,
  type StoredEvidenceBundle,
  type StoredPacket,
} from '../../../scripts/jev-flow/types';

void BINDING_SCHEMA;

const REPO = path.resolve(__dirname, '../../..');
const HEAD = 'a'.repeat(8) + 'b'.repeat(32);
const BASE = 'c'.repeat(40);
const WORKTREE = 'C:/tmp/gov-wt-OMNI-10';
const LOG_SENTINEL = 'LOG-CONTENT-NEVER-SENT';
const OPTION_VALUES: Record<string, string> = { '10044': 'PASS', '10045': 'FAIL', '10046': 'INSUFFICIENT_EVIDENCE', '10047': 'CONFLICT', '10048': 'NOT_RUN' };

const sel = (value: string, id = `opt-${value}`) => ({ value, id });

function acIssue(key = 'OMNI-11', over: Record<string, unknown> = {}): JiraIssue {
  return {
    key,
    fields: {
      issuetype: { id: '10074' },
      project: { id: '10033' },
      status: { id: '10038', name: 'In Review' },
      parent: { key: 'OMNI-10' },
      updated: '2026-10-01T10:00:00.000+0000',
      [AC_FIELDS.acId]: key === 'OMNI-11' ? 'AC-1' : 'AC-2',
      [AC_FIELDS.statement]: key === 'OMNI-11' ? 'The health route unit tests pass' : 'The change is easy to review',
      [AC_FIELDS.kind]: key === 'OMNI-11' ? sel('Deterministic', '10024') : sel('Judgment', '10025'),
      [AC_FIELDS.evidenceKind]: sel('Test', '10026'),
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

class FakeJira implements JiraClient {
  readonly issues = new Map<string, JiraIssue>();
  readonly reads: Array<{ key: string; fields: readonly string[] }> = [];
  readonly updates: Array<{ key: string; fields: Record<string, unknown> }> = [];

  constructor(...issues: JiraIssue[]) {
    for (const i of issues) this.issues.set(i.key, i);
  }

  async getIssue(key: string, fields: readonly string[]): Promise<JiraIssue> {
    this.reads.push({ key, fields });
    const issue = this.issues.get(key);
    if (!issue) throw new JiraClientError('JIRA_NOT_FOUND', 'Jira returned HTTP 404');
    return JSON.parse(JSON.stringify(issue));
  }

  async updateAdvisoryFields(key: string, fields: Record<string, unknown>): Promise<void> {
    assertAdvisoryOnly(fields);
    this.updates.push({ key, fields: JSON.parse(JSON.stringify(fields)) });
    const issue = this.issues.get(key) as JiraIssue;
    for (const [k, v] of Object.entries(fields)) {
      issue.fields[k] = v && typeof v === 'object' ? { id: (v as { id: string }).id, value: OPTION_VALUES[(v as { id: string }).id] } : v;
    }
  }
}

function reply(ac: string, inv: [string, string] = ['HOLDS', 'HOLDS'], model = 'jev-1.13.0'): ProviderReply {
  return {
    answers: {
      ac: { choice: ac, confidence: 0.9 },
      inv_0: { choice: inv[0], confidence: 0.8 },
      inv_1: { choice: inv[1], confidence: 0.8 },
      bundle_consistency: { noul: 0.95 },
    },
    model,
  };
}

function fakeTransport(...steps: Array<ProviderReply | Error>): JevTransport & { calls: number; bodies: ProviderRequestBody[] } {
  const t = {
    calls: 0,
    bodies: [] as ProviderRequestBody[],
    async send(body: ProviderRequestBody) {
      t.bodies.push(JSON.parse(JSON.stringify(body)));
      const step = steps[Math.min(t.calls, steps.length - 1)];
      t.calls += 1;
      if (step instanceof Error) throw step;
      return step;
    },
  };
  return t;
}

function fakeGit(over: Partial<{ head: string; clean: boolean }> = {}): GitProbe {
  const head = over.head ?? HEAD;
  const clean = over.clean ?? true;
  return {
    headCommit: async () => head,
    currentBranch: async () => 'gov/OMNI-10',
    isClean: async () => clean,
    isAncestor: async () => true,
    changedPaths: async () => ['scripts/health.ts'],
    commitsBetween: async () => [HEAD],
    commitTrailers: async () => ({}),
  };
}

const AC1: PacketAc = {
  key: 'OMNI-11', ac_id: 'AC-1', statement: 'The health route unit tests pass', kind: 'Deterministic',
  evidence_kind: 'Test', status: 'In Review', verification: 'UNVERIFIED', updated: '2026-10-01T10:00:00.000Z',
};
const AC2: PacketAc = {
  key: 'OMNI-12', ac_id: 'AC-2', statement: 'The change is easy to review', kind: 'Judgment',
  evidence_kind: 'Test', status: 'In Review', verification: 'UNVERIFIED', updated: '2026-10-01T10:00:00.000Z',
};

function makePacket(acs: PacketAc[] = [AC1], over: Partial<GovernedPacket> = {}): StoredPacket {
  const packet: GovernedPacket = {
    schema: PACKET_SCHEMA,
    governance_version: GOVERNANCE_VERSION,
    story: {
      key: 'OMNI-10', summary: 'Health route', status: 'In Progress',
      objective: 'OBJECTIVE-TEXT-NOT-SENT', architecture: 'ARCHITECTURE-TEXT-NOT-SENT',
      invariants: ['No route skips auth', 'No schema change'], updated: '2026-10-01T09:00:00.000Z',
    },
    acceptance_criteria: acs,
    scope: { authorized_paths: ['AUTHORIZED-PATH-NOT-SENT/**'], prohibited_paths: ['supabase/**'] },
    verification: { registry_ids: ['jev.unit', 'scripts.typecheck'], registry_digest: canonicalHash(['jev.unit', 'scripts.typecheck']) },
    base: { commit: BASE, branch: 'gov/OMNI-10', worktree: WORKTREE },
    rules: [...HUMAN_ONLY_RULES],
    ...over,
  };
  return { packet, packet_hash: packetHash(packet) };
}

function item(n: number, registry_id: string, kind: EvidenceItem['evidence_kind'], result: DeterministicResult): EvidenceItem {
  return {
    id: `EV-${n}`, registry_id, evidence_kind: kind, argv_digest: canonicalHash(['node', registry_id]),
    exit_code: result === 'PASS' ? 0 : 1, result, timed_out: false,
    log_sha256: canonicalHash(`${LOG_SENTINEL}-${n}`), log_bytes: 1234,
    started_at: '2026-10-01T11:00:00.000Z', finished_at: '2026-10-01T11:01:00.000Z',
  };
}

function makeBundle(stored: StoredPacket, opts: { test?: DeterministicResult; over?: Partial<EvidenceBundle> } = {}): StoredEvidenceBundle {
  const items = [item(1, 'jev.unit', 'test_run', opts.test ?? 'PASS'), item(2, 'scripts.typecheck', 'typecheck', 'PASS')];
  const bundle: EvidenceBundle = {
    schema: EVIDENCE_SCHEMA,
    governance_version: GOVERNANCE_VERSION,
    story_key: stored.packet.story.key,
    packet_hash: stored.packet_hash,
    worktree: WORKTREE,
    branch: 'gov/OMNI-10',
    base_commit: BASE,
    head_commit: HEAD,
    registry_digest: stored.packet.verification.registry_digest,
    scope: { ok: true, base_commit: BASE, head_commit: HEAD, changed_paths: ['scripts/health.ts'], outside_authorized: [], prohibited_touched: [] },
    items,
    deterministic_result: items.every((i) => i.result === 'PASS') ? 'PASS' : 'FAIL',
    verified_at: '2026-10-01T11:02:00.000Z',
    ...opts.over,
  };
  return { bundle, bundle_hash: bundleHash(bundle) };
}

interface RunOpts {
  stored?: StoredPacket;
  evidence?: StoredEvidenceBundle;
  test?: DeterministicResult;
  git?: GitProbe;
  jira?: FakeJira;
  transport?: (JevTransport & { calls?: number }) | null;
  input?: Partial<JudgeFlowInput>;
}

async function run(opts: RunOpts = {}) {
  const stored = opts.stored ?? makePacket();
  const evidence = opts.evidence ?? makeBundle(stored, { test: opts.test });
  const jira = opts.jira ?? new FakeJira(acIssue('OMNI-11'), acIssue('OMNI-12'));
  const transport = opts.transport === undefined ? fakeTransport(reply('SUPPORTS')) : opts.transport;
  const bjcAudit = new MemoryAuditSink();
  let rec = 0;
  const result = await runJudgeFlow({
    stored,
    evidence,
    worktree: WORKTREE,
    git: opts.git ?? fakeGit(),
    jira,
    transport,
    bjcAudit,
    writeBack: true,
    invokedBy: 'claude-code:session-1',
    now: () => new Date('2026-10-01T12:00:00Z'),
    newRecordId: () => `rec-${++rec}`,
    ...opts.input,
  });
  return { result, jira, transport, bjcAudit, stored, evidence };
}

const calls = (t: unknown) => (t as { calls?: number } | null)?.calls ?? 0;

describe('gov judge — deterministic evidence stays authoritative', () => {
  it('deterministic FAIL + JEV SUPPORTS → combined FAIL, never PASS; Jira JEV verdict CONFLICT', async () => {
    const { result, jira } = await run({ test: 'FAIL', transport: fakeTransport(reply('SUPPORTS')) });
    expect(result.status).toBe('OK');
    expect(result.per_ac).toHaveLength(1);
    const j = result.per_ac[0];
    expect(j.deterministic_result).toBe('FAIL');
    expect(j.jev_answer).toBe('SUPPORTS');
    expect(j.combined_verdict).toBe('FAIL');
    expect(j.conflict).toBe(true);
    expect(j.review_required).toBe(true);
    expect(j.jira_jev_verdict).toBe('CONFLICT');
    expect(jira.updates).toHaveLength(1);
    expect(jira.updates[0].fields[AC_FIELDS.jevVerdict]).toEqual({ id: JEV_VERDICT_OPTIONS.CONFLICT });
  });

  it('deterministic FAIL + JEV CONTRADICTS → FAIL / Jira FAIL', async () => {
    const { result } = await run({ test: 'FAIL', transport: fakeTransport(reply('CONTRADICTS')) });
    expect(result.per_ac[0].combined_verdict).toBe('FAIL');
    expect(result.per_ac[0].jira_jev_verdict).toBe('FAIL');
    expect(result.per_ac[0].conflict).toBe(false);
  });

  it('deterministic PASS + JEV CONTRADICTS → PASS_DISPUTED, conflict, review — never an automatic FAIL', async () => {
    const { result } = await run({ transport: fakeTransport(reply('CONTRADICTS')) });
    const j = result.per_ac[0];
    expect(result.status).toBe('OK');
    expect(j.deterministic_result).toBe('PASS');
    expect(j.combined_verdict).toBe('PASS_DISPUTED');
    expect(j.conflict).toBe(true);
    expect(j.review_required).toBe(true);
    expect(j.jira_jev_verdict).toBe('CONFLICT');
    expect(j.combined_verdict).not.toBe('FAIL');
  });

  it('PASS + SUPPORTS → PASS_CORROBORATED; write-back writes exactly the four JEV fields', async () => {
    const { result, jira, bjcAudit } = await run();
    const j = result.per_ac[0];
    expect(result).toMatchObject({ schema: JUDGE_SCHEMA, governance_version: GOVERNANCE_VERSION, status: 'OK', story_key: 'OMNI-10', write_back: true, error: null });
    expect(j).toMatchObject({
      ac_key: 'OMNI-11', ac_id: 'AC-1', evidence_ids: ['EV-1'], bjc_status: 'COMPLETED',
      combined_verdict: 'PASS_CORROBORATED', jira_jev_verdict: 'PASS', conflict: false, writeback_status: 'WRITTEN',
      bjc_audit_record_id: 'rec-1',
    });
    expect(j.input_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(jira.updates).toHaveLength(1);
    expect(jira.updates[0].key).toBe('OMNI-11');
    expect(Object.keys(jira.updates[0].fields).sort()).toEqual(['customfield_10099', 'customfield_10100', 'customfield_10101', 'customfield_10102']);
    expect(Object.keys(jira.updates[0].fields).sort()).toEqual([...ADVISORY_WRITE_FIELDS].sort());
    expect(jira.updates[0].fields[AC_FIELDS.jevInputHash]).toBe(j.input_hash);
    expect(bjcAudit.records).toHaveLength(1);
    expect(bjcAudit.records[0].invoked_by).toBe('claude-code:session-1');
  });

  it('writeBack false → judged, nothing written, writeback SKIPPED', async () => {
    const { result, jira } = await run({ input: { writeBack: false } });
    expect(result.status).toBe('OK');
    expect(result.write_back).toBe(false);
    expect(result.per_ac[0].writeback_status).toBe('SKIPPED');
    expect(result.per_ac[0].combined_verdict).toBe('PASS_CORROBORATED');
    expect(jira.updates).toHaveLength(0);
    // read-only: only the staleness reads
    expect(jira.reads).toEqual([{ key: 'OMNI-11', fields: AC_FETCH_FIELDS }]);
  });

  it('judges every AC in key order; a JUDGMENT AC gets all evidence and ADVISORY_ONLY', async () => {
    const stored = makePacket([AC2, AC1]);
    const transport = fakeTransport(reply('SUPPORTS'));
    const { result, jira } = await run({ stored, transport });
    expect(result.status).toBe('OK');
    expect(result.per_ac.map((a) => a.ac_key)).toEqual(['OMNI-11', 'OMNI-12']);
    expect(result.per_ac[1]).toMatchObject({ evidence_ids: ['EV-1', 'EV-2'], combined_verdict: 'ADVISORY_ONLY', review_required: true, jira_jev_verdict: 'PASS' });
    expect(transport.calls).toBe(2);
    expect(jira.updates.map((u) => u.key)).toEqual(['OMNI-11', 'OMNI-12']);
  });

  it('a Deterministic AC with no matching evidence item is INSUFFICIENT_EVIDENCE, never PASS', async () => {
    const stored = makePacket([{ ...AC1, evidence_kind: 'Build' }]);
    const { result } = await run({ stored });
    expect(result.per_ac[0]).toMatchObject({ evidence_ids: [], deterministic_result: 'MISSING', combined_verdict: 'INSUFFICIENT_EVIDENCE', jira_jev_verdict: 'INSUFFICIENT_EVIDENCE' });
  });
});

describe('gov judge — fail closed before any JEV call', () => {
  it('packet hash mismatch → INTEGRITY_FAILED', async () => {
    const stored = makePacket();
    const tampered: StoredPacket = { packet: { ...stored.packet, story: { ...stored.packet.story, objective: 'changed' } }, packet_hash: stored.packet_hash };
    const evidence = makeBundle(stored);
    const { result, transport, jira } = await run({ stored: tampered, evidence });
    expect(result.status).toBe('INTEGRITY_FAILED');
    expect(result.error).toMatch(/packet hash/);
    expect(calls(transport)).toBe(0);
    expect(jira.reads).toHaveLength(0);
    expect(jira.updates).toHaveLength(0);
  });

  it('bundle hash mismatch → INTEGRITY_FAILED', async () => {
    const stored = makePacket();
    const evidence = makeBundle(stored);
    const tampered: StoredEvidenceBundle = { bundle: { ...evidence.bundle, deterministic_result: 'PASS', items: evidence.bundle.items.map((i) => ({ ...i, exit_code: 7 })) }, bundle_hash: evidence.bundle_hash };
    const { result, transport } = await run({ stored, evidence: tampered });
    expect(result.status).toBe('INTEGRITY_FAILED');
    expect(result.error).toMatch(/bundle hash/);
    expect(calls(transport)).toBe(0);
  });

  it('bundle produced for a different packet → INTEGRITY_FAILED', async () => {
    const stored = makePacket();
    const other = makePacket([AC1], { rules: ['different'] });
    const evidence = makeBundle(other);
    const { result, transport } = await run({ stored, evidence });
    expect(result.status).toBe('INTEGRITY_FAILED');
    expect(result.error).toMatch(/different packet/);
    expect(calls(transport)).toBe(0);
  });

  it('bundle story key disagreeing with the packet → INTEGRITY_FAILED', async () => {
    const stored = makePacket();
    const evidence = makeBundle(stored, { over: { story_key: 'OMNI-99' } });
    const { result, transport } = await run({ stored, evidence });
    expect(result.status).toBe('INTEGRITY_FAILED');
    expect(calls(transport)).toBe(0);
  });

  it('HEAD moved after verification → INTEGRITY_FAILED', async () => {
    const { result, transport, jira } = await run({ git: fakeGit({ head: 'd'.repeat(40) }) });
    expect(result.status).toBe('INTEGRITY_FAILED');
    expect(result.error).toMatch(/HEAD moved/);
    expect(calls(transport)).toBe(0);
    expect(jira.reads).toHaveLength(0);
  });

  it('dirty tree → REFUSED', async () => {
    const { result, transport } = await run({ git: fakeGit({ clean: false }) });
    expect(result.status).toBe('REFUSED');
    expect(calls(transport)).toBe(0);
  });

  it('git probe failure → ERROR, nothing judged', async () => {
    const git = { ...fakeGit(), headCommit: async () => { throw new Error('git missing'); } };
    const { result, transport } = await run({ git });
    expect(result.status).toBe('ERROR');
    expect(calls(transport)).toBe(0);
  });

  it('scope.ok false → REFUSED', async () => {
    const stored = makePacket();
    const evidence = makeBundle(stored, { over: { scope: { ok: false, base_commit: BASE, head_commit: HEAD, changed_paths: ['supabase/x.sql'], outside_authorized: [], prohibited_touched: ['supabase/x.sql'] } } });
    const { result, transport } = await run({ stored, evidence });
    expect(result.status).toBe('REFUSED');
    expect(calls(transport)).toBe(0);
  });

  it('empty evidence items → REFUSED', async () => {
    const stored = makePacket();
    const evidence = makeBundle(stored, { over: { items: [] } });
    const { result, transport } = await run({ stored, evidence });
    expect(result.status).toBe('REFUSED');
    expect(calls(transport)).toBe(0);
  });

  it('invalid invoked-by → REFUSED (Phase 2 identity rule)', async () => {
    const { result, transport } = await run({ input: { invokedBy: 'bot:x' } });
    expect(result.status).toBe('REFUSED');
    expect(calls(transport)).toBe(0);
  });

  it('more invariants than BJC allows → REFUSED (never truncated)', async () => {
    const base = makePacket();
    const stored = makePacket([AC1], { story: { ...base.packet.story, invariants: Array.from({ length: 21 }, (_, i) => `inv ${i}`) } });
    const { result, transport } = await run({ stored });
    expect(result.status).toBe('REFUSED');
    expect(result.error).toMatch(/invariants/);
    expect(calls(transport)).toBe(0);
  });

  it('Jira AC updated after the packet → STALE, nothing judged or written', async () => {
    const jira = new FakeJira(acIssue('OMNI-11', { updated: '2026-10-01T10:05:00.000+0000' }));
    const { result, transport } = await run({ jira });
    expect(result.status).toBe('STALE');
    expect(result.per_ac).toHaveLength(0);
    expect(calls(transport)).toBe(0);
    expect(jira.updates).toHaveLength(0);
  });

  it('one stale AC among several refuses the whole run', async () => {
    const stored = makePacket([AC1, AC2]);
    const jira = new FakeJira(acIssue('OMNI-11'), acIssue('OMNI-12', { updated: '2026-10-02T00:00:00.000+0000' }));
    const { result, transport } = await run({ stored, jira });
    expect(result.status).toBe('STALE');
    expect(calls(transport)).toBe(0);
    expect(jira.updates).toHaveLength(0);
  });

  it('AC missing in Jira → STALE', async () => {
    const jira = new FakeJira();
    const { result, transport } = await run({ jira });
    expect(result.status).toBe('STALE');
    expect(calls(transport)).toBe(0);
  });
});

describe('gov judge — JEV unavailable never fabricates a verdict', () => {
  it('no transport → JUDGMENT_UNAVAILABLE, no writes', async () => {
    const { result, jira, bjcAudit } = await run({ transport: null });
    expect(result.status).toBe('JUDGMENT_UNAVAILABLE');
    expect(result.per_ac[0]).toMatchObject({ bjc_status: 'JUDGMENT_UNAVAILABLE', combined_verdict: null, jira_jev_verdict: null, jev_answer: null, writeback_status: 'SKIPPED' });
    expect(jira.updates).toHaveLength(0);
    expect(bjcAudit.records).toHaveLength(1);
  });

  it('provider timeout → JUDGMENT_UNAVAILABLE, no writes', async () => {
    const timeout = new BjcTransportError('TIMEOUT', 'provider did not answer within 8000 ms', true);
    const transport = fakeTransport(timeout, timeout);
    const { result, jira } = await run({ transport });
    expect(result.status).toBe('JUDGMENT_UNAVAILABLE');
    expect(result.error).toMatch(/TIMEOUT/);
    expect(result.per_ac[0].combined_verdict).toBeNull();
    expect(transport.calls).toBe(2);
    expect(jira.updates).toHaveLength(0);
  });

  it('one AC unavailable → no AC is written', async () => {
    const stored = makePacket([AC1, AC2]);
    const transport = fakeTransport(reply('SUPPORTS'), new BjcTransportError('PROVIDER_HTTP_ERROR', 'provider returned HTTP 400', false));
    const { result, jira } = await run({ stored, transport });
    expect(result.status).toBe('JUDGMENT_UNAVAILABLE');
    expect(result.per_ac.map((a) => a.bjc_status)).toEqual(['COMPLETED', 'JUDGMENT_UNAVAILABLE']);
    expect(result.per_ac.every((a) => a.writeback_status === 'SKIPPED')).toBe(true);
    expect(jira.updates).toHaveLength(0);
  });
});

describe('gov judge — the request is bounded and metadata-only', () => {
  it('request is a valid bjc/1 request with gov ids and refs', () => {
    const stored = makePacket();
    const evidence = makeBundle(stored);
    const built = buildGovBjcRequest(stored, evidence, AC1, 'human:kuldeep', 'jev-1.13.0');
    if (built.ok === false) throw new Error(built.message);
    const req = built.request;
    expect(bjcRequestSchema.safeParse(req).success).toBe(true);
    expect(req.request_id).toBe(`gov-OMNI-11-${hashHex(evidence.bundle_hash).slice(0, 12)}`);
    expect(req).toMatchObject({ work_item: 'OMNI-11', task_id: 'OMNI-10', acceptance_criterion: { id: 'AC-1', kind: 'OBJECTIVE', required_evidence: ['test_run'] } });
    expect(req.invariants).toEqual([
      { id: 'INV-1', statement: 'No route skips auth', source: 'OMNI-10 Invariants' },
      { id: 'INV-2', statement: 'No schema change', source: 'OMNI-10 Invariants' },
    ]);
    expect(req.evidence).toEqual([{
      id: 'EV-1', kind: 'test_run', ref: `gov:jev.unit@${HEAD.slice(0, 12)}`, sha256: hashHex(evidence.bundle.items[0].log_sha256),
      produced_by: 'gov-flow/1', result: 'PASS', captured_at: '2026-10-01T11:01:00.000Z', ac_ids: ['AC-1'],
    }]);
    expect(req.deterministic_summary).toBe(`gov-flow/1 verified ${HEAD.slice(0, 12)} on gov/OMNI-10: jev.unit=PASS, scripts.typecheck=PASS; scope ok; overall PASS.`);
  });

  it('the provider body carries only the AC statement, invariants, summary and evidence metadata; model jev-1.13.0 by default', async () => {
    const transport = fakeTransport(reply('SUPPORTS'));
    const { result, stored } = await run({ transport });
    expect(result.model).toBe('jev-1.13.0');
    expect(transport.bodies).toHaveLength(1);
    const body = transport.bodies[0];
    expect(body.model).toBe('jev-1.13.0');
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/excerpt/i);
    expect(body.state).toContain('The health route unit tests pass');
    expect(body.state).toContain('No route skips auth');
    expect(body.state).toContain('No schema change');
    expect(body.state).toContain(`gov-flow/1 verified ${HEAD.slice(0, 12)}`);
    expect(body.state).toContain(`ref=gov:jev.unit@${HEAD.slice(0, 12)}`);
    for (const forbidden of [
      LOG_SENTINEL, 'OBJECTIVE-TEXT-NOT-SENT', 'ARCHITECTURE-TEXT-NOT-SENT', 'AUTHORIZED-PATH-NOT-SENT', 'scripts/health.ts',
      WORKTREE, stored.packet_hash, 'diff --git', '@@ ', HUMAN_ONLY_RULES[0], 'argv',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    // only state / model / questions leave the machine
    expect(Object.keys(body).sort()).toEqual(['model', 'questions', 'state']);
    // every state line is one of the BJC template lines
    for (const line of body.state.split('\n')) {
      expect(line).toMatch(/^(|Judge ONLY .*|Acceptance criterion AC-1 \(OBJECTIVE\): .*|Deterministic evidence summary: gov-flow\/1 .*|Invariants:|- INV-\d: .*|Evidence:|- EV-\d \[test_run\] result=(PASS|FAIL) by gov-flow\/1 at .* ref=gov:[a-z0-9._-]+@[0-9a-f]{12})$/);
    }
  });

  it('an explicit model is passed through', async () => {
    const transport = fakeTransport(reply('SUPPORTS', ['HOLDS', 'HOLDS'], 'jev-2.0.0'));
    const { result } = await run({ transport, input: { model: 'jev-2.0.0' } });
    expect(result.model).toBe('jev-2.0.0');
    expect(transport.bodies[0].model).toBe('jev-2.0.0');
  });
});

describe('gov judge — static write-surface check', () => {
  const src = fs.readFileSync(path.join(REPO, 'scripts', 'jev-flow', 'judgeFlow.ts'), 'utf8');

  it('has no Jira transitions, no direct advisory update, no HTTP of its own', () => {
    expect(src).not.toContain('/transitions');
    expect(src).not.toContain('transitionIssue');
    expect(src).not.toContain('updateAdvisoryFields(');
    expect(src).not.toMatch(/\bPUT\b/);
    expect(src).not.toMatch(/\bPOST\b/);
    expect(src).not.toMatch(/\bfetch\s*\(/);
    expect(src).not.toMatch(/createIssue|createJiraClient|createTypeSafeTransport/);
    expect(src).toContain('writeAdvisoryFields(jira, ac.key, fresh.get(ac.key), buildAdvisoryUpdate(res))');
  });

  it('imports only Phase 2 modules and the shared gov contract', () => {
    const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]).sort();
    expect(imports).toEqual([
      '../jev-bjc/audit', '../jev-bjc/canonical', '../jev-bjc/contract', '../jev-bjc/judge', '../jev-bjc/provider',
      '../jev-jira/cli', '../jev-jira/context', '../jev-jira/jiraClient', '../jev-jira/writeback', './types',
    ]);
  });
});
