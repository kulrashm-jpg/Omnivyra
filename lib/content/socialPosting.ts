import type { NextRouter } from 'next/router';

export type SocialPostingContentType =
  | 'post'
  | 'thread'
  | 'blog'
  | 'article'
  | 'guide'
  | 'story'
  | 'whitepaper'
  | 'case-study'
  | 'newsletter'
  | 'carousel'
  | 'image'
  | 'banner'
  | 'infographic'
  | 'pdf'
  | 'slider';

export type SocialPostingDraft = {
  title: string;
  topic: string;
  content: string;
  hashtags: string[];
  sourceContentType: SocialPostingContentType;
  sourceId?: string | null;
  // Wave 1 (item 8) — the canonical Content id (public.content) this draft was
  // produced from. When present, the scheduler reads persisted content by id
  // (the DB is source of truth; this sessionStorage draft becomes a transient
  // cache/fallback) and persists per-platform variants + lifecycle advances back
  // to it. Additive/optional — absent on legacy handoffs ⇒ unchanged behavior.
  contentId?: string | null;
  excerpt?: string | null;
  masterContent?: Record<string, unknown> | null;
  mediaUrls?: string[];
  mediaTypes?: string[];
  creatorAttachments?: Array<Record<string, unknown>>;
  sourcePlatform?: string | null;
  // WS1 client half — the strategic objective that produced this content, so it
  // survives the handoff into the scheduler (resolved into DraftPayload.objective).
  objective?: string | null;
};

export type SocialPostingPrefillPayload = {
  draft: SocialPostingDraft;
};

export function getSocialPostingLabel(contentType: string) {
  switch (contentType) {
    case 'case-study':
      return 'Case Study';
    case 'whitepaper':
      return 'Whitepaper';
    default:
      return contentType
        .split('-')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
  }
}

export function launchSocialPostingFromContent({
  router,
  contentType,
  title,
  content,
  tags,
  excerpt,
  sourceId,
  platform,
  mediaUrls,
  mediaTypes,
  creatorAttachments,
  intent,
  objective,
  contentId,
}: {
  router: NextRouter;
  contentType: SocialPostingContentType;
  title: string;
  content: string;
  tags?: string[] | null;
  excerpt?: string | null;
  sourceId?: string | null;
  platform?: string | null;
  mediaUrls?: string[] | null;
  mediaTypes?: string[] | null;
  creatorAttachments?: Array<Record<string, unknown>> | null;
  intent?: 'schedule' | 'publish' | null;
  objective?: string | null;
  // Wave 1 (item 8) — canonical Content id carried through the handoff so the
  // scheduler can read persisted content by id. Optional; omit for legacy flows.
  contentId?: string | null;
}): boolean {
  if (typeof window === 'undefined') return false;

  const trimmedTitle = String(title || '').trim();
  const trimmedContent = String(content || '').trim();
  const trimmedExcerpt = String(excerpt || '').trim();

  if (!trimmedTitle || !trimmedContent) {
    return false;
  }

  const token = `social_posting_${contentType.replace(/[^a-z]/g, '_')}_${Date.now()}`;
  const hashtags = Array.isArray(tags)
    ? tags
        .map((tag) => String(tag || '').trim())
        .filter(Boolean)
        .map((tag) => (tag.startsWith('#') ? tag : `#${tag.replace(/^#+/, '')}`))
    : [];
  const normalizedMediaUrls = Array.isArray(mediaUrls)
    ? Array.from(new Set(mediaUrls.map((url) => String(url || '').trim()).filter(Boolean)))
    : [];
  const normalizedMediaTypes = Array.isArray(mediaTypes)
    ? mediaTypes.map((type) => String(type || '').trim()).filter(Boolean)
    : [];
  const normalizedCreatorAttachments = Array.isArray(creatorAttachments)
    ? creatorAttachments.filter((attachment) => attachment && typeof attachment === 'object')
    : [];
  // WS1 — carry the real objective only when the caller supplied one; never
  // fabricate a default. Null keeps the scheduler's objective resolution honest.
  const normalizedObjective = typeof objective === 'string' && objective.trim() ? objective.trim() : null;
  // Wave 1 (item 8) — normalize the canonical Content id. Absent ⇒ null, which
  // keeps the scheduler on its legacy sessionStorage-only path (backward compat).
  const normalizedContentId = typeof contentId === 'string' && contentId.trim() ? contentId.trim() : null;

  const payload: SocialPostingPrefillPayload = {
    draft: {
      title: trimmedTitle,
      topic: trimmedTitle,
      content: trimmedContent,
      hashtags,
      sourceContentType: contentType,
      sourceId: sourceId || null,
      contentId: normalizedContentId,
      excerpt: trimmedExcerpt || null,
      mediaUrls: normalizedMediaUrls,
      mediaTypes: normalizedMediaTypes,
      creatorAttachments: normalizedCreatorAttachments,
      sourcePlatform: platform || null,
      objective: normalizedObjective,
      masterContent: {
        content: trimmedContent,
        source_content_type: contentType,
        excerpt: trimmedExcerpt || null,
        source_id: sourceId || null,
        media_urls: normalizedMediaUrls,
        media_types: normalizedMediaTypes,
        creator_attachments: normalizedCreatorAttachments,
        objective: normalizedObjective,
      },
    },
  };

  sessionStorage.setItem(token, JSON.stringify(payload));
  void router.push({
    pathname: '/multi-platform-scheduler',
    query: {
      source: 'content-editor',
      contentType,
      prefill: token,
      topic: trimmedTitle,
      ...(sourceId ? { sourceId } : {}),
      ...(platform ? { platform } : {}),
      ...(intent ? { intent } : {}),
    },
  });
  return true;
}
