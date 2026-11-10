/**
 * PI-041-A — EMAIL CONTEXT AND RECIPIENT RESOLUTION, T1 BEHAVIOURAL.
 *
 * The write owner is replaced by a tiny in-memory table that genuinely APPLIES
 * the filters it is given. That matters: a source-text guard can only show that
 * `.eq('company_id', …)` appears, whereas this fails if the filter is absent,
 * misspelled, or applied to the wrong column — the cross-tenant tests below hold
 * a real row belonging to another organization and require that it is not found.
 *
 * T2 repeats all of this against the real schema, where the database itself is the
 * authority. This exists so T1 stands alone, without Docker.
 */
type Row = Record<string, unknown>;

const TABLES: Record<string, Row[]> = {};

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const filters: Array<[string, unknown]> = [];
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (column: string, value: unknown) => { filters.push([column, value]); return builder; },
      insert: (values: Row) => {
        const rows = TABLES[table] ?? (TABLES[table] = []);
        rows.push({ id: 'inserted', ...values });
        return builder;
      },
      maybeSingle: async () => {
        const rows = TABLES[table] ?? [];
        const match = rows.find((r) => filters.every(([c, v]) => r[c] === v));
        return { data: match ?? null, error: null };
      },
    };
    return builder;
  },
}));

// eslint-disable-next-line import/first
import {
  resolveEmailExecutionContext, resolveEmailRecipient, EmailContextError,
} from '../../services/emailEngine/emailExecutionContext';

const ORG_A = '00000000-0000-4000-8000-00000000000a';
const ORG_B = '00000000-0000-4000-8000-00000000000b';
const TASK = '00000000-0000-4000-8000-000000000011';
const PERSON = '00000000-0000-4000-8000-000000000101';

const handoff = (over: Row = {}): Row => ({
  organization_id: ORG_A,
  outreach_task_id: TASK,
  campaign_id: '00000000-0000-4000-8000-000000000201',
  workflow_id: '00000000-0000-4000-8000-000000000202',
  workflow_version_id: '00000000-0000-4000-8000-000000000203',
  execution_instance_id: '00000000-0000-4000-8000-000000000204',
  execution_plan_id: '00000000-0000-4000-8000-000000000205',
  execution_plan_step_id: '00000000-0000-4000-8000-000000000206',
  execution_task_id: '00000000-0000-4000-8000-000000000207',
  subject_kind: 'prospect',
  subject_id: '00000000-0000-4000-8000-000000000208',
  person_id: PERSON,
  execution_mode: 'autonomous',
  workflow_requires_approval: false,
  policy_source: 'authored',
  ...over,
});

const personRow = (over: Row = {}): Row => ({
  id: PERSON,
  company_id: ORG_A,
  primary_email: 'ada@example.com',
  source_of_truth: 'apollo',
  full_name: 'Ada Lovelace',
  first_name: 'Ada',
  last_name: 'Lovelace',
  job_title: 'Analyst',
  department: null,
  seniority: null,
  city: 'London',
  region: null,
  timezone: null,
  ...over,
});

const codeOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return 'DID_NOT_THROW';
  } catch (e) {
    expect(e).toBeInstanceOf(EmailContextError);
    return (e as EmailContextError).code;
  }
};

beforeEach(() => {
  for (const key of Object.keys(TABLES)) delete TABLES[key];
  TABLES.outreach_bridge_handoffs = [];
  TABLES.unified_persons = [];
});

describe('041-A — execution context resolution', () => {
  it('recovers the whole chain from the 040 handoff', async () => {
    TABLES.outreach_bridge_handoffs.push(handoff());

    const ctx = await resolveEmailExecutionContext(ORG_A, TASK);

    expect(ctx).toEqual({
      organizationId: ORG_A,
      campaignId: '00000000-0000-4000-8000-000000000201',
      workflowId: '00000000-0000-4000-8000-000000000202',
      workflowVersionId: '00000000-0000-4000-8000-000000000203',
      executionInstanceId: '00000000-0000-4000-8000-000000000204',
      executionPlanId: '00000000-0000-4000-8000-000000000205',
      executionPlanStepId: '00000000-0000-4000-8000-000000000206',
      executionTaskId: '00000000-0000-4000-8000-000000000207',
      subjectKind: 'prospect',
      subjectId: '00000000-0000-4000-8000-000000000208',
      personId: PERSON,
      executionMode: 'autonomous',
      workflowRequiresApproval: false,
      policySource: 'authored',
    });
  });

  it('carries BOTH subject kinds, from the handoff and not from lead_id', async () => {
    TABLES.outreach_bridge_handoffs.push(handoff({ subject_kind: 'lead' }));
    expect((await resolveEmailExecutionContext(ORG_A, TASK)).subjectKind).toBe('lead');

    TABLES.outreach_bridge_handoffs = [handoff({ subject_kind: 'prospect' })];
    expect((await resolveEmailExecutionContext(ORG_A, TASK)).subjectKind).toBe('prospect');
  });

  it('A HANDOFF IN ANOTHER TENANT IS NOT FOUND', async () => {
    // The row exists. Only the tenant differs — and the filter must be what
    // excludes it, which is why the fake applies filters rather than ignoring them.
    TABLES.outreach_bridge_handoffs.push(handoff({ organization_id: ORG_B }));
    expect(await codeOf(resolveEmailExecutionContext(ORG_A, TASK))).toBe('handoff_not_found');
  });

  it('a task with no handoff refuses — an unbridged task is not sendable', async () => {
    expect(await codeOf(resolveEmailExecutionContext(ORG_A, TASK))).toBe('handoff_not_found');
  });

  it('FAILS CLOSED on an unusable kind, mode or person', async () => {
    TABLES.outreach_bridge_handoffs = [handoff({ subject_kind: 'account' })];
    expect(await codeOf(resolveEmailExecutionContext(ORG_A, TASK))).toBe('invalid_context');

    TABLES.outreach_bridge_handoffs = [handoff({ execution_mode: 'turbo' })];
    expect(await codeOf(resolveEmailExecutionContext(ORG_A, TASK))).toBe('invalid_context');

    TABLES.outreach_bridge_handoffs = [handoff({ person_id: null })];
    expect(await codeOf(resolveEmailExecutionContext(ORG_A, TASK))).toBe('invalid_context');
  });

  it('a pre-040 policy default is reported as such, never as authored', async () => {
    TABLES.outreach_bridge_handoffs = [
      handoff({ policy_source: 'legacy_default', execution_mode: 'human', workflow_requires_approval: true }),
    ];
    const ctx = await resolveEmailExecutionContext(ORG_A, TASK);
    expect(ctx.policySource).toBe('legacy_default');
    expect(ctx.workflowRequiresApproval).toBe(true);
  });

  it('refuses a malformed tenant or task identifier before reading anything', async () => {
    expect(await codeOf(resolveEmailExecutionContext('not-a-uuid', TASK))).toBe('invalid_org');
    expect(await codeOf(resolveEmailExecutionContext(ORG_A, 'not-a-uuid'))).toBe('invalid_task');
  });
});

describe('041-A — recipient resolution', () => {
  it('resolves the canonical address and the authorized fields only', async () => {
    TABLES.unified_persons.push(personRow());

    const r = await resolveEmailRecipient(ORG_A, PERSON);

    expect(r.email).toBe('ada@example.com');
    expect(r.personId).toBe(PERSON);
    expect(r.sourceOfTruth).toBe('apollo');
    // Null-valued fields are omitted rather than carried as empty strings, so a
    // render asking for them refuses instead of substituting a gap.
    expect(r.personalization).toEqual({
      full_name: 'Ada Lovelace', first_name: 'Ada', last_name: 'Lovelace',
      job_title: 'Analyst', city: 'London',
    });
  });

  it('A PERSON IN ANOTHER TENANT IS NOT FOUND', async () => {
    TABLES.unified_persons.push(personRow({ company_id: ORG_B }));
    expect(await codeOf(resolveEmailRecipient(ORG_A, PERSON))).toBe('person_not_found');
  });

  it('REFUSES RATHER THAN GUESSING when there is no address', async () => {
    for (const value of [null, '', '   ']) {
      TABLES.unified_persons = [personRow({ primary_email: value })];
      expect(await codeOf(resolveEmailRecipient(ORG_A, PERSON))).toBe('email_missing');
    }
  });

  it('REFUSES AN UNUSABLE ADDRESS rather than repairing it', async () => {
    for (const value of ['ada', 'ada@', '@example.com', 'ada@example', 'a b@example.com',
      'Ada <ada@example.com>', 'ada@example.', 'ada@@example.com']) {
      TABLES.unified_persons = [personRow({ primary_email: value })];
      expect(await codeOf(resolveEmailRecipient(ORG_A, PERSON))).toBe('email_invalid');
    }
  });

  it('trims a stored address but never rewrites it', async () => {
    TABLES.unified_persons = [personRow({ primary_email: '  ada@example.com  ' })];
    expect((await resolveEmailRecipient(ORG_A, PERSON)).email).toBe('ada@example.com');
  });

  it('a missing person refuses, with no fallback address anywhere', async () => {
    expect(await codeOf(resolveEmailRecipient(ORG_A, PERSON))).toBe('person_not_found');
  });

  it('IT WRITES NOTHING', async () => {
    TABLES.unified_persons.push(personRow());
    await resolveEmailRecipient(ORG_A, PERSON);
    TABLES.outreach_bridge_handoffs.push(handoff());
    await resolveEmailExecutionContext(ORG_A, TASK);
    // Exactly the fixtures, unchanged: resolution is a read.
    expect(TABLES.unified_persons).toHaveLength(1);
    expect(TABLES.outreach_bridge_handoffs).toHaveLength(1);
  });
});
