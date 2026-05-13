/**
 * Lifecycle regression tests for the invited → active transition.
 *
 * Pinned invariants (each pairs to a real failure mode that hit prod):
 *   1. A status='invited' user gets flipped to 'active' on first successful
 *      sync, with activated_at stamped.
 *   2. The flip is idempotent — a second sync for an already-active user
 *      is a no-op (no overwritten activated_at, no duplicate event).
 *   3. A missing `activated_at` column degrades to a status-only flip
 *      (so envs with 20260638 but not 20260641 still recover).
 *   4. A missing `status` column logs schema_fallback and returns false
 *      without throwing.
 *   5. Active / suspended / deleted users are never touched — the WHERE
 *      predicate matches zero rows.
 */

const supabaseMock = {
  from: jest.fn(),
};
jest.mock('../../../backend/db/supabaseClient', () => ({
  supabase: supabaseMock,
}));

const loggerWarn = jest.fn();
const loggerError = jest.fn();
const loggerInfo  = jest.fn();
jest.mock('../../../backend/services/logger', () => ({
  logger: { warn: loggerWarn, error: loggerError, info: loggerInfo },
}));

// All other handler-level imports are unused for this targeted test but
// would be reached by the import graph; stub them out so we can import
// the handler module cheaply.
jest.mock('../../../backend/services/requestContext', () => ({
  seedRequestContextFromRequest: jest.fn(),
}));
jest.mock('../../../lib/auth/serverValidation', () => ({
  verifySupabaseAuthHeader: jest.fn(),
  validateWorkEmail: jest.fn(() => true),
}));
jest.mock('../../../lib/auth/auditLog', () => ({ logAuthEvent: jest.fn() }));
jest.mock('../../../lib/auth/anomalyDetector', () => ({ recordAnomalyEvent: jest.fn() }));
jest.mock('../../../backend/services/companyMatchService', () => ({
  extractDomain: jest.fn(() => 'omnivyra.com'),
  isFreeEmailDomain: jest.fn(() => false),
}));
jest.mock('../../../backend/services/initialFreeCreditService', () => ({
  grantInitialFreeCredit: jest.fn().mockResolvedValue({ outcome: 'already_claimed' }),
}));
jest.mock('../../../backend/services/emailService', () => ({
  sendCompanyAdminReferral: jest.fn(),
  sendInboundSignupNoticeToAdmin: jest.fn(),
}));
jest.mock('../../../backend/services/domainCanonicalService', () => ({ resolveDomain: jest.fn() }));
jest.mock('../../../backend/security/SessionAuthorityService', () => ({
  ensureSessionForUser: jest.fn().mockResolvedValue({ minted: false, sessionId: null }),
}));
jest.mock('../../../backend/security/audit/SecurityAuditService', () => ({ logSecurityEvent: jest.fn() }));
jest.mock('../../../backend/services/domainRecordService', () => ({ saveDomainRecord: jest.fn() }));
jest.mock('../../../lib/auth/rateLimit', () => ({
  checkRateLimit: jest.fn().mockResolvedValue({ allowed: true }),
  DOMAIN_RESOLUTION_LIMIT: {},
}));
jest.mock('../../../backend/services/domainVerificationService', () => ({
  logDomainUnverifiedUsageForCompany: jest.fn(),
}));
jest.mock('../../../backend/services/domainEventLogger', () => ({ logDomainEvent: jest.fn() }));
jest.mock('../../../backend/security/MfaIntent', () => ({
  issueMfaIntent: jest.fn(),
  userHasVerifiedMfaFactor: jest.fn().mockResolvedValue({ hasMfa: false }),
}));
jest.mock('../../../backend/services/companyMembershipIntegrityService', () => ({
  SELF_REGISTERED_JOIN_SOURCE: 'self-registered',
}));

import { tryFlipInvitedToActive } from '../../../pages/api/auth/sync-supabase-user';

// Helper — build a chainable `.update(...).eq(...).eq(...).select(...)` that
// resolves with the provided result. Mirrors the shape supabase-js exposes.
function buildUpdateChain(result: { data?: unknown[]; error?: { message?: string; code?: string } | null }) {
  const thenable: any = Promise.resolve({
    data:  result.data  ?? null,
    error: result.error ?? null,
  });
  thenable.eq     = jest.fn(() => thenable);
  thenable.select = jest.fn(() => thenable);
  const root: any = {
    update: jest.fn(() => thenable),
  };
  return { root, thenable };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('tryFlipInvitedToActive', () => {
  it('flips an invited user to active and stamps activated_at', async () => {
    const chain = buildUpdateChain({ data: [{ id: 'u1' }] });
    supabaseMock.from.mockReturnValueOnce(chain.root);

    const flipped = await tryFlipInvitedToActive({
      filterColumn: 'supabase_uid',
      filterValue:  'sub-1',
      userId:       'u1',
    });

    expect(flipped).toBe(true);
    expect(chain.root.update).toHaveBeenCalledWith(expect.objectContaining({
      status:       'active',
      activated_at: expect.any(String),
    }));
    expect(chain.thenable.eq).toHaveBeenCalledWith('status', 'invited');
  });

  it('returns false on idempotent re-call (zero rows matched the WHERE status=invited)', async () => {
    const chain = buildUpdateChain({ data: [] });
    supabaseMock.from.mockReturnValueOnce(chain.root);

    const flipped = await tryFlipInvitedToActive({
      filterColumn: 'supabase_uid',
      filterValue:  'sub-1',
      userId:       'u1',
    });

    expect(flipped).toBe(false);
    // Even though the call returned 0 rows, we still tried with the
    // canonical predicate — that's the contract that protects activated_at.
    expect(chain.thenable.eq).toHaveBeenCalledWith('status', 'invited');
  });

  it('retries without activated_at when only that column is missing', async () => {
    const failChain = buildUpdateChain({
      error: { code: 'PGRST204', message: "Could not find the 'activated_at' column of 'users' in the schema cache" },
    });
    const retryChain = buildUpdateChain({ data: [{ id: 'u2' }] });
    supabaseMock.from
      .mockReturnValueOnce(failChain.root)
      .mockReturnValueOnce(retryChain.root);

    const flipped = await tryFlipInvitedToActive({
      filterColumn: 'id',
      filterValue:  'u2',
      userId:       'u2',
    });

    expect(flipped).toBe(true);
    // First attempt included activated_at; retry must NOT include it.
    expect(failChain.root.update).toHaveBeenCalledWith(expect.objectContaining({
      activated_at: expect.any(String),
    }));
    expect(retryChain.root.update).toHaveBeenCalledWith({ status: 'active' });
    // Structured fallback log fired with the missing column name.
    expect(loggerWarn).toHaveBeenCalledWith('auth_schema_fallback', expect.objectContaining({
      missingColumns: ['activated_at'],
    }));
  });

  it('returns false and logs schema_fallback when status column is missing', async () => {
    const failChain = buildUpdateChain({
      error: { code: 'PGRST204', message: "Could not find the 'status' column of 'users' in the schema cache" },
    });
    supabaseMock.from.mockReturnValueOnce(failChain.root);

    const flipped = await tryFlipInvitedToActive({
      filterColumn: 'supabase_uid',
      filterValue:  'sub-3',
      userId:       'u3',
    });

    expect(flipped).toBe(false);
    expect(loggerWarn).toHaveBeenCalledWith('auth_schema_fallback', expect.objectContaining({
      missingColumns: ['status'],
    }));
    // No retry was issued — only one `.from('users')` call.
    expect(supabaseMock.from).toHaveBeenCalledTimes(1);
  });

  it('never throws on unexpected DB errors — returns false and logs', async () => {
    const chain = buildUpdateChain({ error: { code: '40001', message: 'serialization_failure' } });
    supabaseMock.from.mockReturnValueOnce(chain.root);

    const flipped = await tryFlipInvitedToActive({
      filterColumn: 'supabase_uid',
      filterValue:  'sub-x',
      userId:       'ux',
    });

    expect(flipped).toBe(false);
    expect(loggerWarn).toHaveBeenCalledWith('auth_sync_status_flip_failed', expect.objectContaining({
      message: 'serialization_failure',
    }));
  });
});
