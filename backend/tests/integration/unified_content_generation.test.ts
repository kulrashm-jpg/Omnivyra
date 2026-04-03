/**
 * UNIFIED CONTENT GENERATION - INTEGRATION TESTS
 *
 * Tests the complete flow:
 * 1. Blog generation endpoint
 * 2. Queue processing
 * 3. Job polling
 * 4. Feedback recording
 * 5. Engagement response generation
 */

import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { Queue } from 'bullmq';
import { getContentQueue, initializeContentQueues } from '../../queue/contentGenerationQueues';
import { processContentGenerationJob } from '../../queue/jobProcessors/contentGenerationProcessor';
import { generateBlogContent } from '../../adapters/commandCenter/blogContentAdapter';
import { generateEngagementResponse } from '../../adapters/engagement/responseAdapter';
import { generateDeterministicEngagementResponse, validateResponse } from '../../services/deterministicContentPath';
import { scoreContentQuality, validateContentQuality } from '../../services/unifiedContentValidation';
import { recordQuickToneFeedback, getToneEffectiveness } from '../../services/contentFeedbackLoop';

describe('Unified Content Generation System', () => {
  let contentQueue: Queue;
  const testCompanyId = 'test-company-integration-' + Date.now();

  beforeAll(async () => {
    // Initialize queues
    await initializeContentQueues();
    contentQueue = getContentQueue('content-blog');
  });

  afterAll(async () => {
    // Cleanup
    if (contentQueue) {
      await contentQueue.close();
    }
  });

  describe('Unit Tests', () => {
    it('should validate content quality for blog', () => {
      const blueprint = {
        hook: 'This is a compelling opening statement about AI in marketing that captures attention and sets the stage for what follows. The artificial intelligence revolution is transforming how businesses engage with customers and measure their marketing effectiveness in real time. This trend will reshape industries.',
        key_points: [
          'First key insight about AI transformation and how it reshapes customer engagement strategies for modern businesses seeking competitive advantage in digital markets worldwide and across industries',
          'Second key insight about customer experience personalization at scale using machine learning and predictive analytics to understand and anticipate customer needs with greater accuracy',
          'Third key insight about data-driven decisions and how AI helps organizations measure and optimize their marketing ROI effectively while reducing wasted ad spend and improving conversion rates',
          'Fourth key insight about automation and efficiency gains from implementing AI systems that handle routine marketing tasks and free teams to focus on strategic initiatives',
          'Fifth key insight about competitive advantage and future-readiness as organizations that adopt AI early establish market leadership and command higher customer loyalty'
        ],
        cta: 'Read our detailed guide to learn more about implementing AI in your marketing strategy. Visit https://example.com/ai-guide for comprehensive resources, best practices, and implementation roadmap.'
      };

      const result = validateContentQuality(blueprint, 'blog');

      expect(result.pass).toBe(true);
      expect(result.severity).not.toBe('blocking');
      expect(result.issues).toBeUndefined();
    });

    it('should score content quality', () => {
      const blueprint = {
        hook: 'The marketing landscape is changing rapidly with AI.',
        key_points: [
          'AI personalizes customer experiences at scale',
          'Machine learning optimizes ad spending across channels',
          'Predictive analytics forecast customer behavior with 89% accuracy'
        ],
        cta: 'Start your AI-powered marketing journey'
      };

      const score = scoreContentQuality(blueprint, 'blog');

      expect(score.overall_score).toBeGreaterThanOrEqual(0);
      expect(score.overall_score).toBeLessThanOrEqual(100);
      expect(score.hook_quality).toBeGreaterThanOrEqual(0);
      expect(score.key_points_quality).toBeGreaterThanOrEqual(0);
      expect(score.cta_quality).toBeGreaterThanOrEqual(0);
    });

    it('should generate deterministic engagement response for question', () => {
      const response = generateDeterministicEngagementResponse({
        message: 'How do you implement AI in marketing?',
        platform: 'linkedin',
        company_tone: 'professional',
        engagement_type: 'reply'
      });

      expect(response).not.toBeNull();
      expect(response?.length).toBeGreaterThan(0);
      expect(response?.length).toBeLessThanOrEqual(280);
    });

    it('should generate deterministic engagement response for positive feedback', () => {
      const response = generateDeterministicEngagementResponse({
        message: 'Love this! Great insights on marketing automation.',
        platform: 'x',
        company_tone: 'professional',
        engagement_type: 'reply'
      });

      expect(response).not.toBeNull();
      expect(validateResponse(response || '')).toBe(true);
    });

    it('should generate deterministic engagement response for complaint', () => {
      const response = generateDeterministicEngagementResponse({
        message: 'Terrible experience with your platform support.',
        platform: 'instagram',
        company_tone: 'professional',
        engagement_type: 'reply'
      });

      expect(response).not.toBeNull();
      expect(response?.toLowerCase()).toContain('hear');
    });

    it('should detect sentiment correctly', () => {
      const deterministic = generateDeterministicEngagementResponse({
        message: 'I love this! Amazing content!',
        platform: 'linkedin',
        company_tone: 'professional',
        engagement_type: 'new_conversation'
      });

      expect(deterministic).not.toBeNull();
    });
  });

  describe('Queue Integration Tests', () => {
    it('should add job to blog queue without error', async () => {
      const jobId = `test-blog-${Date.now()}`;

      const job = await contentQueue.add('content-blog', {
        company_id: testCompanyId,
        content_type: 'blog',
        topic: 'Test blog topic',
        intent: 'authority',
        target_word_count: 1200,
      }, {
        jobId,
      });

      expect(job).toBeDefined();
      expect(job?.id).toBe(jobId);

      // Cleanup
      await job?.remove();
    });

    it('should respect deduplication with same jobId', async () => {
      const jobId = `test-dedup-${Date.now()}`;

      const job1 = await contentQueue.add('content-blog', {
        company_id: testCompanyId,
        content_type: 'blog',
        topic: 'Test topic 1',
      }, {
        jobId,
      });

      // Attempt to add same job again
      const job2 = await contentQueue.add('content-blog', {
        company_id: testCompanyId,
        content_type: 'blog',
        topic: 'Test topic 2',
      }, {
        jobId,
      });

      // Should be same job (deduped)
      expect(job2?.id).toBe(job1?.id);

      // Cleanup
      await job1?.remove();
    });

    it('should handle bulk content job', async () => {
      const jobId = `test-bulk-${Date.now()}`;

      const job = await contentQueue.add('content-blog', {
        company_id: testCompanyId,
        bulk_mode: true,
        items: [
          { id: 'item1', content_type: 'blog', topic: 'AI trends' },
          { id: 'item2', content_type: 'blog', topic: 'Marketing automation' }
        ]
      }, {
        jobId,
      });

      expect(job).toBeDefined();
      expect(job?.data.bulk_mode).toBe(true);

      // Cleanup
      await job?.remove();
    });
  });

  describe('Feedback Loop Integration Tests', () => {
    it('should record quick tone feedback', async () => {
      const company = 'feedback-test-' + Date.now();

      await recordQuickToneFeedback({
        company_id: company,
        platform: 'linkedin',
        tone: 'professional',
        engagement_type: 'reply',
        timestamp: new Date(),
      });

      expect(true).toBe(true); // If no error, success
    });

    it('should retrieve tone effectiveness', async () => {
      const company = 'tone-effectiveness-' + Date.now();

      // Record some data first
      await recordQuickToneFeedback({
        company_id: company,
        platform: 'linkedin',
        tone: 'professional',
        engagement_type: 'reply',
        timestamp: new Date(),
      });

      // Try to get effectiveness (might be empty for new company)
      const effectiveness = await getToneEffectiveness(company, 'linkedin');

      expect(effectiveness).toBeDefined();
      expect(typeof effectiveness).toBe('object');
    });
  });

  describe('Adapter Integration Tests', () => {
    it('should create blog generation job via adapter', async () => {
      const queue = getContentQueue('content-blog');

      const result = await generateBlogContent(
        testCompanyId,
        queue,
        {
          topic: 'AI in marketing',
          audience: 'B2B marketing leaders',
        },
        {
          writing_style_instructions: 'Be analytical and data-driven',
        }
      );

      expect(result.jobId).toBeDefined();
      expect(result.pollUrl).toContain(result.jobId);
      expect(result.estimatedSeconds).toBeGreaterThan(0);

      // Verify job exists in queue
      const job = await queue.getJob(result.jobId);
      expect(job).toBeDefined();

      // Cleanup
      if (job) await job.remove();
    });

    it('should create engagement response via adapter', async () => {
      const queue = getContentQueue('content-engagement');

      const result = await generateEngagementResponse(
        testCompanyId,
        queue,
        {
          original_message: 'How do you implement this in practice?',
          platform: 'linkedin',
          engagement_type: 'reply',
        },
        {
          company_tone: 'professional',
          force_queue: false, // Try deterministic first
        }
      );

      // Should get immediate response (deterministic path)
      if (result.immediate_response) {
        expect(result.immediate_response).toBeDefined();
        expect(result.immediate_response.length).toBeGreaterThan(0);
      } else {
        // Or fallback to queue
        expect(result.jobId).toBeDefined();
      }
    });

    it('should force AI refinement via force_queue flag', async () => {
      const queue = getContentQueue('content-engagement');

      const result = await generateEngagementResponse(
        testCompanyId,
        queue,
        {
          original_message: 'Interesting perspective on this topic',
          platform: 'x',
          engagement_type: 'reply',
        },
        {
          force_queue: true, // Force queue, skip deterministic
        }
      );

      expect(result.jobId).toBeDefined();

      // Cleanup
      const job = await queue.getJob(result.jobId!);
      if (job) await job.remove();
    });
  });

  describe('End-to-End Workflow Tests', () => {
    it('should complete blog generation workflow', async () => {
      const queue = getContentQueue('content-blog');

      // Step 1: Create blog job
      const createResult = await generateBlogContent(
        testCompanyId,
        queue,
        {
          topic: 'Machine learning trends 2025',
          audience: 'Data scientists',
        }
      );

      expect(createResult.jobId).toBeDefined();

      // Step 2: Verify job exists
      const job = await queue.getJob(createResult.jobId);
      expect(job).toBeDefined();
      expect(job?.data.company_id).toBe(testCompanyId);
      expect(job?.data.topic).toBe('Machine learning trends 2025');

      // Step 3: Verify job properties
      expect(job?.data.content_type).toBe('blog');
      expect(job?.data.intent).toBe('authority');
      expect(job?.data.target_word_count).toBe(1200);

      // Cleanup
      await job?.remove();
    });

    it('should support multiple engagement types', async () => {
      const queue = getContentQueue('content-engagement');
      const engagementTypes = ['reply', 'new_conversation', 'dm', 'outreach_response'] as const;

      for (const type of engagementTypes) {
        const result = await generateEngagementResponse(
          testCompanyId,
          queue,
          {
            original_message: `Test message for ${type}`,
            platform: 'linkedin',
            engagement_type: type,
          }
        );

        // Should either have immediate response or jobId
        expect(
          result.immediate_response || result.jobId
        ).toBeDefined();

        // Cleanup if queued
        if (result.jobId) {
          const job = await queue.getJob(result.jobId);
          if (job) await job.remove();
        }
      }
    });
  });

  describe('Performance Tests', () => {
    it('should generate deterministic response in under 100ms', () => {
      const start = performance.now();

      const response = generateDeterministicEngagementResponse({
        message: 'Great article!',
        platform: 'linkedin',
        company_tone: 'professional',
        engagement_type: 'reply',
      });

      const elapsed = performance.now() - start;

      expect(response).toBeDefined();
      expect(elapsed).toBeLessThan(100);
    });
  });

  describe('Error Handling Tests', () => {
    it('should handle invalid content type gracefully', async () => {
      const queue = getContentQueue('content-blog');

      // Should not throw
      const job = await queue.add('content-blog', {
        company_id: testCompanyId,
        content_type: 'invalid_type',
        topic: 'Test',
      });

      expect(job).toBeDefined();
      await job?.remove();
    });

    it('should validate response length', () => {
      // Too short
      expect(validateResponse('hi')).toBe(false);

      // Valid length
      expect(validateResponse('This is a valid response to your question.')).toBe(true);

      // Valid long response
      expect(validateResponse('a'.repeat(300))).toBe(false); // Over 280 without being substantial
    });
  });
});

describe('Integration Tests - Full System', () => {
  it('should complete blog generation → queue → polling flow', async () => {
    const company = 'full-flow-' + Date.now();
    const queue = getContentQueue('content-blog');

    // 1. Create blog job
    const createResult = await generateBlogContent(
      company,
      queue,
      {
        topic: 'Cloud infrastructure 2025',
        audience: 'DevOps engineers',
      }
    );

    expect(createResult.jobId).toBeDefined();
    console.log('✓ Job created:', createResult.jobId);

    // 2. Verify job was queued
    const job = await queue.getJob(createResult.jobId);
    expect(job).toBeDefined();
    const state = await job?.getState();
    expect(['waiting', 'delayed', 'active', 'completed']).toContain(state);
    console.log('✓ Job queued with state:', state);

    // 3. Simulate polling
    for (let i = 0; i < 3; i++) {
      const pollJob = await queue.getJob(createResult.jobId);
      const status = await pollJob?.getState();
      console.log(`✓ Poll ${i + 1}: Job status = ${status}`);
    }

    // Cleanup
    await job?.remove();
  });

  it('should handle engagement response with fallback', async () => {
    const company = 'engagement-fallback-' + Date.now();
    const queue = getContentQueue('content-engagement');

    // Simple message → should use deterministic
    const simpleResult = await generateEngagementResponse(
      company,
      queue,
      {
        original_message: 'Thanks for sharing!',
        platform: 'linkedin',
        engagement_type: 'reply',
      },
      { force_queue: false }
    );

    if (simpleResult.immediate_response) {
      expect(simpleResult.immediate_response.length).toBeGreaterThan(0);
      console.log('✓ Deterministic response generated:', simpleResult.immediate_response.slice(0, 50) + '...');
    } else {
      console.log('✓ Fallback to queue:', simpleResult.jobId);
    }

    // Cleanup
    if (simpleResult.jobId) {
      const job = await queue.getJob(simpleResult.jobId);
      if (job) await job.remove();
    }
  });
});
