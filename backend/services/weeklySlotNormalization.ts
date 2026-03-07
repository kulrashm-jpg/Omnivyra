/**
 * Weekly Slot Normalization
 * BOLT-controlled slot count: ensures exactly N slots per week.
 * Rule-based, deterministic, no LLM.
 */

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

/**
 * Deterministic day allocation for N posts per week.
 * 2 posts → Tue, Thu
 * 3 posts → Mon, Wed, Fri
 * 4 posts → Mon, Tue, Thu, Fri
 * 5 posts → Mon–Fri
 * 6 posts → Mon–Fri + Sat
 * 7 posts → Mon–Sun
 *
 * @returns Array of day indices (1 = Monday … 7 = Sunday)
 */
export function allocatePostingDays(postsPerWeek: number): number[] {
  const n = Math.max(2, Math.min(7, Math.floor(postsPerWeek)));
  switch (n) {
    case 2:
      return [2, 4]; // Tue, Thu
    case 3:
      return [1, 3, 5]; // Mon, Wed, Fri
    case 4:
      return [1, 2, 4, 5]; // Mon, Tue, Thu, Fri
    case 5:
      return [1, 2, 3, 4, 5]; // Mon–Fri
    case 6:
      return [1, 2, 3, 4, 5, 6]; // Mon–Fri + Sat
    case 7:
      return [1, 2, 3, 4, 5, 6, 7]; // Mon–Sun
    default:
      return [1, 3, 5]; // fallback: Mon, Wed, Fri
  }
}

export type SlotLike = {
  day_index?: number;
  day_name?: string;
  short_topic?: string;
  full_topic?: string;
  content_type?: string;
  platform?: string;
  reasoning?: string;
};

/**
 * Default placeholder texts when campaignTheme is missing.
 */
const FALLBACK_SHORT_TOPIC = 'Campaign insight';
const FALLBACK_FULL_TOPIC = 'Insight related to the campaign theme';

/**
 * Build placeholder short_topic and full_topic from optional campaign theme.
 */
export function buildPlaceholderTopicTexts(campaignTheme?: string): { short_topic: string; full_topic: string } {
  const theme = typeof campaignTheme === 'string' ? campaignTheme.trim() : '';
  if (theme) {
    return {
      short_topic: `${theme} insight`,
      full_topic: `A key insight related to ${theme}`,
    };
  }
  return {
    short_topic: FALLBACK_SHORT_TOPIC,
    full_topic: FALLBACK_FULL_TOPIC,
  };
}

/**
 * Normalize slots to exact target count.
 * - Too many: trim excess, assign days by index
 * - Too few: fill with placeholders, assign days by index
 *
 * @param slots AI-generated or existing slots
 * @param targetCount Exact number of slots (posts_per_week)
 * @param createPlaceholder Factory for placeholder slots (receives campaignTheme when provided)
 * @param campaignTheme Optional weekly/campaign theme for placeholder alignment
 */
export function normalizeSlotsToCount<T extends SlotLike>(
  slots: T[],
  targetCount: number,
  createPlaceholder: (dayIndex: number, dayName: string, index: number, campaignTheme?: string) => T,
  campaignTheme?: string
): T[] {
  const count = Math.max(2, Math.min(7, Math.floor(targetCount)));
  const postingDays = allocatePostingDays(count);

  let result: T[];

  if (slots.length > count) {
    result = slots.slice(0, count);
  } else if (slots.length < count) {
    const placeholders: T[] = [];
    for (let i = slots.length; i < count; i++) {
      const dayIndex = postingDays[i] ?? postingDays[0] ?? 1;
      const dayName = DAY_NAMES[dayIndex - 1] ?? 'Monday';
      placeholders.push(createPlaceholder(dayIndex, dayName, i, campaignTheme));
    }
    result = [...slots, ...placeholders];
  } else {
    result = [...slots];
  }

  // Assign days by index
  for (let i = 0; i < result.length; i++) {
    const dayIndex = postingDays[i] ?? postingDays[0] ?? 1;
    const dayName = DAY_NAMES[dayIndex - 1] ?? 'Monday';
    (result[i] as SlotLike).day_index = dayIndex;
    (result[i] as SlotLike).day_name = dayName;
  }

  return result;
}
