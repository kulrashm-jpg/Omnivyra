/**
 * Prospect provenance — acceptance test #2 against real PostgreSQL:
 * one prospect, two opportunity types, different owners and statuses,
 * independent OPPORTUNITY-level snooze, shared source attribution intact.
 *
 * Migrations exercised: 20270107000000_pi_prospect_source_contributions.sql
 * (contributions) and 20270108000000_pi_opportunity_snooze.sql
 * (opportunity_dispositions.snoozed_until, uq_opp_assignment_one_active,
 * composite tenant FKs on dispositions/assignments).
 *
 * A green run here concerns a disposable database built from the committed
 * baseline plus replayed migrations. It is NOT evidence about production.
 *
 * WHAT IS REAL. The workflow decisions run from the shipped modules:
 * `initialiseLifecycleForOpportunity` / `transitionLifecycle` /
 * `readCurrentLifecycleState`, `assignOpportunity`, `snoozeOpportunity` /
 * `unsnoozeOpportunity` / `readOpportunitySnooze` /
 * `listExpiredOpportunitySnoozes`, `recordSourceContribution`, and the pure
 * projection `buildProspectOpportunities`.
 *
 * THE ONE SEAM. The services reach the database through `ownedDbTable`
 * (PostgREST builder dialect over HTTP). It is replaced with a translator that
 * turns the exact builder shapes these services issue into SQL on this suite's
 * client — the technique of `pi_lifecycle_b21.test.ts`. Each statement gets its
 * own SAVEPOINT because in production each call is its own request.
 *
 * One deliberate difference from b21's translator: in production every request
 * is its own transaction, so `now()` defaults differ per row. Inside
 * `inRollback` they would all be equal, and b21 measured that
 * `opportunity_lifecycle_states` has no tiebreaker (finding L3b). The
 * translator therefore stamps `transitioned_at` / `created_at` with
 * `clock_timestamp()` when the service did not supply one — reproducing the
 * per-request timestamps production has, not hiding the L3b finding (which b21
 * keeps pinning).
 */

import { db, inRollback, seedTenants, newLead, ORG_A, ORG_B } from './setup';

jest.mock('../../db/writeOwner', () => ({
  __esModule: true,
  ownedDbTable: (table: string) => {
    const { db: client } = require('./setup') as {
      db: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> };
    };
    type Filter = { col: string; op: '=' | 'is' | '<=' | 'in'; val: unknown };
    const st = {
      op: 'select' as 'select' | 'insert' | 'update',
      cols: '*',
      payload: null as Record<string, unknown> | null,
      filters: [] as Filter[],
      order: [] as Array<{ col: string; asc: boolean }>,
      limit: null as number | null,
    };
    const STAMP: Record<string, string> = {
      opportunity_lifecycle_states: 'transitioned_at',
      opportunity_assignments: 'created_at',
      opportunity_dispositions: 'created_at',
    };
    let sp = 0;

    const where = (params: unknown[]): string => {
      if (st.filters.length === 0) return '';
      return ` WHERE ${st.filters.map((f) => {
        if (f.op === 'is') return `"${f.col}" IS NULL`;
        params.push(f.val);
        if (f.op === 'in') return `"${f.col}" = ANY($${params.length})`;
        return `"${f.col}" ${f.op} $${params.length}`;
      }).join(' AND ')}`;
    };

    const run = async (sql: string, params: unknown[]) => {
      const name = `ol_sp_${++sp}_${Math.random().toString(36).slice(2, 8)}`;
      await client.query(`SAVEPOINT ${name}`);
      try {
        const res = await client.query(sql, params);
        await client.query(`RELEASE SAVEPOINT ${name}`);
        return { rows: res.rows, error: null as null | { code: string; message: string } };
      } catch (e: unknown) {
        await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
        return {
          rows: [] as Array<Record<string, unknown>>,
          error: {
            code: String((e as { code?: unknown })?.code ?? 'unknown'),
            message: String((e as { message?: unknown })?.message ?? 'unknown'),
          },
        };
      }
    };

    const normalize = (row: Record<string, unknown>): Record<string, unknown> => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) out[k] = v instanceof Date ? v.toISOString() : v;
      return out;
    };

    const exec = async (mode: 'many' | 'maybe' | 'single'): Promise<Record<string, unknown>> => {
      const params: unknown[] = [];
      if (st.op === 'insert') {
        const payload = { ...(st.payload ?? {}) };
        const keys = Object.keys(payload);
        const cols = keys.map((k) => `"${k}"`);
        const vals = keys.map((k) => {
          const v = payload[k];
          params.push(v !== null && typeof v === 'object' ? JSON.stringify(v) : v);
          return `$${params.length}`;
        });
        const stamp = STAMP[table];
        if (stamp && !(stamp in payload)) { cols.push(`"${stamp}"`); vals.push('clock_timestamp()'); }
        const r = await run(`INSERT INTO public."${table}" (${cols.join(', ')}) VALUES (${vals.join(', ')}) RETURNING *`, params);
        if (r.error) return { data: null, error: r.error };
        return { data: normalize(r.rows[0] ?? {}), error: null };
      }
      if (st.op === 'update') {
        const payload = st.payload ?? {};
        const sets = Object.keys(payload).map((k) => { params.push(payload[k]); return `"${k}" = $${params.length}`; });
        const r = await run(`UPDATE public."${table}" SET ${sets.join(', ')}${where(params)} RETURNING *`, params);
        if (r.error) return { data: null, error: r.error };
        const rows = r.rows.map(normalize);
        return { data: mode === 'many' ? rows : (rows[0] ?? null), error: null };
      }
      const clause = where(params);
      const cols = st.cols === '*' ? '*' : st.cols.split(',').map((c) => `"${c.trim()}"`).join(', ');
      const order = st.order.length ? ` ORDER BY ${st.order.map((o) => `"${o.col}" ${o.asc ? 'ASC' : 'DESC'}`).join(', ')}` : '';
      const limit = st.limit != null ? ` LIMIT ${st.limit}` : (mode === 'many' ? '' : ' LIMIT 1');
      const r = await run(`SELECT ${cols} FROM public."${table}"${clause}${order}${limit}`, params);
      if (r.error) return { data: null, error: r.error };
      const rows = r.rows.map(normalize);
      if (mode === 'many') return { data: rows, error: null };
      return { data: rows[0] ?? null, error: null };
    };

    const b: Record<string, unknown> = {
      select: (cols?: string) => { if (typeof cols === 'string' && st.op === 'select') st.cols = cols; return b; },
      insert: (p: Record<string, unknown>) => { st.op = 'insert'; st.payload = p; return b; },
      update: (p: Record<string, unknown>) => { st.op = 'update'; st.payload = p; return b; },
      eq: (c: string, v: unknown) => { st.filters.push({ col: c, op: '=', val: v }); return b; },
      is: (c: string, v: unknown) => { if (v !== null) throw new Error('translator: only is(col, null)'); st.filters.push({ col: c, op: 'is', val: null }); return b; },
      lte: (c: string, v: unknown) => { st.filters.push({ col: c, op: '<=', val: v }); return b; },
      in: (c: string, v: unknown[]) => { st.filters.push({ col: c, op: 'in', val: v }); return b; },
      order: (c: string, o?: { ascending?: boolean }) => { st.order.push({ col: c, asc: o?.ascending !== false }); return b; },
      limit: (n: number) => { st.limit = n; return b; },
      maybeSingle: () => exec('maybe'),
      single: () => exec('single'),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => exec('many').then(res, rej),
    };
    return b;
  },
}));

import {
  initialiseLifecycleForOpportunity,
  readCurrentLifecycleState,
  transitionLifecycle,
} from '../../services/opportunityLifecycleService';
import {
  assignOpportunity,
  listExpiredOpportunitySnoozes,
  listOpportunitySnoozeHistory,
  readOpportunitySnooze,
  snoozeOpportunity,
  unsnoozeOpportunity,
} from '../../services/opportunityWorkflowService';
import { recordSourceContribution } from '../../services/prospectProvenance/contributionWriter';
import {
  buildProspectOpportunities,
  type FeedItemOpportunityRow,
  type ProspectContributionRow,
} from '../../../lib/prospectOpportunity/contract';
import type { OpportunityAssignment, OpportunityDisposition } from '../../types/opportunityWorkflow';

const DB_URL = process.env.W6_DB_URL ?? '';
if (!/@(127\.0\.0\.1|localhost|\[::1\]):\d+\//.test(DB_URL)) {
  throw new Error(`pi_prov_opportunity_lifecycle refuses a non-loopback W6_DB_URL: ${DB_URL.replace(/:[^:@]+@/, ':***@')}`);
}

const q = (sql: string, params: unknown[] = []) => db.query(sql, params);
const rnd = () => Math.random().toString(36).slice(2, 10);

async function user(tag: string): Promise<string> {
  const { rows } = await q(`INSERT INTO public.users (email) VALUES ($1) RETURNING id`, [`ol-${tag}-${rnd()}@example.test`]);
  return rows[0].id;
}
async function signal(org: string): Promise<string> {
  const { rows } = await q(
    `INSERT INTO public.lead_signals (organization_id, source_type, source_id, platform, detected_at, migration_source)
     VALUES ($1,'listening',$2,'reddit',now(),'pi-prov-ol') RETURNING id`, [org, `ol-${rnd()}`]);
  return rows[0].id;
}
async function feed(org: string, type: string): Promise<string> {
  const sig = await signal(org);
  const { rows } = await q(
    `INSERT INTO public.opportunity_feed_items (organization_id, signal_id, opportunity_type, detected_reason, platform)
     VALUES ($1,$2,$3,'pi-prov-ol','reddit') RETURNING id`, [org, sig, type]);
  return rows[0].id;
}

const pgInserter = async (r: Record<string, unknown>) => {
  const cols = Object.keys(r);
  const vals = cols.map((c) => (c === 'evidence' || c === 'source_metadata' ? JSON.stringify(r[c]) : r[c]));
  await q('SAVEPOINT w');
  try {
    const { rows } = await q(
      `INSERT INTO public.prospect_source_contributions (${cols.join(',')}) VALUES (${cols.map((_c, i) => `$${i + 1}`).join(',')}) RETURNING id`, vals);
    await q('RELEASE SAVEPOINT w');
    return { data: { id: rows[0].id as string }, error: null };
  } catch (e: any) {
    await q('ROLLBACK TO SAVEPOINT w');
    return { data: null, error: { code: e.code, message: e.message } };
  }
};

/** Attempt and return 'ok' or `${sqlstate}:${constraint}`. */
async function violated(sql: string, p: unknown[]): Promise<string> {
  await q('SAVEPOINT v');
  try {
    await q(sql, p);
    await q('RELEASE SAVEPOINT v');
    return 'ok';
  } catch (e: any) {
    await q('ROLLBACK TO SAVEPOINT v');
    return `${e.code}:${e.constraint ?? ''}`;
  }
}

async function contributionsOf(lead: string): Promise<ProspectContributionRow[]> {
  const { rows } = await q(
    `SELECT * FROM public.prospect_source_contributions WHERE organization_id = $1 AND canonical_lead_id = $2`, [ORG_A, lead]);
  return rows.map((r: any) => ({
    id: r.id,
    organizationId: r.organization_id,
    canonicalLeadId: r.canonical_lead_id,
    role: r.contribution_role,
    sourceCategory: r.source_category,
    externalRef: r.external_ref,
    platform: r.platform,
    sourceUrl: r.source_url,
    sourceRecordId: r.source_record_id,
    observedAt: new Date(r.observed_at).toISOString(),
    signalRefs: {
      ...(r.opportunity_feed_item_id ? { opportunityFeedItemId: r.opportunity_feed_item_id } : {}),
      ...(r.lead_signal_id ? { leadSignalId: r.lead_signal_id } : {}),
    },
    evidence: r.evidence ?? {},
  })) as ProspectContributionRow[];
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));

describe('acceptance #2 — one prospect, two opportunity types, independent workflow', () => {
  it('different owners and statuses, independent snooze, shared attribution intact', async () => {
    await inRollback(async () => {
      await seedTenants();
      const u1 = await user('u1');
      const u2 = await user('u2');
      const lead = await newLead(ORG_A);
      const f1 = await feed(ORG_A, 'buying_intent');
      const f2 = await feed(ORG_A, 'hiring_signal');
      const fUnrelated = await feed(ORG_A, 'buying_intent'); // not cited by this prospect

      // 1. Attribution through the shipped writer.
      const base = { organizationId: ORG_A, canonicalLeadId: lead, sourceCategory: 'community' as const, platform: 'reddit' };
      expect(await recordSourceContribution({ ...base, leadCreated: true, externalRef: 'community:f1', opportunityFeedItemId: f1, observedAt: '2026-10-01T00:00:00.000Z' }, { insert: pgInserter }))
        .toMatchObject({ status: 'inserted', role: 'originating' });
      expect(await recordSourceContribution({ ...base, leadCreated: false, externalRef: 'community:f2', opportunityFeedItemId: f2, observedAt: '2026-10-05T00:00:00.000Z' }, { insert: pgInserter }))
        .toMatchObject({ status: 'inserted', role: 'contributing' });
      expect(await recordSourceContribution({ ...base, leadCreated: false, sourceCategory: 'crm', platform: 'hubspot', externalRef: 'hubspot:42', observedAt: '2026-10-06T00:00:00.000Z' }, { insert: pgInserter }))
        .toMatchObject({ status: 'inserted', role: 'contributing' });

      // 2. Status per opportunity (existing 9-state vocabulary).
      for (const f of [f1, f2, fUnrelated]) await initialiseLifecycleForOpportunity({ organizationId: ORG_A, opportunityFeedItemId: f });
      await transitionLifecycle({ organizationId: ORG_A, opportunityFeedItemId: f1, to: 'triaged', actorUserId: u1, reasoning: 'r' });
      await transitionLifecycle({ organizationId: ORG_A, opportunityFeedItemId: f1, to: 'qualified', actorUserId: u1, reasoning: 'r' });
      await transitionLifecycle({ organizationId: ORG_A, opportunityFeedItemId: f2, to: 'triaged', actorUserId: u2, reasoning: 'r' });

      // 3. Owners per opportunity.
      await assignOpportunity({ organizationId: ORG_A, opportunityFeedItemId: f1, assignedToUserId: u1, assignedByUserId: null, role: 'owner' });
      await assignOpportunity({ organizationId: ORG_A, opportunityFeedItemId: f2, assignedToUserId: u2, assignedByUserId: null, role: 'owner' });

      // 4. Snooze ONLY f2.
      const now = new Date().toISOString();
      const until = new Date(Date.now() + 7 * 86_400_000).toISOString();
      const s = await snoozeOpportunity({ organizationId: ORG_A, opportunityFeedItemId: f2, until, setByUserId: u2, reason: 'after their hiring round', now });
      expect(iso(s.snoozed_until)).toBe(until);

      // 5. Read everything back with org-filtered selects and project.
      const { rows: feedRows } = await q(
        `SELECT id, organization_id, opportunity_type, platform, created_at FROM public.opportunity_feed_items WHERE organization_id = $1 AND id = ANY($2)`,
        [ORG_A, [f1, f2]]);
      const feedItems: FeedItemOpportunityRow[] = feedRows.map((r: any) => ({
        id: r.id, organizationId: r.organization_id, opportunityType: r.opportunity_type, platform: r.platform, createdAt: iso(r.created_at),
      }));
      const norm = (r: any) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]));
      const assignments = (await q(`SELECT * FROM public.opportunity_assignments WHERE organization_id = $1`, [ORG_A])).rows.map(norm) as OpportunityAssignment[];
      const dispositions = (await q(`SELECT * FROM public.opportunity_dispositions WHERE organization_id = $1`, [ORG_A])).rows.map(norm) as OpportunityDisposition[];
      const view = buildProspectOpportunities({
        organizationId: ORG_A,
        prospectId: lead,
        contributions: await contributionsOf(lead),
        feedItems,
        lifecycle: { [f1]: await readCurrentLifecycleState(ORG_A, f1), [f2]: await readCurrentLifecycleState(ORG_A, f2) },
        assignments,
        dispositions,
        asOf: now,
      });

      expect(view.anomalies).toEqual([]);
      expect(view.opportunities.map((o) => ({
        id: o.opportunityRef.id,
        type: o.opportunityType,
        owner: o.owner.kind === 'assigned' ? o.owner.userId : o.owner.kind,
        state: o.status.kind === 'present' ? o.status.state : o.status.kind,
        changedBy: o.status.kind === 'present' ? o.status.changedBy : null,
        snooze: o.snooze?.kind,
        snoozedUntil: o.snoozedUntil,
      }))).toEqual([
        { id: f1, type: 'buying_intent', owner: u1, state: 'qualified', changedBy: u1, snooze: 'none', snoozedUntil: null },
        { id: f2, type: 'hiring_signal', owner: u2, state: 'triaged', changedBy: u2, snooze: 'active', snoozedUntil: until },
      ]);

      // Attribution: prospect-level, shared, intact; each opportunity cites only its own contribution.
      expect(view.sourceAttribution.originating?.externalRef).toBe('community:f1');
      expect(view.sourceAttribution.contributing.map((c) => c.externalRef)).toEqual(['community:f2', 'hubspot:42']);
      const [o1, o2] = view.opportunities;
      expect(o1.citingContributionIds).toEqual([view.sourceAttribution.originating!.id]);
      expect(o2.citingContributionIds).toEqual([view.sourceAttribution.contributing[0].id]);

      // Snooze did not touch any status, nor the unrelated opportunity.
      expect(await readCurrentLifecycleState(ORG_A, f2)).toMatchObject({ kind: 'present', state: 'triaged' });
      expect(await readOpportunitySnooze(ORG_A, f1, now)).toEqual({ kind: 'none' });
      expect(await readOpportunitySnooze(ORG_A, fUnrelated, now)).toEqual({ kind: 'none' });
      expect(Number((await q(`SELECT count(*) n FROM public.opportunity_dispositions WHERE opportunity_feed_item_id <> $1`, [f2])).rows[0].n)).toBe(0);

      // 6. Expiry by time alone, and the due list.
      const afterExpiry = new Date(Date.parse(until) + 1000).toISOString();
      expect(await readOpportunitySnooze(ORG_A, f2, afterExpiry)).toMatchObject({ kind: 'expired', until });
      expect((await listExpiredOpportunitySnoozes(ORG_A, afterExpiry)).map((d) => d.opportunityFeedItemId)).toEqual([f2]);
      expect(await listExpiredOpportunitySnoozes(ORG_A, now)).toEqual([]);
      expect(await listExpiredOpportunitySnoozes(ORG_B, afterExpiry)).toEqual([]);

      // 7. Early unsnooze appends; history keeps both rows.
      const un = await unsnoozeOpportunity({ organizationId: ORG_A, opportunityFeedItemId: f2, setByUserId: u1, reason: 'replied', now });
      expect(un).not.toBeNull();
      expect(await readOpportunitySnooze(ORG_A, f2, now)).toEqual({ kind: 'none' });
      expect((await listOpportunitySnoozeHistory(ORG_A, f2)).map((d) => [d.snoozed_until ? iso(d.snoozed_until) : null, (d.metadata as any).snooze_action]))
        .toEqual([[until, 'snooze'], [null, 'unsnooze']]);
      expect(await listExpiredOpportunitySnoozes(ORG_A, afterExpiry)).toEqual([]);
    });
  });
});

describe('database constraints behind the workflow (20270108000000)', () => {
  it('snoozed_until is only storable on revisit_later (23514)', async () => {
    await inRollback(async () => {
      await seedTenants();
      const f = await feed(ORG_A, 'buying_intent');
      expect(await violated(
        `INSERT INTO public.opportunity_dispositions (organization_id, opportunity_feed_item_id, disposition, snoozed_until) VALUES ($1,$2,'qualified', now() + interval '1 day')`,
        [ORG_A, f])).toBe('23514:opp_disposition_snooze_requires_revisit_later');
      expect(await violated(
        `INSERT INTO public.opportunity_dispositions (organization_id, opportunity_feed_item_id, disposition, snoozed_until) VALUES ($1,$2,'revisit_later', now() + interval '1 day')`,
        [ORG_A, f])).toBe('ok');
    });
  });

  it('a cross-tenant snooze or assignment is refused by the composite FK (23503), via the service too', async () => {
    await inRollback(async () => {
      await seedTenants();
      const u = await user('x');
      const fA = await feed(ORG_A, 'buying_intent');
      expect(await violated(
        `INSERT INTO public.opportunity_dispositions (organization_id, opportunity_feed_item_id, disposition) VALUES ($1,$2,'revisit_later')`,
        [ORG_B, fA])).toBe('23503:opp_dispositions_item_tenant_fk');
      expect(await violated(
        `INSERT INTO public.opportunity_assignments (organization_id, opportunity_feed_item_id, assigned_to_user_id, role) VALUES ($1,$2,$3,'owner')`,
        [ORG_B, fA, u])).toBe('23503:opp_assignments_item_tenant_fk');
      await expect(snoozeOpportunity({
        organizationId: ORG_B, opportunityFeedItemId: fA, until: new Date(Date.now() + 86_400_000).toISOString(), setByUserId: null, reason: null,
      })).rejects.toThrow(/snooze_insert_failed:.*opp_dispositions_item_tenant_fk/);
      await expect(assignOpportunity({ organizationId: ORG_B, opportunityFeedItemId: fA, assignedToUserId: u, assignedByUserId: null, role: 'owner' }))
        .rejects.toThrow(/assignment_insert_failed:.*opp_assignments_item_tenant_fk/);
    });
  });

  it('a second ACTIVE owner for one item is refused (23505); a closed one and another role are fine', async () => {
    await inRollback(async () => {
      await seedTenants();
      const u1 = await user('o1');
      const u2 = await user('o2');
      const f = await feed(ORG_A, 'buying_intent');
      const ins = `INSERT INTO public.opportunity_assignments (organization_id, opportunity_feed_item_id, assigned_to_user_id, role, unassigned_at) VALUES ($1,$2,$3,$4,$5)`;
      expect(await violated(ins, [ORG_A, f, u1, 'owner', null])).toBe('ok');
      expect(await violated(ins, [ORG_A, f, u2, 'owner', null])).toBe('23505:uq_opp_assignment_one_active');
      expect(await violated(ins, [ORG_A, f, u2, 'owner', '2026-10-01T00:00:00Z'])).toBe('ok');
      expect(await violated(ins, [ORG_A, f, u2, 'reviewer', null])).toBe('ok');
    });
  });

  it('assignOpportunity reassigns through the index: exactly one active owner, history kept', async () => {
    await inRollback(async () => {
      await seedTenants();
      const u1 = await user('r1');
      const u2 = await user('r2');
      const f = await feed(ORG_A, 'buying_intent');
      await assignOpportunity({ organizationId: ORG_A, opportunityFeedItemId: f, assignedToUserId: u1, assignedByUserId: null, role: 'owner' });
      await assignOpportunity({ organizationId: ORG_A, opportunityFeedItemId: f, assignedToUserId: u2, assignedByUserId: u1, role: 'owner' });
      const { rows } = await q(
        `SELECT assigned_to_user_id, unassigned_at IS NULL AS active FROM public.opportunity_assignments WHERE opportunity_feed_item_id = $1 ORDER BY created_at`, [f]);
      expect(rows).toEqual([{ assigned_to_user_id: u1, active: false }, { assigned_to_user_id: u2, active: true }]);
    });
  });

  it('the expiry lookup is served by the partial index shape the migration declares', async () => {
    const { rows } = await q(
      `SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='idx_opp_dispositions_snooze_expiry'`);
    expect(rows[0].indexdef).toMatch(/\(organization_id, snoozed_until\) WHERE \(snoozed_until IS NOT NULL\)/);
    const col = await q(
      `SELECT data_type, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='opportunity_dispositions' AND column_name='snoozed_until'`);
    expect(col.rows[0]).toEqual({ data_type: 'timestamp with time zone', is_nullable: 'YES' });
  });
});
