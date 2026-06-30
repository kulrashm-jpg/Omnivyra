/**
 * Canonical lead-source taxonomy resolver.
 *
 * Maps any source signals to EXACTLY ONE canonical source. Deterministic, total
 * (always returns a value; `other` is the explicit fallback). It layers ON TOP of
 * the existing `sourceNormalizationService` vocabulary (category/origin) rather
 * than duplicating it: the backend facade enriches a raw string via that service,
 * then passes the structured signals here. A small raw-keyword map handles the
 * standalone case.
 */

import type { CanonicalLeadSource } from './types';

export const CANONICAL_LEAD_SOURCES: readonly CanonicalLeadSource[] = [
  'website', 'blog', 'social', 'engagement', 'community', 'marketpulse',
  'crm', 'import', 'manual', 'referral', 'partner', 'api', 'webhook', 'other',
] as const;

export const CANONICAL_LEAD_SOURCE_LABELS: Record<CanonicalLeadSource, string> = {
  website: 'Website',
  blog: 'Blog',
  social: 'Social',
  engagement: 'Engagement',
  community: 'Community',
  marketpulse: 'MarketPulse',
  crm: 'CRM',
  import: 'Import',
  manual: 'Manual',
  referral: 'Referral',
  partner: 'Partner',
  api: 'API',
  webhook: 'Webhook',
  other: 'Other',
};

export function isCanonicalLeadSource(value: unknown): value is CanonicalLeadSource {
  return typeof value === 'string' && (CANONICAL_LEAD_SOURCES as readonly string[]).includes(value);
}

export interface SourceSignals {
  /** Explicit canonical override (wins if valid). */
  canonicalSource?: string | null;
  /** opportunity_feed_items.opportunity_type — presence ⇒ community. */
  opportunityType?: string | null;
  /** marketpulse_signals.signal_category — presence ⇒ marketpulse. */
  marketPulseCategory?: string | null;
  /** lead_signals.source_type: 'engagement' | 'listening'. */
  signalSourceType?: string | null;
  /** Social platform key (linkedin/twitter/…). */
  platform?: string | null;
  /** From sourceNormalizationService.normalizeSource(): analytics|crm|email|… */
  unifiedSourceCategory?: string | null;
  /** From normalizeSource(): integration|import|manual|webhook|api|form_embed|crawler|… */
  unifiedSourceOrigin?: string | null;
  /** Free-text source (leads.source / campaigns.channel / crm record). */
  rawSource?: string | null;
  channel?: string | null;
}

const SOCIAL_PLATFORMS = new Set([
  'linkedin', 'twitter', 'x', 'facebook', 'instagram', 'youtube', 'reddit', 'tiktok', 'pinterest', 'threads', 'whatsapp',
]);

/** Strong raw keywords that map directly to a canonical source. */
const RAW_ALIASES: Record<string, CanonicalLeadSource> = {
  website: 'website', web: 'website', site: 'website', form: 'website', form_embed: 'website', landing: 'website', direct: 'website',
  blog: 'blog',
  social: 'social',
  engagement: 'engagement', dm: 'engagement', dms: 'engagement', comment: 'engagement', comments: 'engagement', mention: 'engagement', reply: 'engagement', inbox: 'engagement',
  community: 'community', listening: 'community',
  marketpulse: 'marketpulse', market_pulse: 'marketpulse',
  crm: 'crm', hubspot: 'crm', salesforce: 'crm', zoho: 'crm',
  import: 'import', csv: 'import', upload: 'import', data_upload: 'import',
  manual: 'manual', manual_entry: 'manual', sales: 'manual',
  referral: 'referral',
  partner: 'partner',
  api: 'api',
  webhook: 'webhook',
};

const norm = (v: unknown): string => String(v ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');

/**
 * Resolve exactly one canonical source. Precedence (highest first):
 * explicit → community(opportunity/listening) → marketpulse → engagement →
 * strong raw keyword → unified origin → unified category → social platform → other.
 */
export function resolveCanonicalSource(signals: SourceSignals): CanonicalLeadSource {
  const explicit = norm(signals.canonicalSource);
  if (explicit && isCanonicalLeadSource(explicit)) return explicit;

  if (norm(signals.signalSourceType) === 'listening' || norm(signals.opportunityType)) return 'community';
  if (norm(signals.marketPulseCategory)) return 'marketpulse';
  if (norm(signals.signalSourceType) === 'engagement') return 'engagement';

  const raw = norm(signals.rawSource);
  if (raw && RAW_ALIASES[raw]) return RAW_ALIASES[raw];

  const origin = norm(signals.unifiedSourceOrigin);
  if (origin === 'import') return 'import';
  if (origin === 'webhook') return 'webhook';
  if (origin === 'api') return 'api';
  if (origin === 'manual') return 'manual';
  if (origin === 'form_embed' || origin === 'crawler') return 'website';

  const cat = norm(signals.unifiedSourceCategory);
  if (cat === 'crm') return 'crm';
  if (cat === 'file') return 'import';
  if (cat === 'analytics') return 'website';
  if (cat === 'engagement') return 'engagement';

  if (SOCIAL_PLATFORMS.has(norm(signals.platform))) return 'social';

  return 'other';
}
