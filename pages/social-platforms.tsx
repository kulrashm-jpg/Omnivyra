import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { useCompanyContext } from '../components/CompanyContext';
import { apiFetch } from '../lib/apiFetch';
import {
  CheckCircle2,
  AlertCircle,
  XCircle,
  Link2,
  Unlink,
  RefreshCw,
  Clock,
  ShieldCheck,
  Lock,
  Users,
  Share2,
  FlaskConical,
  Archive,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  X,
  TrendingUp,
  ImageIcon,
  PlusCircle,
  Send,
  ClipboardList,
  Settings2,
  ChevronRight,
} from 'lucide-react';

interface PlatformStatus {
  platform_key: string;
  platform_label: string;
  auth_path: string | null;
  category: 'social' | 'community';
  oauth_configured: boolean;
  connected: boolean;
  expired: boolean;
  account_name: string | null;
  username: string | null;
  token_expires_at: string | null;
  social_account_id: string | null;
}

interface CheckResult {
  credentials_ok: boolean;
  token_ok: boolean | null;
  token_detail: string | null;
  checked_at: string;
}

const CACHE_KEY = 'social_platform_checks';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const ARCHIVED_COMMUNITY_KEY     = 'archived_community_platforms';
const HIDDEN_SOCIAL_KEY          = 'hidden_social_platforms';
const HIDDEN_TREND_KEY           = 'hidden_trend_apis';
const HIDDEN_IMAGE_KEY           = 'hidden_image_apis';
const HIDDEN_COMMUNITY_API_KEY   = 'hidden_community_apis';

const PLATFORM_META: Record<string, { icon: string; color: string }> = {
  linkedin:      { icon: '🔵', color: 'border-blue-200 bg-blue-50' },
  twitter:       { icon: '𝕏', color: 'border-gray-200 bg-gray-50' },
  x:             { icon: '𝕏', color: 'border-gray-200 bg-gray-50' },
  youtube:       { icon: '▶️', color: 'border-red-200 bg-red-50' },
  instagram:     { icon: '📷', color: 'border-pink-200 bg-pink-50' },
  facebook:      { icon: '👤', color: 'border-indigo-200 bg-indigo-50' },
  whatsapp:      { icon: '💬', color: 'border-green-200 bg-green-50' },
  tiktok:        { icon: '🎵', color: 'border-gray-200 bg-gray-50' },
  pinterest:     { icon: '📌', color: 'border-rose-200 bg-rose-50' },
  reddit:        { icon: '🟠', color: 'border-orange-200 bg-orange-50' },
  github:        { icon: '🐙', color: 'border-gray-200 bg-gray-50' },
  hackernews:    { icon: '🔶', color: 'border-orange-200 bg-orange-50' },
  discord:       { icon: '💬', color: 'border-violet-200 bg-violet-50' },
  devto:         { icon: '👩‍💻', color: 'border-gray-200 bg-gray-50' },
  medium:        { icon: '✍️', color: 'border-gray-200 bg-gray-50' },
  stackoverflow: { icon: '📚', color: 'border-amber-200 bg-amber-50' },
  quora:         { icon: '❓', color: 'border-red-200 bg-red-50' },
};

// Helper: categorise an external-api catalog entry by its base_url
function getCatalogApiCategory(api: any): 'trend' | 'community' | 'llm' | 'image' | 'others' {
  const url = (api.base_url || '').toLowerCase();
  if (url.includes('/v1/images') || url.includes('stability.ai') || url.includes('replicate.com') || url.includes('fal.run') || url.includes('unsplash.com') || url.includes('pixabay.com') || url.includes('pexels.com')) return 'image';
  if (url.includes('openai.com') || url.includes('anthropic.com') || url.includes('generativelanguage.googleapis') || url.includes('groq.com') || url.includes('mistral.ai') || url.includes('cohere.ai')) return 'llm';
  if (url.includes('reddit.com') || url.includes('hn.algolia.com') || url.includes('stackexchange.com') || url.includes('api.github.com') || url.includes('discord.com/api')) return 'community';
  if (url.includes('googleapis.com/youtube') || url.includes('newsapi.org') || url.includes('serpapi.com') || url.includes('searchapi.io') || url.includes('gdeltproject.org') || url.includes('trends-proxy')) return 'trend';
  return 'others';
}

const CATALOG_ICON: Record<string, string> = {
  'googleapis.com/youtube': '▶️', 'newsapi.org': '📰', 'serpapi.com': '🔍',
  'searchapi.io': '🔎', 'gdeltproject.org': '🌍', 'trends-proxy': '📈',
  '/v1/images': '🖼️', 'stability.ai': '🎨', 'replicate.com': '🔁',
  'fal.run': '⚡', 'unsplash.com': '📷', 'pixabay.com': '🌄', 'pexels.com': '🖼️',
  'openai.com': '🤖', 'anthropic.com': '🧠', 'groq.com': '⚡',
  'mistral.ai': '🌊', 'cohere.ai': '🔗',
};
function getCatalogIcon(api: any): string {
  const url = (api.base_url || '').toLowerCase();
  for (const [k, v] of Object.entries(CATALOG_ICON)) { if (url.includes(k)) return v; }
  return '🔌';
}

function loadCachedChecks(): Record<string, CheckResult> {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, CheckResult>;
  } catch { return {}; }
}

function saveCachedChecks(checks: Record<string, CheckResult>) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(checks)); } catch { /* ignore */ }
}

function isStale(result: CheckResult): boolean {
  return Date.now() - new Date(result.checked_at).getTime() > CACHE_TTL_MS;
}

import { useSocialPlatforms } from '../hooks/useSocialPlatforms';
import SocialPlatformsView from '../components/SocialPlatformsView';
export default function SocialPlatformsPage() {
  const d = useSocialPlatforms();
  return <SocialPlatformsView d={d} />;
}
