import { getPlatformRule, listPlatformRules, upsertPlatformRule } from '../db/platformPromotionStore';
import { OmniVyraAdvisory } from './omnivyraAdapterService';
import { getPlatformRules, isOmniVyraEnabled } from './omnivyraClientV1';

const fallbackRules: Array<any> = [
  {
    platform: 'linkedin',
    content_type: 'text',
    max_length: 3000,
    min_length: 50,
    allowed_formats: ['text'],
    frequency_per_week: 3,
    best_days: ['Tuesday', 'Wednesday', 'Thursday'],
    best_times: ['09:00'],
    required_fields: ['cta'],
    source: 'internal',
  },
  {
    platform: 'instagram',
    content_type: 'image',
    max_length: 2200,
    min_length: 50,
    allowed_formats: ['image', 'carousel'],
    frequency_per_week: 4,
    best_days: ['Wednesday', 'Friday', 'Sunday'],
    best_times: ['19:00'],
    required_fields: ['hashtags'],
    source: 'internal',
  },
  {
    platform: 'x',
    content_type: 'text',
    max_length: 280,
    min_length: 10,
    allowed_formats: ['text'],
    frequency_per_week: 5,
    best_days: ['Tuesday', 'Thursday'],
    best_times: ['12:00'],
    required_fields: [],
    source: 'internal',
  },
  {
    platform: 'youtube',
    content_type: 'video',
    max_length: 5000,
    min_length: 30,
    allowed_formats: ['video'],
    frequency_per_week: 2,
    best_days: ['Friday'],
    best_times: ['18:00'],
    required_fields: ['cta'],
    source: 'internal',
  },
  {
    platform: 'blog',
    content_type: 'blog',
    max_length: 5000,
    min_length: 300,
    allowed_formats: ['blog'],
    frequency_per_week: 2,
    best_days: ['Tuesday'],
    best_times: ['08:00'],
    required_fields: ['seo_title', 'seo_description'],
    source: 'internal',
  },
  {
    platform: 'tiktok',
    content_type: 'video',
    max_length: 1500,
    min_length: 15,
    allowed_formats: ['video'],
    frequency_per_week: 3,
    best_days: ['Thursday', 'Saturday'],
    best_times: ['20:00'],
    required_fields: ['hashtags'],
    source: 'internal',
  },
  {
    platform: 'podcast',
    content_type: 'audio',
    max_length: 3600,
    min_length: 60,
    allowed_formats: ['audio'],
    frequency_per_week: 2,
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
  omnivyraAdvisory?: OmniVyraAdvisory;
}): Promise<any> {
  const normalizedPlatform = input.platform.toLowerCase();
  const normalizedType = input.contentType.toLowerCase();

  if (isOmniVyraEnabled()) {
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
          min_length: payload.min_length ?? payload.minLength ?? null,
          allowed_formats: payload.allowed_formats ?? payload.allowedFormats ?? [],
          frequency_per_week: payload.frequency_per_week ?? payload.frequencyPerWeek ?? 1,
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
        };
      }
    } else {
      console.warn('OMNIVYRA_FALLBACK_PLATFORM_RULES', { reason: response.error?.message });
    }
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
      min_length: null,
      allowed_formats: [],
      frequency_per_week: 1,
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

  return rule;
}
