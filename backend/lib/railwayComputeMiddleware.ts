/**
 * Railway Compute Middleware & Decorators
 * 
 * Wraps API handlers, queue processors, and cron jobs to automatically track metrics.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import type { Worker } from 'bullmq';
import {
  recordComputeMetric,
  ComputeMetric,
} from '../../lib/instrumentation/railwayComputeInstrumentation';

// ── API Handler Wrapper ────────────────────────────────────────────────────

type ApiHandler = (req: NextApiRequest, res: NextApiResponse) => Promise<void> | void;

/**
 * Wrap an API handler to automatically track Railway compute metrics.
 * Extracts company_id from req.headers['x-company-id'] or req.query.companyId
 * Optionally pass activityType as second parameter for explicit mapping.
 */
export function withComputeMetrics(
  feature: string,
  handler: ApiHandler,
  activityType?: string,
): ApiHandler {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    const startTime = Date.now();
    let statusCode = 200;

    try {
      // Capture response status
      const originalSend = res.send;
      res.send = function (data: any) {
        statusCode = res.statusCode;
        return originalSend.call(this, data);
      };

      // Execute handler
      await handler(req, res);
    } catch (err) {
      statusCode = 500;
      throw err;
    } finally {
      const duration_ms = Date.now() - startTime;
      
      // Extract company context
      const companyId = (req.headers['x-company-id'] as string) || 
                        (req.query.companyId as string) ||
                        (req.body?.company_id as string);
      
      // Map feature to activity type if not explicitly provided
      const mappedActivityType = activityType ?? mapFeatureToActivity(feature);

      await recordComputeMetric(feature, 'api', duration_ms, {
        endpoint: `${req.method} ${req.url}`,
        company_id: companyId,
        activity_type: mappedActivityType,
      });
    }
  };
}

// ── Helper: Map feature to activity type ───────────────────────────────────

function mapFeatureToActivity(feature: string): string {
  const featureLower = feature.toLowerCase();
  
  if (featureLower.includes('campaign') || featureLower.includes('plan'))
    return 'campaign_planning';
  if (featureLower.includes('publish') || featureLower.includes('schedule'))
    return 'publishing';
  if (featureLower.includes('engagement') || featureLower.includes('inbox'))
    return 'engagement';
  if (featureLower.includes('intelligence') || featureLower.includes('signal'))
    return 'intelligence';
  if (featureLower.includes('ai') || featureLower.includes('chat'))
    return 'content_generation';
  
  return 'other';
}

// ── Queue Processor Wrapper ────────────────────────────────────────────────

export interface ComputeTrackedJobFunction {
  (job: any, token?: string): Promise<any>;
}

/**
 * Wrap a queue processor to automatically track Railway metrics.
 * Extracts company_id from job.data.company_id or job.data.companyId
 */
export function withQueueMetrics(
  feature: string,
  processor: ComputeTrackedJobFunction,
  activityType?: string,
): ComputeTrackedJobFunction {
  return async (job, token) => {
    const startTime = Date.now();
    try {
      return await processor(job, token);
    } finally {
      const duration_ms = Date.now() - startTime;
      
      const companyId = job?.data?.company_id || job?.data?.companyId;
      const mappedActivityType = activityType ?? mapFeatureToActivity(feature);

      await recordComputeMetric(feature, 'queue', duration_ms, {
        jobName: job.name || job.id,
        company_id: companyId,
        activity_type: mappedActivityType,
      });
    }
  };
}

// ── Cron Job Wrapper ──────────────────────────────────────────────────────

export type CronJobFunction = () => Promise<void> | void;

/**
 * Wrap a cron job to automatically track Railway metrics.
 * Note: Cron jobs are system-level, so company_id is typically not available.
 * Use activityType to categorize (e.g., 'engagement_polling', 'cache_warmup')
 */
export function withCronMetrics(
  feature: string,
  jobName: string,
  job: CronJobFunction,
  activityType?: string,
): CronJobFunction {
  return async () => {
    const startTime = Date.now();
    try {
      return await job();
    } finally {
      const duration_ms = Date.now() - startTime;
      const mappedActivityType = activityType ?? mapFeatureToActivity(feature);

      await recordComputeMetric(feature, 'cron', duration_ms, {
        jobName,
        activity_type: mappedActivityType,
      });
    }
  };
}

// ── Feature Name Registry ──────────────────────────────────────────────────

export const COMPUTE_FEATURES = {
  // AI & Content Generation
  AI_GENERATION: 'ai_generation',
  AI_CHAT: 'ai_chat',
  
  // Campaign Management
  CAMPAIGN_CREATE: 'campaign_create',
  CAMPAIGN_RUN: 'campaign_run',
  CAMPAIGN_OPTIMIZE: 'campaign_optimize',
  
  // Publishing & Scheduling
  PUBLISH: 'campaign_publish',
  SCHEDULE: 'campaign_schedule',
  
  // Engagement & Inbox
  ENGAGEMENT_POLLING: 'engagement_polling',
  ENGAGEMENT_ANALYSIS: 'engagement_analysis',
  ENGAGEMENT_INBOX: 'engagement_inbox',
  
  // Intelligence & Learning
  INTELLIGENCE_RUN: 'intelligence_run',
  INTELLIGENCE_ANALYSIS: 'intelligence_analysis',
  SIGNAL_CLUSTERING: 'signal_clustering',
  
  // Community AI
  COMMUNITY_AI_ANALYSIS: 'community_ai_analysis',
  PLAYBOOK_EVAL: 'playbook_eval',
  
  // System Operations
  DATA_SYNC: 'data_sync',
  CACHE_WARMUP: 'cache_warmup',
  AUDIT_RUN: 'audit_run',
};

/**
 * Feature categorization for grouping in UI
 */
export const FEATURE_CATEGORIES = {
  'AI & Content': [
    COMPUTE_FEATURES.AI_GENERATION,
    COMPUTE_FEATURES.AI_CHAT,
  ],
  'Campaign Management': [
    COMPUTE_FEATURES.CAMPAIGN_CREATE,
    COMPUTE_FEATURES.CAMPAIGN_RUN,
    COMPUTE_FEATURES.CAMPAIGN_OPTIMIZE,
  ],
  'Publishing': [
    COMPUTE_FEATURES.PUBLISH,
    COMPUTE_FEATURES.SCHEDULE,
  ],
  'Engagement': [
    COMPUTE_FEATURES.ENGAGEMENT_POLLING,
    COMPUTE_FEATURES.ENGAGEMENT_ANALYSIS,
    COMPUTE_FEATURES.ENGAGEMENT_INBOX,
  ],
  'Intelligence': [
    COMPUTE_FEATURES.INTELLIGENCE_RUN,
    COMPUTE_FEATURES.INTELLIGENCE_ANALYSIS,
    COMPUTE_FEATURES.SIGNAL_CLUSTERING,
  ],
  'Community': [
    COMPUTE_FEATURES.COMMUNITY_AI_ANALYSIS,
    COMPUTE_FEATURES.PLAYBOOK_EVAL,
  ],
  'System': [
    COMPUTE_FEATURES.DATA_SYNC,
    COMPUTE_FEATURES.CACHE_WARMUP,
    COMPUTE_FEATURES.AUDIT_RUN,
  ],
};

// ── Higher-Order Component Style (for React components) ──────────────────

export async function withApiMetrics<T extends any[]>(
  feature: string,
  asyncFn: (...args: T) => Promise<any>,
  ...args: T
): Promise<any> {
  const startTime = Date.now();
  try {
    return await asyncFn(...args);
  } finally {
    const duration_ms = Date.now() - startTime;
    await recordComputeMetric(feature, 'api', duration_ms, {
      endpoint: asyncFn.name || 'anonymous',
    });
  }
}

/**
 * Utility: Estimate memory for specific operation types
 */
export function estimateComputeResources(operationType: string, dataSize: number) {
  const estimates: Record<string, { memory_mb: number; cpu_percent: number }> = {
    'ai_inference': { memory_mb: 512, cpu_percent: 80 },
    'database_query': { memory_mb: 128, cpu_percent: 20 },
    'image_processing': { memory_mb: 256, cpu_percent: 60 },
    'batch_processing': { memory_mb: 256, cpu_percent: 40 },
    'polling': { memory_mb: 64, cpu_percent: 10 },
    'caching': { memory_mb: 512, cpu_percent: 15 },
  };

  return estimates[operationType] ?? { memory_mb: 128, cpu_percent: 25 };
}
