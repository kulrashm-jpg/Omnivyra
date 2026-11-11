/**
 * Prompt 3 — POST /api/community-ai/actions { status: 'skipped' }, the real handler.
 * The skip is a tenant-scoped compare-and-set: only a row nobody is executing or
 * holding (pending / approved / scheduled, no extension lease) is skipped. An
 * executing, leased or ended row (including 'uncertain', which may have acted) is
 * never overwritten: 409 ACTION_NOT_SKIPPABLE with the row's status.
 */
import { createFakeDb, type FakeDb } from './helpers/communityExecutionFakeDb';

let mockDb: FakeDb = createFakeDb();
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => mockDb.from(t) } }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../../pages/api/community-ai/utils', () => ({
  requireTenantScope: jest.fn(async () => ({ tenantId: 'org-1', organizationId: 'org-1' })),
  enforceActionRole: jest.fn(async () => ({ userId: 'human-1', role: 'admin' })),
  resolveActionRole: jest.fn(() => 'admin'),
}));
jest.mock('../../services/communityAiActionLogService', () => ({ logCommunityAiActionEvent: jest.fn(async () => undefined) }));
jest.mock('../../services/communityAiNotificationService', () => ({ notifyCommunityAiBulk: jest.fn(async () => undefined) }));
jest.mock('../../services/communityAiWebhookService', () => ({ sendCommunityAiWebhooks: jest.fn(async () => undefined) }));

import handler from '../../../pages/api/community-ai/actions';
import { logCommunityAiActionEvent } from '../../services/communityAiActionLogService';

const ID = 'act-1';
const seed = (over: Record<string, unknown> = {}) => {
  mockDb = createFakeDb({
    community_ai_actions: [{ id: ID, tenant_id: 'org-1', organization_id: 'org-1', status: 'pending', dispatch_lease_id: null, ...over }],
  });
};
const skip = async () => {
  const res: any = { statusCode: 0, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  await (handler as any)({ method: 'POST', headers: {}, query: {}, body: { action_id: ID, status: 'skipped' } }, res);
  return res as { statusCode: number; body: any };
};
const status = () => mockDb.tables.community_ai_actions[0].status;

beforeEach(() => (logCommunityAiActionEvent as jest.Mock).mockClear());

describe('skip is a tenant-scoped compare-and-set', () => {
  it.each(['pending', 'approved', 'scheduled'])('%s, unleased -> skipped', async (s) => {
    seed({ status: s });
    const r = await skip();
    expect([r.statusCode, r.body.status]).toEqual([200, 'skipped']);
    expect(status()).toBe('skipped');
    expect(logCommunityAiActionEvent).toHaveBeenCalledTimes(1);
  });

  it.each(['executing', 'executed', 'sent_unverified', 'failed', 'uncertain', 'dispatched'])(
    '%s is never overwritten -> 409 ACTION_NOT_SKIPPABLE',
    async (s) => {
      seed({ status: s });
      const r = await skip();
      expect(r.statusCode).toBe(409);
      expect(r.body).toEqual({ error: 'ACTION_NOT_SKIPPABLE', current_status: s });
      expect(status()).toBe(s);
      expect(logCommunityAiActionEvent).not.toHaveBeenCalled();
    },
  );

  it('a leased browser command (pending + lease) is not skipped', async () => {
    seed({ status: 'pending', dispatch_lease_id: 'lease-1' });
    const r = await skip();
    expect(r.statusCode).toBe(409);
    expect(status()).toBe('pending');
  });

  it('another tenant\'s row -> 403 and untouched', async () => {
    seed({ tenant_id: 'org-2', organization_id: 'org-2' });
    const r = await skip();
    expect(r.statusCode).toBe(403);
    expect(status()).toBe('pending');
  });
});
