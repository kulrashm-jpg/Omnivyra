/**
 * Strategic Mix P1 — Draft Campaign persistence contract
 * (STRATEGIC-MIX-SPEC-001 invariants I-1/I-2: a server Draft Campaign is
 * created the moment Strategic Mix is entered and owns all planner state;
 * conflicts resolve deterministically by revision, server copy wins).
 *
 * Covers both API routes with scripted supabase + tenant guards:
 *   POST /api/campaigns/planner-draft            (create-or-resume)
 *   GET/PUT /api/campaigns/[id]/planner-draft-state (revision-checked state)
 */

// ── Scripted supabase ──
type Row = Record<string, unknown>;
let campaignsRows: Row[] = [];
let versionRow: { id: string; campaign_snapshot: Row } | null = null;
const inserted: Array<{ table: string; payload: Row }> = [];
const updated: Array<{ table: string; payload: Row; id?: unknown }> = [];

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      const chain: Array<{ op: string; args: unknown[] }> = [];
      const builder: any = {};
      for (const op of ['select', 'eq', 'like', 'order', 'limit']) {
        builder[op] = (...args: unknown[]) => { chain.push({ op, args }); return builder; };
      }
      builder.maybeSingle = () => ({
        then: (res: any, rej: any) => {
          if (table === 'campaigns') return Promise.resolve({ data: campaignsRows[0] ?? null, error: null }).then(res, rej);
          if (table === 'campaign_versions') return Promise.resolve({ data: versionRow, error: null }).then(res, rej);
          return Promise.resolve({ data: null, error: null }).then(res, rej);
        },
      });
      builder.insert = (payload: Row) => {
        inserted.push({ table, payload });
        return { then: (res: any) => Promise.resolve({ error: null }).then(res) };
      };
      builder.update = (payload: Row) => {
        const upd = { table, payload, id: undefined as unknown };
        updated.push(upd);
        const updBuilder: any = {
          eq: (_col: string, val: unknown) => { upd.id = val; return updBuilder; },
          then: (res: any) => Promise.resolve({ error: null }).then(res),
        };
        return updBuilder;
      };
      return builder;
    },
  },
}));

jest.mock('../../security/TenantGuard', () => ({
  requireTenantAccess: jest.fn(async () => ({ userId: 'user-1', organizationId: 'co-1', bypass: false })),
  requireCampaignTenantAccess: jest.fn(async () => ({ userId: 'user-1', organizationId: 'co-1', bypass: false })),
}));

import plannerDraftHandler from '../../../pages/api/campaigns/planner-draft';
import draftStateHandler from '../../../pages/api/campaigns/[id]/planner-draft-state';

function mockRes() {
  const res: any = { statusCode: 0, body: undefined };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (payload: unknown) => { res.body = payload; return res; };
  return res;
}

beforeEach(() => {
  campaignsRows = [];
  versionRow = null;
  inserted.length = 0;
  updated.length = 0;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('POST /api/campaigns/planner-draft — create-or-resume (I-1)', () => {
  it('creates a Draft Campaign + v1 snapshot when none is open', async () => {
    const res = mockRes();
    await plannerDraftHandler({ method: 'POST', body: { companyId: 'co-1' } } as any, res);
    expect(res.statusCode).toBe(201);
    expect(res.body.campaign_id).toBeTruthy();
    expect(res.body.resumed).toBe(false);

    const campaign = inserted.find((i) => i.table === 'campaigns')!.payload;
    expect(campaign).toMatchObject({
      status: 'draft',
      current_stage: 'planning',
      user_id: 'user-1',
      company_id: 'co-1',
      name: 'Untitled Strategic Mix',
    });
    expect(String(campaign.thread_id)).toMatch(/^planner_draft_/);

    const version = inserted.find((i) => i.table === 'campaign_versions')!.payload;
    expect(version).toMatchObject({ company_id: 'co-1', status: 'draft', version: 1 });
    expect((version.campaign_snapshot as Row).planner_state_revision).toBe(0);
    expect((version.campaign_snapshot as Row).planner_draft).toBe(true);
  });

  it('RESUMES the newest open draft instead of forking a second one (multi-tab / multi-device)', async () => {
    campaignsRows = [{ id: 'draft-1', updated_at: '2026-07-11T00:00:00Z' }];
    const res = mockRes();
    await plannerDraftHandler({ method: 'POST', body: { companyId: 'co-1' } } as any, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ campaign_id: 'draft-1', resumed: true });
    expect(inserted).toHaveLength(0); // nothing created
  });

  it('requires companyId', async () => {
    const res = mockRes();
    await plannerDraftHandler({ method: 'POST', body: {} } as any, res);
    expect(res.statusCode).toBe(400);
  });
});

describe('GET/PUT planner-draft-state — server is the source of truth', () => {
  const req = (method: string, body?: Row) => ({ method, query: { id: 'draft-1' }, body }) as any;

  it('GET returns stored state + revision', async () => {
    versionRow = { id: 'v1', campaign_snapshot: { planner_state: { idea_spine: { title: 'X' } }, planner_state_revision: 4 } };
    const res = mockRes();
    await draftStateHandler(req('GET'), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ planner_state: { idea_spine: { title: 'X' } }, revision: 4 });
  });

  it('PUT with matching baseRevision stores state and increments the revision', async () => {
    versionRow = { id: 'v1', campaign_snapshot: { planner_state: null, planner_state_revision: 0 } };
    const res = mockRes();
    await draftStateHandler(req('PUT', { planner_state: { idea_spine: { title: 'My Launch' } }, baseRevision: 0 }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ revision: 1 });
    const snapUpdate = updated.find((u) => u.table === 'campaign_versions')!;
    expect((snapUpdate.payload.campaign_snapshot as Row).planner_state_revision).toBe(1);
    expect(((snapUpdate.payload.campaign_snapshot as Row).planner_state as Row).idea_spine).toEqual({ title: 'My Launch' });
  });

  it('PUT with a STALE baseRevision is rejected 409 with the winning server copy (deterministic)', async () => {
    versionRow = { id: 'v1', campaign_snapshot: { planner_state: { idea_spine: { title: 'Winner' } }, planner_state_revision: 7 } };
    const res = mockRes();
    await draftStateHandler(req('PUT', { planner_state: { idea_spine: { title: 'Loser' } }, baseRevision: 5 }), res);
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({
      error: 'stale_revision',
      revision: 7,
      planner_state: { idea_spine: { title: 'Winner' } },
    });
    expect(updated).toHaveLength(0); // the losing write never lands
  });

  it('PUT mirrors the idea-spine title onto the campaigns row (drafts stay legible)', async () => {
    versionRow = { id: 'v1', campaign_snapshot: { planner_state_revision: 0 } };
    const res = mockRes();
    await draftStateHandler(
      req('PUT', { planner_state: { idea_spine: { title: 'Q3 Product Launch', description: 'Big push' } }, baseRevision: 0 }),
      res,
    );
    expect(res.statusCode).toBe(200);
    const campaignUpdate = updated.find((u) => u.table === 'campaigns')!;
    expect(campaignUpdate.payload).toMatchObject({ name: 'Q3 Product Launch', description: 'Big push' });
    expect(campaignUpdate.id).toBe('draft-1');
  });

  it('PUT validates inputs (missing state / bad revision)', async () => {
    versionRow = { id: 'v1', campaign_snapshot: {} };
    const res1 = mockRes();
    await draftStateHandler(req('PUT', { baseRevision: 0 }), res1);
    expect(res1.statusCode).toBe(400);
    const res2 = mockRes();
    await draftStateHandler(req('PUT', { planner_state: {}, baseRevision: -1 }), res2);
    expect(res2.statusCode).toBe(400);
  });

  it('unknown method → 405', async () => {
    const res = mockRes();
    await draftStateHandler(req('DELETE'), res);
    expect(res.statusCode).toBe(405);
  });
});
