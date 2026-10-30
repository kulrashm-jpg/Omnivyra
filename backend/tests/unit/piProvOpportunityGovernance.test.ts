/**
 * Closure-D — opportunity lifecycle governance (migration
 * 20270109000003_pi_opportunity_governance.sql), application side and the
 * migration text.
 *
 *   1. Snooze is refused on a snooze-terminal opportunity (converted,
 *      dismissed, archived) by snoozeOpportunity, before any write, and a
 *      database refusal of the same rule surfaces as the SAME error.
 *   2. The database list of terminal states equals the application list.
 *   3. opportunity_dispositions is append-only in the migration, with a
 *      refusal the existing guard classifier recognises; the service never
 *      updates or deletes a disposition.
 *   4. Composite tenant FKs for lifecycle states and notes.
 *
 * The database behaviour itself is proven against real PostgreSQL in
 * backend/tests/realschema/pi_prov_opportunity_governance.test.ts.
 */

import * as fs from 'fs';
import * as path from 'path';

type Row = Record<string, any>;
const tables: Record<string, Row[]> = {};
let clock = 0;
let seq = 0;
/** Next disposition insert returns this error instead of writing (database refusal injection). */
let failNextDispositionInsert: { code: string; message: string } | null = null;
/** Next lifecycle read fails (read failure injection). */
let failNextLifecycleRead = false;

const tick = (): string => new Date(Date.UTC(2026, 9, 1, 0, 0, ++clock)).toISOString();

function fakeTable(table: string) {
  const st = {
    op: 'select' as 'select' | 'insert' | 'update' | 'delete',
    payload: null as Row | null,
    filters: [] as Array<(r: Row) => boolean>,
    order: [] as Array<{ col: string; asc: boolean }>,
    limit: null as number | null,
  };
  const rows = () => (tables[table] ??= []);
  const exec = async (mode: 'many' | 'maybe' | 'single') => {
    if (st.op === 'insert') {
      if (table === 'opportunity_dispositions' && failNextDispositionInsert) {
        const error = failNextDispositionInsert;
        failNextDispositionInsert = null;
        return { data: null, error };
      }
      const row: Row = { id: `${table}-${++seq}`, metadata: {}, ...st.payload };
      if (table === 'opportunity_lifecycle_states') row.transitioned_at ??= tick();
      else row.created_at ??= tick();
      if (table === 'opportunity_dispositions') row.snoozed_until ??= null;
      rows().push(row);
      return { data: { ...row }, error: null };
    }
    if (st.op === 'update' || st.op === 'delete') {
      throw new Error(`test fake: unexpected ${st.op} on ${table}`);
    }
    if (table === 'opportunity_lifecycle_states' && failNextLifecycleRead) {
      failNextLifecycleRead = false;
      return { data: null, error: { code: '42501', message: 'permission denied for table opportunity_lifecycle_states' } };
    }
    let out = rows().filter((r) => st.filters.every((f) => f(r))).map((r) => ({ ...r }));
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
    delete: () => { st.op = 'delete'; return b; },
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
  readOpportunitySnooze,
  setOpportunityDisposition,
  snoozeOpportunity,
  unsnoozeOpportunity,
} from '../../services/opportunityWorkflowService';
import {
  initialiseLifecycleForOpportunity,
  isResolvedForAccountDeletion,
  transitionLifecycle,
} from '../../services/opportunityLifecycleService';
import { classifyLifecycleGuardError } from '../../services/lifecycleGuardErrors';
import {
  ALLOWED_LIFECYCLE_TRANSITIONS,
  LIFECYCLE_STATES,
  type LifecycleState,
} from '../../types/opportunityLifecycle';
import {
  isSnoozeTerminalState,
  OpportunitySnoozeRefusedError,
  SNOOZE_TERMINAL_CONSTRAINT,
  SNOOZE_TERMINAL_LIFECYCLE_STATES,
  snoozeRefusalFromDbError,
} from '../../../lib/prospectOpportunity/snooze';

const ROOT = path.resolve(__dirname, '../../..');
const MIGRATION = path.join(ROOT, 'supabase/migrations/20270109000003_pi_opportunity_governance.sql');
const SQL = fs.readFileSync(MIGRATION, 'utf8');
/** SQL with `--` comments removed, so assertions see statements, not prose. */
const STMTS = SQL.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

const ORG = '00000000-0000-4000-8000-00000000000a';
const F1 = 'feed-1';
const U1 = 'user-1';
const NOW = '2026-10-30T09:00:00.000Z';
const LATER = '2026-11-06T09:00:00.000Z';

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  clock = 0;
  seq = 0;
  failNextDispositionInsert = null;
  failNextLifecycleRead = false;
  tables.opportunity_feed_items = [{ id: F1, organization_id: ORG }];
});

const snooze = () => snoozeOpportunity({
  organizationId: ORG, opportunityFeedItemId: F1, until: LATER, setByUserId: U1, reason: 'later', now: NOW,
});

/** Walks the shipped transition graph from detected to `target` (BFS, through the real service). */
async function driveTo(target: LifecycleState): Promise<void> {
  await initialiseLifecycleForOpportunity({ organizationId: ORG, opportunityFeedItemId: F1 });
  if (target === 'detected') return;
  const prev = new Map<LifecycleState, LifecycleState>();
  const queue: LifecycleState[] = ['detected'];
  while (queue.length) {
    const s = queue.shift()!;
    for (const n of ALLOWED_LIFECYCLE_TRANSITIONS[s]) {
      if (n === 'detected' || prev.has(n)) continue;
      prev.set(n, s);
      queue.push(n);
    }
  }
  const pathTo: LifecycleState[] = [];
  for (let s: LifecycleState | undefined = target; s && s !== 'detected'; s = prev.get(s)) pathTo.unshift(s);
  for (const to of pathTo) {
    await transitionLifecycle({ organizationId: ORG, opportunityFeedItemId: F1, to, actorUserId: U1, reasoning: 'test' });
  }
}

const dispositions = () => tables.opportunity_dispositions ?? [];
const NON_TERMINAL = LIFECYCLE_STATES.filter((s) => !(SNOOZE_TERMINAL_LIFECYCLE_STATES as readonly string[]).includes(s));

describe('snooze-terminal definition', () => {
  it('is exactly converted, dismissed, archived — a subset of the existing 9-state vocabulary', () => {
    expect([...SNOOZE_TERMINAL_LIFECYCLE_STATES].sort()).toEqual(['archived', 'converted', 'dismissed']);
    for (const s of SNOOZE_TERMINAL_LIFECYCLE_STATES) expect(LIFECYCLE_STATES).toContain(s);
    expect(LIFECYCLE_STATES).toHaveLength(9);
    expect(NON_TERMINAL).toEqual(['detected', 'triaged', 'reviewing', 'qualified', 'monitoring', 'outreach_planned']);
  });

  it('is NOT the account-deletion sense of terminal (FR-A38: archived only), which stays unchanged', () => {
    const present = (state: LifecycleState) => ({ kind: 'present' as const, state, isInitial: false, record: {} as any });
    expect(isResolvedForAccountDeletion(present('archived'))).toBe(true);
    expect(isResolvedForAccountDeletion(present('converted'))).toBe(false);
    expect(isResolvedForAccountDeletion(present('dismissed'))).toBe(false);
  });

  it('every non-terminal state is reachable again only through the graph: dismissed reopens to triaged', () => {
    expect(ALLOWED_LIFECYCLE_TRANSITIONS.dismissed).toContain('triaged');
    expect(ALLOWED_LIFECYCLE_TRANSITIONS.converted).toEqual(['archived']);
    expect(ALLOWED_LIFECYCLE_TRANSITIONS.archived).toEqual([]);
  });

  it('isSnoozeTerminalState rejects non-strings and unknown words', () => {
    expect(isSnoozeTerminalState('archived')).toBe(true);
    expect(isSnoozeTerminalState('qualified')).toBe(false);
    expect(isSnoozeTerminalState('closed')).toBe(false);
    expect(isSnoozeTerminalState(null)).toBe(false);
  });

  it('the database guard lists the same three states (every occurrence in the migration)', () => {
    const lists = [...STMTS.matchAll(/state IN \(([^)]*)\)/g)].map((m) => m[1].split(',').map((s) => s.trim().replace(/'/g, '')).sort());
    // preflight notice, guard predicate, guard ORDER BY, guard IF
    expect(lists.length).toBeGreaterThanOrEqual(3);
    for (const l of lists) expect(l).toEqual([...SNOOZE_TERMINAL_LIFECYCLE_STATES].sort());
  });
});

describe('snooze refused on a terminal opportunity — application layer', () => {
  it.each(SNOOZE_TERMINAL_LIFECYCLE_STATES.map((s) => [s]))('%s: refused before any write', async (state) => {
    await driveTo(state as LifecycleState);
    const err = await snooze().catch((e) => e);
    expect(err).toBeInstanceOf(OpportunitySnoozeRefusedError);
    expect(err).toMatchObject({ reason: 'terminal', state, source: 'application', message: `snooze_refused_terminal:${state}` });
    expect(dispositions()).toEqual([]);
  });

  it.each(NON_TERMINAL.map((s) => [s]))('%s: allowed, and the status is unchanged', async (state) => {
    await driveTo(state as LifecycleState);
    const before = (tables.opportunity_lifecycle_states ?? []).length;
    const row = await snooze();
    expect(row).toMatchObject({ disposition: 'revisit_later', snoozed_until: LATER });
    expect((tables.opportunity_lifecycle_states ?? []).length).toBe(before);
  });

  it('no lifecycle history (missing) is not terminal: allowed, as the database guard allows it', async () => {
    await expect(snooze()).resolves.toMatchObject({ snoozed_until: LATER });
  });

  it('an unreadable lifecycle fails closed: refused with lifecycle_unreadable, nothing written', async () => {
    failNextLifecycleRead = true;
    const err = await snooze().catch((e) => e);
    expect(err).toBeInstanceOf(OpportunitySnoozeRefusedError);
    expect(err.reason).toBe('lifecycle_unreadable');
    expect(err.message).toMatch(/^snooze_refused_lifecycle_unreadable:read_failed:/);
    expect(dispositions()).toEqual([]);
  });

  it('a dismissed opportunity reopened to triaged can be snoozed again', async () => {
    await driveTo('dismissed');
    await expect(snooze()).rejects.toThrow('snooze_refused_terminal:dismissed');
    await transitionLifecycle({ organizationId: ORG, opportunityFeedItemId: F1, to: 'triaged', actorUserId: U1, reasoning: 'reopen' });
    await expect(snooze()).resolves.toMatchObject({ snoozed_until: LATER });
  });

  it('only TIMED snoozes are refused: untimed revisit_later and other dispositions are still recorded on a terminal opportunity', async () => {
    await driveTo('archived');
    await expect(setOpportunityDisposition({ organizationId: ORG, opportunityFeedItemId: F1, disposition: 'revisit_later', reason: null, setByUserId: U1 }))
      .resolves.toMatchObject({ snoozed_until: null });
    await expect(setOpportunityDisposition({ organizationId: ORG, opportunityFeedItemId: F1, disposition: 'not_relevant', reason: null, setByUserId: U1 }))
      .resolves.toMatchObject({ disposition: 'not_relevant' });
  });

  it('a snooze taken before archiving can still be ended early (unsnooze writes an untimed row)', async () => {
    await driveTo('qualified');
    await snooze();
    await transitionLifecycle({ organizationId: ORG, opportunityFeedItemId: F1, to: 'archived', actorUserId: U1, reasoning: 'done' });
    expect((await readOpportunitySnooze(ORG, F1, NOW)).kind).toBe('active');
    await expect(unsnoozeOpportunity({ organizationId: ORG, opportunityFeedItemId: F1, setByUserId: U1, reason: null, now: NOW }))
      .resolves.toMatchObject({ snoozed_until: null });
    expect((await readOpportunitySnooze(ORG, F1, NOW)).kind).toBe('none');
  });
});

describe('snooze refused on a terminal opportunity — database refusal maps to the same error', () => {
  const dbMessage = (state: string) =>
    `${SNOOZE_TERMINAL_CONSTRAINT}: opportunity ${F1} is ${state}; a converted, dismissed or archived opportunity cannot be snoozed`;

  it('a race (terminal transition after the service read) is reported as terminal, source database', async () => {
    failNextDispositionInsert = { code: '23514', message: dbMessage('archived') };
    const err = await snooze().catch((e) => e);
    expect(err).toBeInstanceOf(OpportunitySnoozeRefusedError);
    expect(err).toMatchObject({ reason: 'terminal', state: 'archived', source: 'database', message: 'snooze_refused_terminal:archived' });
  });

  it('the revisit_later CHECK (also 23514) is NOT mistaken for the terminal guard', async () => {
    const check = { code: '23514', message: 'new row for relation "opportunity_dispositions" violates check constraint "opp_disposition_snooze_requires_revisit_later"' };
    expect(snoozeRefusalFromDbError(check)).toBeNull();
    failNextDispositionInsert = check;
    await expect(snooze()).rejects.toThrow(/^snooze_insert_failed:.*opp_disposition_snooze_requires_revisit_later/);
  });

  it('requires both the SQLSTATE and the constraint marker', () => {
    expect(snoozeRefusalFromDbError({ code: 'P0001', message: dbMessage('archived') })).toBeNull();
    expect(snoozeRefusalFromDbError({ code: '23514', message: 'something else' })).toBeNull();
    expect(snoozeRefusalFromDbError(null)).toBeNull();
    expect(snoozeRefusalFromDbError({ code: '23514', message: dbMessage('converted') })?.state).toBe('converted');
    expect(snoozeRefusalFromDbError({ code: '23514', message: dbMessage('weird') })?.state).toBeNull();
  });

  it('the migration raises exactly what the mapper recognises', () => {
    expect(STMTS).toMatch(/RAISE EXCEPTION 'opp_disposition_snooze_not_terminal: opportunity % is %;/);
    expect(STMTS).toMatch(/ERRCODE = '23514',\s*CONSTRAINT = 'opp_disposition_snooze_not_terminal'/);
    expect(STMTS).toMatch(/BEFORE INSERT ON public\.opportunity_dispositions\s+FOR EACH ROW\s+WHEN \(NEW\.snoozed_until IS NOT NULL\)/);
    // Serialises against a concurrent lifecycle insert (FK FOR KEY SHARE vs FOR UPDATE).
    expect(STMTS).toMatch(/FROM public\.opportunity_feed_items f[\s\S]*?FOR UPDATE;/);
  });
});

describe('append-only dispositions', () => {
  it('the migration installs BEFORE UPDATE and BEFORE DELETE row triggers that raise 42501 "append-only"', () => {
    expect(STMTS).toMatch(/CREATE TRIGGER opp_disposition_block_update\s+BEFORE UPDATE ON public\.opportunity_dispositions\s+FOR EACH ROW EXECUTE FUNCTION public\.trg_opp_disposition_block_mutation\(\)/);
    expect(STMTS).toMatch(/CREATE TRIGGER opp_disposition_block_delete\s+BEFORE DELETE ON public\.opportunity_dispositions\s+FOR EACH ROW EXECUTE FUNCTION public\.trg_opp_disposition_block_mutation\(\)/);
    expect(STMTS).toMatch(/'opportunity_dispositions is append-only \(DELETE refused\)'\s+USING ERRCODE = '42501'/);
    expect(STMTS).toMatch(/'opportunity_dispositions is append-only \(UPDATE refused\)'\s+USING ERRCODE = '42501'/);
  });

  it('admits only nested referential actions (cascade with the parent gone; SET NULL of a deleted user)', () => {
    const fn = STMTS.slice(STMTS.indexOf('trg_opp_disposition_block_mutation()\nRETURNS'), STMTS.indexOf('$fn$;', STMTS.indexOf('trg_opp_disposition_block_mutation()\nRETURNS')));
    expect(fn.match(/pg_trigger_depth\(\) > 1/g)).toHaveLength(2);
    expect(fn).toMatch(/NOT EXISTS \(SELECT 1 FROM public\.opportunity_feed_items f\s+WHERE f\.id = OLD\.opportunity_feed_item_id\)/);
    expect(fn).toMatch(/NOT EXISTS \(SELECT 1 FROM public\.companies c\s+WHERE c\.id = OLD\.organization_id\)/);
    expect(fn).toMatch(/\(to_jsonb\(NEW\) - 'set_by_user_id'\) = \(to_jsonb\(OLD\) - 'set_by_user_id'\)/);
  });

  it.each([
    ['DELETE', 'opportunity_dispositions is append-only (DELETE refused)'],
    ['UPDATE', 'opportunity_dispositions is append-only (UPDATE refused)'],
  ])('a %s refusal is classified as append_only_violation by the existing classifier', (_op, message) => {
    expect(classifyLifecycleGuardError({ code: '42501', message })).toMatchObject({ kind: 'append_only_violation', sqlstate: '42501' });
  });

  it('the workflow service never updates or deletes a disposition (every write is an insert)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'backend/services/opportunityWorkflowService.ts'), 'utf8');
    const calls = [...src.matchAll(/ownedDbTable\('opportunity_dispositions'\)\s*\.(\w+)/g)].map((m) => m[1]);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.filter((c) => c !== 'insert' && c !== 'select')).toEqual([]);
  });

  it('no SECURITY DEFINER, no grant, no RLS change in the migration', () => {
    expect(STMTS).not.toMatch(/SECURITY DEFINER/i);
    expect(STMTS).not.toMatch(/\bGRANT\b/i);
    expect(STMTS).not.toMatch(/ROW LEVEL SECURITY|CREATE POLICY|DROP POLICY/i);
    expect(STMTS.match(/SET search_path = pg_catalog, public/g)).toHaveLength(2);
  });
});

describe('tenant FKs and migration shape', () => {
  it.each([
    ['opportunity_lifecycle_states', 'opp_lifecycle_item_tenant_fk'],
    ['opportunity_notes', 'opp_notes_item_tenant_fk'],
  ])('%s gets composite FK %s → opportunity_feed_items(id, organization_id) ON DELETE CASCADE, name-guarded', (table, con) => {
    expect(STMTS).toContain(`WHERE conname = '${con}'`);
    expect(STMTS).toMatch(new RegExp(
      `ALTER TABLE public\\.${table}\\s+ADD CONSTRAINT ${con}\\s+FOREIGN KEY \\(opportunity_feed_item_id, organization_id\\)\\s+`
      + 'REFERENCES public\\.opportunity_feed_items \\(id, organization_id\\) ON DELETE CASCADE'));
  });

  it('preflight fails closed on cross-tenant rows and on missing prerequisites', () => {
    expect(STMTS).toMatch(/opportunity_lifecycle_states row\(s\) belong to a different tenant/);
    expect(STMTS).toMatch(/opportunity_notes row\(s\) belong to a different tenant/);
    expect(STMTS).toContain('uq_opportunity_feed_items_id_org missing');
    expect(STMTS).toContain('20270108000000 (snoozed_until, opp_dispositions_item_tenant_fk, uq_opp_assignment_one_active) is not applied');
  });

  it('is one transaction with a $verify$ postcondition block that covers all four tenant FKs', () => {
    expect(STMTS.trim().startsWith('BEGIN;')).toBe(true);
    expect(STMTS.trim().endsWith('COMMIT;')).toBe(true);
    const verify = STMTS.slice(STMTS.indexOf('DO $verify$'));
    for (const con of ['opp_lifecycle_item_tenant_fk', 'opp_notes_item_tenant_fk', 'opp_dispositions_item_tenant_fk', 'opp_assignments_item_tenant_fk']) {
      expect(verify).toContain(con);
    }
    expect(verify).toContain('uq_opp_assignment_one_active');
  });

  it('sorts after both migrations it depends on', () => {
    const files = fs.readdirSync(path.join(ROOT, 'supabase/migrations')).filter((f) => /^\d{14}_/.test(f)).sort();
    const at = (v: string) => files.findIndex((f) => f.startsWith(v));
    expect(at('20270109000003')).toBeGreaterThan(at('20270108000000'));
    expect(at('20270108000000')).toBeGreaterThan(at('20270107000000'));
    expect(at('20270107000000')).toBeGreaterThan(-1);
  });
});
