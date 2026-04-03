import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { useCompanyContext } from '../components/CompanyContext';
import Header from '../components/Header';
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
  twitter:       { icon: '🐦', color: 'border-sky-200 bg-sky-50' },
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

export default function SocialPlatformsPage() {
  const router = useRouter();
  const { selectedCompanyId } = useCompanyContext();
  const [platforms, setPlatforms] = useState<PlatformStatus[]>([]);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const [checks, setChecks] = useState<Record<string, CheckResult>>({});
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [archivedCommunity, setArchivedCommunity] = useState<Set<string>>(new Set());
  const [hiddenSocial, setHiddenSocial] = useState<Set<string>>(new Set());
  const [hiddenTrend, setHiddenTrend] = useState<Set<string>>(new Set());
  const [hiddenImage, setHiddenImage] = useState<Set<string>>(new Set());
  const [hiddenCommunityApi, setHiddenCommunityApi] = useState<Set<string>>(new Set());
  const [showHiddenSocial, setShowHiddenSocial] = useState(false);
  const [showHiddenCommunity, setShowHiddenCommunity] = useState(false);
  const [showHiddenTrend, setShowHiddenTrend] = useState(false);
  const [showHiddenImage, setShowHiddenImage] = useState(false);
  const [showHiddenCommunityApi, setShowHiddenCommunityApi] = useState(false);
  const [activeTab, setActiveTab] = useState<'social' | 'trend' | 'community' | 'image' | 'request-new' | 'queue'>('social');
  const [catalogApis, setCatalogApis] = useState<any[]>([]);
  const [loadingCatalogApis, setLoadingCatalogApis] = useState(false);
  const [companyConfigs, setCompanyConfigs] = useState<any[]>([]);
  const [togglingApiId, setTogglingApiId] = useState<string | null>(null);
  // Content type prefs
  const [platformContentPrefs, setPlatformContentPrefs] = useState<Record<string, string[]>>({});
  const [savingContentPrefs, setSavingContentPrefs] = useState(false);
  const [expandedContentTypes, setExpandedContentTypes] = useState<Set<string>>(new Set());
  const [customTypeInputs, setCustomTypeInputs] = useState<Record<string, string>>({});
  // API request state (Request New / Queue tabs)
  const [apiRequests, setApiRequests] = useState<Array<{ id: string; name: string; base_url: string; status: string; created_at: string; purpose?: string | null; category?: string | null; auth_type?: string | null; api_key_env_name?: string | null; rejection_reason?: string | null }>>([]);
  const [isLoadingApiRequests, setIsLoadingApiRequests] = useState(false);
  const [apiRejectionReasons, setApiRejectionReasons] = useState<Record<string, string>>({});
  const [requestForm, setRequestForm] = useState({ name: '', base_url: '', purpose: 'trends', category: '', method: 'GET' as 'GET' | 'POST', auth_type: 'none', api_key_env_name: '', description: '' });
  const [isSubmittingApiRequest, setIsSubmittingApiRequest] = useState(false);

  const isSuperAdmin = userRole === 'SUPER_ADMIN';

  const notify = (type: 'success' | 'error', message: string) => {
    setNotice({ type, message });
    setTimeout(() => setNotice(null), 5000);
  };

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const params = selectedCompanyId ? `?companyId=${selectedCompanyId}` : '';
      const r = await apiFetch(`/api/social-accounts/status${params}`);
      if (r.ok) {
        const data = await r.json();
        setPlatforms(data.accounts || []);
        setUserRole(data.user_role ?? null);
      }
    } catch (e) {
      console.error('Failed to load social accounts', e);
    } finally {
      setLoading(false);
    }
  }, [selectedCompanyId]);

  const loadCatalogApis = useCallback(async () => {
    if (!selectedCompanyId) return;
    setLoadingCatalogApis(true);
    try {
      // catalog=1 returns all active global preset APIs so the company can browse and select
      const r = await apiFetch(`/api/external-apis?companyId=${selectedCompanyId}&catalog=1`);
      if (r.ok) { const d = await r.json(); setCatalogApis(d.apis || []); }
    } catch { /* non-fatal */ }
    finally { setLoadingCatalogApis(false); }
  }, [selectedCompanyId]);

  const loadCompanyConfigs = useCallback(async () => {
    if (!selectedCompanyId) return;
    try {
      const r = await apiFetch(`/api/external-apis/company-config?companyId=${selectedCompanyId}`);
      if (r.ok) { const d = await r.json(); setCompanyConfigs(d.configs || []); }
    } catch { /* non-fatal */ }
  }, [selectedCompanyId]);

  // ── Content type per platform ──────────────────────────────────────────────

  /** All content types available for each social platform. */
  const CONTENT_TYPES_PER_PLATFORM: Record<string, string[]> = {
    linkedin:      ['post', 'article', 'blog', 'carousel', 'video', 'poll', 'newsletter'],
    instagram:     ['post', 'reel', 'story', 'carousel'],
    facebook:      ['post', 'video', 'story', 'carousel', 'blog'],
    twitter:       ['post', 'thread', 'poll'],
    x:             ['post', 'thread', 'poll'],
    youtube:       ['video', 'short'],
    tiktok:        ['video', 'short'],
    reddit:        ['post', 'thread'],
    whatsapp:      ['post'],
    pinterest:     ['post', 'idea_pin'],
    github:        ['post', 'article'],
    medium:        ['post', 'article', 'blog', 'newsletter'],
    devto:         ['post', 'article', 'blog'],
    blog:          ['post', 'article', 'blog'],
  };

  const loadContentPrefs = useCallback(async () => {
    if (!selectedCompanyId) return;
    try {
      const r = await apiFetch(`/api/social-platforms/content-type-prefs?companyId=${selectedCompanyId}`);
      if (r.ok) { const d = await r.json(); setPlatformContentPrefs(d.prefs || {}); }
    } catch { /* non-fatal */ }
  }, [selectedCompanyId]);

  const saveContentPrefs = async (prefs: Record<string, string[]>) => {
    if (!selectedCompanyId) return;
    setSavingContentPrefs(true);
    try {
      await apiFetch(`/api/social-platforms/content-type-prefs?companyId=${selectedCompanyId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefs }),
      });
      setPlatformContentPrefs(prefs);
    } catch { /* non-fatal */ }
    finally { setSavingContentPrefs(false); }
  };

  /** Add a type to a platform's active list (built-in re-add or new custom). */
  const addContentType = (platformKey: string, type: string) => {
    const normalized = type.trim().toLowerCase().replace(/\s+/g, '_');
    if (!normalized) return;
    const current = platformContentPrefs[platformKey] ?? (CONTENT_TYPES_PER_PLATFORM[platformKey] ?? []);
    if (current.includes(normalized)) return;
    saveContentPrefs({ ...platformContentPrefs, [platformKey]: [...current, normalized] });
  };

  /** Remove a type from a platform's active list (any type, built-in or custom). */
  const removeContentType = (platformKey: string, type: string) => {
    const current = platformContentPrefs[platformKey] ?? (CONTENT_TYPES_PER_PLATFORM[platformKey] ?? []);
    saveContentPrefs({ ...platformContentPrefs, [platformKey]: current.filter((t) => t !== type) });
  };

  /** Add a new custom type from the text input and clear the input. */
  const addCustomContentType = (platformKey: string) => {
    const raw = (customTypeInputs[platformKey] ?? '').trim().toLowerCase().replace(/\s+/g, '_');
    if (!raw) return;
    addContentType(platformKey, raw);
    setCustomTypeInputs((p) => ({ ...p, [platformKey]: '' }));
  };

  const toggleExpandContentTypes = (platformKey: string) => {
    setExpandedContentTypes((prev) => {
      const next = new Set(prev);
      if (next.has(platformKey)) next.delete(platformKey); else next.add(platformKey);
      return next;
    });
  };

  // ── API Request / Queue ─────────────────────────────────────────────────────

  const loadApiRequests = useCallback(async () => {
    if (!selectedCompanyId) return;
    setIsLoadingApiRequests(true);
    try {
      const r = await apiFetch(`/api/external-apis/requests?companyId=${selectedCompanyId}`);
      if (r.ok) { const d = await r.json(); setApiRequests(d.requests || []); }
    } catch { /* non-fatal */ }
    finally { setIsLoadingApiRequests(false); }
  }, [selectedCompanyId]);

  const submitApiRequest = async () => {
    if (!selectedCompanyId || !requestForm.name.trim() || !requestForm.base_url.trim()) return;
    setIsSubmittingApiRequest(true);
    try {
      const r = await apiFetch(`/api/external-apis/requests?companyId=${selectedCompanyId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...requestForm }),
      });
      if (r.ok) {
        setRequestForm({ name: '', base_url: '', purpose: 'trends', category: '', method: 'GET', auth_type: 'none', api_key_env_name: '', description: '' });
        notify('success', 'API request submitted for review.');
        await loadApiRequests();
        setActiveTab('queue');
      } else {
        const e = await r.json().catch(() => ({}));
        notify('error', e.error || 'Failed to submit request');
      }
    } catch { notify('error', 'Failed to submit request'); }
    finally { setIsSubmittingApiRequest(false); }
  };

  const updateApiRequestStatus = async (id: string, status: 'approved' | 'rejected') => {
    const rejection_reason = status === 'rejected' ? (apiRejectionReasons[id] || '') : undefined;
    try {
      const r = await apiFetch('/api/external-apis/requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status, rejection_reason }),
      });
      if (r.ok) {
        notify('success', `Request ${status}.`);
        await loadApiRequests();
      } else {
        const e = await r.json().catch(() => ({}));
        notify('error', e.error || 'Failed to update request');
      }
    } catch { notify('error', 'Failed to update request'); }
  };

  const toggleApiSelection = async (api: any, enable: boolean) => {
    if (!selectedCompanyId) return;
    setTogglingApiId(api.id);
    try {
      const r = await apiFetch(`/api/external-apis/company-config?companyId=${selectedCompanyId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_source_id: api.id, enabled: enable }),
      });
      if (r.ok) await loadCompanyConfigs();
    } catch { /* non-fatal */ }
    finally { setTogglingApiId(null); }
  };

  // Load all hidden/archived sets from localStorage on mount
  useEffect(() => {
    const load = (key: string) => { try { const r = localStorage.getItem(key); return r ? new Set<string>(JSON.parse(r)) : new Set<string>(); } catch { return new Set<string>(); } };
    setArchivedCommunity(load(ARCHIVED_COMMUNITY_KEY));
    setHiddenSocial(load(HIDDEN_SOCIAL_KEY));
    setHiddenTrend(load(HIDDEN_TREND_KEY));
    setHiddenImage(load(HIDDEN_IMAGE_KEY));
    setHiddenCommunityApi(load(HIDDEN_COMMUNITY_API_KEY));
  }, []);

  const makeHideHandlers = (storageKey: string, setter: React.Dispatch<React.SetStateAction<Set<string>>>) => ({
    hide: (id: string) => setter((prev) => { const next = new Set(prev).add(id); try { localStorage.setItem(storageKey, JSON.stringify([...next])); } catch { /**/ } return next; }),
    unhide: (id: string) => setter((prev) => { const next = new Set(prev); next.delete(id); try { localStorage.setItem(storageKey, JSON.stringify([...next])); } catch { /**/ } return next; }),
  });

  const socialHiders        = makeHideHandlers(HIDDEN_SOCIAL_KEY, setHiddenSocial);
  const communityHiders     = makeHideHandlers(ARCHIVED_COMMUNITY_KEY, setArchivedCommunity);
  const communityApiHiders  = makeHideHandlers(HIDDEN_COMMUNITY_API_KEY, setHiddenCommunityApi);
  const trendHiders         = makeHideHandlers(HIDDEN_TREND_KEY, setHiddenTrend);
  const imageHiders         = makeHideHandlers(HIDDEN_IMAGE_KEY, setHiddenImage);

  // Keep old names for backward compat with community card render
  const archiveCommunity = communityHiders.hide;
  const restoreCommunity = communityHiders.unhide;

  // Load cached checks on mount and auto-check stale entries
  useEffect(() => {
    const cached = loadCachedChecks();
    setChecks(cached);
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);
  useEffect(() => { loadCatalogApis(); }, [loadCatalogApis]);
  useEffect(() => { loadCompanyConfigs(); }, [loadCompanyConfigs]);
  useEffect(() => { loadContentPrefs(); }, [loadContentPrefs]);
  useEffect(() => { loadApiRequests(); }, [loadApiRequests]);

  // Daily auto-check: re-verify any configured platform whose cache is stale
  useEffect(() => {
    if (platforms.length === 0) return;
    const cached = loadCachedChecks();
    const stale = platforms
      .filter((p) => p.oauth_configured)
      .filter((p) => !cached[p.platform_key] || isStale(cached[p.platform_key]));

    if (stale.length === 0) return;

    // Run stale checks sequentially (avoid hammering APIs)
    let i = 0;
    const runNext = async () => {
      if (i >= stale.length) return;
      const p = stale[i++];
      try {
        const r = await apiFetch(`/api/social-accounts/verify-config?platform=${p.platform_key}`);
        if (r.ok) {
          const result: CheckResult = await r.json();
          setChecks((prev) => {
            const next = { ...prev, [p.platform_key]: result };
            saveCachedChecks(next);
            return next;
          });
        }
      } catch { /* non-fatal */ }
      setTimeout(runNext, 1200); // 1.2s between checks
    };
    setTimeout(runNext, 2000); // start after page settles
  }, [platforms]);

  // Handle OAuth callback redirect (same-tab legacy flow)
  useEffect(() => {
    const { connected, success, error } = router.query;
    if (connected && success === 'true') {
      notify('success', `${String(connected)} account connected successfully!`);
      loadStatus();
      router.replace('/social-platforms', undefined, { shallow: true });
    } else if (error) {
      notify('error', `Connection failed: ${decodeURIComponent(String(error))}`);
      router.replace('/social-platforms', undefined, { shallow: true });
    }
  }, [router.query]);

  // Refresh when a connector OAuth completes in a popup tab
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'omnivyra_connector_connected') {
        loadStatus();
        const platform = e.newValue?.split(':')[0] || 'account';
        notify('success', `${platform} connected successfully!`);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [loadStatus]);

  const handleConnect = async (p: PlatformStatus) => {
    if (!p.auth_path) return;
    // Route through community-ai connectors so one OAuth connect writes to both
    // social_accounts (publishing) and community_ai_platform_tokens (engagement).
    if (selectedCompanyId) {
      const redirect = encodeURIComponent('/social-platforms');
      const tid = encodeURIComponent(selectedCompanyId);
      window.open(`/api/community-ai/connectors/${p.platform_key}/auth?tenant_id=${tid}&organization_id=${tid}&redirect=${redirect}`, '_blank');
      return;
    }
    // Fallback: legacy per-user flow (no company context)
    const params = new URLSearchParams({ returnTo: '/social-platforms' });
    try {
      const { supabase: sbClient } = await import('../utils/supabaseClient');
      const { data } = await sbClient.auth.getSession();
      if (data.session?.user?.id) params.set('userId', data.session.user.id);
    } catch { /* non-fatal */ }
    window.location.href = `${p.auth_path}?${params.toString()}`;
  };

  const handleDisconnect = async (p: PlatformStatus) => {
    if (!confirm(`Disconnect ${p.platform_label}? This will stop publishing to this account.`)) return;
    setDisconnecting(p.platform_key);
    try {
      const r = await apiFetch('/api/social-accounts/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: p.platform_key }),
      });
      if (r.ok) {
        notify('success', `${p.platform_label} disconnected.`);
        loadStatus();
      } else {
        const err = await r.json().catch(() => ({}));
        notify('error', err.error || 'Failed to disconnect');
      }
    } finally {
      setDisconnecting(null);
    }
  };

  const handleCheck = async (p: PlatformStatus) => {
    setChecking(p.platform_key);
    try {
      const r = await apiFetch(`/api/social-accounts/verify-config?platform=${p.platform_key}`);
      if (r.ok) {
        const result: CheckResult = await r.json();
        setChecks((prev) => {
          const next = { ...prev, [p.platform_key]: result };
          saveCachedChecks(next);
          return next;
        });
        if (!result.credentials_ok) {
          notify('error', `${p.platform_label}: OAuth credentials not configured.`);
        } else if (result.token_ok === false) {
          notify('error', `${p.platform_label}: ${result.token_detail || 'Token invalid — reconnect.'}`);
        } else if (result.token_ok === true) {
          notify('success', `${p.platform_label}: Configuration OK — token is valid.`);
        } else {
          notify('success', `${p.platform_label}: Credentials configured. Connect an account to verify token.`);
        }
      }
    } catch (e) {
      notify('error', `Check failed for ${p.platform_label}`);
    } finally {
      setChecking(null);
    }
  };

  const getCheckBadge = (key: string) => {
    const c = checks[key];
    if (!c) return null;
    const age = Math.round((Date.now() - new Date(c.checked_at).getTime()) / 60000);
    const ageLabel = age < 1 ? 'just now' : age < 60 ? `${age}m ago` : `${Math.round(age / 60)}h ago`;

    if (!c.credentials_ok) return (
      <span className="inline-flex items-center gap-1 text-xs text-red-500" title={`Checked ${ageLabel}`}>
        <XCircle className="h-3 w-3" /> Credentials missing
      </span>
    );
    if (c.token_ok === false) return (
      <span className="inline-flex items-center gap-1 text-xs text-amber-600" title={c.token_detail || ''}>
        <AlertCircle className="h-3 w-3" /> Token invalid · {ageLabel}
      </span>
    );
    if (c.token_ok === true) return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-600" title={`Checked ${ageLabel}`}>
        <CheckCircle2 className="h-3 w-3" /> Verified · {ageLabel}
      </span>
    );
    return (
      <span className="inline-flex items-center gap-1 text-xs text-gray-400" title={`Checked ${ageLabel}`}>
        <CheckCircle2 className="h-3 w-3" /> Credentials OK · {ageLabel}
      </span>
    );
  };

  const getStatusBadge = (p: PlatformStatus) => {
    if (p.connected && p.expired) return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
        <Clock className="h-3 w-3" /> Token Expired
      </span>
    );
    if (p.connected) return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
        <CheckCircle2 className="h-3 w-3" /> Connected
      </span>
    );
    if (!p.oauth_configured) {
      // Super admins see the setup-required indicator; everyone else sees "Not available"
      return isSuperAdmin ? (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-50 text-gray-500 border border-gray-200">
          <Lock className="h-3 w-3" /> Setup required
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-50 text-gray-400 border border-gray-200">
          Not available
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-600 border border-blue-200">
        <AlertCircle className="h-3 w-3" /> Not connected
      </span>
    );
  };

  const renderPlatformCard = (p: PlatformStatus) => {
    const meta = PLATFORM_META[p.platform_key];
    const isChecking = checking === p.platform_key;
    const builtinTypes = CONTENT_TYPES_PER_PLATFORM[p.platform_key] ?? ['post'];
    const savedPrefs = platformContentPrefs[p.platform_key];
    // Active = what's saved (or all built-ins by default)
    const activeTypes = savedPrefs ?? builtinTypes;
    const activeSet = new Set<string>(activeTypes);
    // Custom types = active types that aren't in the built-in list
    const customExtras = activeTypes.filter((t) => !builtinTypes.includes(t));
    // Removed built-ins = built-ins not currently active (available to re-add)
    const removedBuiltins = builtinTypes.filter((t) => !activeSet.has(t));
    const isExpanded = expandedContentTypes.has(p.platform_key);

    return (
      <div
        key={p.platform_key}
        className={`bg-white rounded-xl border transition-colors ${
          p.connected ? 'border-emerald-200' : 'border-gray-200'
        }`}
      >
        {/* Main row */}
        <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-4 min-w-0">
            <span className="text-2xl shrink-0">{meta?.icon ?? '🌐'}</span>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-gray-900">{p.platform_label}</span>
                {getStatusBadge(p)}
              </div>
              {p.connected && (
                <div className="mt-0.5 text-xs text-gray-500 truncate">
                  {p.account_name || p.username || 'Account connected'}
                  {p.token_expires_at && (
                    <span className="ml-2 text-gray-400">
                      · Expires {new Date(p.token_expires_at).toLocaleDateString()}
                    </span>
                  )}
                </div>
              )}
              {!p.oauth_configured && !p.connected && isSuperAdmin && (
                <div className="mt-0.5 text-xs text-gray-400">
                  Add credentials in Super Admin → Platform Config
                </div>
              )}
              {p.oauth_configured && !p.connected && p.auth_path && (
                <div className="mt-0.5 text-xs text-gray-400">Ready to connect</div>
              )}
              {checks[p.platform_key] && (
                <div className="mt-1">{getCheckBadge(p.platform_key)}</div>
              )}
              {/* Content type summary — active types */}
              <div className="mt-1 flex items-center gap-1 flex-wrap">
                {activeTypes.map((t) => (
                  <span key={t} className={`text-[10px] px-1.5 py-0.5 rounded border ${
                    customExtras.includes(t)
                      ? 'bg-violet-50 border-violet-200 text-violet-700'
                      : 'bg-indigo-50 border-indigo-200 text-indigo-700'
                  }`}>{t}</span>
                ))}
                {removedBuiltins.length > 0 && (
                  <span className="text-[10px] text-gray-400">+{removedBuiltins.length} hidden</span>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Content type config button */}
            <button
              onClick={() => toggleExpandContentTypes(p.platform_key)}
              title="Configure content types for AI planning"
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                isExpanded
                  ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                  : 'border-gray-200 text-gray-500 hover:bg-gray-50'
              }`}
            >
              <Settings2 className="h-3.5 w-3.5" />
              Content Types
              <ChevronRight className={`h-3 w-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
            </button>

            {p.oauth_configured && (
              <button
                onClick={() => handleCheck(p)}
                disabled={isChecking}
                title="Verify credentials and token"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-500 text-xs font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                {isChecking
                  ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  : <FlaskConical className="h-3.5 w-3.5" />
                }
                {isChecking ? 'Checking…' : 'Check'}
              </button>
            )}

            {p.connected ? (
              <>
                {p.expired && p.auth_path && (
                  <button
                    onClick={() => handleConnect(p)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-xs font-medium hover:bg-amber-100 transition-colors"
                  >
                    <RefreshCw className="h-3.5 w-3.5" /> Reconnect
                  </button>
                )}
                <button
                  onClick={() => handleDisconnect(p)}
                  disabled={disconnecting === p.platform_key}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-50 border border-red-200 text-red-600 text-xs font-medium hover:bg-red-100 transition-colors disabled:opacity-50"
                >
                  <Unlink className="h-3.5 w-3.5" />
                  {disconnecting === p.platform_key ? 'Disconnecting…' : 'Disconnect'}
                </button>
              </>
            ) : p.oauth_configured && p.auth_path ? (
              <button
                onClick={() => handleConnect(p)}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 transition-colors"
              >
                <Link2 className="h-3.5 w-3.5" /> Connect
              </button>
            ) : p.oauth_configured && !p.auth_path ? (
              <span className="text-xs text-gray-400">Coming soon</span>
            ) : isSuperAdmin ? (
              <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                <Lock className="h-3.5 w-3.5" /> Configure
              </span>
            ) : null}
            {!p.connected && !p.oauth_configured && (
              <button
                onClick={() => socialHiders.hide(p.platform_key)}
                title="Hide from my list"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-400 text-xs font-medium hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Content type configuration panel */}
        {isExpanded && (
          <div className="border-t border-gray-100 px-5 py-4 bg-gray-50 rounded-b-xl space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-1">
              <p className="text-xs font-semibold text-gray-700">Content Types for AI Planning</p>
              <p className="text-xs text-gray-400">Used in BOLT, weekly plan, daily plan &amp; AI chat</p>
            </div>

            {/* Active types — removable tags */}
            <div>
              <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-2">Active</p>
              <div className="flex flex-wrap gap-2 min-h-[32px]">
                {activeTypes.length === 0 && (
                  <p className="text-xs text-gray-400 italic">No types active — AI planning will use system defaults</p>
                )}
                {activeTypes.map((type) => (
                  <span
                    key={type}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-sm font-medium ${
                      customExtras.includes(type)
                        ? 'bg-violet-100 text-violet-800 border border-violet-200'
                        : 'bg-indigo-100 text-indigo-800 border border-indigo-200'
                    }`}
                  >
                    {type}
                    <button
                      onClick={() => removeContentType(p.platform_key, type)}
                      disabled={savingContentPrefs}
                      title={`Remove ${type}`}
                      className="ml-0.5 opacity-60 hover:opacity-100 hover:text-red-600 transition-colors disabled:cursor-not-allowed"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>

            {/* Removed built-ins — click to re-add */}
            {removedBuiltins.length > 0 && (
              <div>
                <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-2">Removed — click to re-add</p>
                <div className="flex flex-wrap gap-2">
                  {removedBuiltins.map((type) => (
                    <button
                      key={type}
                      onClick={() => addContentType(p.platform_key, type)}
                      disabled={savingContentPrefs}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-sm text-gray-500 bg-white border border-dashed border-gray-300 hover:border-indigo-400 hover:text-indigo-700 hover:bg-indigo-50 transition-colors disabled:opacity-50"
                    >
                      <PlusCircle className="h-3 w-3" /> {type}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Add new custom type */}
            <div>
              <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-2">Add custom type</p>
              <div className="flex flex-wrap gap-2">
                <input
                  type="text"
                  placeholder="e.g. infographic, case_study, whitepaper"
                  value={customTypeInputs[p.platform_key] ?? ''}
                  onChange={(e) => setCustomTypeInputs((prev) => ({ ...prev, [p.platform_key]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomContentType(p.platform_key); } }}
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-indigo-400 bg-white"
                />
                <button
                  onClick={() => addCustomContentType(p.platform_key)}
                  disabled={!(customTypeInputs[p.platform_key] ?? '').trim() || savingContentPrefs}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition-colors"
                >
                  <PlusCircle className="h-3.5 w-3.5" /> Add
                </button>
              </div>
            </div>

            <div className="flex items-center gap-4 pt-1 border-t border-gray-200">
              {savingContentPrefs && <p className="text-xs text-gray-400">Saving…</p>}
              {savedPrefs && (
                <button
                  onClick={() => {
                    const newPrefs = { ...platformContentPrefs };
                    delete newPrefs[p.platform_key];
                    saveContentPrefs(newPrefs);
                  }}
                  className="text-xs text-gray-400 hover:text-gray-600 underline ml-auto"
                >
                  Reset to defaults
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderCommunityCard = (p: PlatformStatus, archived = false) => {
    const meta = PLATFORM_META[p.platform_key];
    return (
      <div
        key={p.platform_key}
        className={`bg-white rounded-xl border p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 transition-colors ${
          archived ? 'opacity-60 border-dashed border-gray-200' : p.connected ? 'border-emerald-200' : 'border-gray-200'
        }`}
      >
        <div className="flex items-center gap-4 min-w-0">
          <span className="text-2xl shrink-0">{meta?.icon ?? '🌐'}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-gray-900">{p.platform_label}</span>
              {archived ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-400 border border-gray-200">
                  <Archive className="h-3 w-3" /> Archived
                </span>
              ) : getStatusBadge(p)}
            </div>
            {!archived && p.connected && (
              <div className="mt-0.5 text-xs text-gray-500 truncate">
                {p.account_name || p.username || 'Account connected'}
              </div>
            )}
            {!archived && checks[p.platform_key] && (
              <div className="mt-1">{getCheckBadge(p.platform_key)}</div>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {archived ? (
            <button
              onClick={() => restoreCommunity(p.platform_key)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-medium hover:bg-indigo-100 transition-colors"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Restore
            </button>
          ) : (
            <>
              {p.oauth_configured && (
                <button
                  onClick={() => handleCheck(p)}
                  disabled={checking === p.platform_key}
                  title="Verify credentials and token"
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-500 text-xs font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  {checking === p.platform_key
                    ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    : <FlaskConical className="h-3.5 w-3.5" />}
                  {checking === p.platform_key ? 'Checking…' : 'Check'}
                </button>
              )}
              {p.connected ? (
                <button
                  onClick={() => handleDisconnect(p)}
                  disabled={disconnecting === p.platform_key}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-50 border border-red-200 text-red-600 text-xs font-medium hover:bg-red-100 transition-colors disabled:opacity-50"
                >
                  <Unlink className="h-3.5 w-3.5" />
                  {disconnecting === p.platform_key ? 'Disconnecting…' : 'Disconnect'}
                </button>
              ) : p.oauth_configured && p.auth_path ? (
                <button
                  onClick={() => handleConnect(p)}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 transition-colors"
                >
                  <Link2 className="h-3.5 w-3.5" /> Connect
                </button>
              ) : p.oauth_configured && !p.auth_path ? (
                <span className="text-xs text-gray-400">Coming soon</span>
              ) : isSuperAdmin ? (
                <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                  <Lock className="h-3.5 w-3.5" /> Configure
                </span>
              ) : null}
              <button
                onClick={() => archiveCommunity(p.platform_key)}
                title="Remove from my profile"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-400 text-xs font-medium hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      </div>
    );
  };

  const socialPlatforms = platforms.filter((p) => p.category === 'social');
  const communityPlatforms = platforms.filter((p) => p.category === 'community');
  const connectedCount = platforms.filter((p) => p.connected).length;

  // All users see all platforms. oauth_configured controls whether Connect is available.
  const visibleSocial = socialPlatforms;
  // Catalog API tab data — only active APIs visible to company admin
  const trendApis        = catalogApis.filter((a) => a.is_active && getCatalogApiCategory(a) === 'trend');
  const imageApis        = catalogApis.filter((a) => a.is_active && getCatalogApiCategory(a) === 'image');
  const communityApiList = catalogApis.filter((a) => a.is_active && getCatalogApiCategory(a) === 'community');

  // Social: split by connected / available / hidden
  const connectedSocial   = visibleSocial.filter((p) => p.connected);
  // OAuth-configured platforms are never hidden (they have a connect button the user needs)
  const availableSocial   = visibleSocial.filter((p) => !p.connected && (!hiddenSocial.has(p.platform_key) || p.oauth_configured));
  const hiddenSocialList  = visibleSocial.filter((p) => !p.connected && hiddenSocial.has(p.platform_key) && !p.oauth_configured);

  // Community OAuth — kept for backward compat with renderCommunityCard (archived restore)

  // Trend/Image: selection state from company_api_configs
  const isSelected = (api: any) => companyConfigs.some((c) => c.api_source_id === api.id && c.enabled);

  // Trend: selected (company enabled) → available (not selected, not hidden) → hidden
  const selectedTrendApis   = trendApis.filter((a) => isSelected(a));
  const visibleTrendApis    = trendApis.filter((a) => !isSelected(a) && !hiddenTrend.has(a.name));
  const hiddenTrendList     = trendApis.filter((a) => !isSelected(a) && hiddenTrend.has(a.name));

  // Image: same pattern
  const selectedImageApis     = imageApis.filter((a) => isSelected(a));
  const visibleImageApis      = imageApis.filter((a) => !isSelected(a) && !hiddenImage.has(a.name));
  const hiddenImageList       = imageApis.filter((a) => !isSelected(a) && hiddenImage.has(a.name));

  // Community catalog APIs: same selection pattern
  const selectedCommunityApis = communityApiList.filter((a) => isSelected(a));
  const visibleCommunityApis  = communityApiList.filter((a) => !isSelected(a) && !hiddenCommunityApi.has(a.name));
  const hiddenCommunityApiList = communityApiList.filter((a) => !isSelected(a) && hiddenCommunityApi.has(a.name));

  // Community OAuth platforms: only those actually connected or that have a connect path
  const connectableCommunity  = communityPlatforms.filter((p) => p.oauth_configured && p.auth_path);
  const connectedCommunityOAuth = communityPlatforms.filter((p) => p.connected);
  const archivedCommunityList = communityPlatforms.filter((p) => archivedCommunity.has(p.platform_key));

  type TabId = 'social' | 'trend' | 'community' | 'image' | 'request-new' | 'queue';
  const ALL_TABS: Array<{ id: TabId; label: string; icon: React.ReactNode; dividerBefore?: boolean }> = [
    { id: 'social',       label: 'Social',       icon: <Share2 className="h-4 w-4" /> },
    { id: 'trend',        label: 'Trend',        icon: <TrendingUp className="h-4 w-4" /> },
    { id: 'community',    label: 'Community',    icon: <Users className="h-4 w-4" /> },
    { id: 'image',        label: 'Image',        icon: <ImageIcon className="h-4 w-4" /> },
    { id: 'request-new',  label: 'Request API',  icon: <PlusCircle className="h-4 w-4" />, dividerBefore: true },
    { id: 'queue',        label: 'API Queue',    icon: <ClipboardList className="h-4 w-4" /> },
  ];

  const renderCatalogApiCard = (
    api: any,
    mode: 'selected' | 'available' | 'hidden',
    onHide?: () => void,
    onUnhide?: () => void,
  ) => {
    const selected = mode === 'selected';
    const hidden   = mode === 'hidden';
    const toggling = togglingApiId === api.id;
    return (
      <div key={api.id} className={`rounded-xl border p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 transition-colors ${
        selected ? 'bg-indigo-50 border-indigo-300' : hidden ? 'bg-white border-dashed border-gray-200 opacity-60' : 'bg-white border-gray-200'
      }`}>
        <div className="flex items-center gap-4 min-w-0">
          <span className="text-2xl shrink-0">{getCatalogIcon(api)}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`font-semibold ${selected ? 'text-indigo-900' : 'text-gray-900'}`}>{api.name}</span>
              {selected && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700 border border-indigo-300">
                  <CheckCircle2 className="h-3 w-3" /> In Use
                </span>
              )}
              {api.health?.last_test_status === 'ok' && !hidden && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-600 border border-emerald-200">
                  <CheckCircle2 className="h-3 w-3" /> Verified
                </span>
              )}
            </div>
            <div className="mt-0.5 text-xs text-gray-400 truncate">{api.base_url}</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onUnhide && (
            <button onClick={onUnhide} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-medium hover:bg-indigo-100 transition-colors">
              <RotateCcw className="h-3.5 w-3.5" /> Unhide
            </button>
          )}
          {selected && (
            <button onClick={() => toggleApiSelection(api, false)} disabled={toggling} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white border border-red-200 text-red-600 text-xs font-medium hover:bg-red-50 transition-colors disabled:opacity-50">
              {toggling ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Unlink className="h-3.5 w-3.5" />}
              {toggling ? 'Removing…' : 'Remove'}
            </button>
          )}
          {mode === 'available' && (
            <>
              <button onClick={() => toggleApiSelection(api, true)} disabled={toggling} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50">
                {toggling ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
                {toggling ? 'Adding…' : 'Use this'}
              </button>
              {onHide && (
                <button onClick={onHide} title="Hide from my list" className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-400 text-xs font-medium hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-colors">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <Head><title>API Connections</title></Head>
      <Header />
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10">

          <div className="mb-6">
            <div className="flex items-center gap-3 mb-2">
              <ShieldCheck className="h-6 w-6 text-indigo-600 shrink-0" />
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900">API Connections</h1>
            </div>
            <p className="text-gray-500 text-sm">
              Connect social platforms and manage trend, community &amp; image APIs in one place.
            </p>
            {connectedCount > 0 && (
              <div className="mt-3 text-sm">
                <span className="text-emerald-600 font-medium">{connectedCount} connected</span>
                <span className="text-gray-400 ml-2">· Configs auto-checked daily</span>
              </div>
            )}
          </div>

          {notice && (
            <div className={`mb-5 rounded-lg border px-4 py-3 text-sm ${
              notice.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-red-50 border-red-200 text-red-800'
            }`}>
              {notice.message}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-16 text-gray-400">
              <RefreshCw className="h-5 w-5 animate-spin mr-2" /> Loading…
            </div>
          ) : (
            <>
              {/* Tab bar */}
              <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex gap-1 overflow-x-auto mb-6 scrollbar-hide">
                {ALL_TABS.map((tab) => (
                  <React.Fragment key={tab.id}>
                    {tab.dividerBefore && <span className="self-stretch w-px bg-gray-200 mx-1" />}
                  <button
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                      activeTab === tab.id
                        ? 'bg-indigo-600 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {tab.icon}
                    {tab.label}
                  </button>
                  </React.Fragment>
                ))}
              </div>

              {/* ── Social tab ── */}
              {activeTab === 'social' && (
                <div className="space-y-6">
                  {/* Connected = In Use — shown first */}
                  {connectedSocial.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wide mb-3">In Use</p>
                      <div className="space-y-3">{connectedSocial.map(renderPlatformCard)}</div>
                    </div>
                  )}
                  {/* Available to connect */}
                  {availableSocial.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Available — choose which to connect</p>
                      <div className="space-y-3">{availableSocial.map(renderPlatformCard)}</div>
                    </div>
                  )}
                  {connectedSocial.length === 0 && availableSocial.length === 0 && (
                    <p className="text-sm text-gray-400">No social platforms configured yet.</p>
                  )}
                  {/* Hidden */}
                  {hiddenSocialList.length > 0 && (
                    <div>
                      <button onClick={() => setShowHiddenSocial((v) => !v)} className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-600 transition-colors">
                        <Archive className="h-4 w-4" />
                        <span className="font-medium">Hidden ({hiddenSocialList.length})</span>
                        {showHiddenSocial ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                      {showHiddenSocial && (
                        <div className="mt-3 space-y-3">
                          {hiddenSocialList.map((p) => (
                            <div key={p.platform_key} className="bg-white rounded-xl border border-dashed border-gray-200 p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3 opacity-60">
                              <div className="flex items-center gap-3 min-w-0">
                                <span className="text-2xl shrink-0">{PLATFORM_META[p.platform_key]?.icon ?? '🌐'}</span>
                                <span className="font-semibold text-gray-700 truncate">{p.platform_label}</span>
                              </div>
                              <button onClick={() => socialHiders.unhide(p.platform_key)} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-medium hover:bg-indigo-100 transition-colors">
                                <RotateCcw className="h-3.5 w-3.5" /> Unhide
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ── Community tab ── */}
              {activeTab === 'community' && (
                <div className="space-y-6">
                  {/* Connected OAuth accounts (In Use) */}
                  {connectedCommunityOAuth.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wide mb-3">Connected Accounts</p>
                      <div className="space-y-3">{connectedCommunityOAuth.map((p) => renderCommunityCard(p, false))}</div>
                    </div>
                  )}

                  {/* Catalog API Sources — In Use */}
                  {selectedCommunityApis.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wide mb-3">In Use</p>
                      <div className="space-y-3">
                        {selectedCommunityApis.map((a) => renderCatalogApiCard(a, 'selected'))}
                      </div>
                    </div>
                  )}

                  {/* OAuth platforms with a connect flow (rare, future) */}
                  {connectableCommunity.filter((p) => !p.connected).length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Available — connect account</p>
                      <div className="space-y-3">
                        {connectableCommunity.filter((p) => !p.connected).map((p) => renderCommunityCard(p, false))}
                      </div>
                    </div>
                  )}

                  {/* Catalog API Sources — Available to select */}
                  {visibleCommunityApis.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Available — choose which to use</p>
                      <div className="space-y-3">
                        {visibleCommunityApis.map((a) => renderCatalogApiCard(a, 'available', () => communityApiHiders.hide(a.name)))}
                      </div>
                    </div>
                  )}

                  {/* Empty state */}
                  {connectedCommunityOAuth.length === 0 && selectedCommunityApis.length === 0 && visibleCommunityApis.length === 0 && hiddenCommunityApiList.length === 0 && archivedCommunityList.length === 0 && (
                    <p className="text-sm text-gray-400">No community APIs active. Ask your Super Admin to configure them.</p>
                  )}

                  {/* Hidden catalog APIs */}
                  {hiddenCommunityApiList.length > 0 && (
                    <div>
                      <button onClick={() => setShowHiddenCommunityApi((v) => !v)} className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-600 transition-colors">
                        <Archive className="h-4 w-4" />
                        <span className="font-medium">Hidden ({hiddenCommunityApiList.length})</span>
                        {showHiddenCommunityApi ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                      {showHiddenCommunityApi && (
                        <div className="mt-3 space-y-3">
                          {hiddenCommunityApiList.map((a) => renderCatalogApiCard(a, 'hidden', undefined, () => communityApiHiders.unhide(a.name)))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Archived OAuth community cards (restore) */}
                  {archivedCommunityList.length > 0 && (
                    <div>
                      <button onClick={() => setShowHiddenCommunity((v) => !v)} className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-600 transition-colors">
                        <Archive className="h-4 w-4" />
                        <span className="font-medium">Archived accounts ({archivedCommunityList.length})</span>
                        {showHiddenCommunity ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                      {showHiddenCommunity && (
                        <div className="mt-3 space-y-3">
                          {archivedCommunityList.map((p) => renderCommunityCard(p, true))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ── Trend tab ── */}
              {activeTab === 'trend' && (
                <div className="space-y-6">
                  {selectedTrendApis.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wide mb-3">In Use</p>
                      <div className="space-y-3">
                        {selectedTrendApis.map((a) => renderCatalogApiCard(a, 'selected'))}
                      </div>
                    </div>
                  )}
                  {visibleTrendApis.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Available — choose which to use</p>
                      <div className="space-y-3">
                        {visibleTrendApis.map((a) => renderCatalogApiCard(a, 'available', () => trendHiders.hide(a.name)))}
                      </div>
                    </div>
                  )}
                  {selectedTrendApis.length === 0 && visibleTrendApis.length === 0 && !hiddenTrendList.length && (
                    <p className="text-sm text-gray-400">No trend APIs active. Ask your Super Admin to configure them.</p>
                  )}
                  {hiddenTrendList.length > 0 && (
                    <div>
                      <button onClick={() => setShowHiddenTrend((v) => !v)} className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-600 transition-colors">
                        <Archive className="h-4 w-4" />
                        <span className="font-medium">Hidden ({hiddenTrendList.length})</span>
                        {showHiddenTrend ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                      {showHiddenTrend && (
                        <div className="mt-3 space-y-3">
                          {hiddenTrendList.map((a) => renderCatalogApiCard(a, 'hidden', undefined, () => trendHiders.unhide(a.name)))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ── Image tab ── */}
              {activeTab === 'image' && (
                <div className="space-y-6">
                  {selectedImageApis.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wide mb-3">In Use</p>
                      <div className="space-y-3">
                        {selectedImageApis.map((a) => renderCatalogApiCard(a, 'selected'))}
                      </div>
                    </div>
                  )}
                  {visibleImageApis.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Available — choose which to use</p>
                      <div className="space-y-3">
                        {visibleImageApis.map((a) => renderCatalogApiCard(a, 'available', () => imageHiders.hide(a.name)))}
                      </div>
                    </div>
                  )}
                  {selectedImageApis.length === 0 && visibleImageApis.length === 0 && !hiddenImageList.length && (
                    <p className="text-sm text-gray-400">No image APIs active. Ask your Super Admin to configure them.</p>
                  )}
                  {hiddenImageList.length > 0 && (
                    <div>
                      <button onClick={() => setShowHiddenImage((v) => !v)} className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-600 transition-colors">
                        <Archive className="h-4 w-4" />
                        <span className="font-medium">Hidden ({hiddenImageList.length})</span>
                        {showHiddenImage ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                      {showHiddenImage && (
                        <div className="mt-3 space-y-3">
                          {hiddenImageList.map((a) => renderCatalogApiCard(a, 'hidden', undefined, () => imageHiders.unhide(a.name)))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ── Request New API tab ── */}
              {activeTab === 'request-new' && (
                <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
                  <h2 className="text-base font-semibold text-gray-900 mb-1">Request a New API</h2>
                  <p className="text-sm text-gray-500 mb-5">
                    Submit a request to add a new external API. Super Admin will review and approve or reject.
                  </p>
                  <div className="space-y-4 max-w-2xl">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                      <input
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                        placeholder="e.g. Twitter Trends API"
                        value={requestForm.name}
                        onChange={(e) => setRequestForm((p) => ({ ...p, name: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Base URL *</label>
                      <input
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                        placeholder="https://api.example.com/v1/trends"
                        value={requestForm.base_url}
                        onChange={(e) => setRequestForm((p) => ({ ...p, base_url: e.target.value }))}
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Purpose</label>
                        <select
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                          value={requestForm.purpose}
                          onChange={(e) => setRequestForm((p) => ({ ...p, purpose: e.target.value }))}
                        >
                          <option value="trends">Trends</option>
                          <option value="keywords">Keywords</option>
                          <option value="hashtags">Hashtags</option>
                          <option value="news">News</option>
                          <option value="demographics">Demographics</option>
                          <option value="social">Social</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                        <input
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                          placeholder="e.g. social, analytics"
                          value={requestForm.category}
                          onChange={(e) => setRequestForm((p) => ({ ...p, category: e.target.value }))}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Method</label>
                        <select
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                          value={requestForm.method}
                          onChange={(e) => setRequestForm((p) => ({ ...p, method: e.target.value as 'GET' | 'POST' }))}
                        >
                          <option value="GET">GET</option>
                          <option value="POST">POST</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Auth type</label>
                        <select
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                          value={requestForm.auth_type}
                          onChange={(e) => setRequestForm((p) => ({ ...p, auth_type: e.target.value }))}
                        >
                          <option value="none">None</option>
                          <option value="api_key">API Key</option>
                          <option value="bearer">Bearer</option>
                          <option value="query">Query param</option>
                          <option value="header">Header</option>
                        </select>
                      </div>
                    </div>
                    {['api_key', 'bearer', 'query', 'header'].includes(requestForm.auth_type) && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">API key env var name *</label>
                        <input
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                          placeholder="e.g. TWITTER_API_KEY"
                          value={requestForm.api_key_env_name}
                          onChange={(e) => setRequestForm((p) => ({ ...p, api_key_env_name: e.target.value }))}
                        />
                        <p className="text-xs text-gray-500 mt-1">Server-side env var; key value is not stored.</p>
                      </div>
                    )}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
                      <textarea
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm min-h-[80px]"
                        placeholder="Why your company needs this API, use case, etc."
                        value={requestForm.description}
                        onChange={(e) => setRequestForm((p) => ({ ...p, description: e.target.value }))}
                      />
                    </div>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3 pt-1">
                      <button
                        type="button"
                        onClick={submitApiRequest}
                        disabled={isSubmittingApiRequest || !requestForm.name.trim() || !requestForm.base_url.trim()}
                        className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors w-full sm:w-auto"
                      >
                        <Send className="h-3.5 w-3.5" />
                        {isSubmittingApiRequest ? 'Submitting…' : 'Submit for approval'}
                      </button>
                      <span className="text-xs text-gray-400">Goes to API Queue for Super Admin review.</span>
                    </div>
                  </div>
                </div>
              )}

              {/* ── API Queue tab ── */}
              {activeTab === 'queue' && (
                <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                    <h2 className="text-base font-semibold text-gray-900">API Requests Queue</h2>
                    <button
                      onClick={loadApiRequests}
                      className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${isLoadingApiRequests ? 'animate-spin' : ''}`} />
                      Refresh
                    </button>
                  </div>
                  {isLoadingApiRequests ? (
                    <p className="text-sm text-gray-400">Loading requests…</p>
                  ) : apiRequests.length === 0 ? (
                    <div className="text-center py-10">
                      <ClipboardList className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                      <p className="text-sm text-gray-400">No API requests yet.</p>
                      <button
                        onClick={() => setActiveTab('request-new')}
                        className="mt-3 inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-700"
                      >
                        <PlusCircle className="h-4 w-4" /> Submit a request
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {apiRequests.map((req) => (
                        <div key={req.id} className="border border-gray-200 rounded-lg p-3 sm:p-4">
                          <div className="flex flex-col gap-2">
                            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                              <div className="min-w-0">
                                <div className="font-medium text-gray-900 text-sm">{req.name}</div>
                                <div className="text-xs text-gray-500 truncate">{req.base_url}</div>
                                <div className="mt-1 flex items-center gap-2 flex-wrap">
                                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
                                    req.status === 'approved' ? 'bg-green-100 text-green-700'
                                    : req.status === 'rejected' ? 'bg-red-100 text-red-700'
                                    : 'bg-amber-100 text-amber-700'
                                  }`}>{req.status}</span>
                                  {req.purpose && <span className="text-xs text-gray-400">Purpose: {req.purpose}</span>}
                                  {req.category && <span className="text-xs text-gray-400">Category: {req.category}</span>}
                                  <span className="text-xs text-gray-400">{new Date(req.created_at).toLocaleDateString()}</span>
                                </div>
                                {req.status === 'rejected' && req.rejection_reason && (
                                  <div className="mt-1 text-xs text-red-600">Reason: {req.rejection_reason}</div>
                                )}
                              </div>
                            </div>
                            {req.status === 'pending' && isSuperAdmin && (
                              <div className="flex flex-wrap items-center gap-2">
                                <input
                                  className="border border-gray-200 rounded px-2 py-1 text-xs flex-1 min-w-0"
                                  placeholder="Rejection reason"
                                  value={apiRejectionReasons[req.id] || ''}
                                  onChange={(e) => setApiRejectionReasons((prev) => ({ ...prev, [req.id]: e.target.value }))}
                                />
                                <button
                                  onClick={() => updateApiRequestStatus(req.id, 'approved')}
                                  className="text-xs text-green-700 hover:text-green-800 font-medium"
                                >Approve</button>
                                <button
                                  onClick={() => updateApiRequestStatus(req.id, 'rejected')}
                                  className="text-xs text-red-600 hover:text-red-700 font-medium"
                                >Reject</button>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

            </>
          )}

          <p className="mt-10 text-xs text-gray-400 text-center">
            Connections are per-user. Platform credentials are managed by your Super Admin.
          </p>
        </div>
      </div>
    </>
  );
}
