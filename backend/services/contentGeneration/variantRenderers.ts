import type { ContentBlueprint } from '../contentBlueprintCache';
import { nonEmpty, X_CHAR_LIMIT } from './contentTypeHelpers';
import type { PlatformVariantPayload } from './types';

export type DiscoverabilityMeta = NonNullable<PlatformVariantPayload['discoverability_meta']>;

export { X_CHAR_LIMIT };

/** Platforms that can be derived deterministically from LinkedIn-style full text. */
export const DETERMINISTIC_DERIVABLE = new Set(['x', 'twitter', 'facebook', 'instagram']);

/** Check if platform can use deterministic rendering from a source (e.g. linkedin). */
export function canDeriveDeterministically(platform: string): boolean {
  return DETERMINISTIC_DERIVABLE.has(nonEmpty(platform).toLowerCase());
}

export function buildVariantOnlyMasterFallback(
  execution_id: string | undefined,
  content_type: string | undefined,
  topic: string | undefined,
  title: string | undefined,
  platform: string | undefined,
  isMediaDependent: boolean,
  sanitizeIdPart: (v: unknown) => string,
): import('./types').MasterContentPayload {
  const itemId = sanitizeIdPart(execution_id || title || topic || platform || 'daily-item');
  const topicStr = nonEmpty(topic) || nonEmpty(title) || 'TBD topic';
  if (isMediaDependent) {
    return {
      id: `master-${itemId}`,
      generated_at: new Date().toISOString(),
      content: `[MEDIA BLUEPRINT]\nTopic: ${topicStr}\nObjective: TBD objective\nCore message: TBD core message`,
      generation_status: 'generated',
      generation_source: 'ai',
      content_type_mode: 'media_blueprint',
      required_media: true,
      media_status: 'missing',
    };
  }
  return {
    id: `master-${itemId}`,
    generated_at: new Date().toISOString(),
    content: `[MASTER GENERATION FAILED — deterministic fallback]\nTopic: ${topicStr}`,
    generation_status: 'failed',
    generation_source: 'ai',
    content_type_mode: 'text',
  };
}

export function isPlaceholderLikeContent(content: unknown): boolean {
  const text = nonEmpty(content);
  if (!text) return true;
  return (
    text.includes('[MASTER CONTENT PLACEHOLDER]') ||
    text.includes('[MEDIA BLUEPRINT]') ||
    text.includes('[MASTER GENERATION FAILED')
  );
}

export function isAiGeneratedMasterContent(master: unknown): boolean {
  const obj = master && typeof master === 'object' && !Array.isArray(master)
    ? (master as Record<string, unknown>)
    : null;
  if (!obj) return false;
  const status = nonEmpty(obj.generation_status).toLowerCase();
  if (status !== 'generated') return false;
  const content = nonEmpty(obj.content);
  return Boolean(content) && !isPlaceholderLikeContent(content);
}

/** Convert blueprint to full master text for backward compatibility. */
export function blueprintToFullText(bp: ContentBlueprint): string {
  const body = Array.isArray(bp.key_points) && bp.key_points.length > 0
    ? bp.key_points.join('\n\n')
    : '';
  const parts = [nonEmpty(bp.hook), body, nonEmpty(bp.cta)].filter(Boolean);
  return parts.join('\n\n');
}

/** Truncate text to maxChars at word boundary. */
export function truncateAtWordBoundary(text: string, maxChars: number): string {
  const s = String(text ?? '').trim();
  if (s.length <= maxChars) return s;
  const cut = s.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace > maxChars * 0.6) return cut.slice(0, lastSpace).trim();
  return cut.trim();
}

/** Strip excessive hashtags (keep max N). */
export function stripExcessiveHashtags(text: string, maxHashtags: number): string {
  const parts = String(text ?? '').split(/(\s+#\w+)/g);
  const hashtags: string[] = [];
  const rest: string[] = [];
  for (const p of parts) {
    if (/^\s*#\w+/.test(p)) {
      hashtags.push(p.trim());
    } else {
      rest.push(p);
    }
  }
  const kept = hashtags.slice(0, maxHashtags);
  return [...rest.filter(Boolean), ...kept].join(' ').replace(/\s+/g, ' ').trim();
}

/** Shorten long sentences for X (split by period, trim). */
export function shortenSentences(text: string): string {
  return String(text ?? '')
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join('. ')
    .trim();
}

/** LinkedIn: full text, allow bullet formatting, maintain spacing. */
export function renderLinkedInVariant(masterText: string): string {
  return String(masterText ?? '').trim();
}

/** Extract CTA-like ending (last sentence often contains CTA). */
export function extractCtaFromText(text: string): string | null {
  const s = String(text ?? '').trim();
  if (!s) return null;
  const sentences = s.split(/[.!?]+/).map((x) => x.trim()).filter(Boolean);
  if (sentences.length === 0) return null;
  const last = sentences[sentences.length - 1] ?? '';
  if (last.length < 10) return null;
  const ctaMarkers = ['learn more', 'book', 'contact', 'start', 'join', 'subscribe', 'follow', 'try', 'download', 'link in bio', 'click'];
  const lower = last.toLowerCase();
  if (ctaMarkers.some((m) => lower.includes(m))) return last;
  return null;
}

/** X/Twitter: truncate 280, remove excessive hashtags (>2), preserve CTA if truncated away. */
export function renderXVariant(masterText: string, cta?: string | null): string {
  let out = shortenSentences(masterText ?? '');
  out = stripExcessiveHashtags(out, 2);
  let result = truncateAtWordBoundary(out, X_CHAR_LIMIT);
  const extractedCta = cta ?? extractCtaFromText(masterText);
  if (extractedCta && !result.toLowerCase().includes(extractedCta.toLowerCase().slice(0, 20))) {
    const append = ` ${extractedCta}`.trim();
    const withCta = truncateAtWordBoundary(result + append, X_CHAR_LIMIT);
    if (withCta.length > result.length) result = withCta;
  }
  return result;
}

/** Instagram: append hashtags from discoverability, allow emoji. */
export function renderInstagramVariant(
  masterText: string,
  discoverabilityMeta?: DiscoverabilityMeta,
  maxLength?: number | null
): string {
  let out = String(masterText ?? '').trim();
  if (discoverabilityMeta?.hashtags?.length) {
    const tags = discoverabilityMeta.hashtags.slice(0, 8).join(' ');
    const candidate = `${out}\n\n${tags}`.trim();
    const limit = maxLength ?? 2200;
    out = candidate.length <= limit ? candidate : out;
  }
  return out;
}

/** Facebook: reuse LinkedIn variant (same format). */
export function renderFacebookVariant(masterText: string): string {
  return renderLinkedInVariant(masterText);
}

/**
 * Deterministic platform rendering rules.
 * LinkedIn → full text; X → truncate 280, strip hashtags, preserve CTA; Instagram → append hashtags; Facebook → LinkedIn.
 */
export function renderDeterministicVariant(
  masterText: string,
  platform: string,
  maxLength?: number | null,
  discoverabilityMeta?: DiscoverabilityMeta,
  cta?: string | null
): string {
  const p = nonEmpty(platform).toLowerCase();
  if (p === 'linkedin') return renderLinkedInVariant(masterText);
  if (p === 'x' || p === 'twitter') return renderXVariant(masterText, cta);
  if (p === 'instagram') return renderInstagramVariant(masterText, discoverabilityMeta, maxLength);
  if (p === 'facebook') return renderFacebookVariant(masterText);
  if (maxLength && maxLength > 0) return truncateAtWordBoundary(masterText, maxLength);
  return String(masterText ?? '').trim();
}

/** Carousel: slide_1=hook, slide_2-4=key_points, slide_5=cta. */
export function renderCarouselFromBlueprint(bp: ContentBlueprint): string[] {
  const slides: string[] = [];
  if (nonEmpty(bp.hook)) slides.push(bp.hook);
  const pts = Array.isArray(bp.key_points) ? bp.key_points.filter(Boolean) : [];
  for (const pt of pts) slides.push(String(pt ?? '').trim());
  if (nonEmpty(bp.cta)) slides.push(bp.cta);
  return slides.length > 0 ? slides : [blueprintToFullText(bp)];
}

/** Short video script: intro=hook, body=key_points, ending=cta. */
export function renderVideoScriptFromBlueprint(bp: ContentBlueprint): string {
  const intro = nonEmpty(bp.hook) ? `[INTRO]\n${bp.hook}` : '';
  const body = Array.isArray(bp.key_points) && bp.key_points.length > 0
    ? `[BODY]\n${bp.key_points.map((p) => `• ${p}`).join('\n')}`
    : '';
  const ending = nonEmpty(bp.cta) ? `[ENDING]\n${bp.cta}` : '';
  const parts = [intro, body, ending].filter(Boolean);
  return parts.length > 0 ? parts.join('\n\n') : blueprintToFullText(bp);
}
