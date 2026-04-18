export type ConnectedAccount = {
  platform_key: string;
  platform_label: string;
  social_account_id: string | null;
  account_name: string | null;
  username: string | null;
  connected: boolean;
  category: string;
};

export type PlatformConfigItem = {
  platform: string;
  content_types: string[];
};

export type DraftPayload = {
  title: string;
  topic: string;
  content: string;
  hashtags: string[];
  excerpt?: string | null;
  sourceContentType?: string | null;
  sourceId?: string | null;
  masterContent?: Record<string, unknown> | null;
  sourcePlatform?: string | null;
};

export type PlatformState = {
  contentType: string;
  content: string;
  hashtags: string;
  scheduledFor: string;
  busy: boolean;
  message: string | null;
  scheduledPostId?: string | null;
  status: 'idle' | 'scheduled' | 'published' | 'error';
};

export type PlatformOption = {
  key: string;
  label: string;
  socialAccountId: string | null;
  accountName: string | null;
  contentTypes: string[];
};

export function normalizePlatform(value: string) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'twitter') return 'x';
  return normalized;
}

export function parseHashtags(text: string) {
  return text
    .split(/\s+/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map((tag) => (tag.startsWith('#') ? tag : `#${tag.replace(/^#+/, '')}`));
}

function toDatetimeLocal(value: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

export function defaultScheduleValue() {
  const next = new Date();
  next.setHours(next.getHours() + 1, 0, 0, 0);
  return toDatetimeLocal(next);
}

export function getContentTypeLabel(contentType: string) {
  switch (String(contentType || '').trim().toLowerCase()) {
    case 'case-study':
      return 'Case Study';
    case 'idea_pin':
      return 'Idea Pin';
    case 'whitepaper':
      return 'Whitepaper';
    default:
      return String(contentType || 'post')
        .split('-')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
  }
}

export function resolveSocialPublishType(sourceContentType: string, platformOption: PlatformOption | null) {
  const source = String(sourceContentType || 'post').trim().toLowerCase();
  const platformKey = normalizePlatform(platformOption?.key || '');
  const available = Array.isArray(platformOption?.contentTypes)
    ? platformOption!.contentTypes.map((type) => String(type || '').trim().toLowerCase()).filter(Boolean)
    : [];

  if (available.length === 0) {
    return source === 'thread' ? 'thread' : 'post';
  }

  if (available.includes(source)) return source;
  if (platformKey === 'pinterest' && available.includes('idea_pin') && ['post', 'article', 'blog', 'guide', 'newsletter', 'case-study', 'whitepaper'].includes(source)) {
    return 'idea_pin';
  }
  if (source === 'blog' && available.includes('article')) return 'article';
  if (['article', 'guide', 'whitepaper', 'case-study', 'newsletter'].includes(source) && available.includes('article')) {
    return 'article';
  }
  if (available.includes('post')) return 'post';
  return available[0] || 'post';
}
