/**
 * Network-action draft writer: the rows it writes must carry the field the
 * observation lock reads. Writer and lock are both real here, so the test fails
 * if they stop agreeing. In-memory fake DB (helpers/communityExecutionFakeDb); no
 * network, not PostgreSQL.
 */

import { createFakeDb, type FakeDb } from './helpers/communityExecutionFakeDb';

let mockDb: FakeDb = createFakeDb();
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => mockDb.from(t),
  ownedDbRpc: jest.fn(async () => ({ data: null, error: null })),
}));
jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: (t: string) => mockDb.from(t), rpc: jest.fn(async () => ({ data: null, error: null })) },
}));
jest.mock('../../services/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }), { virtual: true });
// The engine's RPA module opens a queue connection at import; no test may reach it.
jest.mock('../../services/rpaWorker/rpaWorkerService', () => ({
  executeRpaTask: jest.fn(() => { throw new Error('RPA must not be reached from a unit test'); }),
}));
jest.mock('../../services/playbooks/playbookService', () => ({
  getPlaybookById: async () => ({
    id: 'pb-1',
    name: 'Network',
    execution_modes: { api_allowed: true },
    network_eligibility: {
      enabled: true,
      allowed_classifications: ['peer'],
      allowed_actions: ['like'],
      max_new_users_per_day: 5,
    },
  }),
}));

import { generateNetworkActionCandidates } from '../../services/networkExpansion/networkActionCandidateService';
import { enginePreflight, type CommunityActionRow, type PreflightDeps } from '../../services/orchestration/communityEngineAdapter';

const ORG = 'org-1';

/** Every engine gate open, so only the observation lock can refuse. */
const openGates: PreflightDeps = {
  getPolicy: async () => ({ execution_enabled: true, auto_rules_enabled: true, require_human_approval: false, updated_at: null, updated_by: null }),
  guardrail: async () => ({ allowed: true }),
  getPlaybook: (async () => ({ id: 'pb-1' })) as unknown as PreflightDeps['getPlaybook'],
  loadHistory: async () => ({ replies_last_hour: 0, follows_today: 0, actions_today: 0 }),
  validatePlaybook: (() => ({ allowed: true, requires_approval: false })) as unknown as PreflightDeps['validatePlaybook'],
  resolveMode: async () => 'api',
  checkUsage: (async () => ({ allowed: true })) as unknown as PreflightDeps['checkUsage'],
};

async function writtenRow(): Promise<CommunityActionRow> {
  const out = await generateNetworkActionCandidates({ tenant_id: ORG, organization_id: ORG, playbook_id: 'pb-1' });
  expect(out.created_count).toBe(1);
  return mockDb.tables.community_ai_actions[0] as unknown as CommunityActionRow;
}

beforeEach(() => {
  mockDb = createFakeDb({
    community_ai_actions: [],
    community_ai_discovered_users: [{
      id: 'du-1',
      tenant_id: ORG,
      organization_id: ORG,
      platform: 'linkedin',
      profile_url: 'https://www.linkedin.com/in/someone',
      classification: 'peer',
      eligible_for_engagement: true,
      last_seen_at: '2026-10-28T00:00:00.000Z',
    }],
  });
});

describe('generateNetworkActionCandidates — intent the lock can read', () => {
  it('writes primary_intent, the field the observation lock and the playbook gate read', async () => {
    const row = await writtenRow();
    expect(row.intent_classification).toMatchObject({ type: 'network_expansion', primary_intent: 'network_expansion' });
  });

  it('a written row is refused by the observation lock, approved or not', async () => {
    const row = await writtenRow();
    const verdict = await enginePreflight({ ...row, status: 'approved', approved_at: '2026-10-28T08:00:00.000Z' }, openGates);
    expect(verdict).toMatchObject({ allowed: false, code: 'PHASE_5B_OBSERVATION_LOCK', disposition: 'needs_human' });
  });
});
