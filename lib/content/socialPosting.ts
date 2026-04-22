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
  excerpt?: string | null;
  masterContent?: Record<string, unknown> | null;
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
}: {
  router: NextRouter;
  contentType: SocialPostingContentType;
  title: string;
  content: string;
  tags?: string[] | null;
  excerpt?: string | null;
  sourceId?: string | null;
}) {
  if (typeof window === 'undefined') return;

  const trimmedTitle = String(title || '').trim();
  const trimmedContent = String(content || '').trim();
  const trimmedExcerpt = String(excerpt || '').trim();

  if (!trimmedTitle || !trimmedContent) {
    throw new Error('Add a title and draft content before sharing to social.');
  }

  const token = `social_posting_${contentType.replace(/[^a-z]/g, '_')}_${Date.now()}`;
  const hashtags = Array.isArray(tags)
    ? tags
        .map((tag) => String(tag || '').trim())
        .filter(Boolean)
        .map((tag) => (tag.startsWith('#') ? tag : `#${tag.replace(/^#+/, '')}`))
    : [];

  const payload: SocialPostingPrefillPayload = {
    draft: {
      title: trimmedTitle,
      topic: trimmedTitle,
      content: trimmedContent,
      hashtags,
      sourceContentType: contentType,
      sourceId: sourceId || null,
      excerpt: trimmedExcerpt || null,
      masterContent: {
        content: trimmedContent,
        source_content_type: contentType,
        excerpt: trimmedExcerpt || null,
        source_id: sourceId || null,
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
    },
  });
}
