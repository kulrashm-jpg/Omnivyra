/**
 * Integration Test: Publish Flow
 *
 * Tests the complete flow from scheduled post to published post.
 * Uses mocked Supabase + BullMQ so tests pass without real Redis/DB.
 */

import type { Job } from 'bullmq';

// In-memory store for deterministic testing
const store: Record<string, any[]> = {
  social_accounts: [],
  scheduled_posts: [],
  queue_jobs: [],
  queue_job_logs: [],
  campaigns: [],
};

function applyFilters(
  rows: any[],
  filters: Record<string, any>,
  inFilters: Record<string, any[]>,
  lteFilters?: Record<string, any>
) {
  let result = rows;
  for (const [k, v] of Object.entries(filters)) {
    if (k.includes('->>')) {
      const [table, col] = k.split('->>');
      result = result.filter((r: any) => (r[table] as any)?.[col] === v);
    } else result = result.filter((r: any) => r[k] === v);
  }
  for (const [k, vals] of Object.entries(inFilters)) {
    result = result.filter((r: any) => vals.includes(r[k]));
  }
  if (lteFilters) {
    for (const [k, v] of Object.entries(lteFilters)) {
      result = result.filter((r: any) => r[k] != null && r[k] <= v);
    }
  }
  return result;
}

function buildChain(table: string) {
  const state: any = { filters: {}, inFilters: {}, lteFilters: {}, updateData: null };
  const self: any = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockImplementation((row: any) => {
      const id = row.id || `gen-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      if (!store[table]) store[table] = [];
      const record = { ...row, id, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      store[table].push(record);
      self._inserted = record;
      return self;
    }),
    update: jest.fn().mockImplementation((data: any) => {
      state.updateData = data;
      return self;
    }),
    delete: jest.fn().mockImplementation(() => {
      state._isDelete = true;
      return self;
    }),
    eq: jest.fn((field: string, value: any) => {
      state.filters[field] = value;
      return self;
    }),
    in: jest.fn((field: string, values: any[]) => {
      state.inFilters[field] = values;
      return self;
    }),
    lte: jest.fn((field: string, value: any) => {
      state.lteFilters[field] = value;
      return self;
    }),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    single: jest.fn().mockImplementation(() => {
      const rows = store[table] || [];
      const filtered = applyFilters(rows, state.filters, state.inFilters, state.lteFilters);
      let data = filtered[0] || null;
      if (self._inserted) data = self._inserted;
      if (state.updateData && data) {
        Object.assign(data, state.updateData);
      }
      return Promise.resolve({ data, error: null });
    }),
    maybeSingle: jest.fn().mockImplementation(() => {
      const rows = store[table] || [];
      const filtered = applyFilters(rows, state.filters, state.inFilters, state.lteFilters);
      const data = filtered[0] || null;
      return Promise.resolve({ data, error: null });
    }),
  };
  self.then = jest.fn().mockImplementation((resolve: any) => {
    const rows = store[table] || [];
    const filtered = applyFilters(rows, state.filters, state.inFilters, state.lteFilters);
    if (state._isDelete) {
      const ids = new Set(filtered.map((r: any) => r.id));
      store[table] = (store[table] || []).filter((r: any) => !ids.has(r.id));
      return Promise.resolve({ data: null, error: null }).then(resolve);
    }
    if (state.updateData && filtered.length > 0) {
      filtered.forEach((r: any) => Object.assign(r, state.updateData));
    }
    const data = self._inserted ? [self._inserted] : filtered;
    return Promise.resolve({ data, count: data.length, error: null }).then(resolve);
  });
  return self;
}

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: jest.fn((table: string) => buildChain(table)),
  },
}));

jest.mock('../../queue/bullmqClient', () => ({
  getQueue: jest.fn().mockReturnValue({
    add: jest.fn().mockResolvedValue({ id: 'mock-job-id' }),
  }),
}));

jest.mock('../../adapters/platformAdapter', () => ({
  publishToPlatform: jest.fn().mockResolvedValue({
    success: true,
    platform_post_id: 'mock_platform_post_123',
    post_url: 'https://example.com/post/123',
    published_at: new Date(),
  }),
}));

jest.mock('../../services/campaignReadinessService', () => ({
  getCampaignReadiness: jest.fn().mockResolvedValue({ ready: true }),
}));

jest.mock('../../services/analyticsService', () => ({
  recordPostAnalytics: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/activityLogger', () => ({
  logActivity: jest.fn().mockResolvedValue(undefined),
}));
import { supabase } from '../../db/supabaseClient';
import { findDuePostsAndEnqueue } from '../../scheduler/schedulerService';
import { processPublishJob } from '../../queue/jobProcessors/publishProcessor';
import { getScheduledPost } from '../../db/queries';

// Test data IDs (use real UUIDs in actual implementation)
const TEST_USER_ID = process.env.TEST_USER_ID || '00000000-0000-0000-0000-000000000001';
const TEST_SOCIAL_ACCOUNT_ID = '00000000-0000-0000-0000-000000000002';
const TEST_SCHEDULED_POST_ID = '00000000-0000-0000-0000-000000000003';

// TODO: Setup Jest before running these tests:
// npm install --save-dev jest @types/jest ts-jest
// Create jest.config.js

async function runIntegrationTest() {
  console.log('🧪 Running Publish Flow Integration Test...');

  // Clear in-memory store before each run
  store.social_accounts = [];
  store.scheduled_posts = [];
  store.queue_jobs = [];
  store.queue_job_logs = [];
  store.campaigns = [];

  // Ensure USE_MOCK_PLATFORMS is enabled for testing
  process.env.USE_MOCK_PLATFORMS = 'true';

  // Seed test data
  await seedTestData();

  try {
    // Test case: publish scheduled post end-to-end
    // Step 1: Verify scheduled post exists
    const scheduledPost = await getScheduledPost(TEST_SCHEDULED_POST_ID);
    if (!scheduledPost || scheduledPost.status !== 'scheduled') {
      throw new Error('Scheduled post not found or not in scheduled status');
    }

    // Step 2: Run cron to find due posts and create queue jobs
    console.log('🔄 Running cron scheduler...');
    const cronResult = await findDuePostsAndEnqueue();
    if (cronResult.created === 0) {
      throw new Error('No queue jobs created by cron');
    }

    // Step 3: Get the created queue job
    const { data: queueJobs } = await supabase
      .from('queue_jobs')
      .select('*')
      .eq('scheduled_post_id', TEST_SCHEDULED_POST_ID)
      .eq('status', 'pending')
      .limit(1);

    if (!queueJobs || queueJobs.length === 0) {
      throw new Error('Queue job not found');
    }
    const queueJob = queueJobs[0];

    // Step 4: Process the job manually (simulating worker)
    console.log('🔄 Processing queue job...');
    const mockJob = {
      id: queueJob.id,
      data: {
        scheduled_post_id: TEST_SCHEDULED_POST_ID,
        social_account_id: TEST_SOCIAL_ACCOUNT_ID,
        user_id: TEST_USER_ID,
      },
    } as Job;

    await processPublishJob(mockJob);

    // Step 5: Verify scheduled post was published
    const publishedPost = await getScheduledPost(TEST_SCHEDULED_POST_ID);
    if (!publishedPost || publishedPost.status !== 'published') {
      throw new Error(`Post not published. Status: ${publishedPost?.status}`);
    }
    if (!publishedPost.platform_post_id || !publishedPost.post_url) {
      throw new Error('Platform post ID or URL missing');
    }

    // Step 6: Verify queue job completed
    const { data: completedJob } = await supabase
      .from('queue_jobs')
      .select('*')
      .eq('id', queueJob.id)
      .single();

    if (!completedJob || completedJob.status !== 'completed') {
      throw new Error(`Queue job not completed. Status: ${completedJob?.status}`);
    }
    if (!completedJob.result_data) {
      throw new Error('Queue job result_data missing');
    }

    // Step 7: Verify queue job logs were created
    const { data: logs } = await supabase
      .from('queue_job_logs')
      .select('*')
      .eq('job_id', queueJob.id);

    if (!logs || logs.length === 0) {
      throw new Error('No queue job logs found');
    }
    if (!logs.some(log => log.log_level === 'info')) {
      throw new Error('No info-level logs found');
    }

    console.log('✅ Integration test passed!');
  } finally {
    // Cleanup test data
    await cleanupTestData();
  }
}

// Run test if executed directly
if (require.main === module) {
  runIntegrationTest().catch(err => {
    console.error('❌ Integration test failed:', err);
    process.exit(1);
  });
}

export { runIntegrationTest };

describe('Publish Flow Integration', () => {
  test('runs the full publish flow', async () => {
    await runIntegrationTest();
  });
});

/**
 * Seed test data
 */
async function seedTestData() {
  console.log('📦 Seeding test data...');

  // Create test social account (with encrypted mock token)
  const { error: accountError } = await supabase.from('social_accounts').insert({
    id: TEST_SOCIAL_ACCOUNT_ID,
    user_id: TEST_USER_ID,
    platform: 'linkedin',
    platform_user_id: 'test_linkedin_user_123',
    account_name: 'Test LinkedIn Account',
    username: 'test_linkedin',
    access_token: 'mock_encrypted_token', // In real test, this would be encrypted
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  if (accountError) {
    console.warn('Failed to seed social account (may already exist):', accountError.message);
  }

  // Create test scheduled post (due now)
  const { error: postError } = await supabase.from('scheduled_posts').insert({
    id: TEST_SCHEDULED_POST_ID,
    user_id: TEST_USER_ID,
    social_account_id: TEST_SOCIAL_ACCOUNT_ID,
    platform: 'linkedin',
    content_type: 'post',
    content: 'Test post content for integration test',
    scheduled_for: new Date(Date.now() - 60000).toISOString(), // 1 minute ago (due)
    status: 'scheduled',
    timezone: 'UTC',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  if (postError) {
    console.warn('Failed to seed scheduled post (may already exist):', postError.message);
  }

  console.log('✅ Test data seeded');
}

/**
 * Cleanup test data
 */
async function cleanupTestData() {
  console.log('🧹 Cleaning up test data...');

  await supabase
    .from('queue_job_logs')
    .delete()
    .eq('job_id', (await supabase.from('queue_jobs').select('id').eq('scheduled_post_id', TEST_SCHEDULED_POST_ID).single()).data?.id);

  await supabase.from('queue_jobs').delete().eq('scheduled_post_id', TEST_SCHEDULED_POST_ID);
  await supabase.from('scheduled_posts').delete().eq('id', TEST_SCHEDULED_POST_ID);
  await supabase.from('social_accounts').delete().eq('id', TEST_SOCIAL_ACCOUNT_ID);

  console.log('✅ Test data cleaned up');
}

