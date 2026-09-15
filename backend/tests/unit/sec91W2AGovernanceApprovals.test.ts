/**
 * SEC-91 W2-A (STEP 3AH-91, wave 2) — W2A-5: enterprise-governance approvals
 * act with the caller's REAL company role.
 *
 * Both routes define the intended mapping from the company RBAC role to the
 * creative-review role (rbacRoleToReviewRole: SUPER_ADMIN → executive_reviewer,
 * COMPANY_ADMIN → campaign_manager, CONTENT_REVIEWER → compliance_reviewer,
 * CONTENT_PUBLISHER → campaign_manager, CONTENT_CREATOR → creative_operator),
 * but fed it resolveUserContext().role, which is only ever 'admin' | 'user'.
 * Every caller therefore fell through to the default: decide → EVERY caller
 * acted as `compliance_reviewer` (a CONTENT_PUBLISHER could approve_qa /
 * approve_governance; a super admin could never bypass_review), comment →
 * every author was `creative_operator`.
 *
 * Both routes were also unreachable: requireCompanyContext({ req, res }) was
 * called WITHOUT a companyId, so every request answered 400 "companyId
 * required" after withRBAC had already authorized the company. They now bind
 * to the company withRBAC authorized (req.rbac.companyId — the
 * WITHRBAC-STRUCT-001 contract) and use req.rbac.role. The governance runtime
 * itself stays behind ENTERPRISE_GOVERNANCE_RUNTIME_ENABLED (default off →
 * onApprovalDecision answers skipped/flag_off → 503).
 */
import { seed, invoke, CO_A, CO_B, USER_A, USER_SUPER } from '../helpers/routeAuthHarness';
import { as, roleRows, USER_PUBLISHER, USER_CREATOR } from '../helpers/sec91W2AHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/sec91W2AHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/sec91W2AHarness').identityModule());

const mockOnApprovalDecision = jest.fn();
jest.mock('../../services/creator/enterpriseGovernanceIntegration', () => ({
  onApprovalDecision: (input: unknown) => mockOnApprovalDecision(input),
}));
const mockRecords = new Map<string, { assetId: string; companyId: string; comments: unknown[] }>();
const mockAddReviewComment = jest.fn();
jest.mock('../../services/creator/creativeReviewStateMachine', () => ({
  getReviewRecord: (assetId: string) => mockRecords.get(assetId) ?? null,
  addReviewComment: (input: any) => mockAddReviewComment(input),
  ReviewTransitionError: class ReviewTransitionError extends Error { code = 'X'; },
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const decide = require('../../../pages/api/enterprise-governance/approvals/decide').default;
const comment = require('../../../pages/api/enterprise-governance/approvals/comment').default;
/* eslint-enable @typescript-eslint/no-var-requires */

const ASSET_A = 'asset-a';
const ASSET_B = 'asset-b';

beforeEach(() => {
  seed({ user_company_roles: roleRows() });
  mockRecords.clear();
  mockRecords.set(ASSET_A, { assetId: ASSET_A, companyId: CO_A, comments: [] });
  mockRecords.set(ASSET_B, { assetId: ASSET_B, companyId: CO_B, comments: [] });
  mockOnApprovalDecision.mockReset();
  mockOnApprovalDecision.mockImplementation(async (input: any) => ({ skipped: false, result: { assetId: input.assetId, state: input.to } }));
  mockAddReviewComment.mockReset();
  mockAddReviewComment.mockImplementation((input: any) => ({ comments: [{ ...input }] }));
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

const decideAs = (who: Parameters<typeof as>[0], companyId: string, body: Record<string, unknown> = { assetId: ASSET_A, decision: 'approve' }) =>
  invoke(decide, { method: 'POST', query: { companyId }, body, headers: as(who) });

describe('POST /api/enterprise-governance/approvals/decide', () => {
  it.each([
    ['PUBLISHER', 'campaign_manager'],
    ['REVIEWER', 'compliance_reviewer'],
    ['A', 'campaign_manager'],
    ['SUPER', 'executive_reviewer'],
  ] as const)('%s acts as %s (mapped from the real company role)', async (who, reviewRole) => {
    const r = await decideAs(who, CO_A);
    expect(r.status).toBe(200);
    expect(mockOnApprovalDecision).toHaveBeenCalledTimes(1);
    expect(mockOnApprovalDecision.mock.calls[0][0]).toMatchObject({ assetId: ASSET_A, to: 'approved', actorRole: reviewRole });
  });

  it('THE ESCALATION: a CONTENT_PUBLISHER is never a compliance_reviewer', async () => {
    await decideAs('PUBLISHER', CO_A);
    expect(mockOnApprovalDecision.mock.calls[0][0].actorRole).not.toBe('compliance_reviewer');
    expect(mockOnApprovalDecision.mock.calls[0][0].actorUserId).toBe(USER_PUBLISHER);
  });

  it('roles outside the route allow-list are refused before anything runs (VIEW_ONLY, CONTENT_CREATOR)', async () => {
    for (const who of ['VIEWER', 'CREATOR'] as const) {
      const r = await decideAs(who, CO_A);
      expect(r.status).toBe(403);
    }
    expect(mockOnApprovalDecision).not.toHaveBeenCalled();
  });

  it('another tenant\'s company → 403; another tenant\'s record under your company → 404', async () => {
    const foreignCompany = await decideAs('A', CO_B, { assetId: ASSET_B, decision: 'approve' });
    expect(foreignCompany.status).toBe(403);
    const foreignRecord = await decideAs('A', CO_A, { assetId: ASSET_B, decision: 'approve' });
    expect(foreignRecord.status).toBe(404);
    expect(mockOnApprovalDecision).not.toHaveBeenCalled();
  });

  it('companyId omitted → 400 (withRBAC), nothing runs', async () => {
    const r = await invoke(decide, { method: 'POST', body: { assetId: ASSET_A, decision: 'approve' }, headers: as('A') });
    expect(r.status).toBe(400);
    expect(mockOnApprovalDecision).not.toHaveBeenCalled();
  });

  it('runtime flag off (skipped/flag_off from the facade) still surfaces as 503', async () => {
    mockOnApprovalDecision.mockResolvedValueOnce({ skipped: true, reason: 'flag_off' });
    const r = await decideAs('A', CO_A);
    expect(r.status).toBe(503);
    expect(mockOnApprovalDecision.mock.calls[0][0].actorUserId).toBe(USER_A);
  });

  it('super admin approving for a company it is not a member of acts as executive_reviewer', async () => {
    const r = await decideAs('SUPER', CO_B, { assetId: ASSET_B, decision: 'reject' });
    expect(r.status).toBe(200);
    expect(mockOnApprovalDecision.mock.calls[0][0]).toMatchObject({ to: 'rejected', actorRole: 'executive_reviewer', actorUserId: USER_SUPER });
  });
});

describe('POST /api/enterprise-governance/approvals/comment', () => {
  it.each([
    ['CREATOR', 'creative_operator'],
    ['PUBLISHER', 'campaign_manager'],
    ['REVIEWER', 'compliance_reviewer'],
    ['SUPER', 'executive_reviewer'],
  ] as const)('%s comments as %s', async (who, reviewRole) => {
    const r = await invoke(comment, { method: 'POST', query: { companyId: CO_A }, body: { assetId: ASSET_A, text: 'looks good' }, headers: as(who) });
    expect(r.status).toBe(200);
    expect(mockAddReviewComment.mock.calls[0][0]).toMatchObject({ assetId: ASSET_A, authorRole: reviewRole });
  });

  it('author id is the authenticated caller', async () => {
    await invoke(comment, { method: 'POST', query: { companyId: CO_A }, body: { assetId: ASSET_A, text: 'x' }, headers: as('CREATOR') });
    expect(mockAddReviewComment.mock.calls[0][0].authorUserId).toBe(USER_CREATOR);
  });

  it('VIEW_ONLY → 403; foreign record → 404', async () => {
    const viewer = await invoke(comment, { method: 'POST', query: { companyId: CO_A }, body: { assetId: ASSET_A, text: 'x' }, headers: as('VIEWER') });
    expect(viewer.status).toBe(403);
    const foreign = await invoke(comment, { method: 'POST', query: { companyId: CO_A }, body: { assetId: ASSET_B, text: 'x' }, headers: as('A') });
    expect(foreign.status).toBe(404);
    expect(mockAddReviewComment).not.toHaveBeenCalled();
  });
});
