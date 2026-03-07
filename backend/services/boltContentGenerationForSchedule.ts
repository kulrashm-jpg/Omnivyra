/**
 * BOLT Content Generation for Schedule
 *
 * When BOLT outcome is "schedule", generates master content + platform variants
 * for each activity (topic) before creating scheduled_posts. Enables calendar
 * and activity workspace to show repurposed content instead of placeholders.
 */

import { supabase } from '../db/supabaseClient';
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

/**
 * Generate master content and platform variants for all daily plan activities.
 * Returns a map: `${rowId}` -> generated_content for each daily plan row.
 */
export async function generateContentForDailyPlans(
  campaignId: string,
  dailyPlans: DailyPlanRow[]
): Promise<Map<string, string>> {
  const contentMap = new Map<string, string>();
  if (!campaignId || !Array.isArray(dailyPlans) || dailyPlans.length === 0) return contentMap;

  const groups = groupPlansByTopicAndWeek(dailyPlans);

  for (const [, rows] of groups) {
    if (rows.length === 0) continue;
    const first = rows[0]!;
    const parsed = tryParseJson<Record<string, unknown>>(first.content);
    if (!parsed || typeof parsed !== 'object') continue;

    const platformTargets = rows.map((r) => ({
      platform: String(r.platform || '').trim().toLowerCase(),
      content_type: String(r.content_type || 'post').trim().toLowerCase(),
    })).filter((t) => t.platform);

    if (platformTargets.length === 0) continue;

    const item = buildItemFromEnriched(parsed, platformTargets);

    try {
      const master = await generateMasterContentFromIntent(item);
      (item as any).master_content = master;
      (item as any).master_content = {
        ...master,
        generation_status: 'generated',
      };

      const variants = await buildPlatformVariantsFromMaster(item);
      const variantByKey = new Map<string, string>();
      for (const v of variants) {
        const key = `${String(v.platform).toLowerCase()}::${String(v.content_type).toLowerCase()}`;
        if (v.generated_content) variantByKey.set(key, v.generated_content);
      }

      for (const row of rows) {
        const platform = String(row.platform || '').trim().toLowerCase();
        const contentType = String(row.content_type || 'post').trim().toLowerCase();
        const key = `${platform}::${contentType}`;
        const content = variantByKey.get(key);
        if (content) {
          contentMap.set(row.id, content);
          const parsed = tryParseJson<Record<string, unknown>>(row.content);
          if (parsed && typeof parsed === 'object') {
            const updated = { ...parsed, generated_content: content };
            await supabase
              .from('daily_content_plans')
              .update({ content: JSON.stringify(updated) })
              .eq('id', row.id);
          }
        }
      }
    } catch (err) {
      console.warn('[bolt-content-gen] Failed for topic', first.topic, (err as Error)?.message);
    }
  }

  return contentMap;
}
