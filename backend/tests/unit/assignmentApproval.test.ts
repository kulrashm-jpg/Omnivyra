/**
 * Strategic Mix R2-P1 — Assignment Approval Workflow contract.
 *
 *  - approval is PLANNING-OWNED: belongs to the Assignment only, editable
 *    solely via setAssignmentApproval, immutable once execution-owned
 *  - company flag OFF ⇒ byte-identical behavior (legacy assignments carry
 *    no approval field; materialization/board outputs unchanged)
 *  - flag ON ⇒ only approved (or explicitly not_required) confirmed
 *    assignments materialize; pending/rejected/unset skip as issues
 *  - board aggregates approvals and links blockers to their assignments
 *  - settings API: GET/PUT, tenant-guarded, boolean-validated
 */

type Row = Record<string, unknown>;
let companyRow: Row | null = null;
const companyUpdates: Row[] = [];

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      const builder: any = {};
      for (const op of ['select', 'eq', 'order', 'limit']) builder[op] = () => builder;
      builder.maybeSingle = () => Promise.resolve({ data: table === 'companies' ? companyRow : null, error: null });
      builder.update = (payload: Row) => {
        if (table === 'companies') companyUpdates.push(payload);
        const upd: any = { eq: () => upd, then: (res: any) => Promise.resolve({ error: null }).then(res) };
        return upd;
      };
      builder.then = (res: any) => Promise.resolve({ data: [], error: null }).then(res);
      return builder;
    },
  },
}));
jest.mock('../../services/userContextService', () => ({
  enforceCompanyAccess: jest.fn(async () => ({ userId: 'u-1', companyId: 'co-1' })),
}));

import {
  assignAsset,
  bulkAssign,
  advanceAssignmentStatus,
  setAssignmentApproval,
  updateAssignmentMetadata,
  normalizeAssignments,
  deriveStructureSlots,
  type CampaignAssignment,
} from '../../../lib/campaign/campaignAssignments';
import {
  materializeAssignments,
  validateAssignmentsForExecution,
  type MaterializableAsset,
} from '../../../lib/campaign/assignmentMaterialization';
import {
  projectCampaignBoard,
  summarizeCampaignBoard,
} from '../../../lib/campaign/campaignBoardProjection';
import approvalSettingsHandler from '../../../pages/api/companies/approval-settings';

const freshCtx = () => { let i = 0; return { now: '2026-07-11T10:00:00.000Z', mintId: () => `asg-${++i}` }; };

const calendarPlan = {
  days: [{ week_number: 1, day: 'Monday', activities: [
    { execution_id: 'ex-1', week_number: 1, day: 'Monday', platform: 'linkedin', content_type: 'carousel', title: 'A' },
    { execution_id: 'ex-2', week_number: 1, day: 'Monday', platform: 'x', content_type: 'image', title: 'B' },
  ] }],
  activities: [
    { execution_id: 'ex-1', week_number: 1, day: 'Monday', platform: 'linkedin', content_type: 'carousel', title: 'A' },
    { execution_id: 'ex-2', week_number: 1, day: 'Monday', platform: 'x', content_type: 'image', title: 'B' },
  ],
};
const slots = deriveStructureSlots(calendarPlan);
const ASSETS = new Map<string, MaterializableAsset>([
  ['car-1', { id: 'car-1', title: 'Deck', url: 'https://cdn/c.png', creatorType: 'carousel', version: 1 }],
  ['img-1', { id: 'img-1', title: 'Hero', url: 'https://cdn/i.png', creatorType: 'image', version: 1 }],
]);

describe('approval is planning-owned — one door, lock-respecting', () => {
  it('approve / reject / return-to-pending via setAssignmentApproval only', () => {
    const ctx = freshCtx();
    let list = assignAsset([], { campaignId: 'c', assetId: 'car-1', slot: slots[0], approval: 'pending' }, ctx).assignments;
    expect(list[0].approval).toBe('pending');
    list = setAssignmentApproval(list, list[0].id, 'approved', ctx);
    expect(list[0].approval).toBe('approved');
    list = setAssignmentApproval(list, list[0].id, 'rejected', ctx);
    expect(list[0].approval).toBe('rejected');
    list = setAssignmentApproval(list, list[0].id, 'pending', ctx);
    expect(list[0].approval).toBe('pending');
    expect(setAssignmentApproval(list, list[0].id, 'bogus' as never, ctx)[0].approval).toBe('pending');
    // the metadata patch has NO approval door
    const patched = updateAssignmentMetadata(list, list[0].id, { approval: 'approved' } as never, ctx);
    expect(patched[0].approval).toBe('pending');
  });

  it('execution-owned assignments are immutable to approval edits', () => {
    const ctx = freshCtx();
    let list = assignAsset([], { campaignId: 'c', assetId: 'car-1', slot: slots[0], approval: 'approved' }, ctx).assignments;
    list = advanceAssignmentStatus(list, list[0].id, 'materialized', ctx);
    expect(setAssignmentApproval(list, list[0].id, 'rejected', ctx)[0].approval).toBe('approved');
  });

  it('legacy assignments have NO approval field; reload round-trips it only when present', () => {
    const ctx = freshCtx();
    const legacy = assignAsset([], { campaignId: 'c', assetId: 'car-1', slot: slots[0] }, ctx).assignments;
    expect('approval' in legacy[0]).toBe(false);
    expect('approval' in normalizeAssignments(JSON.parse(JSON.stringify(legacy)))[0]).toBe(false);

    const withApproval = setAssignmentApproval(
      assignAsset([], { campaignId: 'c', assetId: 'car-1', slot: slots[0], approval: 'pending' }, ctx).assignments,
      'asg-2', 'approved', ctx,
    );
    const reloaded = normalizeAssignments(JSON.parse(JSON.stringify(withApproval)));
    expect(reloaded[0].approval).toBe(withApproval[0].approval);
    expect(normalizeAssignments([{ ...withApproval[0], approval: 'garbage' }])[0].approval).toBeUndefined();
  });
});

describe('materialization gate — approval enablement matrix', () => {
  function confirmedWith(approvals: Array<string | undefined>): CampaignAssignment[] {
    const ctx = freshCtx();
    return bulkAssign([], [
      { campaignId: 'c', assetId: 'car-1', slot: slots[0], status: 'confirmed', ...(approvals[0] ? { approval: approvals[0] as never } : {}) },
      { campaignId: 'c', assetId: 'img-1', slot: slots[1], status: 'confirmed', ...(approvals[1] ? { approval: approvals[1] as never } : {}) },
    ], ctx);
  }

  it('flag OFF: pending/rejected/unset ALL materialize (byte-identical to pre-R2)', () => {
    const result = materializeAssignments({
      campaignId: 'c', calendarPlan, assignments: confirmedWith(['pending', 'rejected']), assets: ASSETS,
    });
    expect(result.materialized_ids).toHaveLength(2);
    expect(result.issues.filter((i) => i.code.startsWith('approval'))).toEqual([]);
  });

  it('flag ON: only approved materializes; pending/rejected/unset skip as approval issues', () => {
    const pendingAndRejected = materializeAssignments({
      campaignId: 'c', calendarPlan, assignments: confirmedWith(['pending', 'rejected']), assets: ASSETS, requireApproval: true,
    });
    expect(pendingAndRejected.materialized_ids).toEqual([]);
    expect(pendingAndRejected.issues.map((i) => i.code).sort()).toEqual(['approval_pending', 'approval_rejected']);
    // skipped items remain confirmed + editable planning items
    expect(pendingAndRejected.assignments.every((a) => a.status === 'confirmed')).toBe(true);

    const approvedAndUnset = materializeAssignments({
      campaignId: 'c', calendarPlan, assignments: confirmedWith(['approved', undefined]), assets: ASSETS, requireApproval: true,
    });
    expect(approvedAndUnset.materialized_ids).toHaveLength(1); // approved one only
    expect(approvedAndUnset.issues.some((i) => i.code === 'approval_pending')).toBe(true); // unset gates as pending
  });

  it('flag ON: explicit not_required bypasses the gate ("behaves exactly as today")', () => {
    const result = materializeAssignments({
      campaignId: 'c', calendarPlan, assignments: confirmedWith(['not_required', 'approved']), assets: ASSETS, requireApproval: true,
    });
    expect(result.materialized_ids).toHaveLength(2);
  });

  it('validate emits approval issues only for CONFIRMED assignments', () => {
    const ctx = freshCtx();
    const draft = bulkAssign([], [{ campaignId: 'c', assetId: 'car-1', slot: slots[0], approval: 'pending' }], ctx); // draft status
    expect(validateAssignmentsForExecution({ campaignId: 'c', slots, assignments: draft, assets: ASSETS, requireApproval: true })).toEqual([]);
  });
});

describe('Campaign Board — approval summary, blockers, AI narrative', () => {
  it('aggregates counts, links blockers to assignments, and flag OFF output is unchanged', () => {
    const ctx = freshCtx();
    let list = bulkAssign([], [
      { campaignId: 'c', assetId: 'car-1', slot: slots[0], status: 'confirmed', approval: 'pending' },
      { campaignId: 'c', assetId: 'img-1', slot: slots[1], status: 'confirmed', approval: 'approved' },
    ], ctx);

    const off = projectCampaignBoard({ slots, assignments: list, assets: [] });
    expect(off.approvals).toMatchObject({ enabled: false, blocking: [] });
    expect(off.issues.some((i) => i.code.startsWith('approval'))).toBe(false);

    const on = projectCampaignBoard({ slots, assignments: list, assets: [], requireApproval: true });
    expect(on.approvals).toMatchObject({ enabled: true, pending: 1, approved: 1, rejected: 0, blocking: [list[0].id] });
    const issue = on.issues.find((i) => i.code === 'approval_pending')!;
    expect(issue).toMatchObject({ severity: 'blocking', target: 'alignment', ref_id: list[0].id });
    expect(on.health.label).toBe('blocked');

    const summary = summarizeCampaignBoard(on);
    expect(summary.some((s) => s.includes('Approvals gate the handoff'))).toBe(true);
    // AI summarizes; nothing in the projection mutates approvals
    expect(list[0].approval).toBe('pending');
  });
});

describe('GET/PUT /api/companies/approval-settings', () => {
  function mockRes() {
    const res: any = { statusCode: 0, body: undefined };
    res.status = (code: number) => { res.statusCode = code; return res; };
    res.json = (payload: unknown) => { res.body = payload; return res; };
    return res;
  }

  beforeEach(() => {
    companyRow = { require_assignment_approval: false };
    companyUpdates.length = 0;
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('GET returns the flag (default false); PUT toggles with boolean validation', async () => {
    let res = mockRes();
    await approvalSettingsHandler({ method: 'GET', query: { company_id: 'co-1' } } as any, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ require_assignment_approval: false });

    res = mockRes();
    await approvalSettingsHandler({ method: 'PUT', query: { company_id: 'co-1' }, body: { require_assignment_approval: true } } as any, res);
    expect(res.statusCode).toBe(200);
    expect(companyUpdates).toEqual([{ require_assignment_approval: true }]);

    res = mockRes();
    await approvalSettingsHandler({ method: 'PUT', query: { company_id: 'co-1' }, body: { require_assignment_approval: 'yes' } } as any, res);
    expect(res.statusCode).toBe(400);

    res = mockRes();
    await approvalSettingsHandler({ method: 'GET', query: {} } as any, res);
    expect(res.statusCode).toBe(400);

    res = mockRes();
    await approvalSettingsHandler({ method: 'DELETE', query: { company_id: 'co-1' } } as any, res);
    expect(res.statusCode).toBe(405);
  });
});
