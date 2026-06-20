import { getPlatformRule, listPlatformRules, upsertPlatformRule } from '../db/platformPromotionStore';
import { OmnivyraAdvisory } from './omnivyraAdapterService';
import { getPlatformRules, isOmnivyraEnabled } from './omnivyraClientV1';
import { setLastFallbackReason } from './omnivyraHealthService';

// Phase 6B-2: `allowed_formats` removed from these platform rules. It was a
// latent, never-consumed "platform → format" list (no gate/validator/scheduler/
// publisher ever read it) that risked becoming a second platform-capability
// authority competing with PLATFORM_CAPABILITY_REGISTRY. Platform↔format
// capability is owned solely by that registry. (The vestigial `platform_rules`
// DB column remains, defaulting to '[]'; dropping it is a future migration.)
const fallbackRules: Array<any> = [
  {
    platform: 'linkedin',
    content_type: 'text',
    max_length: 3000,
    min_length: 50,    frequency_per_week: 3,
    best_days: ['Tuesday', 'Wednesday', 'Thursday'],
    best_times: ['09:00'],
    required_fields: ['cta'],
    source: 'internal',
  },
  {
    platform: 'instagram',
    content_type: 'image',
    max_length: 2200,
    min_length: 50,    frequency_per_week: 4,
    best_days: ['Wednesday', 'Friday', 'Sunday'],
    best_times: ['19:00'],
    required_fields: ['hashtags'],
    source: 'internal',
  },
  {
    platform: 'x',
    content_type: 'text',
    max_length: 280,
    min_length: 10,    frequency_per_week: 5,
    best_days: ['Tuesday', 'Thursday'],
    best_times: ['12:00'],
    required_fields: [],
    source: 'internal',
  },
  {
    platform: 'youtube',
    content_type: 'video',
    max_length: 5000,
    min_length: 30,    frequency_per_week: 2,
    best_days: ['Friday'],
    best_times: ['18:00'],
    required_fields: ['cta'],
    source: 'internal',
  },
  {
    platform: 'blog',
    content_type: 'blog',
    max_length: 5000,
    min_length: 300,    frequency_per_week: 2,
    best_days: ['Tuesday'],
    best_times: ['08:00'],
    required_fields: ['seo_title', 'seo_description'],
    source: 'internal',
  },
  {
    platform: 'tiktok',
    content_type: 'video',
    max_length: 1500,
    min_length: 15,    frequency_per_week: 3,
    best_days: ['Thursday', 'Saturday'],
    best_times: ['20:00'],
    required_fields: ['hashtags'],
    source: 'internal',
  },
  {
    platform: 'podcast',
    content_type: 'audio',
    max_length: 3600,
    min_length: 60,    frequency_per_week: 2,
    best_days: ['Monday'],
    best_times: ['08:00'],
    required_fields: ['cta'],
    source: 'internal',
  },
];

export async function ensureFallbackPlatformRules(): Promise<void> {
  const existing = await listPlatformRules();
  if (existing.length > 0) return;
  for (const rule of fallbackRules) {
    await upsertPlatformRule(rule);
  }
}

export async function getRulesForPlatform(input: {
  platform: string;
  contentType: string;
  omnivyraAdvisory?: OmnivyraAdvisory;
}): Promise<any> {
  const normalizedPlatform = input.platform.toLowerCase();
  const normalizedType = input.contentType.toLowerCase();

  let fallbackReason: string | null = null;
  if (isOmnivyraEnabled()) {
    const response = await getPlatformRules({
      platform: normalizedPlatform,
      contentType: normalizedType,
    });
    if (response.status === 'ok') {
      const payload = response.data?.rule || response.data?.rules?.[0];
      if (payload) {
        return {
          platform: normalizedPlatform,
          content_type: normalizedType,
          max_length: payload.max_length ?? payload.maxLength ?? null,
          min_length: payload.min_length ?? payload.minLength ?? null,          frequency_per_week: payload.frequency_per_week ?? payload.frequencyPerWeek ?? 1,
          best_days: payload.best_days ?? payload.bestDays ?? [],
          best_times: payload.best_times ?? payload.bestTimes ?? [],
          required_fields: payload.required_fields ?? payload.requiredFields ?? [],
          source: 'omnivyra',
          omnivyra: {
            decision_id: response.decision_id,
            confidence: response.confidence,
            placeholders: response.placeholders,
            explanation: response.explanation,
            contract_version: response.contract_version,
            partial: response.partial,
          },
          fallback_reason: null,
        };
      }
    } else {
      fallbackReason = (response._omnivyra_meta?.error_type || 'omnivyra_unavailable') as string;
      setLastFallbackReason(fallbackReason);
      console.warn('OMNIVYRA_FALLBACK_PLATFORM_RULES', { reason: response.error?.message });
    }
  } else {
    fallbackReason = 'omnivyra_disabled';
    setLastFallbackReason(fallbackReason);
  }

  let rule = await getPlatformRule(normalizedPlatform, normalizedType);
  if (!rule) {
    rule =
      fallbackRules.find(
        (item) => item.platform === normalizedPlatform && item.content_type === normalizedType
      ) ||
      fallbackRules.find((item) => item.platform === normalizedPlatform) ||
      null;
  }
  if (!rule) {
    rule = {
      platform: normalizedPlatform,
      content_type: normalizedType,
      max_length: null,
      min_length: null,      frequency_per_week: 1,
      best_days: [],
      best_times: [],
      required_fields: [],
      source: 'placeholder',
    };
  }

  if (input.omnivyraAdvisory?.source === 'omnivyra') {
    rule = {
      ...rule,
      source: 'omnivyra',
    };
  }

  return {
    ...rule,
    fallback_reason: fallbackReason,
  };
}
