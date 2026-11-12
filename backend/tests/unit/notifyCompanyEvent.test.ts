/**
 * notifyCompanyEvent (6f; e9 recipient ruling 2026-11-13). Company events used to be inserted with columns that do
 * not exist and were silently dropped. Now one row per recipient, resolved at SEND time through ACTIVE memberships
 * of THAT company: every active COMPANY_ADMIN + the campaign creator only while still an active member there.
 * Rows carry company_id and only real notifications columns. Never throws; never silent.
 */
jest.mock('../../db/supabaseClient', () => {
  const from = (t: string) => require('../helpers/fakeWhatsappDb').fakeTable(t);
  return { supabase: { from }, default: { from } };
});

import { fakeDb, resetFakeDb, failNext } from '../helpers/fakeWhatsappDb';
import { notifyCompanyEvent } from '../../services/userNotificationService';

const CO = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ADMIN1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const ADMIN2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const CREATOR = 'cccccccc-0000-4000-8000-000000000001';
const DEPARTED = 'dddddddd-0000-4000-8000-000000000001';
const OUTSIDER = 'eeeeeeee-0000-4000-8000-000000000001';
// The notifications columns (baseline + 20270217000035): anything else is refused by PostgREST.
const COLUMNS = new Set(['id', 'user_id', 'company_id', 'type', 'title', 'message', 'metadata', 'is_read', 'created_at']);

function world() {
  resetFakeDb({
    notifications: [],
    user_company_roles: [
      { user_id: ADMIN1, company_id: CO, role: 'COMPANY_ADMIN', status: 'active' },
      { user_id: ADMIN2, company_id: CO, role: 'company_admin', status: 'active' },   // legacy casing: still an admin
      { user_id: CREATOR, company_id: CO, role: 'CONTENT_CREATOR', status: 'active' },
      { user_id: DEPARTED, company_id: CO, role: 'CONTENT_CREATOR', status: 'inactive' },
      { user_id: 'aaaaaaaa-0000-4000-8000-0000000000ff', company_id: CO, role: 'COMPANY_ADMIN', status: 'invited' },
      { user_id: OUTSIDER, company_id: OTHER, role: 'COMPANY_ADMIN', status: 'active' },
    ],
  });
}
const event = (extra: Record<string, unknown> = {}) => ({
  companyId: CO, type: 'campaign_auto_paused', title: 'Campaign auto-paused', message: '"X" was paused', metadata: { campaign_id: 'c1' }, ...extra,
});
const delivered = () => (fakeDb.tables.notifications ?? []).map((r) => r.user_id).sort();
let err: jest.SpyInstance;
beforeEach(() => { world(); err = jest.spyOn(console, 'error').mockImplementation(() => undefined); });
afterEach(() => err.mockRestore());

it('active admins (any casing) + the active creator, one row each, deduplicated; rows carry company_id and only real columns', async () => {
  const r = await notifyCompanyEvent(event({ campaignCreatorUserId: CREATOR }));
  expect(r).toEqual({ delivered: 3 });
  expect(delivered()).toEqual([ADMIN1, ADMIN2, CREATOR].sort());
  for (const row of fakeDb.tables.notifications) {
    expect(row).toMatchObject({ company_id: CO, type: 'campaign_auto_paused', title: 'Campaign auto-paused', message: '"X" was paused', is_read: false });
    expect(Object.keys(row).every((k) => COLUMNS.has(k))).toBe(true);
  }
});

it('a creator who is also an admin gets ONE row', async () => {
  expect(await notifyCompanyEvent(event({ campaignCreatorUserId: ADMIN1 }))).toEqual({ delivered: 2 });
  expect(delivered()).toEqual([ADMIN1, ADMIN2].sort());
});

it('a DEPARTED creator (membership inactive) gets nothing (e9)', async () => {
  await notifyCompanyEvent(event({ campaignCreatorUserId: DEPARTED }));
  expect(delivered()).not.toContain(DEPARTED);
  expect(delivered()).toEqual([ADMIN1, ADMIN2].sort());
});

it('a "creator" who is a member of ANOTHER company only gets nothing; another company\'s admins get nothing', async () => {
  await notifyCompanyEvent(event({ campaignCreatorUserId: OUTSIDER }));
  expect(delivered()).not.toContain(OUTSIDER);
});

it('invited (not active) admins get nothing', async () => {
  await notifyCompanyEvent(event());
  expect(delivered()).not.toContain('aaaaaaaa-0000-4000-8000-0000000000ff');
});

it('no active recipient: nothing written, logged undeliverable (never silent)', async () => {
  const r = await notifyCompanyEvent(event({ companyId: OTHER.replace('2222', '3333') }));
  expect(r).toEqual({ delivered: 0, undeliverable: 'no_active_recipient' });
  expect(fakeDb.tables.notifications).toEqual([]);
  expect(err).toHaveBeenCalledWith('NOTIFICATION_UNDELIVERABLE', expect.stringContaining('no_active_recipient'));
});

it('an unreadable membership list: nothing written, logged; an insert error: logged - neither throws', async () => {
  failNext('user_company_roles', 'select');
  await expect(notifyCompanyEvent(event())).resolves.toEqual({ delivered: 0, undeliverable: 'membership_unreadable' });
  expect(fakeDb.tables.notifications).toEqual([]);
  failNext('notifications', 'insert');
  await expect(notifyCompanyEvent(event())).resolves.toEqual({ delivered: 0, undeliverable: 'insert_failed' });
  expect(err).toHaveBeenCalledWith('NOTIFICATION_UNDELIVERABLE', expect.stringContaining('insert_failed'));
});

it('no company: refused as invalid input, nothing read', async () => {
  await expect(notifyCompanyEvent(event({ companyId: '  ' }))).resolves.toEqual({ delivered: 0, undeliverable: 'invalid_input' });
  expect(fakeDb.calls).toEqual([]);
});
