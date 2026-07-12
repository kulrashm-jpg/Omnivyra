import { ownedDbTable } from '../db/writeOwner';
/**
 * BOLT Content Generation for Schedule
 *
 * When BOLT outcome is "schedule", generates master content + platform variants
 * for each activity (topic) before creating scheduled_posts. Enables calendar
 * and activity workspace to show repurposed content instead of placeholders.
 */

import { supabase } from '../db/supabaseClient';

import { updateActivity } from './executionPlannerPersistence';
import { generateMasterContentFromIntent } from './contentGenerationPipeline';
import { buildPlatformVariantsFromMaster } from './contentGenerationPipeline';
// Closure Pass — Phase 4. BOLT schedule generation now resolves
// governance from the campaign's company profile and threads it onto
// the pipeline `item` so system prompts pick up the preamble.
import { getProfile } from './companyProfileService';
import { buildGovernancePromptContext } from './creator/strategyGovernancePromptContext';
// R3-P2 — Content Workspace adoption. Same single resolver as
// processBlockSchedule: APPROVED workspace copy is canonical; generation is
// fallback only (review/draft are planning-only states, R3-P2.1).
import { resolveWorkspaceContent } from '../../lib/campaign/workspaceContentResolution';

/** Accepts DB shape where title/topic/scheduled_time may be null */
type DailyPlanRow = {
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

type ParsedPlanContent = Record<string, unknown> & {
  execution_id?: string;
  source_execution_id?: string;
  master_content_id?: string;
  sequence_index?: number;
  total_distributions?: number;
  distribution_mode?: string;
  platforms?: string[];
};

function tryParseJson<T>(val: unknown): T | null {
  if (val == null) return null;
  if (typeof val === 'string') {
    try {
      return JSON.parse(val) as T;
    } catch {
      return null;
    }
  }
  return typeof val === 'object' ? (val as T) : null;
}

function isPlaceholderLikeGeneratedText(content: string): boolean {
  const text = String(content || '').trim();
  if (!text) return true;

  if (
    text.startsWith('[PLATFORM ADAPTATION FAILED]') ||
    text.startsWith('[MASTER GENERATION FAILED') ||
    text.startsWith('[MEDIA BLUEPRINT]') ||
    text.startsWith('[MASTER CONTENT PLACEHOLDER]') ||
    text.startsWith('[PLATFORM MEDIA BLUEPRINT]')
  ) {
    return true;
  }

  return (
    /^content for\b/i.test(text) ||
    /^content placeholder\b/i.test(text) ||
    /^post placeholder\b/i.test(text) ||
    /^execution job content placeholder\b/i.test(text)
  );
}

function isReusableGeneratedText(content: string): boolean {
  return !isPlaceholderLikeGeneratedText(content);
}

/**
 * Group daily plans by (topic, week_number). Slots with same topic+week share one master.
 */
function sortRowsForDistribution(rows: DailyPlanRow[]): DailyPlanRow[] {
  return [...rows].sort((a, b) => {
    const parsedA = tryParseJson<ParsedPlanContent>(a.content) ?? {};
    const parsedB = tryParseJson<ParsedPlanContent>(b.content) ?? {};
    const seqA = Number(parsedA.sequence_index ?? Number.POSITIVE_INFINITY);
    const seqB = Number(parsedB.sequence_index ?? Number.POSITIVE_INFINITY);
    if (seqA !== seqB) return seqA - seqB;
    return String(a.platform || '').localeCompare(String(b.platform || ''));
  });
}

function buildDistributionGroupKey(row: DailyPlanRow): string {
  const parsed = tryParseJson<ParsedPlanContent>(row.content) ?? {};
  const sourceExecutionId = String(parsed.source_execution_id ?? '').trim();
  const masterContentId = String(parsed.master_content_id ?? '').trim();
  const executionId = String(parsed.execution_id ?? '').trim();
  const topic = String(row.topic || row.title || parsed.topicTitle || '').trim() || 'untitled';
  const week = Number(row.week_number) || 1;

  if (sourceExecutionId) return `shared::${sourceExecutionId}::${week}`;
  if (masterContentId) return `master::${masterContentId}::${week}`;
  if (executionId) return `unique::${executionId}::${week}`;
  return `topic::${topic}::${week}`;
}

function groupPlansByDistribution(plans: DailyPlanRow[]): Map<string, DailyPlanRow[]> {
  const groups = new Map<string, DailyPlanRow[]>();
  for (const row of plans) {
    const key = buildDistributionGroupKey(row);
    const arr = groups.get(key) ?? [];
    arr.push(row);
    groups.set(key, sortRowsForDistribution(arr));
  }
  return groups;
}

/**
 * Build DailyExecutionItemLike from enriched content + platform targets.
 * Enriched object (from daily_content_plans.content) may have flat or nested intent/brief.
 */
function buildItemFromEnriched(
  enriched: Record<string, unknown>,
  platformTargets: Array<{ platform: string; content_type: string }>
): Record<string, unknown> {
  const topic = String(enriched.topicTitle ?? enriched.topic ?? enriched.title ?? '').trim() || 'TBD';
  const intent = tryParseJson<Record<string, unknown>>(enriched.intent) ?? {};
  const brief = tryParseJson<Record<string, unknown>>(enriched.writer_content_brief ?? enriched.writerBrief) ?? {};
  return {
    execution_id: String(enriched.execution_id ?? enriched.id ?? `topic-${topic.slice(0, 30).replace(/\s/g, '-')}`),
    topic,
    title: topic,
    intent: {
      objective: enriched.dailyObjective ?? intent.objective ?? 'Educate and engage the audience',
      pain_point: enriched.whatProblemAreWeAddressing ?? intent.pain_point ?? 'Audience challenge relevant to topic',
      outcome_promise: enriched.whatShouldReaderLearn ?? intent.outcome_promise ?? 'Clear value from this content',
      cta_type: enriched.desiredAction ?? intent.cta_type ?? 'Soft engagement',
      target_audience: enriched.whoAreWeWritingFor ?? intent.target_audience ?? 'Professional audience',
    },
    writer_content_brief: {
      topicTitle: topic,
      writingIntent: (enriched.writingIntent ?? brief.writingIntent ?? enriched.dailyObjective ?? '') as string,
      whatShouldReaderLearn: (enriched.whatShouldReaderLearn ?? brief.whatShouldReaderLearn ?? enriched.intro_objective ?? '') as string,
      whatProblemAreWeAddressing: (enriched.whatProblemAreWeAddressing ?? brief.whatProblemAreWeAddressing ?? enriched.summary ?? '') as string,
      desiredAction: (enriched.desiredAction ?? brief.desiredAction ?? enriched.cta ?? '') as string,
      narrativeStyle: (enriched.narrativeStyle ?? brief.narrativeStyle ?? enriched.brand_voice ?? '') as string,
      topicGoal: (enriched.dailyObjective ?? brief.topicGoal ?? enriched.objective ?? '') as string,
    },
    content_type: 'post',
    active_platform_targets: platformTargets,
  };
}

export type GenerateContentProgressOptions = {
  /** Called when transitioning between creating (master) and repurposing (variants) phases. */
  onPhase?: (phase: 'creating' | 'repurposing') => void;
};

/** Text-based content types that should create a blog entry in the `blogs` table. */
const BLOG_CONTENT_TYPES = new Set(['article', 'newsletter', 'white_paper', 'short_story', 'blog']);

function isBlogContentType(contentType: string): boolean {
  return BLOG_CONTENT_TYPES.has(String(contentType || '').toLowerCase().trim());
}

/** Build a unique slug from a topic title with a short timestamp suffix. */
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

/** Process up to N topic groups in parallel to speed up BOLT content generation. */
const CONTENT_GEN_CONCURRENCY = 1;

/**
 * Generate master content and platform variants for all daily plan activities.
 * Processes topic groups with limited concurrency (2) for speed.
 * Returns a map: `${rowId}` -> generated_content for each daily plan row.
 */
export async function generateContentForDailyPlans(
  campaignId: string,
  dailyPlans: DailyPlanRow[],
  options?: GenerateContentProgressOptions
): Promise<Map<string, string>> {
  const contentMap = new Map<string, string>();
  if (!campaignId || !Array.isArray(dailyPlans) || dailyPlans.length === 0) return contentMap;

  // Resolve company_id and user_id — needed for blog creation and cost tracking
  let campaignCompanyId: string | null = null;
  let campaignUserId: string | null = null;
  try {
    const { data: campaign } = await ownedDbTable('campaigns').select('company_id, user_id').eq('id', campaignId).maybeSingle();
    campaignCompanyId = campaign?.company_id ?? null;
    campaignUserId = (campaign as any)?.user_id ?? null;
  } catch { /* non-fatal; generation continues without company_id */ }

  const groups = groupPlansByDistribution(dailyPlans);
  const groupEntries = Array.from(groups.entries());
  let phaseCreatingFired = false;
  let phaseRepurposingFired = false;

  async function processGroup(rows: DailyPlanRow[]): Promise<{ id: string; content: string }[]> {
    if (rows.length === 0) return [];
    const first = rows[0]!;
    // content may be a JSON object (enriched from BOLT planning) or a plain string/null —
    // fall back to an empty object so we can still generate from row-level data (topic, title).
    const parsed = tryParseJson<ParsedPlanContent>(first.content) ?? {};

    const platformTargets = rows.map((r) => ({
      platform: String(r.platform || '').trim().toLowerCase(),
      content_type: String(r.content_type || 'post').trim().toLowerCase(),
    })).filter((t) => t.platform);
    if (platformTargets.length === 0) return [];

    // R3-P2: resolve Content Workspace adoption per row BEFORE any generation.
    // Fully adopted groups skip the master + variant LLM calls entirely;
    // non-adopted rows flow through the exact pre-R3-P2 path.
    const adoptedByRowId = new Map<string, { body: string; tier: 'approved' }>();
    for (const r of rows) {
      const resolution = resolveWorkspaceContent(tryParseJson<Record<string, unknown>>(r.content));
      if (resolution.adopted && resolution.body && resolution.tier) {
        adoptedByRowId.set(r.id, { body: resolution.body, tier: resolution.tier });
      }
    }
    const allRowsAdopted = rows.length > 0 && adoptedByRowId.size === rows.length;

    // Merge row-level topic/title into parsed so buildItemFromEnriched can always resolve a topic.
    const enriched: Record<string, unknown> = {
      topic: first.topic || first.title || '',
      title: first.title || first.topic || '',
      ...parsed,
    };

    // Closure Pass — Phase 4. Resolve governance from the campaign's
    // company profile. Best-effort: failure leaves governance=null and
    // legacy behavior preserved.
    let governance: ReturnType<typeof buildGovernancePromptContext> | null = null;
    try {
      const profile = await getProfile(campaignCompanyId, { autoRefine: false });
      if (profile) {
        governance = buildGovernancePromptContext({
          companyContext: {
            industry: profile.industry ?? null,
            industry_list: profile.industry_list ?? null,
            category: profile.category ?? null,
            category_list: profile.category_list ?? null,
          },
          contentType: 'image', // BOLT-scheduled posts share the image-lane policy
          selectedStrategy: null,
        });
      }
    } catch {
      // Best-effort.
    }
    const item = {
      ...buildItemFromEnriched(enriched, platformTargets),
      company_id: campaignCompanyId,
      ...(governance ? { governance } : {}),
    } as unknown as Parameters<typeof generateMasterContentFromIntent>[0];

    // Use existing generated_content as master if available — avoids a redundant LLM call
    // and ensures repurposing is based on the actual stored content, not a regenerated draft.
    const existingContent = String(enriched.generated_content ?? '').trim();
    const isValidExisting =
      existingContent.length > 0 &&
      isReusableGeneratedText(existingContent);

    let master: { id: string; generated_at: string; content: string; generation_status: string; generation_source: 'ai' };
    if (allRowsAdopted) {
      // R3-P2: workspace copy IS the master — no LLM call; blog creation
      // below records the canonical workspace body for long-form rows.
      const topicId = String(enriched.execution_id ?? enriched.id ?? first.id ?? 'topic').slice(0, 40);
      master = {
        id: `master-workspace-${topicId}`,
        generated_at: new Date().toISOString(),
        content: adoptedByRowId.get(first.id)?.body ?? adoptedByRowId.values().next().value!.body,
        generation_status: 'generated',
        generation_source: 'ai',
      };
    } else if (isValidExisting) {
      const topicId = String(enriched.execution_id ?? enriched.id ?? first.id ?? 'topic').slice(0, 40);
      master = {
        id: `master-${topicId}`,
        generated_at: new Date().toISOString(),
        content: existingContent,
        generation_status: 'generated',
        generation_source: 'ai',
      };
    } else {
      master = await generateMasterContentFromIntent(item);
    }

    (item as any).master_content = { ...master, generation_status: 'generated' };
    // R3-P2: fully adopted groups never adapt — each row publishes its own
    // workspace body verbatim (adaptation already happened at planning time).
    const variants = allRowsAdopted ? [] : await buildPlatformVariantsFromMaster(item);
    const variantByKey = new Map<string, string>();
    for (const v of variants) {
      const key = `${String(v.platform).toLowerCase()}::${String(v.content_type).toLowerCase()}`;
      // Skip failed/placeholder variants — don't store them in scheduled posts
      if (
        v.generated_content &&
        !v.generated_content.startsWith('[PLATFORM ADAPTATION FAILED]') &&
        !v.generated_content.startsWith('[PLATFORM MEDIA BLUEPRINT]')
      ) {
        variantByKey.set(key, v.generated_content);
      }
    }

    // Save blog entry if any row in this topic group has a long-form content type.
    // This creates the canonical article in the blogs workspace so users can edit/review it.
    const masterIsValid =
      Boolean(master.content) &&
      isReusableGeneratedText(master.content);

    const hasBlogRow = rows.some((r) => isBlogContentType(r.content_type));
    if (hasBlogRow && masterIsValid && campaignCompanyId && campaignUserId) {
      try {
        const blogTitle = String(enriched.topicTitle ?? enriched.topic ?? enriched.title ?? first.topic ?? first.title ?? '').trim() || 'Untitled Article';
        const datePart = String(first.date ?? '').slice(0, 10);
        const scheduledDate = datePart
          ? new Date(`${datePart}T09:00:00Z`).toISOString()
          : new Date().toISOString();
        const blogSlug = buildBlogSlug(blogTitle);
        const contentTypeSample = rows.find((r) => isBlogContentType(r.content_type))?.content_type ?? 'article';
        const category = contentTypeSample.replace(/_/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase());

        const { error: blogInsertError } = await ownedDbTable('blogs').insert({
          company_id: campaignCompanyId,
          title: blogTitle,
          slug: blogSlug,
          content: master.content,
          status: 'scheduled',
          published_at: scheduledDate,
          created_by: campaignUserId,
          category,
        });
        if (blogInsertError) {
          console.warn('[bolt-content-gen] Blog insert failed for topic', blogTitle, blogInsertError.message);
        }
      } catch (blogErr) {
        console.warn('[bolt-content-gen] Blog creation error:', (blogErr as Error)?.message);
      }
    }

    const updates: { id: string; content: string }[] = [];
    for (const row of rows) {
      const platform = String(row.platform || '').trim().toLowerCase();
      const contentType = String(row.content_type || 'post').trim().toLowerCase();
      const key = `${platform}::${contentType}`;
      // R3-P2 canonical resolution: workspace copy first (verbatim), then the
      // pre-existing variant → master → existing chain, byte-identical for
      // non-adopted rows.
      const adopted = adoptedByRowId.get(row.id) ?? null;
      const content = adopted?.body ?? variantByKey.get(key) ?? (masterIsValid ? master.content : undefined) ?? (isValidExisting ? existingContent : undefined);
      if (content && isReusableGeneratedText(content)) {
        contentMap.set(row.id, content);
        // Preserve existing JSON envelope if present; otherwise create a minimal one
        const p = tryParseJson<Record<string, unknown>>(row.content) ?? { topic: row.topic || row.title || '' };
        const rowParsed = tryParseJson<ParsedPlanContent>(row.content) ?? {};
        const updated = {
          ...p,
          generated_content: content,
          master_content: master,
          platform_variants: variants,
          content_status: 'finalized',
          finalized_at: new Date().toISOString(),
          refinement_status: 'finalized',
          refinement_finalized: true,
          sequence_index: Number.isFinite(Number(rowParsed.sequence_index)) ? Number(rowParsed.sequence_index) : undefined,
          total_distributions: Number.isFinite(Number(rowParsed.total_distributions)) ? Number(rowParsed.total_distributions) : rows.length,
          source_execution_id:
            String(rowParsed.source_execution_id || rowParsed.execution_id || '').trim() || undefined,
          distribution_mode:
            (Number(rowParsed.total_distributions) || rows.length) > 1 ? 'shared' : 'unique',
          // R3-P2 — audit marker: this row carries Content Workspace copy.
          // Planner-owned fields ride through the ...p spread untouched.
          ...(adopted ? { content_source: 'workspace', content_source_tier: adopted.tier } : {}),
        };
        updates.push({ id: row.id, content: JSON.stringify(updated) });
      }
    }
    return updates;
  }

  for (let i = 0; i < groupEntries.length; i += CONTENT_GEN_CONCURRENCY) {
    const batch = groupEntries.slice(i, i + CONTENT_GEN_CONCURRENCY);
    if (!phaseCreatingFired) {
      phaseCreatingFired = true;
      options?.onPhase?.('creating');
    }
    const results = await Promise.all(
      batch.map(([, rows]) => processGroup(rows).catch((err) => {
        const first = rows[0];
        if (first) console.warn('[bolt-content-gen] Failed for topic', first.topic, (err as Error)?.message);
        return [] as { id: string; content: string }[];
      }))
    );
    if (!phaseRepurposingFired) {
      phaseRepurposingFired = true;
      options?.onPhase?.('repurposing');
    }
    const allUpdates = results.flat();
    if (allUpdates.length > 0) {
      const { updateActivity } = await import('./executionPlannerPersistence');
      await Promise.all(
        allUpdates.map(({ id, content }) =>
          updateActivity(id, { content }, 'board')
        )
      );
    }
  }

  return contentMap;
}
