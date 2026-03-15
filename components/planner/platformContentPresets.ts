/**
 * Campaign presets for Platform Content Matrix.
 * Applied to platform_content_requests; filtered by company's allowed platforms.
 * Format compatible with planPreviewService, plannerIntegrityService, planner-finalize.
 */

import type { PlatformContentRequests } from './plannerSessionStore';

export type PresetId = 'thought_leadership' | 'product_launch' | 'lead_generation' | 'community_engagement';

export interface CampaignPreset {
  id: PresetId;
  label: string;
  /** Raw platform_content_requests — will be filtered by company config. */
  platform_content_requests: PlatformContentRequests;
}

export const CAMPAIGN_PRESETS: CampaignPreset[] = [
  {
    id: 'thought_leadership',
    label: 'Thought Leadership',
    platform_content_requests: {
      linkedin: { post: 3, carousel: 1 },
      twitter: { thread: 2 },
    },
  },
  {
    id: 'product_launch',
    label: 'Product Launch',
    platform_content_requests: {
      linkedin: { post: 2, carousel: 2 },
      youtube: { video: 1 },
      twitter: { post: 3 },
    },
  },
  {
    id: 'lead_generation',
    label: 'Lead Generation',
    platform_content_requests: {
      linkedin: { post: 2 },
      newsletter: { article: 1 },
      twitter: { thread: 2 },
    },
  },
  {
    id: 'community_engagement',
    label: 'Community Engagement',
    platform_content_requests: {
      linkedin: { post: 2 },
      twitter: { post: 3 },
      discord: { discussion: 2 },
    },
  },
];

/** Default frequency suggestions when user selects platform but no value entered. */
export const DEFAULT_FREQUENCY_SUGGESTIONS: Record<string, Record<string, number>> = {
  linkedin: { post: 2, carousel: 1 },
  youtube: { video: 1 },
  twitter: { thread: 2 },
  x: { thread: 2 },
};

/** Threshold per platform+content_type per week beyond which we show capacity warning. */
export const FREQUENCY_WARNING_THRESHOLD = 7;

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export interface DistributionPreviewItem {
  day: string;
  platform: string;
  contentType: string;
}

/**
 * Build deterministic posting distribution preview.
 * Spreads activities evenly across weekdays (Mon–Sun).
 */
export function buildDistributionPreview(
  matrix: PlatformContentRequests,
  platformLabels?: Record<string, string>
): DistributionPreviewItem[] {
  const slots: { platform: string; contentType: string }[] = [];
  for (const [p, ctMap] of Object.entries(matrix)) {
    for (const [ct, count] of Object.entries(ctMap ?? {})) {
      const n = Math.max(0, Math.min(14, Math.floor(Number(count) || 0)));
      for (let i = 0; i < n; i++) slots.push({ platform: p, contentType: ct });
    }
  }
  if (slots.length === 0) return [];
  const days = DAY_NAMES.length;
  const label = (plat: string) => platformLabels?.[plat] ?? plat.charAt(0).toUpperCase() + plat.slice(1).toLowerCase();
  return slots.map((s, i) => ({
    day: DAY_NAMES[Math.min(days - 1, Math.floor((i * days) / slots.length))],
    platform: label(s.platform),
    contentType: s.contentType.charAt(0).toUpperCase() + s.contentType.slice(1).toLowerCase(),
  }));
}

export interface ExceededFrequency {
  platform: string;
  contentType: string;
  count: number;
}

/** Returns platform+content_type entries exceeding FREQUENCY_WARNING_THRESHOLD. */
export function getExceededFrequencies(
  matrix: PlatformContentRequests,
  threshold = FREQUENCY_WARNING_THRESHOLD
): ExceededFrequency[] {
  const out: ExceededFrequency[] = [];
  for (const [platform, ctMap] of Object.entries(matrix)) {
    for (const [contentType, count] of Object.entries(ctMap ?? {})) {
      const n = Math.max(0, Math.floor(Number(count) || 0));
      if (n > threshold) out.push({ platform, contentType, count: n });
    }
  }
  return out;
}

/**
 * Auto-balance: distribute activities evenly across weekdays.
 * Keeps same total per platform+content_type; sanitizes to allowed set.
 */
export function autoBalanceMatrix(
  matrix: PlatformContentRequests,
  allowedPlatformContent: Map<string, Set<string>>
): PlatformContentRequests {
  const result: PlatformContentRequests = {};
  for (const [p, ctMap] of Object.entries(matrix)) {
    const allowed = allowedPlatformContent.get(p);
    if (!allowed) continue;
    result[p] = {};
    for (const [ct, count] of Object.entries(ctMap ?? {})) {
      if (!allowed.has(ct)) continue;
      const n = Math.max(0, Math.min(14, Math.floor(Number(count) || 0)));
      if (n > 0) result[p][ct] = n;
    }
    if (Object.keys(result[p]!).length === 0) delete result[p];
  }
  return result;
}
