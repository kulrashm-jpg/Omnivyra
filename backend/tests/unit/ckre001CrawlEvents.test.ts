/**
 * CKRE-001 §1/§6 — crawl events reuse the AUTH-001 infrastructure.
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
  emitCrawlEvent,
  metricForCrawlEvent,
  recordCrawlChangeMetric,
  resolveCrawlCorrelationId,
  CRAWL_EVENT_CAPABILITY_PREFIX,
} from '../../services/crawl/crawlEventService';

const mockLog = logSecurityEvent as jest.MockedFunction<typeof logSecurityEvent>;
const mockCounter = recordRawCounter as jest.Mock;

describe('CKRE-001 §1 — crawl events ride the AUTH-001 envelope + audit log', () => {
  test('capability prefixed crawl.<Event>, versioned envelope, correlation in resource_id', async () => {
    await emitCrawlEvent({
      event: 'CrawlCompleted', outcome: 'allowed', correlationId: 'cid-1',
      companyId: 'org1', workflow: 'onboarding', target: 'https://acme.com', metadata: { pages: 3 },
    });
    const row = mockLog.mock.calls[0][0];
    expect(row.capability).toBe(`${CRAWL_EVENT_CAPABILITY_PREFIX}CrawlCompleted`);
    expect(row.resourceId).toBe('cid-1');
    expect(row.organizationId).toBe('org1');
    const env = JSON.parse(String(row.reason));
    expect(env.v).toBe('1.1'); // SAME schema version as AUTH-001
    expect(env.event).toBe('CrawlCompleted');
    expect(env.state).toBe('https://acme.com');
    expect(env.metadata.workflow).toBe('onboarding');
    expect(env.metadata.pages).toBe(3);
  });

  test('never throws even if the audit sink throws', async () => {
    mockLog.mockRejectedValueOnce(new Error('down'));
    await expect(emitCrawlEvent({ event: 'CrawlFailed', outcome: 'denied', correlationId: 'c', companyId: 'o' }))
      .resolves.toBeUndefined();
  });

  test('correlation reuses the signup journey ID; falls back to company key', async () => {
    expect(await resolveCrawlCorrelationId('a@b.com', 'org1')).toBe('journey-shared');
    expect(await resolveCrawlCorrelationId(null, 'org1')).toBe('company:org1');
    expect(await resolveCrawlCorrelationId(null, null)).toBe('crawl:unknown');
  });
});

describe('CKRE-001 §6 — event & change metrics', () => {
  test('event → metric mapping', () => {
    expect(metricForCrawlEvent('CrawlCompleted')).toBe('count');
    expect(metricForCrawlEvent('CrawlSkipped')).toBe('skipped');
    expect(metricForCrawlEvent('CrawlFailed')).toBe('failed');
    expect(metricForCrawlEvent('EnrichmentTriggered')).toBe('enrichment_triggered');
    expect(metricForCrawlEvent('CrawlRequested')).toBeNull();
    expect(metricForCrawlEvent('ChangeEvaluated')).toBeNull();
  });

  test('emit records the derived counter; failure never breaks the event', async () => {
    await emitCrawlEvent({ event: 'CrawlSkipped', outcome: 'allowed', correlationId: 'c', companyId: 'o', workflow: 'onboarding' });
    expect(mockCounter).toHaveBeenCalledWith('crawl.skipped', 1, { workflow: 'onboarding' });

    mockCounter.mockImplementationOnce(() => { throw new Error('registry down'); });
    await expect(emitCrawlEvent({ event: 'CrawlCompleted', outcome: 'allowed', correlationId: 'c', companyId: 'o' }))
      .resolves.toBeUndefined();
  });

  test('change verdict metric mapping (only real changes counted)', () => {
    mockCounter.mockClear();
    recordCrawlChangeMetric('MAJOR_CHANGE', 'profile_refresh');
    recordCrawlChangeMetric('BUSINESS_CHANGE', 'profile_refresh');
    recordCrawlChangeMetric('UNCHANGED', 'profile_refresh'); // no metric
    expect(mockCounter).toHaveBeenCalledWith('crawl.major_change', 1, { workflow: 'profile_refresh' });
    expect(mockCounter).toHaveBeenCalledWith('crawl.business_change', 1, { workflow: 'profile_refresh' });
    expect(mockCounter).toHaveBeenCalledTimes(2);
  });
});
