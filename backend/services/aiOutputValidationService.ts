/**
 * AI Output Validation Service
 * Centralized validation layer for AI outputs before they enter downstream execution stages.
 */

/** Validation repair counts for identifying prompt weaknesses. */
export const validationRepairCounts = {
  weekly_plan_repairs: 0,
  daily_slot_repairs: 0,
  blueprint_repairs: 0,
  variant_repairs: 0,
};

/** Reset metrics (e.g. per request). Call optionally before validation runs. */
export function resetValidationMetrics(): void {
  validationRepairCounts.weekly_plan_repairs = 0;
  validationRepairCounts.daily_slot_repairs = 0;
  validationRepairCounts.blueprint_repairs = 0;
  validationRepairCounts.variant_repairs = 0;
}

export function validateWeeklyPlan(plan: any) {
  if (!plan || !Array.isArray(plan.weeks)) {
    throw new Error('Invalid weekly plan structure');
  }

  const repaired = structuredClone(plan);
  let repairCount = 0;

  for (const week of repaired.weeks) {
    if (!week.theme || typeof week.theme !== 'string') {
      week.theme = 'Strategic Campaign Theme';
      repairCount++;
    }

    if (!week.primary_objective) {
      week.primary_objective = 'Drive audience engagement and authority';
      repairCount++;
    }

    if (!Array.isArray(week.topics_to_cover)) {
      week.topics_to_cover = [];
      repairCount++;
    }

    if (week.topics_to_cover.length < 2) {
      while (week.topics_to_cover.length < 2) {
        week.topics_to_cover.push('Strategic industry insights');
      }
      repairCount++;
    }

    if (week.topics_to_cover.length > 5) {
      week.topics_to_cover = week.topics_to_cover.slice(0, 5);
      repairCount++;
    }
  }

  if (repairCount > 0) validationRepairCounts.weekly_plan_repairs += repairCount;

  if (process.env.DEBUG_AI_VALIDATION === 'true') {
    console.info('AI output repaired', {
      type: 'weekly_plan',
      original: plan,
      repaired,
    });
  }

  return repaired;
}

export function validateDailySlots(slots: any[]) {
  if (!Array.isArray(slots)) return [];

  const original = process.env.DEBUG_AI_VALIDATION === 'true' ? structuredClone(slots) : null;

  const validated = slots.map((slot, index) => {
    const safeSlot = structuredClone(slot);
    let repaired = false;

    if (!safeSlot.day_index) {
      safeSlot.day_index = index + 1;
      repaired = true;
    }

    if (!safeSlot.short_topic) {
      safeSlot.short_topic = safeSlot.full_topic || 'Strategic content';
      repaired = true;
    }

    if (!safeSlot.full_topic) {
      safeSlot.full_topic = safeSlot.short_topic;
      repaired = true;
    }

    if (!safeSlot.content_type) {
      safeSlot.content_type = 'post';
      repaired = true;
    }

    if (repaired) validationRepairCounts.daily_slot_repairs++;
    return safeSlot;
  });

  if (process.env.DEBUG_AI_VALIDATION === 'true') {
    console.info('AI output repaired', {
      type: 'daily_slots',
      original,
      repaired: validated,
    });
  }

  return validated;
}

export function validateContentBlueprint(blueprint: any) {
  if (!blueprint) return null;

  const repaired = structuredClone(blueprint);
  let repairCount = 0;

  if (!repaired.hook) {
    repaired.hook = 'Key strategic insight';
    repairCount++;
  }

  if (!Array.isArray(repaired.key_points)) {
    repaired.key_points = [];
    repairCount++;
  }

  if (!repaired.cta) {
    repaired.cta = 'Learn more.';
    repairCount++;
  }

  if (repairCount > 0) validationRepairCounts.blueprint_repairs += repairCount;

  if (process.env.DEBUG_AI_VALIDATION === 'true') {
    console.info('AI output repaired', {
      type: 'blueprint',
      original: blueprint,
      repaired,
    });
  }

  return repaired;
}

export function validatePlatformVariants(variants: any[]) {
  if (!Array.isArray(variants)) return [];

  const validated = variants.filter((v) => v && v.generated_content);
  const removed = variants.length - validated.length;
  if (removed > 0) validationRepairCounts.variant_repairs += removed;

  if (process.env.DEBUG_AI_VALIDATION === 'true') {
    console.info('AI output repaired', {
      type: 'variants',
      original: variants,
      repaired: validated,
    });
  }

  return validated;
}
