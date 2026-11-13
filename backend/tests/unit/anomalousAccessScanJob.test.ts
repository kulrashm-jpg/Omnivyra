/**
 * The scan job's real I/O wiring: each source reads the RIGHT table, columns and time column (capability_audit_log is
 * keyed on occurred_at, not created_at), AI_GATEWAY_CALL is excluded at the source, a read error / truncation is
 * passed through (never swallowed), the R4 allowlist comes from config only, and the Redis cooldown falls back to an
 * in-process map when Redis is down. Plus the action-classification pin: every action string an audit writer can
 * record is classified (privileged / denial / not monitored), so a NEW privileged action cannot slip in unlisted.
 */
import * as fs from 'fs';
import * as path from 'path';

type Call = { table: string; select?: string; gte?: [string, string]; neq?: [string, string]; inList?: [string, string[]]; limit?: number };
const mockState: { calls: Call[]; result: { data: unknown[] | null; error: { message: string } | null }; redisDown: boolean; redisStore: Map<string, string> } = {
  calls: [], result: { data: [], error: null }, redisDown: false, redisStore: new Map(),
};

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      const call: Call = { table };
      mockState.calls.push(call);
      const b: any = {
        select: (s: string) => { call.select = s; return b; },
        gte: (c: string, v: string) => { call.gte = [c, v]; return b; },
        neq: (c: string, v: string) => { call.neq = [c, v]; return b; },
        in: (c: string, v: string[]) => { call.inList = [c, v]; return b; },
        limit: (n: number) => { call.limit = n; return Promise.resolve(mockState.result); },
      };
      return b;
    },
  },
}));
jest.mock('../../../lib/redis/client', () => ({
  getSharedRedisConnection: async () => {
    if (mockState.redisDown) throw new Error('redis unavailable');
    return {
      set: async (k: string, v: string, _ex: string, _ttl: number, nx: string) => {
        if (nx === 'NX' && mockState.redisStore.has(k)) return null;
        mockState.redisStore.set(k, v); return 'OK';
      },
      incr: async (k: string) => { const n = Number(mockState.redisStore.get(k) ?? 0) + 1; mockState.redisStore.set(k, String(n)); return n; },
      expire: async () => 1,
      mget: async (...ks: string[]) => ks.map((k) => mockState.redisStore.get(k) ?? null),
    };
  },
}));
jest.mock('../../services/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../../observability', () => ({ recordRawCounter: jest.fn() }));
jest.mock('../../services/auditActorService', () => ({ SYSTEM_USER_ID: '00000000-0000-0000-0000-000000000000' }));

import { buildScanDeps, parseAllowlist, SOURCE_ROW_LIMIT } from '../../jobs/anomalousAccessScanJob';
import {
  isPrivileged, R2_ACTIONS, NOT_MONITORED_ACTIONS, NOT_MONITORED_PREFIXES,
} from '../../services/security/anomalousAccessRules';

const SINCE = '2026-11-20T11:50:00.000Z';
beforeEach(() => { mockState.calls = []; mockState.result = { data: [], error: null }; mockState.redisDown = false; mockState.redisStore = new Map(); });

describe('source reads', () => {
  it('audit_logs: canonical columns, created_at window, AI_GATEWAY_CALL excluded, bounded', async () => {
    await buildScanDeps({}).readAudit(SINCE);
    expect(mockState.calls).toEqual([{ table: 'audit_logs', select: 'actor_user_id, action, target_user_id', gte: ['created_at', SINCE], neq: ['action', 'AI_GATEWAY_CALL'], limit: SOURCE_ROW_LIMIT }]);
  });
  it('capability_audit_log: keyed on occurred_at (NOT created_at), failure decisions only', async () => {
    await buildScanDeps({}).readCapability(SINCE);
    expect(mockState.calls[0]).toMatchObject({ table: 'capability_audit_log', select: 'actor_user_id, decision', gte: ['occurred_at', SINCE] });
    expect(mockState.calls[0].inList).toEqual(['decision', ['totp_verification_failed', 'passkey_auth_failed', 'stepup_session_rejected']]);
  });
  it('super_admin_audit_logs: actor_user_id + action on created_at', async () => {
    await buildScanDeps({}).readAdmin(SINCE);
    expect(mockState.calls[0]).toMatchObject({ table: 'super_admin_audit_logs', select: 'actor_user_id, action', gte: ['created_at', SINCE] });
  });
  it('a read ERROR is passed through (never swallowed into an empty, quiet result)', async () => {
    mockState.result = { data: null, error: { message: 'relation does not exist' } };
    await expect(buildScanDeps({}).readAudit(SINCE)).resolves.toMatchObject({ rows: [], error: 'relation does not exist' });
  });
  it('hitting the row limit is reported as TRUNCATED', async () => {
    mockState.result = { data: Array.from({ length: SOURCE_ROW_LIMIT }, () => ({})), error: null };
    await expect(buildScanDeps({}).readAudit(SINCE)).resolves.toMatchObject({ truncated: true });
  });
});

describe('R4 allowlist comes from config only', () => {
  it('unset / blank -> null (R4 disabled, reported by the scan)', () => {
    expect(parseAllowlist(undefined)).toBeNull();
    expect(parseAllowlist('  ')).toBeNull();
  });
  it('comma-separated UUIDs, lower-cased; non-UUID entries dropped (counted, never logged by value)', () => {
    const s = parseAllowlist(' 27AB036D-D8BC-4617-A249-BFAE07A6B3F7 , not-a-uuid,fa9c4540-310d-4510-bb85-381dd270fcd9');
    expect(s && [...s].sort()).toEqual(['27ab036d-d8bc-4617-a249-bfae07a6b3f7', 'fa9c4540-310d-4510-bb85-381dd270fcd9']);
  });
  it('buildScanDeps reads AUDIT_PRIVILEGED_ACTOR_IDS from the environment it is given', () => {
    expect(buildScanDeps({ AUDIT_PRIVILEGED_ACTOR_IDS: 'fa9c4540-310d-4510-bb85-381dd270fcd9' }).config.allowlist?.size).toBe(1);
    expect(buildScanDeps({}).config.allowlist).toBeNull();
  });
  it('no actor UUID is hard-coded in the detector code (config only)', () => {
    const ROOT = path.resolve(__dirname, '../../..');
    for (const rel of ['backend/jobs/anomalousAccessScanJob.ts', 'backend/services/security/anomalousAccessDetector.ts', 'backend/services/security/anomalousAccessRules.ts']) {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      const uuids = (src.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? []).filter((u) => u !== '00000000-0000-0000-0000-000000000000');
      expect([rel, uuids]).toEqual([rel, []]);
    }
  });
});

describe('cooldown store', () => {
  it('Redis SET NX EX: first claim wins, the second is suppressed', async () => {
    const d = buildScanDeps({});
    expect(await d.claimCooldown('k1', 3600)).toBe(true);
    expect(await d.claimCooldown('k1', 3600)).toBe(false);
  });
  it('Redis DOWN -> in-process fallback still dedupes (a storm does not page every run)', async () => {
    mockState.redisDown = true;
    const d = buildScanDeps({});
    expect(await d.claimCooldown('k-down', 3600)).toBe(true);
    expect(await d.claimCooldown('k-down', 3600)).toBe(false);
  });
  it('fire counts sum the last 7 days', async () => {
    const d = buildScanDeps({});
    const now = Date.parse('2026-11-20T12:00:00Z');
    await d.recordFire('R2_denial_burst', now);
    await d.recordFire('R2_denial_burst', now - 3 * 86_400_000);
    await d.recordFire('R2_denial_burst', now - 9 * 86_400_000); // outside the week
    expect(await d.firesLast7Days('R2_denial_burst', now)).toBe(2);
  });
});

describe('action classification pin - a NEW audit action must be classified', () => {
  const ROOT = path.resolve(__dirname, '../../..');
  function walk(d: string, o: string[] = []): string[] {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, o); else if (/\.tsx?$/.test(e.name)) o.push(p);
    }
    return o;
  }
  const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join('/');
  const WRITER = /insertAuditLog(Strict)?\(|(from|ownedDbTable)\(['"]audit_logs['"]\)|recordAdminAudit\(/;
  function actionsWritten(): Map<string, string> {
    const out = new Map<string, string>();
    const files = ['backend', 'pages', 'lib'].flatMap((d) => walk(path.join(ROOT, d))).filter((f) => !rel(f).startsWith('backend/tests/'));
    for (const f of files) {
      const s = fs.readFileSync(f, 'utf8');
      if (!WRITER.test(s)) continue;
      for (const m of s.matchAll(/action\s*:\s*([^,}\n]{0,160})/g)) for (const q of m[1].matchAll(/'([A-Z][A-Z0-9_]{3,})'/g)) out.set(q[1], rel(f));
      for (const q of s.matchAll(/'((?:SUPER_ADMIN|COMPANY_ADMIN|ADMIN_CREDITS)[A-Z0-9_]*)'/g)) out.set(q[1], rel(f));
    }
    return out;
  }
  const classified = (action: string) => isPrivileged(action) || R2_ACTIONS.has(action)
    || action in NOT_MONITORED_ACTIONS || NOT_MONITORED_PREFIXES.some((p) => action.startsWith(p));

  it('every action an audit writer records is classified', () => {
    const written = actionsWritten();
    // POSITIVE CONTROL: the extraction is non-vacuous and sees the known writers
    expect(written.size).toBeGreaterThanOrEqual(30);
    for (const known of ['SUPER_ADMIN_USER_SUSPEND', 'UPDATE_USER_ROLE', 'PERMISSION_DENIED', 'COMPANY_ADMIN_INVITE_CREATE', 'ADMIN_CREDITS_GRANT', 'AI_GATEWAY_CALL']) {
      expect([known, written.has(known)]).toEqual([known, true]);
    }
    const unclassified = [...written].filter(([a]) => !classified(a)).map(([a, f]) => `${a} (${f})`);
    expect(unclassified).toEqual([]);
  }, 120_000);

  it('CONTROL: an unknown action is NOT classified (the pin can fail)', () => {
    expect(classified('SOMETHING_NEW_AND_DANGEROUS')).toBe(false);
  });
});
