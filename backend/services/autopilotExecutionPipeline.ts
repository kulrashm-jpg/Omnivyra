import { attachGenerationPipelineToDailyItems, isMediaDependentContentType } from './contentGenerationPipeline';
import { getRulesForPlatform } from './platformRulesService';

type AutopilotOptions = {
  timezone?: string;
};

type DailyExecutionItemLike = {
  execution_id?: string;
  platform?: string;
  content_type?: string;
  status?: string;
  scheduled_time?: string;
  media_status?: 'missing' | 'ready';
  master_content?: { generation_status?: string };
  platform_variants?: Array<{
    platform?: string;
    content_type?: string;
    generated_content?: string;
    generation_status?: string;
    locked_variant?: boolean;
  }>;
  schedule_source?: string;
  [key: string]: unknown;
};

type AutopilotSummary = {
  total_items: number;
  generated_masters: number;
  generated_variants: number;
  scheduled_items: number;
  skipped_locked: number;
  skipped_missing_media: number;
};

function emptySummary(): AutopilotSummary {
  return {
    total_items: 0,
    generated_masters: 0,
    generated_variants: 0,
    scheduled_items: 0,
    skipped_locked: 0,
    skipped_missing_media: 0,
  };
}

function normalizedTimezone(input?: string): string {
  const raw = String(input || '').trim();
  return raw || 'UTC';
}

function toMinutes(timeValue: string): number | null {
  const m = String(timeValue || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mm)) return null;
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

function fromMinutes(total: number): string {
  const normalized = ((Math.floor(total) % 1440) + 1440) % 1440;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function hashSeed(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function isReadyForScheduling(item: DailyExecutionItemLike): { ready: boolean; missingMedia: boolean } {
  const masterGenerated = String(item?.master_content?.generation_status || '').toLowerCase() === 'generated';
  const variants = Array.isArray(item?.platform_variants) ? item.platform_variants : [];
  const hasGeneratedVariant = variants.some((v) => String(v?.generation_status || '').toLowerCase() === 'generated');
  const mediaDependent = isMediaDependentContentType(item?.content_type);
  const mediaReady = !mediaDependent || String(item?.media_status || '').toLowerCase() === 'ready';
  return {
    ready: masterGenerated && hasGeneratedVariant && mediaReady,
    missingMedia: mediaDependent && !mediaReady,
  };
}

function countGeneratedDelta(before: DailyExecutionItemLike[], after: DailyExecutionItemLike[]): Pick<AutopilotSummary, 'generated_masters' | 'generated_variants' | 'skipped_locked'> {
  const byIdBefore = new Map<string, DailyExecutionItemLike>();
  const byIdAfter = new Map<string, DailyExecutionItemLike>();
  for (const item of before) {
    const id = String(item?.execution_id || '').trim();
    if (id) byIdBefore.set(id, item);
  }
  for (const item of after) {
    const id = String(item?.execution_id || '').trim();
    if (id) byIdAfter.set(id, item);
  }

  let generated_masters = 0;
  let generated_variants = 0;
  let skipped_locked = 0;

  for (const [id, afterItem] of byIdAfter.entries()) {
    const beforeItem = byIdBefore.get(id);
    const beforeMasterGenerated = String(beforeItem?.master_content?.generation_status || '').toLowerCase() === 'generated';
    const afterMasterGenerated = String(afterItem?.master_content?.generation_status || '').toLowerCase() === 'generated';
    if (!beforeMasterGenerated && afterMasterGenerated) generated_masters += 1;

    const beforeVariants = Array.isArray(beforeItem?.platform_variants) ? beforeItem!.platform_variants! : [];
    const afterVariants = Array.isArray(afterItem?.platform_variants) ? afterItem.platform_variants! : [];
    const beforeGeneratedKeys = new Set(
      beforeVariants
        .filter((v) => String(v?.generation_status || '').toLowerCase() === 'generated')
        .map((v) => `${String(v?.platform || '').toLowerCase()}::${String(v?.content_type || '').toLowerCase()}`)
    );
    for (const variant of afterVariants) {
      const key = `${String(variant?.platform || '').toLowerCase()}::${String(variant?.content_type || '').toLowerCase()}`;
      const afterGenerated = String(variant?.generation_status || '').toLowerCase() === 'generated';
      if (afterGenerated && !beforeGeneratedKeys.has(key)) generated_variants += 1;
      if (variant?.locked_variant) skipped_locked += 1;
    }
  }

  return { generated_masters, generated_variants, skipped_locked };
}

export function prepareExecutionItemsForAutopilot(week: any): DailyExecutionItemLike[] {
  const items: DailyExecutionItemLike[] = Array.isArray(week?.daily_execution_items) ? week.daily_execution_items : [];
  if (items.length === 0) {
    console.warn('[autopilot][no-execution-items]', { week: week?.week ?? week?.weekNumber ?? null });
  }
  return items;
}

export async function applyAutopilotScheduling(items: DailyExecutionItemLike[], options?: AutopilotOptions): Promise<{
  items: DailyExecutionItemLike[];
  scheduled_items: number;
  skipped_missing_media: number;
}> {
  const tz = normalizedTimezone(options?.timezone);
  let scheduled_items = 0;
  let skipped_missing_media = 0;

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const { ready, missingMedia } = isReadyForScheduling(item);
    if (!ready) {
      if (missingMedia) skipped_missing_media += 1;
      continue;
    }

    if (!String(item?.scheduled_time || '').trim()) {
      const platform = String(item?.platform || '').toLowerCase();
      const contentType = String(item?.content_type || '').toLowerCase();
      let suggestedTime = '09:00';
      try {
        const rules = await getRulesForPlatform({ platform: platform || 'linkedin', contentType: contentType || 'post' });
        const bestTimes = Array.isArray(rules?.best_times) ? rules.best_times : [];
        const first = String(bestTimes[0] || '').trim();
        const parsed = toMinutes(first);
        if (parsed != null) {
          suggestedTime = fromMinutes(parsed);
        } else {
          const seed = hashSeed(`${platform}|${contentType}|${tz}|${i}`);
          const fallbackHours = [9, 12, 15, 18];
          suggestedTime = `${String(fallbackHours[seed % fallbackHours.length]).padStart(2, '0')}:00`;
        }
      } catch (error) {
        console.warn('[autopilot][platform-rules-fallback-time]', {
          execution_id: item?.execution_id ?? null,
          error: String(error),
        });
        const seed = hashSeed(`${platform}|${contentType}|${tz}|${i}`);
        const fallbackHours = [9, 12, 15, 18];
        suggestedTime = `${String(fallbackHours[seed % fallbackHours.length]).padStart(2, '0')}:00`;
      }
      item.scheduled_time = suggestedTime;
    }

    item.schedule_source = 'autopilot';
    item.status = 'scheduled';
    scheduled_items += 1;
  }

  return { items, scheduled_items, skipped_missing_media };
}

export async function runAutopilotForWeek(
  week: any,
  options?: AutopilotOptions
): Promise<{ week: any; summary: AutopilotSummary }> {
  const summary = emptySummary();
  try {
    const weekRef = week && typeof week === 'object' ? week : { daily_execution_items: [] };
    const beforeItems = prepareExecutionItemsForAutopilot(weekRef).map((item) => JSON.parse(JSON.stringify(item)));
    summary.total_items = beforeItems.length;

    await attachGenerationPipelineToDailyItems([weekRef]);

    const afterGenerationItems = prepareExecutionItemsForAutopilot(weekRef);
    const deltas = countGeneratedDelta(beforeItems, afterGenerationItems);
    summary.generated_masters = deltas.generated_masters;
    summary.generated_variants = deltas.generated_variants;
    summary.skipped_locked = deltas.skipped_locked;

    const scheduling = await applyAutopilotScheduling(afterGenerationItems, options);
    summary.scheduled_items = scheduling.scheduled_items;
    summary.skipped_missing_media = scheduling.skipped_missing_media;

    return { week: weekRef, summary };
  } catch (error) {
    console.warn('[autopilot][run-week-failed]', { error: String(error) });
    return { week, summary };
  }
}

export async function runAutopilotForPlan(
  plan: { weeks?: any[] } | null | undefined,
  options?: AutopilotOptions
): Promise<{ plan: { weeks: any[] }; summary: AutopilotSummary }> {
  const summary = emptySummary();
  const weeks = Array.isArray(plan?.weeks) ? plan!.weeks : [];
  if (weeks.length === 0) {
    console.warn('[autopilot][no-weeks]');
    return { plan: { weeks }, summary };
  }

  for (const week of weeks) {
    const result = await runAutopilotForWeek(week, options);
    summary.total_items += result.summary.total_items;
    summary.generated_masters += result.summary.generated_masters;
    summary.generated_variants += result.summary.generated_variants;
    summary.scheduled_items += result.summary.scheduled_items;
    summary.skipped_locked += result.summary.skipped_locked;
    summary.skipped_missing_media += result.summary.skipped_missing_media;
  }

  return { plan: { weeks }, summary };
}

