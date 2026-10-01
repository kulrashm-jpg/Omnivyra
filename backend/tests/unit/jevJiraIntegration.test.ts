/**
 * Jira ↔ BJC orchestrator (phase 2, T1 / Acceptance Criterion).
 * No network: Jira and JEV are injected fakes; HTTP-level tests use a mock fetch.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AC_KINDS, JEV_AC_ANSWERS, JEV_INVARIANT_ANSWERS, bjcRequestSchema, type BjcResponse, type DeterministicResult, type JevAcAnswer } from '../../../scripts/jev-bjc/contract';
import { computeInputHash, sha256Hex } from '../../../scripts/jev-bjc/canonical';
import { combine } from '../../../scripts/jev-bjc/combiner';
import { MemoryAuditSink } from '../../../scripts/jev-bjc/audit';
import { BjcTransportError, type JevTransport, type ProviderReply } from '../../../scripts/jev-bjc/provider';
import {
  ADVISORY_WRITE_FIELDS,
  AC_FIELDS,
  PROTECTED_AC_FIELDS,
  JEV_VERDICT_OPTIONS,
  JIRA_GATEWAY_BASE,
  STORY_FIELDS,
} from '../../../scripts/jev-jira/fields';
import { JiraClientError, assertAdvisoryOnly, authorizationHeader, createJiraClient, resolveJiraAuthMode, resolveJiraCredentials, type JiraClient, type JiraIssue } from '../../../scripts/jev-jira/jiraClient';
import { AC_FETCH_FIELDS, STORY_FETCH_FIELDS, buildBjcRequest, extractAcContext, extractStoryContext } from '../../../scripts/jev-jira/context';
import { buildAdvisoryUpdate, mapJiraJevVerdict } from '../../../scripts/jev-jira/writeback';
import { FileIntegrationAuditSink, MemoryIntegrationAuditSink, runAcJudgment, type RunInput } from '../../../scripts/jev-jira/orchestrator';
import { DEFAULT_JEV_MODEL, resolveModel, runCli } from '../../../scripts/jev-jira/cli';
import { IDENTITY_TOKEN_ENV, identityViolations, preflightPermissionKeys, resolveRuntimeIdentity } from '../../../scripts/jev-jira/identity';
import { isFloatingModel } from '../../../scripts/jev-bjc/contract';
import { TYPESAFE_SYSTEMONE_URL } from '../../../scripts/jev-bjc/provider';

const REPO = path.resolve(__dirname, '../../..');
const JIRA_DIR = path.join(REPO, 'scripts', 'jev-jira');
// Built at runtime so no credential-shaped literal exists in the source.
const FAKE_JIRA_TOKEN = ['ATATT3x', 'Z'.repeat(40)].join('');
const FAKE_JEV_KEY = ['sk', 'Q'.repeat(30)].join('-');

/**
 * Independent anchor: option and field ids exactly as the OMNI provisioning
 * report recorded them (2026-10-01). Deliberately NOT derived from fields.ts,
 * so a wrong constant in the code cannot make these tests agree with it.
 */
const PROVISIONED_OPTIONS: Record<string, string> = {
  '10044': 'PASS', '10045': 'FAIL', '10046': 'INSUFFICIENT_EVIDENCE', '10047': 'CONFLICT', '10048': 'NOT_RUN',
  '10049': 'ACCEPTED', '10050': 'REJECTED', '10051': 'PENDING_REVIEW', '10052': 'NOT_APPLICABLE',
};
const OPTION_VALUES = PROVISIONED_OPTIONS;

const sel = (value: string, id = `opt-${value}`) => ({ value, id });

function acIssue(over: Record<string, unknown> = {}, key = 'OMNI-11'): JiraIssue {
  return {
    key,
    fields: {
      issuetype: { id: '10074' },
      project: { id: '10033' },
      status: { id: '10038', name: 'In Review' },
      parent: { key: 'OMNI-10' },
      updated: '2026-10-01T10:00:00.000+0000',
      [AC_FIELDS.acId]: 'AC-1',
      [AC_FIELDS.statement]: 'The health route unit tests pass',
      [AC_FIELDS.kind]: sel('Deterministic', '10024'),
      [AC_FIELDS.evidenceKind]: sel('Test', '10026'),
      [AC_FIELDS.deterministicResult]: sel('PASS', '10034'),
      [AC_FIELDS.evidenceReferences]: 'jest health suite, CI run 42 @ abc1234',
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

function storyIssue(over: Record<string, unknown> = {}): JiraIssue {
  return {
    key: 'OMNI-10',
    fields: {
      issuetype: { id: '10005' },
      project: { id: '10033' },
      updated: '2026-10-01T09:00:00.000+0000',
      [STORY_FIELDS.objective]: 'SECRET-OBJECTIVE-TEXT',
      [STORY_FIELDS.architecture]: 'SECRET-ARCHITECTURE-TEXT',
      [STORY_FIELDS.invariants]: '- No route skips auth\n- No schema change',
      [STORY_FIELDS.prohibitedPaths]: 'SECRET-PROHIBITED-TEXT',
      [STORY_FIELDS.verificationRequirements]: 'npm test -- health',
      [STORY_FIELDS.evidenceReferences]: 'story evidence',
      [STORY_FIELDS.gateResult]: sel('NOT_RUN', '10022'),
      [STORY_FIELDS.commit]: 'abc1234def',
      ...over,
    },
  };
}

class FakeJira implements JiraClient {
  readonly issues = new Map<string, JiraIssue>();
  readonly reads: Array<{ key: string; fields: readonly string[] }> = [];
  readonly updates: Array<{ key: string; fields: Record<string, unknown> }> = [];
  failUpdate: Error | null = null;
  dropOnWrite: string | null = null;
  onRead: ((n: number) => void) | null = null;

  constructor(...issues: JiraIssue[]) {
    for (const i of issues) this.issues.set(i.key, i);
  }

  async getIssue(key: string, fields: readonly string[]): Promise<JiraIssue> {
    this.reads.push({ key, fields });
    this.onRead?.(this.reads.length);
    const issue = this.issues.get(key);
    if (!issue) throw new JiraClientError('JIRA_NOT_FOUND', 'Jira returned HTTP 404');
    return JSON.parse(JSON.stringify(issue));
  }

  async updateAdvisoryFields(key: string, fields: Record<string, unknown>): Promise<void> {
    assertAdvisoryOnly(fields);
    this.updates.push({ key, fields: JSON.parse(JSON.stringify(fields)) });
    if (this.failUpdate) throw this.failUpdate;
    const issue = this.issues.get(key) as JiraIssue;
    for (const [k, v] of Object.entries(fields)) {
      if (k === this.dropOnWrite) continue;
      issue.fields[k] = v && typeof v === 'object' ? { id: (v as { id: string }).id, value: OPTION_VALUES[(v as { id: string }).id] } : v;
    }
  }
}

function reply(ac: string, inv: [string, string] = ['HOLDS', 'HOLDS'], model?: string): ProviderReply {
  return {
    answers: {
      ac: { choice: ac, confidence: 0.9 },
      inv_0: { choice: inv[0], confidence: 0.8 },
      inv_1: { choice: inv[1], confidence: 0.8 },
      bundle_consistency: { noul: 0.95 },
    },
    ...(model ? { model } : {}),
  };
}

function fakeTransport(...steps: Array<ProviderReply | Error>): JevTransport & { calls: number } {
  const t = {
    calls: 0,
    async send() {
      const step = steps[Math.min(t.calls, steps.length - 1)];
      t.calls += 1;
      if (step instanceof Error) throw step;
      return step;
    },
  };
  return t;
}

const INPUT: RunInput = { jiraIssueKey: 'OMNI-11', model: 'jev-latest', invokedBy: 'human:kuldeep', writeBack: true };

async function runWith(opts: { ac?: Record<string, unknown>; story?: Record<string, unknown>; transport?: JevTransport | null; input?: Partial<RunInput>; jira?: FakeJira } = {}) {
  const jira = opts.jira ?? new FakeJira(acIssue(opts.ac), storyIssue(opts.story));
  const bjcAudit = new MemoryAuditSink();
  const audit = new MemoryIntegrationAuditSink();
  const transport = opts.transport === undefined ? fakeTransport(reply('SUPPORTS')) : opts.transport;
  const result = await runAcJudgment({ ...INPUT, ...opts.input }, {
    jira,
    transport,
    bjcAudit,
    audit,
    now: () => new Date('2026-10-01T12:00:00Z'),
    newRecordId: () => 'int-rec-1',
  });
  return { result, jira, bjcAudit, audit, transport, after: jira.issues.get('OMNI-11') as JiraIssue };
}

const fieldVal = (issue: JiraIssue, k: string) => {
  const v = issue.fields[k];
  return v && typeof v === 'object' ? (v as { value?: string }).value : v;
};

describe('provisioned ids are pinned', () => {
  it('field ids, option ids and the write allowlist match the OMNI provisioning record', () => {
    expect(AC_FIELDS).toEqual({
      acId: 'customfield_10093', statement: 'customfield_10094', kind: 'customfield_10095', evidenceKind: 'customfield_10096',
      deterministicResult: 'customfield_10097', evidenceReferences: 'customfield_10084', verification: 'customfield_10098',
      jevVerdict: 'customfield_10099', jevConfidence: 'customfield_10100', jevModel: 'customfield_10101',
      jevInputHash: 'customfield_10102', jevAdvisoryDisposition: 'customfield_10103',
    });
    expect([...ADVISORY_WRITE_FIELDS].sort()).toEqual(['customfield_10099', 'customfield_10100', 'customfield_10101', 'customfield_10102']);
    expect([...PROTECTED_AC_FIELDS]).toEqual(expect.arrayContaining(['customfield_10095', 'customfield_10097', 'customfield_10098', 'customfield_10103']));
    for (const [v, id] of Object.entries(JEV_VERDICT_OPTIONS)) expect(PROVISIONED_OPTIONS[id]).toBe(v);
    expect(STORY_FIELDS.gateResult).toBe('customfield_10077');
  });
});

describe('1. Jira AC retrieval', () => {
  it('reads exactly the AC and its parent Story with explicit field lists — nothing else', async () => {
    const { jira } = await runWith({ input: { writeBack: false } });
    expect(jira.reads).toEqual([
      { key: 'OMNI-11', fields: AC_FETCH_FIELDS },
      { key: 'OMNI-10', fields: STORY_FETCH_FIELDS },
    ]);
  });

  it('the HTTP client uses only the gateway, a field-limited GET, refuses redirects and leaks no credential on error', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = jest.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(acIssue()), { status: 200 });
    });
    const client = createJiraClient({ credentials: { email: 'k@example.com', token: FAKE_JIRA_TOKEN }, fetchImpl: fetchImpl as unknown as typeof fetch });
    const issue = await client.getIssue('OMNI-11', AC_FETCH_FIELDS);
    expect(issue.key).toBe('OMNI-11');
    expect(calls[0].url.startsWith(`${JIRA_GATEWAY_BASE}/rest/api/2/issue/OMNI-11?fields=`)).toBe(true);
    expect(calls[0].init).toMatchObject({ method: 'GET', redirect: 'error' });

    const failing = createJiraClient({
      credentials: { email: 'k@example.com', token: FAKE_JIRA_TOKEN },
      fetchImpl: (async () => new Response(`echo ${FAKE_JIRA_TOKEN}`, { status: 404 })) as unknown as typeof fetch,
    });
    const err = await failing.getIssue('OMNI-11', AC_FETCH_FIELDS).catch((e) => e);
    expect(err).toBeInstanceOf(JiraClientError);
    expect(err.code).toBe('JIRA_NOT_FOUND');
    expect(JSON.stringify({ m: err.message, s: String(err) })).not.toContain(FAKE_JIRA_TOKEN);
  });

  it('rejects a non-OMNI issue key before any request', async () => {
    const fetchImpl = jest.fn();
    const client = createJiraClient({ credentials: { email: 'k@example.com', token: FAKE_JIRA_TOKEN }, fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(client.getIssue('KAN-1', AC_FETCH_FIELDS)).rejects.toMatchObject({ code: 'JIRA_MALFORMED' });
    const { result, jira } = await runWith({ input: { jiraIssueKey: 'KAN-1' } });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'REJECTED', error: { code: 'INVALID_ISSUE_KEY' } });
    expect(jira.reads).toHaveLength(0);
  });
});

describe('2. required-field extraction', () => {
  it('extracts every AC and Story field', () => {
    const ac = extractAcContext(acIssue());
    const story = extractStoryContext(storyIssue());
    expect(ac).toMatchObject({
      ok: true,
      value: { issueKey: 'OMNI-11', parentKey: 'OMNI-10', acId: 'AC-1', kind: 'Deterministic', evidenceKind: 'Test', deterministicResult: 'PASS', verification: 'UNVERIFIED', updated: '2026-10-01T10:00:00.000Z' },
    });
    expect(story).toMatchObject({ ok: true, value: { key: 'OMNI-10', gateResult: 'NOT_RUN', commit: 'abc1234def', verificationRequirements: 'npm test -- health' } });
  });

  it.each([
    [{ issuetype: { id: '10038' } }, 'NOT_AN_ACCEPTANCE_CRITERION'],
    [{ project: { id: '10000' } }, 'WRONG_PROJECT'],
    [{ parent: null }, 'NO_PARENT_STORY'],
    [{ [AC_FIELDS.statement]: '  ' }, 'MISSING_REQUIRED_FIELD'],
    [{ [AC_FIELDS.kind]: null }, 'MISSING_REQUIRED_FIELD'],
  ])('%o is rejected as %s, with no JEV call and no write', async (over, code) => {
    const { result, transport, jira } = await runWith({ ac: over });
    expect(result).toMatchObject({ status: 'REJECTED', ok: false, error: { code } });
    expect((transport as { calls: number }).calls).toBe(0);
    expect(jira.updates).toHaveLength(0);
  });

  it('rejects a parent that is not a Story', async () => {
    const { result } = await runWith({ story: { issuetype: { id: '10040' } } });
    expect(result).toMatchObject({ status: 'REJECTED', error: { code: 'PARENT_NOT_STORY' } });
  });
});

describe('3. BJC request construction', () => {
  const build = (acOver = {}, storyOver = {}) => {
    const ac = extractAcContext(acIssue(acOver));
    const story = extractStoryContext(storyIssue(storyOver));
    if (ac.ok === false || story.ok === false) throw new Error('fixture');
    return buildBjcRequest(ac.value, story.value, { model: 'jev-latest', invokedBy: 'human:kuldeep', requestId: 'req-1' });
  };

  it('builds a valid bjc/1 request with the AC, invariants, recorded result, digest and commit', () => {
    const r = build();
    if (r.ok === false) throw new Error(r.message);
    const req = r.value;
    expect(bjcRequestSchema.safeParse(req).success).toBe(true);
    expect(req.input_hash).toBe(computeInputHash(req));
    expect(req).toMatchObject({
      schema: 'bjc/1',
      work_item: 'OMNI-11',
      task_id: 'OMNI-10',
      acceptance_criterion: { id: 'AC-1', kind: 'OBJECTIVE', required_evidence: ['test_run'] },
      invariants: [
        { id: 'INV-1', statement: 'No route skips auth', source: 'jira:OMNI-10:Invariants' },
        { id: 'INV-2', statement: 'No schema change', source: 'jira:OMNI-10:Invariants' },
      ],
    });
    expect(req.evidence[0]).toMatchObject({ id: 'EV-1', kind: 'test_run', result: 'PASS', sha256: sha256Hex('jest health suite, CI run 42 @ abc1234') });
    expect(req.evidence[1]).toMatchObject({ id: 'EV-2', kind: 'commit', result: 'N/A', ref: 'commit:abc1234def' });
    expect(req.deterministic_summary).toContain('npm test -- health');
  });

  it('sends JEV no Story objective, architecture, prohibited paths or gate result', () => {
    const r = build();
    if (r.ok === false) throw new Error(r.message);
    const text = JSON.stringify(r.value);
    for (const s of ['SECRET-OBJECTIVE-TEXT', 'SECRET-ARCHITECTURE-TEXT', 'SECRET-PROHIBITED-TEXT', 'NOT_RUN']) expect(text).not.toContain(s);
  });

  it('maps Judgment to JUDGMENT with no required evidence', () => {
    const r = build({ [AC_FIELDS.kind]: sel('Judgment') });
    expect(r).toMatchObject({ ok: true, value: { acceptance_criterion: { kind: 'JUDGMENT', required_evidence: [] } } });
  });
});

describe('4. evidence bounding (reject, never truncate)', () => {
  it.each([
    [{ ac: { [AC_FIELDS.evidenceReferences]: 'r'.repeat(501) } }, 'OVERSIZE'],
    [{ ac: { [AC_FIELDS.statement]: 's'.repeat(1001) } }, 'OVERSIZE'],
    [{ story: { [STORY_FIELDS.invariants]: Array.from({ length: 21 }, (_, i) => `inv ${i}`).join('\n') } }, 'OVERSIZE'],
    [{ story: { [STORY_FIELDS.verificationRequirements]: 'v'.repeat(500) } }, 'OVERSIZE'],
    [{ ac: { [AC_FIELDS.evidenceKind]: sel('Lint') } }, 'UNSUPPORTED_EVIDENCE_KIND'],
    [{ ac: { [AC_FIELDS.evidenceKind]: null } }, 'UNSUPPORTED_EVIDENCE_KIND'],
    [{ ac: { [AC_FIELDS.acId]: 'criterion one' } }, 'INVALID_AC_ID'],
  ])('%o → %s, nothing sent to JEV, nothing written', async (opts, code) => {
    const { result, transport, jira } = await runWith(opts as never);
    expect(result).toMatchObject({ status: 'REJECTED', error: { code } });
    expect((transport as { calls: number }).calls).toBe(0);
    expect(jira.updates).toHaveLength(0);
  });

  it('a credential-shaped value in a Jira field is blocked by the BJC redaction gate: nothing sent, nothing written', async () => {
    const { result, transport, jira } = await runWith({ ac: { [AC_FIELDS.evidenceReferences]: `see token=${FAKE_JEV_KEY}` } });
    expect(result).toMatchObject({ status: 'JUDGMENT_UNAVAILABLE', error: { code: 'REDACTION_BLOCK' } });
    expect((transport as { calls: number }).calls).toBe(0);
    expect(jira.updates).toHaveLength(0);
  });
});

describe('5-9. combiner precedence through the orchestrator', () => {
  it('5. deterministic PASS + supportive JEV → PASS_CORROBORATED; Jira JEV Verdict PASS, disposition untouched', async () => {
    const { result, after } = await runWith();
    expect(result.bjc).toMatchObject({ verdict: 'PASS_CORROBORATED', deterministic_result: 'PASS', conflict: false });
    expect(fieldVal(after, AC_FIELDS.jevVerdict)).toBe('PASS');
    expect(fieldVal(after, AC_FIELDS.jevAdvisoryDisposition)).toBeNull();
    expect(fieldVal(after, AC_FIELDS.verification)).toBe('UNVERIFIED');
  });

  it('6. deterministic PASS + contradictory JEV → PASS_DISPUTED; Jira CONFLICT; not promoted', async () => {
    const { result, after } = await runWith({ transport: fakeTransport(reply('CONTRADICTS')) });
    expect(result.bjc).toMatchObject({ verdict: 'PASS_DISPUTED', conflict: true, review_required: true, verification_eligible: false });
    expect(fieldVal(after, AC_FIELDS.jevVerdict)).toBe('CONFLICT');
    expect(fieldVal(after, AC_FIELDS.verification)).toBe('UNVERIFIED');
  });

  it('7. deterministic FAIL + supportive JEV → FAIL stands; Jira CONFLICT, never PASS', async () => {
    const { result, after } = await runWith({ ac: { [AC_FIELDS.deterministicResult]: sel('FAIL') } });
    expect(result.bjc).toMatchObject({ verdict: 'FAIL', deterministic_result: 'FAIL', conflict: true, verification_eligible: false });
    expect(fieldVal(after, AC_FIELDS.jevVerdict)).toBe('CONFLICT');
  });

  it('7b. a recorded FAIL without evidence references still stands as FAIL', async () => {
    const { result } = await runWith({ ac: { [AC_FIELDS.deterministicResult]: sel('FAIL'), [AC_FIELDS.evidenceReferences]: null }, transport: fakeTransport(reply('CONTRADICTS')) });
    expect(result.bjc).toMatchObject({ verdict: 'FAIL', deterministic_result: 'FAIL' });
  });

  it.each([
    [{ [AC_FIELDS.deterministicResult]: sel('NOT_RUN') }],
    [{ [AC_FIELDS.deterministicResult]: sel('INSUFFICIENT_EVIDENCE') }],
    [{ [AC_FIELDS.deterministicResult]: null }],
    [{ [AC_FIELDS.evidenceReferences]: null }],
  ])('8. missing deterministic evidence %o + supportive JEV → INSUFFICIENT_EVIDENCE, never PASS', async (over) => {
    const { result, after } = await runWith({ ac: over });
    expect(result.bjc).toMatchObject({ verdict: 'INSUFFICIENT_EVIDENCE', deterministic_result: 'MISSING', verification_eligible: false });
    expect(fieldVal(after, AC_FIELDS.jevVerdict)).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('9. judgment AC → ADVISORY_ONLY; human disposition stays required (never set by JEV)', async () => {
    const { result, after } = await runWith({ ac: { [AC_FIELDS.kind]: sel('Judgment'), [AC_FIELDS.jevAdvisoryDisposition]: null } });
    expect(result.bjc).toMatchObject({ verdict: 'ADVISORY_ONLY', review_required: true, verification_eligible: false });
    expect(fieldVal(after, AC_FIELDS.jevAdvisoryDisposition)).toBeNull();
    expect(fieldVal(after, AC_FIELDS.verification)).toBe('UNVERIFIED');
  });

  it('a later judgment neither sets nor clears a prior human disposition', async () => {
    const { result, jira, after } = await runWith({ ac: { [AC_FIELDS.kind]: sel('Judgment'), [AC_FIELDS.jevAdvisoryDisposition]: sel('ACCEPTED', '10049') } });
    expect(result.writeback?.status).toBe('WRITTEN');
    expect(jira.updates[0].fields).not.toHaveProperty(AC_FIELDS.jevAdvisoryDisposition);
    expect(after.fields[AC_FIELDS.jevAdvisoryDisposition]).toEqual(sel('ACCEPTED', '10049'));
  });
});

describe('10-11. JEV unavailable / malformed', () => {
  it('10. timeout twice → JUDGMENT_UNAVAILABLE: no fabricated verdict, no Jira write, failure audited', async () => {
    const t = fakeTransport(new BjcTransportError('TIMEOUT', 'provider did not answer within 8000 ms', true));
    const { result, jira, audit, bjcAudit, after } = await runWith({ transport: t });
    expect(t.calls).toBe(2);
    expect(result).toMatchObject({ status: 'JUDGMENT_UNAVAILABLE', ok: false, error: { code: 'TIMEOUT' }, writeback: { status: 'SKIPPED' } });
    expect(result.bjc).toMatchObject({ verdict: null, deterministic_result: 'PASS', verification_eligible: false });
    expect(jira.updates).toHaveLength(0);
    expect(fieldVal(after, AC_FIELDS.jevVerdict)).toBeNull();
    expect(fieldVal(after, AC_FIELDS.deterministicResult)).toBe('PASS');
    expect(audit.records[0]).toMatchObject({ status: 'JUDGMENT_UNAVAILABLE', error: { code: 'TIMEOUT' }, jira_jev_verdict: null, combiner: null });
    expect(bjcAudit.records[0]).toMatchObject({ status: 'JUDGMENT_UNAVAILABLE', verdict: null });
  });

  it('10b. no API key → MISSING_API_KEY, nothing sent, nothing written', async () => {
    const { result, jira } = await runWith({ transport: null });
    expect(result).toMatchObject({ status: 'JUDGMENT_UNAVAILABLE', error: { code: 'MISSING_API_KEY' } });
    expect(jira.updates).toHaveLength(0);
  });

  it.each([
    [{ nope: true } as ProviderReply, 'MALFORMED_RESPONSE'],
    [{ answers: { ac: { choice: 'SUPPORTS', confidence: 0.9 } } } as ProviderReply, 'MISSING_ANSWERS'],
    [reply('PASS'), 'INVALID_ANSWER'],
  ])('11. malformed JEV reply %o → %s, nothing written', async (bad, code) => {
    const { result, jira } = await runWith({ transport: fakeTransport(bad) });
    expect(result).toMatchObject({ status: 'JUDGMENT_UNAVAILABLE', error: { code } });
    expect(result.bjc?.verdict).toBeNull();
    expect(jira.updates).toHaveLength(0);
  });
});

describe('12-13. Jira write-back', () => {
  it('12. writes exactly the four advisory fields and verifies them by read-back', async () => {
    const { result, jira, after } = await runWith({ transport: fakeTransport(reply('SUPPORTS', ['HOLDS', 'HOLDS'], 'jev-2026-09')) });
    expect(result).toMatchObject({ status: 'COMPLETED', ok: true, writeback: { status: 'WRITTEN' } });
    expect(jira.updates).toHaveLength(1);
    expect(jira.updates[0].key).toBe('OMNI-11');
    expect(Object.keys(jira.updates[0].fields).sort()).toEqual([...ADVISORY_WRITE_FIELDS].sort());
    expect(after.fields[AC_FIELDS.jevConfidence]).toBe(0.9);
    expect(after.fields[AC_FIELDS.jevModel]).toBe('jev-2026-09');
    expect(after.fields[AC_FIELDS.jevInputHash]).toBe(result.bjc?.input_hash);
    // GET (AC) → GET (Story) → GET (pre-write) → PUT → GET (post-write)
    expect(jira.reads.map((r) => r.key)).toEqual(['OMNI-11', 'OMNI-10', 'OMNI-11', 'OMNI-11']);
  });

  it('12b. an unresolved floating model is labelled as such, and the result says not reproducible', async () => {
    const { result, after } = await runWith();
    expect(after.fields[AC_FIELDS.jevModel]).toBe('jev-latest (unresolved)');
    expect(result.reproducibility).toEqual({ model_requested: 'jev-latest', model_resolved: 'unknown', pinned: false, reproducible: false, input_hash: result.bjc?.input_hash, schema: 'bjc-jira/1' });
  });

  it('12c. write-back is opt-in: without it Jira is only read', async () => {
    const { result, jira } = await runWith({ input: { writeBack: false } });
    expect(result).toMatchObject({ status: 'COMPLETED', ok: true, writeback: { status: 'SKIPPED' } });
    expect(jira.updates).toHaveLength(0);
  });

  it('13. a failing PUT is a visible WRITE_FAILED, ok=false, audited', async () => {
    const jira = new FakeJira(acIssue(), storyIssue());
    jira.failUpdate = new JiraClientError('JIRA_HTTP_ERROR', 'Jira returned HTTP 500');
    const { result, audit } = await runWith({ jira });
    expect(result).toMatchObject({ status: 'COMPLETED', ok: false, writeback: { status: 'WRITE_FAILED' } });
    expect(audit.records[0].writeback).toMatchObject({ requested: true, status: 'WRITE_FAILED' });
  });

  it('13b. a change between judgment and write aborts the write', async () => {
    const jira = new FakeJira(acIssue(), storyIssue());
    jira.onRead = (n) => {
      if (n === 3) (jira.issues.get('OMNI-11') as JiraIssue).fields[AC_FIELDS.deterministicResult] = sel('FAIL');
    };
    const { result } = await runWith({ jira });
    expect(result).toMatchObject({ ok: false, writeback: { status: 'ABORTED_CONCURRENT_CHANGE' } });
    expect(jira.updates).toHaveLength(0);
  });

  it('13c. a read-back mismatch is VERIFY_FAILED', async () => {
    const jira = new FakeJira(acIssue(), storyIssue());
    jira.dropOnWrite = AC_FIELDS.jevInputHash;
    const { result } = await runWith({ jira });
    expect(result).toMatchObject({ ok: false, writeback: { status: 'VERIFY_FAILED' } });
  });
});

describe('14-17. JEV has no authority over Verification, Gate Result, Integrated or Released', () => {
  const dets: DeterministicResult[] = ['PASS', 'FAIL', 'MISSING'];
  const jevs: JevAcAnswer[] = [...JEV_AC_ANSWERS];
  const matrix = AC_KINDS.flatMap((kind) => dets.flatMap((det) => jevs.flatMap((jev) => JEV_INVARIANT_ANSWERS.map((inv) => ({ kind, det, jev, inv })))));

  function completed(kind: (typeof AC_KINDS)[number], det: DeterministicResult, jev: JevAcAnswer, inv: string): BjcResponse {
    const c = combine({ kind, deterministic: det, jev, invariantAnswers: [inv as never] });
    return {
      status: 'COMPLETED',
      verdict: c.verdict,
      conflict: c.conflict,
      review_required: c.review_required,
      verification_eligible: c.verification_eligible,
      deterministic_result: det,
      jev: { answer: jev, confidence: 0.9, probabilities: null, low_confidence: false },
      model: { requested: 'jev-latest', resolved: 'unknown', pinned: false },
      input_hash: `sha256:${'a'.repeat(64)}`,
    } as BjcResponse;
  }

  it.each(matrix)('%o: the update touches only advisory fields, and Jira JEV Verdict is PASS only when earned', ({ kind, det, jev, inv }) => {
    const res = completed(kind, det, jev, inv);
    const update = buildAdvisoryUpdate(res) as Record<string, unknown>;
    expect(Object.keys(update).sort()).toEqual([...ADVISORY_WRITE_FIELDS].sort());
    for (const k of ['customfield_10103', 'customfield_10098', 'customfield_10097', 'customfield_10095']) expect(update).not.toHaveProperty(k);
    const v = mapJiraJevVerdict(res);
    if (kind === 'OBJECTIVE' && det !== 'PASS') expect(v).not.toBe('PASS');
    if (kind === 'OBJECTIVE' && det === 'FAIL') expect(['FAIL', 'CONFLICT']).toContain(v);
    if (kind === 'OBJECTIVE' && det === 'MISSING') expect(v).toBe('INSUFFICIENT_EVIDENCE');
    if (v === 'PASS') expect(jev).toBe('SUPPORTS');
  });

  it('no completed judgment ⇒ no update at all', () => {
    for (const status of ['JUDGMENT_UNAVAILABLE', 'REQUEST_REJECTED'] as const) {
      expect(buildAdvisoryUpdate({ status, verdict: null, input_hash: null } as BjcResponse)).toBeNull();
    }
  });

  it.each([
    ['14. Verification', AC_FIELDS.verification],
    ['15. Gate Result', STORY_FIELDS.gateResult],
    ['Deterministic Result', AC_FIELDS.deterministicResult],
    ['16/17. status (Integrated / Released)', 'status'],
    ['Deployment Authorized By', 'customfield_10079'],
    ['Deployment Authorized At', 'customfield_10080'],
  ])('%s cannot be written: the client refuses it before any request', async (_label, field) => {
    expect(() => assertAdvisoryOnly({ [field]: 'x' })).toThrow(JiraClientError);
    expect(() => assertAdvisoryOnly({ [AC_FIELDS.jevVerdict]: { id: '10044' }, [field]: 'x' })).toThrow(JiraClientError);
    const fetchImpl = jest.fn();
    const client = createJiraClient({ credentials: { email: 'k@example.com', token: FAKE_JIRA_TOKEN }, fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(client.updateAdvisoryFields('OMNI-11', { [field]: 'x' })).rejects.toMatchObject({ code: 'JIRA_FORBIDDEN_WRITE' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('16/17. the integration has no transition path: no transitions endpoint anywhere, status unchanged after write-back', async () => {
    for (const f of fs.readdirSync(JIRA_DIR).filter((x) => x.endsWith('.ts'))) {
      expect(fs.readFileSync(path.join(JIRA_DIR, f), 'utf8')).not.toMatch(/\/transitions|doTransition|transitionIssue/);
    }
    const { after, jira } = await runWith();
    expect(after.fields.status).toEqual({ id: '10038', name: 'In Review' });
    expect(jira.updates.every((u) => u.key === 'OMNI-11')).toBe(true);
  });

  it('15. the parent Story (Gate Result) is never written', async () => {
    const { jira } = await runWith();
    expect(jira.updates.map((u) => u.key)).toEqual(['OMNI-11']);
    expect(jira.issues.get('OMNI-10')?.fields[STORY_FIELDS.gateResult]).toEqual(sel('NOT_RUN', '10022'));
  });
});

describe('18. secrets never appear in output or audit', () => {
  it('Jira token, JEV key and evidence text are absent from the result and both audit records — success and failure paths', async () => {
    const outputs: string[] = [];
    for (const transport of [fakeTransport(reply('SUPPORTS')), fakeTransport(new BjcTransportError('PROVIDER_HTTP_ERROR', 'provider returned HTTP 503', true))]) {
      const r = await runWith({ transport });
      outputs.push(JSON.stringify(r.result), JSON.stringify(r.audit.records), JSON.stringify(r.bjcAudit.records));
      for (const rec of r.audit.records) {
        expect(JSON.stringify(rec)).not.toContain('jest health suite');
        expect(JSON.stringify(rec)).not.toContain('health route unit tests');
      }
    }
    const all = outputs.join('\n');
    expect(all).not.toContain(FAKE_JIRA_TOKEN);
    expect(all).not.toContain(FAKE_JEV_KEY);
  });

  it('the integration audit carries every reconstruction field', async () => {
    const { audit, result } = await runWith();
    expect(audit.records[0]).toMatchObject({
      schema: 'bjc-jira/1',
      jira_issue_key: 'OMNI-11',
      parent_story_key: 'OMNI-10',
      ac_id: 'AC-1',
      input_hash: result.bjc?.input_hash,
      jira_recorded_deterministic_result: 'PASS',
      deterministic_result: 'PASS',
      jev_answer: 'SUPPORTS',
      jev_confidence: 0.9,
      jira_jev_verdict: 'PASS',
      combiner: { verdict: 'PASS_CORROBORATED' },
      model: { requested: 'jev-latest', pinned: false },
      reproducible: false,
      status: 'COMPLETED',
      writeback: { status: 'WRITTEN' },
      timestamp: '2026-10-01T12:00:00.000Z',
    });
    expect(audit.records[0].evidence_digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('FileIntegrationAuditSink refuses a git work tree and appends JSONL outside one', async () => {
    expect(() => new FileIntegrationAuditSink(path.join(REPO, 'tmp-audit'))).toThrow(/outside any git work tree/);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bjc-jira-audit-'));
    try {
      const sink = new FileIntegrationAuditSink(dir);
      const { audit } = await runWith();
      await sink.append(audit.records[0]);
      const lines = fs.readFileSync(path.join(dir, 'bjc-jira-audit-2026-10-01.jsonl'), 'utf8').trim().split('\n');
      expect(JSON.parse(lines[0]).jira_issue_key).toBe('OMNI-11');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('explicit invocation only', () => {
  it('loading every orchestrator module performs no network call', () => {
    const spy = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network must not be touched'));
    try {
      jest.isolateModules(() => {
        for (const f of fs.readdirSync(JIRA_DIR).filter((x) => x.endsWith('.ts'))) require(path.join(JIRA_DIR, f));
      });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('no product code and no npm script imports or runs the orchestrator', () => {
    const pkg = fs.readFileSync(path.join(REPO, 'package.json'), 'utf8');
    expect(pkg).not.toContain('jev-jira');
    const hits = execGrep('jev-jira', ['backend', 'pages', 'lib', 'components', 'hooks']);
    expect(hits.filter((h) => !h.includes(`backend${path.sep}tests${path.sep}`) && !h.includes('backend/tests/'))).toEqual([]);
  });

  it('CLI: usage errors exit 64 and missing Jira credentials exit 64 without any request', async () => {
    const io = { out: jest.fn(), err: jest.fn() };
    expect(await runCli([], {}, io)).toBe(64);
    expect(await runCli(['judge-ac', '--issue', 'OMNI-11', '--invoked-by', 'human:k'], {}, io)).toBe(64);
    expect(await runCli(['judge-ac', '--issue', 'OMNI-11', '--model', 'jev-latest', '--invoked-by', 'human:k'], {}, io)).toBe(64);
    expect(io.out).not.toHaveBeenCalled();
  });
});

describe('four-field advisory write-back over HTTP (advisory-safe edit surface)', () => {
  // Independent anchors from the live OMNI inspection (2026-10-01), not derived from fields.ts.
  const FOUR = ['customfield_10099', 'customfield_10100', 'customfield_10101', 'customfield_10102'];
  const HUMAN_ONLY = { disposition: 'customfield_10103', verification: 'customfield_10098', deterministicResult: 'customfield_10097', kind: 'customfield_10095' };

  /** Real Jira client over a stub fetch that behaves like a Jira AC: GET serves state, PUT merges the body. */
  function httpJira(issue: JiraIssue) {
    const calls: Array<{ method: string; url: string; body: Record<string, unknown> | null }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
      calls.push({ method: String(init.method), url, body });
      if (init.method === 'PUT') {
        for (const [k, v] of Object.entries((body as { fields: Record<string, unknown> }).fields)) {
          issue.fields[k] = v && typeof v === 'object' ? { id: (v as { id: string }).id, value: OPTION_VALUES[(v as { id: string }).id] } : v;
        }
        return new Response(null, { status: 204 });
      }
      if (url.includes('/issue/OMNI-11?')) return new Response(JSON.stringify(issue), { status: 200 });
      if (url.includes('/issue/OMNI-10?')) return new Response(JSON.stringify(storyIssue()), { status: 200 });
      return new Response('', { status: 404 });
    }) as unknown as typeof fetch;
    return { calls, client: createJiraClient({ credentials: { email: 'k@example.com', token: FAKE_JIRA_TOKEN }, fetchImpl }) };
  }

  async function runHttp(acOver: Record<string, unknown>, transport: JevTransport | null) {
    const issue = acIssue(acOver);
    const { calls, client } = httpJira(issue);
    const result = await runAcJudgment(INPUT, {
      jira: client,
      transport,
      bjcAudit: new MemoryAuditSink(),
      audit: new MemoryIntegrationAuditSink(),
      now: () => new Date('2026-10-01T12:00:00Z'),
      newRecordId: () => 'int-rec-1',
    });
    return { result, calls, issue };
  }

  it.each([
    ['deterministic PASS + SUPPORTS', {}, 'SUPPORTS'],
    ['deterministic PASS + CONTRADICTS', {}, 'CONTRADICTS'],
    ['deterministic FAIL + SUPPORTS', { [AC_FIELDS.deterministicResult]: sel('FAIL') }, 'SUPPORTS'],
    ['judgment + prior human ACCEPTED', { [AC_FIELDS.kind]: sel('Judgment'), [AC_FIELDS.jevAdvisoryDisposition]: sel('ACCEPTED', '10049') }, 'SUPPORTS'],
  ])('%s: exactly one PUT, carrying exactly the four JEV fields and no human-only field', async (_label, over, answer) => {
    const { result, calls, issue } = await runHttp(over, fakeTransport(reply(answer)));
    expect(result.writeback?.status).toBe('WRITTEN');
    const puts = calls.filter((c) => c.method === 'PUT');
    expect(puts).toHaveLength(1);
    expect(puts[0].url).toBe(`${JIRA_GATEWAY_BASE}/rest/api/2/issue/OMNI-11`);
    expect(Object.keys(puts[0].body as object)).toEqual(['fields']);
    const sent = (puts[0].body as { fields: Record<string, unknown> }).fields;
    expect(Object.keys(sent).sort()).toEqual(FOUR);
    for (const k of Object.values(HUMAN_ONLY)) expect(sent).not.toHaveProperty(k);
    expect(issue.fields[HUMAN_ONLY.disposition]).toEqual(acIssue(over).fields[HUMAN_ONLY.disposition]);
    expect(calls.map((c) => c.method)).toEqual(['GET', 'GET', 'GET', 'PUT', 'GET']);
  });

  it('no transition (or any non-issue) endpoint is ever called', async () => {
    const { calls } = await runHttp({}, fakeTransport(reply('SUPPORTS')));
    for (const c of calls) {
      expect(c.url).not.toMatch(/transitions/);
      expect(c.url.startsWith(`${JIRA_GATEWAY_BASE}/rest/api/2/issue/OMNI-1`)).toBe(true);
      expect(['GET', 'PUT']).toContain(c.method);
    }
  });

  it.each([
    ['timeout', () => fakeTransport(new BjcTransportError('TIMEOUT', 'provider did not answer within 8000 ms', true))],
    ['malformed', () => fakeTransport({ nope: true } as ProviderReply)],
    ['no key', () => null],
  ])('JEV failure (%s) → no PUT at all', async (_label, makeTransport) => {
    const { result, calls } = await runHttp({}, makeTransport());
    expect(result.status).toBe('JUDGMENT_UNAVAILABLE');
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });

  it('the client refuses every human-only field before any request', async () => {
    const { calls, client } = httpJira(acIssue());
    for (const k of Object.values(HUMAN_ONLY)) {
      await expect(client.updateAdvisoryFields('OMNI-11', { [k]: { id: '10049' } })).rejects.toMatchObject({ code: 'JIRA_FORBIDDEN_WRITE' });
    }
    expect(calls).toEqual([]);
  });
});

// Live-shaped /mypermissions bodies for the identity preflight.
const READER_PERMS: Record<string, boolean> = {
  BROWSE_PROJECTS: true, EDIT_ISSUES: false, TRANSITION_ISSUES: false, CREATE_ISSUES: false, DELETE_ISSUES: false, ADMINISTER_PROJECTS: false, ADMINISTER: false,
};
const ADVISORY_PERMS: Record<string, boolean> = { ...READER_PERMS, EDIT_ISSUES: true };
// Shape of the live provisioning identity: human Engineer + Release Approver with global ADMINISTER.
const PROVISIONING_PERMS: Record<string, boolean> = { ...ADVISORY_PERMS, TRANSITION_ISSUES: true, CREATE_ISSUES: true, ADMINISTER: true };
function permsResponse(p: Record<string, boolean>): Response {
  return new Response(JSON.stringify({ permissions: Object.fromEntries(Object.entries(p).map(([k, v]) => [k, { key: k, havePermission: v }])) }), { status: 200 });
}

describe('explicit runtime Jira identity + permission preflight (fail closed)', () => {
  const READER_TOKEN = ['ATSTT3x', 'R'.repeat(40)].join('');
  const ADVISORY_TOKEN = ['ATSTT3x', 'A'.repeat(40)].join('');

  /** Real CLI over a stub fetch; `perms` is what /mypermissions reports for whichever token is presented. */
  async function cli(args: string[], env: Record<string, string>, perms: Record<string, boolean> | 'malformed') {
    const seen: Array<{ method: string; path: string; authorization: string; fieldKeys?: string[] }> = [];
    const issue = acIssue();
    const spy = jest.spyOn(globalThis, 'fetch').mockImplementation((async (url: string, init: RequestInit) => {
      const isProvider = url === TYPESAFE_SYSTEMONE_URL;
      const authorization = isProvider ? '(jev)' : (init.headers as Record<string, string>).Authorization;
      const body = init.body && !isProvider ? (JSON.parse(String(init.body)) as { fields?: Record<string, unknown> }) : null;
      seen.push({ method: String(init.method), path: isProvider ? 'provider' : url.slice(JIRA_GATEWAY_BASE.length).split('?')[0], authorization, ...(body?.fields ? { fieldKeys: Object.keys(body.fields).sort() } : {}) });
      if (isProvider) return new Response(JSON.stringify(reply('SUPPORTS', ['HOLDS', 'HOLDS'], 'jev-1.13.0')), { status: 200 });
      if (url.includes('/rest/api/3/mypermissions')) return perms === 'malformed' ? new Response('{}', { status: 200 }) : permsResponse(perms);
      if (init.method === 'PUT') {
        for (const [k, v] of Object.entries(body?.fields ?? {})) issue.fields[k] = v && typeof v === 'object' ? { id: (v as { id: string }).id, value: OPTION_VALUES[(v as { id: string }).id] } : v;
        return new Response(null, { status: 204 });
      }
      if (url.includes('/issue/OMNI-11?')) return new Response(JSON.stringify(issue), { status: 200 });
      if (url.includes('/issue/OMNI-10?')) return new Response(JSON.stringify(storyIssue()), { status: 200 });
      return new Response('', { status: 404 });
    }) as unknown as typeof fetch);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bjc-ident-'));
    const io = { out: jest.fn(), err: jest.fn() };
    try {
      const code = await runCli(['judge-ac', '--issue', 'OMNI-11', '--invoked-by', 'claude-code:t', '--audit-dir', dir, ...args], { TYPESAFE_API_KEY: FAKE_JEV_KEY, ...env }, io);
      const files = fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
      return { code, seen, io, files };
    } finally {
      spy.mockRestore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  const READER_ENV = { JEV_JIRA_IDENTITY: 'reader', JEV_READER_TOKEN: READER_TOKEN };
  const ADVISORY_ENV = { JEV_JIRA_IDENTITY: 'advisory', JEV_ADVISORY_TOKEN: ADVISORY_TOKEN };
  // A provisioning credential lying around in the environment must never be used.
  const DECOYS = { JIRA_EMAIL: 'admin@example.com', JIRA_PROVISION_TOKEN: FAKE_JIRA_TOKEN, JIRA_AUTH_MODE: 'basic' };

  it('reader identity: preflight, then GET AC → GET Story → JEV; only the reader token is ever sent', async () => {
    const { code, seen, files, io } = await cli([], { ...READER_ENV, ...DECOYS, JEV_ADVISORY_TOKEN: ADVISORY_TOKEN }, READER_PERMS);
    expect(code).toBe(0);
    expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual(['GET /rest/api/3/mypermissions', 'GET /rest/api/2/issue/OMNI-11', 'GET /rest/api/2/issue/OMNI-10', 'POST provider']);
    expect(seen.filter((s) => s.path !== 'provider').every((s) => s.authorization === `Bearer ${READER_TOKEN}`)).toBe(true);
    for (const text of [files, JSON.stringify(io.out.mock.calls), JSON.stringify(io.err.mock.calls), JSON.stringify(seen)]) {
      expect(text).not.toContain(FAKE_JIRA_TOKEN);
      expect(text).not.toContain(ADVISORY_TOKEN);
    }
  });

  it('advisory identity + --write-back: preflight, then the unchanged GET→GET→JEV→GET→PUT(4)→GET sequence, advisory token only', async () => {
    const { code, seen } = await cli(['--write-back'], { ...ADVISORY_ENV, ...DECOYS, JEV_READER_TOKEN: READER_TOKEN }, ADVISORY_PERMS);
    expect(code).toBe(0);
    expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual([
      'GET /rest/api/3/mypermissions', 'GET /rest/api/2/issue/OMNI-11', 'GET /rest/api/2/issue/OMNI-10', 'POST provider',
      'GET /rest/api/2/issue/OMNI-11', 'PUT /rest/api/2/issue/OMNI-11', 'GET /rest/api/2/issue/OMNI-11',
    ]);
    expect(seen.find((s) => s.method === 'PUT')?.fieldKeys).toEqual(['customfield_10099', 'customfield_10100', 'customfield_10101', 'customfield_10102']);
    expect(seen.filter((s) => s.path !== 'provider').every((s) => s.authorization === `Bearer ${ADVISORY_TOKEN}`)).toBe(true);
    expect(seen.some((s) => /transitions/.test(s.path))).toBe(false);
  });

  it.each([
    ['no identity at all (provisioning env only)', [], { ...DECOYS }, 'JEV_JIRA_IDENTITY must be "reader" or "advisory"'],
    ['identity=provisioning', [], { JEV_JIRA_IDENTITY: 'provisioning', ...DECOYS }, 'JEV_JIRA_IDENTITY must be "reader" or "advisory"'],
    ['identity=Advisory (case)', ['--write-back'], { JEV_JIRA_IDENTITY: 'Advisory', JEV_ADVISORY_TOKEN: ADVISORY_TOKEN }, 'JEV_JIRA_IDENTITY must be "reader" or "advisory"'],
    ['--write-back with the reader identity', ['--write-back'], { ...READER_ENV, JEV_ADVISORY_TOKEN: ADVISORY_TOKEN }, '--write-back requires JEV_JIRA_IDENTITY=advisory'],
    ['read-only run with the advisory identity', [], { ...ADVISORY_ENV }, 'a read-only run requires JEV_JIRA_IDENTITY=reader'],
    ['advisory identity without its own token (other tokens present)', ['--write-back'], { JEV_JIRA_IDENTITY: 'advisory', JEV_READER_TOKEN: READER_TOKEN, ...DECOYS }, 'JEV_ADVISORY_TOKEN must be set for JEV_JIRA_IDENTITY=advisory'],
    ['reader identity without its own token', [], { JEV_JIRA_IDENTITY: 'reader', JEV_ADVISORY_TOKEN: ADVISORY_TOKEN, ...DECOYS }, 'JEV_READER_TOKEN must be set for JEV_JIRA_IDENTITY=reader'],
  ])('%s → exit 64 before any request', async (_label, args, env, message) => {
    const { code, seen, io } = await cli(args as string[], env as Record<string, string>, ADVISORY_PERMS);
    expect(code).toBe(64);
    expect(seen).toEqual([]);
    expect(io.err.mock.calls).toEqual([[message]]);
    expect(io.out).not.toHaveBeenCalled();
  });

  it.each([
    ['provisioning/admin token in the advisory slot', ['--write-back'], ADVISORY_ENV, PROVISIONING_PERMS, ['TRANSITION_ISSUES must NOT be granted', 'CREATE_ISSUES must NOT be granted', 'ADMINISTER must NOT be granted']],
    ['reader token in the advisory slot', ['--write-back'], ADVISORY_ENV, READER_PERMS, ['EDIT_ISSUES must be granted']],
    ['advisory token in the reader slot', [], READER_ENV, ADVISORY_PERMS, ['EDIT_ISSUES must NOT be granted']],
    ['provisioning/admin token in the reader slot', [], READER_ENV, PROVISIONING_PERMS, ['EDIT_ISSUES must NOT be granted', 'TRANSITION_ISSUES must NOT be granted']],
    ['token without Browse', [], READER_ENV, { ...READER_PERMS, BROWSE_PROJECTS: false }, ['BROWSE_PROJECTS must be granted']],
  ])('%s → exit 6 after only the permission probe: no issue read, no JEV, no write', async (_label, args, env, perms, expected) => {
    const { code, seen, io, files } = await cli(args as string[], env, perms);
    expect(code).toBe(6);
    expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual(['GET /rest/api/3/mypermissions']);
    const err = String(io.err.mock.calls[0][0]);
    for (const v of expected as string[]) expect(err).toContain(v);
    expect(io.out).not.toHaveBeenCalled();
    expect(files).toBe('');
  });

  it('a permissions response missing the requested keys fails closed (exit 6, nothing else requested)', async () => {
    const { code, seen } = await cli(['--write-back'], ADVISORY_ENV, 'malformed');
    expect(code).toBe(6);
    expect(seen.map((s) => s.path)).toEqual(['/rest/api/3/mypermissions']);
  });

  it('identity resolution and policy are pinned to the provisioned intent', () => {
    expect(IDENTITY_TOKEN_ENV).toEqual({ reader: 'JEV_READER_TOKEN', advisory: 'JEV_ADVISORY_TOKEN' });
    expect(resolveRuntimeIdentity({ ...READER_ENV, ...DECOYS }, false)).toEqual({ ok: true, identity: 'reader', credentials: { mode: 'bearer', email: '', token: READER_TOKEN } });
    expect(resolveRuntimeIdentity({ ...ADVISORY_ENV, ...DECOYS }, true)).toEqual({ ok: true, identity: 'advisory', credentials: { mode: 'bearer', email: '', token: ADVISORY_TOKEN } });
    expect(identityViolations('reader', READER_PERMS)).toEqual([]);
    expect(identityViolations('advisory', ADVISORY_PERMS)).toEqual([]);
    expect(identityViolations('advisory', {})).toHaveLength(7);
    expect(preflightPermissionKeys('advisory').sort()).toEqual(['ADMINISTER', 'ADMINISTER_PROJECTS', 'BROWSE_PROJECTS', 'CREATE_ISSUES', 'DELETE_ISSUES', 'EDIT_ISSUES', 'TRANSITION_ISSUES']);
  });
});

describe('Jira auth mode (basic default, explicit bearer, fail closed)', () => {
  const EMAIL = 'svc@example.com';
  const BASIC = `Basic ${Buffer.from(`${EMAIL}:${FAKE_JIRA_TOKEN}`).toString('base64')}`;
  const BEARER = `Bearer ${FAKE_JIRA_TOKEN}`;

  function recordingFetch(issue: JiraIssue = acIssue()) {
    const calls: Array<{ method: string; url: string; authorization: string; body: Record<string, unknown> | null }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
      calls.push({ method: String(init.method), url, authorization: headers.Authorization, body });
      if (init.method === 'PUT') {
        for (const [k, v] of Object.entries((body as { fields: Record<string, unknown> }).fields)) {
          issue.fields[k] = v && typeof v === 'object' ? { id: (v as { id: string }).id, value: OPTION_VALUES[(v as { id: string }).id] } : v;
        }
        return new Response(null, { status: 204 });
      }
      if (url.includes('/issue/OMNI-11?')) return new Response(JSON.stringify(issue), { status: 200 });
      if (url.includes('/issue/OMNI-10?')) return new Response(JSON.stringify(storyIssue()), { status: 200 });
      return new Response('', { status: 404 });
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  }

  it('1. basic mode (and an unset mode) sends exactly Basic base64(email:token)', async () => {
    for (const credentials of [{ email: EMAIL, token: FAKE_JIRA_TOKEN }, { mode: 'basic' as const, email: EMAIL, token: FAKE_JIRA_TOKEN }]) {
      const { calls, fetchImpl } = recordingFetch();
      await createJiraClient({ credentials, fetchImpl }).getIssue('OMNI-11', ['status']);
      expect(calls.map((c) => c.authorization)).toEqual([BASIC]);
    }
    expect(authorizationHeader({ email: EMAIL, token: FAKE_JIRA_TOKEN })).toBe(BASIC);
  });

  it('2-3. bearer mode sends exactly Bearer <token> and never builds email:token', async () => {
    const basicPair = Buffer.from(`${EMAIL}:${FAKE_JIRA_TOKEN}`).toString('base64');
    const spy = jest.spyOn(Buffer, 'from');
    try {
      const { calls, fetchImpl } = recordingFetch();
      const client = createJiraClient({ credentials: { mode: 'bearer', email: EMAIL, token: FAKE_JIRA_TOKEN }, fetchImpl });
      await client.getIssue('OMNI-11', ['status']);
      await client.updateAdvisoryFields('OMNI-11', { [AC_FIELDS.jevModel]: 'jev-1.13.0' });
      expect(calls.map((c) => c.authorization)).toEqual([BEARER, BEARER]);
      for (const c of calls) {
        expect(c.authorization.startsWith('Basic')).toBe(false);
        expect(c.authorization).not.toContain(EMAIL);
        expect(c.authorization).not.toContain(basicPair);
      }
      expect(spy.mock.calls.some((args) => typeof args[0] === 'string' && args[0].includes(`:${FAKE_JIRA_TOKEN}`))).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it('4. an unsupported mode fails closed before any network request (resolver, client and CLI)', async () => {
    for (const bad of ['Bearer', 'BASIC', 'oauth', 'bearerx', 'none']) {
      expect(resolveJiraAuthMode({ JIRA_AUTH_MODE: bad })).toBeNull();
      expect(resolveJiraCredentials({ JIRA_AUTH_MODE: bad, JIRA_EMAIL: EMAIL, JIRA_PROVISION_TOKEN: FAKE_JIRA_TOKEN })).toBeNull();
    }
    expect(resolveJiraAuthMode({})).toBe('basic');
    expect(resolveJiraAuthMode({ JIRA_AUTH_MODE: 'bearer' })).toBe('bearer');

    const { calls, fetchImpl } = recordingFetch();
    expect(() => createJiraClient({ credentials: { mode: 'oauth' as never, email: EMAIL, token: FAKE_JIRA_TOKEN }, fetchImpl })).toThrow(
      expect.objectContaining({ code: 'JIRA_AUTH_MODE' }),
    );
    expect(calls).toEqual([]);

    const spy = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network must not be touched'));
    try {
      const io = { out: jest.fn(), err: jest.fn() };
      const env = { JIRA_AUTH_MODE: 'oauth', JIRA_EMAIL: EMAIL, JIRA_PROVISION_TOKEN: FAKE_JIRA_TOKEN, TYPESAFE_API_KEY: FAKE_JEV_KEY };
      expect(await runCli(['judge-ac', '--issue', 'OMNI-11', '--invoked-by', 'human:k'], env, io)).toBe(64);
      expect(spy).not.toHaveBeenCalled();
      expect(io.out).not.toHaveBeenCalled();
      expect(io.err.mock.calls).toEqual([['JEV_JIRA_IDENTITY must be "reader" or "advisory"']]);
      expect(JSON.stringify(io.err.mock.calls)).not.toContain(FAKE_JIRA_TOKEN);
    } finally {
      spy.mockRestore();
    }
  });

  it('credential resolution: basic needs email + token; bearer needs only the token', () => {
    expect(resolveJiraCredentials({ JIRA_PROVISION_TOKEN: FAKE_JIRA_TOKEN })).toBeNull();
    expect(resolveJiraCredentials({ JIRA_EMAIL: EMAIL, JIRA_PROVISION_TOKEN: FAKE_JIRA_TOKEN })).toEqual({ mode: 'basic', email: EMAIL, token: FAKE_JIRA_TOKEN });
    expect(resolveJiraCredentials({ JIRA_AUTH_MODE: 'bearer', JIRA_PROVISION_TOKEN: FAKE_JIRA_TOKEN })).toEqual({ mode: 'bearer', email: '', token: FAKE_JIRA_TOKEN });
    expect(resolveJiraCredentials({ JIRA_AUTH_MODE: 'bearer', JIRA_EMAIL: EMAIL })).toBeNull();
  });

  it('6-8. bearer write-back keeps the GET→GET→GET→PUT→GET order, four fields, no transition endpoint, Bearer on every request', async () => {
    const { calls, fetchImpl } = recordingFetch();
    const audit = new MemoryIntegrationAuditSink();
    const bjcAudit = new MemoryAuditSink();
    const result = await runAcJudgment(INPUT, {
      jira: createJiraClient({ credentials: { mode: 'bearer', email: EMAIL, token: FAKE_JIRA_TOKEN }, fetchImpl }),
      transport: fakeTransport(reply('SUPPORTS')),
      bjcAudit,
      audit,
      now: () => new Date('2026-10-01T12:00:00Z'),
      newRecordId: () => 'int-rec-1',
    });
    expect(result.writeback?.status).toBe('WRITTEN');
    expect(calls.map((c) => c.method)).toEqual(['GET', 'GET', 'GET', 'PUT', 'GET']);
    expect(calls.every((c) => c.authorization === BEARER)).toBe(true);
    expect(calls.some((c) => /transitions/.test(c.url))).toBe(false);
    const put = calls.find((c) => c.method === 'PUT');
    expect(Object.keys((put?.body as { fields: Record<string, unknown> }).fields).sort()).toEqual(['customfield_10099', 'customfield_10100', 'customfield_10101', 'customfield_10102']);
    // 9. no credential in the result or either audit record
    const persisted = JSON.stringify([result, audit.records, bjcAudit.records]);
    expect(persisted).not.toContain(FAKE_JIRA_TOKEN);
    expect(persisted).not.toContain(EMAIL);
    expect(persisted).not.toMatch(/Bearer |Basic /);
  });

  it('9. a bearer CLI read-only run sends Bearer to Jira, never writes, and leaks no token to output or audit files', async () => {
    const seen: Array<{ method: string; target: string; authorization: string }> = [];
    const spy = jest.spyOn(globalThis, 'fetch').mockImplementation((async (url: string, init: RequestInit) => {
      const authorization = (init.headers as Record<string, string>).Authorization;
      const isProvider = url === TYPESAFE_SYSTEMONE_URL;
      seen.push({ method: String(init.method), target: isProvider ? 'provider' : 'jira', authorization: isProvider ? '(jev)' : authorization });
      if (isProvider) return new Response(JSON.stringify(reply('SUPPORTS', ['HOLDS', 'HOLDS'], 'jev-1.13.0')), { status: 200 });
      if (url.includes('/rest/api/3/mypermissions')) return permsResponse(READER_PERMS);
      if (url.includes('/issue/OMNI-11?')) return new Response(JSON.stringify(acIssue()), { status: 200 });
      if (url.includes('/issue/OMNI-10?')) return new Response(JSON.stringify(storyIssue()), { status: 200 });
      return new Response('', { status: 404 });
    }) as unknown as typeof fetch);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bjc-bearer-'));
    const io = { out: jest.fn(), err: jest.fn() };
    try {
      const env = { JEV_JIRA_IDENTITY: 'reader', JEV_READER_TOKEN: FAKE_JIRA_TOKEN, TYPESAFE_API_KEY: FAKE_JEV_KEY };
      const code = await runCli(['judge-ac', '--issue', 'OMNI-11', '--invoked-by', 'claude-code:t', '--audit-dir', dir], env, io);
      expect(code).toBe(0);
      expect(seen).toEqual([
        { method: 'GET', target: 'jira', authorization: BEARER },
        { method: 'GET', target: 'jira', authorization: BEARER },
        { method: 'GET', target: 'jira', authorization: BEARER },
        { method: 'POST', target: 'provider', authorization: '(jev)' },
      ]);
      const files = fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
      for (const text of [files, JSON.stringify(io.out.mock.calls), JSON.stringify(io.err.mock.calls)]) {
        expect(text).not.toContain(FAKE_JIRA_TOKEN);
        expect(text).not.toContain(FAKE_JEV_KEY);
        expect(text).not.toMatch(/Bearer |Basic /);
      }
    } finally {
      spy.mockRestore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('pinned default JEV model', () => {
  // Independent anchor: the id the provider resolved `jev-latest` to in the first live
  // read-only smoke run (2026-10-01). Deliberately a literal, not DEFAULT_JEV_MODEL.
  const PINNED = 'jev-1.13.0';

  it('the default is the literal pinned id, never a floating alias', () => {
    expect(DEFAULT_JEV_MODEL).toBe(PINNED);
    expect(DEFAULT_JEV_MODEL).not.toBe('jev-latest');
    expect(isFloatingModel(DEFAULT_JEV_MODEL)).toBe(false);
    expect(resolveModel(['judge-ac', '--issue', 'OMNI-11', '--invoked-by', 'human:k'])).toBe(PINNED);
  });

  it('an explicit --model is passed through verbatim and deterministically, never translated', () => {
    for (const m of ['jev-latest', 'jev-1.12.0', PINNED]) {
      const argv = ['judge-ac', '--issue', 'OMNI-11', '--model', m, '--invoked-by', 'human:k'];
      expect(resolveModel(argv)).toBe(m);
      expect(resolveModel(argv)).toBe(resolveModel([...argv]));
    }
  });

  it('--model without a value is a usage error, not a silent fallback to the default', async () => {
    expect(resolveModel(['judge-ac', '--issue', 'OMNI-11', '--invoked-by', 'human:k', '--model'])).toBeNull();
    expect(resolveModel(['judge-ac', '--model', '--issue', 'OMNI-11', '--invoked-by', 'human:k'])).toBeNull();
    const spy = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network must not be touched'));
    try {
      const io = { out: jest.fn(), err: jest.fn() };
      const env = { JIRA_EMAIL: 'k@example.com', JIRA_PROVISION_TOKEN: FAKE_JIRA_TOKEN, TYPESAFE_API_KEY: FAKE_JEV_KEY };
      expect(await runCli(['judge-ac', '--issue', 'OMNI-11', '--invoked-by', 'human:k', '--model'], env, io)).toBe(64);
      expect(spy).not.toHaveBeenCalled();
      expect(io.out).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  /** Runs the real CLI with fetch stubbed: Jira serves the fixtures, the provider echoes `providerModel`. */
  async function cliRun(extraArgs: string[], providerModel: (requested: string) => string) {
    const sentModels: string[] = [];
    const methods: string[] = [];
    const spy = jest.spyOn(globalThis, 'fetch').mockImplementation((async (url: string, init: RequestInit) => {
      methods.push(`${init.method} ${url === TYPESAFE_SYSTEMONE_URL ? 'provider' : 'jira'}`);
      if (url === TYPESAFE_SYSTEMONE_URL) {
        const requested = JSON.parse(String(init.body)).model as string;
        sentModels.push(requested);
        return new Response(JSON.stringify(reply('SUPPORTS', ['HOLDS', 'HOLDS'], providerModel(requested))), { status: 200 });
      }
      if (!url.startsWith(JIRA_GATEWAY_BASE) || init.method !== 'GET') return new Response('', { status: 500 });
      if (url.includes('/rest/api/3/mypermissions')) return permsResponse(READER_PERMS);
      if (url.includes('/issue/OMNI-11?')) return new Response(JSON.stringify(acIssue()), { status: 200 });
      if (url.includes('/issue/OMNI-10?')) return new Response(JSON.stringify(storyIssue()), { status: 200 });
      return new Response('', { status: 404 });
    }) as unknown as typeof fetch);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bjc-pin-'));
    const io = { out: jest.fn(), err: jest.fn() };
    try {
      const env = { JEV_JIRA_IDENTITY: 'reader', JEV_READER_TOKEN: FAKE_JIRA_TOKEN, TYPESAFE_API_KEY: FAKE_JEV_KEY };
      const code = await runCli(['judge-ac', '--issue', 'OMNI-11', '--invoked-by', 'human:k', '--audit-dir', dir, ...extraArgs], env, io);
      const audits = fs.readdirSync(dir).flatMap((f) =>
        fs.readFileSync(path.join(dir, f), 'utf8').trim().split('\n').map((l) => ({ file: f, rec: JSON.parse(l) })),
      );
      return { code, sentModels, methods, result: JSON.parse(io.out.mock.calls[0][0]), audits };
    } finally {
      spy.mockRestore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  it('a default invocation requests jev-1.13.0 and records it pinned and reproducible when the provider confirms it', async () => {
    const { code, sentModels, methods, result, audits } = await cliRun([], (m) => m);
    expect(code).toBe(0);
    expect(sentModels).toEqual([PINNED]);
    expect(methods.filter((m) => !m.startsWith('GET jira') && m !== 'POST provider')).toEqual([]);
    expect(result.reproducibility).toEqual({ model_requested: PINNED, model_resolved: PINNED, pinned: true, reproducible: true, input_hash: result.bjc.input_hash, schema: 'bjc-jira/1' });
    expect(result.bjc.model).toEqual({ requested: PINNED, resolved: PINNED, pinned: true });
    expect(result.bjc.reproducible).toBe(true);
    expect(audits.map((a) => a.file).sort()).toEqual([expect.stringMatching(/^bjc-audit-/), expect.stringMatching(/^bjc-jira-audit-/)]);
    for (const { rec } of audits) {
      expect(rec.model).toEqual({ requested: PINNED, resolved: PINNED, pinned: true });
      expect(rec.reproducible).toBe(true);
    }
  });

  it('a default invocation whose model the provider does not confirm is not reproducible', async () => {
    const { result, audits } = await cliRun([], () => undefined as unknown as string);
    expect(result.reproducibility).toMatchObject({ model_requested: PINNED, model_resolved: 'unknown', pinned: true, reproducible: false });
    for (const { rec } of audits) expect(rec.reproducible).toBe(false);
  });

  it('an explicit jev-latest is sent as jev-latest (not pinned for the caller) and stays non-reproducible', async () => {
    const { sentModels, result } = await cliRun(['--model', 'jev-latest'], () => PINNED);
    expect(sentModels).toEqual(['jev-latest']);
    expect(result.reproducibility).toMatchObject({ model_requested: 'jev-latest', model_resolved: PINNED, pinned: false, reproducible: false });
  });
});

function execGrep(needle: string, dirs: string[]): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx|js)$/.test(e.name) && fs.readFileSync(p, 'utf8').includes(needle)) out.push(p);
    }
  };
  for (const d of dirs) walk(path.join(REPO, d));
  return out;
}
