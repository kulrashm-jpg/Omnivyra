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
  status: 'idle' | 'scheduled' | 'published' | 'error';
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
