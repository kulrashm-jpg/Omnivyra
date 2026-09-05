/**
 * ICP-SELECTION-CONTRACT-001 §13 — the proposal metadata reaching storage
 * through the CANONICAL version-creation path, and nothing else changing.
 *
 * The database is doubled exactly as `d1ProspectIcpPersistence.test.ts` doubles
 * it, and for the same reason: what is proven here is the WRITER'S BEHAVIOUR —
 * which row it builds, and what it refuses to build at all.
 *
 * The load-bearing assertions are D and F. D proves the ranked shortlist cannot
 * reach `criteria`; F proves a proposal that predates this contract still
 * stores byte-identically, so nothing needs migrating.
 */

interface Call {
  table: string;
  kind: 'insert' | 'update' | 'select';
  row?: Record<string, unknown>;
  filters: Record<string, unknown>;
}

interface Response { data?: unknown; error?: unknown }

const calls: Call[] = [];
let queue: Response[] = [];

const nextResponse = (): Response => (queue.length ? queue.shift()! : { data: [], error: null });

function makeBuilder(table: string) {
  const call: Call = { table, kind: 'select', filters: {} };
  let kindSet = false;
  const settle = () => { calls.push(call); return Promise.resolve(nextResponse()); };

  const b: Record<string, unknown> = {
    insert(row: Record<string, unknown>) { call.kind = 'insert'; call.row = row; kindSet = true; return b; },
    update(row: Record<string, unknown>) { call.kind = 'update'; call.row = row; kindSet = true; return b; },
    select() { if (!kindSet) { call.kind = 'select'; kindSet = true; } return b; },
    eq(k: string, v: unknown) { call.filters[k] = v; return b; },
    is(k: string, v: unknown) { call.filters[k] = v; return b; },
    order() { return b; },
    single: () => settle(),
    limit: () => settle(),
    then: (res: unknown, rej: unknown) => settle().then(res as never, rej as never),
  };
  return b;
}

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => makeBuilder(table),
}));

import { createIcpVersion, IcpContractError } from '../../services/prospectIcp';
import type { IcpCriterion } from '../../services/prospectIcp';

const ORG = '4bdbec26-4f7e-4e77-a965-d499e1472f5c';
const ICP_ID = '11111111-1111-4111-8111-111111111111';

const CRITERIA: IcpCriterion[] = [{
  id: 'title-marketing-buyer', kind: 'required', subject: 'person', attribute: 'job_title',
  predicate: { op: 'one_of', values: ['Founder', 'Head of Marketing', 'Marketing Manager'] },
}];

const TARGET = {
  rank: 1,
  title: 'Marketing Manager',
  roleTypes: ['user', 'evaluator'],
  derivation: 'directly_evidenced',
  confidence: 'high',
  evidenceFields: ['target_audience_list'],
  evidenceQuotes: ['Marketing managers'],
  orgAssumption: 'smb — a marketing function exists at this stage',
  factors: { e: 2, p: 2, b: 1, f: 2, r: 2, c: 1 },
};

/** Runs the writer with a successful insert queued, and returns the row built. */
async function insertedRow(proposal: unknown): Promise<Record<string, unknown>> {
  calls.length = 0;
  queue = [{ data: { id: 'ver-1' }, error: null }];
  await createIcpVersion({
    organizationId: ORG, icpId: ICP_ID, criteria: CRITERIA, version: 1, status: 'proposed',
    proposal: proposal as never, proposedByModel: 'claude-opus-5',
  });
  expect(calls[0].kind).toBe('insert');
  return calls[0].row as Record<string, unknown>;
}

async function refusalCode(proposal: unknown): Promise<string> {
  calls.length = 0;
  queue = [];
  try {
    await createIcpVersion({
      organizationId: ORG, icpId: ICP_ID, criteria: CRITERIA, version: 1, status: 'proposed',
      proposal: proposal as never,
    });
  } catch (err) {
    expect(err).toBeInstanceOf(IcpContractError);
    return (err as IcpContractError).code;
  }
  throw new Error('expected the writer to refuse, but it accepted the proposal');
}

beforeEach(() => { calls.length = 0; queue = []; });

describe('A — valid proposal targets persist through createIcpVersion', () => {
  it('stores targets, normalised, on the proposal column', async () => {
    const row = await insertedRow({
      status: 'ai_suggested',
      stageAssumption: { stage: 'smb', evidenceFields: ['target_customer_segment'] },
      targets: [{ ...TARGET, rank: 2, title: 'Head of Marketing' }, TARGET],
    });

    const proposal = row.proposal as Record<string, unknown>;
    const targets = proposal.targets as Array<Record<string, unknown>>;

    expect(targets).toHaveLength(2);
    // Rank-sorted on the way in, so two equivalent submissions store identically.
    expect(targets.map((t) => t.rank)).toEqual([1, 2]);
    expect(targets[0].title).toBe('Marketing Manager');
    expect(targets[0].roleTypes).toEqual(['evaluator', 'user']);
    expect(targets[0].factors).toEqual({ e: 2, p: 2, b: 1, f: 2, r: 2, c: 1 });
    expect(proposal.stageAssumption).toEqual({
      stage: 'smb', evidenceFields: ['target_customer_segment'], rationale: null,
    });
    // The rest of the proposal is carried through untouched.
    expect(proposal.status).toBe('ai_suggested');
  });
});

describe('B — invalid proposal targets are refused before the write', () => {
  it('refuses and issues NO statement at all', async () => {
    expect(await refusalCode({ targets: [{ ...TARGET, evidenceFields: [] }] }))
      .toBe('target_evidence_fields_empty');
    expect(calls).toHaveLength(0);
  });

  it('names the exact rule for each malformed shape', async () => {
    expect(await refusalCode({ targets: [{ ...TARGET, derivation: 'assumed' }] }))
      .toBe('target_derivation_invalid');
    expect(await refusalCode({ targets: [TARGET, { ...TARGET, title: 'marketing manager', rank: 2 }] }))
      .toBe('target_title_duplicate');
    expect(await refusalCode({ targets: [TARGET, { ...TARGET, rank: 3, title: 'Other' }] }))
      .toBe('target_ranks_incoherent');
    expect(await refusalCode({ targets: [{ ...TARGET, factors: { ...TARGET.factors, e: 0 } }] }))
      .toBe('target_evidence_factor_zero');
    expect(calls).toHaveLength(0);
  });
});

describe('C — rejected candidates remain auditable', () => {
  it('persists every rejection with its stated reason', async () => {
    const row = await insertedRow({
      targets: [TARGET],
      rejected: [
        { title: 'CMO', reason: 'above AUTHORITY_CEILING — excluded by rule, not by score' },
        { title: 'Growth Marketing Manager', reason: 'E=0 — goals evidence an outcome, not a function' },
      ],
    });
    const rejected = (row.proposal as Record<string, unknown>).rejected as Array<Record<string, string>>;
    expect(rejected).toHaveLength(2);
    expect(rejected.map((r) => r.title)).toEqual(['CMO', 'Growth Marketing Manager']);
    expect(rejected[0].reason).toContain('AUTHORITY_CEILING');
  });

  it('refuses a rejection with no reason rather than storing an unauditable one', async () => {
    expect(await refusalCode({ rejected: [{ title: 'CMO' }] })).toBe('rejected_reason_missing');
    expect(calls).toHaveLength(0);
  });
});

describe('D — proposal metadata cannot silently alter canonical criteria', () => {
  it('leaves criteria exactly as the criteria validator produced them', async () => {
    const withTargets = await insertedRow({
      targets: [
        TARGET,
        { ...TARGET, rank: 2, title: 'VP Marketing', derivation: 'inferred', evidenceQuotes: [] },
      ],
    });
    const withoutTargets = await insertedRow({ status: 'ai_suggested' });

    // Five targets or none, the scoring surface is byte-identical.
    expect(withTargets.criteria).toEqual(withoutTargets.criteria);

    const criteria = withTargets.criteria as IcpCriterion[];
    expect(criteria).toHaveLength(1);
    expect(criteria[0].attribute).toBe('job_title');
    // 'VP Marketing' was a TARGET. It must not have become a match value.
    const values = (criteria[0].predicate as { values: string[] }).values;
    expect(values).toEqual(['Founder', 'Head of Marketing', 'Marketing Manager']);
    expect(values).not.toContain('VP Marketing');
  });

  it('refuses an invalid CRITERION before it ever looks at the proposal', async () => {
    calls.length = 0;
    queue = [];
    let code = '';
    try {
      await createIcpVersion({
        organizationId: ORG, icpId: ICP_ID, version: 1,
        criteria: [{
          id: 'sen', kind: 'required', subject: 'person', attribute: 'seniority',
          predicate: { op: 'one_of', values: ['cxo'] },
        }],
        proposal: { targets: [TARGET] } as never,
      });
    } catch (err) { code = (err as IcpContractError).code; }
    expect(code).toBe('value_outside_vocabulary');
    expect(calls).toHaveLength(0);
  });
});

describe('E — AI proposal and ratified version remain distinguishable', () => {
  it('writes no ratifier on a proposed version, however rich its metadata', async () => {
    const row = await insertedRow({ status: 'ai_suggested', targets: [TARGET] });
    expect(row.status).toBe('proposed');
    expect(row.proposed_by_model).toBe('claude-opus-5');
    expect(row).not.toHaveProperty('ratified_by');
    expect(row).not.toHaveProperty('ratified_at');
  });

  it('still refuses to create a version already claiming to be ratified', async () => {
    calls.length = 0;
    queue = [];
    let code = '';
    try {
      await createIcpVersion({
        organizationId: ORG, icpId: ICP_ID, criteria: CRITERIA, version: 1,
        status: 'ratified' as never, proposal: { targets: [TARGET] } as never,
      });
    } catch (err) { code = (err as IcpContractError).code; }
    expect(code).toBe('status_not_creatable');
    expect(calls).toHaveLength(0);
  });
});

describe('F — existing ICP behaviour is unchanged', () => {
  it('stores a proposal that names no targets byte-identically, adding no keys', async () => {
    const legacy = { ai_value: 'the original text', status: 'ai_suggested', guidance: null };
    const row = await insertedRow(legacy);
    expect(row.proposal).toEqual(legacy);
    expect(Object.keys(row.proposal as object).sort()).toEqual(['ai_value', 'guidance', 'status']);
  });

  it('stores an absent proposal as the empty object it always was', async () => {
    calls.length = 0;
    queue = [{ data: { id: 'ver-1' }, error: null }];
    await createIcpVersion({ organizationId: ORG, icpId: ICP_ID, criteria: CRITERIA, version: 1 });
    expect((calls[0].row as Record<string, unknown>).proposal).toEqual({});
  });

  it('still reports a taken version number as a 23505 collision', async () => {
    calls.length = 0;
    queue = [
      { data: null, error: { code: '23505', message: 'duplicate key' } },
      { data: [{ id: 'ver-2', organization_id: ORG, icp_id: ICP_ID, version: 2, status: 'proposed', criteria: [], proposal: {} }], error: null },
    ];
    const out = await createIcpVersion({
      organizationId: ORG, icpId: ICP_ID, criteria: CRITERIA, version: 2, status: 'proposed',
      proposal: { targets: [TARGET] } as never,
    });
    expect(out).toMatchObject({ version: 2, outcome: 'already_present' });
  });
});
