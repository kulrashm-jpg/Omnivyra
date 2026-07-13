/**
 * AUTH-001R §7 — signup event contract + lifecycle tests.
 *
 * Locks: required envelope fields, schema version, immutability of inputs,
 * correlation propagation, lifecycle ordering (legal/illegal transitions),
 * backward compatibility (v1 → v1.1 parsing), retry safety, and the
 * event→metric projection.
 */

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn() } }));
jest.mock('../../security/audit/SecurityAuditService', () => ({
  logSecurityEvent: jest.fn(async () => undefined),
}));
jest.mock('../../observability', () => ({
  recordRawCounter: jest.fn(),
}));

import { supabase } from '../../db/supabaseClient';
import { logSecurityEvent } from '../../security/audit/SecurityAuditService';
import { recordRawCounter } from '../../observability';
import {
  emitSignupEvent,
  parseSignupEventReason,
  metricForSignupEvent,
  ensureSignupCorrelationId,
  SIGNUP_EVENT_SCHEMA_VERSION,
  type SignupEvent,
} from '../../services/signupEventService';
import {
  canTransition,
  assertTransition,
  deriveSignupLifecycle,
  EVENT_IMPLIED_LIFECYCLE_STATE,
  SIGNUP_LIFECYCLE_ORDER,
  type SignupLifecycleState,
} from '../../services/signupLifecycleService';

const mockLog = logSecurityEvent as jest.MockedFunction<typeof logSecurityEvent>;
const mockCounter = recordRawCounter as jest.Mock;
const mockFrom = (supabase as any).from as jest.Mock;

const lastEnvelope = () => JSON.parse(String(mockLog.mock.calls.at(-1)?.[0].reason));

describe('AUTH-001R §3 — event contract required fields', () => {
  test('every contract field is present: schemaVersion, eventType, timestamp, correlationId, journeyState, actor, tenant, requestId, metadata', async () => {
    await emitSignupEvent({
      event: 'CompanyCreated', outcome: 'allowed',
      correlationId: 'cid-1', email: 'a@b.com', userId: 'u1', companyId: 'org1',
      reason: 'r', requestId: 'req-1', metadata: { plan: 'free' },
    });

    const row = mockLog.mock.calls[0][0];
    const env = JSON.parse(String(row.reason));

    // Envelope fields (reason column)
    expect(env.v).toBe(SIGNUP_EVENT_SCHEMA_VERSION);       // schemaVersion
    expect(env.event).toBe('CompanyCreated');              // eventType
    expect(env.state).toBe('COMPANY_CREATED');             // journeyState (implied)
    expect(env.requestId).toBe('req-1');                   // requestId
    expect(env.metadata).toEqual({ plan: 'free' });        // metadata
    expect(env.email).toBe('a@b.com');

    // Column-mapped fields
    expect(row.capability).toBe('signup.CompanyCreated');  // eventType (queryable)
    expect(row.resourceId).toBe('cid-1');                  // correlationId
    expect(row.principalUserId).toBe('u1');                // actor
    expect(row.organizationId).toBe('org1');               // tenant
    // timestamp → occurred_at defaults to now() inside logSecurityEvent.
  });

  test('journeyState can be overridden explicitly', async () => {
    await emitSignupEvent({
      event: 'VerificationSucceeded', outcome: 'denied',
      correlationId: 'cid-2', journeyState: 'VERIFICATION_PENDING',
    });
    expect(lastEnvelope().state).toBe('VERIFICATION_PENDING');
  });

  test('immutability: emit never mutates the caller event object', async () => {
    const event: SignupEvent = {
      event: 'SignupAttempted', outcome: 'allowed',
      correlationId: 'cid-3', email: 'X@Y.com', metadata: { a: 1 },
    };
    const snapshot = JSON.parse(JSON.stringify(event));
    await emitSignupEvent(event);
    expect(event).toEqual(snapshot);
  });

  test('retry safety: identical retries emit identical envelopes and never throw', async () => {
    const event: SignupEvent = { event: 'SignupValidated', outcome: 'allowed', correlationId: 'cid-4', requestId: 'r' };
    await emitSignupEvent(event);
    await emitSignupEvent(event);
    expect(mockLog).toHaveBeenCalledTimes(2);
    expect(mockLog.mock.calls[0][0].reason).toBe(mockLog.mock.calls[1][0].reason);

    mockLog.mockRejectedValueOnce(new Error('audit down'));
    await expect(emitSignupEvent(event)).resolves.toBeUndefined();
  });

  test('correlation propagation: the intent journey ID rides resource_id end to end', async () => {
    mockFrom.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          order: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({ data: { intent_data: { correlation_id: 'journey-9' } } }),
            }),
          }),
        }),
      }),
    });
    const cid = await ensureSignupCorrelationId('a@b.com');
    expect(cid).toBe('journey-9');
    await emitSignupEvent({ event: 'VerificationSucceeded', outcome: 'allowed', correlationId: cid });
    expect(mockLog.mock.calls.at(-1)?.[0].resourceId).toBe('journey-9');
  });
});

describe('AUTH-001R §4 — schema versioning & backward compatibility', () => {
  test('current envelopes parse and identify their version', () => {
    const env = parseSignupEventReason(JSON.stringify({
      v: '1.1', event: 'CompanyExists', state: 'FAILED', email: 'a@b.com',
      reason: 'CLAIMED_DOMAIN', requestId: 'r', metadata: null,
    }));
    expect(env).toMatchObject({ v: '1.1', event: 'CompanyExists', state: 'FAILED' });
  });

  test('legacy v1 key=value rows still parse (additive evolution, no rewrite)', () => {
    const env = parseSignupEventReason('event=PublicEmailRejected email=a@gmail.com reason=PUBLIC_EMAIL ip=1.2.3.4');
    expect(env).toMatchObject({
      v: '1',
      event: 'PublicEmailRejected',
      email: 'a@gmail.com',
      reason: 'PUBLIC_EMAIL',
      state: 'FAILED', // implied for legacy rows
    });
  });

  test('future-compatible: unknown fields in a newer envelope do not break parsing', () => {
    const env = parseSignupEventReason(JSON.stringify({
      v: '1.2', event: 'SignupValidated', state: 'VALIDATED', someFutureField: 42,
    }));
    expect(env).toMatchObject({ v: '1.2', event: 'SignupValidated' });
  });

  test('non-signup reasons return null', () => {
    expect(parseSignupEventReason('password_changed_flow=signup revoked_auth=2')).toBeNull();
    expect(parseSignupEventReason('{"not":"an event"}')).toBeNull();
    expect(parseSignupEventReason(null)).toBeNull();
  });
});

describe('AUTH-001R §1 — lifecycle ordering & transitions', () => {
  test('the canonical happy path is legal end to end, in order', () => {
    for (let i = 0; i < SIGNUP_LIFECYCLE_ORDER.length - 1; i++) {
      const from = SIGNUP_LIFECYCLE_ORDER[i];
      const to = SIGNUP_LIFECYCLE_ORDER[i + 1];
      // INITIATED→VALIDATING→VALIDATED→VERIFICATION_PENDING→VERIFIED→
      // ONBOARDING_STARTED→COMPANY_CREATED→ONBOARDING_COMPLETED
      expect(canTransition(from, to)).toBe(true);
    }
  });

  test('illegal jumps are impossible', () => {
    expect(canTransition('INITIATED', 'ONBOARDING_COMPLETED')).toBe(false);
    expect(canTransition('VALIDATED', 'COMPANY_CREATED')).toBe(false);
    expect(canTransition('VERIFICATION_PENDING', 'ONBOARDING_COMPLETED')).toBe(false);
    expect(canTransition('ONBOARDING_COMPLETED', 'VALIDATING')).toBe(false); // terminal
    expect(() => assertTransition('INITIATED', 'VERIFIED')).toThrow(/ILLEGAL_SIGNUP_LIFECYCLE_TRANSITION/);
  });

  test('idempotent retries: self-transitions are always legal', () => {
    for (const state of SIGNUP_LIFECYCLE_ORDER) {
      expect(canTransition(state, state)).toBe(true);
    }
  });

  test('failure and recovery edges', () => {
    expect(canTransition('VALIDATING', 'FAILED')).toBe(true);
    expect(canTransition('VERIFICATION_PENDING', 'ABANDONED')).toBe(true);
    expect(canTransition('FAILED', 'VALIDATING')).toBe(true);     // user retries
    expect(canTransition('ABANDONED', 'VALIDATING')).toBe(true);  // user returns
  });

  test('every event implies a valid lifecycle state', () => {
    const valid = new Set<string>([...SIGNUP_LIFECYCLE_ORDER, 'FAILED', 'ABANDONED']);
    for (const state of Object.values(EVENT_IMPLIED_LIFECYCLE_STATE)) {
      expect(valid.has(state)).toBe(true);
    }
  });
});

describe('AUTH-001R §2 — journey derivation (recovery)', () => {
  function stubTables(tables: Record<string, unknown>) {
    mockFrom.mockImplementation((table: string) => {
      const result = { data: tables[table] ?? null };
      const chain: any = {};
      for (const m of ['select', 'eq', 'not', 'order', 'limit']) {
        chain[m] = jest.fn(() => chain);
      }
      chain.maybeSingle = jest.fn(async () => result);
      return chain;
    });
  }

  test('active membership + company_complete → ONBOARDING_COMPLETED / enter_app', async () => {
    stubTables({
      users: { id: 'u1', is_email_verified: true, has_password: true, onboarding_state: 'company_complete' },
      user_company_roles: { id: 'r1' },
    });
    expect(await deriveSignupLifecycle('a@b.com')).toEqual({
      state: 'ONBOARDING_COMPLETED', authority: 'user_company_roles', nextStep: 'enter_app',
    });
  });

  test('unverified user → VERIFICATION_PENDING / verify_email', async () => {
    stubTables({
      users: { id: 'u1', is_email_verified: false, onboarding_state: 'pending_verification' },
      user_company_roles: null,
    });
    expect((await deriveSignupLifecycle('a@b.com'))?.state).toBe('VERIFICATION_PENDING');
  });

  test('verified, profile pending → VERIFIED; profile done → ONBOARDING_STARTED', async () => {
    stubTables({
      users: { id: 'u1', is_email_verified: true, has_password: true, onboarding_state: 'verified' },
      user_company_roles: null,
    });
    expect((await deriveSignupLifecycle('a@b.com'))?.state).toBe('VERIFIED');

    stubTables({
      users: { id: 'u1', is_email_verified: true, has_password: true, onboarding_state: 'profile_complete' },
      user_company_roles: null,
    });
    const d = await deriveSignupLifecycle('a@b.com');
    expect(d?.state).toBe('ONBOARDING_STARTED');
    expect(d?.nextStep).toBe('create_company');
  });

  test('no user, live pending intent → VERIFICATION_PENDING; expired → ABANDONED; nothing → null', async () => {
    stubTables({
      users: null,
      signup_intents: { status: 'pending', expires_at: new Date(Date.now() + 3600_000).toISOString() },
    });
    expect((await deriveSignupLifecycle('a@b.com'))?.state).toBe('VERIFICATION_PENDING');

    stubTables({
      users: null,
      signup_intents: { status: 'expired', expires_at: new Date(Date.now() - 3600_000).toISOString() },
    });
    expect((await deriveSignupLifecycle('a@b.com'))?.state).toBe('ABANDONED');

    stubTables({ users: null, signup_intents: null });
    expect(await deriveSignupLifecycle('a@b.com')).toBeNull();
  });

  test('deterministic and replay-safe: same inputs → same answer', async () => {
    stubTables({
      users: { id: 'u1', is_email_verified: false, onboarding_state: 'pending_verification' },
      user_company_roles: null,
    });
    const a = await deriveSignupLifecycle('a@b.com');
    const b = await deriveSignupLifecycle('a@b.com');
    expect(a).toEqual(b);
  });

  test('never throws — derivation failure degrades to null', async () => {
    mockFrom.mockImplementation(() => { throw new Error('db down'); });
    await expect(deriveSignupLifecycle('a@b.com')).resolves.toBeNull();
  });
});

describe('AUTH-001R §5 — event→metric projection', () => {
  test('spec metric mapping', () => {
    expect(metricForSignupEvent('SignupAttempted', 'allowed')).toBe('signup_started');
    expect(metricForSignupEvent('SignupValidated', 'allowed')).toBe('signup_completed');
    expect(metricForSignupEvent('PublicEmailRejected', 'denied')).toBe('signup_failed');
    expect(metricForSignupEvent('SystemFailure', 'denied')).toBe('signup_failed');
    expect(metricForSignupEvent('VerificationSent', 'allowed')).toBe('verification_sent');
    expect(metricForSignupEvent('VerificationSent', 'denied')).toBeNull(); // suppressed resend ≠ failure
    expect(metricForSignupEvent('VerificationSucceeded', 'allowed')).toBe('verification_completed');
    expect(metricForSignupEvent('VerificationSucceeded', 'denied')).toBe('verification_failed');
    expect(metricForSignupEvent('CompanyCreated', 'allowed')).toBe('company_created');
    expect(metricForSignupEvent('CompanyExists', 'denied')).toBe('company_exists');
    expect(metricForSignupEvent('OnboardingCompleted', 'allowed')).toBeNull();
  });

  test('emit records the derived counter through the existing registry', async () => {
    await emitSignupEvent({ event: 'SignupAttempted', outcome: 'allowed', correlationId: 'c' });
    expect(mockCounter).toHaveBeenCalledWith('signup.signup_started', 1, { outcome: 'allowed' });
  });

  test('metrics are a projection — a counter failure never breaks the event', async () => {
    mockCounter.mockImplementationOnce(() => { throw new Error('registry down'); });
    await expect(
      emitSignupEvent({ event: 'CompanyCreated', outcome: 'allowed', correlationId: 'c' }),
    ).resolves.toBeUndefined();
    expect(mockLog).toHaveBeenCalled(); // event row still written
  });
});
