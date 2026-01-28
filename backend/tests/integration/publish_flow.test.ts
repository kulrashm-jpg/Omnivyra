/**
 * Integration Test: Publish Flow
 * 
 * Tests the complete flow from scheduled post to published post:
 * 1. Seed demo scheduled_post and social_account
 * 2. Start cron once (finds due post, creates queue_job)
 * 3. Start worker in test mode (processes job, calls adapter)
 * 4. Assert scheduled_posts.status === 'published'
 * 5. Assert queue_jobs.status === 'completed'
 * 
 * Run: npm test or npx jest backend/tests/integration/publish_flow.test.ts
 * 
 * Prerequisites:
 * - Redis running (docker run -p 6379:6379 redis:7)
 * - Supabase database with schema applied
 * - USE_MOCK_PLATFORMS=true for testing without real API keys
 */

// Integration Test: Publish Flow
// Run with: npm test or jest backend/tests/integration/publish_flow.test.ts
// 
// Note: Jest setup required. For now, this is a template showing test structure.

import type { Job } from 'bullmq';
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
  const shouldRun = process.env.RUN_PUBLISH_FLOW_TEST === 'true';
  const runner = shouldRun ? test : test.skip;

  runner('runs the full publish flow', async () => {
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

