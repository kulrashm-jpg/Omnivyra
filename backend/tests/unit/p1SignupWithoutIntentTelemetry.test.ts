/**
 * P1 — SignupWithoutIntent telemetry at the two brand-new-identity inserts:
 *   POST /api/auth/sync-supabase-user  ("Third: brand-new user — INSERT")
 *   POST /api/auth/verify-email        (first-verify users-row insert)
 *
 * Telemetry only: the users insert must happen and the response must be
 * unchanged whether or not an intent exists or the intent read fails.
 * Runs against a faithful in-memory table fake.
 */
import { createFakeDb, type FakeDb } from '../helpers/p1FaithfulTableFake';
import { createApiRequestMock, createMockRes } from '../utils';

let mockDb: FakeDb;
const mockLoggerWarn = jest.fn();

jest.mock('../../../backend/db/supabaseClient', () => ({
  get supabase() {
    return mockDb.client;
  },
}));
jest.mock('../../../backend/services/logger', () => ({
  logger: { warn: (...a: unknown[]) => mockLoggerWarn(...a), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../../backend/services/requestContext', () => ({
  seedRequestContextFromRequest: jest.fn(),
}));
jest.mock('../../../lib/auth/serverValidation', () => ({ validateWorkEmail: jest.fn(() => true) }));
jest.mock('../../../backend/services/authResolver', () => ({
  extractAccessToken: jest.fn(() => 'test-token'),
  validateAuthToken: jest.fn(),
  resolveAuthenticatedUser: jest.fn(async () => ({ user: null, error: 'USER_NOT_FOUND' })),
}));
jest.mock('../../../lib/auth/auditLog', () => ({ logAuthEvent: jest.fn() }));
jest.mock('../../../lib/auth/anomalyDetector', () => ({ recordAnomalyEvent: jest.fn() }));
jest.mock('../../../backend/services/initialFreeCreditService', () => ({
  grantInitialFreeCredit: jest.fn().mockResolvedValue({ outcome: 'already_claimed' }),
}));
jest.mock('../../../backend/services/emailService', () => ({
  sendCompanyAdminReferral: jest.fn(),
  sendInboundSignupNoticeToAdmin: jest.fn(),
}));
jest.mock('../../../backend/security/SessionAuthorityService', () => ({
  ensureSessionForUser: jest.fn().mockResolvedValue({ minted: false, sessionId: null }),
}));
jest.mock('../../../backend/security/audit/SecurityAuditService', () => ({ logSecurityEvent: jest.fn() }));
jest.mock('../../../backend/security/MfaIntent', () => ({
  issueMfaIntent: jest.fn(),
  userHasVerifiedMfaFactor: jest.fn().mockResolvedValue({ hasMfa: false }),
}));
jest.mock('../../../backend/services/signupEventService', () => ({
  emitSignupEvent: jest.fn(),
  ensureSignupCorrelationId: jest.fn(async () => 'corr-1'),
  requestIp: jest.fn(() => null),
  requestUserAgent: jest.fn(() => null),
}));
jest.mock('../../../backend/services/userPreferencesService', () => ({
  getPostLoginRoute: jest.fn(async () => '/dashboard'),
}));

import syncHandler from '../../../pages/api/auth/sync-supabase-user';
import verifyHandler from '../../../pages/api/auth/verify-email';
import { validateAuthToken } from '../../../backend/services/authResolver';
import { resetAuthMetrics, snapshotAuthMetrics } from '../../../backend/services/authMetrics';

const UID = '00000000-0000-4000-8000-00000000abcd';
const EMAIL = 'New.User@Example-Corp.test';

function metricCount(endpoint: string): number {
  return snapshotAuthMetrics()
    .counters.filter((c) => c.name === 'auth.signup.without_intent' && c.tags.endpoint === endpoint)
    .reduce((n, c) => n + c.value, 0);
}

function telemetryLogs() {
  return mockLoggerWarn.mock.calls.filter((c) => c[0] === 'auth.signup_without_intent');
}

function assertNoEmailLogged() {
  const serialized = JSON.stringify(mockLoggerWarn.mock.calls.filter((c) => String(c[0]).startsWith('auth.signup_without_intent')));
  expect(serialized.toLowerCase()).not.toContain('example-corp.test');
}

beforeEach(() => {
  jest.clearAllMocks();
  resetAuthMetrics();
  (validateAuthToken as jest.Mock).mockResolvedValue({ supabaseUid: UID, email: EMAIL, emailVerified: true });
});

const ENDPOINTS: Array<{ name: 'sync-supabase-user' | 'verify-email'; run: () => Promise<any>; okStatus: number }> = [
  {
    name: 'sync-supabase-user',
    okStatus: 200,
    run: async () => {
      const res = createMockRes();
      await syncHandler(createApiRequestMock({ method: 'POST' }), res);
      return res;
    },
  },
  {
    name: 'verify-email',
    okStatus: 200,
    run: async () => {
      const res = createMockRes();
      await verifyHandler(createApiRequestMock({ method: 'POST' }), res);
      return res;
    },
  },
];

describe.each(ENDPOINTS)('SignupWithoutIntent telemetry — $name', ({ name, run, okStatus }) => {
  it('no intent row -> telemetry emitted (log + counter, no email) and the users insert still happens', async () => {
    mockDb = createFakeDb({
      users: [],
      // An intent for a DIFFERENT email must not count.
      signup_intents: [{ id: 'i-other', email: 'someone@else-corp.test', status: 'pending' }],
    });
    const res = await run();
    expect(res.statusCode).toBe(okStatus);
    expect(mockDb.tables.users.filter((u) => u.supabase_uid === UID)).toHaveLength(1);
    expect(mockDb.tables.users[0].email).toBe(EMAIL.toLowerCase());
    expect(telemetryLogs()).toEqual([['auth.signup_without_intent', { endpoint: name, supabaseUid: UID }]]);
    expect(metricCount(name)).toBe(1);
    // Read happened BEFORE the insert.
    const readIdx = mockDb.log.indexOf('select:signup_intents');
    const insertIdx = mockDb.log.indexOf('insert:users');
    expect(readIdx).toBeGreaterThanOrEqual(0);
    expect(readIdx).toBeLessThan(insertIdx);
    assertNoEmailLogged();
  });

  it.each(['pending', 'completed', 'expired'])(
    'intent present (status=%s, any expiry, stored lowercase) -> no telemetry',
    async (status) => {
      mockDb = createFakeDb({
        users: [],
        signup_intents: [
          { id: 'i-1', email: EMAIL.toLowerCase(), status, expires_at: '2000-01-01T00:00:00.000Z' },
        ],
      });
      const res = await run();
      expect(res.statusCode).toBe(okStatus);
      expect(mockDb.tables.users.filter((u) => u.supabase_uid === UID)).toHaveLength(1);
      expect(telemetryLogs()).toHaveLength(0);
      expect(metricCount(name)).toBe(0);
    },
  );

  it('intent read error -> no telemetry, insert still happens, response unchanged, email not logged', async () => {
    mockDb = createFakeDb({ users: [], signup_intents: [] });
    mockDb.failSelect.signup_intents = { message: 'permission denied' };
    const res = await run();
    expect(res.statusCode).toBe(okStatus);
    expect(mockDb.tables.users.filter((u) => u.supabase_uid === UID)).toHaveLength(1);
    expect(telemetryLogs()).toHaveLength(0);
    expect(metricCount(name)).toBe(0);
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'auth.signup_without_intent_check_failed',
      expect.objectContaining({ endpoint: name, supabaseUid: UID }),
    );
    assertNoEmailLogged();
  });

  it('response body is identical with and without an intent', async () => {
    mockDb = createFakeDb({ users: [], signup_intents: [] });
    const without = await run();
    resetAuthMetrics();
    mockDb = createFakeDb({ users: [], signup_intents: [{ id: 'i-1', email: EMAIL.toLowerCase(), status: 'pending' }] });
    const withIntent = await run();
    expect(withIntent.statusCode).toBe(without.statusCode);
    expect(withIntent.body).toEqual(without.body);
  });
});

describe('existing-user paths never read signup_intents for telemetry', () => {
  it('sync-supabase-user returning user (by uid) -> no intent read, no telemetry', async () => {
    mockDb = createFakeDb({
      users: [{ id: 'u-1', supabase_uid: UID, email: EMAIL.toLowerCase(), is_deleted: false }],
      signup_intents: [],
    });
    const res = createMockRes();
    await syncHandler(createApiRequestMock({ method: 'POST' }), res);
    expect(res.statusCode).toBe(200);
    expect(mockDb.log).not.toContain('select:signup_intents');
    expect(telemetryLogs()).toHaveLength(0);
  });
});
