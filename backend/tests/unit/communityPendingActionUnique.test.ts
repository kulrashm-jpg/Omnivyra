/**
 * CLASS-2 (migration 20270217000008, community_ai_actions_one_pending): at most ONE pending action
 * per (tenant, organization, platform, action_type, target). Writers read "is one pending?" and then
 * insert; two concurrent writers both read "no" - the index now refuses the second (23505) and each
 * writer treats that as "already pending":
 *   - the auto-rule writer returns the EXISTING pending row (the same action, not null);
 *   - the network-candidate batch (all-or-nothing) falls back to row-by-row and skips duplicates.
 * The fake enforces the index exactly (partial, composite, NULLS NOT DISTINCT) and inserts a batch
 * all-or-nothing, as PostgreSQL does. The index itself is replayed on PostgreSQL.
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
jest.mock('../../services/rpaWorker/rpaWorkerService', () => ({
  executeRpaTask: jest.fn(() => { throw new Error('RPA must not be reached from a unit test'); }),
}));
jest.mock('../../services/playbooks/playbookService', () => ({
  getPlaybookById: async () => ({
    id: 'pb-1', name: 'Network', execution_modes: { api_allowed: true },
    network_eligibility: { enabled: true, allowed_classifications: ['peer'], allowed_actions: ['like'], max_new_users_per_day: 5 },
  }),
}));

import { __resolveActionRecordForTests as resolveActionRecord } from '../../services/communityAiAutoRuleService';
import { generateNetworkActionCandidates } from '../../services/networkExpansion/networkActionCandidateService';

const ORG = 'org-1';
const ONE_PENDING = {
  cols: ['tenant_id', 'organization_id', 'platform', 'action_type', 'target_id'],
  where: (r: Record<string, any>) => r.status === 'pending',
};
const pendingOf = (target: string) => mockDb.tables.community_ai_actions.filter((r) => r.status === 'pending' && r.target_id === target);

const suggestion = (over: Record<string, any> = {}) => ({
  platform: 'LinkedIn', action_type: 'Reply', target_id: 'urn:li:comment:1', suggested_text: 'Thanks!',
  playbook_id: 'pb-1', playbook_name: 'P', intent_classification: { primary_intent: 'x' }, execution_mode: 'manual',
  execution_modes_config: { manual: true }, tone_used: 'warm', ...over,
});

let warn: jest.SpyInstance;
beforeEach(() => {
  mockDb = createFakeDb({ community_ai_actions: [] });
  mockDb.uniqueIndexes.community_ai_actions = [ONE_PENDING];
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('auto-rule writer (resolveActionRecord)', () => {
  it('two CONCURRENT evaluations of the same suggestion -> ONE pending row, and BOTH get that row (never null)', async () => {
    const [a, b] = await Promise.all([
      resolveActionRecord(ORG, ORG, suggestion(), 'pending'),
      resolveActionRecord(ORG, ORG, suggestion(), 'pending'),
    ]);
    expect(pendingOf('urn:li:comment:1')).toHaveLength(1);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect((a as any).id).toBe((b as any).id);
  });

  it('a non-duplicate insert failure is REPORTED and answers null (not a silent null)', async () => {
    mockDb.statusCheck.community_ai_actions = new Set(['approved']); // 'pending' violates the CHECK -> 23514
    expect(await resolveActionRecord(ORG, ORG, suggestion(), 'pending')).toBeNull();
    expect(warn).toHaveBeenCalledWith('[communityAiAutoRule] action record not created', expect.objectContaining({ code: '23514' }));
  });

  it('CONTROL: different targets are independent - two rows', async () => {
    await Promise.all([
      resolveActionRecord(ORG, ORG, suggestion({ target_id: 't-a' }), 'pending'),
      resolveActionRecord(ORG, ORG, suggestion({ target_id: 't-b' }), 'pending'),
    ]);
    expect(mockDb.tables.community_ai_actions).toHaveLength(2);
  });
});

describe('network-candidate batch writer', () => {
  const user = (id: string, url: string) => ({
    id, tenant_id: ORG, organization_id: ORG, platform: 'linkedin', profile_url: url,
    classification: 'peer', eligible_for_engagement: true, last_seen_at: '2026-10-28T00:00:00.000Z',
  });

  it('a concurrent run already created ONE of the batch\'s pending actions -> the rest are still created, the duplicate skipped', async () => {
    mockDb.tables.community_ai_discovered_users = [user('du-1', 'https://www.linkedin.com/in/a'), user('du-2', 'https://www.linkedin.com/in/b')];
    // Written by a concurrent run AFTER this run's dedupe read (it carries no discovered_user_id link
    // this run's dedupe could see) - exactly the window the index closes.
    mockDb.tables.community_ai_actions.push({ id: 'other-run', tenant_id: ORG, organization_id: ORG, platform: 'linkedin', action_type: 'like', target_id: 'https://www.linkedin.com/in/a', status: 'pending' });
    const out = await generateNetworkActionCandidates({ tenant_id: ORG, organization_id: ORG, playbook_id: 'pb-1' });
    expect(out).toMatchObject({ created_count: 1, skipped_count: 1 });
    expect(pendingOf('https://www.linkedin.com/in/a')).toHaveLength(1);
    expect(pendingOf('https://www.linkedin.com/in/b')).toHaveLength(1);
  });

  it('CONTROL: no conflict -> the batch is written in one insert', async () => {
    mockDb.tables.community_ai_discovered_users = [user('du-1', 'https://www.linkedin.com/in/a'), user('du-2', 'https://www.linkedin.com/in/b')];
    const out = await generateNetworkActionCandidates({ tenant_id: ORG, organization_id: ORG, playbook_id: 'pb-1' });
    expect(out).toMatchObject({ created_count: 2, skipped_count: 0 });
    expect(mockDb.ops.filter((o) => o.op === 'insert')).toHaveLength(2); // the two rows of ONE batch insert
  });
});
