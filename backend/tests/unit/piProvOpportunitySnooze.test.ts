/**
 * Opportunity-level snooze + owner assignment + status transitions, through the
 * shipped services (opportunityWorkflowService, opportunityLifecycleService)
 * over an in-memory table fake that enforces the constraints the services rely
 * on in PostgreSQL (20270108000000):
 *   - uq_opp_assignment_one_active          → 23505
 *   - opp_*_item_tenant_fk (composite FKs)   → 23503
 *   - opp_disposition_snooze_requires_revisit_later → 23514
 * The same constraints are proven against real PostgreSQL in
 * backend/tests/realschema/pi_prov_opportunity_lifecycle.test.ts.
 *
 * Owner decision (2026-10-30): snooze is an OPPORTUNITY property, not a
 * prospect property, and reuses the existing workflow model.
 */

type Row = Record<string, any>;
const tables: Record<string, Row[]> = {};
let clock = 0;
let seq = 0;
/** Optional hook run immediately before an insert is applied (race injection). */
let beforeInsert: ((table: string, row: Row) => void) | null = null;
let failNextUpdate: string | null = null;

function tick(): string {
  clock += 1;
  return new Date(Date.UTC(2026, 9, 1, 0, 0, clock)).toISOString();
}

function constraintError(table: string, row: Row): { code: string; message: string } | null {
  if (table === 'opportunity_assignments' || table === 'opportunity_dispositions') {
    const item = (tables.opportunity_feed_items ?? []).find((f) => f.id === row.opportunity_feed_item_id);
    if (!item || item.organization_id !== row.organization_id) {
      return { code: '23503', message: `insert or update on table "${table}" violates foreign key constraint (tenant)` };
    }
  }
  if (table === 'opportunity_assignments' && row.unassigned_at == null) {
    const clash = (tables[table] ?? []).some((r) => r.unassigned_at == null
      && r.opportunity_feed_item_id === row.opportunity_feed_item_id && r.role === row.role);
    if (clash) return { code: '23505', message: 'duplicate key value violates unique constraint "uq_opp_assignment_one_active"' };
  }
  if (table === 'opportunity_dispositions' && row.snoozed_until != null && row.disposition !== 'revisit_later') {
    return { code: '23514', message: 'violates check constraint "opp_disposition_snooze_requires_revisit_later"' };
  }
  return null;
}

function fakeTable(table: string) {
  const st = {
    op: 'select' as 'select' | 'insert' | 'update',
    payload: null as Row | null,
    filters: [] as Array<(r: Row) => boolean>,
    order: [] as Array<{ col: string; asc: boolean }>,
    limit: null as number | null,
  };
  const rows = () => (tables[table] ??= []);
  const matching = () => rows().filter((r) => st.filters.every((f) => f(r)));

  const exec = async (mode: 'many' | 'maybe' | 'single') => {
    if (st.op === 'insert') {
      const row: Row = { id: `${table}-${++seq}`, metadata: {}, ...st.payload };
      if (table === 'opportunity_lifecycle_states') row.transitioned_at ??= tick();
      else row.created_at ??= tick();
      if (table === 'opportunity_assignments') row.unassigned_at ??= null;
      if (table === 'opportunity_dispositions') row.snoozed_until ??= null;
      beforeInsert?.(table, row);
      const err = constraintError(table, row);
      if (err) return { data: null, error: err };
      rows().push(row);
      return { data: { ...row }, error: null };
    }
    if (st.op === 'update') {
      if (failNextUpdate === table) { failNextUpdate = null; return { data: null, error: { code: 'XX000', message: 'boom' } }; }
      const hit = matching();
      for (const r of hit) Object.assign(r, st.payload);
      return { data: mode === 'many' ? hit.map((r) => ({ ...r })) : (hit[0] ? { ...hit[0] } : null), error: null };
    }
    let out = matching().map((r) => ({ ...r }));
    for (const o of [...st.order].reverse()) {
      out = out.sort((a, b) => (a[o.col] < b[o.col] ? -1 : a[o.col] > b[o.col] ? 1 : 0) * (o.asc ? 1 : -1));
    }
    if (st.limit != null) out = out.slice(0, st.limit);
    if (mode === 'many') return { data: out, error: null };
    return { data: out[0] ?? null, error: null };
  };

  const b: any = {
    select: () => b,
    insert: (p: Row) => { st.op = 'insert'; st.payload = p; return b; },
    update: (p: Row) => { st.op = 'update'; st.payload = p; return b; },
    eq: (c: string, v: unknown) => { st.filters.push((r) => r[c] === v); return b; },
    is: (c: string, v: null) => { st.filters.push((r) => (r[c] ?? null) === v); return b; },
    lte: (c: string, v: string) => { st.filters.push((r) => r[c] != null && Date.parse(r[c]) <= Date.parse(v)); return b; },
    in: (c: string, vs: unknown[]) => { st.filters.push((r) => vs.includes(r[c])); return b; },
    order: (c: string, o?: { ascending?: boolean }) => { st.order.push({ col: c, asc: o?.ascending !== false }); return b; },
    limit: (n: number) => { st.limit = n; return b; },
    single: () => exec('single'),
    maybeSingle: () => exec('maybe'),
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => exec('many').then(res, rej),
  };
  return b;
}

jest.mock('../../db/writeOwner', () => ({
  __esModule: true,
  ownedDbTable: (table: string) => fakeTable(table),
}));

import {
  assignOpportunity,
  listExpiredOpportunitySnoozes,
  listOpportunitySnoozeHistory,
  readOpportunitySnooze,
  setOpportunityDisposition,
  snoozeOpportunity,
  unsnoozeOpportunity,
} from '../../services/opportunityWorkflowService';
import {
  initialiseLifecycleForOpportunity,
  readCurrentLifecycleState,
  transitionLifecycle,
  LifecycleTransitionError,
} from '../../services/opportunityLifecycleService';
import { buildProspectOpportunities } from '../../../lib/prospectOpportunity/contract';
import { deriveOpportunitySnooze, validateSnoozeDeadline } from '../../../lib/prospectOpportunity/snooze';
import type { OpportunityAssignment, OpportunityDisposition } from '../../types/opportunityWorkflow';

const ORG = '00000000-0000-4000-8000-00000000000a';
const OTHER = '00000000-0000-4000-8000-00000000000b';
const P = 'prospect-1';
const F1 = 'feed-buying';   // prospect P, buying_intent
const F2 = 'feed-hiring';   // prospect P, hiring_signal
const F3 = 'feed-unrelated'; // another prospect, same tenant
const FX = 'feed-other-tenant';
const U1 = 'user-1';
const U2 = 'user-2';
const NOW = '2026-10-30T09:00:00.000Z';
const LATER = '2026-11-06T09:00:00.000Z';

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  clock = 0;
  seq = 0;
  beforeInsert = null;
  failNextUpdate = null;
  tables.opportunity_feed_items = [
    { id: F1, organization_id: ORG, opportunity_type: 'buying_intent', platform: 'reddit', created_at: '2026-09-01T00:00:00Z' },
    { id: F2, organization_id: ORG, opportunity_type: 'hiring_signal', platform: 'reddit', created_at: '2026-09-02T00:00:00Z' },
    { id: F3, organization_id: ORG, opportunity_type: 'buying_intent', platform: 'reddit', created_at: '2026-09-03T00:00:00Z' },
    { id: FX, organization_id: OTHER, opportunity_type: 'buying_intent', platform: 'reddit', created_at: '2026-09-04T00:00:00Z' },
  ];
});

const snooze = (item: string, until = LATER, org = ORG) =>
  snoozeOpportunity({ organizationId: org, opportunityFeedItemId: item, until, setByUserId: U1, reason: 'next quarter', now: NOW });

describe('snooze — set, read, independence', () => {
  it('snoozes ONE opportunity; the prospect\'s other opportunity and an unrelated one are untouched', async () => {
    const row = await snooze(F1);
    expect(row).toMatchObject({ disposition: 'revisit_later', snoozed_until: LATER, set_by_user_id: U1 });
    expect(row.metadata).toMatchObject({ snooze_action: 'snooze' });

    expect(await readOpportunitySnooze(ORG, F1, NOW)).toMatchObject({ kind: 'active', until: LATER, setBy: U1, reason: 'next quarter' });
    expect(await readOpportunitySnooze(ORG, F2, NOW)).toEqual({ kind: 'none' });
    expect(await readOpportunitySnooze(ORG, F3, NOW)).toEqual({ kind: 'none' });
    expect(tables.opportunity_dispositions.filter((d) => d.opportunity_feed_item_id !== F1)).toEqual([]);
  });

  it('two opportunities of one prospect hold independent deadlines', async () => {
    await snooze(F1, '2026-11-01T00:00:00.000Z');
    await snooze(F2, '2026-12-01T00:00:00.000Z');
    const at = '2026-11-15T00:00:00.000Z';
    expect(await readOpportunitySnooze(ORG, F1, at)).toMatchObject({ kind: 'expired', until: '2026-11-01T00:00:00.000Z' });
    expect(await readOpportunitySnooze(ORG, F2, at)).toMatchObject({ kind: 'active', until: '2026-12-01T00:00:00.000Z' });
  });

  it('refuses a deadline that is not strictly in the future, and writes nothing', async () => {
    await expect(snooze(F1, NOW)).rejects.toThrow('snooze_until_must_be_in_the_future');
    await expect(snooze(F1, '2026-01-01T00:00:00Z')).rejects.toThrow('snooze_until_must_be_in_the_future');
    await expect(snooze(F1, 'not-a-date')).rejects.toThrow('snooze_invalid_timestamp');
    expect(tables.opportunity_dispositions ?? []).toEqual([]);
  });

  it('normalises the stored deadline to an ISO instant', () => {
    expect(validateSnoozeDeadline('2026-11-06T10:00:00+01:00', NOW)).toBe('2026-11-06T09:00:00.000Z');
  });
});

describe('snooze — expiry, unsnooze, re-snooze, history', () => {
  it('expires by time alone (exactly at the deadline) with no write', async () => {
    await snooze(F1);
    const before = tables.opportunity_dispositions.length;
    expect((await readOpportunitySnooze(ORG, F1, '2026-11-06T08:59:59.999Z')).kind).toBe('active');
    expect((await readOpportunitySnooze(ORG, F1, LATER)).kind).toBe('expired');
    expect(tables.opportunity_dispositions.length).toBe(before);
  });

  it('lists only expired, un-superseded snoozes of the tenant as due', async () => {
    await snooze(F1, '2026-11-01T00:00:00.000Z');           // expires
    await snooze(F2, '2026-12-01T00:00:00.000Z');           // still active
    await snooze(F3, '2026-11-01T00:00:00.000Z');           // expired, then superseded
    await setOpportunityDisposition({ organizationId: ORG, opportunityFeedItemId: F3, disposition: 'qualified', reason: null, setByUserId: U2 });
    await snooze(FX, '2026-11-01T00:00:00.000Z', OTHER);    // other tenant
    const due = await listExpiredOpportunitySnoozes(ORG, '2026-11-15T00:00:00.000Z');
    expect(due.map((d) => d.opportunityFeedItemId)).toEqual([F1]);
    expect(due[0].snooze).toMatchObject({ kind: 'expired', until: '2026-11-01T00:00:00.000Z' });
  });

  it('unsnooze ends an active snooze by appending a row; the snooze row is not modified', async () => {
    const s = await snooze(F1);
    const original = { ...tables.opportunity_dispositions[0] };
    const u = await unsnoozeOpportunity({ organizationId: ORG, opportunityFeedItemId: F1, setByUserId: U2, reason: 'customer replied', now: NOW });
    expect(u).toMatchObject({ disposition: 'revisit_later', set_by_user_id: U2, snoozed_until: null });
    expect(u!.metadata).toEqual({ snooze_action: 'unsnooze', ended_snooze_disposition_id: s.id });
    expect(tables.opportunity_dispositions[0]).toEqual(original);
    expect(await readOpportunitySnooze(ORG, F1, NOW)).toEqual({ kind: 'none' });
  });

  it('unsnooze is a no-op when nothing is actively snoozed (never, expired, or other tenant)', async () => {
    expect(await unsnoozeOpportunity({ organizationId: ORG, opportunityFeedItemId: F2, setByUserId: U1, reason: null, now: NOW })).toBeNull();
    await snooze(F1, '2026-11-01T00:00:00.000Z');
    expect(await unsnoozeOpportunity({ organizationId: ORG, opportunityFeedItemId: F1, setByUserId: U1, reason: null, now: '2026-11-02T00:00:00.000Z' })).toBeNull();
    expect(await unsnoozeOpportunity({ organizationId: OTHER, opportunityFeedItemId: F1, setByUserId: U1, reason: null, now: NOW })).toBeNull();
    expect(tables.opportunity_dispositions).toHaveLength(1);
  });

  it('a re-snooze replaces the deadline; history keeps every snooze action in order', async () => {
    await snooze(F1, '2026-11-01T00:00:00.000Z');
    await snooze(F1, '2026-12-01T00:00:00.000Z');
    await unsnoozeOpportunity({ organizationId: ORG, opportunityFeedItemId: F1, setByUserId: U2, reason: null, now: NOW });
    await snooze(F1, '2027-01-01T00:00:00.000Z');
    expect(await readOpportunitySnooze(ORG, F1, NOW)).toMatchObject({ kind: 'active', until: '2027-01-01T00:00:00.000Z' });
    const h = await listOpportunitySnoozeHistory(ORG, F1);
    expect(h.map((d) => [d.snoozed_until, d.metadata.snooze_action])).toEqual([
      ['2026-11-01T00:00:00.000Z', 'snooze'],
      ['2026-12-01T00:00:00.000Z', 'snooze'],
      [null, 'unsnooze'],
      ['2027-01-01T00:00:00.000Z', 'snooze'],
    ]);
  });
});

describe('snooze — tenant isolation', () => {
  it('a snooze naming another tenant\'s item is refused (composite FK 23503) and nothing is stored', async () => {
    await expect(snooze(FX, LATER, ORG)).rejects.toThrow(/snooze_insert_failed:.*foreign key/);
    await expect(snooze(F1, LATER, OTHER)).rejects.toThrow(/snooze_insert_failed/);
    expect(tables.opportunity_dispositions ?? []).toEqual([]);
  });

  it('another tenant cannot read a snooze', async () => {
    await snooze(F1);
    expect(await readOpportunitySnooze(OTHER, F1, NOW)).toEqual({ kind: 'none' });
    expect(await listOpportunitySnoozeHistory(OTHER, F1)).toEqual([]);
    expect(await listExpiredOpportunitySnoozes(OTHER, '2030-01-01T00:00:00Z')).toEqual([]);
  });

  it('the pure derivation ignores rows of another tenant or another item', () => {
    const rows = [
      { id: 'x', organization_id: OTHER, opportunity_feed_item_id: F1, disposition: 'revisit_later', reason: null, set_by_user_id: null, metadata: {}, created_at: '2026-10-01T00:00:00Z', snoozed_until: LATER },
      { id: 'y', organization_id: ORG, opportunity_feed_item_id: F2, disposition: 'revisit_later', reason: null, set_by_user_id: null, metadata: {}, created_at: '2026-10-01T00:00:00Z', snoozed_until: LATER },
    ] as OpportunityDisposition[];
    expect(deriveOpportunitySnooze(rows, { organizationId: ORG, opportunityFeedItemId: F1 }, NOW)).toEqual({ kind: 'none' });
  });
});

describe('owner assignment — one active owner per (item, role)', () => {
  const assign = (item: string, user: string, org = ORG) =>
    assignOpportunity({ organizationId: org, opportunityFeedItemId: item, assignedToUserId: user, assignedByUserId: U1, role: 'owner' });
  const active = (item: string) => tables.opportunity_assignments.filter((a) => a.opportunity_feed_item_id === item && a.unassigned_at == null);

  it('different owners per opportunity of one prospect; reassignment closes the previous owner', async () => {
    await assign(F1, U1);
    await assign(F2, U2);
    expect(active(F1).map((a) => a.assigned_to_user_id)).toEqual([U1]);
    expect(active(F2).map((a) => a.assigned_to_user_id)).toEqual([U2]);
    await assign(F1, U2);
    expect(active(F1).map((a) => a.assigned_to_user_id)).toEqual([U2]);
    expect(active(F2).map((a) => a.assigned_to_user_id)).toEqual([U2]);
    expect(tables.opportunity_assignments.filter((a) => a.opportunity_feed_item_id === F1)).toHaveLength(2);
  });

  it('a concurrent assignment that wins the race is closed and the call retried (no second active owner)', async () => {
    let injected = false;
    beforeInsert = (table, row) => {
      if (table !== 'opportunity_assignments' || injected) return;
      injected = true; // another request inserts its owner between our close and our insert
      tables.opportunity_assignments = [...(tables.opportunity_assignments ?? []), {
        ...row, id: 'concurrent', assigned_to_user_id: U2, unassigned_at: null, created_at: tick(),
      }];
    };
    const r = await assign(F1, U1);
    expect(r.assigned_to_user_id).toBe(U1);
    expect(active(F1).map((a) => a.assigned_to_user_id)).toEqual([U1]);
    expect(tables.opportunity_assignments.find((a) => a.id === 'concurrent')!.unassigned_at).not.toBeNull();
  });

  it('gives up with assignment_conflict after bounded retries, never leaving two active owners', async () => {
    beforeInsert = (table, row) => {
      if (table !== 'opportunity_assignments') return;
      tables.opportunity_assignments.push({ ...row, id: `c-${++seq}`, assigned_to_user_id: U2, unassigned_at: null, created_at: tick() });
    };
    await expect(assign(F1, U1)).rejects.toThrow(/^assignment_conflict:/);
    expect(active(F1)).toHaveLength(1);
  });

  it('surfaces a failed close instead of inserting a second owner', async () => {
    await assign(F1, U1);
    failNextUpdate = 'opportunity_assignments';
    await expect(assign(F1, U2)).rejects.toThrow('assignment_close_failed:boom');
    expect(active(F1).map((a) => a.assigned_to_user_id)).toEqual([U1]);
  });

  it('refuses an item of another tenant (23503)', async () => {
    await expect(assign(FX, U1)).rejects.toThrow(/assignment_insert_failed:.*foreign key/);
  });
});

describe('status transitions stay independent of snooze and of other opportunities', () => {
  it('per-opportunity lifecycle; snoozing never writes a lifecycle row or changes status', async () => {
    for (const f of [F1, F2]) await initialiseLifecycleForOpportunity({ organizationId: ORG, opportunityFeedItemId: f });
    await transitionLifecycle({ organizationId: ORG, opportunityFeedItemId: F1, to: 'triaged', actorUserId: U1, reasoning: null });
    await transitionLifecycle({ organizationId: ORG, opportunityFeedItemId: F1, to: 'qualified', actorUserId: U1, reasoning: null });
    await transitionLifecycle({ organizationId: ORG, opportunityFeedItemId: F2, to: 'triaged', actorUserId: U2, reasoning: null });
    const lifecycleRows = tables.opportunity_lifecycle_states.length;

    await snooze(F1);
    expect(tables.opportunity_lifecycle_states).toHaveLength(lifecycleRows);
    expect(await readCurrentLifecycleState(ORG, F1)).toMatchObject({ kind: 'present', state: 'qualified' });
    expect(await readCurrentLifecycleState(ORG, F2)).toMatchObject({ kind: 'present', state: 'triaged' });
    // A snoozed opportunity can still move through its lifecycle.
    await transitionLifecycle({ organizationId: ORG, opportunityFeedItemId: F1, to: 'outreach_planned', actorUserId: U1, reasoning: null });
    expect((await readOpportunitySnooze(ORG, F1, NOW)).kind).toBe('active');
    await expect(transitionLifecycle({ organizationId: ORG, opportunityFeedItemId: F2, to: 'converted', actorUserId: U2, reasoning: null }))
      .rejects.toBeInstanceOf(LifecycleTransitionError);
  });

  it('the prospect view shows both opportunities with their own owner, status and snooze', async () => {
    for (const f of [F1, F2]) await initialiseLifecycleForOpportunity({ organizationId: ORG, opportunityFeedItemId: f });
    await transitionLifecycle({ organizationId: ORG, opportunityFeedItemId: F1, to: 'triaged', actorUserId: U1, reasoning: null });
    await assignOpportunity({ organizationId: ORG, opportunityFeedItemId: F1, assignedToUserId: U1, assignedByUserId: null, role: 'owner' });
    await assignOpportunity({ organizationId: ORG, opportunityFeedItemId: F2, assignedToUserId: U2, assignedByUserId: null, role: 'owner' });
    await snooze(F2);

    const contributions = [
      { id: 'c1', organizationId: ORG, canonicalLeadId: P, role: 'originating' as const, sourceCategory: 'social_listening' as const, externalRef: 'r:1', platform: 'reddit', sourceUrl: null, sourceRecordId: null, observedAt: '2026-09-01T00:00:00Z', signalRefs: { opportunityFeedItemId: F1 }, evidence: {} },
      { id: 'c2', organizationId: ORG, canonicalLeadId: P, role: 'contributing' as const, sourceCategory: 'social_listening' as const, externalRef: 'r:2', platform: 'reddit', sourceUrl: null, sourceRecordId: null, observedAt: '2026-09-02T00:00:00Z', signalRefs: { opportunityFeedItemId: F2 }, evidence: {} },
    ];
    const feedItems = tables.opportunity_feed_items.filter((f) => f.organization_id === ORG).map((f) => ({
      id: f.id, organizationId: f.organization_id, opportunityType: f.opportunity_type, platform: f.platform, createdAt: f.created_at,
    }));
    const r = buildProspectOpportunities({
      organizationId: ORG,
      prospectId: P,
      contributions: contributions as any,
      feedItems: feedItems.filter((f) => f.id !== F3),
      lifecycle: { [F1]: await readCurrentLifecycleState(ORG, F1), [F2]: await readCurrentLifecycleState(ORG, F2) },
      assignments: tables.opportunity_assignments as OpportunityAssignment[],
      dispositions: tables.opportunity_dispositions as OpportunityDisposition[],
      asOf: NOW,
    });
    expect(r.anomalies).toEqual([]);
    expect(r.opportunities.map((o) => [o.opportunityRef.id, o.owner.kind === 'assigned' && o.owner.userId,
      o.status.kind === 'present' && o.status.state, o.snooze?.kind, o.snoozedUntil])).toEqual([
      [F1, U1, 'triaged', 'none', null],
      [F2, U2, 'detected', 'active', LATER],
    ]);
    expect(r.sourceAttribution.originating?.id).toBe('c1');
  });
});
