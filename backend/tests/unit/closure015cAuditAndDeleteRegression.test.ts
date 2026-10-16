/**
 * Closure-015C (Closure-015B T12, T13, T17) — regression pins for findings
 * whose remediation is NOT authorized in this phase (recommendation audit:
 * owner decision 6; delete routes: owner decision 7). Each states the CORRECT,
 * policy-free behaviour:
 *   T12  a company-scoped principal never reads another tenant's audit row
 *        (tenant isolation — independent of what platform super admins may see);
 *   T13  the audit writer writes only schema-defined columns (contract);
 *   T17  a delete that removed nothing never answers 200 "deleted successfully".
 * Defects that still exist are pinned with `test.failing` (passes while the
 * defect exists; fails once fixed — convert it then).
 *
 * REAL: the routes, withRBAC/enforceRole/getUserRole/isSuperAdmin over the
 * routeAuthHarness in-memory tables, the audit service, and the persistence
 * deleteActivity. MOCKED: authentication (sec91AHarness tokens).
 */
import fs from 'fs';
import path from 'path';
import { seed, rows, invoke, CO_A, CO_B } from '../helpers/routeAuthHarness';
import { bearer, USER_INVITED } from '../helpers/sec91AHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/sec91AHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/sec91AHarness').identityModule());
jest.mock('../../../lib/auth/rateLimit', () => ({ checkRateLimit: async () => ({ allowed: true }) }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
// delete-activity dynamically imports executionPlannerService only for deleteActivity, which delegates to
// the persistence layer; map it to the REAL persistence function (avoids loading the AI generators).
let mockBeforeDelete: (() => void) | null = null;
jest.mock('../../services/executionPlannerService', () => ({
  deleteActivity: async (id: string) => {
    if (mockBeforeDelete) mockBeforeDelete();
    return jest.requireActual('../../services/executionPlannerPersistence').deleteActivity(id);
  },
}));

import auditByIdRoute from '../../../pages/api/recommendations/audit/[id]';
import auditByCampaignRoute from '../../../pages/api/recommendations/audit/campaign/[id]';
import deleteActivityRoute from '../../../pages/api/admin/delete-activity';

const ROOT = path.resolve(__dirname, '../../..');
const REC_B = '0b000000-0000-4000-8000-0000000000b1';
const CAMP_B = '0b000000-0000-4000-8000-0000000000b2';

function world() {
  seed({
    user_company_roles: [{ user_id: USER_INVITED, company_id: CO_A, role: 'SUPER_ADMIN', status: 'invited' }],
    recommendation_audit_logs: [
      { id: 'audit-b', recommendation_id: REC_B, campaign_id: CAMP_B, company_id: CO_B, company_profile_used: { secret: 'B-PROFILE' } },
    ],
    daily_content_plans: [],
    super_admin_audit_logs: [],
  });
}
beforeEach(() => { world(); mockBeforeDelete = null; });

// Closure-015D: no audit route or writer changed, but getUserRole no longer grants an
// INVITED SUPER_ADMIN row anything, so withRBAC([SUPER_ADMIN]) refuses it here — the
// two former `test.failing` pins now pass as plain tests. What an ACTIVE platform
// super admin may read through these routes remains owner decision 6.
describe('T12 recommendation-audit tenant isolation (invited principal: FIXED by Closure-015D; owner decision 6 still open)', () => {
  it('an INVITED (company-scoped) SUPER_ADMIN of A naming companyId=A never reads B\'s audit row by recommendation id', async () => {
    const r = await invoke(auditByIdRoute as never, { method: 'GET', query: { id: REC_B, companyId: CO_A }, headers: bearer('INVITED') });
    expect(JSON.stringify(r.body ?? {})).not.toContain('B-PROFILE');
  });

  it('… nor by campaign id', async () => {
    const r = await invoke(auditByCampaignRoute as never, { method: 'GET', query: { id: CAMP_B, companyId: CO_A }, headers: bearer('INVITED') });
    expect(JSON.stringify(r.body ?? {})).not.toContain('B-PROFILE');
  });

  it('harness fidelity: an active COMPANY_ADMIN of A is refused (403) — only SUPER_ADMIN-role principals reach the handler', async () => {
    const r = await invoke(auditByIdRoute as never, { method: 'GET', query: { id: REC_B, companyId: CO_A }, headers: bearer('A') });
    expect(r.status).toBe(403);
  });
});

describe('T13 recommendation-audit writer vs schema (contract; owner decision 6 pending)', () => {
  const KNOWN_GAP = ['policy_id', 'policy_weights_used'];
  function schemaColumns(): Set<string> {
    const baseline = fs.readFileSync(path.join(ROOT, 'supabase/_schema/baseline.sql'), 'utf8');
    const m = /CREATE TABLE public\.recommendation_audit_logs \(([\s\S]*?)\n\);/.exec(baseline);
    if (!m) throw new Error('recommendation_audit_logs not found in baseline.sql');
    const cols = new Set<string>();
    for (const line of m[1].split('\n')) { const c = /^\s+([a-z_][a-z0-9_]*)\s/.exec(line); if (c) cols.add(c[1]); }
    for (const f of fs.readdirSync(path.join(ROOT, 'supabase/migrations')).filter((x) => x.endsWith('.sql'))) {
      const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations', f), 'utf8');
      const re = /alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?recommendation_audit_logs\s+([\s\S]*?);/gi;
      for (let a = re.exec(sql); a; a = re.exec(sql)) for (const add of a[1].matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/gi)) cols.add(add[1].toLowerCase());
    }
    return cols;
  }

  it('every column the writer inserts is schema-defined EXCEPT exactly the known gap (fails if the gap grows or is closed)', async () => {
    const { logRecommendationAudit } = jest.requireActual('../../services/recommendationAuditService');
    await logRecommendationAudit({ company_id: CO_A, final_score: 1 });
    const inserted = rows('recommendation_audit_logs').find((r) => r.company_id === CO_A && r.final_score === 1) as Record<string, unknown>;
    expect(inserted).toBeTruthy();
    const cols = schemaColumns();
    expect(cols.size).toBeGreaterThan(10);
    expect(Object.keys(inserted).filter((k) => k !== 'id' && !cols.has(k)).sort()).toEqual(KNOWN_GAP);
  });

  it('a writer failure never reaches the caller (it is only logged) — current contract', async () => {
    const { failTable } = jest.requireActual('../helpers/routeAuthHarness');
    failTable('recommendation_audit_logs');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { logRecommendationAudit } = jest.requireActual('../../services/recommendationAuditService');
    await expect(logRecommendationAudit({ company_id: CO_A })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('T17 delete-activity truthfulness (owner decision 7 pending; pinned)', () => {
  const ACT = '0a000000-0000-4000-8000-0000000000a7';
  it('a missing activity id → 404 NOT_FOUND (pre-read existence check; correct today)', async () => {
    const r = await invoke(deleteActivityRoute as never, {
      method: 'POST', headers: bearer('SUPER'),
      body: { activityId: '0a000000-0000-4000-8000-00000000dead', reason: 'c15c probe' },
    });
    expect(r.status).toBe(404);
    expect(rows('super_admin_audit_logs')).toHaveLength(0);
  });

  test.failing('a row removed between the pre-read and the delete (concurrent delete) never answers 200 "deleted successfully"', async () => {
    seed({ daily_content_plans: [{ id: ACT, campaign_id: 'camp-x' }], super_admin_audit_logs: [] });
    mockBeforeDelete = () => { const t = rows('daily_content_plans'); t.splice(t.findIndex((r) => r.id === ACT), 1); };
    const r = await invoke(deleteActivityRoute as never, { method: 'POST', headers: bearer('SUPER'), body: { activityId: ACT, reason: 'c15c probe' } });
    // deleteActivity returned { deleted: false }; the route ignores it (delete-activity.ts:66-82).
    expect(r.status).not.toBe(200);
  });

  it('unchanged authorization: an INVITED SUPER_ADMIN membership is refused (isSuperAdmin is active-only)', async () => {
    const r = await invoke(deleteActivityRoute as never, {
      method: 'POST', headers: bearer('INVITED'),
      body: { activityId: '0a000000-0000-4000-8000-00000000dead', reason: 'c15c probe' },
    });
    expect(r.status).toBe(403);
    expect(rows('super_admin_audit_logs')).toHaveLength(0);
  });
});
