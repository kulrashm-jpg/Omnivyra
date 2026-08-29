/** Structured plan scheduler — daily placement + entrypoints — split from structuredPlanSchedulerExec.ts (barrel preserved; importers unchanged). */
/** Structured plan scheduler — execution — split from structuredPlanScheduler.ts (barrel preserved; importers unchanged). */
import { supabase } from '../db/supabaseClient';
import { BoltError, BOLT_ERROR_CODES } from '../../lib/shared/bolt/boltErrorCodes';
import { recordRowFailureBatch, type RowFailureRecord } from './boltRowFailureDiagnostics';
// `getCreatorGovernance` is already imported below from the creator
// governance registry — kept there to avoid duplicate identifier.

import { getPlatformRules, listPlatformCatalog } from './platformIntelligenceService';
import { processBlockSchedule } from './boltScheduleBlockProcessor';
import { evaluateScheduleEligibility } from './campaignScheduleEligibilityService';
import { getExecutionEngine } from './executionEngines';
import { deriveCreatorAssetTypeFromIntent } from './creatorTemplateRegistryService';
import { validateCreatorExecutionOutput, validateCreatorSchedulingContract } from './creatorExecutionContracts';
import { validateAssetReadiness } from './creatorAssetValidationService';
import { logCreatorExecutionAudit } from './creatorExecutionAuditService';
import { acquireCreatorExecutionLock, CreatorExecutionLockError, extendCreatorExecutionLease, releaseCreatorExecutionLock } from './creatorExecutionLockService';
import { assertCreatorExecutionWithinRateLimits, CreatorExecutionRateLimitError } from './creatorExecutionRateLimitService';
import { recordCreatorExecutionMetric, upsertCreatorExecutionSummary, writeCreatorDeadLetter } from './creatorExecutionObservabilityService';
import { getContentQueue } from '../queue/contentGenerationQueues';
import type { BoltContentJobData } from '../queue/jobProcessors/boltContentJobProcessor';
import { enqueueScheduledPostAt } from '../scheduler/schedulerService';
import { isQueueOperational } from './queueHealth';
import { logPipelineEvent } from '../../lib/shared/observability';
import { PipelineErrorCode } from '../../lib/shared/pipelineErrorCodes';
import type { CanonicalCreatorOutput, CreatorScheduleResult } from './executionEngines/types';
import { ownedDbTable } from '../db/writeOwner';
import {
  makeScheduledPostIdempotencyKey,
  isIdempotencyCollision,
} from './boltScheduleIdempotency';
import {
  assertCreatorFormatsSchedulable,
  assertNoUnschedulableCreatorDailyPlans,
  getCreatorFormatsFromStructuredPlanWeeks,
  getCreatorGovernance,
  getRowSchedulingEligibility,
  isAttachmentRequiredFormat,
  normalizeCreatorFormat,
  CREATOR_LIFECYCLE_STATES,
} from '../../lib/shared/creatorGovernanceRegistry';
import { applyTransition } from '../../lib/shared/creatorLifecycleStateMachine';
import { scheduleCreatorAttachmentPost } from './creator/creatorRowScheduler';
// Phase 2B — Intelligent Mix per-row routing (ACTIVE for combined ONLY).
import { partitionRowsByLane } from '../../lib/shared/bolt/rowSchedulingLane';
import { buildRoutingDiagnostics, emitRoutingDiagnostics } from '../../lib/shared/bolt/boltRoutingPreview';

import { type PlatformNormalizer, buildPlatformAliasMap, normalizePlatform, toDbPlatformKey, toLegacyPlatformKey, enforceScheduleFloor, isLegacyPlan, extractTypeMapFromPlatformRules, toDbContentType, type StructuredWeekBlueprint, type StructuredPlan, extractSchedulableJobsFromWeeks, type DailyPlanRow, sleep, toNumericValue, getCurrentCampaignPlanVersion, classifyCreatorFailure, assertNoUnschedulableCreatorPlanWeeks, startCreatorLeaseHeartbeat, buildScheduledForFromDailyPlan, scheduleFromDailyPlans, scheduleFromExecutionJobs, scheduleFromAllocation, scheduleFromLegacy, type ScheduleStructuredPlanOptions, tryParseExecutionContent, CONTENT_TYPE_PRIORITY_MAP } from './structuredPlanSchedulerModel';

import { type LegacyScheduledPost } from './structuredPlanSchedulerExecWeekly';

function mapDbRowToLegacyScheduledPost(row: any): LegacyScheduledPost {
  return {
    id: String(row.id),
    platform: toLegacyPlatformKey(String(row.platform || '')),
    contentType: String(row.content_type || 'post'),
    content: String(row.content || ''),
    mediaUrls: Array.isArray(row.media_urls) ? row.media_urls : [],
    hashtags: Array.isArray(row.hashtags) ? row.hashtags : [],
    scheduledFor: row.scheduled_for ? new Date(row.scheduled_for).toISOString() : new Date().toISOString(),
    status: String(row.status || 'draft') as any,
    publishedAt: row.published_at ? new Date(row.published_at).toISOString() : undefined,
    errorMessage: row.error_message ?? undefined,
    retryCount: Number(row.retry_count ?? 0),
    maxRetries: Number(row.max_retries ?? 3),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
    repurpose_index: row.repurpose_index != null ? Number(row.repurpose_index) : 1,
    repurpose_total: row.repurpose_total != null ? Number(row.repurpose_total) : 1,
  };
}

async function validatePlatformAndType(input: { platform: string; contentType: string }): Promise<{
  canonicalPlatform: string;
  dbPlatform: string;
  normalizedContentType: string;
}> {
  const bundle = await getPlatformRules(input.platform);
  if (!bundle) {
    throw new BoltError(
      BOLT_ERROR_CODES.SCHEDULING_PLATFORM_UNSUPPORTED,
      `Unsupported platform: ${String(input.platform)}`,
      { details: { platform: String(input.platform) } }
    );
  }

  const canonicalPlatform = String(bundle.platform.canonical_key || '').toLowerCase().trim();
  if (!canonicalPlatform) {
    throw new BoltError(
      BOLT_ERROR_CODES.SCHEDULING_PLATFORM_UNSUPPORTED,
      `Unsupported platform: ${String(input.platform)}`,
      { details: { platform: String(input.platform) } }
    );
  }

  const normalizedContentType = String(input.contentType || 'post').toLowerCase().trim();
  const supportedTypes = new Set(
    (bundle.content_rules || [])
      .map((r: any) => String(r.content_type || '').toLowerCase().trim())
      .filter(Boolean)
  );
  if (supportedTypes.size > 0 && !supportedTypes.has(normalizedContentType)) {
    throw new BoltError(
      BOLT_ERROR_CODES.SCHEDULING_CONTENT_TYPE_UNSUPPORTED,
      `Unsupported contentType "${normalizedContentType}" for platform "${canonicalPlatform}"`,
      { details: { platform: canonicalPlatform, content_type: normalizedContentType } }
    );
  }

  return {
    canonicalPlatform,
    dbPlatform: toDbPlatformKey(canonicalPlatform),
    normalizedContentType,
  };
}

async function resolveActiveSocialAccountId(userId: string, canonicalPlatform: string): Promise<string | null> {
  const candidates = new Set<string>([canonicalPlatform, toDbPlatformKey(canonicalPlatform)]);
  if (canonicalPlatform === 'x') candidates.add('twitter');

  const { data, error } = await ownedDbTable('social_accounts')
    .select('id, platform')
    .eq('user_id', userId)
    .eq('is_active', true)
    .in('platform', Array.from(candidates))
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) throw new BoltError(
    BOLT_ERROR_CODES.SCHEDULING_SOCIAL_ACCOUNTS_FAILED,
    `Failed to load social accounts: ${error.message}`,
    { cause: error, details: { db_error: error.message } }
  );
  const row = (data || [])[0];
  return row?.id ? String(row.id) : null;
}

export async function listLegacyScheduledPosts(input: {
  userId: string;
  platform?: string;
  status?: string;
  limit: number;
  offset: number;
}): Promise<{ posts: LegacyScheduledPost[]; total: number }> {
  const limit = Math.max(1, Math.min(200, Number(input.limit || 50)));
  const offset = Math.max(0, Number(input.offset || 0));

  let q: any = ownedDbTable('scheduled_posts')
    .select('*', { count: 'exact' })
    .eq('user_id', input.userId)
    .order('scheduled_for', { ascending: false });

  const platform = String(input.platform || '').trim().toLowerCase();
  if (platform && platform !== 'all') {
    const { dbPlatform } = await validatePlatformAndType({ platform, contentType: 'post' });
    q = q.eq('platform', dbPlatform);
  }

  const status = String(input.status || '').trim().toLowerCase();
  if (status && status !== 'all') {
    q = q.eq('status', status);
  }

  const { data, error, count } = await q.range(offset, offset + limit - 1);
  if (error) throw new BoltError(
    BOLT_ERROR_CODES.SCHEDULED_POST_PERSISTENCE_FAILED,
    `Failed to list scheduled posts: ${error.message}`,
    { cause: error, details: { db_error: error.message, op: 'list' } }
  );

  return {
    posts: (data || []).map(mapDbRowToLegacyScheduledPost),
    total: Number(count ?? 0),
  };
}

async function createLegacyScheduledPostRuntime(input: {
  userId: string;
  socialAccountId?: string;
  platform: string;
  contentType: string;
  content: string;
  scheduledFor: string | Date;
  mediaUrls?: string[];
  hashtags?: string[];
  title?: string;
}): Promise<LegacyScheduledPost> {
  const { canonicalPlatform, dbPlatform, normalizedContentType } = await validatePlatformAndType({
    platform: input.platform,
    contentType: input.contentType,
  });

  let socialAccountId: string | null = null;
  if (input.socialAccountId) {
    const candidates = new Set<string>([canonicalPlatform, toDbPlatformKey(canonicalPlatform)]);
    if (canonicalPlatform === 'x') candidates.add('twitter');

    const { data, error } = await ownedDbTable('social_accounts')
      .select('id, platform')
      .eq('id', input.socialAccountId)
      .eq('user_id', input.userId)
      .eq('is_active', true)
      .maybeSingle();

    if (error) throw new BoltError(
      BOLT_ERROR_CODES.SCHEDULING_SOCIAL_ACCOUNTS_FAILED,
      `Failed to load social account: ${error.message}`,
      { cause: error, details: { db_error: error.message, op: 'load_one' } }
    );
    if (!data?.id) {
      throw new BoltError(
        BOLT_ERROR_CODES.SCHEDULING_NO_ACCOUNT_FOR_PLATFORM,
        'Invalid accountId',
      );
    }
    const acctPlatform = String((data as any).platform || '').toLowerCase().trim();
    if (!candidates.has(acctPlatform)) {
      throw new BoltError(
        BOLT_ERROR_CODES.SCHEDULING_ACCOUNT_PLATFORM_MISMATCH,
        `accountId is not connected for platform "${canonicalPlatform}"`,
        { details: { platform: canonicalPlatform } }
      );
    }
    socialAccountId = String(data.id);
  } else {
    socialAccountId = await resolveActiveSocialAccountId(input.userId, canonicalPlatform);
  }

  if (!socialAccountId) {
    throw new BoltError(
      BOLT_ERROR_CODES.SCHEDULING_NO_ACCOUNT_FOR_PLATFORM,
      `No active social account connected for platform "${canonicalPlatform}"`,
      { details: { platform: canonicalPlatform } }
    );
  }

  const scheduledFor = new Date(input.scheduledFor as any);
  if (Number.isNaN(scheduledFor.getTime())) {
    throw new BoltError(
      BOLT_ERROR_CODES.SCHEDULING_INVALID_SCHEDULED_TIME,
      'Invalid scheduledFor',
    );
  }

  const now = new Date().toISOString();
  // Deterministic idempotency key for the legacy ad-hoc social-post
  // path. The canonical batchInsertScheduledPosts uses
  // makeScheduledPostIdempotencyKey from campaign-shape inputs
  // (campaignId, week, day, …) which don't exist here. The legacy
  // path's dedup tuple is (user, social_account, platform,
  // content_type, scheduled_for, content) — if a network retry resends
  // the same /api/schedule/posts request, this produces an identical
  // key and the partial unique index uidx_scheduled_posts_idempotency_key
  // rejects the duplicate via 23505 instead of silently inserting a
  // second row. The `legacy:` prefix keeps these keys non-colliding
  // with BOLT-generated keys in the same column.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHash } = require('crypto') as typeof import('crypto');
  const legacyIdempotencyKey = createHash('sha256').update(JSON.stringify([
    'legacy',
    String(input.userId),
    String(socialAccountId),
    String(dbPlatform).toLowerCase(),
    String(normalizedContentType).toLowerCase(),
    scheduledFor.toISOString(),
    String(input.content || ''),
  ])).digest('hex').slice(0, 32);

  const payload: any = {
    user_id: input.userId,
    social_account_id: socialAccountId,
    platform: dbPlatform,
    content_type: normalizedContentType,
    title: input.title ? String(input.title).slice(0, 500) : null,
    content: String(input.content || ''),
    hashtags: Array.isArray(input.hashtags) ? input.hashtags : [],
    media_urls: Array.isArray(input.mediaUrls) ? input.mediaUrls : [],
    scheduled_for: scheduledFor.toISOString(),
    status: 'scheduled',
    repurpose_index: 1,
    repurpose_total: 1,
    created_at: now,
    updated_at: now,
    idempotency_key: legacyIdempotencyKey,
  };

  const { data, error } = await ownedDbTable('scheduled_posts').insert(payload).select('*').single();
  if (error) {
    // Recover from 23505 (the unique index from migration 20260725)
    // by looking up the existing row by the deterministic key. Matches
    // the recovery pattern in creatorExecutionEngine and the bolt
    // schedule block processor — surfaces the prior row instead of
    // double-erroring on a legitimate retry.
    if ((error as any)?.code === '23505') {
      const { data: existing, error: existingError } = await ownedDbTable('scheduled_posts')
        .select('*')
        .eq('idempotency_key', legacyIdempotencyKey)
        .maybeSingle();
      if (!existingError && existing) {
        return mapDbRowToLegacyScheduledPost(existing);
      }
    }
    throw new BoltError(
      BOLT_ERROR_CODES.SCHEDULED_POST_PERSISTENCE_FAILED,
      `Failed to schedule post: ${error.message}`,
      { cause: error, details: { db_error: error.message, op: 'schedule' } }
    );
  }
  return mapDbRowToLegacyScheduledPost(data);
}

export { createLegacyScheduledPostRuntime as createLegacyScheduledPost };

export async function getLegacyScheduledPostById(input: {
  userId: string;
  id: string;
}): Promise<LegacyScheduledPost | null> {
  const { data, error } = await ownedDbTable('scheduled_posts')
    .select('*')
    .eq('id', input.id)
    .eq('user_id', input.userId)
    .maybeSingle();

  if (error) throw new BoltError(
    BOLT_ERROR_CODES.SCHEDULED_POST_PERSISTENCE_FAILED,
    `Failed to get scheduled post: ${error.message}`,
    { cause: error, details: { db_error: error.message, op: 'get' } }
  );
  if (!data) return null;
  return mapDbRowToLegacyScheduledPost(data);
}

export async function updateLegacyScheduledPost(input: {
  userId: string;
  id: string;
  patch: Partial<{
    content: string;
    contentType: string;
    scheduledFor: string;
    status: string;
    hashtags: string[];
    mediaUrls: string[];
    title: string;
  }>;
}): Promise<void> {
  const patch: any = {};
  if (typeof input.patch.content === 'string') patch.content = input.patch.content;
  if (typeof input.patch.title === 'string') patch.title = input.patch.title.slice(0, 500);
  if (Array.isArray(input.patch.hashtags)) patch.hashtags = input.patch.hashtags;
  if (Array.isArray(input.patch.mediaUrls)) patch.media_urls = input.patch.mediaUrls;
  if (typeof input.patch.status === 'string') patch.status = input.patch.status;
  if (typeof input.patch.scheduledFor === 'string') {
    const scheduledFor = new Date(input.patch.scheduledFor);
    if (Number.isNaN(scheduledFor.getTime())) throw new BoltError(
      BOLT_ERROR_CODES.SCHEDULING_INVALID_SCHEDULED_TIME,
      'Invalid scheduledFor (NaN time)',
      { details: { op: 'update' } }
    );
    patch.scheduled_for = scheduledFor.toISOString();
  }
  if (typeof input.patch.contentType === 'string') {
    let normalizedContentType = String(input.patch.contentType).toLowerCase().trim();
    // The chk_content_type constraint rejects {platform=twitter, content_type=post}
    // and {platform=instagram, content_type=post}. The app surfaces 'post' as the
    // generic source content type; remap it to the platform-native value before
    // writing so the update doesn't blow up on the constraint.
    if (normalizedContentType === 'post') {
      const { data: existing } = await ownedDbTable('scheduled_posts')
        .select('platform')
        .eq('id', input.id)
        .eq('user_id', input.userId)
        .maybeSingle();
      const existingPlatform = String((existing as any)?.platform || '').toLowerCase().trim();
      if (existingPlatform === 'twitter') normalizedContentType = 'tweet';
      else if (existingPlatform === 'instagram') normalizedContentType = 'feed_post';
    }
    patch.content_type = normalizedContentType;
  }
  patch.updated_at = new Date().toISOString();

  const { error } = await ownedDbTable('scheduled_posts')
    .update(patch)
    .eq('id', input.id)
    .eq('user_id', input.userId);

  if (error) throw new BoltError(
    BOLT_ERROR_CODES.SCHEDULED_POST_PERSISTENCE_FAILED,
    `Failed to update post: ${error.message}`,
    { cause: error, details: { db_error: error.message, op: 'update' } }
  );
}

export async function cancelLegacyScheduledPost(input: { userId: string; id: string }): Promise<void> {
  const { error } = await ownedDbTable('scheduled_posts')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', input.id)
    .eq('user_id', input.userId);

  if (error) throw new BoltError(
    BOLT_ERROR_CODES.SCHEDULED_POST_PERSISTENCE_FAILED,
    `Failed to cancel post: ${error.message}`,
    { cause: error, details: { db_error: error.message, op: 'cancel' } }
  );
}

export async function publishLegacyScheduledPostNow(input: { userId: string; id: string }): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await ownedDbTable('scheduled_posts')
    .update({ status: 'scheduled', scheduled_for: now, updated_at: now })
    .eq('id', input.id)
    .eq('user_id', input.userId);

  if (error) throw new BoltError(
    BOLT_ERROR_CODES.SCHEDULED_POST_PERSISTENCE_FAILED,
    `Failed to queue post: ${error.message}`,
    { cause: error, details: { db_error: error.message, op: 'queue' } }
  );
}


