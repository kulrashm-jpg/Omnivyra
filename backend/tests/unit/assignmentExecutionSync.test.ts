/**
 * Strategic Mix P5 — Execution Lifecycle Synchronization contract.
 *
 *  - each execution event drives its transition (scheduled / publishing /
 *    published / archived) through the forward-only lifecycle
 *  - publish failure never destroys lifecycle — represented separately,
 *    cleared by a later success
 *  - idempotent replay (object identity preserved), out-of-order safety,
 *    repeated events safe
 *  - execution never modifies planning-owned fields; planner locks hold
 *  - event derivation from the engine's EXISTING records (plan rows +
 *    scheduled posts + campaign completion) — state always re-derivable
 *  - the tenant-guarded route derives events read-only
 */

type Row = Record<string, unknown>;
let campaignRow: Row | null = null;
let planRows: Row[] = [];
let postRows: Row[] = [];
let versionRow: { id: string; campaign_snapshot: Row } | null = null;
let versionUpdateRejected = false; // simulate a concurrent revision move
const versionUpdates: Array<{ payload: Row; filters: Array<[string, unknown]> }> = [];

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      const builder: any = {};
      for (const op of ['select', 'eq', 'order', 'limit']) builder[op] = () => builder;
      builder.maybeSingle = () =>
        Promise.resolve({
          data: table === 'campaigns' ? campaignRow : table === 'campaign_versions' ? versionRow : null,
          error: null,
        });
      builder.update = (payload: Row) => {
        const record = { payload, filters: [] as Array<[string, unknown]> };
        if (table === 'campaign_versions') versionUpdates.push(record);
        const upd: any = {
          eq: (col: string, val: unknown) => { record.filters.push([col, val]); return upd; },
          select: () =>
            Promise.resolve({
              data: versionUpdateRejected ? [] : [{ id: versionRow?.id ?? 'v-1' }],
              error: null,
            }),
        };
        return upd;
      };
      builder.then = (res: any) =>
        Promise.resolve({
          data: table === 'daily_content_plans' ? planRows : table === 'scheduled_posts' ? postRows : [],
          error: null,
        }).then(res);
      return builder;
    },
  },
}));
jest.mock('../../security/TenantGuard', () => ({
  requireCampaignTenantAccess: jest.fn(async () => ({ userId: 'u-1', organizationId: 'co-1', bypass: false })),
}));

import {
  applyExecutionEvents,
  deriveExecutionEvents,
  type ExecutionEvent,
} from '../../../lib/campaign/assignmentExecutionSync';
import {
  assignAsset,
  advanceAssignmentStatus,
  deriveStructureSlots,
  isAssignmentLocked,
  normalizeAssignments,
  updateAssignmentMetadata,
  unassignAssignment,
  type CampaignAssignment,
} from '../../../lib/campaign/campaignAssignments';
import { assessExecutionReadiness } from '../../../lib/campaign/assignmentIntelligence';
import eventsHandler from '../../../pages/api/campaigns/[id]/assignment-execution-events';

const slots = deriveStructureSlots({
  days: [{ week_number: 1, day: 'Monday', activities: [
    { execution_id: 'ex-1', platform: 'linkedin', content_type: 'carousel', title: 'A' },
    { execution_id: 'ex-2', platform: 'x', content_type: 'image', title: 'B' },
  ] }],
});

const freshCtx = () => { let i = 0; return { now: '2026-07-11T10:00:00.000Z', mintId: () => `asg-${++i}` }; };

function materialized(): CampaignAssignment[] {
  const ctx = freshCtx();
  let list = assignAsset([], { campaignId: 'camp-1', assetId: 'car-1', slot: slots[0], status: 'confirmed' }, ctx).assignments;
  list = assignAsset(list, { campaignId: 'camp-1', assetId: 'img-1', slot: slots[1], status: 'confirmed' }, ctx).assignments;
  return advanceAssignmentStatus(list, list.map((a) => a.id), 'materialized', ctx);
}

const ev = (type: ExecutionEvent['type'], executionId: string, over: Partial<ExecutionEvent> = {}): ExecutionEvent => ({
  type, execution_id: executionId, scheduled_post_id: 'sp-1', campaign_id: 'camp-1', ...over,
});

describe('transitions — execution events drive the execution-owned chain', () => {
  it('scheduled → publishing → published → archived, with post id captured', () => {
    let list = materialized();
    list = applyExecutionEvents(list, [ev('scheduled_post_created', 'ex-1')]).assignments;
    expect(list[0]).toMatchObject({ status: 'scheduled', scheduled_post_id: 'sp-1' });
    expect(list[1].status).toBe('materialized'); // unaffected sibling untouched

    list = applyExecutionEvents(list, [ev('publish_started', 'ex-1')]).assignments;
    expect(list[0].status).toBe('publishing');
    list = applyExecutionEvents(list, [ev('publish_completed', 'ex-1', { occurred_at: '2026-07-12T08:00:00Z' })]).assignments;
    expect(list[0].status).toBe('published');
    list = applyExecutionEvents(list, [ev('archive_completed', 'ex-1')]).assignments;
    expect(list[0].status).toBe('archived');
  });

  it('publish failure preserves lifecycle and is represented separately; later success clears it', () => {
    let list = materialized();
    list = applyExecutionEvents(list, [
      ev('scheduled_post_created', 'ex-1'),
      ev('publish_failed', 'ex-1', { error_message: 'LinkedIn 401', error_code: 'AUTH', occurred_at: '2026-07-12T08:00:00Z' }),
    ]).assignments;
    expect(list[0].status).toBe('scheduled'); // lifecycle NOT destroyed
    expect(list[0].execution_failure).toMatchObject({ message: 'LinkedIn 401', code: 'AUTH' });

    list = applyExecutionEvents(list, [ev('publish_completed', 'ex-1', { occurred_at: '2026-07-12T09:00:00Z' })]).assignments;
    expect(list[0].status).toBe('published');
    expect(list[0].execution_failure).toBeNull(); // retry landed — failure cleared
  });

  it('idempotent replay: same events → zero changes, same object identities', () => {
    const list = materialized();
    const events = [ev('scheduled_post_created', 'ex-1'), ev('publish_completed', 'ex-1', { occurred_at: '2026-07-12T08:00:00Z' })];
    const once = applyExecutionEvents(list, events, { now: '2026-07-12T10:00:00Z' });
    const twice = applyExecutionEvents(once.assignments, events, { now: '2026-07-12T11:00:00Z' });
    expect(once.changed_ids).toEqual([list[0].id]);
    expect(twice.changed_ids).toEqual([]);
    expect(twice.assignments).toBe(once.assignments); // untouched — identity preserved
  });

  it('out-of-order and repeated events converge (forward-only, deterministic sort)', () => {
    const list = materialized();
    const shuffled = [
      ev('publish_completed', 'ex-1', { occurred_at: '2026-07-12T09:00:00Z' }),
      ev('scheduled_post_created', 'ex-1'),
      ev('publish_failed', 'ex-1', { occurred_at: '2026-07-12T08:00:00Z', error_message: 'transient' }),
      ev('publish_started', 'ex-1'),
      ev('scheduled_post_created', 'ex-1'), // repeat
    ];
    const a = applyExecutionEvents(list, shuffled).assignments;
    const b = applyExecutionEvents(list, [...shuffled].reverse()).assignments;
    expect(a[0].status).toBe('published');
    expect(a[0].execution_failure ?? null).toBeNull(); // completed (09:00) supersedes failure (08:00)
    expect(b[0].status).toBe(a[0].status);
    expect(b[0].execution_failure ?? null).toEqual(a[0].execution_failure ?? null);
    // late-arriving downgrade event can never regress
    expect(applyExecutionEvents(a, [ev('scheduled_post_created', 'ex-1')]).assignments[0].status).toBe('published');
  });
});

describe('state ownership — sync writes execution fields only; locks hold', () => {
  it('execution never modifies planning-owned fields', () => {
    const list = materialized();
    const before = list[0];
    const after = applyExecutionEvents(list, [ev('scheduled_post_created', 'ex-1')]).assignments[0];
    for (const field of ['asset_id', 'asset_version', 'structure_id', 'week', 'day', 'platform', 'content_type', 'slot', 'notes', 'ordering', 'campaign_id', 'created_at'] as const) {
      expect(after[field]).toEqual(before[field]);
    }
  });

  it('synced items stay locked against planner edits; sync never weakens locks', () => {
    const list = applyExecutionEvents(materialized(), [ev('scheduled_post_created', 'ex-1')]).assignments;
    expect(isAssignmentLocked(list[0])).toBe(true);
    expect(updateAssignmentMetadata(list, list[0].id, { notes: 'x', status: 'draft' })[0]).toMatchObject({ notes: '', status: 'scheduled' });
    expect(unassignAssignment(list, list[0].id)).toHaveLength(2);
  });

  it('execution fields survive planner/campaign reload (normalize round-trip)', () => {
    const list = applyExecutionEvents(materialized(), [
      ev('scheduled_post_created', 'ex-1'),
      ev('publish_failed', 'ex-1', { error_message: 'boom', occurred_at: '2026-07-12T08:00:00Z' }),
    ]).assignments;
    const reloaded = normalizeAssignments(JSON.parse(JSON.stringify(list)));
    expect(reloaded[0].scheduled_post_id).toBe('sp-1');
    expect(reloaded[0].execution_failure).toMatchObject({ message: 'boom' });
    expect(reloaded[0].status).toBe('scheduled');
  });

  it('legacy assignments (planning states, no execution fields) are untouched by empty syncs', () => {
    const ctx = freshCtx();
    const legacy = assignAsset([], { campaignId: 'c', assetId: 'a', slot: slots[0] }, ctx).assignments;
    const result = applyExecutionEvents(legacy, []);
    expect(result.assignments).toBe(legacy);
    expect('scheduled_post_id' in result.assignments[0]).toBe(false);
  });
});

describe('deriveExecutionEvents — events from the engine’s EXISTING records', () => {
  it('maps post statuses to the event vocabulary; cancelled/draft posts emit nothing', () => {
    const events = deriveExecutionEvents({
      campaignId: 'camp-1',
      planRows: [
        { execution_id: 'ex-1', scheduled_post_id: 'sp-1', content_status: 'scheduled' },
        { execution_id: 'ex-2', scheduled_post_id: 'sp-2', content_status: 'scheduled' },
        { execution_id: 'ex-3', scheduled_post_id: 'sp-3', content_status: 'scheduled' },
        { execution_id: 'ex-4', scheduled_post_id: 'sp-4', content_status: 'scheduled' },
        { execution_id: 'ex-5', scheduled_post_id: null, content_status: 'scheduled' }, // row-level only
        { execution_id: null, scheduled_post_id: 'sp-9', content_status: 'scheduled' }, // no execution id → skipped
      ],
      posts: [
        { id: 'sp-1', status: 'scheduled', error_message: null, error_code: null, published_at: null },
        { id: 'sp-2', status: 'published', error_message: null, error_code: null, published_at: '2026-07-12T08:00:00Z' },
        { id: 'sp-3', status: 'failed', error_message: 'API down', error_code: 'E500', published_at: null },
        { id: 'sp-4', status: 'cancelled', error_message: null, error_code: null, published_at: null },
      ],
      campaignCompleted: false,
    });
    const byType = (t: string) => events.filter((e) => e.type === t);
    expect(byType('scheduled_post_created').map((e) => e.execution_id).sort()).toEqual(['ex-1', 'ex-2', 'ex-3']);
    expect(byType('publish_completed')).toEqual([expect.objectContaining({ execution_id: 'ex-2', occurred_at: '2026-07-12T08:00:00Z' })]);
    expect(byType('publish_failed')).toEqual([expect.objectContaining({ execution_id: 'ex-3', error_message: 'API down', error_code: 'E500' })]);
    expect(byType('scheduling_completed').map((e) => e.execution_id)).toEqual(['ex-5']);
    expect(events.every((e) => e.execution_id !== 'ex-4')).toBe(true); // cancelled → nothing
  });

  it('campaign completion emits archive_completed for published items only', () => {
    const events = deriveExecutionEvents({
      campaignId: 'camp-1',
      planRows: [
        { execution_id: 'ex-1', scheduled_post_id: 'sp-1', content_status: 'scheduled' },
        { execution_id: 'ex-2', scheduled_post_id: 'sp-2', content_status: 'scheduled' },
      ],
      posts: [
        { id: 'sp-1', status: 'published', error_message: null, error_code: null, published_at: '2026-07-12T08:00:00Z' },
        { id: 'sp-2', status: 'scheduled', error_message: null, error_code: null, published_at: null },
      ],
      campaignCompleted: true,
    });
    expect(events.filter((e) => e.type === 'archive_completed').map((e) => e.execution_id)).toEqual(['ex-1']);
  });

  it('full recovery: state re-derivable from records alone (mixed campaign)', () => {
    const events = deriveExecutionEvents({
      campaignId: 'camp-1',
      planRows: [
        { execution_id: 'ex-1', scheduled_post_id: 'sp-1', content_status: 'scheduled' },
        { execution_id: 'ex-2', scheduled_post_id: null, content_status: 'planned' },
      ],
      posts: [{ id: 'sp-1', status: 'publishing', error_message: null, error_code: null, published_at: null }],
      campaignCompleted: false,
    });
    const synced = applyExecutionEvents(materialized(), events).assignments;
    expect(synced[0].status).toBe('publishing'); // ex-1 slot
    expect(synced[1].status).toBe('materialized'); // ex-2 slot — no execution yet
  });
});

describe('GET /api/campaigns/[id]/assignment-execution-events — read-only route', () => {
  function mockRes() {
    const res: any = { statusCode: 0, body: undefined };
    res.status = (code: number) => { res.statusCode = code; return res; };
    res.json = (payload: unknown) => { res.body = payload; return res; };
    return res;
  }

  beforeEach(() => {
    campaignRow = { execution_status: 'ACTIVE' };
    planRows = [{ execution_id: 'ex-1', scheduled_post_id: 'sp-1', content_status: 'scheduled' }];
    postRows = [{ id: 'sp-1', status: 'published', error_message: null, error_code: null, published_at: '2026-07-12T08:00:00Z' }];
    versionRow = null;
    versionUpdateRejected = false;
    versionUpdates.length = 0;
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('derives events from records and reports what it read', async () => {
    const res = mockRes();
    await eventsHandler({ method: 'GET', query: { id: 'camp-1' } } as any, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'scheduled_post_created', execution_id: 'ex-1' }),
      expect.objectContaining({ type: 'publish_completed', execution_id: 'ex-1' }),
    ]));
    expect(res.body.derived_from).toEqual({ plan_rows: 1, scheduled_posts: 1, campaign_completed: false });
  });

  it('COMPLETED campaigns add archive events; non-GET rejected', async () => {
    campaignRow = { execution_status: 'COMPLETED' };
    let res = mockRes();
    await eventsHandler({ method: 'GET', query: { id: 'camp-1' } } as any, res);
    expect(res.body.events.some((e: { type: string }) => e.type === 'archive_completed')).toBe(true);

    res = mockRes();
    await eventsHandler({ method: 'POST', query: { id: 'camp-1' } } as any, res);
    expect(res.statusCode).toBe(405);
  });
});

describe('P7 — durable execution state persistence (cached projection, never an authority)', () => {
  function mockRes() {
    const res: any = { statusCode: 0, body: undefined };
    res.status = (code: number) => { res.statusCode = code; return res; };
    res.json = (payload: unknown) => { res.body = payload; return res; };
    return res;
  }

  /** Snapshot with two stored materialized assignments: ex-1 will advance to
   *  published from the records; ex-2 has no events and must stay untouched. */
  function seedSnapshot() {
    const stored = materialized();
    versionRow = {
      id: 'v-1',
      campaign_snapshot: {
        planner_state: {
          idea_spine: { title: 'Keep me' },
          assignments: JSON.parse(JSON.stringify(stored)),
        },
        planner_state_revision: 7,
        planner_draft: true,
      },
    };
    return stored;
  }

  beforeEach(() => {
    campaignRow = { execution_status: 'ACTIVE' };
    planRows = [{ execution_id: 'ex-1', scheduled_post_id: 'sp-1', content_status: 'scheduled' }];
    postRows = [{ id: 'sp-1', status: 'published', error_message: null, error_code: null, published_at: '2026-07-12T08:00:00Z' }];
    versionRow = null;
    versionUpdateRejected = false;
    versionUpdates.length = 0;
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('persists the folded projection when it changed — execution fields only, revision untouched', async () => {
    seedSnapshot();
    const res = mockRes();
    await eventsHandler({ method: 'GET', query: { id: 'camp-1' } } as any, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.persistence).toEqual({ persisted: 1, skipped: '' });

    expect(versionUpdates).toHaveLength(1);
    const written = versionUpdates[0].payload.campaign_snapshot as {
      planner_state: { idea_spine: unknown; assignments: CampaignAssignment[] };
      planner_state_revision: number;
      planner_draft: boolean;
    };
    const [synced, untouched] = written.planner_state.assignments;
    // execution-owned fields written
    expect(synced).toMatchObject({ status: 'published', scheduled_post_id: 'sp-1' });
    // planning-owned fields preserved verbatim
    expect(synced).toMatchObject({ asset_id: 'car-1', structure_id: 'ex-1', notes: '', ordering: 0 });
    // sibling with no events untouched
    expect(untouched.status).toBe('materialized');
    // the rest of the snapshot survives; the revision is NOT bumped
    expect(written.planner_state.idea_spine).toEqual({ title: 'Keep me' });
    expect(written.planner_state_revision).toBe(7);
    expect(written.planner_draft).toBe(true);
    // optimistic guard on the unchanged revision
    expect(versionUpdates[0].filters).toEqual(expect.arrayContaining([
      ['id', 'v-1'],
      ['campaign_snapshot->>planner_state_revision', '7'],
    ]));
  });

  it('idempotent: a second sync of the same records writes NOTHING', async () => {
    seedSnapshot();
    let res = mockRes();
    await eventsHandler({ method: 'GET', query: { id: 'camp-1' } } as any, res);
    expect(res.body.persistence.persisted).toBe(1);

    // adopt the persisted state as the new stored snapshot, then sync again
    versionRow = {
      id: 'v-1',
      campaign_snapshot: versionUpdates[0].payload.campaign_snapshot as Row,
    };
    res = mockRes();
    await eventsHandler({ method: 'GET', query: { id: 'camp-1' } } as any, res);
    expect(res.body.persistence).toEqual({ persisted: 0, skipped: 'unchanged' });
    expect(versionUpdates).toHaveLength(1); // still just the first write
  });

  it('a concurrent planner save wins: revision moved → skip, no lost update', async () => {
    seedSnapshot();
    versionUpdateRejected = true;
    const res = mockRes();
    await eventsHandler({ method: 'GET', query: { id: 'camp-1' } } as any, res);
    expect(res.body.persistence).toEqual({ persisted: 0, skipped: 'revision_moved' });
    expect(res.statusCode).toBe(200); // events still served
  });

  it('legacy campaigns (no stored assignments) are never written to', async () => {
    versionRow = { id: 'v-1', campaign_snapshot: { planner_state: { idea_spine: {} }, planner_state_revision: 1 } };
    const res = mockRes();
    await eventsHandler({ method: 'GET', query: { id: 'camp-1' } } as any, res);
    expect(res.body.persistence).toEqual({ persisted: 0, skipped: 'no_assignments' });
    expect(versionUpdates).toHaveLength(0);
    expect(res.body.events.length).toBeGreaterThan(0); // clients still get events
  });

  it('no snapshot at all → derivation still serves events (persistence skipped)', async () => {
    const res = mockRes();
    await eventsHandler({ method: 'GET', query: { id: 'camp-1' } } as any, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.persistence.persisted).toBe(0);
    expect(versionUpdates).toHaveLength(0);
  });
});

describe('P5 readiness reporting (read-only AI)', () => {
  it('reports failed publishing, stalled execution, and coverage without modifying anything', () => {
    let list = materialized();
    list = applyExecutionEvents(list, [
      ev('scheduled_post_created', 'ex-1'),
      ev('publish_failed', 'ex-1', { error_message: 'x' }),
    ]).assignments;
    const before = JSON.parse(JSON.stringify(list));
    const report = assessExecutionReadiness(slots, list, []);
    expect(report.failed_publishing).toEqual([list[0].id]);
    expect(report.stalled_execution).toEqual([list[1].id]); // sibling progressed, ex-2 stuck at materialized
    expect(report.execution_coverage).toMatchObject({ total: 2, materialized: 1, scheduled: 1, published: 0 });
    expect(JSON.parse(JSON.stringify(list))).toEqual(before); // read-only
  });
});
