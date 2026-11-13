/**
 * M3 (owner-assigned to e1; spec virality-05, C:\tmp\pi-specs\M1-M5-AND-MONEY-SPEC.md): a TOTP code could be replayed
 * inside its validation window (otplib window ±1 does not track used tokens). Each successful verification now
 * CONSUMES its time step atomically in totp_factors.last_used_step. Codes are REAL otplib codes at fixed clock times.
 */
import { authenticator } from 'otplib';

// Production options (TotpEnrollmentService sets these on load): window ±1 step - the window a replay hides in.
authenticator.options = { ...authenticator.options, window: 1, step: 30 };
const SECRET = authenticator.generateSecret();
const FACTOR: Record<string, any> = {};
let mockUpdateError: { message: string } | null = null;

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => {
    let patch: Record<string, unknown> | null = null;
    const filters: Array<(r: Record<string, any>) => boolean> = [];
    const b: any = {};
    b.select = () => b;
    b.update = (p: Record<string, unknown>) => { patch = p; return b; };
    b.eq = (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b; };
    b.is = (c: string, v: unknown) => { filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return b; };
    // the conditional filter consumeTotpStep sends: last_used_step.is.null,last_used_step.lt.<n>
    b.or = (expr: string) => {
      const m = /^last_used_step\.is\.null,last_used_step\.lt\.(\d+)$/.exec(expr);
      if (!m) throw new Error(`unexpected or(): ${expr}`);
      const n = Number(m[1]);
      filters.push((r) => r.last_used_step == null || r.last_used_step < n);
      return b;
    };
    const run = () => {
      const hit = [FACTOR].filter((r) => filters.every((f) => f(r)));
      if (patch) {
        if (mockUpdateError) return { data: null, error: mockUpdateError };
        hit.forEach((r) => Object.assign(r, patch)); // applied atomically per statement (JS is single-threaded)
      }
      return { data: hit.map((r) => ({ ...r })), error: null };
    };
    b.maybeSingle = () => Promise.resolve({ ...run(), data: run().data?.[0] ?? null });
    b.limit = () => b;
    b.then = (ok: (v: unknown) => unknown) => Promise.resolve(run()).then(ok);
    return b;
  },
}));
jest.mock('../../security/totp/VaultSecretClient', () => ({ readVaultSecret: jest.fn(async () => SECRET) }));
jest.mock('../../security/audit/SecurityAuditService', () => ({ logSecurityEvent: jest.fn(async () => undefined) }));
jest.mock('../../security/MfaAttemptLimiter', () => ({
  check: jest.fn(() => ({ allowed: true })), recordFailure: jest.fn(), reset: jest.fn(),
}));

import { verifyTotp, matchedTotpStep } from '../../security/totp/TotpVerificationService';

const T0 = Date.UTC(2026, 10, 13, 12, 0, 15); // mid-step
const codeAt = (ms: number) => { jest.setSystemTime(ms); return authenticator.generate(SECRET); };
const verifyAt = async (ms: number, token: string) => { jest.setSystemTime(ms); return verifyTotp({ userId: 'u-1', token }); };

beforeAll(() => { jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] }); });
afterAll(() => { jest.useRealTimers(); });
beforeEach(() => {
  for (const k of Object.keys(FACTOR)) delete FACTOR[k];
  Object.assign(FACTOR, {
    id: 'f-1', user_id: 'u-1', vault_secret_id: 'v-1', algorithm: 'SHA1', digits: 6, period_seconds: 30,
    verified_at: '2026-11-01T00:00:00Z', last_used_at: null, revoked_at: null, revocation_reason: null, last_used_step: null,
  });
  mockUpdateError = null;
});

it('the same code twice: the first verifies, the second is TOKEN_REPLAYED', async () => {
  const code = codeAt(T0);
  expect(await verifyAt(T0, code)).toMatchObject({ ok: true });
  expect(await verifyAt(T0 + 5_000, code)).toEqual({ ok: false, reason: 'TOKEN_REPLAYED' });
  expect(FACTOR.last_used_step).toBe(matchedTotpStep(code, SECRET, T0));
});

it('a code from the PREVIOUS step after a later one succeeded is refused (still inside the ±1 window)', async () => {
  const older = codeAt(T0);
  const newer = codeAt(T0 + 30_000);
  expect(await verifyAt(T0 + 30_000, newer)).toMatchObject({ ok: true });
  expect(await verifyAt(T0 + 31_000, older)).toEqual({ ok: false, reason: 'TOKEN_REPLAYED' });
});

it('a genuinely NEW step is accepted after an earlier one', async () => {
  expect(await verifyAt(T0, codeAt(T0))).toMatchObject({ ok: true });
  expect(await verifyAt(T0 + 30_000, codeAt(T0 + 30_000))).toMatchObject({ ok: true });
});

it('CONCURRENT submissions of one code: exactly one is accepted', async () => {
  const code = codeAt(T0);
  jest.setSystemTime(T0);
  const results = await Promise.all([1, 2, 3, 4].map(() => verifyTotp({ userId: 'u-1', token: code })));
  expect(results.filter((r) => r.ok)).toHaveLength(1);
  expect(results.filter((r) => !r.ok && r.reason === 'TOKEN_REPLAYED')).toHaveLength(3);
});

it('if the one-time-use record cannot be written, the code is REFUSED (never accepted unrecorded)', async () => {
  mockUpdateError = { message: 'db down' };
  expect(await verifyAt(T0, codeAt(T0))).toEqual({ ok: false, reason: 'VERIFICATION_UNAVAILABLE' });
});

it('control: a wrong code is still INVALID_TOKEN and records nothing', async () => {
  jest.setSystemTime(T0);
  expect(await verifyTotp({ userId: 'u-1', token: '000000' === codeAt(T0) ? '111111' : '000000' })).toEqual({ ok: false, reason: 'INVALID_TOKEN' });
  expect(FACTOR.last_used_step).toBeNull();
});
