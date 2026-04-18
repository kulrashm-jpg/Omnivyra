import { useState, useCallback } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ShareContentType = 'report' | 'blog' | 'campaign' | 'content';

export interface SharePayload {
  type: ShareContentType;
  id: string;
  title: string;
  description?: string;
  url?: string;         // explicit URL override
  imageUrl?: string;    // OG image
}

export interface ShareAction {
  platform: 'linkedin' | 'twitter' | 'facebook' | 'email' | 'copy' | 'download';
  contentType: ShareContentType;
  contentId: string;
  timestamp: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Share tracking (localStorage)
// ─────────────────────────────────────────────────────────────────────────────

const SHARE_LOG_KEY = 'omnivyra_share_log';

function logShareAction(action: ShareAction) {
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem(SHARE_LOG_KEY);
    const log: ShareAction[] = raw ? JSON.parse(raw) : [];
    log.push(action);
    // Keep last 100 entries
    localStorage.setItem(SHARE_LOG_KEY, JSON.stringify(log.slice(-100)));
  } catch {}
}

export function getShareStats(): { total: number; byPlatform: Record<string, number> } {
  if (typeof window === 'undefined') return { total: 0, byPlatform: {} };
  try {
    const raw = localStorage.getItem(SHARE_LOG_KEY);
    const log: ShareAction[] = raw ? JSON.parse(raw) : [];
    const byPlatform: Record<string, number> = {};
    for (const a of log) {
      byPlatform[a.platform] = (byPlatform[a.platform] || 0) + 1;
    }
    return { total: log.length, byPlatform };
  } catch { return { total: 0, byPlatform: {} }; }
}

// ─────────────────────────────────────────────────────────────────────────────
// URL builders
// ─────────────────────────────────────────────────────────────────────────────

function getBaseUrl(): string {
  if (typeof window !== 'undefined') return window.location.origin;
  return 'https://app.omnivyra.com';
}

function getShareUrl(payload: SharePayload): string {
  if (payload.url) return payload.url;

  const base = getBaseUrl();
  switch (payload.type) {
    case 'blog':     return `${base}/blog/${payload.id}`;
    case 'report':   return `${base}/share/report/${payload.id}`;
    case 'campaign': return `${base}/share/campaign/${payload.id}`;
    case 'content':  return `${base}/share/content/${payload.id}`;
    default:         return `${base}/share/${payload.type}/${payload.id}`;
  }
}

function getShareText(payload: SharePayload): string {
  return payload.description
    ? `${payload.title} — ${payload.description}`
    : payload.title;
}

// ─────────────────────────────────────────────────────────────────────────────
// Social share URL builders
// ─────────────────────────────────────────────────────────────────────────────

function linkedinShareUrl(url: string): string {
  return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;
}

function twitterShareUrl(url: string, text: string): string {
  return `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
}

function facebookShareUrl(url: string): string {
  return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
}

function emailShareUrl(url: string, title: string, text: string): string {
  const subject = encodeURIComponent(title);
  const body = encodeURIComponent(`${text}\n\n${url}`);
  return `mailto:?subject=${subject}&body=${body}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useShare(payload: SharePayload | null) {
  const [copied, setCopied] = useState(false);

  const url = payload ? getShareUrl(payload) : '';
  const text = payload ? getShareText(payload) : '';

  const track = useCallback((platform: ShareAction['platform']) => {
    if (!payload) return;
    logShareAction({
      platform,
      contentType: payload.type,
      contentId: payload.id,
      timestamp: Date.now(),
    });
  }, [payload]);

  const copyLink = useCallback(async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      track('copy');
    } catch {
      // Fallback for older browsers
      const input = document.createElement('input');
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      track('copy');
    }
  }, [url, track]);

  const shareToLinkedin = useCallback(() => {
    if (!url) return;
    window.open(linkedinShareUrl(url), '_blank', 'width=600,height=500');
    track('linkedin');
  }, [url, track]);

  const shareToTwitter = useCallback(() => {
    if (!url || !payload) return;
    window.open(twitterShareUrl(url, text), '_blank', 'width=600,height=400');
    track('twitter');
  }, [url, text, payload, track]);

  const shareToFacebook = useCallback(() => {
    if (!url) return;
    window.open(facebookShareUrl(url), '_blank', 'width=600,height=500');
    track('facebook');
  }, [url, track]);

  const shareViaEmail = useCallback(() => {
    if (!url || !payload) return;
    window.location.href = emailShareUrl(url, payload.title, text);
    track('email');
  }, [url, text, payload, track]);

  return {
    url,
    copied,
    copyLink,
    shareToLinkedin,
    shareToTwitter,
    shareToFacebook,
    shareViaEmail,
    track,
  };
}
