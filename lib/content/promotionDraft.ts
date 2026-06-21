/**
 * Promotion Draft model + client store (PHASE BLOG-PROMOTION-2).
 *
 * A Promotion Draft is a TEXT-ONLY platform-native promotional post derived
 * from a piece of long-form content (blog / article / guide / …). It is NOT a
 * creator asset — no images, carousels, infographics, or videos. Visual asset
 * generation remains exclusively owned by Creator Content.
 *
 * Each draft keeps `promotionalText` and `blogUrl` as SEPARATE fields. The URL
 * is never embedded into the adapted copy by the model; it is appended only at
 * send time (`composePromotionPayloadText`), which guarantees the canonical URL
 * survives every adaptation/regeneration layer — no step can strip it.
 *
 * Persistence here is the lightweight client store (localStorage), mirroring the
 * existing writer-attached-assets pattern. Scheduling and posting go through the
 * canonical backend engines (scheduler / social publishing); this store only
 * holds the editable draft state + status reflection.
 */

export type PromotionDraftStatus = 'draft' | 'scheduled' | 'posted' | 'failed';

export type PromotionContentType =
  | 'blog'
  | 'article'
  | 'guide'
  | 'newsletter'
  | 'whitepaper'
  | 'case-study'
  | 'story';

export interface PromotionDraft {
  contentId: string;
  contentType: PromotionContentType;
  platform: string;
  promotionalText: string;
  blogUrl: string; // canonical URL, or '' when the content is not yet published
  status: PromotionDraftStatus;
  statusDetail?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Sentinel surfaced when promotion is requested without a canonical URL. */
export const PROMOTION_URL_REQUIRED = 'PROMOTION_URL_REQUIRED' as const;

export const PROMOTION_URL_REQUIRED_MESSAGE =
  'Publish content before posting so a blog URL can be attached.';

/**
 * Client-side, platform-native character budgets used for the live counter.
 * Mirrors the server-side limits the publishing pipeline already enforces; the
 * counter is advisory (the backend remains the source of truth on send).
 */
export const PROMOTION_PLATFORM_CHAR_LIMITS: Record<string, number> = {
  x: 280,
  twitter: 280,
  linkedin: 3000,
  facebook: 63206,
  reddit: 40000,
  threads: 500,
  pinterest: 500,
  instagram: 2200,
};

export function promotionCharLimitFor(platform: string): number {
  return PROMOTION_PLATFORM_CHAR_LIMITS[platform.toLowerCase()] ?? 280;
}

/** True only for a real absolute http(s) URL — never a placeholder/relative path. */
function isRealUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\/\S+$/i.test(value.trim());
}

/**
 * Resolve the authoritative canonical URL for a piece of content.
 * Priority (spec #2): A. CMS published URL → B. Omnivyra hosted URL →
 * C. explicit canonical_url field. Fails CLOSED (returns '') when none exists —
 * never fabricates or returns a placeholder.
 */
export function resolveCanonicalContentUrl(input: {
  cmsPublishedUrl?: string | null; // A
  canonicalUrl?: string | null;    // C (explicit field on the record)
  status?: string | null;
  slug?: string | null;
  origin?: string | null;          // for the hosted /blog/<slug> fallback (B)
  hostedPathPrefix?: string;       // defaults to '/blog'
}): string {
  // A — CMS published URL (highest authority: it's the live, public destination).
  if (isRealUrl(input.cmsPublishedUrl)) return input.cmsPublishedUrl!.trim();

  // B — Omnivyra hosted URL, only once the content is actually published.
  const slug = typeof input.slug === 'string' ? input.slug.trim() : '';
  const published = String(input.status || '').toLowerCase() === 'published';
  if (published && slug && isRealUrl(input.origin)) {
    const prefix = (input.hostedPathPrefix || '/blog').replace(/\/+$/, '');
    return `${input.origin!.replace(/\/+$/, '')}${prefix}/${encodeURIComponent(slug)}`;
  }

  // C — explicit canonical_url field, if a real URL was stored on the record.
  if (isRealUrl(input.canonicalUrl)) return input.canonicalUrl!.trim();

  // Fail closed — no canonical URL exists yet.
  return '';
}

/**
 * Compose the final text sent to the scheduler/publisher: the edited
 * promotional copy with the canonical URL appended. The URL is added here (not
 * inside the copy) so it always survives adaptation. Returns the copy unchanged
 * when there is no URL (callers must gate on {@link PROMOTION_URL_REQUIRED}).
 */
export function composePromotionPayloadText(promotionalText: string, blogUrl: string): string {
  const text = String(promotionalText || '').trim();
  const url = String(blogUrl || '').trim();
  if (!url) return text;
  // Avoid duplicating the URL if the user already pasted it into the copy.
  if (text.includes(url)) return text;
  return `${text}\n\n${url}`;
}

// ── Client store (localStorage) ──────────────────────────────────────────────

function storeKey(contentType: string, contentId: string): string {
  return `promotion_drafts_${contentType}_${contentId || 'unsaved'}`;
}

export function readPromotionDrafts(contentType: string, contentId: string): PromotionDraft[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(storeKey(contentType, contentId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as PromotionDraft[]) : [];
  } catch {
    return [];
  }
}

export function upsertPromotionDraft(draft: PromotionDraft): PromotionDraft {
  if (typeof window === 'undefined') return draft;
  const current = readPromotionDrafts(draft.contentType, draft.contentId);
  const next = current.filter((d) => d.platform !== draft.platform);
  next.push(draft);
  try {
    window.localStorage.setItem(storeKey(draft.contentType, draft.contentId), JSON.stringify(next.slice(0, 24)));
  } catch {
    // Non-fatal: the in-memory workspace state remains the working source.
  }
  return draft;
}
