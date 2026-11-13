/**
 * M5 (e1, e9-approved BLOCKING money 2026-11-13): grantAdminCreditExtension is ONE call to public.admin_grant_credits
 * (20270217000017) - per-org lock, rolling-24h count, ledger and audit in one transaction. The guarantees themselves are
 * proven against Postgres in backend/tests/realschema/admin_grant_velocity_cap_017.test.ts; this pins the service:
 * the request key is mandatory, the RPC gets the one TS cap value, every refusal maps to its typed code, and there is
 * NO fallback to the old count-then-act path (no table reads or ledger calls of its own).
 */
import * as fs from 'fs';
import * as path from 'path';

const rpc = jest.fn();
const fromCalls: string[] = [];
jest.mock('../../db/supabaseClient', () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a), from: (t: string) => { fromCalls.push(t); throw new Error('no direct table access'); } },
}));
const warn = jest.fn();
jest.mock('../../services/logger', () => ({ logger: { info: jest.fn(), warn: (...a: unknown[]) => warn(...a), error: jest.fn() } }));

import { grantAdminCreditExtension, ADMIN_GRANT_MAX_PER_DAY } from '../../services/creditAdminGrantService';

const ORG = '11111111-1111-4111-8111-111111111111';
const ACTOR = '22222222-2222-4222-8222-222222222222';
const base = { organizationId: ORG, credits: 50, reason: 'goodwill after outage', reasonType: 'goodwill' as const, actorUserId: ACTOR, clientKey: 'req-abc' };

beforeEach(() => { rpc.mockReset(); warn.mockReset(); fromCalls.length = 0; });

it('a grant without a request key is refused before any database call', async () => {
  const r = await grantAdminCreditExtension({ ...base, clientKey: '  ' });
  expect(r).toMatchObject({ ok: false, code: 'MISSING_CLIENT_KEY' });
  expect(rpc).not.toHaveBeenCalled();
});

it('one RPC call carries the request key, the TS cap and the override flag - and nothing else touches a table', async () => {
  rpc.mockResolvedValue({ data: { idempotency_key: `admin_grant:${ORG}:req-abc`, expires_at: null, replayed: false }, error: null });
  const r = await grantAdminCreditExtension(base);
  expect(r).toMatchObject({ ok: true, credits: 50, idempotencyKey: `admin_grant:${ORG}:req-abc` });
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(rpc.mock.calls[0][0]).toBe('admin_grant_credits');
  expect(rpc.mock.calls[0][1]).toMatchObject({ p_org_id: ORG, p_client_key: 'req-abc', p_max_per_24h: ADMIN_GRANT_MAX_PER_DAY, p_allow_over_limit: false });
  expect(fromCalls).toEqual([]);
});

it.each([
  [{ message: 'GRANT_LIMIT_EXCEEDED: 3 admin grant(s) ...', code: 'P0001' }, 'GRANT_LIMIT_EXCEEDED'],
  [{ message: 'ADMIN_GRANT_KEY_REUSED: key ...', code: 'P0001' }, 'GRANT_KEY_REUSED'],
  [{ message: 'Could not find the function public.admin_grant_credits', code: 'PGRST202' }, 'GRANT_UNAVAILABLE'],
  [{ message: 'connection reset', code: '' }, 'LEDGER_FAILED'],
])('RPC error %p -> %s, and NO fallback path runs', async (error, code) => {
  rpc.mockResolvedValue({ data: null, error });
  const r = await grantAdminCreditExtension(base);
  expect(r).toMatchObject({ ok: false, code });
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(fromCalls).toEqual([]);
});

it('an over-limit escalation is logged (and the RPC records it on the audit row)', async () => {
  rpc.mockResolvedValue({ data: { idempotency_key: 'k', over_limit: true }, error: null });
  await grantAdminCreditExtension({ ...base, allowOverLimit: true });
  expect(rpc.mock.calls[0][1]).toMatchObject({ p_allow_over_limit: true });
  expect(warn).toHaveBeenCalledWith('admin_grant_over_limit_override', expect.objectContaining({ orgId: ORG, actor: ACTOR }));
});

it('the service has no count-then-act remnant and no minute-bucket key (source pin)', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'backend/services/creditAdminGrantService.ts'), 'utf8');
  expect(src).not.toMatch(/countRecentGrants|minuteBucket|slice\(0,\s*16\)|createCredit\(|ownedDbTable/);
});

it('the route keys the grant on the REQUEST: body clientKey, else the Idempotency-Key header (source pin)', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'pages/api/admin/credits/grant.ts'), 'utf8');
  expect(src).toMatch(/clientKey: clientKey \?\? \(typeof req\.headers\['idempotency-key'\] === 'string'/);
});
