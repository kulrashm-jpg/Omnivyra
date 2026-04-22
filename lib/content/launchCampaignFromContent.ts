import type { NextRouter } from 'next/router';

export type CampaignSourceContentType =
  | 'blog'
  | 'newsletter'
  | 'article'
  | 'guide'
  | 'story'
  | 'whitepaper'
  | 'case-study'
  | 'carousel'
  | 'image'
  | 'post'
  | 'thread'
  | 'banner'
  | 'infographic'
  | 'pdf'
  | 'slider';

export type CampaignSourcePayload = {
  origin: 'content_editor';
  contentType: CampaignSourceContentType;
  title: string;
  excerpt: string;
  tags: string[];
  targetWordCount?: number;
  formatType?: string | null;
  sourceId?: string | null;
  suggestedTopic: string;
  sourceTheme: {
    id?: string | null;
    topic: string;
    polished_title: string;
    summary: string;
    source: 'content_editor';
    content_type: CampaignSourceContentType;
    tags: string[];
    target_word_count?: number;
    format_type?: string | null;
  };
};

type LaunchInput = {
  router: NextRouter;
  contentType: CampaignSourceContentType;
  title: string;
  excerpt?: string | null;
  tags?: string[];
  targetWordCount?: number;
  formatType?: string | null;
  sourceId?: string | null;
  contentMarkdown?: string | null;
};

function stripText(value: string): string {
  return value.replace(/[#>*`_\-\[\]\(\)]/g, ' ').replace(/\s+/g, ' ').trim();
}

function buildFallbackExcerpt(markdown?: string | null): string {
  const clean = stripText(String(markdown ?? ''));
  return clean.slice(0, 220).trim();
}

export function buildCampaignSourcePayload(input: Omit<LaunchInput, 'router'>): CampaignSourcePayload {
  const title = String(input.title ?? '').trim();
  const excerpt = String(input.excerpt ?? '').trim() || buildFallbackExcerpt(input.contentMarkdown);
  const tags = Array.isArray(input.tags) ? input.tags.filter(Boolean).slice(0, 8) : [];
  const suggestedTopic = title || `${input.contentType} campaign idea`;

  return {
    origin: 'content_editor',
    contentType: input.contentType,
    title,
    excerpt,
    tags,
    targetWordCount: input.targetWordCount,
    formatType: input.formatType ?? null,
    sourceId: input.sourceId ?? null,
    suggestedTopic,
    sourceTheme: {
      id: input.sourceId ?? null,
      topic: suggestedTopic,
      polished_title: suggestedTopic,
      summary: excerpt || `Turn this ${input.contentType} into a campaign theme and execution plan.`,
      source: 'content_editor',
      content_type: input.contentType,
      tags,
      target_word_count: input.targetWordCount,
      format_type: input.formatType ?? null,
    },
  };
}

export function persistCampaignSourcePayload(payload: CampaignSourcePayload): string | null {
  if (typeof window === 'undefined') return null;
  const token = `campaign_source_${Date.now()}`;
  window.sessionStorage.setItem(token, JSON.stringify(payload));
  return token;
}

export function readCampaignSourcePayload(token: string | null | undefined): CampaignSourcePayload | null {
  if (!token || typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(token);
    if (!raw) return null;
    return JSON.parse(raw) as CampaignSourcePayload;
  } catch {
    return null;
  }
}

export function launchCampaignFromContent(input: LaunchInput): void {
  const payload = buildCampaignSourcePayload(input);
  const token = persistCampaignSourcePayload(payload);
  void input.router.push({
    pathname: '/command-center/campaigns',
    query: token ? { sourceContentToken: token } : undefined,
  });
}
