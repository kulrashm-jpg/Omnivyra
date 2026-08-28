/**
 * BLOCK-1 — a finalized campaign must never remain the active draft.
 *
 * The shipped failure: `plannerSessionStore` bootstrapped with
 * `urlDraftId || localDraftIdRef.current` and skipped create-or-resume
 * whenever that produced an id. The id is cached in company-scoped
 * localStorage and survives finalize, so re-entering the planner re-adopted
 * the finalized campaign (planner_state and all) and the next finalize
 * answered `400 Campaign already finalized`. A second campaign was
 * unreachable.
 *
 * This file covers the three seams that now enforce the invariant:
 *   1. the pure decision  (lib/campaign/plannerDraftLifecycle)
 *   2. the server guard   (GET/PUT /api/campaigns/[id]/planner-draft-state)
 *   3. the client mapping (components/planner/plannerDraftPersistence)
 *
 * plus the server-side proof that create-or-resume genuinely mints a NEW
 * draft once the first campaign has been finalized.
 */

type Row = Record<string, unknown>;

// ── Scripted supabase, with the filter chain RECORDED ────────────────────
// The resume lookup's `status='draft'` filter is the reason a finalized
// campaign can never be resumed, so the test asserts the filter itself
// rather than trusting a mock that ignores it.
let campaignsRow: Row | null = null;
let versionRow: { id: string; campaign_snapshot: Row } | null = null;
let campaignsError: { message: string } | null = null;
const inserted: Array<{ table: string; payload: Row }> = [];
const filters: Array<{ table: string; col: string; val: unknown }> = [];

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      const builder: any = {};
      for (const op of ['select', 'order', 'limit', 'like']) {
        builder[op] = () => builder;
      }
      builder.eq = (col: string, val: unknown) => { filters.push({ table, col, val }); return builder; };
      builder.maybeSingle = () => {
        if (table === 'campaigns') return Promise.resolve({ data: campaignsRow, error: campaignsError });
        if (table === 'campaign_versions') return Promise.resolve({ data: versionRow, error: null });
        return Promise.resolve({ data: null, error: null });
      };
      builder.insert = (payload: Row) => {
        inserted.push({ table, payload });
        return { then: (r: any) => Promise.resolve({ error: null }).then(r) };
      };
      builder.update = () => {
        const u: any = { eq: () => u, then: (r: any) => Promise.resolve({ error: null }).then(r) };
        return u;
      };
      return builder;
    },
  },
}));

jest.mock('../../security/TenantGuard', () => ({
  requireTenantAccess: jest.fn(async () => ({ userId: 'user-1', organizationId: 'co-1', bypass: false })),
  requireCampaignTenantAccess: jest.fn(async () => ({ userId: 'user-1', organizationId: 'co-1', bypass: false })),
}));

const mockFetchWithAuth = jest.fn();
jest.mock('../../../components/community-ai/fetchWithAuth', () => ({
  fetchWithAuth: (...args: unknown[]) => mockFetchWithAuth(...args),
}));

import {
  decideDraftBootstrap,
  probeOutcomeFromDraftState,
  DRAFT_FINALIZED_CODE,
} from '../../../lib/campaign/plannerDraftLifecycle';
import { resolveCampaignStage, isFinalizedStage } from '../../../lib/campaign/campaignStage';
import {
  fetchPlannerDraftState,
  savePlannerDraftState,
} from '../../../components/planner/plannerDraftPersistence';
import draftStateHandler from '../../../pages/api/campaigns/[id]/planner-draft-state';
import plannerDraftHandler from '../../../pages/api/campaigns/planner-draft';

/** Exactly what planner-finalize writes on success (planner-finalize.ts:788). */
const FINALIZED_ROW = { status: 'planning', current_stage: 'execution_ready', blueprint_status: 'ACTIVE' };
/** Exactly what planner-draft writes on create (planner-draft.ts:102). */
const DRAFT_ROW = { status: 'draft', current_stage: 'planning', thread_id: 'planner_draft_1' };

function mockRes() {
  const res: any = { statusCode: 0, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (p: unknown) => { res.body = p; return res; };
  return res;
}
const reply = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300, status, json: async () => body,
});

beforeEach(() => {
  campaignsRow = null;
  versionRow = null;
  campaignsError = null;
  inserted.length = 0;
  filters.length = 0;
  mockFetchWithAuth.mockReset();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

/* ── 1. The pure decision ─────────────────────────────────────────────── */

describe('decideDraftBootstrap — the stale id can never win', () => {
  it('no cached id → creates a draft', () => {
    expect(decideDraftBootstrap({ candidateId: null, probe: null }))
      .toEqual({ action: 'create', invalidateCache: false, reason: 'no_candidate' });
  });

  it('an ACTIVE cached id → resumes it', () => {
    expect(decideDraftBootstrap({ candidateId: 'draft-A', probe: 'usable' }))
      .toEqual({ action: 'resume', invalidateCache: false, reason: 'candidate_usable' });
  });

  it('a FINALIZED cached id → creates a new draft AND invalidates the cache', () => {
    expect(decideDraftBootstrap({ candidateId: 'campaign-A', probe: 'finalized' }))
      .toEqual({ action: 'create', invalidateCache: true, reason: 'candidate_finalized' });
  });

  it('a transient probe failure NEVER destroys the cached session', () => {
    // Offline is not evidence about the lifecycle. Wiping a user's work on a
    // network blip is worse than carrying a possibly-stale id one more entry.
    const d = decideDraftBootstrap({ candidateId: 'draft-A', probe: 'unreachable' });
    expect(d.action).toBe('resume');
    expect(d.invalidateCache).toBe(false);
  });

  it('a blank/whitespace id is no id at all', () => {
    expect(decideDraftBootstrap({ candidateId: '   ', probe: 'usable' }).action).toBe('create');
  });

  it('probeOutcomeFromDraftState separates a verdict from a failed request', () => {
    expect(probeOutcomeFromDraftState(null)).toBe('unreachable');
    expect(probeOutcomeFromDraftState({ finalized: true })).toBe('finalized');
    expect(probeOutcomeFromDraftState({ finalized: false })).toBe('usable');
  });
});

/* ── 2. The lifecycle interpretation this rests on ────────────────────── */

describe('the canonical read model classifies the two rows', () => {
  it('a planner draft row is NOT finalized; a finalized row IS', () => {
    expect(isFinalizedStage(resolveCampaignStage(DRAFT_ROW).stage)).toBe(false);
    expect(resolveCampaignStage(DRAFT_ROW).stage).toBe('draft');
    expect(isFinalizedStage(resolveCampaignStage(FINALIZED_ROW).stage)).toBe(true);
    expect(resolveCampaignStage(FINALIZED_ROW).stage).toBe('ready');
  });
});

/* ── 3. The server guard ──────────────────────────────────────────────── */

describe('planner-draft-state refuses a campaign that is no longer a draft', () => {
  const req = (method: string, body?: Row) => ({ method, query: { id: 'campaign-A' }, body }) as any;

  it('GET on a FINALIZED campaign → 409 DRAFT_FINALIZED (no planner_state leaks)', async () => {
    campaignsRow = FINALIZED_ROW;
    versionRow = { id: 'v1', campaign_snapshot: { planner_state: { idea_spine: { title: 'Campaign A' } }, planner_state_revision: 7 } };
    const res = mockRes();
    await draftStateHandler(req('GET'), res);
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ code: DRAFT_FINALIZED_CODE, stage: 'ready' });
    expect(res.body.planner_state).toBeUndefined();
  });

  it('PUT on a FINALIZED campaign → 409; a stale tab cannot write draft state into it', async () => {
    campaignsRow = FINALIZED_ROW;
    versionRow = { id: 'v1', campaign_snapshot: { planner_state: null, planner_state_revision: 0 } };
    const res = mockRes();
    await draftStateHandler(req('PUT', { planner_state: { idea_spine: { title: 'late edit' } }, baseRevision: 0 }), res);
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe(DRAFT_FINALIZED_CODE);
  });

  it('GET on a live DRAFT still returns its state — resume is untouched', async () => {
    campaignsRow = DRAFT_ROW;
    versionRow = { id: 'v1', campaign_snapshot: { planner_state: { idea_spine: { title: 'Draft A' } }, planner_state_revision: 3 } };
    const res = mockRes();
    await draftStateHandler(req('GET'), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ planner_state: { idea_spine: { title: 'Draft A' } }, revision: 3 });
  });

  it('a FAILED lifecycle read does not lock a legitimate draft out', async () => {
    // A transient DB error must not be reported as "finalized" — that would
    // convert a blip into permanent loss of the user's draft.
    campaignsError = { message: 'connection reset' };
    versionRow = { id: 'v1', campaign_snapshot: { planner_state: { idea_spine: { title: 'Draft A' } }, planner_state_revision: 1 } };
    const res = mockRes();
    await draftStateHandler(req('GET'), res);
    expect(res.statusCode).toBe(200);
  });
});

/* ── 4. Create-or-resume mints a genuinely new draft ──────────────────── */

describe('a second campaign is reachable once the first is finalized', () => {
  it('the resume lookup is constrained to status=draft, so a finalized campaign cannot be resumed', async () => {
    campaignsRow = null; // status='draft' matches nothing once A was finalized
    const res = mockRes();
    await plannerDraftHandler({ method: 'POST', body: { companyId: 'co-1' } } as any, res);

    // The filter itself is the guarantee — assert it, do not assume it.
    expect(filters).toContainEqual({ table: 'campaigns', col: 'status', val: 'draft' });
    expect(filters).toContainEqual({ table: 'campaigns', col: 'company_id', val: 'co-1' });
  });

  it('creates campaign B with a NEW id and an EMPTY planner_state', async () => {
    campaignsRow = null;
    const res = mockRes();
    await plannerDraftHandler({ method: 'POST', body: { companyId: 'co-1' } } as any, res);

    expect(res.statusCode).toBe(201);
    expect(res.body.resumed).toBe(false);
    expect(res.body.campaign_id).not.toBe('campaign-A');

    const snapshot = inserted.find((i) => i.table === 'campaign_versions')!.payload.campaign_snapshot as Row;
    // Campaign B must start empty — not carrying campaign A's plan.
    expect(snapshot.planner_state).toBeNull();
    expect(snapshot.planner_state_revision).toBe(0);
  });
});

/* ── 5. The client mapping ────────────────────────────────────────────── */

describe('the client distinguishes a lifecycle verdict from a failure', () => {
  it('fetchPlannerDraftState maps 409 DRAFT_FINALIZED to finalized=true', async () => {
    mockFetchWithAuth.mockResolvedValue(reply(409, { code: DRAFT_FINALIZED_CODE, stage: 'ready' }));
    await expect(fetchPlannerDraftState('campaign-A'))
      .resolves.toEqual({ plannerState: null, revision: 0, finalized: true });
  });

  it('fetchPlannerDraftState maps a live draft to finalized=false', async () => {
    mockFetchWithAuth.mockResolvedValue(reply(200, { planner_state: { idea_spine: { title: 'A' } }, revision: 2 }));
    await expect(fetchPlannerDraftState('draft-A'))
      .resolves.toEqual({ plannerState: { idea_spine: { title: 'A' } }, revision: 2, finalized: false });
  });

  it('a transient 500 returns null — NOT a finalized verdict', async () => {
    mockFetchWithAuth.mockResolvedValue(reply(500, { error: 'boom' }));
    await expect(fetchPlannerDraftState('draft-A')).resolves.toBeNull();
    expect(probeOutcomeFromDraftState(null)).toBe('unreachable');
  });

  it('an UNRECOGNISED 409 is not treated as a lifecycle verdict', async () => {
    mockFetchWithAuth.mockResolvedValue(reply(409, { error: 'something else' }));
    await expect(fetchPlannerDraftState('draft-A')).resolves.toBeNull();
  });

  it('savePlannerDraftState reports DRAFT_FINALIZED as terminal, not as a revision conflict', async () => {
    mockFetchWithAuth.mockResolvedValue(reply(409, { code: DRAFT_FINALIZED_CODE, stage: 'ready' }));
    const r = await savePlannerDraftState('campaign-A', { idea_spine: null }, 3);
    expect(r).toEqual({ ok: false, conflict: false, finalized: true });
  });

  it('savePlannerDraftState still adopts the server copy on a STALE-REVISION 409', async () => {
    mockFetchWithAuth.mockResolvedValue(reply(409, { planner_state: { idea_spine: { title: 'winner' } }, revision: 9 }));
    const r = await savePlannerDraftState('draft-A', { idea_spine: null }, 3);
    expect(r).toMatchObject({ ok: false, conflict: true, revision: 9 });
  });
});
