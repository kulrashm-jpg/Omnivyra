/**
 * A stored workflow definition is read back WHOLE.
 *
 * Found by real-PostgreSQL verification (2026-10-28): the version mapper kept only
 * `steps`, so every version read from the database had lost `enrollment`,
 * `objective` and `policy` — entry conditions were never applied, frequency was
 * never enforced and objectives never reported. The vertical slice mocked the
 * workflow store and could not see it. This reads through the REAL store.
 */

type Row = Record<string, unknown>;
const stored: { row: Row | null } = { row: null };

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => {
    const b: Record<string, unknown> = {
      select: () => b, eq: () => b, in: () => b, is: () => b, order: () => b, limit: () => b,
      maybeSingle: async () => ({ data: stored.row, error: null }),
      single: async () => ({ data: stored.row, error: null }),
      then: (res: (v: unknown) => unknown) => Promise.resolve({ data: stored.row ? [stored.row] : [], error: null }).then(res),
    };
    return b;
  },
}));
jest.mock('../../db/supabaseClient', () => ({ supabase: { rpc: async () => ({ data: null, error: { message: 'unused' } }) } }));

import { getCurrentWorkflowVersion, getWorkflowVersion, validateWorkflowDefinition } from '../../services/workflows/workflowStore';
import { checkEnrollmentEligibility } from '../../services/orchestration/enrollment';

const ORG = '11111111-1111-4111-8111-111111111111';
const WF = '22222222-2222-4222-8222-222222222222';
const VER = '33333333-3333-4333-8333-333333333333';

const DEFINITION = validateWorkflowDefinition({
  objective: { statement: 'Book a call', success_outcome: 'step_completion', target_rate: 0.3 },
  enrollment: { conditions: [{ fact: 'prospect_score_overall', op: 'gte', value: 0.5 }] },
  policy: { min_hours_between_actions: 24 },
  steps: [{ key: 'assign', channel: 'internal', delay_after_previous_hours: 0, execution_mode: 'human' }],
});

beforeEach(() => {
  stored.row = {
    id: VER, organization_id: ORG, workflow_id: WF, version: 1, status: 'published',
    // As jsonb comes back from PostgREST: a plain object, exactly as written.
    definition: JSON.parse(JSON.stringify(DEFINITION)),
    created_by: null, created_at: '2026-10-28T00:00:00Z', updated_at: '2026-10-28T00:00:00Z',
    published_at: '2026-10-28T00:00:00Z', published_by: null,
  };
});

describe('workflow definition read-back', () => {
  it('keeps objective, enrollment and policy alongside steps', async () => {
    for (const read of [() => getCurrentWorkflowVersion(ORG, WF), () => getWorkflowVersion(ORG, VER)]) {
      const v = await read();
      expect(v?.definition).toEqual(DEFINITION);
    }
  });

  it('a version authored before orchestration still reads as steps only', async () => {
    stored.row = { ...(stored.row as Row), definition: { steps: DEFINITION.steps } };
    const v = await getWorkflowVersion(ORG, VER);
    expect(v?.definition).toEqual({ steps: DEFINITION.steps });
  });

  it('so the published version\'s entry conditions are actually applied', async () => {
    const verdict = await checkEnrollmentEligibility({
      organizationId: ORG, workflowId: WF, subject: { kind: 'prospect', id: '44444444-4444-4444-8444-444444444444' },
      intelligence: {
        resolvePerson: async () => ({ ok: true, personId: null }),
        readPersonContacts: async () => null,
        readLeadIntelligence: async () => null,
        readProspectScore: async () => ({ intent: null, overall: 0.1, confidence: null }),
        channelPermission: async () => null,
      },
    });
    expect(verdict.eligible).toBe(false);
    expect(verdict.reasons.join(' ')).toMatch(/prospect_score_overall/);
  });
});
