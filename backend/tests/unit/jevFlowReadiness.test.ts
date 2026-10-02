/**
 * gov readiness gate + read-only Jira query.
 * No network: Jira is an injected fake; HTTP-level tests use a fetch stub.
 */
import fs from 'node:fs';
import path from 'node:path';
import { AC_FIELDS, JIRA_GATEWAY_BASE, STORY_FIELDS } from '../../../scripts/jev-jira/fields';
import { JiraClientError, type JiraIssue } from '../../../scripts/jev-jira/jiraClient';
import { GOV_AC_FIELDS, GOV_STORY_FIELDS, STORY_AUTHORIZED_PATHS_FIELD, createJiraQuery, type JiraQuery } from '../../../scripts/jev-flow/jiraQuery';
import { checkReadiness, evaluateReadiness, pathPatternProblem, registryDigest } from '../../../scripts/jev-flow/readiness';
import { canonicalHash, type VerificationRegistry } from '../../../scripts/jev-flow/types';

const REPO = path.resolve(__dirname, '../../..');
const REGISTRY = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts', 'jev-flow', 'verification-registry.json'), 'utf8')) as VerificationRegistry;
// Built at runtime so no credential-shaped literal exists in the source.
const FAKE_JIRA_TOKEN = ['ATATT3x', 'Z'.repeat(40)].join('');

const sel = (value: string, id = `opt-${value}`) => ({ value, id });

function story(over: Record<string, unknown> = {}, key = 'OMNI-10'): JiraIssue {
  return {
    key,
    fields: {
      summary: 'Health route hardening',
      issuetype: { id: '10005' },
      project: { id: '10033' },
      status: { id: '10036', name: 'In Progress' },
      updated: '2026-10-01T09:00:00.000+0000',
      [STORY_FIELDS.objective]: 'Harden the health route',
      [STORY_FIELDS.architecture]: 'Route handler only',
      [STORY_FIELDS.invariants]: 'No route skips auth\n\n  No schema change  ',
      [STORY_AUTHORIZED_PATHS_FIELD]: 'pages/api/health/**\nbackend/tests/unit/health*.test.ts',
      [STORY_FIELDS.prohibitedPaths]: 'supabase/**',
      [STORY_FIELDS.verificationRequirements]: 'jev.unit\nscripts.typecheck',
      ...over,
    },
  };
}

function ac(key: string, over: Record<string, unknown> = {}, parent = 'OMNI-10'): JiraIssue {
  return {
    key,
    fields: {
      summary: `AC ${key}`,
      issuetype: { id: '10074' },
      project: { id: '10033' },
      status: { id: '10037', name: 'Open' },
      parent: { key: parent },
      updated: '2026-10-01T10:00:00.000+0000',
      [AC_FIELDS.acId]: `AC-${key.split('-')[1]}`,
      [AC_FIELDS.statement]: 'The health route unit tests pass',
      [AC_FIELDS.kind]: sel('Deterministic', '10024'),
      [AC_FIELDS.evidenceKind]: sel('Test', '10026'),
      [AC_FIELDS.verification]: sel('UNVERIFIED', '10038'),
      ...over,
    },
  };
}

const codes = (r: { findings: Array<{ code: string }> }) => r.findings.map((f) => f.code);

describe('evaluateReadiness', () => {
  it('ready Story → READY with projected story, ACs, scope and verification', () => {
    const r = evaluateReadiness('OMNI-10', story(), [ac('OMNI-12'), ac('OMNI-11', { [AC_FIELDS.kind]: sel('Judgment'), [AC_FIELDS.evidenceKind]: sel('Manual') })], REGISTRY);
    expect(r.ready).toBe(true);
    expect(r.findings).toEqual([]);
    expect(r.story).toEqual({
      key: 'OMNI-10',
      summary: 'Health route hardening',
      status: 'In Progress',
      objective: 'Harden the health route',
      architecture: 'Route handler only',
      invariants: ['No route skips auth', 'No schema change'],
      updated: '2026-10-01T09:00:00.000+0000',
    });
    expect(r.acceptance_criteria.map((a) => a.key)).toEqual(['OMNI-11', 'OMNI-12']);
    expect(r.acceptance_criteria[0]).toMatchObject({ ac_id: 'AC-11', kind: 'Judgment', evidence_kind: 'Manual', status: 'Open', verification: 'UNVERIFIED' });
    expect(r.scope).toEqual({ authorized_paths: ['pages/api/health/**', 'backend/tests/unit/health*.test.ts'], prohibited_paths: ['supabase/**'] });
    expect(r.verification.registry_ids).toEqual(['jev.unit', 'scripts.typecheck']);
  });

  it('registry digest follows the shared formula (entries in registry_ids order)', () => {
    const r = evaluateReadiness('OMNI-10', story({ [STORY_FIELDS.verificationRequirements]: 'scripts.typecheck\njev.unit\nscripts.typecheck' }), [ac('OMNI-11')], REGISTRY);
    expect(r.verification.registry_ids).toEqual(['scripts.typecheck', 'jev.unit']);
    const byId = (id: string) => REGISTRY.entries.find((e) => e.id === id);
    expect(r.verification.registry_digest).toBe(canonicalHash([byId('scripts.typecheck'), byId('jev.unit')]));
    expect(registryDigest(['jev.unit', 'scripts.typecheck'], REGISTRY)).not.toBe(r.verification.registry_digest);
  });

  it('sorts ACs by Jira key numerically (OMNI-9 before OMNI-10x)', () => {
    const r = evaluateReadiness('OMNI-10', story(), [ac('OMNI-100'), ac('OMNI-99'), ac('OMNI-101')], REGISTRY);
    expect(r.acceptance_criteria.map((a) => a.key)).toEqual(['OMNI-99', 'OMNI-100', 'OMNI-101']);
  });

  it('no AC → NOT_READY NO_ACCEPTANCE_CRITERIA, no packet parts', () => {
    const r = evaluateReadiness('OMNI-10', story(), [], REGISTRY);
    expect(r.ready).toBe(false);
    expect(codes(r)).toEqual(['NO_ACCEPTANCE_CRITERIA']);
    expect(r.story).toBeUndefined();
    expect(r.acceptance_criteria).toBeUndefined();
  });

  it('missing Story → STORY_NOT_FOUND; bad key → INVALID_STORY_KEY', () => {
    expect(codes(evaluateReadiness('OMNI-10', null, [], REGISTRY))).toEqual(['STORY_NOT_FOUND']);
    expect(codes(evaluateReadiness('OMNI-0', null, [], REGISTRY))).toEqual(['INVALID_STORY_KEY']);
    expect(codes(evaluateReadiness('omni-10', story(), [ac('OMNI-11')], REGISTRY))).toEqual(['INVALID_STORY_KEY']);
  });

  it('non-Story issue → NOT_A_STORY', () => {
    expect(codes(evaluateReadiness('OMNI-10', story({ issuetype: { id: '10074' } }), [ac('OMNI-11')], REGISTRY))).toEqual(['NOT_A_STORY']);
  });

  it.each([
    ['10039', 'Verified'],
    ['10040', 'Integrated'],
    ['10041', 'Released'],
  ])('Story in %s (%s) → STORY_NOT_ACTIVE', (id, name) => {
    const r = evaluateReadiness('OMNI-10', story({ status: { id, name } }), [ac('OMNI-11')], REGISTRY);
    expect(r.ready).toBe(false);
    expect(codes(r)).toEqual(['STORY_NOT_ACTIVE']);
  });

  it('empty Objective / Authorized Paths / Verification Requirements → STORY_FIELD_MISSING per field', () => {
    const r = evaluateReadiness(
      'OMNI-10',
      story({ [STORY_FIELDS.objective]: '  ', [STORY_AUTHORIZED_PATHS_FIELD]: null, [STORY_FIELDS.verificationRequirements]: '\n\n' }),
      [ac('OMNI-11')],
      REGISTRY,
    );
    expect(r.findings.filter((f) => f.code === 'STORY_FIELD_MISSING').map((f) => f.field)).toEqual(
      [STORY_AUTHORIZED_PATHS_FIELD, STORY_FIELDS.objective, STORY_FIELDS.verificationRequirements].sort(),
    );
  });

  it('incomplete AC fields → AC_INCOMPLETE per field', () => {
    const r = evaluateReadiness(
      'OMNI-10',
      story(),
      [ac('OMNI-11', { [AC_FIELDS.acId]: 'AC-x', [AC_FIELDS.statement]: '', [AC_FIELDS.kind]: null, [AC_FIELDS.evidenceKind]: null })],
      REGISTRY,
    );
    expect(r.ready).toBe(false);
    expect(r.findings.map((f) => [f.code, f.field])).toEqual(
      [AC_FIELDS.acId, AC_FIELDS.statement, AC_FIELDS.kind, AC_FIELDS.evidenceKind].sort().map((field) => ['AC_INCOMPLETE', field]),
    );
  });

  it('duplicate AC IDs → AC_DUPLICATE_ID on every holder', () => {
    const r = evaluateReadiness('OMNI-10', story(), [ac('OMNI-11'), ac('OMNI-12', { [AC_FIELDS.acId]: 'AC-11' })], REGISTRY);
    expect(r.findings.map((f) => [f.code, f.issue])).toEqual([
      ['AC_DUPLICATE_ID', 'OMNI-11'],
      ['AC_DUPLICATE_ID', 'OMNI-12'],
    ]);
  });

  it('Deterministic AC with Lint → AC_UNSUPPORTED_EVIDENCE_KIND; Build with no build registry id → AC_NO_MATCHING_VERIFICATION', () => {
    const r = evaluateReadiness(
      'OMNI-10',
      story(),
      [ac('OMNI-11', { [AC_FIELDS.evidenceKind]: sel('Lint') }), ac('OMNI-12', { [AC_FIELDS.evidenceKind]: sel('Build') })],
      REGISTRY,
    );
    expect(r.findings.map((f) => [f.code, f.issue])).toEqual([
      ['AC_UNSUPPORTED_EVIDENCE_KIND', 'OMNI-11'],
      ['AC_NO_MATCHING_VERIFICATION', 'OMNI-12'],
    ]);
    const typecheckOnly = evaluateReadiness('OMNI-10', story({ [STORY_FIELDS.verificationRequirements]: 'scripts.typecheck' }), [ac('OMNI-11')], REGISTRY);
    expect(codes(typecheckOnly)).toEqual(['AC_NO_MATCHING_VERIFICATION']);
  });

  it('shell text in Verification Requirements → INVALID_REGISTRY_REFERENCE and is never echoed', () => {
    const shell = 'npm test && rm -rf /';
    const r = evaluateReadiness('OMNI-10', story({ [STORY_FIELDS.verificationRequirements]: `jev.unit\n${shell}` }), [ac('OMNI-11')], REGISTRY);
    expect(codes(r)).toEqual(['INVALID_REGISTRY_REFERENCE']);
    expect(JSON.stringify(r)).not.toContain('rm -rf');
    expect(r.verification).toBeUndefined();
  });

  it('well-formed but unknown registry id → UNKNOWN_REGISTRY_ID', () => {
    const r = evaluateReadiness('OMNI-10', story({ [STORY_FIELDS.verificationRequirements]: 'jev.unit\nnot.in.registry' }), [ac('OMNI-11')], REGISTRY);
    expect(codes(r)).toEqual(['UNKNOWN_REGISTRY_ID']);
  });

  it.each(['/etc/passwd', 'a\\b', '../x', 'a/../b', 'a/./b', '**', 'a/**/b', 'a**/x', 'C:/repo/x', 'a//b', 'dir/'])('rejects path pattern %s', (p) => {
    expect(pathPatternProblem(p)).not.toBeNull();
    const r = evaluateReadiness('OMNI-10', story({ [STORY_FIELDS.prohibitedPaths]: p }), [ac('OMNI-11')], REGISTRY);
    expect(codes(r)).toEqual(['INVALID_PATH_PATTERN']);
  });

  it.each(['dir/**', 'a/b/c.ts', 'backend/*.ts', 'a/*/b.ts', 'README.md'])('accepts path pattern %s', (p) => {
    expect(pathPatternProblem(p)).toBeNull();
  });

  it('findings are deterministic and sorted by (issue, code, field) regardless of input order', () => {
    const s = story({ [STORY_FIELDS.objective]: '', [STORY_FIELDS.prohibitedPaths]: '../x', status: { id: '10041', name: 'Released' } });
    const acs = [ac('OMNI-100', { [AC_FIELDS.statement]: '' }), ac('OMNI-9', { [AC_FIELDS.evidenceKind]: sel('Other') }), ac('OMNI-11', { [AC_FIELDS.acId]: 'AC-9' })];
    const a = evaluateReadiness('OMNI-10', s, acs, REGISTRY);
    const b = evaluateReadiness('OMNI-10', s, [...acs].reverse(), REGISTRY);
    expect(a).toEqual(b);
    expect(a.findings.map((f) => [f.issue, f.code])).toEqual([
      ['OMNI-9', 'AC_DUPLICATE_ID'],
      ['OMNI-9', 'AC_UNSUPPORTED_EVIDENCE_KIND'],
      ['OMNI-10', 'INVALID_PATH_PATTERN'],
      ['OMNI-10', 'STORY_FIELD_MISSING'],
      ['OMNI-10', 'STORY_NOT_ACTIVE'],
      ['OMNI-11', 'AC_DUPLICATE_ID'],
      ['OMNI-100', 'AC_INCOMPLETE'],
    ]);
  });

  it('an issue that is not an AC of this Story fails closed', () => {
    const r = evaluateReadiness('OMNI-10', story(), [ac('OMNI-11', {}, 'OMNI-99')], REGISTRY);
    expect(codes(r)).toEqual(['JIRA_ERROR']);
  });
});

class FakeQuery implements JiraQuery {
  constructor(
    private readonly s: JiraIssue | null,
    private readonly acs: JiraIssue[],
    private readonly fail: Error | null = null,
  ) {}
  calls: string[] = [];
  async getStory(key: string) {
    this.calls.push(`story:${key}`);
    if (this.fail) throw this.fail;
    return this.s;
  }
  async listAcceptanceCriteria(key: string) {
    this.calls.push(`acs:${key}`);
    return this.acs;
  }
}

describe('checkReadiness', () => {
  it('reads Story then ACs and evaluates', async () => {
    const q = new FakeQuery(story(), [ac('OMNI-11')]);
    const r = await checkReadiness('OMNI-10', { query: q, registry: REGISTRY });
    expect(r.ready).toBe(true);
    expect(q.calls).toEqual(['story:OMNI-10', 'acs:OMNI-10']);
  });

  it('missing Story → STORY_NOT_FOUND without listing ACs; bad key → no Jira call', async () => {
    const q = new FakeQuery(null, []);
    expect(codes(await checkReadiness('OMNI-10', { query: q, registry: REGISTRY }))).toEqual(['STORY_NOT_FOUND']);
    expect(q.calls).toEqual(['story:OMNI-10']);
    const q2 = new FakeQuery(story(), []);
    expect(codes(await checkReadiness('OMNI-10 OR 1=1', { query: q2, registry: REGISTRY }))).toEqual(['INVALID_STORY_KEY']);
    expect(q2.calls).toEqual([]);
  });

  it('Jira failure → JIRA_ERROR finding, not a throw', async () => {
    const r = await checkReadiness('OMNI-10', { query: new FakeQuery(null, [], new JiraClientError('JIRA_AUTH', 'Jira returned HTTP 401')), registry: REGISTRY });
    expect(r.ready).toBe(false);
    expect(r.findings).toEqual([{ code: 'JIRA_ERROR', issue: 'OMNI-10', message: 'Jira read failed (JIRA_AUTH): Jira returned HTTP 401' }]);
  });
});

describe('createJiraQuery (fetch stub)', () => {
  type Call = { url: string; init: RequestInit };
  function stub(pages: Array<Record<string, unknown>>, issues: Record<string, JiraIssue>) {
    const calls: Call[] = [];
    let page = 0;
    const fetchImpl = jest.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.includes('/rest/api/3/search/jql?')) return new Response(JSON.stringify(pages[page++]), { status: 200 });
      const m = /\/rest\/api\/2\/issue\/(OMNI-\d+)\?/.exec(url);
      const issue = m ? issues[m[1]] : undefined;
      return issue ? new Response(JSON.stringify(issue), { status: 200 }) : new Response(`missing ${FAKE_JIRA_TOKEN}`, { status: 404 });
    });
    return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
  }

  it('uses only GET, follows pagination, sends Bearer for mode bearer, fetches each AC with the AC field list', async () => {
    const { calls, fetchImpl } = stub(
      [
        { issues: [{ key: 'OMNI-11' }, { key: 'OMNI-12' }], nextPageToken: 'tok-2', isLast: false },
        { issues: [{ key: 'OMNI-13' }], isLast: true },
      ],
      { 'OMNI-11': ac('OMNI-11'), 'OMNI-12': ac('OMNI-12'), 'OMNI-13': ac('OMNI-13') },
    );
    const q = createJiraQuery({ credentials: { mode: 'bearer', email: '', token: FAKE_JIRA_TOKEN }, fetchImpl });
    const acs = await q.listAcceptanceCriteria('OMNI-10');
    expect(acs.map((a) => a.key)).toEqual(['OMNI-11', 'OMNI-12', 'OMNI-13']);
    expect(calls).toHaveLength(5);
    for (const c of calls) {
      expect(c.init.method).toBe('GET');
      expect(c.init.redirect).toBe('error');
      expect((c.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${FAKE_JIRA_TOKEN}`);
      expect(c.url.startsWith(`${JIRA_GATEWAY_BASE}/rest/api/`)).toBe(true);
      expect(c.init.body).toBeUndefined();
    }
    const first = new URL(calls[0].url);
    expect(first.pathname.endsWith('/rest/api/3/search/jql')).toBe(true);
    expect(first.searchParams.get('jql')).toBe('parent = OMNI-10 AND issuetype = 10074 ORDER BY key ASC');
    expect(first.searchParams.get('fields')).toBe('key');
    expect(first.searchParams.get('maxResults')).toBe('100');
    expect(first.searchParams.get('nextPageToken')).toBeNull();
    expect(new URL(calls[1].url).searchParams.get('nextPageToken')).toBe('tok-2');
    expect(decodeURIComponent(calls[2].url)).toContain(`/rest/api/2/issue/OMNI-11?fields=${GOV_AC_FIELDS.join(',')}`);
  });

  it('getStory reads v2 with the Story field list (incl. Authorized Paths) and maps 404 to null', async () => {
    const { calls, fetchImpl } = stub([], { 'OMNI-10': story() });
    const q = createJiraQuery({ credentials: { email: 'k@example.com', token: FAKE_JIRA_TOKEN }, fetchImpl });
    expect((await q.getStory('OMNI-10')).key).toBe('OMNI-10');
    expect(GOV_STORY_FIELDS).toContain(STORY_AUTHORIZED_PATHS_FIELD);
    expect(decodeURIComponent(calls[0].url)).toContain(`/rest/api/2/issue/OMNI-10?fields=${GOV_STORY_FIELDS.join(',')}`);
    expect((calls[0].init.headers as Record<string, string>).Authorization.startsWith('Basic ')).toBe(true);
    expect(await q.getStory('OMNI-77')).toBeNull();
  });

  it('rejects invalid keys from search and invalid story keys before any request', async () => {
    const { fetchImpl } = stub([{ issues: [{ key: 'OMNI-11' }, { key: 'EVIL-1' }], isLast: true }], { 'OMNI-11': ac('OMNI-11') });
    const q = createJiraQuery({ credentials: { mode: 'bearer', email: '', token: FAKE_JIRA_TOKEN }, fetchImpl });
    await expect(q.listAcceptanceCriteria('OMNI-10')).rejects.toMatchObject({ code: 'JIRA_MALFORMED' });
    const spy = jest.fn();
    const q2 = createJiraQuery({ credentials: { mode: 'bearer', email: '', token: FAKE_JIRA_TOKEN }, fetchImpl: spy as unknown as typeof fetch });
    await expect(q2.listAcceptanceCriteria('OMNI-10 OR project = X')).rejects.toMatchObject({ code: 'JIRA_MALFORMED' });
    await expect(q2.getStory('../OMNI-1')).rejects.toMatchObject({ code: 'JIRA_MALFORMED' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('HTTP errors carry code + status only, never the body or token', async () => {
    const fetchImpl = (async () => new Response(`denied ${FAKE_JIRA_TOKEN}`, { status: 500 })) as unknown as typeof fetch;
    const q = createJiraQuery({ credentials: { mode: 'bearer', email: '', token: FAKE_JIRA_TOKEN }, fetchImpl });
    const err = (await q.listAcceptanceCriteria('OMNI-10').catch((e) => e)) as JiraClientError;
    expect(err.code).toBe('JIRA_HTTP_ERROR');
    expect(err.message).toBe('Jira returned HTTP 500');
    expect(JSON.stringify({ m: err.message, s: String(err) })).not.toContain(FAKE_JIRA_TOKEN);
  });

  it('module source has no write method', () => {
    const src = fs.readFileSync(path.join(REPO, 'scripts', 'jev-flow', 'jiraQuery.ts'), 'utf8');
    expect(src).not.toMatch(/'(PUT|POST|DELETE|PATCH)'/);
    expect(src).not.toMatch(/updateAdvisoryFields/);
  });
});
