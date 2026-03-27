/**
 * Railway Compute Instrumentation - Integration Examples
 * 
 * Shows how to wrap your existing API handlers, queue processors, and cron jobs
 * to automatically track compute metrics for the Railway Efficiency dashboard.
 */

// ──────────────────────────────────────────────────────────────────────────
// Example 1: API Handler Integration
// ──────────────────────────────────────────────────────────────────────────

import type { NextApiRequest, NextApiResponse } from 'next';
import { withComputeMetrics, COMPUTE_FEATURES } from '../backend/lib/railwayComputeMiddleware';

/**
 * BEFORE: Plain API handler
 *
 * export default async function handler(req: NextApiRequest, res: NextApiResponse) {
 *   const result = await expensiveAIOperation();
 *   res.status(200).json({ result });
 * }
 */

/**
 * AFTER: Wrapped with compute metrics
 *
 * This will automatically track:
 * - Feature: "ai_generation"
 * - Endpoint: "POST /api/ai/generate"
 * - Duration: Time taken to execute handler
 * - Memory estimate: Automatically estimated or provided in options
 */
async function generateContentHandler(req: NextApiRequest, res: NextApiResponse) {
  // Your existing handler logic
  const result = await expensiveAIOperation();
  res.status(200).json({ result });
}

// Wrap the handler
const handler = withComputeMetrics(COMPUTE_FEATURES.AI_GENERATION, generateContentHandler);
export default handler;

/**
 * Example API - With explicit resource estimates
 */
import { recordComputeMetric, COMPUTE_FEATURES } from '../lib/instrumentation/railwayComputeInstrumentation';

async function customApiHandler(req: NextApiRequest, res: NextApiResponse) {
  const startTime = Date.now();

  try {
    // Your API logic
    const data = await fetchFromDatabase();
    const processed = await processData(data);

    res.status(200).json({ data: processed });
  } finally {
    // Manual tracking with custom estimates
    const duration_ms = Date.now() - startTime;
    await recordComputeMetric(
      COMPUTE_FEATURES.ENGAGEMENT_ANALYSIS,
      'api',
      duration_ms,
      {
        endpoint: `${req.method} ${req.url}`,
        memory_estimate_mb: 256, // Custom estimate
        cpu_estimate_percent: 40, // Custom estimate
      }
    );
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Example 2: Queue Job Integration
// ──────────────────────────────────────────────────────────────────────────

import { Worker } from 'bullmq';
import { redis } from '../backend/queue/redis';
import { withQueueMetrics, COMPUTE_FEATURES } from '../backend/lib/railwayComputeMiddleware';

/**
 * BEFORE: Plain queue processor
 *
 * const publishWorker = new Worker('publish', async (job) => {
 *   await publishPost(job.data);
 * }, { connection: redis });
 */

/**
 * AFTER: Wrapped with metrics
 */
const publishJobProcessor = withQueueMetrics(
  COMPUTE_FEATURES.PUBLISH,
  async (job) => {
    // Your job logic
    await publishPost(job.data);
    return { published: true };
  }
);

const publishWorker = new Worker('publish', publishJobProcessor, { connection: redis });

/**
 * Or use manual tracking in your processor directly:
 */
const campaignWorker = new Worker(
  'campaign_planning',
  async (job) => {
    const startTime = Date.now();

    try {
      const plan = await generateCampaignPlan(job.data);
      return { plan };
    } finally {
      const duration_ms = Date.now() - startTime;
      await recordComputeMetric(COMPUTE_FEATURES.CAMPAIGN_RUN, 'queue', duration_ms, {
        jobName: job.name,
        memory_estimate_mb: 512, // AI jobs need more memory
      });
    }
  },
  { connection: redis }
);

// ──────────────────────────────────────────────────────────────────────────
// Example 3: Cron Job Integration
// ──────────────────────────────────────────────────────────────────────────

import { withCronMetrics, COMPUTE_FEATURES } from '../backend/lib/railwayComputeMiddleware';

/**
 * BEFORE: Plain cron job
 *
 * export default async function engagementPollingCronJob() {
 *   await pollEngagementData();
 * }
 */

/**
 * AFTER: Wrapped with metrics
 */
const engagementPollingJob = withCronMetrics(
  COMPUTE_FEATURES.ENGAGEMENT_POLLING,
  'engagementPolling',
  async () => {
    // Your cron job logic
    await pollEngagementData();
  }
);

export default engagementPollingJob;

/**
 * Or use manual tracking:
 */
async function intelligenceSignalAnalysis() {
  const startTime = Date.now();

  try {
    // Your signal analysis logic
    const signals = await fetchSignals();
    const analyzed = await analyzeSignals(signals);
    await storeResults(analyzed);

    return { processed: analyzed.length };
  } finally {
    const duration_ms = Date.now() - startTime;
    await recordComputeMetric(
      COMPUTE_FEATURES.SIGNAL_CLUSTERING,
      'cron',
      duration_ms,
      {
        jobName: 'signalAnalysis',
        memory_estimate_mb: 256,
        cpu_estimate_percent: 50,
      }
    );
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Example 4: React Hook Integration (for client-side async operations)
// ──────────────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { withApiMetrics, COMPUTE_FEATURES } from '../backend/lib/railwayComputeMiddleware';

export function MyComponent() {
  const [loading, setLoading] = useState(false);

  const handleGenerateContent = async () => {
    setLoading(true);
    try {
      const result = await withApiMetrics(
        COMPUTE_FEATURES.CONTENT_GENERATION,
        async () => {
          const response = await fetch('/api/content/generate', { method: 'POST' });
          return response.json();
        }
      );

      // Use result...
    } finally {
      setLoading(false);
    }
  };

  return (
    <button onClick={handleGenerateContent} disabled={loading}>
      {loading ? 'Generating...' : 'Generate Content'}
    </button>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Integration Checklist
// ──────────────────────────────────────────────────────────────────────────

/**
 * Quick Integration Checklist:
 * 
 * [ ] API HANDLERS
 *     - Identify top 5-10 most-called endpoints
 *     - Wrap with withComputeMetrics() or recordComputeMetric()
 *     - Examples: /api/ai/generate, /api/campaigns/*, /api/publish
 * 
 * [ ] QUEUE PROCESSORS
 *     - Identify high-compute jobs (ai_generation, campaign_run, etc.)
 *     - Wrap processor functions with withQueueMetrics()
 *     - Queues: publish, ai-heavy, campaign-planning
 * 
 * [ ] CRON JOBS
 *     - All major cron jobs should be tracked
 *     - Wrap with withCronMetrics() in scheduler
 *     - Examples: engagementPolling, intelligencePolling, caching jobs
 * 
 * [ ] TESTING
 *     - Run a few requests/jobs with instrumentation enabled
 *     - Check /api/admin/railway-efficiency endpoint
 *     - Verify metrics appear in Railway Efficiency tab
 * 
 * [ ] MONITORING
 *     - Set up alerts if monthly cost exceeds threshold
 *     - Review insights weekly for optimization priorities
 *     - Track trends: Are expensive features improving?
 */

// ──────────────────────────────────────────────────────────────────────────
// Available Features (organized by category)
// ──────────────────────────────────────────────────────────────────────────

// AI & Content
// - COMPUTE_FEATURES.AI_GENERATION // Main LLM calls
// - COMPUTE_FEATURES.AI_CHAT // Chat interactions
//
// Campaign Management  
// - COMPUTE_FEATURES.CAMPAIGN_CREATE // Planning phase
// - COMPUTE_FEATURES.CAMPAIGN_RUN // Execution
// - COMPUTE_FEATURES.CAMPAIGN_OPTIMIZE // Auto-optimization
//
// Publishing
// - COMPUTE_FEATURES.PUBLISH // Publish job
// - COMPUTE_FEATURES.SCHEDULE // Schedule operation
//
// Engagement
// - COMPUTE_FEATURES.ENGAGEMENT_POLLING // Fetch engagement data
// - COMPUTE_FEATURES.ENGAGEMENT_ANALYSIS // Analyze threads
// - COMPUTE_FEATURES.ENGAGEMENT_INBOX // Inbox operations
//
// Intelligence
// - COMPUTE_FEATURES.INTELLIGENCE_RUN // Intelligence engine
// - COMPUTE_FEATURES.INTELLIGENCE_ANALYSIS // Analysis passes
// - COMPUTE_FEATURES.SIGNAL_CLUSTERING // Signal processing
//
// Community AI
// - COMPUTE_FEATURES.COMMUNITY_AI_ANALYSIS // Community analysis
// - COMPUTE_FEATURES.PLAYBOOK_EVAL // Playbook evaluation
//
// System
// - COMPUTE_FEATURES.DATA_SYNC // Sync operations
// - COMPUTE_FEATURES.CACHE_WARMUP // Cache warming
// - COMPUTE_FEATURES.AUDIT_RUN // Audit jobs

// Placeholder function definitions for examples
async function expensiveAIOperation() { return {}; }
async function fetchFromDatabase() { return []; }
async function processData(data: any) { return data; }
async function publishPost(data: any) {}
async function generateCampaignPlan(data: any) { return {}; }
async function pollEngagementData() {}
async function fetchSignals() { return []; }
async function analyzeSignals(signals: any) { return []; }
async function storeResults(results: any) {}
