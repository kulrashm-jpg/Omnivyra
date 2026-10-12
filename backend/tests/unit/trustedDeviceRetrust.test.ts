/**
 * Closure-011 — a browser whose device trust EXPIRED or was REVOKED can be
 * trusted again.
 *
 * `trusted_devices` has UNIQUE (user_id, fingerprint) with no partial
 * predicate (migration 20260507; same in the baseline schema). register() used
 * to INSERT whenever no LIVE row existed, so after the 30-day expiry (or a
 * revoke) the INSERT hit the constraint, threw, and /api/auth/devices/trust
 * answered 500 — the step-up retry then failed again, and every step-up write
 * requiring a trusted device was unreachable from that browser.
 *
 * The fake table below ENFORCES the unique constraint and evaluates update
 * predicates at write time (a compare-and-set loser matches nothing). It
 * proves the service's decisions, not Postgres behaviour.
 */
type Row = Record<string, unknown>;
const mockRows: Row[] = [];
const mockEvents: Row[] = [];
let mockBeforeUpdate: (() => void) | null = null;

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => {
    const filters: Array<[string, 'eq' | 'is', unknown]> = [];
    let op: 'select' | 'insert' | 'update' = 'select';
    let payload: Row = {};
    const matches = (r: Row) => filters.every(([k, m, v]) => (m === 'is' ? (r[k] ?? null) === v : r[k] === v));
    const run = () => {
      if (op === 'insert') {
        if (mockRows.some((r) => r.user_id === payload.user_id && r.fingerprint === payload.fingerprint)) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "trusted_devices_user_fingerprint_unique"' } };
        }
        const row = { id: `dev-${mockRows.length + 1}`, revoked_at: null, revocation_reason: null, ...payload };
        mockRows.push(row);
        return { data: [row], error: null };
      }
      if (op === 'update') {
        if (mockBeforeUpdate) { const h = mockBeforeUpdate; mockBeforeUpdate = null; h(); }
        const hit = mockRows.filter(matches);
        hit.forEach((r) => Object.assign(r, payload));
        return { data: hit.map((r) => ({ ...r })), error: null };
      }
      return { data: mockRows.filter(matches).map((r) => ({ ...r })), error: null };
    };
    const b: Record<string, unknown> = {
      select: () => b, order: () => b, limit: () => b,
      eq: (k: string, v: unknown) => { filters.push([k, 'eq', v]); return b; },
      is: (k: string, v: unknown) => { filters.push([k, 'is', v]); return b; },
      insert: (p: Row) => { op = 'insert'; payload = p; return b; },
      update: (p: Row) => { op = 'update'; payload = p; return b; },
      maybeSingle: async () => { const r = run(); return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error }; },
      single: async () => { const r = run(); return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error }; },
      then: (ok: (v: unknown) => unknown, err: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, err),
    };
    return b;
  },
}));
jest.mock('../../db/supabaseClient', () => ({ supabase: {} }));
jest.mock('../../services/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } }));
jest.mock('../../security/audit/SecurityAuditService', () => ({ logSecurityEvent: async (e: Row) => { mockEvents.push(e); } }));

import { register } from '../../security/devices/TrustedDeviceService';

const USER = '11111111-1111-4111-8111-111111111111';
const FP = 'dj2-abcdefghij';
const past = () => new Date(Date.now() - 60_000).toISOString();
const future = () => new Date(Date.now() + 60_000).toISOString();
const seedRow = (over: Row) => mockRows.push({
  id: 'dev-old', user_id: USER, fingerprint: FP, label: 'old', first_seen_at: past(), last_seen_at: past(),
  expires_at: future(), revoked_at: null, revocation_reason: null, ...over,
});

beforeEach(() => { mockRows.length = 0; mockEvents.length = 0; mockBeforeUpdate = null; });

describe('trusting a device', () => {
  it('a never-trusted browser: a new row, live, audited', async () => {
    const r = await register({ userId: USER, fingerprint: FP, label: 'laptop' });
    expect(r.ok).toBe(true);
    expect(mockRows).toHaveLength(1);
    expect(mockRows[0]).toMatchObject({ user_id: USER, fingerprint: FP, revoked_at: null });
    expect(mockEvents.some((e) => e.decision === 'trusted_device_registered')).toBe(true);
  });

  it('an already-trusted (live) browser: ALREADY_TRUSTED, nothing written', async () => {
    seedRow({});
    const r = await register({ userId: USER, fingerprint: FP });
    expect(r).toEqual({ ok: false, reason: 'ALREADY_TRUSTED' });
    expect(mockRows).toHaveLength(1);
    expect(mockRows[0].label).toBe('old');
  });

  it('a browser whose trust EXPIRED is trusted again — the same row is revived (was: unique violation → 500)', async () => {
    seedRow({ expires_at: past() });
    const r = await register({ userId: USER, fingerprint: FP, label: 'laptop' });
    expect(r.ok).toBe(true);
    expect(mockRows).toHaveLength(1);
    expect(mockRows[0].id).toBe('dev-old');
    expect(new Date(String(mockRows[0].expires_at)).getTime()).toBeGreaterThan(Date.now());
    expect(mockRows[0]).toMatchObject({ revoked_at: null, label: 'laptop' });
  });

  it('a browser whose trust was REVOKED is trusted again (a fresh step-up is still required by the route)', async () => {
    seedRow({ revoked_at: past(), revocation_reason: 'user_revoked' });
    const r = await register({ userId: USER, fingerprint: FP });
    expect(r.ok).toBe(true);
    expect(mockRows).toHaveLength(1);
    expect(mockRows[0]).toMatchObject({ id: 'dev-old', revoked_at: null, revocation_reason: null });
  });

  it('another user\'s row for the same fingerprint is never revived or touched', async () => {
    seedRow({ user_id: 'someone-else', expires_at: past() });
    const r = await register({ userId: USER, fingerprint: FP });
    expect(r.ok).toBe(true);
    expect(mockRows).toHaveLength(2);
    expect(mockRows.find((x) => x.user_id === 'someone-else')).toMatchObject({ id: 'dev-old' });
    expect(new Date(String(mockRows.find((x) => x.user_id === 'someone-else')!.expires_at)).getTime()).toBeLessThan(Date.now());
  });

  it('a concurrent re-trust revives it first: the compare-and-set loses and the caller gets ALREADY_TRUSTED, nothing clobbered', async () => {
    seedRow({ expires_at: past() });
    const concurrentExpiry = future();
    mockBeforeUpdate = () => { Object.assign(mockRows[0], { expires_at: concurrentExpiry, label: 'other-tab' }); };
    const r = await register({ userId: USER, fingerprint: FP, label: 'this-tab' });
    expect(r).toEqual({ ok: false, reason: 'ALREADY_TRUSTED' });
    expect(mockRows).toHaveLength(1);
    expect(mockRows[0]).toMatchObject({ label: 'other-tab', expires_at: concurrentExpiry });
  });

  it('an unusable fingerprint is still refused before anything is read or written', async () => {
    const r = await register({ userId: USER, fingerprint: 'short' });
    expect(r).toEqual({ ok: false, reason: 'FINGERPRINT_UNAVAILABLE' });
    expect(mockRows).toHaveLength(0);
  });
});
