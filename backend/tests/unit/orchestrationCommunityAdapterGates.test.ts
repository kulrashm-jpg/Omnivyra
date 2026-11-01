/**
 * Community adapter gates: the claim honours a cancel request and the tenant;
 * a DM the engine refuses, and any RPA action, is refused before anything is
 * claimed. The classifier and the default claim are real; the database is the
 * in-memory fake (helpers/communityExecutionFakeDb), not PostgreSQL.
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

import {
  classifyCommunityAction,
  defaultCommunityDeps,
  type CommunityActionRow,
} from '../../services/orchestration/communityEngineAdapter';

const ORG = 'org-1';
const ACTION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NOW = '2026-10-28T09:00:00.000Z';
const THREAD = 'https://www.linkedin.com/messaging/thread/2-abcdefghijklmnop/';

const row = (over: Partial<CommunityActionRow> = {}): CommunityActionRow => ({
  id: ACTION_ID,
  tenant_id: ORG,
  organization_id: ORG,
  platform: 'linkedin',
  action_type: 'reply',
  target_id: 'urn:li:activity:123',
  suggested_text: 'Thanks for sharing this.',
  status: 'approved',
  approved_at: '2026-10-28T08:00:00.000Z',
  execution_mode: 'api',
  ...over,
});

const seed = (over: Record<string, unknown> = {}) => {
  mockDb = createFakeDb({ community_ai_actions: [{ ...row(), cancel_requested_at: null, ...over }] });
};
const stored = () => mockDb.tables.community_ai_actions[0];

describe('G-6: the default claim is the engine claim', () => {
  it('claims an approved action of this tenant', async () => {
    seed();
    expect(await defaultCommunityDeps.claimAction(ORG, ACTION_ID, NOW)).toBe(true);
    expect(stored().status).toBe('executing');
  });

  it('does not claim an action with a cancel request', async () => {
    seed({ cancel_requested_at: NOW });
    expect(await defaultCommunityDeps.claimAction(ORG, ACTION_ID, NOW)).toBe(false);
    expect(stored().status).toBe('approved');
  });

  it('does not claim an action whose tenant_id disagrees', async () => {
    seed({ tenant_id: 'org-other' });
    expect(await defaultCommunityDeps.claimAction(ORG, ACTION_ID, NOW)).toBe(false);
    expect(stored().status).toBe('approved');
  });
});

describe('G-7: a DM the engine refuses is refused before the claim', () => {
  it.each([
    ['linkedin thread', { platform: 'linkedin', target_id: THREAD }, 'DM_RECIPIENT_MAPPING_UNAVAILABLE'],
    ['twitter handle', { platform: 'twitter', target_id: 'some.handle' }, 'DM_RECIPIENT_MAPPING_UNAVAILABLE'],
    ['instagram thread', { platform: 'instagram', target_id: 'https://www.instagram.com/direct/t/1234567/' }, 'INSTAGRAM_DM_ACCOUNT_TIER_UNVERIFIED'],
  ] as [string, Partial<CommunityActionRow>, string][])('%s', (_name, over, code) => {
    const v = classifyCommunityAction(row({ action_type: 'dm', execution_mode: 'browser', ...over }));
    expect(v).toMatchObject({ supported: false, code: `dm_refused:${code}` });
  });

  it('keeps the specific target refusal for an unaddressed DM', () => {
    const v = classifyCommunityAction(row({ action_type: 'dm', execution_mode: 'browser', target_id: 'Jane Doe' }));
    expect(v).toMatchObject({ supported: false, code: 'unsupported_dm_target' });
  });
});

describe('GAP-02: no journey action runs through RPA until the acting account is proven', () => {
  it.each([
    ['reply', 'linkedin'],
    ['like', 'reddit'],
    ['share', 'twitter'],
    ['follow', 'twitter'],
  ])('%s on %s via rpa is refused', (action_type, platform) => {
    const v = classifyCommunityAction(row({ action_type, platform, execution_mode: 'rpa' }));
    expect(v).toMatchObject({ supported: false, code: 'unsupported_mode:rpa' });
  });

  it('is case-insensitive, like the manual refusal', () => {
    expect(classifyCommunityAction(row({ execution_mode: 'RPA' }))).toMatchObject({ supported: false, code: 'unsupported_mode:rpa' });
  });

  it('leaves api, browser and an undeclared mode as they are', () => {
    for (const execution_mode of ['api', 'browser', null]) {
      expect(classifyCommunityAction(row({ execution_mode })).supported).toBe(true);
    }
  });
});
