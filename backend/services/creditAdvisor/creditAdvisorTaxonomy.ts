/**
 * Credit Advisor — taxonomy helpers.
 *
 * Maps a raw consumption row's action key onto a product MODULE and a
 * human ACTIVITY label by reusing the canonical monetization registry
 * (shared/monetization/featureRegistry.ts). No new catalog is introduced.
 */

import {
  resolveFeatureFromActionKey,
  resolveFeatureFromProcessType,
} from '@/shared/monetization/featureRegistry';
import type { ModuleLabel } from './creditAdvisorTypes';

/**
 * Resolve a usage row's `action` to a registry feature. `credit_usage_log.action`
 * carries a wider vocabulary than the canonical action keys (it also stores
 * process-type-style names), so we try the action-key index first, then the
 * process-type index. Verified against real prod data — without the process-type
 * fallback, ~75% of resolvable spend mislabels as "Other".
 */
function resolveFeature(actionKey: string) {
  return resolveFeatureFromActionKey(actionKey) ?? resolveFeatureFromProcessType(actionKey);
}

/**
 * Credit-Advisor-LOCAL supplemental attribution (read-only — does NOT modify the
 * billing catalog). Covers live `credit_usage_log.action` values that the
 * monetization registry doesn't index. The 3 confirmed-from-prod-data values are
 * marked; the rest are high-confidence forward-looking entries from the documented
 * gateway operation keys so coverage stays high as charging expands. Registry
 * resolution always wins; this only fills gaps.
 */
const SUPPLEMENTAL_ACTION_MAP: Record<string, { module: ModuleLabel; activity: string }> = {
  // ── Confirmed from production credit_usage_log ──
  blog_brief_suggestions: { module: 'Content', activity: 'Blog briefs' },
  quick_platform_adapt: { module: 'Content', activity: 'Platform adaptation' },
  campaign_chat: { module: 'Campaigns', activity: 'Campaign chat' },
  // ── Forward-looking (documented gateway operation keys) ──
  generateCampaignPlan: { module: 'Campaigns', activity: 'Campaign planning' },
  parsePlanToWeeks: { module: 'Campaigns', activity: 'Campaign planning' },
  previewStrategy: { module: 'Campaigns', activity: 'Strategy preview' },
  optimizeWeek: { module: 'Campaigns', activity: 'Campaign optimization' },
  generateMasterContent: { module: 'Content', activity: 'Master content' },
  generateContentBlueprint: { module: 'Content', activity: 'Content blueprint' },
  generatePlatformVariants: { module: 'Content', activity: 'Platform variants' },
  blogGeneration: { module: 'Content', activity: 'Blog generation' },
  newsletterGeneration: { module: 'Content', activity: 'Newsletter' },
  creator_angles_generation: { module: 'Creator', activity: 'Creator angles' },
  creator_marketing_packaging: { module: 'Creator', activity: 'Creator packaging' },
  qualifyLead: { module: 'Intelligence', activity: 'Lead qualification' },
  qualifyPredictiveLead: { module: 'Intelligence', activity: 'Lead qualification' },
  generateMarketPulseForRegion: { module: 'Intelligence', activity: 'Market Pulse' },
  conversationTriage: { module: 'Engagement', activity: 'Conversation triage' },
  responseGeneration: { module: 'Engagement', activity: 'Reply generation' },
  engagement_reply_suggestions: { module: 'Engagement', activity: 'Reply suggestions' },
  sentiment_classification: { module: 'Engagement', activity: 'Sentiment' },
};

/** featureRegistry.category → operator-facing module label. */
const CATEGORY_TO_MODULE: Record<string, ModuleLabel> = {
  ai_generation: 'Content',
  campaigns: 'Campaigns',
  creator_content: 'Creator',
  intelligence: 'Intelligence',
  engagement_center: 'Engagement',
  reports: 'Reports',
  automation: 'Automation',
  external_usage: 'External',
  internal: 'Internal',
};

/**
 * Resolve the product module for a billing action key.
 * Falls back to 'Other' for unknown keys (never throws).
 */
export function moduleForActionKey(actionKey: string | null | undefined): ModuleLabel {
  if (!actionKey) return 'Other';
  const feature = resolveFeature(actionKey);
  if (feature) return CATEGORY_TO_MODULE[feature.category] ?? 'Other';
  return SUPPLEMENTAL_ACTION_MAP[actionKey]?.module ?? 'Other';
}

/** True when the action resolves to a real module (not "Other"). */
export function isAttributed(actionKey: string | null | undefined): boolean {
  return moduleForActionKey(actionKey) !== 'Other';
}

/**
 * Resolve a finer activity label (the registry display_group) for an action key.
 * e.g. "Campaigns", "AI Replies", "Lead Detection". Falls back to the raw key.
 */
export function activityForActionKey(actionKey: string | null | undefined): string {
  if (!actionKey) return 'Other';
  const feature = resolveFeature(actionKey);
  return feature?.display_group ?? SUPPLEMENTAL_ACTION_MAP[actionKey]?.activity ?? actionKey;
}

/**
 * Heuristic: does this action key represent a "deep"/heavy variant?
 * Used by optimization rule D (deep-variant overuse). Deterministic, no AI.
 */
const DEEP_ACTION_KEYS = new Set<string>([
  'deep_analysis',
  'full_strategy',
  'market_positioning',
]);

export function isDeepVariant(actionKey: string | null | undefined): boolean {
  if (!actionKey) return false;
  const key = actionKey.toLowerCase();
  if (DEEP_ACTION_KEYS.has(key)) return true;
  return key.includes('deep') || key.includes('_long') || key.includes('pillar');
}
