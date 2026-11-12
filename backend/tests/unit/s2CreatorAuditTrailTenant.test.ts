/**
 * S2 tenant seam - creatorAuditTrailService forensic readers (e1). getAuditHistoryForPlan /
 * getAuditHistoryForScheduledPost take the caller's TenantContext and read creator_audit_log UNDER it.
 *
 * Cross-tenant negative: company B (and a NULL-company entry) have audit rows for the SAME plan id and the
 * SAME scheduled-post id; A's history never includes them. The fake applies every filter.
 */
type Row = Record<string, unknown>;
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => require('../helpers/fakeWhatsappDb').fakeTable(t),
  ownedDbRpc: async () => ({ data: null, error: null }),
}));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => require('../helpers/fakeWhatsappDb').fakeTable(t) } }));
jest.mock('../../services/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('../../services/creatorOperationalTelemetryService', () => ({ getCurrentTrace: () => null }));

import { resetFakeDb } from '../helpers/fakeWhatsappDb';
import { tenantContextFor } from '../../db/tenantTable';
import { getAuditHistoryForPlan, getAuditHistoryForScheduledPost } from '../../services/creatorAuditTrailService';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const PLAN = 'dddddddd-0000-4000-8000-000000000004';
const POST = 'eeeeeeee-0000-4000-8000-000000000005';
const tenantA = tenantContextFor({ userId: 'user-a' }, A);
const row = (id: string, company_id: string | null, extra: Row): Row => ({ id, company_id, action: 'upload_completed', created_at: `2026-11-12T00:00:0${id.slice(-1)}Z`, ...extra });

beforeEach(() => {
  resetFakeDb({
    creator_audit_log: [
      row('a1', A, { daily_plan_id: PLAN }),
      row('b2', B, { daily_plan_id: PLAN }),
      row('n3', null, { daily_plan_id: PLAN }),
      row('a4', A, { scheduled_post_id: POST }),
      row('b5', B, { scheduled_post_id: POST }),
    ],
  });
});

it('A\'s plan history excludes B\'s (and NULL-company) entries for the same plan id', async () => {
  const h = await getAuditHistoryForPlan(tenantA, PLAN);
  expect(h.map((r) => r.id)).toEqual(['a1']);
});

it('A\'s scheduled-post history excludes B\'s entries for the same post id', async () => {
  const h = await getAuditHistoryForScheduledPost(tenantA, POST);
  expect(h.map((r) => r.id)).toEqual(['a4']);
});
