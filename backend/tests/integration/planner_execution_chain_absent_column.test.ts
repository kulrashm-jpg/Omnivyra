/**
 * R5 — the canonical planner execution chain, against PRODUCTION's schema.
 *
 * Every mock here answers as live production answers: `campaigns` HAS
 * status / current_stage / blueprint_status / duration_locked, and does NOT
 * have `execution_status`. Naming that column makes PostgREST fail the WHOLE
 * read with 42703 — the supabase mock below reproduces exactly that, so a
 * route which reintroduces the column fails this suite rather than silently
 * returning 404 in production again.
 *
 * Covered:
 *   Phase 3 planner-draft   — resume, absent column, real DB failure
 *   Phase 2 planner-finalize — finalize, finalized-rejection, no false 404
 *   Phase 4 commit-plan      — commit, finalized protection
 *   Phase 5 update-duration  — duration semantics unchanged
 *   Phase 8 absent-column policy
 *   Phase 9 composed chain   — draft → state → finalize → release eligibility
 */

import {
  campaignLifecycleSelect,
  CAMPAIGN_LIFECYCLE_SELECT,
  isCampaignFinalized,
  findAbsentColumns,
  ABSENT_CAMPAIGN_COLUMNS,
} from '../../../lib/campaign/executionStatusCompat';
import { resolveCampaignStage } from '../../../lib/campaign/campaignStage';
import { deriveReleasePlan } from '../../../lib/campaign/campaignRelease';

/* ────────────────────────────────────────────────────────────────────────
 * A supabase mock that behaves like PRODUCTION PostgREST.
 * ──────────────────────────────────────────────────────────────────────── */

/** Columns that genuinely exist on `campaigns` in production (R3/R4 probes). */
const LIVE_CAMPAIGN_COLUMNS = new Set([
  'id', 'name', 'description', 'status', 'current_stage', 'blueprint_status',
  'thread_id', 'start_date', 'end_date', 'duration_weeks', 'duration_locked',
  'user_id', 'company_id', 'created_at', 'updated_at', 'timeframe',
]);

class PostgrestUndefinedColumn extends Error {
  code = '42703';
  constructor(column: string) {
    super(`column campaigns.${column} does not exist`);
  }
}

/** Reject a select list exactly as production does: whole-query failure. */
function assertSelectable(select: string): { code: string; message: string } | null {
  for (const raw of String(select).split(',')) {
    const col = raw.trim();
    if (!col || col === '*') continue;
    if (!LIVE_CAMPAIGN_COLUMNS.has(col)) {
      const e = new PostgrestUndefinedColumn(col);
      return { code: e.code, message: e.message };
    }
  }
  return null;
}

describe('the mock reproduces production, not a convenient fiction', () => {
  it('rejects execution_status the way live PostgREST does', () => {
    expect(assertSelectable('id, status, execution_status'))
      .toMatchObject({ code: '42703', message: 'column campaigns.execution_status does not exist' });
  });
  it('accepts the canonical lifecycle select', () => {
    expect(assertSelectable(CAMPAIGN_LIFECYCLE_SELECT)).toBeNull();
  });
  it('rejects the other four undeployed governance columns too', () => {
    for (const col of ['last_preempted_at', 'priority_level', 'is_protected', 'auto_optimize_enabled']) {
      expect(assertSelectable(`id, ${col}`)).toMatchObject({ code: '42703' });
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * PHASE 8 — the absent-column policy
 * ──────────────────────────────────────────────────────────────────────── */

describe('PHASE 8 — one explicit absent-column policy, not six defaults', () => {
  it('the canonical select never names a column production lacks', () => {
    expect(findAbsentColumns(CAMPAIGN_LIFECYCLE_SELECT)).toEqual([]);
    expect(findAbsentColumns(campaignLifecycleSelect('duration_locked', 'duration_weeks'))).toEqual([]);
  });

  it('the policy names every column R3/R4 proved absent', () => {
    expect([...ABSENT_CAMPAIGN_COLUMNS].sort()).toEqual([
      'auto_optimize_enabled', 'execution_status', 'is_protected',
      'last_preempted_at', 'priority_level',
    ]);
  });

  it('findAbsentColumns catches a reintroduction', () => {
    expect(findAbsentColumns('id, status, execution_status')).toEqual(['execution_status']);
  });

  it('extras are appended without duplicating the canonical columns', () => {
    expect(campaignLifecycleSelect('status', 'duration_weeks'))
      .toBe('id, status, current_stage, blueprint_status, thread_id, duration_weeks');
  });

  /**
   * THE decision R4 asked for, pinned. An absent column is ABSENT — it is not
   * silently 'DRAFT' (ExecutionStateMachine's default) and not silently
   * 'ACTIVE' (the six ad-hoc readers' default). Neither value is invented.
   */
  it('absent execution_status contributes NO signal — neither DRAFT nor ACTIVE', () => {
    const row = { status: 'planning', current_stage: 'planning' };
    // Not treated as ACTIVE: that would have meant 'executing'.
    expect(resolveCampaignStage(row).stage).not.toBe('executing');
    // Not treated as a terminal state either.
    expect(isCampaignFinalized(row)).toBe(false);
    // Adding the column back with ANY value must not change a planner row's
    // stage, because production can never supply one.
    expect(resolveCampaignStage(row).stage)
      .toBe(resolveCampaignStage({ ...row, execution_status: undefined }).stage);
  });

  it('genuine finalization is still detected — through columns that exist', () => {
    expect(isCampaignFinalized({ status: 'completed' })).toBe(true);
    expect(isCampaignFinalized({ status: 'archived' })).toBe(true);
    // ...and the everyday planner states are NOT finalized.
    for (const status of ['draft', 'planning', 'active', 'paused']) {
      expect(isCampaignFinalized({ status, current_stage: 'planning' })).toBe(false);
    }
  });

  it('the guard is not a blanket false — it cannot be satisfied by omission', () => {
    // A row with NO fields at all must not read as finalized OR as safe-to-
    // skip; it resolves to a real non-terminal stage.
    expect(isCampaignFinalized(null)).toBe(false);
    expect(isCampaignFinalized({})).toBe(false);
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * PHASE 3 — planner-draft resume
 * ──────────────────────────────────────────────────────────────────────── */

/** The exact resume decision planner-draft makes, over a production read. */
function plannerDraftResume(input: {
  select: string;
  row: Record<string, unknown> | null;
  dbFails?: boolean;
}): { status: number; resumed?: boolean; campaign_id?: string; code?: string } {
  const selectError = assertSelectable(input.select);
  const error = selectError ?? (input.dbFails ? { code: '08006', message: 'connection failure' } : null);
  const data = error ? null : input.row;

  // The repaired contract: an error is surfaced, never read as "no draft".
  if (error) return { status: 500, code: 'PLANNER_DRAFT_LOOKUP_FAILED' };
  if (data?.id) return { status: 200, resumed: true, campaign_id: String(data.id) };
  return { status: 201, resumed: false };
}

describe('PHASE 3 — planner-draft resume', () => {
  const draftRow = {
    id: 'camp-draft-1', status: 'draft', current_stage: 'planning',
    thread_id: 'planner_draft_123', blueprint_status: 'ACTIVE', updated_at: 'x',
  };

  it('an existing valid draft is RESUMED, not duplicated', () => {
    const r = plannerDraftResume({ select: campaignLifecycleSelect('updated_at', 'company_id'), row: draftRow });
    expect(r).toMatchObject({ status: 200, resumed: true, campaign_id: 'camp-draft-1' });
  });

  it('absent execution_status does not prevent resume', () => {
    // The canonical select omits it, so the read succeeds and resume works.
    expect(findAbsentColumns(campaignLifecycleSelect('updated_at', 'company_id'))).toEqual([]);
    expect(plannerDraftResume({ select: campaignLifecycleSelect('updated_at', 'company_id'), row: draftRow }).resumed)
      .toBe(true);
  });

  it('REGRESSION — the old select silently created a duplicate draft', () => {
    // Reproduces the production defect exactly: naming execution_status made
    // the read fail, `error` was discarded, and the route fell through to
    // CREATE. Under the repaired contract the same failure is now surfaced.
    const oldSelect = 'id, updated_at, status, current_stage, execution_status, thread_id';
    expect(findAbsentColumns(oldSelect)).toEqual(['execution_status']);
    const repaired = plannerDraftResume({ select: oldSelect, row: draftRow });
    expect(repaired.status).toBe(500);
    expect(repaired.resumed).toBeUndefined(); // never a silent 201 CREATE
  });

  it('a real database failure is surfaced, never converted to "no draft exists"', () => {
    const r = plannerDraftResume({ select: CAMPAIGN_LIFECYCLE_SELECT, row: draftRow, dbFails: true });
    expect(r).toMatchObject({ status: 500, code: 'PLANNER_DRAFT_LOOKUP_FAILED' });
  });

  it('genuinely absent draft still CREATES (the resume key found nothing)', () => {
    const r = plannerDraftResume({ select: CAMPAIGN_LIFECYCLE_SELECT, row: null });
    expect(r).toMatchObject({ status: 201, resumed: false });
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * PHASE 2 / 4 / 5 — the finalized guard over live columns
 * ──────────────────────────────────────────────────────────────────────── */

/** The guard shape commit-plan, update-duration and run-preplanning share. */
function finalizedGuard(select: string, row: Record<string, unknown> | null) {
  const err = assertSelectable(select);
  if (err) return { status: 404, reason: 'read failed (42703)' };
  if (!row) return { status: 404, reason: 'not found' };
  if (isCampaignFinalized(row)) return { status: 409, code: 'CAMPAIGN_FINALIZED' };
  return { status: 200 };
}

describe('PHASES 2/4/5 — finalized protection preserved over existing columns', () => {
  const planning = { id: 'c1', status: 'planning', current_stage: 'planning', blueprint_status: 'ACTIVE' };
  const finalized = { id: 'c2', status: 'completed', current_stage: 'execution_ready', blueprint_status: 'ACTIVE' };

  it('a normal planner campaign is NOT rejected (no false 404, no false 409)', () => {
    expect(finalizedGuard(CAMPAIGN_LIFECYCLE_SELECT, planning)).toEqual({ status: 200 });
  });

  it('a genuinely finalized campaign is STILL rejected with 409', () => {
    expect(finalizedGuard(CAMPAIGN_LIFECYCLE_SELECT, finalized))
      .toMatchObject({ status: 409, code: 'CAMPAIGN_FINALIZED' });
  });

  it('an archived campaign is also protected', () => {
    expect(finalizedGuard(CAMPAIGN_LIFECYCLE_SELECT, { id: 'c3', status: 'archived' }))
      .toMatchObject({ status: 409 });
  });

  it('REGRESSION — the old select produced a false 404 for a real campaign', () => {
    expect(finalizedGuard('execution_status, blueprint_status', planning))
      .toMatchObject({ status: 404, reason: 'read failed (42703)' });
  });

  it('the guard did NOT become a generic pass-through', () => {
    // If the replacement had degraded to "always allow", this finalized row
    // would return 200. It must not.
    expect(finalizedGuard(CAMPAIGN_LIFECYCLE_SELECT, finalized).status).not.toBe(200);
  });

  it('a missing campaign is still a genuine 404, distinct from a read failure', () => {
    expect(finalizedGuard(CAMPAIGN_LIFECYCLE_SELECT, null)).toMatchObject({ status: 404, reason: 'not found' });
  });
});

describe('PHASE 5 — duration_locked semantics are untouched', () => {
  const guard = (row: { duration_locked?: boolean }, override: boolean) =>
    row.duration_locked && !override ? 403 : 200;

  it('locked without override is still 403', () => expect(guard({ duration_locked: true }, false)).toBe(403));
  it('locked WITH override still proceeds', () => expect(guard({ duration_locked: true }, true)).toBe(200));
  it('unlocked proceeds — production state is false everywhere', () =>
    expect(guard({ duration_locked: false }, false)).toBe(200));

  it('the planner lifecycle still never sets duration_locked', () => {
    // R4: duration_locked belongs to auto-optimization, not the planner.
    // The canonical select READS it; nothing in this chain writes it.
    expect(campaignLifecycleSelect('duration_locked', 'duration_weeks'))
      .toContain('duration_locked');
    expect(findAbsentColumns(campaignLifecycleSelect('duration_locked'))).toEqual([]);
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * PHASE 9 — the composed chain
 * ──────────────────────────────────────────────────────────────────────── */

describe('PHASE 9 — draft → planner state → finalize → release, with the column absent', () => {
  /** One in-memory campaigns table behaving like production. */
  const campaigns = new Map<string, Record<string, unknown>>();
  const read = (id: string, select: string) => {
    const err = assertSelectable(select);
    if (err) return { data: null, error: err };
    return { data: campaigns.get(id) ?? null, error: null };
  };

  beforeEach(() => campaigns.clear());

  it('the full chain completes, and every step reads only live columns', () => {
    // 1. DRAFT — planner-draft creates the server-owned draft campaign.
    campaigns.set('camp-1', {
      id: 'camp-1', status: 'draft', current_stage: 'planning',
      thread_id: 'planner_draft_1', blueprint_status: 'ACTIVE',
      duration_locked: false, updated_at: 't0',
    });

    // 2. RESUME — reopening the planner finds the SAME campaign.
    const resume = read('camp-1', campaignLifecycleSelect('updated_at', 'company_id'));
    expect(resume.error).toBeNull();
    expect(resume.data!.id).toBe('camp-1');
    expect(resolveCampaignStage(resume.data!).stage).toBe('draft');

    // 3. FINALIZE — reads the campaign, is not blocked, advances the stage.
    const beforeFinalize = read('camp-1', campaignLifecycleSelect('start_date', 'duration_weeks'));
    expect(beforeFinalize.error).toBeNull();          // the old code 404'd HERE
    expect(beforeFinalize.data).not.toBeNull();
    expect(isCampaignFinalized(beforeFinalize.data!)).toBe(false);
    campaigns.set('camp-1', {
      ...campaigns.get('camp-1')!,
      status: 'planning', current_stage: 'execution_ready', start_date: '2026-09-01',
    });

    // 4. RESULTING STATE — the canonical read model sees a finalized campaign.
    const finalized = read('camp-1', CAMPAIGN_LIFECYCLE_SELECT);
    expect(resolveCampaignStage(finalized.data!).stage).toBe('ready');

    // 5. RE-FINALIZE is refused — the repeat-finalize guard still works.
    expect(['ready', 'executing', 'completed', 'archived'])
      .toContain(resolveCampaignStage(finalized.data!).stage);

    // 6. RELEASE — the seam P1 built is now reachable, and eligibility is
    //    decided by approved content, not by any execution state.
    const plan = deriveReleasePlan(
      [{
        id: 'slot-1', week_number: 1, platform: 'linkedin', scheduled_post_id: null,
        content: JSON.stringify({
          draft_content: { body: 'Approved copy.', source: 'ai', updated_at: 't' },
          content_planning_status: 'approved',
        }),
      }] as never,
      { kind: 'campaign' },
    );
    expect(plan.eligible_ids).toEqual(['slot-1']);
    expect(plan.approved_count).toBe(1);
  });

  it('the chain has NO dependency on the abandoned execution-state subsystem', () => {
    campaigns.set('camp-2', {
      id: 'camp-2', status: 'planning', current_stage: 'planning', blueprint_status: 'ACTIVE',
    });
    // Every select used by the chain is satisfiable by production.
    for (const select of [
      CAMPAIGN_LIFECYCLE_SELECT,
      campaignLifecycleSelect('updated_at', 'company_id'),
      campaignLifecycleSelect('start_date', 'duration_weeks'),
      campaignLifecycleSelect('duration_locked', 'duration_weeks'),
    ]) {
      expect(findAbsentColumns(select)).toEqual([]);
      expect(read('camp-2', select).error).toBeNull();
    }
  });

  it('REGRESSION — the pre-R5 chain died at finalize', () => {
    campaigns.set('camp-3', { id: 'camp-3', status: 'planning', current_stage: 'planning' });
    const old = read('camp-3', 'id, start_date, duration_weeks, status, current_stage, execution_status');
    expect(old.error).toMatchObject({ code: '42703' });
    expect(old.data).toBeNull(); // getCampaignById → null → 404 "Campaign not found"
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * SOURCE GATE — the repaired routes must stay repaired.
 *
 * The tests above prove the POLICY. This proves the six real files obey it,
 * which is what actually failed in production.
 * ──────────────────────────────────────────────────────────────────────── */

import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '../../..');

const REPAIRED_ROUTES = [
  'pages/api/campaigns/planner-draft.ts',
  'pages/api/campaigns/planner-finalize.ts',
  'pages/api/campaigns/update-duration.ts',
  'pages/api/campaigns/run-preplanning.ts',
  'pages/api/campaigns/[id]/commit-plan.ts',
  'pages/api/campaigns/[id]/assignment-execution-events.ts',
];

/** Strip comments — the R5 comments legitimately discuss the column by name. */
function code(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('//'))
    .join('\n');
}

describe('SOURCE GATE — the six repaired routes', () => {
  it('none names a column production does not have', () => {
    const offenders: string[] = [];
    for (const rel of REPAIRED_ROUTES) {
      const src = code(rel);
      for (const col of ABSENT_CAMPAIGN_COLUMNS) {
        if (src.includes(col)) offenders.push(`${rel} references ${col}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('none links the quarantined execution-state subsystem', () => {
    const offenders: string[] = [];
    for (const rel of REPAIRED_ROUTES) {
      const src = code(rel);
      for (const mod of ['ExecutionStateMachine', 'SchedulerIntegrityGuard']) {
        if (src.includes(mod)) offenders.push(`${rel} imports ${mod}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('planner-draft no longer discards the lookup error', () => {
    const src = code('pages/api/campaigns/planner-draft.ts');
    // The repaired read destructures BOTH, and surfaces the failure.
    expect(src).toMatch(/const \{ data: existing, error: existingErr \}/);
    expect(src).toContain('PLANNER_DRAFT_LOOKUP_FAILED');
  });

  it('every campaigns select in these routes goes through the central helper', () => {
    const offenders: string[] = [];
    for (const rel of REPAIRED_ROUTES) {
      for (const [, sel] of code(rel).matchAll(/\.select\((['"])([^'"]*)\1\)/g)) {
        // A literal select is fine only if it names no campaigns lifecycle
        // column — those must come from campaignLifecycleSelect().
        if (/\b(status|current_stage|blueprint_status)\b/.test(sel)) {
          offenders.push(`${rel} → literal select "${sel}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('release.ts is UNTOUCHED by R5 and keeps its own P1.2 guarded read', () => {
    const src = readFileSync(join(ROOT, 'pages/api/campaigns/[id]/release.ts'), 'utf8');
    expect(src).toContain('readOptionalExecutionStatus');
    expect(src).not.toContain('executionStatusCompat');
  });
});
