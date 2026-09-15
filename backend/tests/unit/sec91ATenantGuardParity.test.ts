/**
 * SEC-91A (STEP 3AH-91) — A7: TenantGuard keeps two decision copies,
 * assertTenantAccessSequential (authoritative while the `tenant-guard-batch`
 * rollout flag is off, the default) and assertTenantAccessBatched (flag
 * shadow/enforce). Their header says "line-for-line mirror"; nothing proved it.
 *
 * This runs BOTH paths over the same fixture matrix (membership status × role ×
 * org state × super-admin row status × role gate × bypass opt-out × lookup
 * failures) through the public assertTenantAccess entry point, flipping only the
 * rollout mode, and requires identical decisions. It also pins the A2 change on
 * both paths: an inactive / invited SUPER_ADMIN row never bypasses.
 */
import { seed, failTable } from '../helpers/routeAuthHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());

let batchMode: 'off' | 'enforce' = 'off';
jest.mock('../../../lib/platform/rollout', () => {
  const actual = jest.requireActual('../../../lib/platform/rollout');
  return {
    ...actual,
    resolveRolloutSync: (flag: { key: string }, opts?: { tenantId?: string }) =>
      flag.key === 'tenant-guard-batch' ? { mode: batchMode, source: 'env' } : actual.resolveRolloutSync(flag, opts),
  };
});
jest.mock('../../../lib/platform/rolloutAdmin', () => ({
  // enforce → the candidate (batched) path decides.
  runWithRollout: (_flag: unknown, args: { candidate: () => unknown }) => args.candidate(),
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const { assertTenantAccess } = require('../../security/TenantGuard');
/* eslint-enable @typescript-eslint/no-var-requires */

const U = 'user-p-00-0000-0000-00000000000p';
const ORG = 'org-p-000-0000-0000-00000000000p';
const OTHER = 'org-q-000-0000-0000-00000000000q';

type Fixture = {
  membership: null | { role: string; status: string };
  org: null | 'active' | 'inactive' | 'suspended';
  superRow: null | 'active' | 'inactive' | 'invited';
  fail: null | 'user_company_roles' | 'companies';
  options?: { requireRoleIn?: string[]; noPlatformBypass?: boolean };
};

function world(f: Fixture) {
  const roles: Record<string, unknown>[] = [];
  if (f.membership) roles.push({ user_id: U, company_id: ORG, ...f.membership });
  if (f.superRow) roles.push({ user_id: U, company_id: OTHER, role: 'SUPER_ADMIN', status: f.superRow });
  seed({
    user_company_roles: roles,
    companies: f.org ? [{ id: ORG, status: f.org }] : [],
  });
  if (f.fail) failTable(f.fail);
}

async function decide(f: Fixture, mode: 'off' | 'enforce') {
  world(f);
  batchMode = mode;
  const r = await assertTenantAccess({ userId: U, organizationId: ORG, options: f.options });
  return r.ok
    ? { ok: true, bypass: r.access.bypass, role: r.access.role, isPlatformSuperAdmin: r.access.isPlatformSuperAdmin }
    : { ok: false, reason: r.reason };
}

const memberships: Fixture['membership'][] = [
  null,
  { role: 'COMPANY_ADMIN', status: 'active' },
  { role: 'VIEW_ONLY', status: 'active' },
  { role: 'COMPANY_ADMIN', status: 'invited' },
  { role: 'COMPANY_ADMIN', status: 'inactive' },
];
const orgs: Fixture['org'][] = [null, 'active', 'inactive', 'suspended'];
const superRows: Fixture['superRow'][] = [null, 'active', 'inactive', 'invited'];
const optionSets: Fixture['options'][] = [undefined, { requireRoleIn: ['COMPANY_ADMIN'] }, { noPlatformBypass: true }];

const matrix: Fixture[] = [];
for (const membership of memberships) for (const org of orgs) for (const superRow of superRows) for (const options of optionSets) {
  matrix.push({ membership, org, superRow, fail: null, options });
}
// Lookup failures (retry path) on a representative subset.
for (const fail of ['user_company_roles', 'companies'] as const) {
  matrix.push({ membership: { role: 'COMPANY_ADMIN', status: 'active' }, org: 'active', superRow: null, fail });
  matrix.push({ membership: { role: 'COMPANY_ADMIN', status: 'active' }, org: 'active', superRow: 'active', fail });
}

describe('TenantGuard: sequential and batched decision copies agree', () => {
  it(`identical decisions across ${matrix.length} fixtures`, async () => {
    const divergences: unknown[] = [];
    for (const f of matrix) {
      const seq = await decide(f, 'off');
      const bat = await decide(f, 'enforce');
      if (JSON.stringify(seq) !== JSON.stringify(bat)) divergences.push({ f, seq, bat });
    }
    expect(divergences).toEqual([]);
  }, 60_000);

  it.each(['off', 'enforce'] as const)('[%s] an inactive or invited SUPER_ADMIN row never bypasses; an active one does', async (mode) => {
    const base = { membership: null, org: 'active' as const, fail: null };
    expect(await decide({ ...base, superRow: 'inactive' }, mode)).toEqual({ ok: false, reason: 'NOT_A_MEMBER' });
    expect(await decide({ ...base, superRow: 'invited' }, mode)).toEqual({ ok: false, reason: 'NOT_A_MEMBER' });
    expect(await decide({ ...base, superRow: 'active' }, mode)).toMatchObject({ ok: true, bypass: true });
  });

  it.each(['off', 'enforce'] as const)('[%s] a soft-deleted (status inactive) org is refused even to its admin', async (mode) => {
    expect(await decide({ membership: { role: 'COMPANY_ADMIN', status: 'active' }, org: 'inactive', superRow: null, fail: null }, mode))
      .toEqual({ ok: false, reason: 'ORG_INACTIVE' });
  });

  it.each(['off', 'enforce'] as const)('[%s] a membership lookup failure is retryable, never an allow', async (mode) => {
    expect(await decide({ membership: { role: 'COMPANY_ADMIN', status: 'active' }, org: 'active', superRow: null, fail: 'user_company_roles' }, mode))
      .toEqual({ ok: false, reason: 'TENANT_LOOKUP_ERROR' });
  });
});
