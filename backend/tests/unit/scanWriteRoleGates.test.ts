/**
 * scripts/security/scan-write-role-gates.js - structural rules added from e1's run over billing/admin/company
 * (2026-11-13): withRBAC with a same-file const list, withOrgAccess/assertOrgAccess as membership-only,
 * requireTenantAccess with requireRoleIn as a role gate, and role lists that admit a view-only role are NOT gates.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

const SCRIPT = path.resolve(__dirname, '../../../scripts/security/scan-write-role-gates.js');

const FIXTURES: Record<string, string> = {
  'named-const-ok.ts': `const ALLOWED_ROLES = [Role.COMPANY_ADMIN, Role.CONTENT_CREATOR];
    async function handler(req) { if (req.method === 'POST') await requireTenantAccess(req, res, id); }
    export default withRBAC(handler, ALLOWED_ROLES);`,
  'named-const-view.ts': `const ALLOWED_ROLES = [Role.COMPANY_ADMIN, Role.VIEW_ONLY];
    async function handler(req) { if (req.method === 'POST') await requireTenantAccess(req, res, id); }
    export default withRBAC(handler, ALLOWED_ROLES);`,
  'inline-ok.ts': `async function handler(req) { if (req.method === 'POST') await enforceCompanyAccess(req); }
    export default withRBAC(handler, [Role.COMPANY_ADMIN]);`,
  'with-org-access.ts': `async function handler(req) { if (req.method === 'POST') { /* write */ } }
    export default withOrgAccess(handler);`,
  'role-in-ok.ts': `async function handler(req) {
      if (req.method === 'DELETE') await requireTenantAccess(req, res, id, { requireRoleIn: [Role.COMPANY_ADMIN] }); }`,
  'role-in-view.ts': `async function handler(req) {
      if (req.method === 'DELETE') await requireTenantAccess(req, res, id, { requireRoleIn: ['VIEWER', 'COMPANY_ADMIN'] }); }`,
  'bare-tenant.ts': `async function handler(req) { if (req.method === 'PUT') await requireTenantAccess(req, res, id); }`,
};

let dir: string;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-wrg-'));
  for (const [name, src] of Object.entries(FIXTURES)) fs.writeFileSync(path.join(dir, name), src);
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

function scan(extra: string[] = []) {
  const r = spawnSync(process.execPath, [SCRIPT, '--dir', '.', '--object', '.', '--json', ...extra], { cwd: dir, encoding: 'utf8' });
  return { status: r.status, out: JSON.parse(r.stdout) as { counts: Record<string, number>; hits: string[] } };
}

describe('scan-write-role-gates structural rules', () => {
  it('reports exactly the ungated / view-admitting fixtures', () => {
    const { out } = scan();
    expect(out.counts.scanned).toBe(7);
    expect(out.counts.membershipOnlyCandidates).toBe(7); // withOrgAccess counted as a membership gate
    expect([...out.hits].sort()).toEqual([
      'bare-tenant.ts',
      'named-const-view.ts  (role list admits a view-only role)',
      'role-in-view.ts  (role list admits a view-only role)',
      'with-org-access.ts',
    ]);
  });
  it('--fail exits 1 on hits; an empty dir exits 2 (nothing scanned is not a pass)', () => {
    expect(scan(['--fail']).status).toBe(1);
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-wrg-empty-'));
    try {
      const r = spawnSync(process.execPath, [SCRIPT, '--dir', '.'], { cwd: empty, encoding: 'utf8' });
      expect(r.status).toBe(2);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});
