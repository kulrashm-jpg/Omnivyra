export function scoreColour(s: number | null) {
  if (s == null) return 'text-gray-300';
  return s >= 70 ? 'text-emerald-600' : s >= 50 ? 'text-blue-600' : 'text-amber-600';
}

export function toSentenceCase(value: string | null | undefined) {
  if (!value) return null;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function parseTargetNumber(value: string | null | undefined) {
  if (!value) return null;
  const match = value.match(/[\d,.]+/);
  if (!match) return null;
  const parsed = Number.parseFloat(match[0].replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatContentTypeLabel(value: string) {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function formatPlatformLabel(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.toLowerCase();
  if (normalized === 'x') return 'X';
  if (normalized === 'linkedin') return 'LinkedIn';
  if (normalized === 'facebook') return 'Facebook';
  if (normalized === 'instagram') return 'Instagram';
  if (normalized === 'youtube') return 'YouTube';
  if (normalized === 'tiktok') return 'TikTok';
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

export function getContentRoute(contentType: string | null | undefined) {
  const normalized = String(contentType || '').trim().toLowerCase();
  const routeMap: Record<string, string> = {
    blog: '/admin/content',
    article: '/articles/create',
    post: '/posts/create',
    story: '/stories/create',
    whitepaper: '/whitepapers/create',
    'case-study': '/case-studies/create',
    case_study: '/case-studies/create',
    guide: '/guides/create',
    thread: '/threads/create',
    newsletter: '/newsletters/create',
  };
  return routeMap[normalized] ?? '/content';
}
