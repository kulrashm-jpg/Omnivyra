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
 * Persistence is DB-backed via the dedicated /api/promotion-drafts route
 * (table: promotion_drafts), so drafts survive refresh, logout/login, browser
 * crash, and are available cross-device. Scheduling and posting go through the
 * canonical backend engines (scheduler / social publishing).
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

// ── DB-backed store (via /api/promotion-drafts) ──────────────────────────────

/** Load all saved promotion drafts for a piece of content (org-scoped server-side). */
export async function loadPromotionDrafts(
  companyId: string,
  contentType: string,
  contentId: string,
): Promise<PromotionDraft[]> {
  const params = new URLSearchParams({ companyId, contentType, contentId });
  const resp = await fetch(`/api/promotion-drafts?${params.toString()}`, { credentials: 'include' });
  if (!resp.ok) throw new Error(`Failed to load promotion drafts (status ${resp.status}).`);
  const data = await resp.json().catch(() => ({}));
  const rows = Array.isArray(data?.drafts) ? data.drafts : [];
  return rows as PromotionDraft[];
}

/** Save or update (upsert) a single platform's promotion draft. */
export async function savePromotionDraft(input: {
  companyId: string;
  contentId: string;
  contentType: PromotionContentType;
  platform: string;
  promotionalText: string;
  canonicalUrl: string;
  status: PromotionDraftStatus;
}): Promise<PromotionDraft | null> {
  const resp = await fetch('/api/promotion-drafts', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!resp.ok) throw new Error(`Failed to save promotion draft (status ${resp.status}).`);
  const data = await resp.json().catch(() => ({}));
  return (data?.draft ?? null) as PromotionDraft | null;
}

/** Delete a saved draft — a single platform's, or all for the content when platform is omitted. */
export async function deletePromotionDraft(
  companyId: string,
  contentType: string,
  contentId: string,
  platform?: string,
): Promise<boolean> {
  const resp = await fetch('/api/promotion-drafts', {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyId, contentType, contentId, ...(platform ? { platform } : {}) }),
  });
  if (!resp.ok) throw new Error(`Failed to delete promotion draft (status ${resp.status}).`);
  return true;
}
