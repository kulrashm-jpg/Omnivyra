/**
 * Sales Navigator capture totals -> prospect_capture_runs (usage ledger).
 * PI review: a COMPLETE run replaces; refused/failed never overwrite good totals.
 * Contract §5.3: capture command_id is single-use; a repeat is a retry of the same batch.
 */
const upserts: Array<{ row: Record<string, unknown>; opts: Record<string, unknown> }> = [];
let upsertError: unknown = null;
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => ({
    upsert: async (row: Record<string, unknown>, opts: Record<string, unknown>) => {
      if (table !== 'prospect_capture_runs') throw new Error(`unexpected table ${table}`);
      upserts.push({ row, opts });
      return { error: upsertError };
    },
  }),
}));

import { recordCaptureRun } from '../../services/salesNavCapture/service';

const ctx = { orgId: '00000000-0000-4000-8000-0000000000aa', userId: 'u1', socialAccountId: 's', actingMemberUrn: 'm', commandId: 'cmd-1', extensionVersion: '1.5.0' };
const payload = { leads: [{ lead_key: 'a' }, { lead_key: 'b' }, { lead_key: 'c' }] } as never;
beforeEach(() => { upserts.length = 0; upsertError = null; });

it('a COMPLETE run writes its counts and REPLACES that command\'s row', async () => {
  await recordCaptureRun(ctx, payload, { ok: true, leadKeyProvisional: true, outcomes: [],
    totals: { received: 3, accepted: 2, created: 1, updated: 1, unchanged: 0, duplicatesParked: 0 } }, null);
  expect(upserts[0].row).toMatchObject({
    organization_id: ctx.orgId, provider: 'linkedin_sales_navigator', command_id: 'cmd-1', initiated_by: 'u1',
    status: 'complete', received: 3, accepted: 2, rejected: 1, created: 1, updated: 1, unchanged: 0, duplicates_parked: 0,
  });
  expect(upserts[0].row.completed_at).toEqual(expect.any(String));
  expect(upserts[0].opts).toEqual({ onConflict: 'organization_id,command_id', ignoreDuplicates: false });
});

it('a REFUSED run carries a reason CODE and never overwrites an existing row', async () => {
  await recordCaptureRun(ctx, payload, { ok: false, refusal: 'capture_disabled', leadKeyProvisional: true, outcomes: [] }, null);
  expect(upserts[0].row).toMatchObject({ status: 'refused', refused_reason: 'capture_disabled', received: 3 });
  expect(upserts[0].opts).toMatchObject({ ignoreDuplicates: true });
});

it('a FAILED run (the capture threw) never overwrites an existing row either', async () => {
  await recordCaptureRun(ctx, payload, null, new Error('boom'));
  expect(upserts[0].row).toMatchObject({ status: 'failed', received: 3 });
  expect(upserts[0].opts).toMatchObject({ ignoreDuplicates: true });
});

it('counts and ids only: no lead keys, names or other lead data reach the ledger', async () => {
  await recordCaptureRun(ctx, { leads: [{ lead_key: 'ACwAAAsecret1', full_name: 'Jane Doe' }] } as never,
    { ok: true, leadKeyProvisional: true, outcomes: [{ key: 'ACwAAAsecret1', status: 'created' }],
      totals: { received: 1, accepted: 1, created: 1, updated: 0, unchanged: 0, duplicatesParked: 0 } }, null);
  const json = JSON.stringify(upserts[0].row);
  expect(json).not.toContain('ACwAAAsecret1');
  expect(json).not.toContain('Jane');
});

it('no tenant or no command id: nothing is written (nothing attributable)', async () => {
  await recordCaptureRun({ ...ctx, orgId: '' }, payload, null, null);
  await recordCaptureRun({ ...ctx, commandId: '' }, payload, null, null);
  expect(upserts).toEqual([]);
});

it('a ledger write failure never throws into the capture', async () => {
  upsertError = { code: '23514' };
  await expect(recordCaptureRun(ctx, payload, null, new Error('x'))).resolves.toBeUndefined();
});
