/**
 * S2 tenant seam (e1) - backend/services/governancePolicyService.ts. intelligence_governance_policies is a direct
 * tenant table (organization_id). Every B row shares its id with an A row; tenant A must never read, update or
 * archive B's rows, and a draft A creates is stamped with A.
 */
jest.mock('../../db/writeOwner', () => require('../helpers/s2FaithfulFakeDb').writeOwnerModule());

import { db, writes, resetDb } from '../helpers/s2FaithfulFakeDb';
import { systemTenantContext, tenantContextFor } from '../../db/tenantTable';
import {
  createPolicyDraft,
  activatePolicyDraft,
  archivePolicy,
  getActivePolicy,
  listPoliciesForOrg,
} from '../../services/governancePolicyService';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const T = 'intelligence_governance_policies';
const ctxA = tenantContextFor({ userId: 'user-a' }, A);

function seed() {
  resetDb({
    [T]: [
      // A: active v1 + draft v2 of 'moderation'; an archivable draft of 'export'
      { id: 'pol-1', organization_id: A, policy_key: 'moderation', version: 1, status: 'active', body: { a: 1 }, created_at: '2026-01-01T00:00:00Z' },
      { id: 'pol-2', organization_id: A, policy_key: 'moderation', version: 2, status: 'draft', body: { a: 2 }, created_at: '2026-01-02T00:00:00Z' },
      { id: 'pol-3', organization_id: A, policy_key: 'export', version: 1, status: 'draft', body: {}, created_at: '2026-01-03T00:00:00Z' },
      // B: same ids, higher versions, same keys
      { id: 'pol-1', organization_id: B, policy_key: 'moderation', version: 7, status: 'active', body: { b: 1 }, created_at: '2026-02-01T00:00:00Z' },
      { id: 'pol-2', organization_id: B, policy_key: 'moderation', version: 9, status: 'draft', body: { b: 2 }, created_at: '2026-02-02T00:00:00Z' },
      { id: 'pol-3', organization_id: B, policy_key: 'export', version: 4, status: 'draft', body: {}, created_at: '2026-02-03T00:00:00Z' },
      { id: 'pol-b-only', organization_id: B, policy_key: 'replay', version: 1, status: 'draft', body: {}, created_at: '2026-02-04T00:00:00Z' },
    ],
  });
}
const bRows = () => db[T].filter((r) => r.organization_id === B);
const bSnapshot = () => JSON.stringify(bRows());

beforeEach(seed);

describe('governancePolicyService under the tenant seam', () => {
  it('getActivePolicy returns A\'s active version, never B\'s (same key, same id)', async () => {
    const active = await getActivePolicy(ctxA, 'moderation');
    expect(active).toMatchObject({ id: 'pol-1', organization_id: A, version: 1 });
  });

  it('listPoliciesForOrg lists only A\'s rows', async () => {
    const rows = await listPoliciesForOrg(ctxA);
    expect(rows).toHaveLength(3);
    expect(rows.every((r: any) => r.organization_id === A)).toBe(true);
    expect(rows.map((r: any) => r.id)).toEqual(['pol-3', 'pol-2', 'pol-1']);
  });

  it('createPolicyDraft numbers versions from A\'s rows only and stamps the insert with A', async () => {
    const before = bSnapshot();
    const draft = await createPolicyDraft(ctxA, { policyKey: 'moderation', body: { x: 1 }, createdBy: 'user-a' });
    // B's highest moderation version is 9; A's is 2 -> next is 3
    expect(draft).toMatchObject({ organization_id: A, version: 3, status: 'draft' });
    const ins = writes.filter((w) => w.verb === 'insert');
    expect(ins).toHaveLength(1);
    expect((ins[0].payload as any).organization_id).toBe(A);
    expect(bSnapshot()).toBe(before);
  });

  it('createPolicyDraft refuses a context-less call (fail closed)', async () => {
    await expect(createPolicyDraft(undefined as never, { policyKey: 'moderation', body: {}, createdBy: null })).rejects.toThrow(/TENANT_CONTEXT_MISSING/);
    expect(writes).toHaveLength(0);
  });

  it('activatePolicyDraft supersedes and activates ONLY A\'s rows; every write ran under A', async () => {
    const before = bSnapshot();
    const res = await activatePolicyDraft(ctxA, { policyDraftId: 'pol-2', actorUserId: 'user-a' });
    expect(res).toMatchObject({ id: 'pol-2', organization_id: A, status: 'active' });
    const a1 = db[T].find((r) => r.id === 'pol-1' && r.organization_id === A);
    expect(a1).toMatchObject({ status: 'superseded', superseded_by_version: 2 });
    expect(bSnapshot()).toBe(before);
    const updates = writes.filter((w) => w.verb === 'update');
    expect(updates).toHaveLength(2);
    for (const u of updates) {
      expect(u.filters).toContainEqual({ op: 'eq', col: 'organization_id', value: A });
      expect(u.affected.every((r) => r.organization_id === A)).toBe(true);
    }
  });

  it('activatePolicyDraft on an id only B holds is not found for A, and writes nothing', async () => {
    const before = bSnapshot();
    await expect(activatePolicyDraft(ctxA, { policyDraftId: 'pol-b-only', actorUserId: 'user-a' })).rejects.toThrow(/policy_not_found/);
    expect(writes).toHaveLength(0);
    expect(bSnapshot()).toBe(before);
  });

  it('archivePolicy archives A\'s draft and leaves B\'s same-id draft untouched', async () => {
    const before = bSnapshot();
    const res = await archivePolicy(ctxA, { policyId: 'pol-3' });
    expect(res).toMatchObject({ id: 'pol-3', organization_id: A, status: 'archived' });
    expect(bSnapshot()).toBe(before);
    expect(writes[0].filters).toContainEqual({ op: 'eq', col: 'organization_id', value: A });
  });

  it('archivePolicy on a B-only id archives nothing', async () => {
    const before = bSnapshot();
    const res = await archivePolicy(ctxA, { policyId: 'pol-b-only' });
    expect(res).toBeNull();
    expect(bSnapshot()).toBe(before);
  });

  it('a system context for B sees B\'s active policy (the seam scopes, it does not hide everything)', async () => {
    const active = await getActivePolicy(systemTenantContext(B, 'test: positive control'), 'moderation');
    expect(active).toMatchObject({ id: 'pol-1', organization_id: B, version: 7 });
  });
});
