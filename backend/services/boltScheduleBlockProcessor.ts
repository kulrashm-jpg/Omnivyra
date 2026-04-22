/**
 * BOLT Schedule Block Processor
 *
 * Sequential, content-type-block scheduling engine for BOLT Text campaigns.
 *
 * WHY THIS EXISTS:
 * The previous two-phase approach (generateContentForDailyPlans → scheduleFromDailyPlans)
 * generated all content first, then scheduled everything in a single batch insert. If the
 * generation step partially failed, or the in-memory contentMap was lost, the calendar showed
 * only topic placeholders.
 *
 * THIS PROCESSOR:
 * 1. Groups daily plans into content-type blocks (blog/article → newsletter → post → …)
 * 2. Within each block, processes one topic at a time
 * 3. For each topic: generates master content, then repurposes per platform
 * 4. Inserts each platform's scheduled_post IMMEDIATELY — no batch flush at the end
 * 5. Updates daily_content_plans.content before the insert (audit trail)
 * 6. Emits granular progress events so the UI can show real-time status
 *
 * CONTENT-TYPE PRIORITY ORDER (long-form first):
 *   blog → article → white_paper → newsletter → short_story → thread → post → carousel
 *   → image → story → reel → short → video → poll
 *
 * This means blog content is generated before the LinkedIn post that summarises it,
 * so downstream repurposing can reference the canonical article.
 */

import { supabase } from '../db/supabaseClient';
import { enqueueScheduledPostAt } from '../scheduler/schedulerService';
import {
  generateMasterContentFromIntent,
  buildPlatformVariantsFromMaster,
} from './contentGenerationPipeline';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape expected from daily_content_plans table query */
export type BlockDailyPlanRow = {
  id: string;
  campaign_id: string;
  week_number: number;
  day_of_week: string;
  date: string;
  platform: string;
  content_type: string;
  title?: string | null;
  topic?: string | null;
  scheduled_time?: string | null;
  content?: string | null;
};

type ParsedContent = Record<string, unknown> & {
  execution_id?: string;
  source_execution_id?: string;
  master_content_id?: string;
  sequence_index?: number;
  total_distributions?: number;
  distribution_mode?: string;
  generated_content?: string;
};

export type BlockProgressEvent =
  | { phase: 'block-start';     contentType: string; blockIndex: number; totalBlocks: number; activityCount: number }
  | { phase: 'topic-master';    contentType: string; topic: string; reused: boolean }
  | { phase: 'platform-done';   contentType: string; topic: string; platform: string; scheduledFor: string }
  | { phase: 'block-complete';  contentType: string; blockIndex: number; scheduled: number; skipped: number }
  | { phase: 'error';           contentType: string; topic: string; message: string };

export type BlockScheduleOptions = {
  onProgress?: (event: BlockProgressEvent) => void;
};

export type BlockScheduleResult = {
  scheduled_count: number;
  skipped_count: number;
  skipped_platforms: string[];
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Long-form types are processed first so post-repurposing can reference them */
const CONTENT_TYPE_PRIORITY: string[] = [
  'blog', 'article', 'white_paper', 'newsletter', 'short_story',
  'thread', 'post', 'carousel', 'image', 'story', 'reel', 'short', 'video', 'poll',
];

const PLATFORM_ORDER = ['linkedin', 'facebook', 'instagram', 'x', 'twitter', 'youtube', 'tiktok', 'pinterest'];

const BLOG_CONTENT_TYPES = new Set(['blog', 'article', 'newsletter', 'white_paper', 'short_story']);

/** Platform → DB content_type fallback map (mirrors structuredPlanScheduler).
 * Keys include both the strategy-level formats (post/article/short_story/…) AND
 * platform-native types (tweet/feed_post) so that a request like
 * `{ platform: 'instagram', content_type: 'tweet' }` is remapped to Instagram's
 * valid native type (`feed_post`) instead of falling through to 'post' and
 * violating the scheduled_posts chk_content_type constraint. */
const FALLBACK_CT_MAP: Record<string, Record<string, string>> = {
  linkedin:  { post: 'post', tweet: 'post', feed_post: 'post', video: 'video', article: 'article', newsletter: 'newsletter', short_story: 'post', white_paper: 'article', poll: 'post', carousel: 'post', image: 'post', reel: 'video', short: 'video', story: 'post', thread: 'post', blog: 'article' },
  x:         { post: 'tweet', tweet: 'tweet', feed_post: 'tweet', video: 'video', article: 'tweet', newsletter: 'tweet', short_story: 'tweet', white_paper: 'tweet', poll: 'tweet', carousel: 'tweet', image: 'tweet', reel: 'video', short: 'video', story: 'tweet', thread: 'thread', blog: 'tweet' },
  twitter:   { post: 'tweet', tweet: 'tweet', feed_post: 'tweet', video: 'video', article: 'tweet', newsletter: 'tweet', short_story: 'tweet', white_paper: 'tweet', poll: 'tweet', carousel: 'tweet', image: 'tweet', reel: 'video', short: 'video', story: 'tweet', thread: 'thread', blog: 'tweet' },
  instagram: { post: 'feed_post', tweet: 'feed_post', feed_post: 'feed_post', video: 'reel', article: 'feed_post', newsletter: 'feed_post', short_story: 'feed_post', white_paper: 'feed_post', poll: 'feed_post', carousel: 'feed_post', image: 'feed_post', reel: 'reel', short: 'reel', story: 'story', thread: 'feed_post', blog: 'feed_post' },
  youtube:   { post: 'video', tweet: 'video', feed_post: 'video', video: 'video', article: 'video', newsletter: 'video', short_story: 'video', white_paper: 'video', poll: 'video', carousel: 'short', image: 'video', reel: 'short', short: 'short', story: 'video', thread: 'video', blog: 'video' },
  facebook:  { post: 'post', tweet: 'post', feed_post: 'post', video: 'video', article: 'post', newsletter: 'post', short_story: 'post', white_paper: 'post', poll: 'post', carousel: 'post', image: 'post', reel: 'video', short: 'video', story: 'post', thread: 'post', blog: 'post' },
  tiktok:    { post: 'video', tweet: 'video', feed_post: 'video', video: 'video', article: 'video', newsletter: 'video', short_story: 'video', white_paper: 'video', poll: 'video', carousel: 'video', image: 'video', reel: 'video', short: 'video', story: 'video', thread: 'video', blog: 'video' },
  pinterest: { post: 'pin', tweet: 'pin', feed_post: 'pin', video: 'pin', article: 'pin', newsletter: 'pin', short_story: 'pin', white_paper: 'pin', poll: 'pin', carousel: 'pin', image: 'pin', reel: 'pin', short: 'pin', story: 'pin', thread: 'pin', blog: 'pin' },
};

// ---------------------------------------------------------------------------
// Tiny utilities (self-contained — avoids coupling to structuredPlanScheduler)
// ---------------------------------------------------------------------------

function tryParseJson<T>(v: unknown): T | null {
  if (v == null) return null;
  if (typeof v === 'string') { try { return JSON.parse(v) as T; } catch { return null; } }
  return typeof v === 'object' ? (v as T) : null;
}

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

function toDbPlatform(p: string): string {
  return p === 'x' ? 'twitter' : p;
}

function toDbContentType(
  platform: string,
  contentType: string,
  typeMapByPlatform: Record<string, Record<string, string>>
): string {
  const ct = String(contentType || '').toLowerCase().trim();
  const fromDb = typeMapByPlatform[platform];
  if (fromDb?.[ct]) return fromDb[ct];
  const fallback = FALLBACK_CT_MAP[platform] ?? FALLBACK_CT_MAP.linkedin;
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

// ---------------------------------------------------------------------------
// Topic group key (mirrors boltContentGenerationForSchedule)
// ---------------------------------------------------------------------------

function topicGroupKey(row: BlockDailyPlanRow): string {
  const parsed = tryParseJson<ParsedContent>(row.content) ?? {};
  const src  = String(parsed.source_execution_id ?? '').trim();
  const mid  = String(parsed.master_content_id    ?? '').trim();
  const eid  = String(parsed.execution_id         ?? '').trim();
  const topic = String(row.topic || row.title || (parsed as any).topicTitle || '').trim() || 'untitled';
  const week  = Number(row.week_number) || 1;

  if (src) return `shared::${src}::${week}`;
  if (mid) return `master::${mid}::${week}`;
  if (eid) return `unique::${eid}::${week}`;
  return `topic::${topic}::${week}`;
}

// ---------------------------------------------------------------------------
// buildItemFromEnriched (mirrors boltContentGenerationForSchedule)
// ---------------------------------------------------------------------------

function buildItemFromEnriched(
  enriched: Record<string, unknown>,
  platformTargets: Array<{ platform: string; content_type: string }>,
  companyId: string | null
): Record<string, unknown> {
  const topic  = String(enriched.topicTitle ?? enriched.topic ?? enriched.title ?? '').trim() || 'TBD';
  const intent = tryParseJson<Record<string, unknown>>(enriched.intent) ?? {};
  const brief  = tryParseJson<Record<string, unknown>>(enriched.writer_content_brief ?? enriched.writerBrief) ?? {};
  return {
    execution_id: String(enriched.execution_id ?? enriched.id ?? `topic-${topic.slice(0, 30).replace(/\s/g, '-')}`),
    topic,
    title: topic,
    company_id: companyId,
    intent: {
      objective:       enriched.dailyObjective     ?? intent.objective       ?? 'Educate and engage the audience',
      pain_point:      enriched.whatProblemAreWeAddressing ?? intent.pain_point ?? 'Audience challenge relevant to topic',
      outcome_promise: enriched.whatShouldReaderLearn      ?? intent.outcome_promise ?? 'Clear value from this content',
      cta_type:        enriched.desiredAction       ?? intent.cta_type        ?? 'Soft engagement',
      target_audience: enriched.whoAreWeWritingFor  ?? intent.target_audience ?? 'Professional audience',
    },
    writer_content_brief: {
      topicTitle:                topic,
      writingIntent:             (enriched.writingIntent             ?? brief.writingIntent             ?? enriched.dailyObjective ?? '') as string,
      whatShouldReaderLearn:     (enriched.whatShouldReaderLearn     ?? brief.whatShouldReaderLearn     ?? enriched.intro_objective ?? '') as string,
      whatProblemAreWeAddressing:(enriched.whatProblemAreWeAddressing ?? brief.whatProblemAreWeAddressing ?? enriched.summary ?? '') as string,
      desiredAction:             (enriched.desiredAction             ?? brief.desiredAction             ?? enriched.cta ?? '') as string,
      narrativeStyle:            (enriched.narrativeStyle            ?? brief.narrativeStyle            ?? enriched.brand_voice ?? '') as string,
      topicGoal:                 (enriched.dailyObjective            ?? brief.topicGoal                 ?? enriched.objective ?? '') as string,
    },
    content_type: String(enriched.content_type ?? enriched.contentType ?? 'post').toLowerCase(),
    active_platform_targets: platformTargets,
  };
}

// ---------------------------------------------------------------------------
// Blog table entry (long-form types only)
// ---------------------------------------------------------------------------

async function createBlogEntry(
  topic: string,
  masterContent: string,
  date: string,
  contentType: string,
  companyId: string,
  userId: string
): Promise<void> {
  const scheduledDate = date
    ? new Date(`${String(date).slice(0, 10)}T09:00:00Z`).toISOString()
    : new Date().toISOString();
  const category = contentType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const { error } = await supabase.from('blogs').insert({
    company_id:       companyId,
    title:            topic,
    slug:             buildBlogSlug(topic),
    content_markdown: masterContent,
    status:           'scheduled',
    published_at:     scheduledDate,
    created_by:       userId,
    category,
  });
  if (error) console.warn('[block-processor] Blog insert failed:', error.message);
}

// ---------------------------------------------------------------------------
// Pre-compute repurpose_index / repurpose_total for all rows
// ---------------------------------------------------------------------------

function buildRepurposeIndex(plans: BlockDailyPlanRow[]): Map<string, { index: number; total: number }> {
  const map = new Map<string, { index: number; total: number }>();
  const groupKey = (r: BlockDailyPlanRow) =>
    `${String(r.topic || r.title || 'untitled').trim()}|${Number(r.week_number ?? 1) || 1}`;

  const groups = new Map<string, BlockDailyPlanRow[]>();
  for (const r of plans) {
    const k = groupKey(r);
    const list = groups.get(k) ?? [];
    list.push(r);
    groups.set(k, list);
  }

  Array.from(groups.values()).forEach((list) => {
    const total = list.length;
    const ordered = [...list].sort((a, b) => {
      const pa = String(a.platform || '').toLowerCase();
      const pb = String(b.platform || '').toLowerCase();
      const ia = PLATFORM_ORDER.indexOf(pa);
      const ib = PLATFORM_ORDER.indexOf(pb);
      return (ia >= 0 ? ia : 999) - (ib >= 0 ? ib : 999) || pa.localeCompare(pb);
    });
    ordered.forEach((r, i) => map.set(r.id, { index: i + 1, total }));
  });
  return map;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Process BOLT daily plans using a content-type block structure.
 *
 * Blocks are processed in priority order (long-form first). Within each block,
 * topics are processed sequentially. Each topic generates one master then
 * repurposes across platforms. Every platform post is inserted to scheduled_posts
 * immediately after generation — no end-of-run batch flush.
 */
export async function processBlockSchedule(
  campaignId: string,
  dailyPlans: BlockDailyPlanRow[],
  campaign: { start_date: string; user_id: string; company_id?: string | null },
  accountMap: Map<string, string>,
  normalize: (p: string) => string | null,
  typeMapByPlatform: Record<string, Record<string, string>>,
  options?: BlockScheduleOptions
): Promise<BlockScheduleResult> {
  const emit = options?.onProgress;

  // ── 0. Resolve campaign metadata ─────────────────────────────────────────
  // Prefer company_id from caller (already resolved); fall back to DB query.
  let companyId: string | null = campaign.company_id ?? null;
  if (!companyId) {
    try {
      const { data: camp } = await supabase
        .from('campaigns')
        .select('company_id')
        .eq('id', campaignId)
        .maybeSingle();
      companyId = (camp as any)?.company_id ?? null;
    } catch { /* non-fatal */ }
  }

  console.log('[block-processor] START', {
    campaignId,
    companyId,
    dailyPlansCount: dailyPlans.length,
    accountMapKeys: Array.from(accountMap.keys()),
    userId: campaign.user_id,
  });

  // ── 1. Pre-compute repurpose indices ─────────────────────────────────────
  const repurposeIndex = buildRepurposeIndex(dailyPlans);

  // ── 2. ACTIVITY CARD QUEUE ────────────────────────────────────────────────
  // Build a flat queue of activity cards. An "activity card" = one unique
  // (topic, content_type, week) tuple with all platforms that target it.
  // Each card gets ONE master content generation + N platform repurposes.
  // Cards are processed sequentially in date order, and previous masters
  // are tracked to force content diversity (avoid AI producing identical output).
  type ActivityCard = {
    key: string;
    contentType: string;
    topic: string;
    rows: BlockDailyPlanRow[];       // one row per platform
    earliestDate: number;
  };

  const cardMap = new Map<string, ActivityCard>();
  for (const row of dailyPlans) {
    const ct = String(row.content_type || 'post').toLowerCase().trim();
    const topicKey = topicGroupKey(row);
    const cardKey = `${ct}::${topicKey}`;
    const topic = String(row.topic || row.title || '').trim() || 'Untitled';
    const existing = cardMap.get(cardKey);
    const rowDate = new Date(row.date).getTime();
    if (existing) {
      existing.rows.push(row);
      existing.earliestDate = Math.min(existing.earliestDate, rowDate);
    } else {
      cardMap.set(cardKey, {
        key: cardKey,
        contentType: ct,
        topic,
        rows: [row],
        earliestDate: rowDate,
      });
    }
  }

  // Sort activity cards: (1) by date, (2) by CONTENT_TYPE_PRIORITY for tie-break.
  // Date-first ordering means the calendar fills chronologically; priority only
  // matters when two cards share a date (long-form first for repurposing context).
  const activityQueue = Array.from(cardMap.values()).sort((a, b) => {
    if (a.earliestDate !== b.earliestDate) return a.earliestDate - b.earliestDate;
    const ia = CONTENT_TYPE_PRIORITY.indexOf(a.contentType);
    const ib = CONTENT_TYPE_PRIORITY.indexOf(b.contentType);
    return (ia >= 0 ? ia : 999) - (ib >= 0 ? ib : 999);
  });

  const totalCards = activityQueue.length;
  console.log('[block-processor] activity queue',
    activityQueue.map((c) => `${c.contentType}:${c.topic.slice(0, 30)}(${c.rows.length}p)`));
  let totalScheduled = 0;
  let totalSkipped = 0;
  const skippedPlatforms: string[] = [];

  // ── 3. Process each activity card in the queue ───────────────────────────
  // Sequentially, one card at a time. Each card is an atomic unit:
  // (1) generate master content → (2) repurpose for each platform → (3) insert scheduled_post.
  // Every activity's outcome is tracked in `activityResults` with a detailed
  // failure reason if anything goes wrong. No silent skips.
  type ActivityResult = {
    cardIndex: number;
    contentType: string;
    topic: string;
    platforms: string[];
    status: 'succeeded' | 'master_failed' | 'variant_failed' | 'insert_failed' | 'skipped';
    error?: string;
    scheduledCount: number;
  };
  const activityResults: ActivityResult[] = [];
  for (let cardIdx = 0; cardIdx < activityQueue.length; cardIdx++) {
    const card = activityQueue[cardIdx]!;
    const contentType = card.contentType;
    const topicRows = card.rows;

    emit?.({
      phase: 'block-start',
      contentType,
      blockIndex: cardIdx + 1,
      totalBlocks: totalCards,
      activityCount: topicRows.length,
    });

    let blockScheduled = 0;
    let blockSkipped = 0;

    // Process this single activity card (inline, no inner loop)
    {
      const firstRow = topicRows[0]!;
      const parsed   = tryParseJson<ParsedContent>(firstRow.content) ?? {};
      const topic    = String(firstRow.topic || firstRow.title || (parsed as any).topicTitle || '').trim() || 'Untitled';

      const platformTargets = topicRows
        .map((r) => ({
          platform:     String(r.platform || '').trim().toLowerCase(),
          content_type: String(r.content_type || 'post').trim().toLowerCase(),
        }))
        .filter((t) => t.platform);

      console.log('[block-processor] topic', { topic, platformTargets, rowCount: topicRows.length });

      if (platformTargets.length === 0) {
        console.warn('[block-processor] SKIP topic — no platform targets', { topic, contentType });
        blockSkipped += topicRows.length;
        continue;
      }

      // ── 4a. Generate master content ──────────────────────────────────────
      const enriched: Record<string, unknown> = {
        topic: firstRow.topic || firstRow.title || '',
        title: firstRow.title || firstRow.topic || '',
        ...parsed,
      };

      const existingContent = String(enriched.generated_content ?? '').trim();
      const reuseExisting   = existingContent.length > 0 && !isPlaceholder(existingContent);

      let master: { id: string; content: string; generation_status: string; generation_source: 'ai'; generated_at: string };
      try {
        if (reuseExisting) {
          const topicId = String(enriched.execution_id ?? enriched.id ?? firstRow.id ?? 'topic').slice(0, 40);
          master = {
            id: `master-${topicId}`,
            generated_at: new Date().toISOString(),
            content: existingContent,
            generation_status: 'generated',
            generation_source: 'ai',
          };
        } else {
          // Each activity card has its own unique topic + content_type.
          // Process one card at a time — AI gets a fresh context per card.
          const item = buildItemFromEnriched(enriched, platformTargets, companyId) as Parameters<typeof generateMasterContentFromIntent>[0];
          console.log(`[block-processor] [Card ${cardIdx + 1}/${totalCards}] Generating master for:`, {
            contentType, topic,
          });
          master = await generateMasterContentFromIntent(item);
        }
      } catch (err) {
        const errMsg = (err as Error)?.message ?? 'Master generation failed';
        console.error(`[block-processor] [Card ${cardIdx + 1}/${totalCards}] MASTER GEN FAILED`, {
          contentType, topic, error: errMsg,
          stack: (err as Error)?.stack?.split('\n').slice(0, 3).join(' | '),
        });
        emit?.({ phase: 'error', contentType, topic, message: errMsg });
        activityResults.push({
          cardIndex: cardIdx + 1, contentType, topic,
          platforms: platformTargets.map(t => t.platform),
          status: 'master_failed', error: errMsg, scheduledCount: 0,
        });
        blockSkipped += topicRows.length;
        continue;
      }

      const masterValid = Boolean(master.content) && !isPlaceholder(master.content);
      if (!masterValid) {
        const failReason = `Master returned ${!master.content ? 'empty' : 'placeholder'}: "${master.content?.slice(0, 80)}"`;
        console.error(`[block-processor] [Card ${cardIdx + 1}/${totalCards}] MASTER INVALID`, {
          contentType, topic, failReason,
          generation_status: master.generation_status,
        });
        activityResults.push({
          cardIndex: cardIdx + 1, contentType, topic,
          platforms: platformTargets.map(t => t.platform),
          status: 'master_failed', error: failReason, scheduledCount: 0,
        });
        blockSkipped += topicRows.length;
        continue;
      }
      console.log(`[block-processor] [Card ${cardIdx + 1}/${totalCards}] ✓ Master generated (${master.content.length} chars)`);
      console.log('[block-processor] master', {
        topic,
        generation_status: master.generation_status,
        masterValid,
        reused: reuseExisting,
        contentPreview: master.content?.slice(0, 80),
      });
      emit?.({ phase: 'topic-master', contentType, topic, reused: reuseExisting });

      // ── 4b. Build platform variants (all platforms in one call) ──────────
      let variantByKey = new Map<string, string>();
      try {
        const item = buildItemFromEnriched(enriched, platformTargets, companyId) as Parameters<typeof generateMasterContentFromIntent>[0];
        (item as any).master_content = { ...master, generation_status: 'generated' };
        const variants = await buildPlatformVariantsFromMaster(item);
        for (const v of variants) {
          const vp  = String(v.platform  || '').toLowerCase();
          const vct = String(v.content_type || '').toLowerCase();
          // Normalise 'twitter' → 'x' so the variant key matches the canonical
          // platform key used in accountMap and the row lookup below.
          const normVp = vp === 'twitter' ? 'x' : vp;
          const key  = `${normVp}::${vct}`;
          const keyAlias = vp !== normVp ? `${vp}::${vct}` : null; // also store original
          if (
            v.generated_content &&
            !v.generated_content.startsWith('[PLATFORM ADAPTATION FAILED]') &&
            !v.generated_content.startsWith('[PLATFORM MEDIA BLUEPRINT]')
          ) {
            variantByKey.set(key, v.generated_content);
            if (keyAlias) variantByKey.set(keyAlias, v.generated_content);
          }
        }
      } catch {
        // Variants failed — fall back to master content for all platforms
        variantByKey = new Map();
      }

      // ── 4c. Create blog entry for long-form content types ────────────────
      const isLongForm = BLOG_CONTENT_TYPES.has(contentType);
      if (isLongForm && masterValid && companyId && campaign.user_id) {
        try {
          await createBlogEntry(topic, master.content, firstRow.date, contentType, companyId, campaign.user_id);
        } catch { /* non-fatal */ }
      }

      // ── 4d. Schedule each platform row ───────────────────────────────────
      // Sort by PLATFORM_ORDER for deterministic repurpose indexing
      const orderedRows = [...topicRows].sort((a, b) => {
        const pa = String(a.platform || '').toLowerCase();
        const pb = String(b.platform || '').toLowerCase();
        const ia = PLATFORM_ORDER.indexOf(pa);
        const ib = PLATFORM_ORDER.indexOf(pb);
        return (ia >= 0 ? ia : 999) - (ib >= 0 ? ib : 999) || pa.localeCompare(pb);
      });

      const rowUpdates: { id: string; content: string }[] = [];

      for (const row of orderedRows) {
        const rawPlatform = String(row.platform || '').trim().toLowerCase();
        const platform    = normalize(rawPlatform);

        if (!platform) {
          console.warn('[block-processor] SKIP row — platform not in catalog', { rawPlatform, topic });
          if (!skippedPlatforms.includes(rawPlatform)) skippedPlatforms.push(rawPlatform);
          blockSkipped++;
          continue;
        }

        const socialAccountId = accountMap.get(platform) ?? null;
        if (!socialAccountId) {
          console.warn('[block-processor] SKIP row — no social account for platform', {
            platform, topic,
            availableAccounts: Array.from(accountMap.keys()),
            hint: 'Connect this platform account in Settings → Social Accounts',
          });
          if (!skippedPlatforms.includes(platform)) skippedPlatforms.push(platform);
          blockSkipped++;
          continue;
        }
        const postStatus = 'scheduled';

        const rowContentType = String(row.content_type || 'post').toLowerCase();
        const variantKey     = `${platform}::${rowContentType}`;
        const content        = variantByKey.get(variantKey) ?? (masterValid ? master.content : null);

        console.log('[block-processor] row content', {
          platform, topic, variantKey,
          hasVariant: variantByKey.has(variantKey),
          masterValid,
          contentNull: !content,
          contentPlaceholder: content ? isPlaceholder(content) : false,
          contentPreview: content?.slice(0, 60),
        });

        if (!content || isPlaceholder(content)) {
          console.warn('[block-processor] SKIP row — no valid content', { platform, topic, contentType });
          if (!skippedPlatforms.includes(platform)) skippedPlatforms.push(platform);
          blockSkipped++;
          continue;
        }

        const scheduledFor = buildScheduledFor(row.date, row.scheduled_time);
        const repurpose    = repurposeIndex.get(row.id) ?? { index: 1, total: 1 };

        // Enforce platform content-length limits so scheduled_posts inserts
        // don't fail on chk_linkedin_content / chk_twitter_content / etc.
        // Short stories and articles can generate 3000+ chars, exceeding limits.
        const PLATFORM_CHAR_LIMITS: Record<string, number> = {
          linkedin: 3000,
          twitter: 280,
          x: 280,
          instagram: 2200,
          facebook: 63000,
          youtube: 5000,
        };
        const charLimit = PLATFORM_CHAR_LIMITS[platform];
        let finalContent = content;
        if (charLimit && finalContent.length > charLimit) {
          // Truncate at word boundary, leave room for "..."
          const cut = finalContent.slice(0, charLimit - 4);
          const lastSpace = cut.lastIndexOf(' ');
          finalContent = (lastSpace > charLimit - 100 ? cut.slice(0, lastSpace) : cut).trim() + '...';
          console.log('[block-processor] Content truncated to platform limit', {
            platform, topic: topic.slice(0, 50),
            originalLen: content.length, truncatedLen: finalContent.length, limit: charLimit,
          });
        }

        // ── Insert scheduled_post immediately ───────────────────────────────
        const { data: inserted, error: insertError } = await supabase.from('scheduled_posts').insert({
          user_id:           campaign.user_id,
          social_account_id: socialAccountId,
          campaign_id:       campaignId,
          platform:          toDbPlatform(platform),
          content_type:      toDbContentType(platform, rowContentType, typeMapByPlatform),
          title:             topic || undefined,
          content:           finalContent,
          scheduled_for:     scheduledFor.toISOString(),
          status:            postStatus,
          repurpose_index:   repurpose.index,
          repurpose_total:   repurpose.total,
          created_at:        new Date().toISOString(),
          updated_at:        new Date().toISOString(),
        }).select('id').maybeSingle();

        if (insertError) {
          if (!skippedPlatforms.includes(platform)) skippedPlatforms.push(platform);
          blockSkipped++;
          console.warn('[block-processor] Insert failed for', platform, topic, insertError.message);
          continue;
        }

        if ((inserted as any)?.id) {
          try {
            await enqueueScheduledPostAt(
              String((inserted as any).id),
              String(campaign.user_id),
              String(socialAccountId),
              scheduledFor.toISOString(),
            );
          } catch (enqueueError: any) {
            console.warn('[block-processor] enqueueScheduledPostAt failed (non-fatal):', enqueueError?.message);
          }
        }

        blockScheduled++;
        emit?.({ phase: 'platform-done', contentType, topic, platform, scheduledFor: scheduledFor.toISOString() });

        // ── Build finalized JSON for daily_content_plans update ─────────────
        const rowParsed  = tryParseJson<ParsedContent>(row.content) ?? {};
        const finalizedJson = {
          ...(typeof rowParsed === 'object' && rowParsed !== null ? rowParsed : {}),
          generated_content: content,
          master_content:    master,
          platform_variants: Array.from(variantByKey.entries()).map(([k, c]) => {
            const [p, ct] = k.split('::');
            return { platform: p, content_type: ct, generated_content: c };
          }),
          content_status:       'finalized',
          finalized_at:         new Date().toISOString(),
          refinement_status:    'finalized',
          refinement_finalized: true,
          sequence_index:       Number.isFinite(Number(rowParsed.sequence_index)) ? Number(rowParsed.sequence_index) : undefined,
          total_distributions:  Number.isFinite(Number(rowParsed.total_distributions)) ? Number(rowParsed.total_distributions) : topicRows.length,
          source_execution_id:  String(rowParsed.source_execution_id || rowParsed.execution_id || '').trim() || undefined,
          distribution_mode:    (Number(rowParsed.total_distributions) || topicRows.length) > 1 ? 'shared' : 'unique',
        };
        rowUpdates.push({ id: row.id, content: JSON.stringify(finalizedJson) });
      }

      // ── 4e. Persist finalized content back to daily_content_plans ─────────
      if (rowUpdates.length > 0) {
        await Promise.all(
          rowUpdates.map(({ id, content: updatedContent }) =>
            supabase
              .from('daily_content_plans')
              .update({ content: updatedContent, updated_at: new Date().toISOString() })
              .eq('id', id)
              .then(({ error }) => {
                if (error) console.warn('[block-processor] daily_content_plans update failed:', id, error.message);
              })
          )
        );
      }
    } // end card block

    // Record successful activities that weren't already recorded as failures
    const alreadyRecorded = activityResults.some(r => r.cardIndex === cardIdx + 1);
    if (!alreadyRecorded && blockScheduled > 0) {
      activityResults.push({
        cardIndex: cardIdx + 1,
        contentType,
        topic: card.topic,
        platforms: card.rows.map(r => r.platform),
        status: 'succeeded',
        scheduledCount: blockScheduled,
      });
    }

    totalScheduled += blockScheduled;
    totalSkipped   += blockSkipped;
    emit?.({ phase: 'block-complete', contentType, blockIndex: cardIdx + 1, scheduled: blockScheduled, skipped: blockSkipped });
  } // end activity queue loop

  // ── 4. ACTIVITY-LEVEL SUMMARY ──────────────────────────────────────────────
  // Print one line per activity showing exactly what happened. No silent skips.
  console.log(`\n[block-processor] ═══ ACTIVITY SUMMARY (${activityQueue.length} cards) ═══`);
  for (const r of activityResults) {
    const icon = r.status === 'succeeded' ? '✓' : '✗';
    console.log(`[block-processor] ${icon} Card ${r.cardIndex}/${activityQueue.length} [${r.contentType}] "${r.topic.slice(0, 60)}" → ${r.status}${r.scheduledCount ? ` (${r.scheduledCount} posts)` : ''}${r.error ? ` — ${r.error.slice(0, 120)}` : ''}`);
  }
  // Flag any cards that were processed but produced no result entry (shouldn't happen)
  for (let i = 0; i < activityQueue.length; i++) {
    const card = activityQueue[i]!;
    if (!activityResults.some(r => r.cardIndex === i + 1)) {
      console.error(`[block-processor] ✗ Card ${i + 1}/${activityQueue.length} [${card.contentType}] "${card.topic.slice(0, 60)}" → SKIPPED WITHOUT RESULT`);
      activityResults.push({
        cardIndex: i + 1, contentType: card.contentType, topic: card.topic,
        platforms: card.rows.map(r => r.platform),
        status: 'skipped', error: 'Activity processed but no result recorded', scheduledCount: 0,
      });
    }
  }
  const succeeded = activityResults.filter(r => r.status === 'succeeded').length;
  const failed = activityResults.length - succeeded;
  console.log(`[block-processor] ═══ RESULT: ${succeeded}/${activityQueue.length} succeeded, ${failed} failed, ${totalScheduled} posts scheduled ═══\n`);

  return {
    scheduled_count:  totalScheduled,
    skipped_count:    totalSkipped,
    skipped_platforms: Array.from(new Set(skippedPlatforms)),
    activity_results:  activityResults,
  } as BlockScheduleResult & { activity_results: ActivityResult[] };
}
