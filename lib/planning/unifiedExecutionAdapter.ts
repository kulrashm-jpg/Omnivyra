/**
 * Unified Execution Adapter — SAFE PHASE
 * Maps blueprint execution items and daily_content_plans rows to a single internal shape.
 * No distribution logic. No execution_id generation. No schema changes.
 */

export interface UnifiedExecutionUnit {
  execution_id: string;
  campaign_id: string;
  week_number: number;
  day?: string;

  title: string;
  description?: string;

  platform: string;
  content_type?: string;

  execution_mode?: string;
  creator_instruction?: Record<string, unknown>;

  distribution_strategy?: string;

  source_type: 'BLUEPRINT_EXECUTION' | 'DAILY_PLAN_ROW';

  scheduled_time?: string;
  topic?: string;
  daily_plan_id?: string;
  master_content_id?: string;

  writer_content_brief?: Record<string, unknown>;
  intent?: Record<string, unknown>;
}

function normalizePlatform(value?: string): string {
  const s = String(value ?? '').trim().toLowerCase();
  return s || 'linkedin';
}

function normalizeContentType(value?: string): string {
  const s = String(value ?? '').trim().toLowerCase();
  return s || 'post';
}

function devLog(unit: UnifiedExecutionUnit): void {
  if (process.env.NODE_ENV !== 'development') return;
  console.log(
    '[UnifiedExecutionAdapter]',
    unit.source_type,
    unit.execution_id,
    unit.week_number,
    unit.day
  );
}

/**
 * Map a blueprint execution item (daily_execution_items / execution_items / resolved_postings)
 * to UnifiedExecutionUnit. Does NOT generate execution_id; uses item.execution_id or item.id only.
 */
export function blueprintItemToUnifiedExecutionUnit(
  item: Record<string, unknown> | null | undefined,
  week: Record<string, unknown> | null | undefined,
  campaignId: string
): UnifiedExecutionUnit {
  const safeItem = item && typeof item === 'object' ? item : {};
  const safeWeek = week && typeof week === 'object' ? week : {};

  const execution_id = String(
    (safeItem as any).execution_id ?? (safeItem as any).id ?? ''
  ).trim();
  const week_number =
    Number((safeWeek as any).week_number ?? (safeWeek as any).week ?? 0) || 0;

  const brief = (safeItem as any).writer_content_brief;
  const title =
    (brief && typeof brief === 'object' && typeof (brief as any).topicTitle === 'string'
      ? (brief as any).topicTitle
      : '') ||
    String((safeItem as any).topic ?? '').trim() ||
    String((safeItem as any).title ?? '').trim() ||
    'Untitled';

  const unit: UnifiedExecutionUnit = {
    execution_id,
    campaign_id: campaignId,
    week_number,
    day:
      typeof (safeItem as any).day === 'string' && (safeItem as any).day.trim()
        ? (safeItem as any).day.trim()
        : undefined,
    title,
    description:
      (brief && typeof brief === 'object' && typeof (brief as any).writingIntent === 'string'
        ? (brief as any).writingIntent
        : '') ||
      String((safeItem as any).description ?? '').trim() ||
      undefined,
    platform: normalizePlatform((safeItem as any).platform),
    content_type: normalizeContentType((safeItem as any).content_type),
    execution_mode:
      typeof (safeItem as any).execution_mode === 'string'
        ? (safeItem as any).execution_mode
        : undefined,
    creator_instruction:
      (safeItem as any).creator_instruction &&
      typeof (safeItem as any).creator_instruction === 'object'
        ? (safeItem as any).creator_instruction as Record<string, unknown>
        : undefined,
    distribution_strategy:
      typeof (safeWeek as any).distribution_strategy === 'string'
        ? (safeWeek as any).distribution_strategy
        : undefined,
    source_type: 'BLUEPRINT_EXECUTION',
    scheduled_time:
      typeof (safeItem as any).scheduled_time === 'string'
        ? (safeItem as any).scheduled_time
        : undefined,
    topic:
      typeof (safeItem as any).topic === 'string'
        ? (safeItem as any).topic
        : (typeof (safeItem as any).title === 'string' ? (safeItem as any).title : undefined),
    master_content_id:
      typeof (safeItem as any).master_content_id === 'string'
        ? (safeItem as any).master_content_id
        : undefined,
    writer_content_brief:
      brief && typeof brief === 'object' ? (brief as Record<string, unknown>) : undefined,
    intent:
      (safeItem as any).intent && typeof (safeItem as any).intent === 'object'
        ? (safeItem as any).intent as Record<string, unknown>
        : undefined,
  };

  devLog(unit);
  return unit;
}

/**
 * Map a daily plan row (API response shape or DB row shape) to UnifiedExecutionUnit.
 * execution_id: row.dailyObject?.execution_id ?? row.execution_id ?? row.id
 */
export function dailyPlanRowToUnifiedExecutionUnit(
  row: Record<string, unknown> | null | undefined
): UnifiedExecutionUnit {
  const r = row && typeof row === 'object' ? row : {};
  const daily = (r as any).dailyObject && typeof (r as any).dailyObject === 'object' ? (r as any).dailyObject : null;

  const execution_id = String(
    daily?.execution_id ?? (r as any).execution_id ?? (r as any).id ?? ''
  ).trim();

  const week_number = Number((r as any).weekNumber ?? (r as any).week_number ?? 0) || 0;
  const day =
    typeof (r as any).dayOfWeek === 'string' && (r as any).dayOfWeek.trim()
      ? (r as any).dayOfWeek.trim()
      : typeof (r as any).day_of_week === 'string' && (r as any).day_of_week.trim()
        ? (r as any).day_of_week.trim()
        : undefined;

  const title =
    String((r as any).title ?? '').trim() ||
    String((r as any).topic ?? '').trim() ||
    (daily && typeof daily.topicTitle === 'string' ? daily.topicTitle : '') ||
    'Untitled';

  const unit: UnifiedExecutionUnit = {
    execution_id: execution_id || String((r as any).id ?? ''),
    campaign_id: String((r as any).campaign_id ?? '').trim(),
    week_number,
    day,
    title,
    description:
      String((r as any).description ?? '').trim() ||
      (daily && typeof daily.writingIntent === 'string' ? daily.writingIntent : '') ||
      undefined,
    platform: normalizePlatform((r as any).platform),
    content_type: normalizeContentType((r as any).contentType ?? (r as any).content_type ?? daily?.contentType),
    execution_mode:
      typeof (r as any).execution_mode === 'string'
        ? (r as any).execution_mode
        : (daily && typeof daily.execution_mode === 'string' ? daily.execution_mode : undefined),
    creator_instruction:
      ((r as any).creator_card ?? daily?.creator_instruction) &&
      typeof ((r as any).creator_card ?? daily?.creator_instruction) === 'object'
        ? ((r as any).creator_card ?? daily?.creator_instruction) as Record<string, unknown>
        : undefined,
    distribution_strategy:
      typeof (r as any).distribution_strategy === 'string'
        ? (r as any).distribution_strategy
        : undefined,
    source_type: 'DAILY_PLAN_ROW',
    daily_plan_id: (r as any).id != null ? String((r as any).id) : undefined,
    scheduled_time:
      typeof (r as any).scheduledTime === 'string'
        ? (r as any).scheduledTime
        : (typeof (r as any).scheduled_time === 'string' ? (r as any).scheduled_time : undefined),
    topic:
      String((r as any).topic ?? '').trim() ||
      (daily && typeof daily.topicTitle === 'string' ? daily.topicTitle : undefined),
    master_content_id:
      typeof (r as any).master_content_id === 'string'
        ? (r as any).master_content_id
        : (daily && typeof daily.master_content_id === 'string' ? daily.master_content_id : undefined),
    writer_content_brief:
      daily && typeof daily === 'object' ? (daily as Record<string, unknown>) : undefined,
    intent: daily && typeof (daily as any).intent === 'object' ? (daily as any).intent as Record<string, unknown> : undefined,
  };

  devLog(unit);
  return unit;
}

/**
 * Apply normalized fields from UnifiedExecutionUnit back onto an existing daily-plan response object.
 * Used so API response shape is unchanged but values are adapter-normalized.
 */
export function applyUnifiedToDailyPlanResponse<T extends Record<string, unknown>>(
  existing: T,
  unit: UnifiedExecutionUnit
): T {
  return {
    ...existing,
    title: unit.title,
    platform: unit.platform,
    contentType: unit.content_type ?? (existing as any).contentType,
    dayOfWeek: unit.day ?? (existing as any).dayOfWeek ?? (existing as any).day_of_week,
    description: unit.description ?? (existing as any).description,
    topic: unit.topic ?? (existing as any).topic,
  };
}
