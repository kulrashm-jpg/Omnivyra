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

/**
 * Group daily plans by (topic, week_number). Slots with same topic+week share one master.
 */
function groupPlansByTopicAndWeek(plans: DailyPlanRow[]): Map<string, DailyPlanRow[]> {
  const groups = new Map<string, DailyPlanRow[]>();
  for (const row of plans) {
    const topic = String(row.topic || row.title || '').trim() || 'untitled';
    const week = Number(row.week_number) || 1;
    const key = `${topic}|${week}`;
    const arr = groups.get(key) ?? [];
    arr.push(row);
    groups.set(key, arr);
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

/** Process up to N topic groups in parallel to speed up BOLT content generation. */
const CONTENT_GEN_CONCURRENCY = 2;

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

  const groups = groupPlansByTopicAndWeek(dailyPlans);
  const groupEntries = Array.from(groups.entries());
  let phaseCreatingFired = false;
  let phaseRepurposingFired = false;

  async function processGroup(rows: DailyPlanRow[]): Promise<{ id: string; content: string }[]> {
    if (rows.length === 0) return [];
    const first = rows[0]!;
    const parsed = tryParseJson<Record<string, unknown>>(first.content);
    if (!parsed || typeof parsed !== 'object') return [];

    const platformTargets = rows.map((r) => ({
      platform: String(r.platform || '').trim().toLowerCase(),
      content_type: String(r.content_type || 'post').trim().toLowerCase(),
    })).filter((t) => t.platform);
    if (platformTargets.length === 0) return [];

    const item = buildItemFromEnriched(parsed, platformTargets);
    const master = await generateMasterContentFromIntent(item);
    (item as any).master_content = master;
    (item as any).master_content = { ...master, generation_status: 'generated' };
    const variants = await buildPlatformVariantsFromMaster(item);
    const variantByKey = new Map<string, string>();
    for (const v of variants) {
      const key = `${String(v.platform).toLowerCase()}::${String(v.content_type).toLowerCase()}`;
      if (v.generated_content) variantByKey.set(key, v.generated_content);
    }

    const updates: { id: string; content: string }[] = [];
    for (const row of rows) {
      const platform = String(row.platform || '').trim().toLowerCase();
      const contentType = String(row.content_type || 'post').trim().toLowerCase();
      const key = `${platform}::${contentType}`;
      const content = variantByKey.get(key);
      if (content) {
        contentMap.set(row.id, content);
        const p = tryParseJson<Record<string, unknown>>(row.content);
        if (p && typeof p === 'object') {
          const updated = { ...p, generated_content: content };
          updates.push({ id: row.id, content: JSON.stringify(updated) });
        }
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
