/**
 * Claim/lease remediation — Option E (B: lease renewal + D: operator recovery).
 *
 * The defect: the extension's worst-case execution window is 96s
 * (EXECUTION_TIMEOUT 30s x 3 attempts + RETRY_DELAY 2s + 4s) while the server
 * lease was 90s and was never renewed. A retrying command was therefore
 * GUARANTEED to outlive its claim, at which point /api/extension/commands
 * re-offered it to another session while the first was still driving the
 * browser — one intended DM, two real DMs, and the first sender's result
 * rejected as LEASE_EXPIRED so nothing recorded it.
 *
 * Renewal is a timestamp move and nothing else. These tests hold that line:
 * no message, no platform id, no counter, no opportunity transition.
 */

interface Row { [k: string]: unknown }
const db: Record<string, Row[]> = { community_ai_actions: [], engagement_messages: [] };

/** Builder supporting .eq/.is/.not/.gt/.lt plus conditional update. */
function builder(table: string) {
  const preds: Array<(r: Row) => boolean> = [];
  const rows = () => (db[table] ?? []).filter((r) => preds.every((p) => p(r)));
  const api: any = {
    select() { return api; },
    eq(c: string, v: unknown) { preds.push((r) => r[c] === v); return api; },
    is(c: string, v: unknown) { preds.push((r) => (r[c] ?? null) === v); return api; },
    not(c: string, _op: string, v: unknown) { preds.push((r) => (r[c] ?? null) !== v); return api; },
    gt(c: string, v: unknown) { preds.push((r) => String(r[c] ?? '') > String(v)); return api; },
    lt(c: string, v: unknown) { preds.push((r) => String(r[c] ?? '') < String(v)); return api; },
    or() { return api; },
    order() { return api; }, limit() { return api; },
    update(patch: Row) {
      const upd: any = {
        eq(c: string, v: unknown) { preds.push((r) => r[c] === v); return upd; },
        is(c: string, v: unknown) { preds.push((r) => (r[c] ?? null) === v); return upd; },
        gt(c: string, v: unknown) { preds.push((r) => String(r[c] ?? '') > String(v)); return upd; },
        select() {
          const matched = rows();
          matched.forEach((r) => Object.assign(r, patch));
          return {
            maybeSingle: () => Promise.resolve({ data: matched[0] ?? null, error: null }),
          };
        },
      };
      return upd;
    },
    maybeSingle() { return Promise.resolve({ data: rows()[0] ?? null, error: null }); },
    then(res: (v: unknown) => unknown) { return Promise.resolve({ data: rows(), error: null }).then(res); },
  };
  return api;
}
jest.mock('@/backend/db/supabaseClient', () => ({ supabase: { from: (t: string) => builder(t) } }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => builder(t) } }));

const ORG = 'org_eng';
const OTHER_ORG = 'org_rival';
let currentSession: { userId: string; orgId: string; hmacNonce: string } | null = {
  userId: 'user_1', orgId: ORG, hmacNonce: 'nonce-A',
};
jest.mock('@/backend/middleware/extensionAuthMiddleware', () => ({
  requireExtensionAuth: async () => (currentSession ? { session: currentSession } : null),
}));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import { createHash } from 'crypto';
import renewHandler from '../../../pages/api/extension/dispatch/renew';

/** Same derivation the route uses. */
const holderFor = (s: { userId: string; orgId: string; hmacNonce: string }) =>
  createHash('sha256').update(`lease-holder:${s.userId}:${s.orgId}:${s.hmacNonce}`).digest('hex').slice(0, 32);

const HOLDER_A = holderFor({ userId: 'user_1', orgId: ORG, hmacNonce: 'nonce-A' });

function mockRes() {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.setHeader = () => res;
  return res;
}

async function renew(body: Record<string, unknown>) {
  const res = mockRes();
  await (renewHandler as any)({ method: 'POST', body, headers: {} }, res);
  return res;
}

const future = (ms = 60_000) => new Date(Date.now() + ms).toISOString();
const past = (ms = 60_000) => new Date(Date.now() - ms).toISOString();

function seedClaimed(over: Partial<Row> = {}): Row {
  const row: Row = {
    id: 'cmd_1', organization_id: ORG, status: 'pending', execution_mode: 'browser',
    platform: 'linkedin', action_type: 'dm', target_id: 'urn:li:dm:A',
    dispatch_lease_id: 'lease-A', dispatch_lease_holder_id: HOLDER_A,
    dispatch_lease_expires_at: future(), dispatch_acknowledged_at: null,
    created_at: past(120_000),
    ...over,
  };
  db.community_ai_actions.push(row);
  return row;
}

beforeEach(() => {
  db.community_ai_actions = []; db.engagement_messages = [];
  currentSession = { userId: 'user_1', orgId: ORG, hmacNonce: 'nonce-A' };
});

// ─────────────────────────────────────────────────────────────────────────────
describe('backend renewal — the happy path is narrow on purpose', () => {
  it('the true holder renews and receives the new expiry', async () => {
    const row = seedClaimed({ dispatch_lease_expires_at: future(5_000) });
    const before = row.dispatch_lease_expires_at;
    const res = await renew({ commandId: 'cmd_1', leaseId: 'lease-A' });

    expect(res.statusCode).toBe(200);
    expect(res.body.lease.id).toBe('lease-A');
    expect(String(row.dispatch_lease_expires_at) > String(before)).toBe(true);
  });

  it('renewal is idempotent — repeated calls just push the expiry out', async () => {
    seedClaimed({ dispatch_lease_expires_at: future(5_000) });
    expect((await renew({ commandId: 'cmd_1', leaseId: 'lease-A' })).statusCode).toBe(200);
    expect((await renew({ commandId: 'cmd_1', leaseId: 'lease-A' })).statusCode).toBe(200);
    expect((await renew({ commandId: 'cmd_1', leaseId: 'lease-A' })).statusCode).toBe(200);
  });

  it('renewal moves ONLY the expiry — it asserts nothing about delivery', async () => {
    const row = seedClaimed({ dispatch_lease_expires_at: future(5_000) });
    await renew({ commandId: 'cmd_1', leaseId: 'lease-A' });

    expect(row.status).toBe('pending');                 // still merely claimed
    expect(row.dispatch_acknowledged_at).toBeNull();
    expect(row.execution_result).toBeUndefined();
    expect(db.engagement_messages).toHaveLength(0);     // no fabricated message
    expect(JSON.stringify(row)).not.toContain('platform_message_id');
  });
});

describe('backend renewal — fail-closed refusals', () => {
  it('a different holder cannot renew', async () => {
    seedClaimed();
    currentSession = { userId: 'user_2', orgId: ORG, hmacNonce: 'nonce-B' };
    const res = await renew({ commandId: 'cmd_1', leaseId: 'lease-A' });
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe('LEASE_HOLDER_MISMATCH');
  });

  it('a wrong lease id cannot renew', async () => {
    seedClaimed();
    const res = await renew({ commandId: 'cmd_1', leaseId: 'lease-WRONG' });
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe('LEASE_ID_MISMATCH');
  });

  it('another company\'s command is invisible, not merely refused', async () => {
    seedClaimed({ organization_id: OTHER_ORG });
    const res = await renew({ commandId: 'cmd_1', leaseId: 'lease-A' });
    expect(res.statusCode).toBe(404);
    expect(res.body.error).toBe('COMMAND_NOT_FOUND');
  });

  it('an already-expired lease cannot be revived', async () => {
    const row = seedClaimed({ dispatch_lease_expires_at: past() });
    const res = await renew({ commandId: 'cmd_1', leaseId: 'lease-A' });
    // By now the command may already have been re-offered; silently extending
    // would hand two sessions a live claim.
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe('LEASE_EXPIRED');
    expect(row.dispatch_lease_expires_at).toBe(past.call(null) ? row.dispatch_lease_expires_at : null);
  });

  it.each(['executed', 'failed', 'skipped', 'sent_unverified', 'blocked'])(
    'a terminal (%s) command cannot be renewed',
    async (status) => {
      seedClaimed({ status });
      const res = await renew({ commandId: 'cmd_1', leaseId: 'lease-A' });
      expect(res.statusCode).toBe(409);
      expect(res.body.error).toBe('TERMINAL');
    },
  );

  it('a never-claimed command has no lease to renew', async () => {
    seedClaimed({ dispatch_lease_id: null, dispatch_lease_holder_id: null });
    const res = await renew({ commandId: 'cmd_1', leaseId: 'lease-A' });
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe('NO_ACTIVE_LEASE');
  });

  it('an unknown command id is refused', async () => {
    const res = await renew({ commandId: 'nope', leaseId: 'lease-A' });
    expect(res.statusCode).toBe(404);
  });

  it('missing parameters are refused before any lookup', async () => {
    expect((await renew({ leaseId: 'lease-A' })).statusCode).toBe(400);
    expect((await renew({ commandId: 'cmd_1' })).statusCode).toBe(400);
  });

  it('an unauthenticated caller is refused', async () => {
    seedClaimed();
    currentSession = null;
    const res = await renew({ commandId: 'cmd_1', leaseId: 'lease-A' });
    expect(res.statusCode).toBe(0);            // middleware owns the response
  });

  it('renewal never touches a different action', async () => {
    const target = seedClaimed({ id: 'cmd_1', dispatch_lease_expires_at: future(5_000) });
    const other = seedClaimed({ id: 'cmd_2', dispatch_lease_id: 'lease-B', dispatch_lease_expires_at: future(5_000) });
    const otherExpiryBefore = other.dispatch_lease_expires_at;

    await renew({ commandId: 'cmd_1', leaseId: 'lease-A' });

    expect(other.dispatch_lease_expires_at).toBe(otherExpiryBefore);
    expect(target.dispatch_lease_expires_at).not.toBe(otherExpiryBefore);
  });

  it('concurrent renewals by the holder all converge, none corrupt state', async () => {
    const row = seedClaimed({ dispatch_lease_expires_at: future(5_000) });
    const results = await Promise.all(
      Array.from({ length: 8 }, () => renew({ commandId: 'cmd_1', leaseId: 'lease-A' })),
    );
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    expect(row.status).toBe('pending');
    expect(row.dispatch_lease_id).toBe('lease-A');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('re-offer rule is gated on PROVEN client capability', () => {
  const commandsSrc = require('fs').readFileSync('pages/api/extension/commands.ts', 'utf8');

  it('a renewal-capable client is only offered never-claimed work', () => {
    expect(commandsSrc).toContain("x-omnivyra-dispatch-renewal");
    expect(commandsSrc).toMatch(/supportsRenewal[\s\S]{0,200}is\('dispatch_lease_id',\s*null\)/);
  });

  it('legacy clients keep the lapsed-lease behaviour so they are not stranded', () => {
    expect(commandsSrc).toMatch(/else[\s\S]{0,300}dispatch_lease_expires_at\.lt\./);
  });

  it('capability is never inferred from the capability-map version', () => {
    // That header self-heals (the loader adopts the server's value), so it
    // identifies schema, not client build. Using it here would silently opt
    // v1.3.9 into a protocol it cannot honour.
    const gate = commandsSrc.slice(
      commandsSrc.indexOf('const supportsRenewal'),
      commandsSrc.indexOf('let query = supabase'),
    );
    expect(gate).not.toContain('CAPABILITY_MAP_VERSION');
    expect(gate).not.toContain('clientCapabilityVersion');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('extension side — renewal before EVERY attempt', () => {
  const procSrc = require('fs').readFileSync(
    'C:/Users/Admin/OneDrive/Desktop/omnivyra chrome ext/extension/core/commandProcessor.js',
    'utf8',
  );
  const apiSrc = require('fs').readFileSync(
    'C:/Users/Admin/OneDrive/Desktop/omnivyra chrome ext/extension/core/apiClient.js',
    'utf8',
  );

  it('renewal sits INSIDE the retry loop, not once before it', () => {
    const loopStart = procSrc.indexOf('for (let attempt = 1');
    const execCall = procSrc.indexOf('this.executeCommand(command)');
    const renewCall = procSrc.indexOf('renewDispatchLease(command.id, leaseId)');
    expect(renewCall).toBeGreaterThan(loopStart);   // inside the loop
    expect(renewCall).toBeLessThan(execCall);       // before execution
  });

  it('a refused renewal aborts BEFORE the irreversible action', () => {
    const guard = procSrc.slice(
      procSrc.indexOf('renewDispatchLease(command.id, leaseId)'),
      procSrc.indexOf('let rawResult;'),
    );
    expect(guard).toContain('LEASE_LOST');
    expect(guard).toContain('break');
    // It must not fall through into execution.
    expect(guard).not.toContain('executeCommand');
  });

  it('renewal failures are surfaced, never swallowed', () => {
    const fn = apiSrc.slice(
      apiSrc.indexOf('async renewDispatchLease'),
      apiSrc.indexOf('Submit command execution result to backend'),
    );
    expect(fn).toContain('errorCode');
    expect(fn).toContain('RENEWAL_REQUEST_FAILED');
    expect(fn).not.toMatch(/catch\s*\([^)]*\)\s*\{\s*\}/);   // no empty catch
  });

  it('the client advertises renewal capability on every request', () => {
    expect(apiSrc).toContain("options.headers['X-Omnivyra-Dispatch-Renewal'] = '1'");
  });

  it('renewal creates no engagement state client-side', () => {
    const fn = apiSrc.slice(
      apiSrc.indexOf('async renewDispatchLease'),
      apiSrc.indexOf('Submit command execution result to backend'),
    );
    expect(fn).not.toMatch(/engagement_messages|platform_message_id|author_self|direction/);
  });

  it('the extension release version was incremented — v1.3.9 is NOT fixed', () => {
    const manifest = JSON.parse(
      require('fs').readFileSync(
        'C:/Users/Admin/OneDrive/Desktop/omnivyra chrome ext/extension/manifest.json',
        'utf8',
      ),
    );
    expect(manifest.version).not.toBe('1.3.9');
  });
});
