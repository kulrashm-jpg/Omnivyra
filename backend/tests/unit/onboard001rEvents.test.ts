/**
 * ONBOARD-001R §5/§6 — onboarding events reuse the AUTH-001 infrastructure.
 */

jest.mock('../../security/audit/SecurityAuditService', () => ({ logSecurityEvent: jest.fn(async () => undefined) }));
jest.mock('../../observability', () => ({ recordRawCounter: jest.fn() }));
jest.mock('../../services/signupEventService', () => ({
  SIGNUP_EVENT_SCHEMA_VERSION: '1.1',
  ensureSignupCorrelationId: jest.fn(async () => 'journey-shared'),
}));

import { logSecurityEvent } from '../../security/audit/SecurityAuditService';
import { recordRawCounter } from '../../observability';
import {
  emitOnboardingEvent,
  metricForOnboardingEvent,
  resolveOnboardingCorrelationId,
  ONBOARDING_EVENT_CAPABILITY_PREFIX,
} from '../../services/onboardingEventService';

const mockLog = logSecurityEvent as jest.MockedFunction<typeof logSecurityEvent>;
const mockCounter = recordRawCounter as jest.Mock;

describe('ONBOARD-001R §5 — events ride the AUTH-001 envelope + audit log', () => {
  test('capability prefixed onboarding.<Event>, versioned envelope, correlation in resource_id', async () => {
    await emitOnboardingEvent({
      event: 'StageCompleted', outcome: 'allowed', correlationId: 'cid-1',
      companyId: 'org1', userId: 'u1', stage: 'social_accounts', reason: 'action=complete',
    });
    const row = mockLog.mock.calls[0][0];
    expect(row.capability).toBe(`${ONBOARDING_EVENT_CAPABILITY_PREFIX}StageCompleted`);
    expect(row.resourceId).toBe('cid-1');
    expect(row.organizationId).toBe('org1');
    const env = JSON.parse(String(row.reason));
    expect(env.v).toBe('1.1');                   // SAME schema version as AUTH-001
    expect(env.event).toBe('StageCompleted');
    expect(env.state).toBe('social_accounts');   // stage rides envelope.state
  });

  test('never throws even if the audit sink throws', async () => {
    mockLog.mockRejectedValueOnce(new Error('down'));
    await expect(emitOnboardingEvent({ event: 'StageSkipped', outcome: 'allowed', correlationId: 'c', companyId: 'o' }))
      .resolves.toBeUndefined();
  });

  test('correlation reuses the signup journey ID; falls back to company key', async () => {
    expect(await resolveOnboardingCorrelationId('a@b.com', 'org1')).toBe('journey-shared');
    expect(await resolveOnboardingCorrelationId(null, 'org1')).toBe('company:org1');
    expect(await resolveOnboardingCorrelationId(null, null)).toBe('onboarding:unknown');
  });
});

describe('ONBOARD-001R §6 — event-derived metrics', () => {
  test('metric mapping covers the analytics surface', () => {
    expect(metricForOnboardingEvent('StageStarted')).toBe('stage_entry');
    expect(metricForOnboardingEvent('StageCompleted')).toBe('stage_completion');
    expect(metricForOnboardingEvent('StageSkipped')).toBe('stage_skipped');
    expect(metricForOnboardingEvent('StageDismissed')).toBe('stage_dismissed');
    expect(metricForOnboardingEvent('StageBlocked')).toBe('stage_blocked');
    expect(metricForOnboardingEvent('JourneyCompleted')).toBe('journey_completed');
    expect(metricForOnboardingEvent('PlatformReady')).toBe('platform_ready');
  });

  test('emit records the counter through the existing registry; failure never breaks the event', async () => {
    await emitOnboardingEvent({ event: 'StageSkipped', outcome: 'allowed', correlationId: 'c', companyId: 'o', stage: 'website_cms' });
    expect(mockCounter).toHaveBeenCalledWith('onboarding.stage_skipped', 1, { stage: 'website_cms' });

    mockCounter.mockImplementationOnce(() => { throw new Error('registry down'); });
    await expect(emitOnboardingEvent({ event: 'PlatformReady', outcome: 'allowed', correlationId: 'c', companyId: 'o' }))
      .resolves.toBeUndefined();
  });
});
