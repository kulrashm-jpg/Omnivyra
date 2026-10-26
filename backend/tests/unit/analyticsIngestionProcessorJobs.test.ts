/**
 * The analytics-ingestion worker dispatches the scheduled Search Console job and the queued
 * post-connect import (no live Google or DB calls: both services are mocked).
 */
const scheduled = jest.fn(async (..._a: unknown[]) => ({ attempted: 0, succeeded: 0, failed: 0, companies: [] }));
const postConnect = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../../services/scheduledAnalyticsSync', () => ({ runScheduledAnalyticsSync: (...a: unknown[]) => scheduled(...a) }));
jest.mock('../../services/analyticsPostConnectImport', () => ({ runPostConnectImport: (...a: unknown[]) => postConnect(...a) }));
jest.mock('../../jobs/analyticsIngestionJob', () => ({ runDailyGrowthIngestion: async () => undefined, runPendingPostPolls: async () => undefined }));
jest.mock('../../services/integrations/oauthLifecycleScheduler', () => ({ runOAuthLifecycleSweep: async () => ({}) }));

import { processAnalyticsIngestionJob } from '../../queue/jobProcessors/analyticsIngestionProcessor';

const job = (data: unknown) => ({ data } as any);
beforeEach(() => { scheduled.mockClear(); postConnect.mockClear(); });

describe('analytics-ingestion worker jobs', () => {
  it('gsc-all-companies runs the scheduled Search Console sync', async () => {
    await processAnalyticsIngestionJob(job({ type: 'gsc-all-companies' }));
    expect(scheduled).toHaveBeenCalledWith('gsc');
  });

  it('ga4-all-companies passes the queued window through', async () => {
    await processAnalyticsIngestionJob(job({ type: 'ga4-all-companies', startDate: '2026-10-19', endDate: '2026-10-26' }));
    expect(scheduled).toHaveBeenCalledWith('ga4', { startDate: '2026-10-19', endDate: '2026-10-26' });
  });

  it('analytics-post-connect-import runs the import for that company and source only', async () => {
    await processAnalyticsIngestionJob(job({ type: 'analytics-post-connect-import', companyId: 'tenant-a', source: 'gsc' }));
    expect(postConnect).toHaveBeenCalledWith('tenant-a', 'gsc');
  });

  it.each([
    ['empty company id', { companyId: '', source: 'gsc' }],
    ['unknown source', { companyId: 'tenant-a', source: 'crm' }],
    ['missing company id', { source: 'ga4' }],
  ])('rejects malformed post-connect job data: %s', async (_label, data) => {
    await processAnalyticsIngestionJob(job({ type: 'analytics-post-connect-import', ...data }));
    expect(postConnect).not.toHaveBeenCalled();
  });
});
