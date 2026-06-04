import { ownedDbTable } from '../../db/writeOwner';
/**
 * BOLT Content Job Processor
 *
 * Processes one topic group per BullMQ job:
 *   1. Check master_content_cache (skip LLM if hit)
 *   2. Generate master content (LLM call)
 *   3. Cache master result
 *   4. Generate platform variants for all platforms in one call
 *   5. INSERT to scheduled_posts immediately for each platform
 *   6. UPDATE platform_content_slots status → ready
 *   7. UPDATE bolt_content_jobs status → done
 *   8. Increment bolt_execution_runs progress counters
 *
 * Job payload (BoltContentJobData):
 *   run_id, campaign_id, bolt_job_id, topic, content_type,
 *   daily_plan_ids, enriched, platform_targets, campaign (meta),
 *   account_map, type_map_by_platform
 *
 * Retry behaviour:
 *   - If master already in job row (previous attempt cached it), skip LLM
 *   - If variants already in job row, skip variant generation
 *   - Always re-attempt scheduling (INSERT is idempotent via conflict check)
 */

import { Job } from 'bullmq';
import { createHash } from 'crypto';
import { supabase } from '../../db/supabaseClient';

import { enqueueScheduledPostAt } from '../../scheduler/schedulerService';
import {
  generateMasterContentFromIntent,
  buildPlatformVariantsFromMaster,
} from '../../services/contentGenerationPipeline';
import {
  emitTypeIntegrityTelemetry,
  resolveLogicalContentType,
} from '../../../lib/shared/contentTypeIntegrity';
import { validatePollStructure } from '../../../lib/shared/pollStructureValidator';
import { validateArticleStructure } from '../../../lib/shared/articleStructureValidator';
import { validateThreadStructure } from '../../../lib/shared/threadStructureValidator';
import { validatePostBodyQuality } from '../../../lib/shared/postBodyQualityValidator';
import { validateStoryStructure } from '../../../lib/shared/storyStructureValidator';
import { evaluateGenerationAcceptance } from '../../../lib/shared/generationAcceptanceEvaluator';
import { updateExecutionContentByActivity } from '../../services/orchestration';
import { selectPlannerGenerationInput } from '../../../lib/shared/plannerGenerationInputSelector';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PlatformTarget = {
  platform: string;
  content_type: string;
  logical_content_type?: string;
};

export type BoltContentJobData = {
  run_id: string;
  campaign_id: string;
  bolt_job_id: string;
  topic: string;
  content_type: string;
  daily_plan_ids: string[];
  /** Merged enriched content object from daily_content_plans.content */
  enriched: Record<string, unknown>;
  platform_targets: PlatformTarget[];
  campaign: {
    start_date: string;
    user_id: string;
    company_id: string | null;
  };
  /** platform → social_account_id */
  account_map: Record<string, string>;
  /** platform → content_type → db_content_type */
  type_map_by_platform: Record<string, Record<string, string>>;
};

// ---------------------------------------------------------------------------
// Constants (mirrors boltScheduleBlockProcessor)
// ---------------------------------------------------------------------------

const BLOG_CONTENT_TYPES = new Set(['blog', 'article', 'newsletter', 'white_paper', 'short_story']);

const PLATFORM_ORDER = ['linkedin', 'facebook', 'instagram', 'x', 'twitter', 'youtube', 'tiktok', 'pinterest'];

const FALLBACK_CT_MAP: Record<string, Record<string, string>> = {
  linkedin:  { post: 'post', video: 'video', article: 'article', newsletter: 'newsletter', short_story: 'article', white_paper: 'article', poll: 'post', carousel: 'post', image: 'post', reel: 'video', short: 'video', story: 'post', thread: 'post', blog: 'article' },
  x:         { post: 'tweet', video: 'video', article: 'tweet', newsletter: 'tweet', short_story: 'tweet', white_paper: 'tweet', poll: 'tweet', carousel: 'tweet', image: 'tweet', reel: 'video', short: 'video', story: 'tweet', thread: 'thread', blog: 'tweet' },
  twitter:   { post: 'tweet', video: 'video', article: 'tweet', newsletter: 'tweet', short_story: 'tweet', white_paper: 'tweet', poll: 'tweet', carousel: 'tweet', image: 'tweet', reel: 'video', short: 'video', story: 'tweet', thread: 'thread', blog: 'tweet' },
  instagram: { post: 'feed_post', video: 'reel', article: 'feed_post', newsletter: 'feed_post', short_story: 'feed_post', white_paper: 'feed_post', poll: 'feed_post', carousel: 'feed_post', image: 'feed_post', reel: 'reel', short: 'reel', story: 'story', thread: 'feed_post', blog: 'feed_post' },
  youtube:   { post: 'video', video: 'video', article: 'video', newsletter: 'video', short_story: 'video', white_paper: 'video', poll: 'video', carousel: 'short', image: 'video', reel: 'short', short: 'short', story: 'video', thread: 'video', blog: 'video' },
  facebook:  { post: 'post', video: 'video', article: 'post', newsletter: 'post', short_story: 'post', white_paper: 'post', poll: 'post', carousel: 'post', image: 'post', reel: 'video', short: 'video', story: 'post', thread: 'post', blog: 'post' },
  tiktok:    { post: 'video', video: 'video', article: 'video', newsletter: 'video', short_story: 'video', white_paper: 'video', poll: 'video', carousel: 'video', image: 'video', reel: 'video', short: 'video', story: 'video', thread: 'video', blog: 'video' },
  pinterest: { post: 'pin', video: 'pin', article: 'pin', newsletter: 'pin', short_story: 'pin', white_paper: 'pin', poll: 'pin', carousel: 'pin', image: 'pin', reel: 'pin', short: 'pin', story: 'pin', thread: 'pin', blog: 'pin' },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isPlaceholder(text: string): boolean {
  const t = String(text || '').trim();
  if (!t) return true;
  return (
    /^\s*content for\b/i.test(t) ||
    /^\s*content placeholder\b/i.test(t) ||
    /^\s*execution job content placeholder\b/i.test(t) ||
    t.startsWith('[PLATFORM ADAPTATION FAILED]') ||
    t.startsWith('[MASTER GENERATION FAILED') ||
    t.startsWith('[MASTER CONTENT PLACEHOLDER]') ||
    t.startsWith('[PLATFORM MEDIA BLUEPRINT]') ||
    t.startsWith('[MEDIA BLUEPRINT]')
  );
}

// Phase D — platform-name normalization converged onto the canonical helper.
// Content-type normalization deferred (see boltScheduleBlockProcessor).
import { canonicalizePlatformForDb } from '../../scheduler/schedulingNormalization';
function toDbPlatform(p: string): string {
  return canonicalizePlatformForDb(p);
}

function toDbContentType(
  platform: string,
  contentType: string,
  typeMapByPlatform: Record<string, Record<string, string>>
): string {
  const ct = String(contentType || '').toLowerCase().trim();
  const fromDb = typeMapByPlatform[platform];
  if (fromDb?.[ct]) return fromDb[ct];
  const fallback = FALLBACK_CT_MAP[platform] ?? FALLBACK_CT_MAP['linkedin']!;
  return (fallback as Record<string, string>)[ct] ?? 'post';
}

function buildScheduledFor(dateStr: string, timeStr: string | null | undefined): Date {
  const time = String(timeStr ?? '09:00').trim();
  const hhmm = time.match(/^(\d{1,2}):(\d{2})/);
  const hours   = hhmm ? Math.min(23, Math.max(0, Number(hhmm[1]))) : 9;
  const minutes = hhmm ? Math.min(59, Math.max(0, Number(hhmm[2]))) : 0;
  const d = String(dateStr ?? '').slice(0, 10);
  if (!d) return new Date();
  return new Date(Date.UTC(
    parseInt(d.slice(0, 4), 10),
    parseInt(d.slice(5, 7), 10) - 1,
    parseInt(d.slice(8, 10), 10),
    hours, minutes, 0
  ));
}

function buildBlogSlug(topic: string): string {
  const base = topic
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 70) || 'article';
  return `${base}-${Date.now().toString(36)}`;
}

function buildTopicHash(topic: string, companyId: string | null): string {
  return createHash('sha256')
    .update(`${String(companyId ?? '')}::${topic.toLowerCase().trim()}`)
    .digest('hex');
}

function tryParseJson<T>(v: unknown): T | null {
  if (v == null) return null;
  if (typeof v === 'string') { try { return JSON.parse(v) as T; } catch { return null; } }
  return typeof v === 'object' ? (v as T) : null;
}

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

async function getCachedMaster(
  companyId: string | null,
  topic: string
): Promise<string | null> {
  if (!companyId) return null;
  try {
    const hash = buildTopicHash(topic, companyId);
    const { data } = await ownedDbTable('master_content_cache')
      .select('master_content, expires_at')
      .eq('company_id', companyId)
      .eq('topic_hash', hash)
      .maybeSingle();
    if (!data) return null;
    if (data.expires_at && new Date(data.expires_at) < new Date()) return null;
    // Increment hit count (fire-and-forget)
    void ownedDbTable('master_content_cache')
      .update({ hit_count: (data as any).hit_count + 1 })
      .eq('company_id', companyId)
      .eq('topic_hash', hash);
    return data.master_content ?? null;
  } catch {
    return null;
  }
}

async function cacheMaster(
  companyId: string | null,
  topic: string,
  masterContent: string
): Promise<void> {
  if (!companyId || !masterContent) return;
  try {
    const hash = buildTopicHash(topic, companyId);
    await ownedDbTable('master_content_cache').upsert(
      {
        company_id:     companyId,
        topic_hash:     hash,
        topic_title:    topic,
        master_content: masterContent,
        generated_at:   new Date().toISOString(),
        expires_at:     null,
        hit_count:      0,
      },
      { onConflict: 'company_id,topic_hash', ignoreDuplicates: false }
    );
  } catch { /* non-fatal */ }
}

// ---------------------------------------------------------------------------
// bolt_content_jobs status helpers
// ---------------------------------------------------------------------------

async function updateJobStatus(
  boltJobId: string,
  status: string,
  extra: Record<string, unknown> = {}
): Promise<void> {
  try {
    await ownedDbTable('bolt_content_jobs')
      .update({ status, ...extra, updated_at: new Date().toISOString() })
      .eq('id', boltJobId);
  } catch { /* non-fatal */ }
}

async function updateRunProgress(
  runId: string,
  scheduledDelta: number,
  skippedDelta: number
): Promise<void> {
  try {
    // Use RPC to atomically increment counters (avoid read-modify-write race)
    await supabase.rpc('increment_bolt_run_progress', {
      p_run_id:   runId,
      p_scheduled: scheduledDelta,
      p_skipped:   skippedDelta,
    });
  } catch { /* non-fatal — counters are best-effort */ }
}

// ---------------------------------------------------------------------------
// platform_content_slots helpers
// ---------------------------------------------------------------------------

async function markSlotsGenerating(boltJobId: string, dailyPlanIds: string[]): Promise<void> {
  if (!dailyPlanIds.length) return;
  try {
    await ownedDbTable('platform_content_slots')
      .update({ status: 'generating', updated_at: new Date().toISOString() })
      .eq('bolt_job_id', boltJobId)
      .in('daily_plan_id', dailyPlanIds);
  } catch { /* non-fatal */ }
}

async function markSlotReady(
  boltJobId: string,
  dailyPlanId: string,
  scheduledPostId: string | null,
  generatedContent: string
): Promise<void> {
  try {
    await ownedDbTable('platform_content_slots')
      .update({
        status:            'ready',
        generated_content: generatedContent,
        scheduled_post_id: scheduledPostId,
        updated_at:        new Date().toISOString(),
      })
      .eq('bolt_job_id', boltJobId)
      .eq('daily_plan_id', dailyPlanId);
  } catch { /* non-fatal */ }
}

// ---------------------------------------------------------------------------
// Main processor
// ---------------------------------------------------------------------------

/**
 * Priority-6 async billing gate. Mirrors contentGenerationProcessor's
 * withQueueBilling pattern (queue-native exactly-once HOLD across BullMQ
 * retries/replays — no new system, no settlement/retry-orchestration change).
 * OFF (default) = byte-identical passthrough. SHADOW = passthrough +
 * telemetry. ENFORCE = withQueueBilling reservation lifecycle. No org →
 * nothing billable → passthrough (honest, like the nullable-org HTTP routes).
 */
export async function processBoltContentJob(job: Job): Promise<void> {
  const d = job.data as BoltContentJobData;
  const orgId = d?.campaign?.company_id ? String(d.campaign.company_id) : null;
  if (!orgId) return processBoltContentJobInner(job);

  // Phase 8G-A — credit-economy shadow (dark, fire-and-forget; never blocks/mutates).
  void import('../../services/billing/creditEconomyShadow')
    .then((m) => m.emitCreditEconomyShadowEvaluation({ organizationId: orgId, activity: 'content_generation', surface: 'queue.bolt-content', dedupeKey: String(d.bolt_job_id ?? job.id ?? d.run_id) }))
    .catch(() => {});

  // Phase 11D — admission boundary (single call; dark by default → passthrough,
  // no wallet read; shadow-observes / enforce-blocks once configured).
  await (await import('../../services/billing/admissionControl')).evaluateActivityAdmission({
    organizationId: orgId,
    activity:       'content_generation',
    surface:        'queue.bolt-content',
    referenceId:    String(d.bolt_job_id ?? job.id ?? d.run_id),
  });

  const { resolveEnforcementMode } = await import('../../services/billing/phase2EnforcementGate');
  const { mode } = await resolveEnforcementMode(orgId, 'queue.bolt-content');

  if (mode !== 'enforce') {
    if (mode === 'shadow') {
      const { incrCounter } = await import('../../services/billing/billingMetrics');
      incrCounter('phase2_gate_shadow_total');
    }
    return processBoltContentJobInner(job);
  }

  // Phase 10C — token-actual entry-consumption when enabled (default OFF →
  // existing path). Actual tokens collected via AsyncLocalStorage across the
  // master+variant generation; settled token-actual; entry kept + exposure
  // released on abandonment. Replay-safe via deterministic idem key.
  const { executeWithEntryConsumption, makeIdempotencyKey } =
    await import('../../services/creditExecutionService');
  const { getCreditEconomyExecutionMode } = await import('../../services/billing/creditEconomyActivation');
  if ((await getCreditEconomyExecutionMode({ organizationId: orgId, surface: 'queue.bolt-content' })) === 'enforce') {
    const referenceId = String(d.bolt_job_id ?? job.id ?? d.run_id);
    // Phase 12E — engine-owned usage scope; entry consumed at the first provider
    // call across the master+variant generation.
    await executeWithEntryConsumption<void>({
      userId:              String(d.campaign?.user_id ?? orgId),
      orgId,
      action:              'content_generation',
      referenceType:       'bolt_content_job',
      referenceId,
      idempotencyKey:      makeIdempotencyKey(orgId, 'content_generation', referenceId),
      validateMembership:  false,
      llmPricing:          { provider: 'openai', model: process.env.OPENAI_MODEL || 'gpt-4o-mini', actionKey: 'content_generation', maxInputTokens: 8000, maxOutputTokens: 4000 },
      collectViaCollector: true,
      executor:            () => processBoltContentJobInner(job),
    });
    return;
  }

  const { withQueueBilling } = await import('../../services/billing/queueBillingMiddleware');
  const wrapped = await withQueueBilling(
    {
      queueName:      'bolt-content',
      jobId:          String(job.id ?? d.bolt_job_id ?? `inline-${Date.now()}`),
      payload:        { bolt_job_id: d.bolt_job_id, run_id: d.run_id, content_type: d.content_type },
      organizationId: orgId,
      userId:         String(d.campaign?.user_id ?? orgId),
      action:         'content_generation',
      referenceType:  'bolt_content_job',
      referenceId:    String(d.bolt_job_id ?? job.id ?? d.run_id),
    },
    () => processBoltContentJobInner(job),
  );
  if (wrapped.kind === 'duplicate_blocked') {
    const { incrCounter } = await import('../../services/billing/billingMetrics');
    incrCounter('queue_replay_blocked_total');
  }
}

async function processBoltContentJobInner(job: Job): Promise<void> {
  const data = job.data as BoltContentJobData;
  const {
    run_id,
    campaign_id,
    bolt_job_id,
    topic,
    content_type,
    daily_plan_ids,
    enriched,
    platform_targets,
    campaign,
    account_map,
    type_map_by_platform,
  } = data;

  const companyId = campaign.company_id ?? null;
  const userId    = campaign.user_id;
  const logicalContentType = resolveLogicalContentType({
    logical: enriched.logical_content_type,
    contentType: content_type,
  });
  emitTypeIntegrityTelemetry({
    logicalType: logicalContentType,
    publishType: content_type,
    phase: 'generation',
    source: 'boltContentJobProcessor',
  });
  const generationInputSelection = selectPlannerGenerationInput({
    originalTitle: String(enriched.original_title ?? enriched.title ?? topic),
    originalTopic: String(enriched.original_topic ?? enriched.topic ?? topic),
    contentType: logicalContentType,
    platform: platform_targets[0]?.platform,
    metadata: enriched,
    source: 'boltContentJobProcessor',
  });
  const generationTopic = generationInputSelection.generation_input_topic || generationInputSelection.generation_input_title || topic;
  const generationTitle = generationInputSelection.generation_input_title || generationTopic;

  console.log('[bolt-job] START', { bolt_job_id, topic, content_type, platforms: platform_targets.map((t) => t.platform) });

  // ── 1. Update job status → generating_master ────────────────────────────
  await updateJobStatus(bolt_job_id, 'generating_master', { started_at: new Date().toISOString(), attempt_count: (job.attemptsMade ?? 0) + 1 });
  await markSlotsGenerating(bolt_job_id, daily_plan_ids);
  void job.updateProgress(10);

  // ── 2. Resolve master content ──────────────────────────────────────────
  // Priority: existing cached in job row > content cache > LLM
  let masterContent: string;
  let masterId: string;

  // Check if a previous attempt already generated master (stored in job row)
  const existingJobRow = await ownedDbTable('bolt_content_jobs')
    .select('master_content, master_id')
    .eq('id', bolt_job_id)
    .maybeSingle()
    .then((r) => r.data);

  const jobRowMaster = existingJobRow?.master_content ?? null;
  const cachedMaster = jobRowMaster ?? await getCachedMaster(companyId, topic);

  if (cachedMaster && !isPlaceholder(cachedMaster)) {
    masterContent = cachedMaster;
    masterId = existingJobRow?.master_id ?? `cached-${bolt_job_id}`;
    console.log('[bolt-job] master from cache', { topic, preview: masterContent.slice(0, 80) });
  } else {
    const existingContent = String(enriched.generated_content ?? '').trim();
    if (existingContent && !isPlaceholder(existingContent)) {
      masterContent = existingContent;
      masterId = `existing-${bolt_job_id}`;
      console.log('[bolt-job] master reused from enriched content', { topic });
    } else {
      // LLM call
      const intent = tryParseJson<Record<string, unknown>>(enriched.intent) ?? {};
      const brief  = tryParseJson<Record<string, unknown>>(enriched.writer_content_brief ?? enriched.writerBrief) ?? {};
      const item = {
        execution_id: String(enriched.execution_id ?? enriched.id ?? `topic-${topic.slice(0, 30).replace(/\s/g, '-')}`),
        topic: generationTopic,
        title: generationTitle,
        original_topic: generationInputSelection.original_topic,
        original_title: generationInputSelection.original_title,
        generation_input_topic: generationTopic,
        generation_input_title: generationTitle,
        company_id: companyId,
        campaign_id,
        // Activity-consumption correlation (Phase 1): tie every child LLM/media
        // row to this BOLT run so all consumption aggregates by reference_id.
        correlation: { referenceType: 'bolt_run', referenceId: run_id ?? campaign_id, parentActivityId: campaign_id },
        intent: {
          objective:       enriched.dailyObjective     ?? intent.objective       ?? 'Educate and engage the audience',
          pain_point:      enriched.whatProblemAreWeAddressing ?? intent.pain_point ?? 'Audience challenge',
          outcome_promise: enriched.whatShouldReaderLearn      ?? intent.outcome_promise ?? 'Clear value',
          cta_type:        enriched.desiredAction       ?? intent.cta_type        ?? 'Soft engagement',
          target_audience: enriched.whoAreWeWritingFor  ?? intent.target_audience ?? 'Professional audience',
        },
        writer_content_brief: {
          topicTitle:                 generationTitle,
          writingIntent:              (enriched.writingIntent             ?? brief.writingIntent             ?? enriched.dailyObjective ?? '') as string,
          whatShouldReaderLearn:      (enriched.whatShouldReaderLearn     ?? brief.whatShouldReaderLearn     ?? '') as string,
          whatProblemAreWeAddressing: (enriched.whatProblemAreWeAddressing ?? brief.whatProblemAreWeAddressing ?? '') as string,
          desiredAction:              (enriched.desiredAction             ?? brief.desiredAction             ?? '') as string,
          narrativeStyle:             (enriched.narrativeStyle            ?? brief.narrativeStyle            ?? '') as string,
          topicGoal:                  (enriched.dailyObjective            ?? brief.topicGoal                 ?? '') as string,
        },
        content_type: logicalContentType as any,
        logical_content_type: logicalContentType,
        editor_grade_results: {
          ...(enriched.editor_grade_results && typeof enriched.editor_grade_results === 'object'
            ? enriched.editor_grade_results as Record<string, unknown>
            : {}),
          generation_input_selection: generationInputSelection,
        },
        active_platform_targets: platform_targets,
      } as Parameters<typeof generateMasterContentFromIntent>[0];

      // Closure Pass — Phase 4. Enrich item with governance before
      // pipeline call.
      const { enrichItemWithGovernance } = await import('../../services/creator/governanceItemEnricher');
      const governedItem = await enrichItemWithGovernance(item as any) as typeof item;
      const master = await generateMasterContentFromIntent(governedItem);
      masterContent = master.content;
      masterId = master.id;
      console.log('[bolt-job] master generated via LLM', { topic, masterId, preview: masterContent.slice(0, 80) });
    }

    // Cache master for future campaigns
    await cacheMaster(companyId, topic, masterContent);
  }

  // Store master in job row so retries don't regenerate it
  await updateJobStatus(bolt_job_id, 'generating_variants', {
    master_content: masterContent,
    master_id:      masterId,
  });
  void job.updateProgress(40);

  // ── 3. Blog entry for long-form types ─────────────────────────────────
  const isLongForm = BLOG_CONTENT_TYPES.has(content_type);
  if (isLongForm && masterContent && !isPlaceholder(masterContent) && companyId && userId) {
    try {
      const firstPlanId = daily_plan_ids[0];
      let datePart = '';
      if (firstPlanId) {
        const { data: dp } = await ownedDbTable('daily_content_plans')
          .select('date')
          .eq('id', firstPlanId)
          .maybeSingle();
        datePart = String(dp?.date ?? '').slice(0, 10);
      }
      const scheduledDate = datePart
        ? new Date(`${datePart}T09:00:00Z`).toISOString()
        : new Date().toISOString();
      const category = content_type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      const { error: blogErr } = await ownedDbTable('blogs').insert({
        company_id:       companyId,
        title:            topic,
        slug:             buildBlogSlug(topic),
        content_markdown: masterContent,
        status:           'scheduled',
        published_at:     scheduledDate,
        created_by:       userId,
        category,
      });
      if (blogErr) console.warn('[bolt-job] Blog insert failed:', blogErr.message);
    } catch (e) {
      console.warn('[bolt-job] Blog creation error:', (e as Error)?.message);
    }
  }

  // ── 4. Build platform variants ─────────────────────────────────────────
  // Check if variants already generated in a previous attempt
  const existingVariantsJson = ((existingJobRow as any)?.variants_json as Record<string, string> | null) ?? null;
  let variantByKey: Map<string, string>;

  if (existingVariantsJson && Object.keys(existingVariantsJson).length > 0) {
    variantByKey = new Map(Object.entries(existingVariantsJson));
    console.log('[bolt-job] variants from previous attempt', { count: variantByKey.size });
  } else {
    const intent = tryParseJson<Record<string, unknown>>(enriched.intent) ?? {};
    const brief  = tryParseJson<Record<string, unknown>>(enriched.writer_content_brief ?? enriched.writerBrief) ?? {};
    const itemForVariants = {
      execution_id: String(enriched.execution_id ?? `topic-${topic.slice(0, 30).replace(/\s/g, '-')}`),
      topic: generationTopic,
      title: generationTitle,
      original_topic: generationInputSelection.original_topic,
      original_title: generationInputSelection.original_title,
      generation_input_topic: generationTopic,
      generation_input_title: generationTitle,
      company_id: companyId,
      campaign_id,
      correlation: { referenceType: 'bolt_run', referenceId: run_id ?? campaign_id, parentActivityId: campaign_id },
      intent: {
        objective: enriched.dailyObjective ?? intent.objective ?? 'Educate and engage the audience',
        pain_point: enriched.whatProblemAreWeAddressing ?? intent.pain_point ?? 'Audience challenge',
        outcome_promise: enriched.whatShouldReaderLearn ?? intent.outcome_promise ?? 'Clear value',
        cta_type: enriched.desiredAction ?? intent.cta_type ?? 'Soft engagement',
        target_audience: enriched.whoAreWeWritingFor ?? intent.target_audience ?? 'Professional audience',
      },
      writer_content_brief: {
        topicTitle: generationTitle,
        writingIntent: (enriched.writingIntent ?? brief.writingIntent ?? '') as string,
        whatShouldReaderLearn: (enriched.whatShouldReaderLearn ?? brief.whatShouldReaderLearn ?? '') as string,
        whatProblemAreWeAddressing: (enriched.whatProblemAreWeAddressing ?? brief.whatProblemAreWeAddressing ?? '') as string,
        desiredAction: (enriched.desiredAction ?? brief.desiredAction ?? '') as string,
        narrativeStyle: (enriched.narrativeStyle ?? brief.narrativeStyle ?? '') as string,
        topicGoal: (enriched.dailyObjective ?? brief.topicGoal ?? '') as string,
      },
      content_type: logicalContentType as any,
      logical_content_type: logicalContentType,
      editor_grade_results: {
        ...(enriched.editor_grade_results && typeof enriched.editor_grade_results === 'object'
          ? enriched.editor_grade_results as Record<string, unknown>
          : {}),
        generation_input_selection: generationInputSelection,
      },
      active_platform_targets: platform_targets,
      master_content: {
        id: masterId,
        content: masterContent,
        generation_status: 'generated',
        logical_content_type: logicalContentType,
        generation_input_selection: generationInputSelection,
        decision_trace: { source_topic: generationTopic },
      },
    } as unknown as Parameters<typeof generateMasterContentFromIntent>[0];

    variantByKey = new Map<string, string>();
    try {
      // Closure Pass — Phase 4. Enrich item with governance.
      const { enrichItemWithGovernance } = await import('../../services/creator/governanceItemEnricher');
      const governedVariantsItem = await enrichItemWithGovernance(itemForVariants as any) as typeof itemForVariants;
      const variants = await buildPlatformVariantsFromMaster(governedVariantsItem as unknown as Parameters<typeof generateMasterContentFromIntent>[0]);
      for (const v of variants) {
        const vp  = String(v.platform   || '').toLowerCase();
        const vct = String(v.content_type || '').toLowerCase();
        // Normalise 'twitter' → 'x' so lookup matches canonical platform keys
        const normVp = vp === 'twitter' ? 'x' : vp;
        if (
          v.generated_content &&
          !v.generated_content.startsWith('[PLATFORM ADAPTATION FAILED]') &&
          !v.generated_content.startsWith('[PLATFORM MEDIA BLUEPRINT]')
        ) {
          variantByKey.set(`${normVp}::${vct}`, v.generated_content);
          if (vp !== normVp) variantByKey.set(`${vp}::${vct}`, v.generated_content); // alias
        }
      }
      // Persist variants in job row so retries skip this step
      const variantsObj: Record<string, string> = {};
      variantByKey.forEach((v, k) => { variantsObj[k] = v; });
      await updateJobStatus(bolt_job_id, 'scheduling', { variants_json: variantsObj });
    } catch (variantErr) {
      console.warn('[bolt-job] Variant generation failed, using master for all platforms:', (variantErr as Error)?.message);
      await updateJobStatus(bolt_job_id, 'scheduling');
    }
  }

  void job.updateProgress(70);

  // ── 5. Insert scheduled_posts for each platform ────────────────────────
  const masterValid = Boolean(masterContent) && !isPlaceholder(masterContent);
  let scheduled = 0;
  let skipped   = 0;
  const scheduledPostIds: string[] = [];

  // Fetch daily_content_plans rows for date/time/repurpose info
  const { data: planRows } = await ownedDbTable('daily_content_plans')
    .select('id, platform, content_type, date, scheduled_time, content, week_number')
    .in('id', daily_plan_ids);

  const planRowMap = new Map((planRows ?? []).map((r: any) => [r.id, r]));

  // Sort by PLATFORM_ORDER for deterministic repurpose indexing
  const orderedTargets = [...platform_targets].sort((a, b) => {
    const ia = PLATFORM_ORDER.indexOf(a.platform);
    const ib = PLATFORM_ORDER.indexOf(b.platform);
    return (ia >= 0 ? ia : 999) - (ib >= 0 ? ib : 999);
  });

  const totalDistributions = orderedTargets.length;

  for (let i = 0; i < orderedTargets.length; i++) {
    const target = orderedTargets[i]!;
    // target.platform is the canonical key (e.g. 'linkedin', 'x', 'instagram')
    // set by queueBoltContentJobs after normalize(). Use it directly for account_map.
    const canonicalPlatform = target.platform;

    const socialAccountId = account_map[canonicalPlatform];
    if (!socialAccountId) {
      console.warn('[bolt-job] SKIP — no social account', {
        canonicalPlatform, topic,
        availableKeys: Object.keys(account_map),
      });
      skipped++;
      continue;
    }

    // Variant lookup: try canonical key first, then 'twitter' alias for 'x'
    const variantKey      = `${canonicalPlatform}::${target.content_type}`;
    const variantKeyAlias = canonicalPlatform === 'x' ? `twitter::${target.content_type}` : null;
    const content = variantByKey.get(variantKey)
      ?? (variantKeyAlias ? variantByKey.get(variantKeyAlias) : undefined)
      ?? (masterValid ? masterContent : null);

    if (!content || isPlaceholder(content)) {
      console.warn('[bolt-job] SKIP — no valid content', { canonicalPlatform, topic, variantKey });
      skipped++;
      continue;
    }

    // Find the matching daily_plan row for date/time.
    // DB stores raw platform values — match after normalizing both sides.
    const planRow = daily_plan_ids
      .map((id) => planRowMap.get(id))
      .find((r: any) => {
        if (!r) return false;
        const rawDb = String(r.platform || '').toLowerCase().trim();
        // canonical 'x' matches db values 'x' or 'twitter'
        if (canonicalPlatform === 'x') return rawDb === 'x' || rawDb === 'twitter';
        return rawDb === canonicalPlatform;
      });

    const dateStr     = String((planRow as any)?.date ?? campaign.start_date ?? '').slice(0, 10);
    const timeStr     = (planRow as any)?.scheduled_time ?? null;
    const dailyPlanId = (planRow as any)?.id ?? null;
    const scheduledFor = buildScheduledFor(dateStr, timeStr);
    // For DB content_type, use canonical platform (not 'x' alias)
    const dbPlatform    = toDbPlatform(canonicalPlatform);
    const targetLogicalContentType = resolveLogicalContentType({
      logical: target.logical_content_type,
      contentType: target.content_type,
    });
    const dbContentType = toDbContentType(dbPlatform, target.content_type, type_map_by_platform);
    emitTypeIntegrityTelemetry({
      logicalType: targetLogicalContentType,
      publishType: dbContentType,
      phase: 'scheduling',
      source: 'boltContentJobProcessor.scheduleInsert',
    });

    const { data: inserted, error: insertError } = await ownedDbTable('scheduled_posts')
      .insert({
        user_id:           userId,
        social_account_id: socialAccountId,
        campaign_id,
        platform:          dbPlatform,
        content_type:      dbContentType,
        title:             topic || undefined,
        content,
        scheduled_for:     scheduledFor.toISOString(),
        status:            'scheduled',
        repurpose_index:   i + 1,
        repurpose_total:   totalDistributions,
        created_at:        new Date().toISOString(),
        updated_at:        new Date().toISOString(),
      })
      .select('id')
      .maybeSingle();

    if (insertError) {
      console.warn('[bolt-job] INSERT failed', { platform: canonicalPlatform, topic, error: insertError.message });
      skipped++;
      continue;
    }

    const scheduledPostId = (inserted as any)?.id ?? null;
    if (scheduledPostId) {
      scheduledPostIds.push(scheduledPostId);
      try {
        await enqueueScheduledPostAt(
          String(scheduledPostId),
          String(userId),
          String(socialAccountId),
          scheduledFor.toISOString(),
        );
      } catch (enqueueError: any) {
        console.warn('[bolt-job] enqueueScheduledPostAt failed (non-fatal):', enqueueError?.message);
      }
    }

    // Update platform_content_slot
    if (dailyPlanId) {
      await markSlotReady(bolt_job_id, dailyPlanId, scheduledPostId, content);

      // Update daily_content_plans.content with finalized JSON
      try {
        const rowParsed = tryParseJson<Record<string, unknown>>((planRow as any)?.content) ?? {};
        const rowLogicalContentType = resolveLogicalContentType({
          logical: rowParsed.logical_content_type,
          contentType: logicalContentType,
        });
        const schedulingPollStructure = validatePollStructure({
          title: String(rowParsed.title || rowParsed.topic || topic || ''),
          content,
          logicalContentType: rowLogicalContentType,
          platform: canonicalPlatform,
          phase: 'scheduling',
          source: 'boltContentJobProcessor.finalizedJson',
        });
        const schedulingArticleStructure = validateArticleStructure({
          title: String(rowParsed.title || rowParsed.topic || topic || ''),
          content,
          logicalContentType: rowLogicalContentType,
          platform: canonicalPlatform,
          phase: 'scheduling',
          source: 'boltContentJobProcessor.finalizedJson',
        });
        const schedulingThreadStructure = validateThreadStructure({
          title: String(rowParsed.title || rowParsed.topic || topic || ''),
          content,
          logicalContentType: rowLogicalContentType,
          platform: canonicalPlatform,
          phase: 'scheduling',
          source: 'boltContentJobProcessor.finalizedJson',
        });
        const schedulingPostBodyQuality = validatePostBodyQuality({
          title: String(rowParsed.title || rowParsed.topic || topic || ''),
          content,
          logicalContentType: rowLogicalContentType,
          platform: canonicalPlatform,
          phase: 'scheduling',
          source: 'boltContentJobProcessor.finalizedJson',
        });
        const schedulingStoryStructure = validateStoryStructure({
          title: String(rowParsed.title || rowParsed.topic || topic || ''),
          content,
          logicalContentType: rowLogicalContentType,
          platform: canonicalPlatform,
          phase: 'scheduling',
          source: 'boltContentJobProcessor.finalizedJson',
        });
        const generationAcceptance = evaluateGenerationAcceptance({
          title: String(rowParsed.title || rowParsed.topic || topic || ''),
          content,
          logicalContentType: rowLogicalContentType,
          publishContentType: dbContentType,
          platform: canonicalPlatform,
          phase: 'scheduling',
          source: 'boltContentJobProcessor.finalizedJson',
          editorGradeResults: [schedulingPollStructure, schedulingArticleStructure, schedulingThreadStructure, schedulingPostBodyQuality, schedulingStoryStructure],
          metadata: rowParsed.editor_grade_results,
        });
        // D1: route finalization through the reconciled write path (same merge
        // used by approval persistence) so a concurrent reviewer decision cannot
        // be clobbered. The transform receives the FRESH persisted blob; we carry
        // it forward (...existing) and reconcileContentWrite + PROTECTED_ENRICHMENTS
        // preserve editor_grade_approval / review_history / governance.
        const finalizedAt = new Date().toISOString();
        await updateExecutionContentByActivity(
          String(dailyPlanId),
          (existing) => {
            const existingEgr =
              existing.editor_grade_results && typeof existing.editor_grade_results === 'object'
                ? existing.editor_grade_results as Record<string, unknown>
                : {};
            return {
              ...existing,
              logical_content_type: rowLogicalContentType,
              editor_grade_results: {
                ...existingEgr,
                ...(schedulingPollStructure ? { scheduling_poll_structure: schedulingPollStructure } : {}),
                ...(schedulingArticleStructure ? { scheduling_article_structure: schedulingArticleStructure } : {}),
                ...(schedulingThreadStructure ? { scheduling_thread_structure: schedulingThreadStructure } : {}),
                ...(schedulingPostBodyQuality ? { scheduling_post_body_quality: schedulingPostBodyQuality } : {}),
                ...(schedulingStoryStructure ? { scheduling_story_structure: schedulingStoryStructure } : {}),
                generation_acceptance: generationAcceptance,
              },
              generation_acceptance: generationAcceptance,
              generated_content:    content,
              master_content:       {
                id: masterId,
                content: masterContent,
                logical_content_type: logicalContentType,
                generation_input_selection: generationInputSelection,
              },
              content_status:       'finalized',
              finalized_at:         finalizedAt,
              refinement_status:    'finalized',
              refinement_finalized: true,
              distribution_mode:    totalDistributions > 1 ? 'shared' : 'unique',
              sequence_index:       i + 1,
              total_distributions:  totalDistributions,
            };
          },
          'boltContentJobProcessor.finalizedJson',
        );
      } catch { /* non-fatal */ }
    }

    scheduled++;
    console.log('[bolt-job] scheduled', { platform: canonicalPlatform, topic, scheduledFor: scheduledFor.toISOString() });
  }

  // ── 6. Mark job done ───────────────────────────────────────────────────
  await updateJobStatus(bolt_job_id, 'done', {
    scheduled_post_ids: scheduledPostIds,
    completed_at:       new Date().toISOString(),
  });

  // ── 7. Update run progress counters ───────────────────────────────────
  await updateRunProgress(run_id, scheduled, skipped);

  void job.updateProgress(100);
  console.log('[bolt-job] DONE', { bolt_job_id, topic, scheduled, skipped });
}
