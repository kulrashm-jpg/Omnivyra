/**
 * AUTH-001 §9/§10 — canonical signup event model + correlation IDs.
 *
 * Locks: event → capability/decision/resource_id mapping onto the existing
 * SecurityAuditService (no new event framework), the rejection-code → event
 * mapping, and correlation-ID recovery from signup_intents.intent_data.
 */

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn() } }));
jest.mock('../../security/audit/SecurityAuditService', () => ({
  logSecurityEvent: jest.fn(async () => undefined),
}));

import { supabase } from '../../db/supabaseClient';
import { logSecurityEvent } from '../../security/audit/SecurityAuditService';
import {
  emitSignupEvent,
  signupRejectionEventFor,
  newSignupCorrelationId,
  resolveSignupCorrelationId,
  ensureSignupCorrelationId,
  SIGNUP_EVENT_CAPABILITY_PREFIX,
} from '../../services/signupEventService';

const mockLog = logSecurityEvent as jest.MockedFunction<typeof logSecurityEvent>;
const mockFrom = (supabase as any).from as jest.Mock;

function stubIntentLookup(intentData: unknown) {
  mockFrom.mockReturnValue({
    select: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        order: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({ data: intentData === null ? null : { intent_data: intentData } }),
          }),
        }),
      }),
    }),
  });
}

describe('AUTH-001 §9 — emitSignupEvent maps onto capability_audit_log', () => {
  test('event name becomes signup.<Event>, correlation ID rides resource_id', async () => {
    await emitSignupEvent({
      event: 'CompanyCreated',
      outcome: 'allowed',
      correlationId: 'cid-123',
      email: 'USER@Acme.COM',
      userId: 'u1',
      companyId: 'org1',
      reason: 'test',
      ip: '1.2.3.4',
      userAgent: 'jest',
    });

    expect(mockLog).toHaveBeenCalledTimes(1);
    const row = mockLog.mock.calls[0][0];
    expect(row.capability).toBe(`${SIGNUP_EVENT_CAPABILITY_PREFIX}CompanyCreated`);
    expect(row.decision).toBe('allowed');
    expect(row.resourceId).toBe('cid-123');
    expect(row.organizationId).toBe('org1');
    expect(row.principalUserId).toBe('u1');
    expect(row.reason).toContain('event=CompanyCreated');
    expect(row.reason).toContain('email=user@acme.com'); // normalized
    expect(row.reason).toContain('reason=test');
  });

  test('never throws even when the audit layer throws (fire-and-forget)', async () => {
    mockLog.mockRejectedValueOnce(new Error('db down'));
    await expect(
      emitSignupEvent({ event: 'SystemFailure', outcome: 'denied', correlationId: 'x' }),
    ).resolves.toBeUndefined();
  });

  test('rejection-code → event mapping covers the spec vocabulary', () => {
    expect(signupRejectionEventFor('PUBLIC_EMAIL')).toBe('PublicEmailRejected');
    expect(signupRejectionEventFor('DISPOSABLE_EMAIL')).toBe('DisposableEmailRejected');
    expect(signupRejectionEventFor('NO_WEBSITE_FOUND')).toBe('WebsiteRejected');
    expect(signupRejectionEventFor('PARKED_DOMAIN')).toBe('WebsiteRejected');
    expect(signupRejectionEventFor('FORWARDING_DOMAIN')).toBe('WebsiteRejected');
    expect(signupRejectionEventFor('CLAIMED_DOMAIN')).toBe('CompanyExists');
    expect(signupRejectionEventFor('NO_EMAIL_CAPABILITY')).toBe('ValidationFailed');
    expect(signupRejectionEventFor('anything-else')).toBe('ValidationFailed');
  });
});

describe('AUTH-001 §10 — journey correlation IDs', () => {
  test('newSignupCorrelationId mints UUIDs', () => {
    const a = newSignupCorrelationId();
    const b = newSignupCorrelationId();
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(a).not.toBe(b);
  });

  test('resolveSignupCorrelationId recovers the ID persisted on the signup intent', async () => {
    stubIntentLookup({ correlation_id: 'journey-42', company_name: 'Acme' });
    await expect(resolveSignupCorrelationId('user@acme.com')).resolves.toBe('journey-42');
  });

  test('resolve returns null when no intent / no ID; ensure falls back to a fresh UUID', async () => {
    stubIntentLookup(null);
    await expect(resolveSignupCorrelationId('user@acme.com')).resolves.toBeNull();

    stubIntentLookup({ company_name: 'no-cid' });
    await expect(resolveSignupCorrelationId('user@acme.com')).resolves.toBeNull();

    stubIntentLookup(null);
    const ensured = await ensureSignupCorrelationId('user@acme.com');
    expect(ensured).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('resolve never throws on lookup failure', async () => {
    mockFrom.mockImplementation(() => { throw new Error('boom'); });
    await expect(resolveSignupCorrelationId('user@acme.com')).resolves.toBeNull();
  });
});
