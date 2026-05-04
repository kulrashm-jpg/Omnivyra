import { createHash } from 'crypto';
import { RETRY_POLICIES, type RetryPolicy } from './retryPolicy';

export type RegisteredJobId =
  | 'publish'
  | 'analytics_ingestion'
  | 'token_refresh'
  | 'intelligence_polling'
  | 'engagement_polling'
  | 'campaign_schedule'
  | 'campaign_execution'
  | 'report_automation';

export type JobRegistryEntry = {
  job_id: RegisteredJobId;
  owner: string;
  queue_name: string | null;
  payload_schema: Record<string, string>;
  idempotency_key_builder: (payload: Record<string, unknown>) => string;
  lock_key_builder: (payload: Record<string, unknown>) => string;
  retry_policy: RetryPolicy;
  dlq_policy: { enabled: boolean; table: string; max_replays: number };
  replayable: boolean;
  observability_tags: string[];
};

function stableHash(payload: Record<string, unknown>): string {
  const sorted = JSON.stringify(payload, Object.keys(payload).sort());
  return createHash('sha256').update(sorted).digest('hex').slice(0, 24);
}

function key(jobId: string, payload: Record<string, unknown>, fields: string[]): string {
  const scoped: Record<string, unknown> = {};
  for (const field of fields) scoped[field] = payload[field];
  return `job:${jobId}:${stableHash(scoped)}`;
}

const defaultDlq = { enabled: true, table: 'worker_dead_letter_queue', max_replays: 1 };

export const JOB_REGISTRY: Record<RegisteredJobId, JobRegistryEntry> = {
  publish: {
    job_id: 'publish',
    owner: 'scheduler.publish',
    queue_name: 'publish',
    payload_schema: { scheduled_post_id: 'string', social_account_id: 'string', user_id: 'string', trigger_source: 'string?' },
    idempotency_key_builder: (p) => key('publish', p, ['scheduled_post_id']),
    lock_key_builder: (p) => key('publish:lock', p, ['scheduled_post_id']),
    retry_policy: RETRY_POLICIES.publish,
    dlq_policy: defaultDlq,
    replayable: false,
    observability_tags: ['publishing', 'external_side_effect'],
  },
  analytics_ingestion: {
    job_id: 'analytics_ingestion',
    owner: 'analytics.ingestion',
    queue_name: 'analytics-ingestion',
    payload_schema: { type: 'daily-growth|post-polls', batchSize: 'number?', window: 'string?', trigger_source: 'string?' },
    idempotency_key_builder: (p) => key('analytics_ingestion', p, ['type', 'window']),
    lock_key_builder: (p) => key('analytics_ingestion:lock', p, ['type', 'window']),
    retry_policy: RETRY_POLICIES.analytics_ingestion,
    dlq_policy: defaultDlq,
    replayable: true,
    observability_tags: ['analytics', 'ingestion'],
  },
  token_refresh: {
    job_id: 'token_refresh',
    owner: 'auth.tokenRefresh',
    queue_name: null,
    payload_schema: { account_id: 'string?', platform: 'string?', window: 'string?', trigger_source: 'string?' },
    idempotency_key_builder: (p) => key('token_refresh', p, ['account_id', 'platform', 'window']),
    lock_key_builder: (p) => key('token_refresh:lock', p, ['account_id', 'platform', 'window']),
    retry_policy: RETRY_POLICIES.token_refresh,
    dlq_policy: defaultDlq,
    replayable: false,
    observability_tags: ['auth', 'tokens', 'external_side_effect'],
  },
  intelligence_polling: {
    job_id: 'intelligence_polling',
    owner: 'intelligence.polling',
    queue_name: 'intelligence-polling',
    payload_schema: { apiSourceId: 'string', companyId: 'string?', purpose: 'string?', window: 'string?', trigger_source: 'string?' },
    idempotency_key_builder: (p) => key('intelligence_polling', p, ['apiSourceId', 'companyId', 'purpose', 'window']),
    lock_key_builder: (p) => key('intelligence_polling:lock', p, ['apiSourceId', 'companyId', 'purpose', 'window']),
    retry_policy: RETRY_POLICIES.polling,
    dlq_policy: defaultDlq,
    replayable: true,
    observability_tags: ['intelligence', 'polling'],
  },
  engagement_polling: {
    job_id: 'engagement_polling',
    owner: 'engagement.polling',
    queue_name: 'engagement-polling',
    payload_schema: { window: 'string', trigger_source: 'string?' },
    idempotency_key_builder: (p) => key('engagement_polling', p, ['window']),
    lock_key_builder: (p) => key('engagement_polling:lock', p, ['window']),
    retry_policy: RETRY_POLICIES.polling,
    dlq_policy: defaultDlq,
    replayable: true,
    observability_tags: ['engagement', 'polling'],
  },
  campaign_schedule: {
    job_id: 'campaign_schedule',
    owner: 'campaign.execution',
    queue_name: null,
    payload_schema: { campaignId: 'string', execution_intent_id: 'string', plan_hash: 'string', trigger_source: 'string?' },
    idempotency_key_builder: (p) => key('campaign_schedule', p, ['campaignId', 'execution_intent_id', 'plan_hash']),
    lock_key_builder: (p) => key('campaign_schedule:lock', p, ['campaignId']),
    retry_policy: RETRY_POLICIES.campaign_schedule,
    dlq_policy: defaultDlq,
    replayable: false,
    observability_tags: ['campaign', 'schedule'],
  },
  campaign_execution: {
    job_id: 'campaign_execution',
    owner: 'campaign.execution',
    queue_name: null,
    payload_schema: { campaignId: 'string', execution_intent_id: 'string', trigger_source: 'string?' },
    idempotency_key_builder: (p) => key('campaign_execution', p, ['campaignId', 'execution_intent_id']),
    lock_key_builder: (p) => key('campaign_execution:lock', p, ['campaignId']),
    retry_policy: RETRY_POLICIES.campaign_schedule,
    dlq_policy: defaultDlq,
    replayable: false,
    observability_tags: ['campaign', 'execution'],
  },
  report_automation: {
    job_id: 'report_automation',
    owner: 'reports.automation',
    queue_name: null,
    payload_schema: { companyId: 'string?', reportId: 'string?', window: 'string?', trigger_source: 'string?' },
    idempotency_key_builder: (p) => key('report_automation', p, ['companyId', 'reportId', 'window']),
    lock_key_builder: (p) => key('report_automation:lock', p, ['companyId', 'reportId', 'window']),
    retry_policy: RETRY_POLICIES.report_automation,
    dlq_policy: defaultDlq,
    replayable: true,
    observability_tags: ['reports', 'automation'],
  },
};

export function getJobRegistryEntry(jobId: RegisteredJobId): JobRegistryEntry {
  return JOB_REGISTRY[jobId];
}
