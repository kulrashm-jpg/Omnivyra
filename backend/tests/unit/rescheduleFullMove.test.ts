/**
 * Strategic Mix R2-P3 — Full-Move Rescheduling contract.
 *
 *  - legacy requests (no move fields) stay byte-identical: no lock-guard
 *    call, no occupancy query, no `moved` response key
 *  - moves require a landing time + the 1h minimum window
 *  - movement eligibility delegates to the EXISTING blueprint lock guard
 *    (affectedSlots = the row's execution_id) — lock logic never duplicated
 *  - platform capability fail-closed; one-post-per-platform-per-day;
 *    platform moves re-resolve the social account and re-enqueue against it
 *  - week/day/slot moves update only the canonical records
 */

import {
  idempotencyHeaders,
  makeAssertable,
  resetIdempotency,
  withIdempotencyTable,
} from '../utils/idempotency';

// WS1-E6-T006: this endpoint adopted the caller-scoped withIdempotency
// middleware. AUTHENTICATION only — the endpoint's own authorization still
// runs inside the handler and is still asserted below.
jest.mock('../../security/IdentityResolver', () =>
  require('../utils/idempotency').identityResolverMock());


function createRes() {
  return {
    statusCode: 200,
    body: null as any,
    status: jest.fn(function status(this: any, code: number) { this.statusCode = code; return this; }),
    json: jest.fn(function json(this: any, body: unknown) { this.body = body; return this; }),
    setHeader: jest.fn(),
  };
}

type Row = Record<string, any>;
let planRow: Row | null = null;
let occupantRows: Row[] = [];
let socialAccountRow: Row | null = null;
const ownedUpdates: Array<{ table: string; payload: Row; filter: Row }> = [];

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: jest.fn((table: string) => {
      const filters: Row = {};
      const api: any = {
        select: jest.fn(() => api),
        eq: jest.fn((k: string, v: any) => { filters[k] = v; return api; }),
        neq: jest.fn((k: string, v: any) => { filters[`neq:${k}`] = v; return api; }),
        in: jest.fn((k: string, v: any) => { filters[`in:${k}`] = v; return api; }),
        limit: jest.fn(() => api),
        maybeSingle: jest.fn(async () => {
          if (table === 'daily_content_plans') return { data: planRow, error: null };
          if (table === 'campaigns') return { data: { company_id: 'company-1' }, error: null };
          if (table === 'scheduled_posts') return { data: { user_id: 'user-1', social_account_id: 'sa-old' }, error: null };
          if (table === 'social_accounts') return { data: socialAccountRow, error: null };
          return { data: null, error: null };
        }),
        then(resolve: any) {
          const data = table === 'daily_content_plans' && filters['neq:id'] !== undefined ? occupantRows : [];
          return Promise.resolve({ data, error: null }).then(resolve);
        },
      };
      return api;
    }),
    storage: { from: jest.fn(() => ({ remove: jest.fn(async () => ({ data: null, error: null })) })) },
  },
}));

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: jest.fn(require('../utils/idempotency').withIdempotencyTable((table: string) => {
    let updatePayload: Row | null = null;
    const filters: Row = {};
    const api: any = {
      select: jest.fn(() => api),
      eq: jest.fn((k: string, v: any) => { filters[k] = v; return api; }),
      update: jest.fn((p: Row) => { updatePayload = p; return api; }),
      then(resolve: any) {
        if (updatePayload) ownedUpdates.push({ table, payload: updatePayload, filter: { ...filters } });
        return Promise.resolve({ data: null, error: null }).then(resolve);
      },
    };
    return api;
  })),
}));

jest.mock('../../services/userContextService', () => ({
  enforceCompanyAccess: jest.fn(async () => ({ userId: 'user-1', companyId: 'company-1' })),
}));
jest.mock('../../services/mediaUploadValidationService', () => ({
  validateMediaUpload: jest.fn(async () => ({ valid: true, validated_at: 'now', details: {} })),
}));
jest.mock('../../services/creatorOperationalTelemetryService', () => ({
  emitCreatorEvent: jest.fn(),
  CREATOR_EVENTS: new Proxy({}, { get: (_t, key) => String(key) }),
}));
jest.mock('../../services/creatorAuditTrailService', () => ({ recordAuditEntry: jest.fn() }));

const atomicCalls: Array<Row> = [];
jest.mock('../../scheduler/schedulerService', () => ({
  cancelScheduledPostQueueEntry: jest.fn(async () => ({ db_cancelled: 1, queue_removed: 1, errors: [] })),
  enqueueScheduledPostAt: jest.fn(async () => 'enqueued'),
  atomicCancelAndReEnqueueScheduledPost: jest.fn(async (input: Row) => {
    atomicCalls.push(input);
    return { ok: true, locked: true, enqueue: 'enqueued', cancel: {}, idempotency_key: 'k' };
  }),
}));

// Lock guard: DELEGATED, never duplicated — the mock captures the call and
// throws whatever the test configures. The guard's own matrix lives in
// blueprintLockCharacterization.test.ts.
const guardCalls: Array<{ campaignId: string; options: unknown }> = [];
let guardThrows: Error | null = null;
jest.mock('../../services/campaignBlueprintService', () => {
  class BlueprintImmutableError extends Error { code = 'BLUEPRINT_IMMUTABLE'; }
  class BlueprintExecutionFreezeError extends Error {
    code = 'EXECUTION_WINDOW_FROZEN';
    hoursUntilExecution = 2;
    freezeWindowHours = 24;
  }
  return {
    BlueprintImmutableError,
    BlueprintExecutionFreezeError,
    assertBlueprintMutable: jest.fn(async (campaignId: string, options: unknown) => {
      guardCalls.push({ campaignId, options });
      if (guardThrows) throw guardThrows;
    }),
  };
});

import handler from '../../../pages/api/activity-workspace/[id]/reschedule';
import {
  BlueprintExecutionFreezeError,
  BlueprintImmutableError,
} from '../../services/campaignBlueprintService';

const HOUR = 3600000;
const future = (hours: number) => new Date(Date.now() + hours * HOUR).toISOString();

function setRow(over: Row = {}) {
  planRow = {
    id: 'plan-1',
    campaign_id: 'campaign-1',
    content_type: 'reel',
    content: {
      creator_lifecycle_state: 'scheduled',
      scheduled_post_id: 'sp-1',
      creator_lifecycle_history: [{ to: 'a' }, { to: 'b' }],
    },
    content_status: 'scheduled',
    platform: 'instagram',
    scheduled_time: '10:00',
    date: '2026-08-01',
    execution_id: 'ex-9',
    week_number: 2,
    ...over,
  };
}

async function post(body: Row) {
  const res = makeAssertable(createRes());
  await handler({ method: 'POST', headers: idempotencyHeaders(), query: { id: 'plan-1' }, body } as any, res as any);
  return res;
}

beforeEach(() => {
    resetIdempotency();
  setRow();
  occupantRows = [];
  socialAccountRow = { id: 'sa-new' };
  ownedUpdates.length = 0;
  atomicCalls.length = 0;
  guardCalls.length = 0;
  guardThrows = null;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('legacy byte-identity', () => {
  it('retime-only requests never touch the guard, occupancy, or `moved` key', async () => {
    const res = await post({ scheduled_at: future(0.2) }); // 12 min out — legacy allows
    expect(res.statusCode).toBe(200);
    expect(guardCalls).toHaveLength(0);
    expect('moved' in res.body).toBe(false);
    expect(res.body.queue).toBe('re_enqueued');
  });
});

describe('move validation — deterministic failures', () => {
  it('moves require scheduled_at and the 1h floor', async () => {
    let res = await post({ platform: 'tiktok' });
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('MOVE_REQUIRES_TIME');

    res = await post({ platform: 'tiktok', scheduled_at: future(0.2) });
    expect(res.statusCode).toBe(422);
    expect(res.body.code).toBe('MOVE_SCHEDULE_FLOOR');
  });

  it('unknown platform / incompatible capability fail closed', async () => {
    let res = await post({ platform: 'myspace', scheduled_at: future(48) });
    expect(res.statusCode).toBe(422);
    expect(res.body.code).toBe('MOVE_UNSUPPORTED_PLATFORM');

    // reel → 'creator' capability; linkedin does not publish creator content
    res = await post({ platform: 'linkedin', scheduled_at: future(48) });
    expect(res.statusCode).toBe(422);
    expect(res.body.code).toBe('MOVE_PLATFORM_INCOMPATIBLE');
    expect(ownedUpdates).toHaveLength(0); // nothing written on rejection
  });

  it('invalid week / day are rejected before any read', async () => {
    expect((await post({ week_number: 0, scheduled_at: future(48) })).body.code).toBe('MOVE_INVALID_WEEK');
    expect((await post({ day_of_week: 'Someday', scheduled_at: future(48) })).body.code).toBe('MOVE_INVALID_DAY');
  });

  it('movement eligibility delegates to the blueprint guard with the row\'s slot', async () => {
    guardThrows = new BlueprintExecutionFreezeError('frozen');
    let res = await post({ week_number: 3, scheduled_at: future(48) });
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('MOVE_FREEZE_WINDOW');
    expect(res.body.freeze_window_hours).toBe(24);
    expect(guardCalls[0]).toEqual({ campaignId: 'campaign-1', options: { affectedSlots: ['ex-9'] } });

    guardThrows = new BlueprintImmutableError('locked');
    res = await post({ week_number: 3, scheduled_at: future(48) });
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('MOVE_ITEM_LOCKED');
    expect(ownedUpdates).toHaveLength(0); // locked items are never written
  });

  it('one post per platform per day: occupied target slot rejects', async () => {
    occupantRows = [{ id: 'plan-other' }];
    const res = await post({ day_of_week: 'Tuesday', scheduled_at: future(48) });
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('MOVE_SLOT_OCCUPIED');
    expect(res.body.conflicting_row_id).toBe('plan-other');
  });

  it('platform move without a connected account rejects', async () => {
    socialAccountRow = null;
    const res = await post({ platform: 'tiktok', scheduled_at: future(48) });
    expect(res.statusCode).toBe(422);
    expect(res.body.code).toBe('MOVE_NO_CONNECTED_ACCOUNT');
  });
});

describe('move application — canonical records only', () => {
  it('combined move: plan row, scheduled post, queue, and response all reflect the move', async () => {
    const landing = future(48);
    const res = await post({
      platform: 'tiktok',
      week_number: 3,
      day_of_week: 'Wednesday',
      publication_slot: 'primary',
      scheduled_at: landing,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.moved).toEqual({
      platform: 'tiktok',
      week_number: 3,
      day_of_week: 'Wednesday',
      publication_slot: 'primary',
      social_account_id: 'sa-new',
    });

    const planPatch = ownedUpdates.find((u) => u.table === 'daily_content_plans')!;
    expect(planPatch.payload).toMatchObject({
      platform: 'tiktok',
      week_number: 3,
      day_of_week: 'Wednesday',
      date: landing.slice(0, 10),
      scheduled_time: landing.slice(11, 16),
    });
    const content = JSON.parse(planPatch.payload.content);
    expect(content.publication_slot).toBe('primary');
    expect(content.move_history).toHaveLength(1);
    expect(content.move_history[0].from).toMatchObject({ platform: 'instagram', week_number: 2 });
    expect(content.move_history[0].to).toMatchObject({ platform: 'tiktok', week_number: 3 });

    const postPatch = ownedUpdates.find((u) => u.table === 'scheduled_posts')!;
    expect(postPatch.payload).toMatchObject({
      platform: 'tiktok',
      social_account_id: 'sa-new',
      scheduled_for: landing,
    });

    // queue re-enqueued via the EXISTING atomic path, against the NEW account
    expect(atomicCalls).toEqual([
      expect.objectContaining({
        scheduledPostId: 'sp-1',
        socialAccountId: 'sa-new',
        newScheduledFor: landing,
        reason: 'reschedule_full_move',
      }),
    ]);
  });

  it('week/day move on an unscheduled (ready_for_schedule, no post) row touches only the plan row', async () => {
    setRow({
      content: { creator_lifecycle_state: 'ready_for_schedule', creator_lifecycle_history: [{ to: 'a' }] },
      content_status: 'ready_for_schedule',
    });
    const res = await post({ week_number: 4, day_of_week: 'Friday', scheduled_at: future(48) });
    expect(res.statusCode).toBe(200);
    expect(res.body.moved).toMatchObject({ week_number: 4, day_of_week: 'Friday' });
    expect(ownedUpdates.some((u) => u.table === 'scheduled_posts')).toBe(false);
    expect(atomicCalls).toHaveLength(0);
    const planPatch = ownedUpdates.find((u) => u.table === 'daily_content_plans')!;
    expect(planPatch.payload).toMatchObject({ week_number: 4, day_of_week: 'Friday' });
  });

  it('same-platform move (week/day only) never re-resolves the account or changes post platform', async () => {
    const res = await post({ week_number: 5, scheduled_at: future(48) });
    expect(res.statusCode).toBe(200);
    const postPatch = ownedUpdates.find((u) => u.table === 'scheduled_posts')!;
    expect('platform' in postPatch.payload).toBe(false);
    expect('social_account_id' in postPatch.payload).toBe(false);
    expect(atomicCalls[0].socialAccountId).toBe('sa-old'); // prior account kept
  });
});
